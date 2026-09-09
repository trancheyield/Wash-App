import type { Address } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { Tranche } from './generated/index.ts'
import { type ReadRpc, readPool } from './read.ts'
import { m0Fixture as fixture } from './testing/m0-fixture.ts'
import { accruedView, poolBalances, trancheIndex, withBalances } from './view.ts'

const byAddress = new Map(Object.values(fixture.accounts).map((a) => [a.address, a]))

function fakeRpc(): ReadRpc {
  const getMultipleAccounts = (addresses: readonly Address[]) => ({
    send: async () => ({
      context: { slot: 1n },
      value: addresses.map((key) => {
        const account = byAddress.get(key)
        if (!account) return null
        return {
          data: [Buffer.from(account.data, 'hex').toString('base64'), 'base64'] as const,
          executable: false,
          lamports: BigInt(account.lamports),
          owner: account.owner,
          rentEpoch: 0n,
          space: BigInt(account.data.length / 2),
        }
      }),
    }),
  })
  return { getMultipleAccounts } as unknown as ReadRpc
}

async function m0Pool() {
  const pool = await readPool(fakeRpc(), fixture.poolId)
  if (!pool) throw new Error('фікстура без пулу')
  return pool
}

describe('accruedView', () => {
  it('reproduces the SVM state: 60 s on the demo scale = 30 model days', async () => {
    const after = await m0Pool()
    // Стан до `accrue` у фікстурі: 75 000 / 25 000 один до одного, годинник на генезисі.
    const before = {
      ...withBalances(after, {
        assets: 100_000_000_000n,
        seniorAssets: 75_000_000_000n,
        juniorAssets: 25_000_000_000n,
        seniorSupply: 75_000_000_000n,
        juniorSupply: 25_000_000_000n,
      }),
      modelTime: 0n,
      lastAccruedTs: BigInt(fixture.genesisTs),
    }
    const projected = accruedView(before, BigInt(fixture.genesisTs + 60))
    expect(poolBalances(projected)).toEqual(poolBalances(after))
    expect(projected.senior.nav).toBe(after.senior.nav)
    expect(projected.junior.nav).toBe(after.junior.nav)
    expect(projected.modelTime).toBe(after.modelTime)
    expect(projected.lastAccruedTs).toBe(after.lastAccruedTs)
  })

  it('is the identity at the last accrual and when the clock runs backwards', async () => {
    const pool = await m0Pool()
    expect(accruedView(pool, pool.lastAccruedTs)).toEqual(pool)
    expect(accruedView(pool, pool.lastAccruedTs - 1_000n)).toEqual(pool)
  })

  it('keeps assets == senior + junior after projection', async () => {
    const pool = await m0Pool()
    const projected = accruedView(pool, pool.lastAccruedTs + 24n * 60n)
    expect(projected.assets).toBe(projected.senior.assets + projected.junior.assets)
    expect(projected.assets).toBeGreaterThan(pool.assets)
  })
})

describe('trancheIndex', () => {
  it('maps the screen tranche onto the Codama enum', () => {
    expect(trancheIndex('senior')).toBe(Tranche.Senior)
    expect(trancheIndex('junior')).toBe(Tranche.Junior)
  })
})
