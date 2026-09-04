import { AccountRole, createNoopSigner } from '@solana/kit'
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  parseCreateAssociatedTokenIdempotentInstruction,
} from '@solana-program/token'
import { describe, expect, it } from 'vitest'
import {
  parseRedeemInstruction,
  REDEEM_DISCRIMINATOR,
  Tranche,
  WASHAPP_PROGRAM_ADDRESS,
} from '../generated/index.ts'
import { m0Address, m0Fixture } from '../testing/m0-fixture.ts'
import { buildDeposit } from './deposit.ts'
import { buildRedeem } from './redeem.ts'

describe('buildRedeem', () => {
  it('returns idempotent base-ATA creation followed by the redeem', async () => {
    const owner = createNoopSigner(m0Fixture.owner)
    const shares = 37_500_000_000n

    const [createAta, ix] = await buildRedeem({
      owner,
      poolId: m0Fixture.poolId,
      tranche: Tranche.Senior,
      shares,
    })

    // Погашення виплачує базовий токен — тому створюється саме його ATA.
    const ata = parseCreateAssociatedTokenIdempotentInstruction(createAta)
    expect(ata.programAddress).toBe(ASSOCIATED_TOKEN_PROGRAM_ADDRESS)
    expect(ata.accounts.payer.address).toBe(m0Fixture.owner)
    expect(ata.accounts.payer.role).toBe(AccountRole.WRITABLE_SIGNER)
    expect(ata.accounts.ata.address).toBe(m0Address('ownerBase'))
    expect(ata.accounts.owner.address).toBe(m0Fixture.owner)
    expect(ata.accounts.mint.address).toBe(m0Address('mint'))

    const parsed = parseRedeemInstruction(ix)
    expect(parsed.programAddress).toBe(WASHAPP_PROGRAM_ADDRESS)
    expect(parsed.data).toEqual({
      discriminator: REDEEM_DISCRIMINATOR,
      tranche: Tranche.Senior,
      shares,
    })
    expect(parsed.accounts.config.address).toBe(m0Address('config'))
    expect(parsed.accounts.mint.address).toBe(m0Address('mint'))
    expect(parsed.accounts.treasury.address).toBe(m0Address('treasury'))
    expect(parsed.accounts.pool.address).toBe(m0Address('pool'))
    expect(parsed.accounts.vault.address).toBe(m0Address('vault'))
    expect(parsed.accounts.seniorMint.address).toBe(m0Address('seniorMint'))
    expect(parsed.accounts.juniorMint.address).toBe(m0Address('juniorMint'))
    expect(parsed.accounts.ownerAta.address).toBe(m0Address('ownerBase'))
    expect(parsed.accounts.ownerTrancheAta.address).toBe(m0Address('ownerSenior'))
    expect(parsed.accounts.owner.address).toBe(m0Fixture.owner)
    expect(parsed.accounts.owner.role).toBe(AccountRole.READONLY_SIGNER)
  })

  it('burns from the junior ATA for the junior tranche', async () => {
    const owner = createNoopSigner(m0Fixture.owner)
    const [, ix] = await buildRedeem({
      owner,
      poolId: m0Fixture.poolId,
      tranche: Tranche.Junior,
      shares: 1n,
    })
    const parsed = parseRedeemInstruction(ix)
    expect(parsed.data.tranche).toBe(Tranche.Junior)
    expect(parsed.data.shares).toBe(1n)
    expect(parsed.accounts.ownerTrancheAta.address).toBe(m0Address('ownerJunior'))
  })

  it('shares the account layout with deposit — only the discriminator differs', async () => {
    const owner = createNoopSigner(m0Fixture.owner)
    const common = { owner, poolId: m0Fixture.poolId, tranche: Tranche.Senior }
    const [, redeem] = await buildRedeem({ ...common, shares: 7n })
    const [, deposit] = await buildDeposit({ ...common, amount: 7n })
    expect(redeem.accounts).toEqual(deposit.accounts)
    expect(redeem.data.slice(8)).toEqual(deposit.data.slice(8))
    expect(redeem.data.slice(0, 8)).not.toEqual(deposit.data.slice(0, 8))
  })
})
