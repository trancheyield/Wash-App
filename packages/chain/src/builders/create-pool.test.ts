import { readFileSync } from 'node:fs'
import { AccountRole, createNoopSigner } from '@solana/kit'
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system'
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CREATE_POOL_DISCRIMINATOR,
  parseCreatePoolInstruction,
  WASHAPP_PROGRAM_ADDRESS,
} from '../generated/index.ts'
import { m0Address, m0Fixture } from '../testing/m0-fixture.ts'
import { buildCreatePool } from './create-pool.ts'

// Демо-параметри пулу 0 — з того самого файлу, що й `tools/demo init` і бриф M0;
// п'ять різних чисел — переплутані поля не пройдуть непоміченими.
const paramsSchema = z.object({
  pool_id: z.number().int(),
  yield_rate_bps: z.number().int(),
  senior_rate_bps: z.number().int(),
  min_junior_bps: z.number().int(),
  perf_fee_bps: z.number().int(),
  time_scale: z.number().int(),
})

const demo = paramsSchema.parse(
  JSON.parse(readFileSync(new URL('../../../../fixtures/params.json', import.meta.url), 'utf8')),
)

describe('buildCreatePool', () => {
  it('round-trips every pool parameter and resolves pool, vault and tranche mints', async () => {
    const operator = createNoopSigner(m0Fixture.operator)
    const params = {
      yieldRateBps: demo.yield_rate_bps,
      seniorRateBps: demo.senior_rate_bps,
      minJuniorBps: demo.min_junior_bps,
      perfFeeBps: demo.perf_fee_bps,
      timeScale: demo.time_scale,
    }
    expect(new Set(Object.values(params)).size).toBe(5)

    const parsed = parseCreatePoolInstruction(
      await buildCreatePool({ operator, id: demo.pool_id, params }),
    )

    expect(parsed.programAddress).toBe(WASHAPP_PROGRAM_ADDRESS)
    expect(parsed.data).toEqual({
      discriminator: CREATE_POOL_DISCRIMINATOR,
      id: demo.pool_id,
      ...params,
    })
    expect(demo.pool_id).toBe(m0Fixture.poolId)
    expect(parsed.accounts.config.address).toBe(m0Address('config'))
    expect(parsed.accounts.mint.address).toBe(m0Address('mint'))
    // PDA виводить згенерований код (`findPoolPda` тощо) — звірено з адресами із SVM.
    expect(parsed.accounts.pool.address).toBe(m0Address('pool'))
    expect(parsed.accounts.vault.address).toBe(m0Address('vault'))
    expect(parsed.accounts.seniorMint.address).toBe(m0Address('seniorMint'))
    expect(parsed.accounts.juniorMint.address).toBe(m0Address('juniorMint'))
    expect(parsed.accounts.operator.address).toBe(m0Fixture.operator)
    expect(parsed.accounts.operator.role).toBe(AccountRole.WRITABLE_SIGNER)
    expect(parsed.accounts.tokenProgram.address).toBe(TOKEN_PROGRAM_ADDRESS)
    expect(parsed.accounts.systemProgram.address).toBe(SYSTEM_PROGRAM_ADDRESS)
  })

  it('derives a different pool for a neighbouring id', async () => {
    const operator = createNoopSigner(m0Fixture.operator)
    const params = {
      yieldRateBps: 1,
      seniorRateBps: 2,
      minJuniorBps: 3,
      perfFeeBps: 4,
      timeScale: 5,
    }
    const parsed = parseCreatePoolInstruction(
      await buildCreatePool({ operator, id: m0Fixture.poolId + 1, params }),
    )
    expect(parsed.data.id).toBe(m0Fixture.poolId + 1)
    expect(parsed.accounts.pool.address).not.toBe(m0Address('pool'))
    expect(parsed.accounts.vault.address).not.toBe(m0Address('vault'))
  })
})
