import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  accrue,
  afterAccrual,
  afterLoss,
  amountForRedeem,
  applyLoss,
  lossAmount,
  sharesForDeposit,
  subordinationOk,
  WaterfallError,
} from './waterfall.ts'

// Фікстуру пише Rust (`wsl-build.sh fixtures`); тут — лише читання і звірка.
// Усі u64 у файлі — рядками, бо `u64::MAX` не вміщається в JSON-число.
const u64 = z
  .string()
  .regex(/^\d+$/)
  .transform((s) => BigInt(s))
const bps = z.number().int().min(0).max(65_535)
const errorName = z.enum(['TrancheWipedOut', 'ParameterOutOfRange', 'Overflow'])

const poolSchema = z.object({
  assets: u64,
  seniorAssets: u64,
  juniorAssets: u64,
  seniorSupply: u64,
  juniorSupply: u64,
})

const fixtureSchema = z.object({
  accrue: z.array(
    z.object({
      pool: poolSchema,
      rates: z.object({ yieldBps: bps, seniorBps: bps, feeBps: bps }),
      dtModel: u64,
      accrual: z.object({ yieldAmount: u64, fee: u64, seniorGain: u64, juniorGain: u64 }),
      after: poolSchema,
    }),
  ),
  deposit: z.array(
    z.object({
      amount: u64,
      trancheAssets: u64,
      supply: u64,
      shares: u64.optional(),
      error: errorName.optional(),
    }),
  ),
  redeem: z.array(
    z.object({
      shares: u64,
      trancheAssets: u64,
      supply: u64,
      amount: u64.optional(),
      error: errorName.optional(),
    }),
  ),
  subordination: z.array(
    z.object({ seniorAfter: u64, juniorAfter: u64, minBps: bps, ok: z.boolean() }),
  ),
  loss: z.array(
    z.object({
      pool: poolSchema,
      lossBps: bps,
      loss: u64,
      juniorLoss: u64.optional(),
      seniorLoss: u64.optional(),
      after: poolSchema.optional(),
      error: errorName.optional(),
    }),
  ),
})

const fixture = fixtureSchema.parse(
  JSON.parse(readFileSync(new URL('../../../fixtures/waterfall.json', import.meta.url), 'utf8')),
)

function errorCode(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    if (e instanceof WaterfallError) return e.code
    throw e
  }
  return 'ok'
}

describe('fixtures/waterfall.json', () => {
  it('has every section populated', () => {
    expect(fixture.accrue.length).toBeGreaterThanOrEqual(30)
    expect(fixture.deposit.length).toBeGreaterThanOrEqual(20)
    expect(fixture.redeem.length).toBeGreaterThanOrEqual(20)
    expect(fixture.subordination.length).toBeGreaterThanOrEqual(20)
    expect(fixture.loss.length).toBeGreaterThanOrEqual(20)
  })

  it('accrue matches math.rs on every case, including the state after', () => {
    for (const c of fixture.accrue) {
      const accrual = accrue(c.pool, c.rates, c.dtModel)
      expect(accrual).toEqual(c.accrual)
      expect(afterAccrual(c.pool, accrual)).toEqual(c.after)
    }
  })

  it('accrue keeps assets == senior + junior', () => {
    for (const c of fixture.accrue) {
      expect(c.after.assets).toBe(c.after.seniorAssets + c.after.juniorAssets)
    }
  })

  it('sharesForDeposit matches math.rs, errors by the same name', () => {
    for (const c of fixture.deposit) {
      if (c.error) {
        expect(errorCode(() => sharesForDeposit(c.amount, c.trancheAssets, c.supply))).toBe(c.error)
      } else {
        expect(sharesForDeposit(c.amount, c.trancheAssets, c.supply)).toBe(c.shares)
      }
    }
  })

  it('amountForRedeem matches math.rs, errors by the same name', () => {
    for (const c of fixture.redeem) {
      if (c.error) {
        expect(errorCode(() => amountForRedeem(c.shares, c.trancheAssets, c.supply))).toBe(c.error)
      } else {
        expect(amountForRedeem(c.shares, c.trancheAssets, c.supply)).toBe(c.amount)
      }
    }
  })

  it('subordinationOk matches math.rs on both sides of the threshold', () => {
    for (const c of fixture.subordination) {
      expect(subordinationOk(c.seniorAfter, c.juniorAfter, c.minBps)).toBe(c.ok)
    }
    expect(fixture.subordination.some((c) => !c.ok)).toBe(true)
  })

  it('loss waterfall matches math.rs: junior first, senior only for the excess', () => {
    for (const c of fixture.loss) {
      expect(lossAmount(c.pool.assets, c.lossBps)).toBe(c.loss)
      if (c.error) {
        expect(errorCode(() => applyLoss(c.loss, c.pool.seniorAssets, c.pool.juniorAssets))).toBe(
          c.error,
        )
        continue
      }
      const split = applyLoss(c.loss, c.pool.seniorAssets, c.pool.juniorAssets)
      expect(split).toEqual({ juniorLoss: c.juniorLoss, seniorLoss: c.seniorLoss })
      expect(afterLoss(c.pool, split)).toEqual(c.after)
      if (c.loss <= c.pool.juniorAssets) expect(c.after?.seniorAssets).toBe(c.pool.seniorAssets)
    }
  })
})

describe('waterfall on the M0 brief', () => {
  const demo = {
    assets: 100_000_000_000n,
    seniorAssets: 75_000_000_000n,
    juniorAssets: 25_000_000_000n,
    seniorSupply: 75_000_000_000n,
    juniorSupply: 25_000_000_000n,
  }
  const rates = { yieldBps: 800, seniorBps: 500, feeBps: 1000 }

  it('30 model days give the golden numbers', () => {
    const after = afterAccrual(demo, accrue(demo, rates, 30n * 86_400n))
    expect(after.seniorAssets).toBe(75_308_219_178n)
    expect(after.juniorAssets).toBe(25_283_561_644n)
  })

  it('u64 overflow is an error, not a silent wrap', () => {
    expect(errorCode(() => sharesForDeposit(2n ** 64n - 1n, 1n, 2n ** 64n - 1n))).toBe('Overflow')
  })
})
