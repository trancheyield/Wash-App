import { existsSync, readFileSync } from 'node:fs'
import { address } from '@solana/kit'
import type { LossEventView, PoolView } from '@washapp/chain'
import { accruedView } from '@washapp/chain'
import { applyLoss, lossAmount } from '@washapp/shared'
import { describe, expect, it } from 'vitest'
import {
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

// Пул після `accrue` у слоті `ts`: далі `record_loss` нараховує сам до `ts + 3`.
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

// Подія так, як її записала б програма: accrue до `ts`, потім `apply_loss`.
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
    // Три секунди доходу між `accrue` і подією враховано, не проігноровано.
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
    ).rejects.toThrow(/не з'явився/)
  })
})

describe('demo run report', () => {
  const run: DemoRun = {
    comment: 'test',
    ranAt: '2026-09-16T00:00:00.000Z',
    programId: A,
    poolId: 0,
    wallet: A,
    steps: [
      { name: 'fund', signature: 'sig', confirmedMs: 1_200, visibleMs: 1_400, note: '' },
      { name: 'wait', signature: null, confirmedMs: 60_000, visibleMs: null, note: '' },
    ],
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
    totalMs: 70_000,
    sc001MaxMs: 1_400,
  }

  it('round-trips bigint sums through JSON', () => {
    expect(demoRunSchema.parse(JSON.parse(toJson(run)))).toEqual(run)
  })

  it('sc001Max takes the screen-visible time and skips chain-less steps', () => {
    // Крок «wait» — 60 с без транзакції — у SC-001 не входить.
    expect(sc001Max(run.steps)).toBe(1_400)
    expect(
      sc001Max([
        { ...run.steps[0], visibleMs: null, confirmedMs: 900 } as DemoRun['steps'][number],
      ]),
    ).toBe(900)
  })
})

// Сторож зафіксованого прогону: фікстура читається схемою і тримає ліміти SPEC.
// Червоний тут — це виміряно і провалено, не «полагодити тест».
describe('fixtures/demo-run.json', () => {
  const url = new URL('../../../fixtures/demo-run.json', import.meta.url)
  it.skipIf(!existsSync(url))('is a completed run within SC-001 and SC-007', () => {
    const run = demoRunSchema.parse(JSON.parse(readFileSync(url, 'utf8')))
    expect(run.steps.map((s) => s.name)).toEqual([
      'fund',
      'faucet',
      'deposit junior',
      'deposit senior',
      'wait',
      'accrue',
      'record_loss',
      'redeem senior',
      'redeem junior',
    ])
    expect(run.waterfall.mismatches).toEqual([])
    expect(run.sc001MaxMs).toBe(sc001Max(run.steps))
    expect(run.sc001MaxMs).toBeLessThanOrEqual(SC001_LIMIT_MS)
    expect(run.totalMs).toBeLessThanOrEqual(SC007_LIMIT_MS)
    expect(run.nav.seniorAfterAccrue).toBeGreaterThan(run.nav.seniorBefore)
    expect(run.nav.juniorAfterAccrue).toBeGreaterThan(run.nav.juniorBefore)
  })
})
