// Pre-sign previews of the protection desk — the guards of `provide_protection`,
// `withdraw_protection` and `buy_protection` in the program's order, on the protection
// pool as last read. The program stays the last judge: another buyer may reserve the
// free collateral between the preview and the slot of the transaction.
import {
  ContractStatus,
  type ContractView,
  type LossEventView,
  type ProtectionView,
} from '@washapp/chain'
import {
  amountSchema,
  collateralForShares,
  formatAmount,
  MAX_TERM_SECONDS,
  type Micro,
  payout,
  premium,
  premiumFee,
  sharesForCollateral,
  WaterfallError,
} from '@washapp/shared'
import { z } from 'zod'
import { formatBps } from '../../format.ts'
import { DAY_SECONDS } from '../../model-clock.ts'
import { TOKEN } from '../../tokens.ts'

export const SHARES = 'shares'

// Terms are typed in whole model days; the program takes model seconds up to ten years.
const MAX_TERM_DAYS = MAX_TERM_SECONDS / DAY_SECONDS

export const termDaysSchema = z
  .string()
  .trim()
  .regex(/^\d{1,4}$/, 'term must be a whole number of model days')
  .transform(BigInt)
  .pipe(
    z
      .bigint()
      .min(1n, 'term must be at least one model day')
      .max(MAX_TERM_DAYS, `term must be at most ${MAX_TERM_DAYS} model days`),
  )

export const buyFormSchema = z.object({ notional: amountSchema, termDays: termDaysSchema })
export type BuyForm = z.infer<typeof buyFormSchema>

export type SellMode = 'provide' | 'withdraw'
export const sellModeSchema = z.enum(['provide', 'withdraw'])

export type Refusal = { kind: 'refused'; reason: string }

function refused(reason: string): Refusal {
  return { kind: 'refused', reason }
}

// The wallet side of a preview; `null` while no wallet is connected or read — then the
// preview checks the market only.
export type Holdings = { base: Micro; sellerShares: Micro } | null

export type CoverState = { collateral: Micro; reserved: Micro }

export type BuyPreview =
  | {
      kind: 'ok'
      premium: Micro
      fee: Micro
      // What the sellers' collateral grows by: the premium less the protocol fee.
      net: Micro
      term: bigint
      expiryModelTime: bigint
      after: CoverState
    }
  | Refusal

export type BuyInput = {
  protection: ProtectionView
  // The pool clock the purchase will see: `buy_protection` accrues first, so the
  // expiry is counted from the projected model time, not the last accrual.
  modelTime: bigint
  form: BuyForm
  wallet: Holdings
}

// A blank notional is not a request yet: after a purchase the desk clears the notional and
// keeps the term, and that form should show the hint, not "amount must be a positive number".
export function buyRequested(notional: string): boolean {
  return notional.trim() !== ''
}

export function premiumPreview({ protection, modelTime, form, wallet }: BuyInput): BuyPreview {
  const { notional, termDays } = form
  const term = termDays * DAY_SECONDS
  if (notional > protection.free && protection.collateral === 0n) {
    return refused(
      'No collateral in the market yet — sellers provide it before cover can be bought.',
    )
  }
  if (notional > protection.free) {
    return refused(
      `Free collateral is ${formatAmount(protection.free)} ${TOKEN}; ${formatAmount(notional)} ${TOKEN} of cover asked — ${formatAmount(protection.reserved)} ${TOKEN} is reserved by active contracts.`,
    )
  }
  let paid: Micro
  try {
    paid = premium(notional, protection.params.premiumRateBps, term)
  } catch (e) {
    return mathRefusal(e)
  }
  if (paid === 0n && protection.params.premiumRateBps > 0) {
    return refused(
      `The premium on ${formatAmount(notional, 6)} ${TOKEN} for ${termDays} model days rounds down to zero — buy a larger notional or a longer term.`,
    )
  }
  if (wallet && paid > wallet.base) {
    return refused(
      `Not enough ${TOKEN} for the premium: ${formatAmount(paid, 6)} due, ${formatAmount(wallet.base)} in wallet.`,
    )
  }
  const fee = premiumFee(paid, protection.params.premiumFeeBps)
  return {
    kind: 'ok',
    premium: paid,
    fee,
    net: paid - fee,
    term,
    expiryModelTime: modelTime + term,
    after: {
      collateral: protection.collateral + paid - fee,
      reserved: protection.reserved + notional,
    },
  }
}

export type SellPreview =
  | {
      kind: 'ok'
      // Provide: WUSD in, shares out. Withdraw: shares in, WUSD out.
      give: Micro
      receive: Micro
      after: CoverState
    }
  | Refusal

export type SellInput = {
  protection: ProtectionView
  mode: SellMode
  // Provide — the base token; withdraw — seller shares. Both have six decimals.
  value: Micro
  wallet: Holdings
}

// The math errors a preview can meet, in words; anything else is a bug and rethrows.
function mathRefusal(e: unknown): Refusal {
  if (!(e instanceof WaterfallError)) throw e
  switch (e.code) {
    case 'CollateralWipedOut':
      return refused(
        'Payouts took all the collateral while shares remain — the market takes no new collateral and pays nothing out.',
      )
    case 'Overflow':
      return refused('amount is too large')
    default:
      throw e
  }
}

function providePreview({ protection, value, wallet }: SellInput): SellPreview {
  if (wallet && value > wallet.base) {
    return refused(
      `Not enough ${TOKEN}: ${formatAmount(value)} asked, ${formatAmount(wallet.base)} in wallet.`,
    )
  }
  let shares: Micro
  try {
    shares = sharesForCollateral(value, protection.collateral, protection.shareSupply)
  } catch (e) {
    return mathRefusal(e)
  }
  // Collateral for zero shares would be a gift to the sellers already in.
  if (shares === 0n) {
    return refused(`${formatAmount(value, 6)} ${TOKEN} rounds down to zero shares — provide more.`)
  }
  return {
    kind: 'ok',
    give: value,
    receive: shares,
    after: { collateral: protection.collateral + value, reserved: protection.reserved },
  }
}

function withdrawPreview({ protection, value, wallet }: SellInput): SellPreview {
  if (wallet && value > wallet.sellerShares) {
    return refused(
      `Not enough ${SHARES}: ${formatAmount(value)} asked, ${formatAmount(wallet.sellerShares)} held.`,
    )
  }
  let amount: Micro
  try {
    amount = collateralForShares(value, protection.collateral, protection.shareSupply)
  } catch (e) {
    if (e instanceof WaterfallError && e.code === 'ParameterOutOfRange') {
      return refused(`${formatAmount(value)} ${SHARES} exceeds all seller shares.`)
    }
    return mathRefusal(e)
  }
  if (amount === 0n) {
    return refused(
      `${formatAmount(value, 6)} ${SHARES} is worth less than one micro-unit of ${TOKEN}.`,
    )
  }
  if (amount > protection.free) {
    return refused(
      `${formatAmount(value)} ${SHARES} is worth ${formatAmount(amount)} ${TOKEN}, but only ${formatAmount(protection.free)} ${TOKEN} is free — ${formatAmount(protection.reserved)} ${TOKEN} is reserved by active cover until it settles or expires.`,
    )
  }
  return {
    kind: 'ok',
    give: value,
    receive: amount,
    after: { collateral: protection.collateral - amount, reserved: protection.reserved },
  }
}

export function sellPreview(input: SellInput): SellPreview {
  if (input.value <= 0n) return refused('amount must be greater than zero')
  return input.mode === 'provide' ? providePreview(input) : withdrawPreview(input)
}

// The most shares the seller can burn now: all of them, unless the reserve holds part
// of their value. Rounding down keeps `collateralForShares(result) ≤ free`.
export function maxWithdrawShares(protection: ProtectionView, held: Micro): Micro {
  if (protection.collateral === 0n || protection.shareSupply === 0n) return 0n
  const byFree = (protection.free * protection.shareSupply) / protection.collateral
  return held < byFree ? held : byFree
}

export type ContractState =
  | { kind: 'settled'; payout: Micro; lossIndex: number }
  | { kind: 'expired' }
  // A covered loss is on the chain: settle pays `payout` — also after expiry, as long
  // as the event fell inside the term.
  | { kind: 'claim'; event: LossEventView; payout: Micro }
  | { kind: 'expirable' }
  | { kind: 'covered'; daysLeft: bigint }

// The loss event `settle_protection` would accept for this contract, with the largest
// payout — a contract settles once, so the buyer claims on the biggest covered loss.
// Ties go to the earlier event.
export function settleable(
  contract: ContractView,
  events: readonly LossEventView[],
): { event: LossEventView; payout: Micro } | null {
  if (contract.status !== ContractStatus.Active) return null
  let best: { event: LossEventView; payout: Micro } | null = null
  for (const event of events) {
    if (event.index < contract.lossIndexFrom) continue
    if (event.modelTime > contract.expiryModelTime) continue
    if (event.lossBps < contract.triggerBps) continue
    const paid = payout(contract.notional, event.lossBps)
    if (paid === 0n) continue
    if (!best || paid > best.payout) best = { event, payout: paid }
  }
  return best
}

// What the contract row shows and which button it offers. `modelTime` is the projected
// pool clock: `expire_protection` accrues first, so the chain will be at least there.
export function contractState(
  contract: ContractView,
  events: readonly LossEventView[],
  modelTime: bigint,
): ContractState {
  if (contract.status === ContractStatus.Settled) {
    return { kind: 'settled', payout: contract.payout, lossIndex: contract.settledLossIndex }
  }
  if (contract.status === ContractStatus.Expired) return { kind: 'expired' }
  const claim = settleable(contract, events)
  if (claim) return { kind: 'claim', ...claim }
  if (modelTime >= contract.expiryModelTime) return { kind: 'expirable' }
  const left = contract.expiryModelTime - modelTime
  return { kind: 'covered', daysLeft: (left + DAY_SECONDS - 1n) / DAY_SECONDS }
}

export function triggerLine(protection: ProtectionView): string {
  return `notional × loss % when a loss ≥ ${formatBps(protection.params.triggerBps)} falls inside the term`
}
