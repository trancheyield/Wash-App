import { AccountRole, createNoopSigner } from '@solana/kit'
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { describe, expect, it } from 'vitest'
import {
  EXPIRE_PROTECTION_DISCRIMINATOR,
  parseExpireProtectionInstruction,
  WASHAPP_PROGRAM_ADDRESS,
} from '../generated/index.ts'
import { m0Address } from '../testing/m0-fixture.ts'
import { protectionFixture, protectionFixtureAddress } from '../testing/protection-fixture.ts'
import { buildExpire } from './expire.ts'

describe('buildExpire', () => {
  it('points at the contract and runs accrue over the pool accounts', async () => {
    const ix = await buildExpire({
      signer: createNoopSigner(protectionFixture.buyer),
      poolId: protectionFixture.poolId,
      buyer: protectionFixture.buyer,
      nonce: 1n,
    })

    const parsed = parseExpireProtectionInstruction(ix)
    expect(parsed.programAddress).toBe(WASHAPP_PROGRAM_ADDRESS)
    expect(parsed.data).toEqual({ discriminator: EXPIRE_PROTECTION_DISCRIMINATOR })
    expect(parsed.accounts.config.address).toBe(m0Address('config'))
    expect(parsed.accounts.mint.address).toBe(m0Address('mint'))
    expect(parsed.accounts.treasury.address).toBe(m0Address('treasury'))
    expect(parsed.accounts.pool.address).toBe(m0Address('pool'))
    expect(parsed.accounts.vault.address).toBe(m0Address('vault'))
    expect(parsed.accounts.seniorMint.address).toBe(m0Address('seniorMint'))
    expect(parsed.accounts.juniorMint.address).toBe(m0Address('juniorMint'))
    expect(parsed.accounts.protection.address).toBe(protectionFixtureAddress('protection'))
    expect(parsed.accounts.contract.address).toBe(protectionFixtureAddress('contract1'))
    expect(parsed.accounts.contract.role).toBe(AccountRole.WRITABLE)
    expect(parsed.accounts.signer.address).toBe(protectionFixture.buyer)
    expect(parsed.accounts.tokenProgram.address).toBe(TOKEN_PROGRAM_ADDRESS)
  })

  it('lets the operator sign for a contract of another buyer', async () => {
    const parsed = parseExpireProtectionInstruction(
      await buildExpire({
        signer: createNoopSigner(protectionFixture.operator),
        poolId: protectionFixture.poolId,
        buyer: protectionFixture.seller,
        nonce: 2n,
      }),
    )
    expect(parsed.accounts.signer.address).toBe(protectionFixture.operator)
    expect(parsed.accounts.contract.address).toBe(protectionFixtureAddress('contract2'))
  })
})
