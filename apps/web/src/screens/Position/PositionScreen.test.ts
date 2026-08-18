import { describe, expect, it } from 'vitest'
import { forecastRows } from './PositionScreen.tsx'

// Рядки повзунка з брифу M0 (0 / 15 / 40 / 100 %).
describe('forecastRows', () => {
  it('matches the brief at 15 %', () => {
    const rows = forecastRows(1_500n)
    expect(rows.map((r) => r.after)).toEqual([
      10_041_095_890n,
      2_038_958_904n,
      3_000_000_000n,
      27_088_767_123n,
    ])
    expect(rows.reduce((s, r) => s + r.now, 0n)).toBe(45_186_575_341n)
  })

  it('leaves senior untouched until junior is empty', () => {
    expect(forecastRows(0n).map((r) => r.after)).toEqual([
      10_041_095_890n,
      5_056_712_328n,
      0n,
      30_088_767_123n,
    ])
    const forty = forecastRows(4_000n)
    expect(forty[0]?.after).toBe(8_047_342_465n)
    expect(forty[1]?.after).toBe(0n)
  })

  it('wipes both tranches at 100 % and pays the full notional', () => {
    expect(forecastRows(10_000n).map((r) => r.after)).toEqual([
      0n,
      0n,
      20_000_000_000n,
      10_088_767_123n,
    ])
  })
})
