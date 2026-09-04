import { AccountRole, createNoopSigner } from '@solana/kit'
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  parseCreateAssociatedTokenIdempotentInstruction,
} from '@solana-program/token'
import { describe, expect, it } from 'vitest'
import {
  DEPOSIT_DISCRIMINATOR,
  parseDepositInstruction,
  Tranche,
  WASHAPP_PROGRAM_ADDRESS,
} from '../generated/index.ts'
import { m0Address, m0Fixture } from '../testing/m0-fixture.ts'
import { buildDeposit } from './deposit.ts'

describe('buildDeposit', () => {
  it('returns idempotent tranche-ATA creation followed by the deposit', async () => {
    const owner = createNoopSigner(m0Fixture.owner)
    const amount = 75_000_000_000n

    const [createAta, ix] = await buildDeposit({
      owner,
      poolId: m0Fixture.poolId,
      tranche: Tranche.Senior,
      amount,
    })

    const ata = parseCreateAssociatedTokenIdempotentInstruction(createAta)
    expect(ata.programAddress).toBe(ASSOCIATED_TOKEN_PROGRAM_ADDRESS)
    expect(ata.accounts.payer.address).toBe(m0Fixture.owner)
    expect(ata.accounts.payer.role).toBe(AccountRole.WRITABLE_SIGNER)
    expect(ata.accounts.ata.address).toBe(m0Address('ownerSenior'))
    expect(ata.accounts.owner.address).toBe(m0Fixture.owner)
    expect(ata.accounts.mint.address).toBe(m0Address('seniorMint'))

    const parsed = parseDepositInstruction(ix)
    expect(parsed.programAddress).toBe(WASHAPP_PROGRAM_ADDRESS)
    expect(parsed.data).toEqual({
      discriminator: DEPOSIT_DISCRIMINATOR,
      tranche: Tranche.Senior,
      amount,
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
    // Депозит нічого не створює — owner лише підписує переказ.
    expect(parsed.accounts.owner.role).toBe(AccountRole.READONLY_SIGNER)
  })

  it('targets the junior mint and ATA for the junior tranche', async () => {
    const owner = createNoopSigner(m0Fixture.owner)
    const [createAta, ix] = await buildDeposit({
      owner,
      poolId: m0Fixture.poolId,
      tranche: Tranche.Junior,
      amount: 25_000_000_000n,
    })
    const ata = parseCreateAssociatedTokenIdempotentInstruction(createAta)
    expect(ata.accounts.ata.address).toBe(m0Address('ownerJunior'))
    expect(ata.accounts.mint.address).toBe(m0Address('juniorMint'))

    const parsed = parseDepositInstruction(ix)
    expect(parsed.data.tranche).toBe(Tranche.Junior)
    expect(parsed.data.amount).toBe(25_000_000_000n)
    expect(parsed.accounts.ownerTrancheAta.address).toBe(m0Address('ownerJunior'))
    // Обидва мінти траншів у списку завжди — програма обирає потрібний сама.
    expect(parsed.accounts.seniorMint.address).toBe(m0Address('seniorMint'))
    expect(parsed.accounts.juniorMint.address).toBe(m0Address('juniorMint'))
  })
})
