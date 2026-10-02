import { describe, expect, it } from 'vitest'
import { canonicalPath } from './canonical-path.ts'

describe('canonicalPath', () => {
  it('drops the trailing slash Pages adds to a route directory', () => {
    expect(canonicalPath('/Wash-App/app/pool/0/loss/', '/Wash-App/app/')).toBe(
      '/Wash-App/app/pool/0/loss',
    )
    expect(canonicalPath('/Wash-App/app/me//', '/Wash-App/app/')).toBe('/Wash-App/app/me')
    expect(canonicalPath('/Wash-App/app/', '/Wash-App/app/')).toBe('/Wash-App/app')
  })

  it('keeps paths without a trailing slash and the root', () => {
    expect(canonicalPath('/Wash-App/app/pool/0', '/Wash-App/app/')).toBe('/Wash-App/app/pool/0')
    expect(canonicalPath('/')).toBe('/')
    expect(canonicalPath('/pool/0/')).toBe('/pool/0')
  })

  it('moves a link from before the app moved under app/ below the base', () => {
    expect(canonicalPath('/Wash-App/pool/0/loss/', '/Wash-App/app/')).toBe(
      '/Wash-App/app/pool/0/loss',
    )
    expect(canonicalPath('/Wash-App/me', '/Wash-App/app/')).toBe('/Wash-App/app/me')
  })

  it('does the same on a custom domain, where the app sits at /app/', () => {
    expect(canonicalPath('/pool/0', '/app/')).toBe('/app/pool/0')
    expect(canonicalPath('/', '/app/')).toBe('/app')
    expect(canonicalPath('/app/pool/0/', '/app/')).toBe('/app/pool/0')
  })

  it('leaves a path outside the site alone', () => {
    expect(canonicalPath('/Other/pool/0', '/Wash-App/app/')).toBe('/Other/pool/0')
  })
})
