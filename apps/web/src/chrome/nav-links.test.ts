import { describe, expect, it } from 'vitest'
import { navLinks } from './nav-links.ts'

describe('navLinks', () => {
  it('follows the pool in the address', () => {
    expect(navLinks('/pool/52/protection', 0)).toEqual([
      ['/pool/52', 'POOL 52'],
      ['/pool/52/deposit', 'DEPOSIT'],
      ['/pool/52/loss', 'LOSS EVENTS'],
      ['/pool/52/protection', 'PROTECTION'],
      ['/me', 'POSITION'],
    ])
    expect(navLinks('/pool/7', 0)[0]).toEqual(['/pool/7', 'POOL 7'])
  })

  it('falls back to the configured pool outside a pool or on a bad id', () => {
    expect(navLinks('/me', 3)[0]).toEqual(['/pool/3', 'POOL 3'])
    expect(navLinks('/pool/abc/loss', 3)[2]).toEqual(['/pool/3/loss', 'LOSS EVENTS'])
    expect(navLinks('/pool/65536', 3)[0]).toEqual(['/pool/3', 'POOL 3'])
  })
})
