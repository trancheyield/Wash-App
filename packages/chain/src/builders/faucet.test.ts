import { AccountRole, createNoopSigner } from '@solana/kit'
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system'
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { describe, expect, it } from 'vitest'
import {
  FAUCET_DISCRIMINATOR,
  parseFaucetInstruction,
  WASHAPP_PROGRAM_ADDRESS,
} from '../generated/index.ts'
import { m0Address, m0Fixture } from '../testing/m0-fixture.ts'
import { buildFaucet } from './faucet.ts'

describe('buildFaucet', () => {
  it('round-trips amount and resolves the owner ATA of the demo mint', async () => {
    const owner = createNoopSigner(m0Fixture.owner)
    const amount = 100_000_000_000n

    const parsed = parseFaucetInstruction(await buildFaucet({ owner, amount }))

    expect(parsed.programAddress).toBe(WASHAPP_PROGRAM_ADDRESS)
    expect(parsed.data).toEqual({ discriminator: FAUCET_DISCRIMINATOR, amount })
    expect(parsed.accounts.config.address).toBe(m0Address('config'))
    expect(parsed.accounts.mint.address).toBe(m0Address('mint'))
    // ATA виводить згенерований код (seeds ATA-програми) — звірено з адресою із SVM.
    expect(parsed.accounts.ownerAta.address).toBe(m0Address('ownerBase'))
    expect(parsed.accounts.owner.address).toBe(m0Fixture.owner)
    // Owner платить за `init_if_needed` ATA.
    expect(parsed.accounts.owner.role).toBe(AccountRole.WRITABLE_SIGNER)
    expect(parsed.accounts.tokenProgram.address).toBe(TOKEN_PROGRAM_ADDRESS)
    expect(parsed.accounts.associatedTokenProgram.address).toBe(ASSOCIATED_TOKEN_PROGRAM_ADDRESS)
    expect(parsed.accounts.systemProgram.address).toBe(SYSTEM_PROGRAM_ADDRESS)
  })
})
