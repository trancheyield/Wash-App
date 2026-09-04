import { isSignerRole, isWritableRole } from '@solana/kit'
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { describe, expect, it } from 'vitest'
import {
  ACCRUE_DISCRIMINATOR,
  parseAccrueInstruction,
  WASHAPP_PROGRAM_ADDRESS,
} from '../generated/index.ts'
import { m0Address, m0Fixture } from '../testing/m0-fixture.ts'
import { buildAccrue } from './accrue.ts'

describe('buildAccrue', () => {
  it('resolves all seven pool accounts from the id and needs no signer', async () => {
    const ix = await buildAccrue({ poolId: m0Fixture.poolId })
    const parsed = parseAccrueInstruction(ix)

    expect(parsed.programAddress).toBe(WASHAPP_PROGRAM_ADDRESS)
    expect(parsed.data).toEqual({ discriminator: ACCRUE_DISCRIMINATOR })
    expect(parsed.accounts.config.address).toBe(m0Address('config'))
    expect(parsed.accounts.mint.address).toBe(m0Address('mint'))
    expect(parsed.accounts.treasury.address).toBe(m0Address('treasury'))
    expect(parsed.accounts.pool.address).toBe(m0Address('pool'))
    expect(parsed.accounts.vault.address).toBe(m0Address('vault'))
    expect(parsed.accounts.seniorMint.address).toBe(m0Address('seniorMint'))
    expect(parsed.accounts.juniorMint.address).toBe(m0Address('juniorMint'))
    expect(parsed.accounts.tokenProgram.address).toBe(TOKEN_PROGRAM_ADDRESS)

    // Crank без підписанта: карбування у vault і treasury — під підписом Config (PDA).
    expect(ix.accounts.some((meta) => isSignerRole(meta.role))).toBe(false)
    // Дохід карбується у vault, комісія — у treasury, облік — у Pool: усі writable.
    for (const name of ['mint', 'treasury', 'pool', 'vault'] as const) {
      expect(isWritableRole(parsed.accounts[name].role), name).toBe(true)
    }
  })
})
