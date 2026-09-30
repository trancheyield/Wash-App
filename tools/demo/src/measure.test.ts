import { existsSync, readFileSync } from 'node:fs'
import { address } from '@solana/kit'
import type { ContractView, LossEventView, PoolView, ProtectionView } from '@washapp/chain'
import { accruedView, ContractStatus } from '@washapp/chain'
import { applyLoss, lossAmount, premium, premiumFee } from '@washapp/shared'
import { describe, expect, it } from 'vitest'
import {
  allMismatches,
  checkExpire,
  checkPurchase,
  checkSeller,
  checkSettle,
  checkWaterfall,
  type DemoRun,
  demoRunSchema,
  SC001_LIMIT_MS,
  SC007_LIMIT_MS,
  sc001Max,
  toJson,
  waitUntil,
} from './measure.ts'

const A = address('11111111111111111111111111111111')
const MICRO = 1_000_000n
const DAY = 86_400n

// The pool after `accrue` in slot `ts`; `record_loss` then accrues on its own up to `ts + 3`.
function poolAt(senior: bigint, junior: bigint, ts: bigint): PoolView {
  return {
    address: A,
    id: 0,
    operator: A,
    mint: A,
    vault: A,
    params: {
      yieldRateBps: 800,
      seniorRateBps: 500,
      minJuniorBps: 2000,
      perfFeeBps: 1000,
      timeScale: 43_200,
    },
    assets: senior + junior,
    senior: { mint: A, assets: senior, supply: senior, nav: MICRO },
    junior: { mint: A, assets: junior, supply: junior, nav: MICRO },
    modelTime: 0n,
    lastAccruedTs: ts,
    createdAt: ts,
    lossCount: 0,
    lossEvents: [],
  }
}

// The event as the program would record it: accrue up to `ts`, then `apply_loss`.
function recorded(before: PoolView, lossBps: number, ts: bigint) {
  const at = accruedView(before, ts)
  const amount = lossAmount(at.assets, lossBps)
  const split = applyLoss(amount, at.senior.assets, at.junior.assets)
  const event: LossEventView = {
    address: A,
    index: 0,
    ts,
    modelTime: at.modelTime,
    lossBps,
    amount,
    juniorLoss: split.juniorLoss,
    seniorLoss: split.seniorLoss,
    assetsBefore: at.assets,
    assetsAfter: at.assets - amount,
  }
  const after: PoolView = {
    ...at,
    assets: at.assets - amount,
    senior: { ...at.senior, assets: at.senior.assets - split.seniorLoss },
    junior: { ...at.junior, assets: at.junior.assets - split.juniorLoss },
    lossCount: 1,
    lossEvents: [event],
  }
  return { event, after }
}

describe('checkWaterfall', () => {
  it('L ≤ junior: senior byte for byte, junior takes all — no mismatches', () => {
    const before = poolAt(2_000n * MICRO, 2_000n * MICRO, 1_000n)
    const { event, after } = recorded(before, 1_500, 1_003n)
    const check = checkWaterfall(before, after, event)
    expect(check.mismatches).toEqual([])
    expect(check.seniorUnchanged).toBe(true)
    expect(check.seniorLoss).toBe(0n)
    expect(check.juniorLoss).toBe(event.amount)
    // Three seconds of yield between `accrue` and the event are counted, not ignored.
    expect(check.assetsBefore).toBeGreaterThan(before.assets)
  })

  it('L > junior: senior_loss = L − junior', () => {
    const before = poolAt(9_000n * MICRO, 1_000n * MICRO, 1_000n)
    const { event, after } = recorded(before, 3_000, 1_002n)
    const check = checkWaterfall(before, after, event)
    expect(check.mismatches).toEqual([])
    expect(check.seniorUnchanged).toBe(false)
    expect(check.juniorAfter).toBe(0n)
    expect(check.seniorLoss).toBe(event.amount - check.juniorBefore)
  })

  it('names the field when the chain disagrees with the mirror', () => {
    const before = poolAt(2_000n * MICRO, 2_000n * MICRO, 1_000n)
    const { event, after } = recorded(before, 1_500, 1_003n)
    const tampered: PoolView = {
      ...after,
      senior: { ...after.senior, assets: after.senior.assets - 1n },
    }
    const check = checkWaterfall(before, tampered, event)
    expect(check.mismatches.some((m) => m.startsWith('senior after'))).toBe(true)
    expect(check.mismatches.some((m) => m.startsWith('senior untouched'))).toBe(true)
    expect(check.seniorUnchanged).toBe(false)
  })
})

// The demo market parameters from `fixtures/params.json`.
function market(collateral: bigint, reserved: bigint, shareSupply: bigint): ProtectionView {
  return {
    address: A,
    pool: A,
    pvault: A,
    params: { premiumRateBps: 200, triggerBps: 100, premiumFeeBps: 1000 },
    collateral,
    reserved,
    free: collateral - reserved,
    shareSupply,
    shareValue: MICRO,
    contracts: 0n,
  }
}

function contractOf(notional: bigint, term: bigint, patch: Partial<ContractView> = {}) {
  const c: ContractView = {
    address: A,
    buyer: A,
    nonce: 0n,
    notional,
    premium: premium(notional, 200, term),
    startModelTime: 1_000n,
    expiryModelTime: 1_000n + term,
    triggerBps: 100,
    lossIndexFrom: 0,
    status: ContractStatus.Active,
    settledLossIndex: 0,
    payout: 0n,
  }
  return { ...c, ...patch }
}

describe('protection checks', () => {
  const notional = 1_000n * MICRO
  const term = 90n * DAY
  const cost = premium(notional, 200, term)
  const fee = premiumFee(cost, 1000)

  it('a purchase: the mirror premium, paid by the buyer, net in collateral, notional reserved', () => {
    const before = market(2_000n * MICRO, 0n, 2_000n * MICRO)
    const after = market(before.collateral + cost - fee, notional, before.shareSupply)
    const check = checkPurchase(
      contractOf(notional, term),
      term,
      3_000n * MICRO,
      3_000n * MICRO - cost,
      before,
      after,
    )
    expect(check.mismatches).toEqual([])
    // 1 000 WUSD × 2 % × 90/365 — the number the scenario log shows.
    expect(check.premium).toBe(4_931_506n)
    expect(check.fee).toBe(fee)
  })

  it('a purchase that charged one unit more is named', () => {
    const before = market(2_000n * MICRO, 0n, 2_000n * MICRO)
    const after = market(before.collateral + cost - fee + 1n, notional, before.shareSupply)
    const check = checkPurchase(
      contractOf(notional, term, { premium: cost + 1n }),
      term,
      3_000n * MICRO,
      3_000n * MICRO - cost - 1n,
      before,
      after,
    )
    expect(check.mismatches.map((m) => m.split(':')[0])).toEqual([
      'premium',
      'buyer paid',
      'collateral',
    ])
  })

  it('settle (SC-004): the buyer gains notional × loss_bps / 10 000 to the unit', () => {
    const before = market(2_004n * MICRO, notional, 2_000n * MICRO)
    const paid = 150n * MICRO
    const after = market(before.collateral - paid, 0n, before.shareSupply)
    const event = recorded(poolAt(0n, 10_000n * MICRO, 1_000n), 1_500, 1_003n).event
    const settled = contractOf(notional, term, {
      status: ContractStatus.Settled,
      payout: paid,
      settledLossIndex: event.index,
    })
    const check = checkSettle(settled, event, 100n * MICRO, 250n * MICRO, before, after)
    expect(check.mismatches).toEqual([])
    expect(check.payout).toBe(paid)

    const short = checkSettle(settled, event, 100n * MICRO, 250n * MICRO - 1n, before, after)
    expect(short.mismatches).toEqual(['buyer received: 149999999 ≠ 150000000'])
  })

  it('expire releases the reservation and keeps the collateral', () => {
    const before = market(2_000n * MICRO, 500n * MICRO, 2_000n * MICRO)
    const expired = contractOf(500n * MICRO, DAY, { status: ContractStatus.Expired })
    expect(checkExpire(expired, before, market(before.collateral, 0n, 1n)).mismatches).toEqual([])
    const drained = market(before.collateral - 1n, 0n, 1n)
    expect(checkExpire(expired, before, drained).mismatches).toEqual([
      'collateral: 1999999999 ≠ 2000000000',
    ])
  })

  it('the sole seller gets the net premiums minus the payout; otherwise it is not predicted', () => {
    const purchase = {
      nonce: 0n,
      notional,
      term,
      premium: 10n * MICRO,
      fee: MICRO,
      mismatches: [],
    }
    const provided = 2_000n * MICRO
    const withdrawn = provided + 9n * MICRO - 150n * MICRO
    expect(checkSeller(provided, withdrawn, [purchase], 150n * MICRO, true)).toEqual({
      provided,
      withdrawn,
      expected: withdrawn,
      mismatches: [],
    })
    expect(
      checkSeller(provided, withdrawn + 1n, [purchase], 150n * MICRO, true).mismatches,
    ).toHaveLength(1)
    expect(checkSeller(provided, 0n, [purchase], 150n * MICRO, false)).toMatchObject({
      expected: null,
      mismatches: [],
    })
  })
})

describe('waitUntil', () => {
  it('returns the first state that satisfies the predicate', async () => {
    let n = 0
    const value = await waitUntil(
      async () => ++n,
      (v) => v >= 3,
      { timeoutMs: 1_000, intervalMs: 1 },
    )
    expect(value).toBe(3)
  })

  it('throws once the deadline passes', async () => {
    await expect(
      waitUntil(
        async () => 0,
        () => false,
        { timeoutMs: 5, intervalMs: 1 },
      ),
    ).rejects.toThrow(/did not show up/)
  })
})

describe('demo run report', () => {
  const purchase = {
    nonce: 3n,
    notional: 1n,
    term: DAY,
    premium: 1n,
    fee: 0n,
    mismatches: [],
  }
  const run: DemoRun = {
    comment: 'test',
    ranAt: '2026-09-16T00:00:00.000Z',
    programId: A,
    poolId: 0,
    wallet: A,
    seller: A,
    steps: [
      { name: 'fund', signature: 'sig', confirmedMs: 1_200, visibleMs: 1_400, note: '' },
      { name: 'wait', signature: null, confirmedMs: 60_000, visibleMs: null, note: '' },
    ],
    catchUp: { idleSeconds: 3_600, assetsBefore: 10n, assetsAfter: 11n },
    waterfall: {
      lossBps: 1_500,
      amount: 1n,
      juniorLoss: 1n,
      seniorLoss: 0n,
      assetsBefore: 10n,
      assetsAfter: 9n,
      seniorBefore: 5n,
      seniorAfter: 5n,
      juniorBefore: 5n,
      juniorAfter: 4n,
      seniorUnchanged: true,
      mismatches: [],
    },
    nav: {
      seniorBefore: MICRO,
      seniorAfterAccrue: MICRO,
      juniorBefore: MICRO,
      juniorAfterAccrue: MICRO,
    },
    protection: {
      covered: purchase,
      expiring: { ...purchase, nonce: 4n },
      settle: {
        lossIndex: 5,
        lossBps: 1_500,
        payout: 150n,
        buyerBefore: 0n,
        buyerAfter: 150n,
        mismatches: [],
      },
      expire: { notional: 1n, reservedBefore: 1n, reservedAfter: 0n, mismatches: [] },
      seller: { provided: 2n, withdrawn: 2n, expected: null, mismatches: [] },
    },
    totalMs: 70_000,
    sc001MaxMs: 1_400,
  }

  it('round-trips bigint sums through JSON', () => {
    expect(demoRunSchema.parse(JSON.parse(toJson(run)))).toEqual(run)
  })

  it('sc001Max takes the screen-visible time and skips chain-less steps', () => {
    // The 60 s "wait" step has no transaction and does not count toward SC-001.
    expect(sc001Max(run.steps)).toBe(1_400)
    expect(
      sc001Max([
        { ...run.steps[0], visibleMs: null, confirmedMs: 900 } as DemoRun['steps'][number],
      ]),
    ).toBe(900)
  })

  it('allMismatches prefixes every failed check with its step', () => {
    expect(allMismatches(run)).toEqual([])
    const failed: DemoRun = {
      ...run,
      protection: {
        ...run.protection,
        settle: { ...run.protection.settle, mismatches: ['buyer received: 1 ≠ 2'] },
      },
    }
    expect(allMismatches(failed)).toEqual(['settle: buyer received: 1 ≠ 2'])
  })
})

// Guard of the recorded run: the fixture parses and holds the SPEC limits.
// Red here means measured and failed, not "fix the test".
describe('fixtures/demo-run.json', () => {
  const url = new URL('../../../fixtures/demo-run.json', import.meta.url)
  it.skipIf(!existsSync(url))('is a completed run within SC-001, SC-004 and SC-007', () => {
    const run = demoRunSchema.parse(JSON.parse(readFileSync(url, 'utf8')))
    expect(run.steps.map((s) => s.name)).toEqual([
      'fund',
      'catch-up accrue',
      'faucet buyer',
      'faucet seller',
      'deposit junior',
      'deposit senior',
      'provide',
      'buy cover',
      'buy short',
      'wait',
      'accrue',
      'record_loss',
      'settle',
      'expire',
      'redeem senior',
      'redeem junior',
      'withdraw',
    ])
    expect(allMismatches(run)).toEqual([])
    const { covered, settle } = run.protection
    expect(settle.buyerAfter - settle.buyerBefore).toBe(
      (covered.notional * BigInt(settle.lossBps)) / 10_000n,
    )
    expect(run.sc001MaxMs).toBe(sc001Max(run.steps))
    expect(run.sc001MaxMs).toBeLessThanOrEqual(SC001_LIMIT_MS)
    expect(run.totalMs).toBeLessThanOrEqual(SC007_LIMIT_MS)
    expect(run.nav.seniorAfterAccrue).toBeGreaterThan(run.nav.seniorBefore)
    expect(run.nav.juniorAfterAccrue).toBeGreaterThan(run.nav.juniorBefore)
  })
})
