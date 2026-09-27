import { AccountRole, createNoopSigner } from '@solana/kit'
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  parseCreateAssociatedTokenIdempotentInstruction,
} from '@solana-program/token'
import { describe, expect, it } from 'vitest'
import {
  parseWithdrawProtectionInstruction,
  WASHAPP_PROGRAM_ADDRESS,
  WITHDRAW_PROTECTION_DISCRIMINATOR,
} from '../generated/index.ts'
import { m0Address } from '../testing/m0-fixture.ts'
import { protectionFixture, protectionFixtureAddress } from '../testing/protection-fixture.ts'
import { buildWithdraw } from './withdraw.ts'

describe('buildWithdraw', () => {
  it('returns idempotent base-ATA creation followed by the withdrawal of shares', async () => {
    const owner = createNoopSigner(protectionFixture.seller)
    const shares = 1_234_567n
    const [createAta, ix] = await buildWithdraw({
      owner,
      poolId: protectionFixture.poolId,
      shares,
    })

    const ata = parseCreateAssociatedTokenIdempotentInstruction(createAta)
    expect(ata.programAddress).toBe(ASSOCIATED_TOKEN_PROGRAM_ADDRESS)
    expect(ata.accounts.payer.address).toBe(protectionFixture.seller)
    expect(ata.accounts.ata.address).toBe(protectionFixtureAddress('sellerBase'))
    expect(ata.accounts.owner.address).toBe(protectionFixture.seller)
    expect(ata.accounts.mint.address).toBe(m0Address('mint'))

    const parsed = parseWithdrawProtectionInstruction(ix)
    expect(parsed.programAddress).toBe(WASHAPP_PROGRAM_ADDRESS)
    expect(parsed.data).toEqual({ discriminator: WITHDRAW_PROTECTION_DISCRIMINATOR, shares })
    expect(parsed.accounts.pool.address).toBe(m0Address('pool'))
    expect(parsed.accounts.protection.address).toBe(protectionFixtureAddress('protection'))
    expect(parsed.accounts.pvault.address).toBe(protectionFixtureAddress('pvault'))
    expect(parsed.accounts.pvault.role).toBe(AccountRole.WRITABLE)
    expect(parsed.accounts.ownerAta.address).toBe(protectionFixtureAddress('sellerBase'))
    expect(parsed.accounts.position.address).toBe(protectionFixtureAddress('sellerPosition'))
    expect(parsed.accounts.position.role).toBe(AccountRole.WRITABLE)
    expect(parsed.accounts.owner.address).toBe(protectionFixture.seller)
  })
})
