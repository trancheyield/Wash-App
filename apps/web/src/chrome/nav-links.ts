import { parsePoolId } from '../queries/pool.ts'

// The menu follows the pool in the address: a pool opened by link (a fresh pool, say) keeps
// its own sheets instead of sending every click back to the configured one. Pages outside a
// pool (`/me`) fall back to `defaultPool`. `pathname` is the router's, without the basename.
export function navLinks(pathname: string, defaultPool: number): Array<[string, string]> {
  const pool = parsePoolId(/^\/pool\/([^/]+)/.exec(pathname)?.[1]) ?? defaultPool
  const base = `/pool/${pool}`
  return [
    [base, `POOL ${pool}`],
    [`${base}/deposit`, 'DEPOSIT'],
    [`${base}/loss`, 'LOSS EVENTS'],
    [`${base}/protection`, 'PROTECTION'],
    ['/me', 'POSITION'],
  ]
}
