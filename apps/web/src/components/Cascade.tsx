import { formatAmount } from '@washapp/shared'
import { JUNIOR_TOKEN, type PoolState, SENIOR_TOKEN, TOKEN } from '../mock/data.ts'
import { formatBps, formatNav, juniorShareBps } from '../mock/forecast.ts'

const INK = '#F2F4F1'
const GROUND = '#5C6B7A'
const SEC = '#B9C2CB'

type Geometry = {
  w: number
  vx: number
  vw: number
  sh: number
  jh: number
  gap: number
  fs: number
  lx: number
  top: number
}

const DESKTOP: Geometry = {
  w: 820,
  vx: 100,
  vw: 520,
  sh: 300,
  jh: 100,
  gap: 30,
  fs: 11,
  lx: 814,
  top: 90,
}
const COMPACT: Geometry = {
  w: 343,
  vx: 60,
  vw: 160,
  sh: 170,
  jh: 57,
  gap: 22,
  fs: 9,
  lx: 343,
  top: 64,
}

export type CascadeProps = {
  pool: PoolState
  fig: string
  compact: boolean
  // Стан до збитку: рівень junior падає до `pool`, вище — штриховка й пунктир «BEFORE».
  before?: PoolState
  // Стан до депозиту: посудина senior росте разом з активами.
  baseline?: PoolState
  yieldRateBps: bigint
  seniorRateBps: bigint
  minJuniorBps: bigint
}

// Посудина senior росте чи меншає разом із прев'ю, але в межах ½…2 номіналу: нижче не
// вміщаються підписи всередині, вище — креслення виходить за екран. Порожній еталон
// (перший депозит у senior) — номінал: нема з чим порівнювати.
export const VESSEL_SCALE_MIN = 0.5
export const VESSEL_SCALE_MAX = 2

export function vesselScale(assets: bigint, reference: bigint): number {
  if (reference <= 0n) return 1
  const ratio = Number((assets * 1000n) / reference) / 1000
  return Math.min(VESSEL_SCALE_MAX, Math.max(VESSEL_SCALE_MIN, ratio))
}

// Рівень junior після збитку відносно стану до нього — частка 0…1; порожній junior до
// збитку лишає посудину порожньою, а не ділить на нуль.
export function juniorLevel(assets: bigint, before: bigint): number {
  if (before <= 0n) return 0
  return Math.min(1, Number((assets * 1000n) / before) / 1000)
}

type LeaderProps = { y: number; x1: number; x2: number; text: string; fs: number }

function Leader({ y, x1, x2, text, fs }: LeaderProps) {
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={INK} />
      <line x1={x1} y1={y - 3} x2={x1} y2={y + 3} stroke={INK} />
      <line x1={x2} y1={y - 3} x2={x2} y2={y + 3} stroke={INK} />
      <text x={x2} y={y - 4} textAnchor="end" fontSize={fs}>
        {text}
      </text>
    </g>
  )
}

export function Cascade({
  pool,
  fig,
  compact,
  before,
  baseline,
  yieldRateBps,
  seniorRateBps,
  minJuniorBps,
}: CascadeProps) {
  const g = compact ? COMPACT : DESKTOP
  const reference = baseline ?? pool
  const sh = Math.round(g.sh * vesselScale(pool.senior.assets, reference.senior.assets))
  const sy = g.top
  const jy = sy + sh + g.gap
  const cx = g.vx + g.vw / 2
  const bottom = jy + g.jh
  const h = bottom + (compact ? 84 : 110)
  const iy = g.top - (compact ? 30 : 42)
  const fx = g.vx - (compact ? 26 : 50)
  const tbY = sy + (compact ? 20 : 40)
  const [bw, bh] = compact ? [50, 20] : [84, 26]
  const oy = bottom + (compact ? 30 : 40)
  const vxv = g.vx + g.vw - (compact ? 30 : 40)
  const t = compact ? 7 : 9
  const level = before ? juniorLevel(pool.junior.assets, before.junior.assets) : 1
  const jl = Math.max(1, Math.round(g.jh * level))
  const step = compact ? Math.floor((sh - 12) / 3) : Math.floor((sh - 20) / 3)
  const floor = `JUNIOR FLOOR ${formatBps(minJuniorBps)} OF ASSETS · NOW ${formatBps(juniorShareBps(pool.senior.assets, pool.junior.assets))}`
  const seniorLabels = [
    `ASSETS ${formatAmount(pool.senior.assets)} ${TOKEN}`,
    `NAV ${formatNav(pool.senior.assets, pool.senior.supply)}`,
    `SUPPLY ${formatAmount(pool.senior.supply)} ${SENIOR_TOKEN}`,
  ]
  const js = compact ? 15 : Math.floor((g.jh - 12) / 3)

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${g.w} ${h}`}
      style={{ maxWidth: g.w, display: 'block' }}
      fontSize={g.fs}
      fill={INK}
      letterSpacing="0.08em"
      role="img"
      aria-label={fig}
    >
      <defs>
        <pattern
          id="hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="6" stroke={INK} strokeOpacity=".4" strokeWidth="1" />
        </pattern>
      </defs>
      <text x="0" y={g.fs + 2}>
        {fig}
      </text>
      <path d={`M 0 ${iy} H ${cx} V ${sy}`} fill="none" stroke={INK} strokeWidth="1.5" />
      <text x={cx + 8} y={iy - 6}>
        YIELD {formatBps(yieldRateBps)}/yr
      </text>
      <path d={`M ${fx} ${iy} V ${tbY}`} fill="none" stroke={INK} />
      <text x={fx + 5} y={iy + 16} fill={SEC}>
        FEE 10 %
      </text>
      <rect x={fx - bw / 2} y={tbY} width={bw} height={bh} fill="none" stroke={INK} />
      <text x={fx} y={tbY + bh - 7} textAnchor="middle">
        TREASURY
      </text>

      <rect x={g.vx} y={sy} width={g.vw} height={sh} fill="none" stroke={INK} strokeWidth="1.5" />
      <rect
        x={g.vx + 1}
        y={sy + 1}
        width={g.vw - 2}
        height={sh - 2}
        fill="#DCE3E8"
        fillOpacity=".85"
      />
      <line
        x1={g.vx + 8}
        y1={sy + (compact ? 26 : 44)}
        x2={g.vx + g.vw - 8}
        y2={sy + (compact ? 26 : 44)}
        stroke={GROUND}
        strokeDasharray="6 4"
        strokeOpacity=".8"
      />
      <text x={g.vx + 12} y={sy + (compact ? 23 : 40)} fill={GROUND}>
        RATED {formatBps(seniorRateBps)}/yr
      </text>
      <text x={g.vx + 12} y={sy + sh - 10} fill={GROUND}>
        SENIOR
      </text>

      <rect x={g.vx} y={jy} width={g.vw} height={g.jh} fill="none" stroke={INK} strokeWidth="1.5" />
      <rect
        x={g.vx + 1}
        y={jy + g.jh - jl}
        width={g.vw - 2}
        height={jl - 1}
        fill="#DCE3E8"
        fillOpacity=".45"
        style={{ transition: 'y 600ms linear, height 600ms linear' }}
      />
      {before ? (
        <>
          <rect x={g.vx + 1} y={jy} width={g.vw - 2} height={g.jh - jl} fill="url(#hatch)" />
          <line x1={g.vx} y1={jy} x2={g.vx + g.vw} y2={jy} stroke={INK} strokeDasharray="4 4" />
        </>
      ) : null}
      <text x={g.vx + 12} y={jy + g.jh - 8} fill={GROUND}>
        JUNIOR
      </text>
      <rect x={cx - 6} y={sy + sh} width="12" height={g.gap} fill="none" stroke={INK} />

      <path d={`M ${cx} ${bottom} V ${oy} H ${g.w}`} fill="none" stroke={INK} strokeWidth="1.5" />
      <path
        d={`M ${vxv - t} ${oy - t} L ${vxv + t} ${oy + t} L ${vxv + t} ${oy - t} L ${vxv - t} ${oy + t} Z`}
        fill={GROUND}
        stroke={INK}
      />
      <text x={cx + 8} y={oy - 6}>
        LOSS
      </text>
      <text x={g.vx} y={oy + (compact ? 24 : 32)} fill={SEC}>
        {floor}
      </text>

      {seniorLabels.map((text, i) => (
        <Leader
          key={text}
          y={sy + 18 + i * step}
          x1={g.vx + g.vw}
          x2={g.lx}
          text={text}
          fs={g.fs}
        />
      ))}
      {before ? (
        <>
          <Leader
            y={sy + sh - 16}
            x1={g.vx + g.vw}
            x2={g.lx}
            text={`UNCHANGED ${formatAmount(pool.senior.assets)} ${TOKEN}`}
            fs={g.fs}
          />
          <Leader
            y={jy}
            x1={g.vx + g.vw}
            x2={g.lx}
            text={`BEFORE ${formatAmount(before.junior.assets)} ${TOKEN}`}
            fs={g.fs}
          />
          <Leader
            y={jy + g.jh - 30}
            x1={g.vx + g.vw}
            x2={g.lx}
            text={`ASSETS ${formatAmount(pool.junior.assets)} ${TOKEN}`}
            fs={g.fs}
          />
          <Leader
            y={jy + g.jh - 6}
            x1={g.vx + g.vw}
            x2={g.lx}
            text={`NAV ${formatNav(pool.junior.assets, pool.junior.supply)}`}
            fs={g.fs}
          />
        </>
      ) : (
        [
          `ASSETS ${formatAmount(pool.junior.assets)} ${TOKEN}`,
          `NAV ${formatNav(pool.junior.assets, pool.junior.supply)}`,
          `SUPPLY ${formatAmount(pool.junior.supply)} ${JUNIOR_TOKEN}`,
        ].map((text, i) => (
          <Leader
            key={text}
            y={jy + 14 + i * js}
            x1={g.vx + g.vw}
            x2={g.lx}
            text={text}
            fs={g.fs}
          />
        ))
      )}
    </svg>
  )
}
