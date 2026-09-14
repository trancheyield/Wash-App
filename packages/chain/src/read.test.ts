import { type Address, address } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { ataAddress, type ReadRpc, readLossEvents, readPool, readWallet } from './read.ts'
import { m0Fixture as fixture } from './testing/m0-fixture.ts'
import { modelDays, nav } from './view.ts'

// Байти акаунтів пише Rust із SVM (`wsl-build.sh fixtures`); тут RPC підмінено
// на ті самі байти, тож декодери перевіряються проти програми, а не проти себе.
// `afterLoss` перекриває пул, vault і мінт тим самим станом після збитку 15 %.
type Stage = 'beforeLoss' | 'afterLoss'

function fakeRpc(stage: Stage = 'beforeLoss', calls: Address[][] = []): ReadRpc {
  const byAddress = new Map(Object.values(fixture.accounts).map((a) => [a.address, a]))
  if (stage === 'afterLoss') {
    for (const a of Object.values(fixture.afterLoss.accounts)) byAddress.set(a.address, a)
  }
  const getMultipleAccounts = (addresses: readonly Address[]) => ({
    send: async () => ({
      context: { slot: 1n },
      value: addresses.map((key) => {
        calls.push([...addresses])
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
    expect(pool.lossEvents).toEqual([])
  })

  it('reads the pool and its loss events in a single RPC call', async () => {
    const calls: Address[][] = []
    const pool = await readPool(fakeRpc('afterLoss', calls), fixture.poolId)
    expect(pool).not.toBeNull()
    if (!pool) return

    // Пул + два мінти + 5 подій наосліп — один `getMultipleAccounts`.
    expect(new Set(calls.map((c) => c.join(','))).size).toBe(1)
    expect(calls[0]).toHaveLength(8)

    // Аркуш 3 брифу: junior узяв усе, senior без змін.
    const loss = 15_088_767_123n
    expect(pool.lossCount).toBe(1)
    expect(pool.assets).toBe(100_591_780_822n - loss)
    expect(pool.senior.assets).toBe(75_308_219_178n)
    expect(pool.junior.assets).toBe(10_194_794_521n)
    expect(pool.junior.nav).toBe(407_791n)

    expect(pool.lossEvents).toHaveLength(1)
    const event = pool.lossEvents[0]
    expect(event).toEqual({
      address: fixture.afterLoss.accounts.lossEvent0.address,
      index: 0,
      ts: BigInt(fixture.genesisTs + 60),
      modelTime: 30n * 86_400n,
      lossBps: fixture.afterLoss.lossBps,
      amount: loss,
      juniorLoss: loss,
      seniorLoss: 0n,
      assetsBefore: 100_591_780_822n,
      assetsAfter: 100_591_780_822n - loss,
    })
  })

  it('returns null for a pool that does not exist', async () => {
    expect(await readPool(fakeRpc(), fixture.poolId + 1)).toBeNull()
  })
})

describe('readLossEvents', () => {
  it('returns nothing without a call when there is nothing past `from`', async () => {
    const calls: Address[][] = []
    const events = await readLossEvents(
      fakeRpc('afterLoss', calls),
      fixture.accounts.pool.address,
      1,
      1,
    )
    expect(events).toEqual([])
    expect(calls).toEqual([])
  })

  it('reads events by index from the pool address', async () => {
    const events = await readLossEvents(fakeRpc('afterLoss'), fixture.accounts.pool.address, 1)
    expect(events.map((e) => e.index)).toEqual([0])
    expect(events[0]?.address).toBe(fixture.afterLoss.accounts.lossEvent0.address)
  })

  it('throws when an event below loss_count is missing', async () => {
    await expect(
      readLossEvents(fakeRpc('afterLoss'), fixture.accounts.pool.address, 2),
    ).rejects.toThrow(/loss event 1/)
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
