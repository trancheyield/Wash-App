// Demo scenario measurements: the step timer (SC-001: signature → `confirmed` → the change
// visible in RPC), the loss waterfall checked against the on-chain event (SC-003), the
// protection checks — premium, payout, expiry, seller result (SC-004) — and the schema of
// `fixtures/demo-run.json` (SC-007). Pure functions; the scenario only calls them.
import {
  accruedView,
  ContractStatus,
  type ContractView,
  type LossEventView,
  type PoolView,
  type ProtectionView,
} from '@washapp/chain'
import { applyLoss, type Micro, payout, premium, premiumFee } from '@washapp/shared'
import { z } from 'zod'

export const SC001_LIMIT_MS = 10_000
export const SC007_LIMIT_MS = 180_000

export type Timed<T> = { value: T; ms: number }

export async function timed<T>(run: () => Promise<T>): Promise<Timed<T>> {
  const t0 = performance.now()
  const value = await run()
  return { value, ms: performance.now() - t0 }
}

export type WaitOptions = { timeoutMs: number; intervalMs: number }

// Polls RPC until the first state that satisfies the predicate; the scenario holds no
// account subscriptions, same as the page (5 s polling).
export async function waitUntil<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  { timeoutMs, intervalMs }: WaitOptions,
): Promise<T> {
  const deadline = performance.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (ok(value)) return value
    if (performance.now() >= deadline) {
      throw new Error(`state did not show up in RPC within ${timeoutMs} ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

type Mismatches = { same: (label: string, got: unknown, want: unknown) => void; list: string[] }

function mismatches(): Mismatches {
  const list: string[] = []
  return {
    list,
    same: (label, got, want) => {
      if (got !== want) list.push(`${label}: ${String(got)} ≠ ${String(want)}`)
    },
  }
}

export type WaterfallCheck = {
  lossBps: number
  amount: Micro
  juniorLoss: Micro
  seniorLoss: Micro
  assetsBefore: Micro
  assetsAfter: Micro
  seniorBefore: Micro
  seniorAfter: Micro
  juniorBefore: Micro
  juniorAfter: Micro
  // SC-003: `L ≤ junior` → senior byte for byte the same; otherwise `senior_loss = L − junior`.
  seniorUnchanged: boolean
  mismatches: string[]
}

// `before` is the pool after the `accrue` step; `record_loss` accrues again up to the
// event's slot, so the state "before the loss" is `accruedView(before, event.ts)`, and it
// has to match the event's `assets_before` byte for byte. Then the same `applyLoss` as `math.rs`.
export function checkWaterfall(
  before: PoolView,
  after: PoolView,
  event: LossEventView,
): WaterfallCheck {
  const atEvent = accruedView(before, event.ts)
  const expected = applyLoss(event.amount, atEvent.senior.assets, atEvent.junior.assets)
  const m = mismatches()
  m.same('assets_before', event.assetsBefore, atEvent.assets)
  m.same('junior_loss', event.juniorLoss, expected.juniorLoss)
  m.same('senior_loss', event.seniorLoss, expected.seniorLoss)
  m.same('senior after', after.senior.assets, atEvent.senior.assets - event.seniorLoss)
  m.same('junior after', after.junior.assets, atEvent.junior.assets - event.juniorLoss)
  m.same('assets after', after.assets, event.assetsAfter)
  if (event.amount <= atEvent.junior.assets) {
    m.same('senior untouched', after.senior.assets, atEvent.senior.assets)
  } else {
    m.same('senior_loss = L − junior', event.seniorLoss, event.amount - atEvent.junior.assets)
  }
  return {
    lossBps: event.lossBps,
    amount: event.amount,
    juniorLoss: event.juniorLoss,
    seniorLoss: event.seniorLoss,
    assetsBefore: event.assetsBefore,
    assetsAfter: event.assetsAfter,
    seniorBefore: atEvent.senior.assets,
    seniorAfter: after.senior.assets,
    juniorBefore: atEvent.junior.assets,
    juniorAfter: after.junior.assets,
    seniorUnchanged: after.senior.assets === atEvent.senior.assets,
    mismatches: m.list,
  }
}

export type PurchaseCheck = {
  nonce: bigint
  notional: Micro
  term: bigint
  premium: Micro
  fee: Micro
  mismatches: string[]
}

// One `buy_protection`: the premium is the mirror's for the requested term, the buyer pays
// exactly that, the fee leaves for the treasury and the rest lands in the collateral with
// no new shares, and the whole notional is reserved.
export function checkPurchase(
  contract: ContractView,
  term: bigint,
  buyerBefore: Micro,
  buyerAfter: Micro,
  before: ProtectionView,
  after: ProtectionView,
): PurchaseCheck {
  const want = premium(contract.notional, before.params.premiumRateBps, term)
  const fee = premiumFee(want, before.params.premiumFeeBps)
  const m = mismatches()
  m.same('premium', contract.premium, want)
  m.same('term', contract.expiryModelTime - contract.startModelTime, term)
  m.same('status', contract.status, ContractStatus.Active)
  m.same('buyer paid', buyerBefore - buyerAfter, want)
  m.same('collateral', after.collateral, before.collateral + want - fee)
  m.same('reserved', after.reserved, before.reserved + contract.notional)
  m.same('share supply', after.shareSupply, before.shareSupply)
  return {
    nonce: contract.nonce,
    notional: contract.notional,
    term,
    premium: contract.premium,
    fee,
    mismatches: m.list,
  }
}

export type SettleCheck = {
  lossIndex: number
  lossBps: number
  // SC-004: `notional × loss_bps / 10 000`, to the unit.
  payout: Micro
  buyerBefore: Micro
  buyerAfter: Micro
  mismatches: string[]
}

export function checkSettle(
  contract: ContractView,
  event: LossEventView,
  buyerBefore: Micro,
  buyerAfter: Micro,
  before: ProtectionView,
  after: ProtectionView,
): SettleCheck {
  const want = payout(contract.notional, event.lossBps)
  const m = mismatches()
  m.same('buyer received', buyerAfter - buyerBefore, want)
  m.same('contract payout', contract.payout, want)
  m.same('status', contract.status, ContractStatus.Settled)
  m.same('settled loss index', contract.settledLossIndex, event.index)
  m.same('collateral', after.collateral, before.collateral - want)
  m.same('reserved', after.reserved, before.reserved - contract.notional)
  return {
    lossIndex: event.index,
    lossBps: event.lossBps,
    payout: want,
    buyerBefore,
    buyerAfter,
    mismatches: m.list,
  }
}

export type ExpireCheck = {
  notional: Micro
  reservedBefore: Micro
  reservedAfter: Micro
  mismatches: string[]
}

// FR-010: expiry releases the reservation and nothing else — the premium stays with the sellers.
export function checkExpire(
  contract: ContractView,
  before: ProtectionView,
  after: ProtectionView,
): ExpireCheck {
  const m = mismatches()
  m.same('status', contract.status, ContractStatus.Expired)
  m.same('payout', contract.payout, 0n)
  m.same('reserved', after.reserved, before.reserved - contract.notional)
  m.same('collateral', after.collateral, before.collateral)
  return {
    notional: contract.notional,
    reservedBefore: before.reserved,
    reservedAfter: after.reserved,
    mismatches: m.list,
  }
}

export type SellerCheck = {
  provided: Micro
  withdrawn: Micro
  // Net premiums of both contracts minus the payout; `null` when the market was not empty
  // at the start — other sellers then share the premiums and the payout.
  expected: Micro | null
  mismatches: string[]
}

export function checkSeller(
  provided: Micro,
  withdrawn: Micro,
  purchases: readonly PurchaseCheck[],
  paid: Micro,
  soleSeller: boolean,
): SellerCheck {
  const net = purchases.reduce((sum, p) => sum + p.premium - p.fee, 0n)
  const expected = soleSeller ? provided + net - paid : null
  const m = mismatches()
  if (expected !== null) m.same('seller withdrew', withdrawn, expected)
  return { provided, withdrawn, expected, mismatches: m.list }
}

// Sums, terms and nonces go into JSON as strings: `bigint` does not survive
// `JSON.stringify`, and `Number` loses units.
const micro = z
  .string()
  .regex(/^-?\d+$/)
  .transform(BigInt)

export const stepSchema = z.object({
  name: z.string().min(1),
  signature: z.string().nullable(),
  // Signature → `confirmed`.
  confirmedMs: z.number().nonnegative(),
  // Signature → the changed state in RPC (pool, market or wallet); `null` for a chain-less step.
  visibleMs: z.number().nonnegative().nullable(),
  note: z.string(),
})

const purchaseSchema = z.object({
  nonce: micro,
  notional: micro,
  term: micro,
  premium: micro,
  fee: micro,
  mismatches: z.array(z.string()),
})

export const demoRunSchema = z.object({
  comment: z.string(),
  ranAt: z.string().datetime(),
  programId: z.string(),
  poolId: z.number().int().nonnegative(),
  // Depositor and protection buyer.
  wallet: z.string(),
  seller: z.string(),
  steps: z.array(stepSchema).min(1),
  // The first accrual after the pool sat idle: every idle chain second is `time_scale`
  // model seconds of yield, so the pool size before the run says nothing about the run.
  catchUp: z.object({
    idleSeconds: z.number().int().nonnegative(),
    assetsBefore: micro,
    assetsAfter: micro,
  }),
  waterfall: z.object({
    lossBps: z.number().int(),
    amount: micro,
    juniorLoss: micro,
    seniorLoss: micro,
    assetsBefore: micro,
    assetsAfter: micro,
    seniorBefore: micro,
    seniorAfter: micro,
    juniorBefore: micro,
    juniorAfter: micro,
    seniorUnchanged: z.boolean(),
    mismatches: z.array(z.string()),
  }),
  nav: z.object({
    seniorBefore: micro,
    seniorAfterAccrue: micro,
    juniorBefore: micro,
    juniorAfterAccrue: micro,
  }),
  protection: z.object({
    covered: purchaseSchema,
    expiring: purchaseSchema,
    settle: z.object({
      lossIndex: z.number().int().nonnegative(),
      lossBps: z.number().int(),
      payout: micro,
      buyerBefore: micro,
      buyerAfter: micro,
      mismatches: z.array(z.string()),
    }),
    expire: z.object({
      notional: micro,
      reservedBefore: micro,
      reservedAfter: micro,
      mismatches: z.array(z.string()),
    }),
    seller: z.object({
      provided: micro,
      withdrawn: micro,
      expected: micro.nullable(),
      mismatches: z.array(z.string()),
    }),
  }),
  totalMs: z.number().nonnegative(),
  sc001MaxMs: z.number().nonnegative(),
})

export type Step = z.infer<typeof stepSchema>
export type DemoRun = z.infer<typeof demoRunSchema>

// Only steps with a transaction: "wait" is the scenario waiting for yield, not a user
// waiting on the screen.
export function sc001Max(steps: readonly Step[]): number {
  return Math.max(
    0,
    ...steps.filter((s) => s.signature !== null).map((s) => s.visibleMs ?? s.confirmedMs),
  )
}

// Every check of the run in one list, prefixed by where it came from.
export function allMismatches(run: DemoRun): string[] {
  const { protection: p } = run
  return [
    ...run.waterfall.mismatches.map((m) => `waterfall: ${m}`),
    ...p.covered.mismatches.map((m) => `buy cover: ${m}`),
    ...p.expiring.mismatches.map((m) => `buy short: ${m}`),
    ...p.settle.mismatches.map((m) => `settle: ${m}`),
    ...p.expire.mismatches.map((m) => `expire: ${m}`),
    ...p.seller.mismatches.map((m) => `withdraw: ${m}`),
  ]
}

// Serialization with `bigint` → string; read back by `demoRunSchema`.
export function toJson(run: DemoRun): string {
  return `${JSON.stringify(run, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n`
}
