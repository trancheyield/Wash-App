import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  accrue,
  afterAccrual,
  afterLoss,
  afterSettle,
  amountForRedeem,
  applyLoss,
  type ContractTerms,
  collateralForShares,
  lossAmount,
  payout,
  premium,
  premiumFee,
  settleContract,
  sharesForCollateral,
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
const ratesSchema = z.object({ yieldBps: bps, seniorBps: bps, feeBps: bps })
const protectionSchema = z.object({ collateral: u64, reserved: u64 })
const settleError = z.enum([
  'ContractNotActive',
  'LossOutsideTerm',
  'LossBelowTrigger',
  'ZeroAmount',
])

// One scenario is a pool state, a loss and the contracts on it, run on the SVM through
// the real `record_loss` and `settle_protection`; the pool is taken before the loss's
// own accrual, so the mirror replays that accrual too.
const scenarioSchema = z.object({
  pool: poolSchema,
  rates: ratesSchema,
  dtModel: u64,
  lossBps: bps,
  event: z.object({
    index: z.number().int().min(0),
    modelTime: u64,
    amount: u64,
    juniorLoss: u64,
    seniorLoss: u64,
  }),
  after: poolSchema,
  protection: protectionSchema,
  contracts: z.array(
    z.object({
      notional: u64,
      triggerBps: bps,
      lossIndexFrom: z.number().int().min(0),
      expiryModelTime: u64,
    }),
  ),
  settlements: z.array(
    z.object({
      contract: z.number().int().min(0),
      payout: u64.optional(),
      error: settleError.optional(),
    }),
  ),
  protectionAfter: protectionSchema,
})

const fixtureSchema = z.object({
  accrue: z.array(
    z.object({
      pool: poolSchema,
      rates: ratesSchema,
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
  scenarios: z.array(scenarioSchema),
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
    expect(fixture.scenarios.length).toBeGreaterThanOrEqual(50)
  })

  // SC-006: the forecast is the mirror, the fact is what the program wrote. Exact
  // equality is stricter than the one-unit tolerance the criterion allows.
  it('the real record_loss and settle_protection agree with the mirror on every scenario', () => {
    for (const c of fixture.scenarios) {
      const accrued = afterAccrual(c.pool, accrue(c.pool, c.rates, c.dtModel))
      const loss = lossAmount(accrued.assets, c.lossBps)
      expect(loss).toBe(c.event.amount)
      const split = applyLoss(loss, accrued.seniorAssets, accrued.juniorAssets)
      expect(split).toEqual({ juniorLoss: c.event.juniorLoss, seniorLoss: c.event.seniorLoss })
      expect(afterLoss(accrued, split)).toEqual(c.after)

      const event = { index: c.event.index, modelTime: c.event.modelTime, lossBps: c.lossBps }
      const active = c.contracts.map(() => true)
      let protection = c.protection
      for (const step of c.settlements) {
        const terms = c.contracts[step.contract]
        if (!terms) throw new Error(`no contract #${step.contract} in the scenario`)
        const contract: ContractTerms = { ...terms, active: active[step.contract] === true }
        if (step.error) {
          expect(errorCode(() => settleContract(contract, event))).toBe(step.error)
          continue
        }
        const paid = settleContract(contract, event)
        expect(paid).toBe(step.payout)
        protection = afterSettle(protection, contract.notional, paid)
        active[step.contract] = false
      }
      expect(protection).toEqual(c.protectionAfter)
    }
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

// The golden numbers of the protection tests in `math.rs`, one to one; the premiums the
// program really wrote are checked against `premium` in `packages/chain` on the SVM fixture.
describe('protection math mirrors math.rs', () => {
  const DAY = 86_400n

  it('seller shares go 1:1 first and by value after', () => {
    expect(sharesForCollateral(1_000n, 0n, 0n)).toBe(1_000n)
    expect(sharesForCollateral(1_100n, 1_100n, 1_000n)).toBe(1_000n)
    expect(collateralForShares(1_000n, 2_200n, 2_000n)).toBe(1_100n)
    expect(collateralForShares(0n, 0n, 0n)).toBe(0n)
    expect(sharesForCollateral(5n, 10n, 1n)).toBe(0n)
    expect(errorCode(() => collateralForShares(2n, 10n, 1n))).toBe('ParameterOutOfRange')
  })

  it('collateral paid out to zero refuses provide and withdraw', () => {
    expect(errorCode(() => sharesForCollateral(1_000n, 0n, 1_000n))).toBe('CollateralWipedOut')
    expect(errorCode(() => collateralForShares(1_000n, 0n, 1_000n))).toBe('CollateralWipedOut')
  })

  it('premium and fee on the demo protection params', () => {
    const notional = 10_000_000_000n
    const p = premium(notional, 200, 30n * DAY)
    expect(p).toBe(16_438_356n)
    expect(premiumFee(p, 1_000)).toBe(1_643_835n)
    expect(premium(notional, 200, 365n * DAY)).toBe(200_000_000n)
    expect(premium(notional, 0, 30n * DAY)).toBe(0n)
    expect(premium(notional, 200, 0n)).toBe(0n)
    expect(premium(1_000n, 200, 60n)).toBe(0n)
    expect(premiumFee(16_438_356n, 0)).toBe(0n)
  })

  it('payout is the loss share of the notional', () => {
    const notional = 1_000_000_000n
    expect(payout(notional, 1_500)).toBe(150_000_000n)
    expect(payout(notional, 10_000)).toBe(notional)
    expect(payout(notional, 0)).toBe(0n)
    expect(payout(6n, 1_500)).toBe(0n)
    expect(errorCode(() => payout(notional, 10_001))).toBe('ParameterOutOfRange')
  })
})

// The demo contract of `tests/settle.rs`: 1,000 tokens for 30 model days, trigger 1 %.
describe('settleContract mirrors settle_protection', () => {
  const contract: ContractTerms = {
    active: true,
    notional: 1_000_000_000n,
    triggerBps: 100,
    lossIndexFrom: 0,
    expiryModelTime: 5_184_000n,
  }
  const event = { index: 0, modelTime: 2_592_000n, lossBps: 1_500 }

  it('pays the loss share of the notional and frees the whole reserve', () => {
    const paid = settleContract(contract, event)
    expect(paid).toBe(150_000_000n)
    const protection = { collateral: 5_001_479_452n, reserved: 1_000_000_000n }
    expect(afterSettle(protection, contract.notional, paid)).toEqual({
      collateral: 4_851_479_452n,
      reserved: 0n,
    })
  })

  it('takes both ends of the term and the trigger inclusively', () => {
    expect(settleContract(contract, { ...event, modelTime: contract.expiryModelTime })).toBe(
      150_000_000n,
    )
    expect(settleContract(contract, { ...event, lossBps: 100 })).toBe(10_000_000n)
    expect(settleContract(contract, { ...event, lossBps: 10_000 })).toBe(contract.notional)
  })

  it('refuses in the order the program checks', () => {
    const closed = { ...contract, active: false }
    expect(errorCode(() => settleContract(closed, { ...event, lossBps: 0 }))).toBe(
      'ContractNotActive',
    )
    expect(errorCode(() => settleContract({ ...contract, lossIndexFrom: 1 }, event))).toBe(
      'LossOutsideTerm',
    )
    expect(
      errorCode(() => settleContract(contract, { ...event, modelTime: 5_184_001n, lossBps: 0 })),
    ).toBe('LossOutsideTerm')
    expect(errorCode(() => settleContract(contract, { ...event, lossBps: 50 }))).toBe(
      'LossBelowTrigger',
    )
    expect(errorCode(() => settleContract({ ...contract, notional: 6n }, event))).toBe('ZeroAmount')
  })

  it('a reserve smaller than the notional is an overflow, not a negative balance', () => {
    expect(errorCode(() => afterSettle({ collateral: 10n, reserved: 5n }, 6n, 1n))).toBe('Overflow')
  })
})
