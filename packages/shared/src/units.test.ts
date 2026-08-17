import { describe, expect, it } from 'vitest'
import { amountSchema, formatAmount, parseAmount } from './units.ts'

describe('parseAmount', () => {
  it('reads whole, fractional and grouped text into micro-units', () => {
    expect(parseAmount('1')).toBe(1_000_000n)
    expect(parseAmount('0.5')).toBe(500_000n)
    expect(parseAmount('1,234.567891')).toBe(1_234_567_891n)
    expect(parseAmount(' 7.1 ')).toBe(7_100_000n)
  })

  it('rejects more than six decimals, signs, exponents and values above u64', () => {
    expect(parseAmount('1.1234567')).toBeNull()
    expect(parseAmount('-1')).toBeNull()
    expect(parseAmount('1e6')).toBeNull()
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('18446744073709.551616')).toBeNull()
    expect(parseAmount('18446744073709.551615')).toBe(2n ** 64n - 1n)
  })
})

describe('formatAmount', () => {
  it('prints two decimals with thousands separators by default', () => {
    expect(formatAmount(1_234_567_891n)).toBe('1,234.56')
    expect(formatAmount(0n)).toBe('0.00')
    expect(formatAmount(999_999n)).toBe('0.99')
  })

  it('round-trips through parseAmount at full precision', () => {
    const value = 98_765_432_109n
    expect(parseAmount(formatAmount(value, 6))).toBe(value)
  })
})

describe('amountSchema', () => {
  it('parses positive text and refuses zero', () => {
    expect(amountSchema.parse('2.25')).toBe(2_250_000n)
    expect(amountSchema.safeParse('0').success).toBe(false)
    expect(amountSchema.safeParse('abc').success).toBe(false)
  })
})
