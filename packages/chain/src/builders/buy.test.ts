import { AccountRole, createNoopSigner } from '@solana/kit'
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system'
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { describe, expect, it } from 'vitest'
import {
  BUY_PROTECTION_DISCRIMINATOR,
  parseBuyProtectionInstruction,
  WASHAPP_PROGRAM_ADDRESS,
} from '../generated/index.ts'
import { m0Address } from '../testing/m0-fixture.ts'
import { protectionFixture, protectionFixtureAddress } from '../testing/protection-fixture.ts'
import { buildBuy } from './buy.ts'

describe('buildBuy', () => {
  it('round-trips every field and points at the contract PDA the program created', async () => {
    const buyer = createNoopSigner(protectionFixture.buyer)
    const term = BigInt(protectionFixture.term)
    const ix = await buildBuy({
      buyer,
      poolId: protectionFixture.poolId,
      notional: 1_000_000_000n,
      term,
      nonce: 0n,
    })

    const parsed = parseBuyProtectionInstruction(ix)
    expect(parsed.programAddress).toBe(WASHAPP_PROGRAM_ADDRESS)
    expect(parsed.data).toEqual({
      discriminator: BUY_PROTECTION_DISCRIMINATOR,
      notional: 1_000_000_000n,
      term,
      nonce: 0n,
    })
    expect(parsed.accounts.config.address).toBe(m0Address('config'))
    expect(parsed.accounts.mint.address).toBe(m0Address('mint'))
    expect(parsed.accounts.treasury.address).toBe(m0Address('treasury'))
    expect(parsed.accounts.pool.address).toBe(m0Address('pool'))
    expect(parsed.accounts.vault.address).toBe(m0Address('vault'))
    expect(parsed.accounts.seniorMint.address).toBe(m0Address('seniorMint'))
    expect(parsed.accounts.juniorMint.address).toBe(m0Address('juniorMint'))
    expect(parsed.accounts.protection.address).toBe(protectionFixtureAddress('protection'))
    expect(parsed.accounts.pvault.address).toBe(protectionFixtureAddress('pvault'))
    expect(parsed.accounts.buyerAta.address).toBe(protectionFixtureAddress('buyerBase'))
    expect(parsed.accounts.buyerAta.role).toBe(AccountRole.WRITABLE)
    expect(parsed.accounts.contract.address).toBe(protectionFixtureAddress('contract0'))
    expect(parsed.accounts.contract.role).toBe(AccountRole.WRITABLE)
    // The buyer pays the premium and the rent of the contract.
    expect(parsed.accounts.buyer.address).toBe(protectionFixture.buyer)
    expect(parsed.accounts.buyer.role).toBe(AccountRole.WRITABLE_SIGNER)
    expect(parsed.accounts.tokenProgram.address).toBe(TOKEN_PROGRAM_ADDRESS)
    expect(parsed.accounts.systemProgram.address).toBe(SYSTEM_PROGRAM_ADDRESS)
  })

  it('keys the contract by buyer and nonce', async () => {
    const common = { poolId: protectionFixture.poolId, notional: 1n, term: 1n }
    const second = parseBuyProtectionInstruction(
      await buildBuy({ ...common, buyer: createNoopSigner(protectionFixture.buyer), nonce: 1n }),
    )
    expect(second.accounts.contract.address).toBe(protectionFixtureAddress('contract1'))
    expect(second.data.nonce).toBe(1n)
    const seller = parseBuyProtectionInstruction(
      await buildBuy({ ...common, buyer: createNoopSigner(protectionFixture.seller), nonce: 2n }),
    )
    expect(seller.accounts.contract.address).toBe(protectionFixtureAddress('contract2'))
    expect(seller.accounts.buyerAta.address).toBe(protectionFixtureAddress('sellerBase'))
  })
})
