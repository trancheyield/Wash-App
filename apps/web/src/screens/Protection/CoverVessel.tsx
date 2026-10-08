import { formatAmount } from '@washapp/shared'
import { TOKEN } from '../../tokens.ts'

const INK = '#F2F4F1'
const GROUND = '#5C6B7A'

export type CoverVesselProps = {
  poolId: number
  collateral: bigint
  reserved: bigint
  compact: boolean
}

export type CoverLabels = {
  // The reservation leader: its horizontal run outside the vessel and its label's baseline.
  reservedLineY: number
  reservedLeaderY: number
  // Labels inside the vessel; `freeY` null when the free band is too thin for a line.
  reservedInsideY: number
  freeY: number | null
}

// With nearly all collateral reserved the dashed line climbs to the vessel's top, where the
// COLLATERAL leader and the FREE label already sit: the RESERVED leader then steps down
// below the COLLATERAL leader line (top + 10) before running out to its label, and FREE is
// left out of a band thinner than a line (its sum is in the table beside the drawing).
export function coverLabels(top: number, ry: number, fs: number): CoverLabels {
  const band = ry - top
  const line = band < 2 * fs + 6 ? Math.max(ry, top + 10) + fs + 8 : ry
  return {
    reservedLineY: line,
    reservedLeaderY: line - 4,
    reservedInsideY: ry + 16,
    freeY: band < fs + 14 ? null : top + 18,
  }
}

// Третя посудина — забезпечення продавців; пунктир ділить її на зарезервоване й вільне.
export function CoverVessel({ poolId, collateral, reserved, compact }: CoverVesselProps) {
  const [w, h] = compact ? [343, 260] : [820, 360]
  // Narrow: the vessel leaves the right ~170 units to the leader labels with four-digit sums.
  const [vx, vw, vh] = compact ? [30, 130, 160] : [300, 260, 220]
  const fs = compact ? 9 : 11
  const top = compact ? 40 : 60
  const ratio = collateral === 0n ? 0 : Number((reserved * 1000n) / collateral) / 1000
  const ry = top + Math.round(vh * (1 - ratio))
  const py = top + vh + (compact ? 30 : 40)
  const lx = w - 20
  const free = collateral - reserved
  const labels = coverLabels(top, ry, fs)
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${h}`}
      style={{ maxWidth: w, display: 'block' }}
      fontSize={fs}
      fill={INK}
      letterSpacing="0.08em"
      role="img"
      aria-label={`FIG. 3 — COVER, POOL ${poolId}`}
    >
      <text x="0" y={fs + 2}>
        FIG. 3 — COVER, POOL {poolId}
      </text>
      <rect x={vx} y={top} width={vw} height={vh} fill="none" stroke={INK} strokeWidth="1.5" />
      <rect
        x={vx + 1}
        y={top + 1}
        width={vw - 2}
        height={vh - 2}
        fill="#DCE3E8"
        fillOpacity=".45"
      />
      <line
        x1={vx}
        y1={ry}
        x2={vx + vw}
        y2={ry}
        stroke={INK}
        strokeDasharray="4 4"
        style={{ transition: 'y1 600ms linear, y2 600ms linear' }}
      />
      <text x={vx + 10} y={labels.reservedInsideY} fill={GROUND}>
        RESERVED {formatAmount(reserved)} {TOKEN}
      </text>
      {labels.freeY === null ? null : (
        <text x={vx + 10} y={labels.freeY} fill={GROUND}>
          FREE {formatAmount(free)} {TOKEN}
        </text>
      )}
      <text x={vx + 10} y={top + vh - 10} fill={GROUND}>
        COLLATERAL
      </text>
      <path
        d={`M 0 ${py} H ${vx + vw / 2} V ${top + vh}`}
        fill="none"
        stroke={INK}
        strokeWidth="1.5"
      />
      <text x="8" y={py - 6}>
        PAYOUT ← JUNIOR OUTLET
      </text>
      <line x1={vx + vw} y1={top + 10} x2={lx} y2={top + 10} stroke={INK} />
      <text x={lx} y={top + 6} textAnchor="end">
        COLLATERAL {formatAmount(collateral)} {TOKEN}
      </text>
      <path
        d={`M ${vx + vw} ${ry} H ${vx + vw + 16} V ${labels.reservedLineY} H ${lx}`}
        fill="none"
        stroke={INK}
      />
      <text x={lx} y={labels.reservedLeaderY} textAnchor="end">
        RESERVED {formatAmount(reserved)} {TOKEN}
      </text>
    </svg>
  )
}
