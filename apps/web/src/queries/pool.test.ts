import { describe, expect, it } from 'vitest'
import { parsePoolId } from './pool.ts'

describe('parsePoolId', () => {
  it('accepts a u16 from the route', () => {
    expect(parsePoolId('0')).toBe(0)
    expect(parsePoolId('65535')).toBe(65_535)
  })

  it('rejects anything the program could not have as an id', () => {
    expect(parsePoolId(undefined)).toBeNull()
    expect(parsePoolId('')).toBeNull()
    expect(parsePoolId('-1')).toBeNull()
    expect(parsePoolId('65536')).toBeNull()
    expect(parsePoolId('1.5')).toBeNull()
    expect(parsePoolId('abc')).toBeNull()
  })
})
