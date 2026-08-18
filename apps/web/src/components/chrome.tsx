import { type ReactNode, useSyncExternalStore } from 'react'
import { NavLink } from 'react-router'
import { useMockWallet } from '../mock/wallet.tsx'

const LINKS: Array<[string, string]> = [
  ['/pool/0', 'POOL 0'],
  ['/pool/0/deposit', 'DEPOSIT'],
  ['/pool/0/loss', 'LOSS EVENTS'],
  ['/pool/0/protection', 'PROTECTION'],
  ['/me', 'POSITION'],
]

export function Nav() {
  const { address, toggle } = useMockWallet()
  return (
    <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
      <nav className="flex flex-wrap text-lbl uppercase text-sec">
        {LINKS.map(([to, label], i) => (
          <span key={to} className="flex">
            <NavLink
              to={to}
              end
              className={({ isActive }) =>
                `px-1.5 ${isActive ? 'text-ink underline underline-offset-4' : 'text-sec hover:text-ink'}`
              }
            >
              {label}
            </NavLink>
            {i < LINKS.length - 1 ? <span className="px-1.5">·</span> : null}
          </span>
        ))}
      </nav>
      <div className="text-[12px]">
        {address ?? <span className="text-sec">no wallet</span>}{' '}
        <button type="button" className="lbl hover:text-ink" onClick={toggle}>
          {address ? 'disconnect' : 'connect'}
        </button>
      </div>
    </div>
  )
}

export type TitleBlockProps = { title: string; sheet: number; modelDay: number }

export function TitleBlock({ title, sheet, modelDay }: TitleBlockProps) {
  const cell = 'border border-ink px-3 py-1.5 text-lbl uppercase'
  return (
    <div className="mt-10 grid w-full grid-cols-2 border border-ink bg-ground xl:absolute xl:bottom-7 xl:right-10 xl:mt-0 xl:w-auto xl:grid-cols-3">
      <div className="col-span-full border border-ink px-3 py-2 font-cond text-[22px]">{title}</div>
      <div className={cell}>SHEET {sheet} OF 5</div>
      <div className={cell}>POOL 0 · WUSD</div>
      <div className={cell}>MODEL DAY {modelDay}</div>
      <div className={cell}>SCALE 1 MIN : 30 DAYS</div>
      <div className={cell}>REV A</div>
      <div className={cell}>WASH APP</div>
    </div>
  )
}

export function Sheet({ children }: { children: ReactNode }) {
  return (
    <div className="sheet relative min-h-screen px-4 pb-8 pt-5 xl:px-10 xl:pb-[190px] xl:pt-7">
      {children}
    </div>
  )
}

// Дві колонки на 1280 (креслення 820 + робоча зона), одна — вужче.
export function Columns({ drawing, children }: { drawing: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:gap-12">
      <div className="xl:w-[820px] xl:flex-none">{drawing}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-[22px]">{children}</div>
    </div>
  )
}

export function Pairs({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div>
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="flex items-baseline justify-between gap-3 border-b border-hair py-[5px]"
        >
          <span className="lbl">{k}</span>
          <span className="whitespace-nowrap text-right">{v}</span>
        </div>
      ))}
    </div>
  )
}

export type FieldProps = {
  label: string
  unit: string
  value: string
  onChange: (value: string) => void
}

export function Field({ label, unit, value, onChange }: FieldProps) {
  const id = `field-${label.toLowerCase().replace(/[^a-z]/g, '')}`
  return (
    <div className="flex items-baseline gap-2.5 border-b border-ink py-1.5">
      <label htmlFor={id} className="lbl">
        {label}
      </label>
      <input
        id={id}
        className="min-w-0 flex-1 bg-transparent text-right text-[18px] text-ink outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
      />
      <span className="lbl">{unit}</span>
    </div>
  )
}

export type BtnProps = {
  label: string
  primary?: boolean
  disabled?: boolean
  onClick?: () => void
}

export function Btn({ label, primary, disabled, onClick }: BtnProps) {
  return (
    <button
      type="button"
      className={`btn ${primary ? 'btn-primary' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export function Refused({ children }: { children: ReactNode }) {
  return <div className="text-[12px] leading-[1.5] text-refused">{children}</div>
}

const COMPACT_QUERY = '(max-width: 900px)'

function subscribeCompact(onChange: () => void) {
  const media = window.matchMedia(COMPACT_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function useCompact(): boolean {
  return useSyncExternalStore(
    subscribeCompact,
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  )
}
