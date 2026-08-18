import { formatAmount } from '@washapp/shared'
import { TOKEN } from '../../mock/data.ts'

const INK = '#F2F4F1'
const GROUND = '#5C6B7A'

export type CoverVesselProps = { collateral: bigint; reserved: bigint; compact: boolean }

// Третя посудина — забезпечення продавців; пунктир ділить її на зарезервоване й вільне.
export function CoverVessel({ collateral, reserved, compact }: CoverVesselProps) {
  const [w, h] = compact ? [343, 260] : [820, 360]
  const [vx, vw, vh] = compact ? [40, 180, 160] : [300, 260, 220]
  const fs = compact ? 9 : 11
  const top = compact ? 40 : 60
  const ratio = collateral === 0n ? 0 : Number((reserved * 1000n) / collateral) / 1000
  const ry = top + Math.round(vh * (1 - ratio))
  const py = top + vh + (compact ? 30 : 40)
  const lx = w - 20
  const free = collateral - reserved
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${h}`}
      style={{ maxWidth: w, display: 'block' }}
      fontSize={fs}
      fill={INK}
      letterSpacing="0.08em"
      role="img"
      aria-label="FIG. 3 — COVER, POOL 0"
    >
      <text x="0" y={fs + 2}>
        FIG. 3 — COVER, POOL 0
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
      <text x={vx + 10} y={ry + 16} fill={GROUND}>
        RESERVED {formatAmount(reserved)} {TOKEN}
      </text>
      <text x={vx + 10} y={top + 18} fill={GROUND}>
        FREE {formatAmount(free)} {TOKEN}
      </text>
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
      <line x1={vx + vw} y1={ry} x2={lx} y2={ry} stroke={INK} />
      <text x={lx} y={ry - 4} textAnchor="end">
        RESERVED {formatAmount(reserved)} {TOKEN}
      </text>
    </svg>
  )
}
