import { AccountRole, createNoopSigner } from '@solana/kit'
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system'
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { describe, expect, it } from 'vitest'
import {
  INIT_PROTECTION_DISCRIMINATOR,
  parseInitProtectionInstruction,
  WASHAPP_PROGRAM_ADDRESS,
} from '../generated/index.ts'
import { m0Address } from '../testing/m0-fixture.ts'
import { protectionFixture, protectionFixtureAddress } from '../testing/protection-fixture.ts'
import { buildInitProtection } from './init-protection.ts'

describe('buildInitProtection', () => {
  it('round-trips the parameters and points at the protection PDAs the program created', async () => {
    const operator = createNoopSigner(protectionFixture.operator)
    const ix = await buildInitProtection({
      operator,
      poolId: protectionFixture.poolId,
      premiumRateBps: 200,
      triggerBps: 100,
      premiumFeeBps: 1_000,
    })

    const parsed = parseInitProtectionInstruction(ix)
    expect(parsed.programAddress).toBe(WASHAPP_PROGRAM_ADDRESS)
    expect(parsed.data).toEqual({
      discriminator: INIT_PROTECTION_DISCRIMINATOR,
      premiumRateBps: 200,
      triggerBps: 100,
      premiumFeeBps: 1_000,
    })
    expect(parsed.accounts.pool.address).toBe(m0Address('pool'))
    expect(parsed.accounts.mint.address).toBe(m0Address('mint'))
    expect(parsed.accounts.protection.address).toBe(protectionFixtureAddress('protection'))
    expect(parsed.accounts.protection.role).toBe(AccountRole.WRITABLE)
    expect(parsed.accounts.pvault.address).toBe(protectionFixtureAddress('pvault'))
    expect(parsed.accounts.pvault.role).toBe(AccountRole.WRITABLE)
    // The operator pays rent for both new accounts.
    expect(parsed.accounts.operator.address).toBe(protectionFixture.operator)
    expect(parsed.accounts.operator.role).toBe(AccountRole.WRITABLE_SIGNER)
    expect(parsed.accounts.tokenProgram.address).toBe(TOKEN_PROGRAM_ADDRESS)
    expect(parsed.accounts.systemProgram.address).toBe(SYSTEM_PROGRAM_ADDRESS)
  })
})
