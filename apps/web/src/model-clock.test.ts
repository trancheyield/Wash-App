import { describe, expect, it } from 'vitest'
import { describeScale, formatScale, modelDay, projectedModelTime } from './model-clock.ts'

const demo = {
  modelTime: 30n * 86_400n,
  lastAccruedTs: 1_789_566_473n,
  params: { timeScale: 43_200 },
}

describe('projectedModelTime', () => {
  it('stands still at the accrual timestamp', () => {
    expect(projectedModelTime(demo, demo.lastAccruedTs)).toBe(demo.modelTime)
  })

  it('advances time_scale model seconds per wall second', () => {
    // 60 wall seconds × 43 200 = 30 model days on top of the 30 already accrued.
    expect(modelDay(projectedModelTime(demo, demo.lastAccruedTs + 60n))).toBe(60)
    expect(modelDay(projectedModelTime(demo, demo.lastAccruedTs + 1n))).toBe(30)
    expect(modelDay(projectedModelTime(demo, demo.lastAccruedTs + 2n))).toBe(31)
  })

  it('never runs backwards when the local clock lags the chain', () => {
    expect(projectedModelTime(demo, demo.lastAccruedTs - 100n)).toBe(demo.modelTime)
  })

  it('is exact at unscaled time', () => {
    const real = { ...demo, params: { timeScale: 1 } }
    expect(projectedModelTime(real, demo.lastAccruedTs + 7n)).toBe(demo.modelTime + 7n)
  })
})

describe('formatScale', () => {
  it('reads the demo scale as one minute to thirty days', () => {
    expect(formatScale(43_200)).toBe('SCALE 1 MIN : 30 DAYS')
    expect(describeScale(43_200)).toBe('clock 1 min : 30 days')
  })

  it('handles singular, hours and plain multipliers', () => {
    expect(formatScale(1_440)).toBe('SCALE 1 MIN : 1 DAY')
    expect(formatScale(60)).toBe('SCALE 1 MIN : 1 HOUR')
    expect(formatScale(720)).toBe('SCALE 1 MIN : 12 HOURS')
    expect(formatScale(1)).toBe('SCALE 1 : 1')
    expect(formatScale(1_000)).toBe('SCALE 1,000×')
  })
})
