import { AccountRole, createNoopSigner } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import {
  PROVIDE_PROTECTION_DISCRIMINATOR,
  parseProvideProtectionInstruction,
  WASHAPP_PROGRAM_ADDRESS,
} from '../generated/index.ts'
import { m0Address } from '../testing/m0-fixture.ts'
import { protectionFixture, protectionFixtureAddress } from '../testing/protection-fixture.ts'
import { buildProvide } from './provide.ts'

describe('buildProvide', () => {
  it('round-trips the amount and points at the seller position the program created', async () => {
    const owner = createNoopSigner(protectionFixture.seller)
    const amount = 5_000_000_000n
    const ix = await buildProvide({ owner, poolId: protectionFixture.poolId, amount })

    const parsed = parseProvideProtectionInstruction(ix)
    expect(parsed.programAddress).toBe(WASHAPP_PROGRAM_ADDRESS)
    expect(parsed.data).toEqual({ discriminator: PROVIDE_PROTECTION_DISCRIMINATOR, amount })
    expect(parsed.accounts.pool.address).toBe(m0Address('pool'))
    expect(parsed.accounts.protection.address).toBe(protectionFixtureAddress('protection'))
    expect(parsed.accounts.protection.role).toBe(AccountRole.WRITABLE)
    expect(parsed.accounts.pvault.address).toBe(protectionFixtureAddress('pvault'))
    expect(parsed.accounts.ownerAta.address).toBe(protectionFixtureAddress('sellerBase'))
    expect(parsed.accounts.ownerAta.role).toBe(AccountRole.WRITABLE)
    expect(parsed.accounts.position.address).toBe(protectionFixtureAddress('sellerPosition'))
    expect(parsed.accounts.position.role).toBe(AccountRole.WRITABLE)
    // `init_if_needed`: the seller pays rent for the position on the first provide.
    expect(parsed.accounts.owner.address).toBe(protectionFixture.seller)
    expect(parsed.accounts.owner.role).toBe(AccountRole.WRITABLE_SIGNER)
  })
})
