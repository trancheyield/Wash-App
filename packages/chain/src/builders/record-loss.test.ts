import { AccountRole, createNoopSigner } from '@solana/kit'
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system'
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { describe, expect, it } from 'vitest'
import {
  parseRecordLossInstruction,
  RECORD_LOSS_DISCRIMINATOR,
  WASHAPP_PROGRAM_ADDRESS,
} from '../generated/index.ts'
import { m0Address, m0Fixture } from '../testing/m0-fixture.ts'
import { buildRecordLoss } from './record-loss.ts'

describe('buildRecordLoss', () => {
  it('round-trips every field and points at the LossEvent PDA the program wrote', async () => {
    const operator = createNoopSigner(m0Fixture.operator)
    const ix = await buildRecordLoss({
      operator,
      poolId: m0Fixture.poolId,
      lossBps: m0Fixture.afterLoss.lossBps,
      index: 0,
    })

    const parsed = parseRecordLossInstruction(ix)
    expect(parsed.programAddress).toBe(WASHAPP_PROGRAM_ADDRESS)
    expect(parsed.data).toEqual({
      discriminator: RECORD_LOSS_DISCRIMINATOR,
      lossBps: m0Fixture.afterLoss.lossBps,
    })
    expect(parsed.accounts.config.address).toBe(m0Address('config'))
    expect(parsed.accounts.mint.address).toBe(m0Address('mint'))
    expect(parsed.accounts.treasury.address).toBe(m0Address('treasury'))
    expect(parsed.accounts.pool.address).toBe(m0Address('pool'))
    expect(parsed.accounts.vault.address).toBe(m0Address('vault'))
    expect(parsed.accounts.seniorMint.address).toBe(m0Address('seniorMint'))
    expect(parsed.accounts.juniorMint.address).toBe(m0Address('juniorMint'))
    // Адреса події — та, під якою її реально створила програма у SVM.
    expect(parsed.accounts.lossEvent.address).toBe(m0Fixture.afterLoss.accounts.lossEvent0.address)
    expect(parsed.accounts.lossEvent.role).toBe(AccountRole.WRITABLE)
    // Оператор платить за акаунт події — writable signer.
    expect(parsed.accounts.operator.address).toBe(m0Fixture.operator)
    expect(parsed.accounts.operator.role).toBe(AccountRole.WRITABLE_SIGNER)
    expect(parsed.accounts.tokenProgram.address).toBe(TOKEN_PROGRAM_ADDRESS)
    expect(parsed.accounts.systemProgram.address).toBe(SYSTEM_PROGRAM_ADDRESS)
  })

  it('derives a different event address for the next index', async () => {
    const operator = createNoopSigner(m0Fixture.operator)
    const common = { operator, poolId: m0Fixture.poolId, lossBps: 1 }
    const first = parseRecordLossInstruction(await buildRecordLoss({ ...common, index: 0 }))
    const second = parseRecordLossInstruction(await buildRecordLoss({ ...common, index: 1 }))
    expect(second.accounts.lossEvent.address).not.toBe(first.accounts.lossEvent.address)
    expect(second.data.lossBps).toBe(1)
  })
})
