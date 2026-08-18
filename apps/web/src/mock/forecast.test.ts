import { describe, expect, it } from 'vitest'
import { contract0, poolAfterAccrual, protectionParams } from './data.ts'
import {
  applyLoss,
  formatBps,
  formatNav,
  juniorShareBps,
  payout,
  premium,
  sharesForDeposit,
} from './forecast.ts'

// Очікувані числа — з брифу M0, пораховані незалежно (python, цілочисельно).
describe('forecast (mock waterfall)', () => {
  it('splits a 15 % loss onto junior only', () => {
    const split = applyLoss(poolAfterAccrual, 1_500n)
    expect(split.loss).toBe(15_088_767_123n)
    expect(split.juniorLoss).toBe(15_088_767_123n)
    expect(split.seniorLoss).toBe(0n)
  })

  it('pushes the excess of a 40 % loss onto senior once junior is empty', () => {
    const split = applyLoss(poolAfterAccrual, 4_000n)
    expect(split.juniorLoss).toBe(poolAfterAccrual.junior.assets)
    expect(split.seniorLoss).toBe(split.loss - poolAfterAccrual.junior.assets)
    expect(poolAfterAccrual.senior.assets - split.seniorLoss).toBe(60_355_068_494n)
  })

  it('prices shares at the current NAV', () => {
    const { assets, supply } = poolAfterAccrual.senior
    expect(sharesForDeposit(2_500_000_000n, assets, supply)).toBe(2_489_768_076n)
    expect(formatNav(assets, supply)).toBe('1.004110')
    expect(formatNav(poolAfterAccrual.junior.assets, poolAfterAccrual.junior.supply)).toBe(
      '1.011342',
    )
  })

  it('keeps the junior floor arithmetic in bps', () => {
    const { senior, junior } = poolAfterAccrual
    expect(formatBps(juniorShareBps(senior.assets, junior.assets))).toBe('25.13 %')
    expect(formatBps(juniorShareBps(senior.assets + 25_000_000_000n, junior.assets))).toBe(
      '20.13 %',
    )
    expect(formatBps(juniorShareBps(senior.assets + 26_000_000_000n, junior.assets))).toBe(
      '19.97 %',
    )
  })

  it('prices cover and pays out above the trigger only', () => {
    expect(premium(contract0.notional, protectionParams.premiumRateBps, 90n)).toBe(98_630_136n)
    expect(payout(contract0.notional, 1_500n, protectionParams.triggerBps)).toBe(3_000_000_000n)
    expect(payout(contract0.notional, 50n, protectionParams.triggerBps)).toBe(0n)
  })
})
