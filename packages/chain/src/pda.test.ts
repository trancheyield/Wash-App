import { readFileSync } from 'node:fs'
import { addressSchema } from '@washapp/shared'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  configAddress,
  contractAddress,
  juniorMintAddress,
  lossEventAddress,
  mintAddress,
  poolAddress,
  protectionAddress,
  pvaultAddress,
  sellerAddress,
  seniorMintAddress,
  treasuryAddress,
  vaultAddress,
} from './pda.ts'
import { WASHAPP_PROGRAM_ADDRESS } from './program.ts'

// Фікстуру пише Rust (`wsl-build.sh fixtures`); тут — лише читання і звірка.
const entrySchema = z.object({ address: addressSchema, bump: z.number().int().min(0).max(255) })
const poolIdSchema = z.number().int().min(0).max(65_535)

const fixtureSchema = z.object({
  program: addressSchema,
  config: entrySchema,
  mint: entrySchema,
  treasury: entrySchema,
  pools: z.array(
    z.object({
      id: poolIdSchema,
      pool: entrySchema,
      vault: entrySchema,
      seniorMint: entrySchema,
      juniorMint: entrySchema,
      protection: entrySchema,
      pvault: entrySchema,
    }),
  ),
  lossEvents: z.array(
    z.object({ poolId: poolIdSchema, index: z.number().int().min(0), pda: entrySchema }),
  ),
  sellers: z.array(z.object({ poolId: poolIdSchema, owner: addressSchema, pda: entrySchema })),
  contracts: z.array(
    z.object({
      poolId: poolIdSchema,
      buyer: addressSchema,
      nonce: z.string().regex(/^\d+$/).transform(BigInt),
      pda: entrySchema,
    }),
  ),
})

const fixture = fixtureSchema.parse(
  JSON.parse(readFileSync(new URL('../../../fixtures/pda.json', import.meta.url), 'utf8')),
)

describe('fixtures/pda.json', () => {
  it('is derived for the same program id', () => {
    expect(fixture.program).toBe(WASHAPP_PROGRAM_ADDRESS)
  })

  it('covers the edges of every numeric seed', () => {
    expect(fixture.pools.map((p) => p.id)).toContain(65_535)
    expect(fixture.lossEvents.map((e) => e.index)).toContain(4_294_967_295)
    expect(fixture.contracts.map((c) => c.nonce)).toContain(2n ** 64n - 1n)
  })
})

describe('global PDAs', () => {
  it('config, mint and treasury match Rust', async () => {
    expect(await configAddress()).toBe(fixture.config.address)
    expect(await mintAddress()).toBe(fixture.mint.address)
    expect(await treasuryAddress()).toBe(fixture.treasury.address)
  })
})

describe('per-pool PDAs', () => {
  it.each(fixture.pools)('pool $id and its five derived accounts match Rust', async (row) => {
    const pool = await poolAddress(row.id)
    expect(pool).toBe(row.pool.address)
    expect(await vaultAddress(pool)).toBe(row.vault.address)
    expect(await seniorMintAddress(pool)).toBe(row.seniorMint.address)
    expect(await juniorMintAddress(pool)).toBe(row.juniorMint.address)
    expect(await protectionAddress(pool)).toBe(row.protection.address)
    expect(await pvaultAddress(pool)).toBe(row.pvault.address)
  })

  it('rejects a pool id outside u16', async () => {
    await expect(poolAddress(65_536)).rejects.toThrow()
    await expect(poolAddress(-1)).rejects.toThrow()
  })
})

describe('keyed PDAs', () => {
  it.each(fixture.lossEvents)('loss event $poolId/$index matches Rust', async (row) => {
    const pool = await poolAddress(row.poolId)
    expect(await lossEventAddress(pool, row.index)).toBe(row.pda.address)
  })

  it.each(fixture.sellers)('seller position in pool $poolId matches Rust', async (row) => {
    const pool = await poolAddress(row.poolId)
    expect(await sellerAddress(pool, row.owner)).toBe(row.pda.address)
  })

  it.each(fixture.contracts)('contract $poolId/#$nonce matches Rust', async (row) => {
    const pool = await poolAddress(row.poolId)
    expect(await contractAddress(pool, row.buyer, row.nonce)).toBe(row.pda.address)
  })

  it('rejects a nonce outside u64', async () => {
    const pool = await poolAddress(0)
    const buyer = fixture.contracts[0]?.buyer
    if (buyer === undefined) throw new Error('fixture has no contracts')
    await expect(contractAddress(pool, buyer, 2n ** 64n)).rejects.toThrow()
    await expect(contractAddress(pool, buyer, -1n)).rejects.toThrow()
  })
})
