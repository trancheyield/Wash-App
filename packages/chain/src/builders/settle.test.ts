import { AccountRole } from '@solana/kit'
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { describe, expect, it } from 'vitest'
import {
  parseSettleProtectionInstruction,
  SETTLE_PROTECTION_DISCRIMINATOR,
  WASHAPP_PROGRAM_ADDRESS,
} from '../generated/index.ts'
import { m0Address } from '../testing/m0-fixture.ts'
import { protectionFixture, protectionFixtureAddress } from '../testing/protection-fixture.ts'
import { buildSettle } from './settle.ts'

describe('buildSettle', () => {
  it('points at the contract, the loss event and the buyer ATA the program settled', async () => {
    const ix = await buildSettle({
      poolId: protectionFixture.poolId,
      buyer: protectionFixture.buyer,
      nonce: 0n,
      lossIndex: 0,
    })

    const parsed = parseSettleProtectionInstruction(ix)
    expect(parsed.programAddress).toBe(WASHAPP_PROGRAM_ADDRESS)
    expect(parsed.data).toEqual({ discriminator: SETTLE_PROTECTION_DISCRIMINATOR })
    expect(parsed.accounts.pool.address).toBe(m0Address('pool'))
    expect(parsed.accounts.protection.address).toBe(protectionFixtureAddress('protection'))
    expect(parsed.accounts.pvault.address).toBe(protectionFixtureAddress('pvault'))
    expect(parsed.accounts.pvault.role).toBe(AccountRole.WRITABLE)
    expect(parsed.accounts.contract.address).toBe(protectionFixtureAddress('contract0'))
    expect(parsed.accounts.contract.role).toBe(AccountRole.WRITABLE)
    expect(parsed.accounts.lossEvent.address).toBe(protectionFixtureAddress('lossEvent0'))
    expect(parsed.accounts.lossEvent.role).toBe(AccountRole.READONLY)
    expect(parsed.accounts.buyerAta.address).toBe(protectionFixtureAddress('buyerBase'))
    expect(parsed.accounts.buyerAta.role).toBe(AccountRole.WRITABLE)
    expect(parsed.accounts.tokenProgram.address).toBe(TOKEN_PROGRAM_ADDRESS)
    // Anyone may settle: nothing in the instruction signs.
    expect(ix.accounts?.some((a) => a.role >= AccountRole.READONLY_SIGNER)).toBe(false)
  })
})
