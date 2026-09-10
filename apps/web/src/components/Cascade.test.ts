import { describe, expect, it } from 'vitest'
import { juniorLevel, VESSEL_SCALE_MAX, VESSEL_SCALE_MIN, vesselScale } from './Cascade.tsx'

const WUSD = 1_000_000n

describe('vesselScale', () => {
  it('scales the senior vessel with the preview and never divides by zero', () => {
    expect(vesselScale(0n, 0n)).toBe(1)
    expect(vesselScale(2_000n * WUSD, 0n)).toBe(1)
    expect(vesselScale(2_500n * WUSD, 2_000n * WUSD)).toBe(1.25)
    expect(vesselScale(1_500n * WUSD, 2_000n * WUSD)).toBe(0.75)
  })

  it('keeps the drawing legible and on screen', () => {
    expect(vesselScale(0n, 2_000n * WUSD)).toBe(VESSEL_SCALE_MIN)
    expect(vesselScale(1n, 2_000n * WUSD)).toBe(VESSEL_SCALE_MIN)
    expect(vesselScale(20_000n * WUSD, 2_000n * WUSD)).toBe(VESSEL_SCALE_MAX)
    expect(Number.isFinite(vesselScale(10n ** 30n, 1n))).toBe(true)
  })
})

describe('juniorLevel', () => {
  it('is the share left after a loss, and empty when nothing was there', () => {
    expect(juniorLevel(500n * WUSD, 1_000n * WUSD)).toBe(0.5)
    expect(juniorLevel(0n, 1_000n * WUSD)).toBe(0)
    expect(juniorLevel(1_000n * WUSD, 1_000n * WUSD)).toBe(1)
    expect(juniorLevel(0n, 0n)).toBe(0)
  })
})
