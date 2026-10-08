import { describe, expect, it } from 'vitest'
import { coverLabels } from './CoverVessel.tsx'

// Wide drawing: vessel top 60, height 220, font 11; the COLLATERAL leader's text baseline is
// top + 6 and its line top + 10.
const TOP = 60
const FS = 11

describe('coverLabels', () => {
  it('keeps the usual places while the free band is wide', () => {
    expect(coverLabels(TOP, TOP + 110, FS)).toEqual({
      reservedLineY: TOP + 110,
      reservedLeaderY: TOP + 106,
      reservedInsideY: TOP + 126,
      freeY: TOP + 18,
    })
  })

  it('steps the RESERVED leader below the COLLATERAL one near the top', () => {
    // 1,000 reserved of 1,008.88: the line sits about 2 units below the top.
    const near = coverLabels(TOP, TOP + 2, FS)
    expect(near.reservedLineY).toBe(TOP + 10 + FS + 8)
    expect(near.reservedLeaderY).toBe(near.reservedLineY - 4)
    // The label's cap line clears the COLLATERAL leader line at top + 10.
    expect(near.reservedLeaderY - FS).toBeGreaterThan(TOP + 10)
  })

  it('leaves FREE out of a band too thin to hold it apart from RESERVED', () => {
    for (const band of [0, 2, FS + 13]) {
      expect(coverLabels(TOP, TOP + band, FS).freeY).toBeNull()
    }
    const room = coverLabels(TOP, TOP + FS + 14, FS)
    expect(room.freeY).toBe(TOP + 18)
    expect(room.reservedInsideY - FS - (room.freeY ?? 0)).toBeGreaterThanOrEqual(6)
  })
})
