import { isAddress } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { configAddress } from './pda.ts'

describe('configAddress', () => {
  it('derives a stable, valid program address', async () => {
    const first = await configAddress()
    const second = await configAddress()
    expect(isAddress(first)).toBe(true)
    expect(first).toBe(second)
  })
})
