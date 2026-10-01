import { describe, expect, it } from 'vitest'
import { canonicalPath } from './canonical-path.ts'

describe('canonicalPath', () => {
  it('drops the trailing slash Pages adds to a route directory', () => {
    expect(canonicalPath('/Wash-App/pool/0/loss/')).toBe('/Wash-App/pool/0/loss')
    expect(canonicalPath('/Wash-App/me//')).toBe('/Wash-App/me')
  })

  it('keeps paths without a trailing slash and the root', () => {
    expect(canonicalPath('/Wash-App/pool/0')).toBe('/Wash-App/pool/0')
    expect(canonicalPath('/')).toBe('/')
  })
})
