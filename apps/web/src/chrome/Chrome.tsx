import { NavLink } from 'react-router'
import { useAppConfig } from '../providers.tsx'
import { WalletRow } from './Wallet.tsx'

// Навігація веде до пулу з конфігу; `:id` у маршрутах лишається для інших пулів.
export function Nav() {
  const { defaultPool } = useAppConfig()
  const base = `/pool/${defaultPool}`
  const links: Array<[string, string]> = [
    [base, `POOL ${defaultPool}`],
    [`${base}/deposit`, 'DEPOSIT'],
    [`${base}/loss`, 'LOSS EVENTS'],
    [`${base}/protection`, 'PROTECTION'],
    ['/me', 'POSITION'],
  ]
  return (
    <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
      <nav className="flex flex-wrap text-lbl uppercase text-sec">
        {links.map(([to, label], i) => (
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
            {i < links.length - 1 ? <span className="px-1.5">·</span> : null}
          </span>
        ))}
      </nav>
      <WalletRow />
    </div>
  )
}
