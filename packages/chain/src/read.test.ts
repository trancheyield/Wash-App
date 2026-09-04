import { type Address, address } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { ataAddress, type ReadRpc, readPool, readWallet } from './read.ts'
import { m0Fixture as fixture } from './testing/m0-fixture.ts'
import { modelDays, nav } from './view.ts'

// Байти акаунтів пише Rust із SVM (`wsl-build.sh fixtures`); тут RPC підмінено
// на ті самі байти, тож декодери перевіряються проти програми, а не проти себе.
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

const SENIOR = 75_000_000_000n
const JUNIOR = 25_000_000_000n

describe('readPool', () => {
  it('decodes the M0 pool after 30 model days from SVM bytes', async () => {
    const pool = await readPool(fakeRpc(), fixture.poolId)
    expect(pool).not.toBeNull()
    if (!pool) return

    expect(pool.address).toBe(fixture.accounts.pool.address)
    expect(pool.id).toBe(fixture.poolId)
    expect(pool.operator).toBe(fixture.operator)
    expect(pool.mint).toBe(fixture.accounts.mint.address)
    expect(pool.vault).toBe(fixture.accounts.vault.address)
    expect(pool.senior.mint).toBe(fixture.accounts.seniorMint.address)
    expect(pool.junior.mint).toBe(fixture.accounts.juniorMint.address)
    expect(pool.params).toEqual({
      yieldRateBps: 800,
      seniorRateBps: 500,
      minJuniorBps: 2000,
      perfFeeBps: 1000,
      timeScale: 43_200,
    })

    expect(pool.assets).toBe(100_591_780_822n)
    expect(pool.senior.assets).toBe(75_308_219_178n)
    expect(pool.junior.assets).toBe(25_283_561_644n)
    expect(pool.senior.supply).toBe(SENIOR)
    expect(pool.junior.supply).toBe(JUNIOR)
    // NAV ділиться вниз: 1.004109589… → 1.004109, 1.011342465… → 1.011342.
    expect(pool.senior.nav).toBe(1_004_109n)
    expect(pool.junior.nav).toBe(1_011_342n)

    expect(pool.modelTime).toBe(30n * 86_400n)
    expect(modelDays(pool.modelTime)).toBe(30n)
    expect(pool.createdAt).toBe(BigInt(fixture.genesisTs))
    expect(pool.lastAccruedTs).toBe(BigInt(fixture.genesisTs + 60))
    expect(pool.lossCount).toBe(0)
  })

  it('returns null for a pool that does not exist', async () => {
    expect(await readPool(fakeRpc(), fixture.poolId + 1)).toBeNull()
  })
})

describe('readWallet', () => {
  it('reads tranche balances through ATAs and values them at NAV', async () => {
    const rpc = fakeRpc()
    const pool = await readPool(rpc, fixture.poolId)
    if (!pool) throw new Error('fixture pool missing')
    expect(await ataAddress(fixture.owner, pool.senior.mint)).toBe(
      fixture.accounts.ownerSenior.address,
    )

    const wallet = await readWallet(rpc, pool, fixture.owner)
    expect(wallet.base).toBe(0n)
    expect(wallet.seniorShares).toBe(SENIOR)
    expect(wallet.juniorShares).toBe(JUNIOR)
    // Єдиний держатель: вартість часток = активи траншу, без втрат округлення.
    expect(wallet.seniorValue).toBe(pool.senior.assets)
    expect(wallet.juniorValue).toBe(pool.junior.assets)
  })

  it('treats missing ATAs as zero balances', async () => {
    const rpc = fakeRpc()
    const pool = await readPool(rpc, fixture.poolId)
    if (!pool) throw new Error('fixture pool missing')
    const stranger = address('11111111111111111111111111111112')
    const wallet = await readWallet(rpc, pool, stranger)
    expect(wallet).toEqual({
      owner: stranger,
      base: 0n,
      seniorShares: 0n,
      juniorShares: 0n,
      seniorValue: 0n,
      juniorValue: 0n,
    })
  })
})

describe('nav', () => {
  it('is exactly one for an empty tranche and divides down otherwise', () => {
    expect(nav(0n, 0n)).toBe(1_000_000n)
    expect(nav(75_308_219_178n, SENIOR)).toBe(1_004_109n)
    expect(nav(1n, 3n)).toBe(333_333n)
  })
})
