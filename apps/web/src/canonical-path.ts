// GitHub Pages answers a deep link like `/pool/0/loss` with a 301 to `/pool/0/loss/`: the
// route copies the Pages workflow writes are directories. The routes and `NavLink end` match
// without the slash, so the app restores the canonical path before the router reads it.
export function canonicalPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}
