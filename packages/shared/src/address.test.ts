import { describe, expect, it } from 'vitest'
import { addressSchema } from './address.ts'

const PROGRAM_ID = '8tX3MJt6vzw9fw7gAeBdEtom5cfXR8BMZn9UCPQJrj6z'
const SYSTEM_PROGRAM = '11111111111111111111111111111111'

describe('addressSchema', () => {
  it('accepts base58 addresses of 32 bytes', () => {
    expect(addressSchema.parse(PROGRAM_ID)).toBe(PROGRAM_ID)
    expect(addressSchema.parse(SYSTEM_PROGRAM)).toBe(SYSTEM_PROGRAM)
  })

  it('rejects strings that decode to a different byte length', () => {
    expect(addressSchema.safeParse('z'.repeat(44)).success).toBe(false)
    expect(addressSchema.safeParse('1111').success).toBe(false)
  })

  it('rejects non-base58 characters and non-strings', () => {
    expect(addressSchema.safeParse(`0OIl${PROGRAM_ID.slice(4)}`).success).toBe(false)
    expect(addressSchema.safeParse('').success).toBe(false)
    expect(addressSchema.safeParse(null).success).toBe(false)
  })
})
