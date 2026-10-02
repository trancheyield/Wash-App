// GitHub Pages answers a deep link like `/pool/0/loss` with a 301 to `/pool/0/loss/`: the
// route copies the Pages workflow writes are directories. The routes and `NavLink end` match
// without the slash, so the app restores the canonical path before the router reads it.
//
// The app used to sit at the site root and now lives under `app/`, below the landing page.
// A link from before the move (`/Wash-App/pool/0`) reaches the app through the site's
// 404.html; it is moved under the base so the router, whose basename is the base, matches it.
export function canonicalPath(pathname: string, base = '/'): string {
  const trimmed = pathname.replace(/\/+$/, '')
  const path = trimmed === '' ? '/' : trimmed
  const appRoot = base.replace(/\/+$/, '')
  if (appRoot === '' || path === appRoot || path.startsWith(`${appRoot}/`)) return path
  const siteRoot = appRoot.slice(0, appRoot.lastIndexOf('/'))
  if (path !== siteRoot && !path.startsWith(`${siteRoot}/`)) return path
  const rest = path.slice(siteRoot.length)
  return rest === '/' ? appRoot : appRoot + rest
}
