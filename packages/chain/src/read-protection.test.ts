import { type Address, address, getBase58Encoder } from '@solana/kit'
import { payout, premium, premiumFee } from '@washapp/shared'
import { describe, expect, it } from 'vitest'
import { ContractStatus } from './generated/index.ts'
import { type ReadRpc, readContracts, readPool, readProtection, readWallet } from './read.ts'
import { m0Fixture } from './testing/m0-fixture.ts'
import {
  protectionFixture as fixture,
  protectionFixtureAddress,
} from './testing/protection-fixture.ts'

// The protection market bytes come from SVM (`wsl-build.sh fixtures`), laid over the M0
// pool after the 15 % loss. `getProgramAccounts` applies its filters to those bytes, so a
// wrong memcmp offset shows up as a missing or foreign contract, not as a passing test.
type RawAccount = { address: string; owner: string; lamports: number; data: string }
type Filter = { dataSize?: bigint; memcmp?: { offset: bigint; bytes: string } }

function rpcAccount(account: RawAccount) {
  return {
    data: [Buffer.from(account.data, 'hex').toString('base64'), 'base64'] as const,
    executable: false,
    lamports: BigInt(account.lamports),
    owner: account.owner,
    rentEpoch: 0n,
    space: BigInt(account.data.length / 2),
  }
}

function matches(account: RawAccount, filter: Filter): boolean {
  const data = Buffer.from(account.data, 'hex')
  if (filter.dataSize !== undefined) return BigInt(data.length) === filter.dataSize
  if (!filter.memcmp) return false
  const expected = Buffer.from(getBase58Encoder().encode(filter.memcmp.bytes))
  const offset = Number(filter.memcmp.offset)
  return data.subarray(offset, offset + expected.length).equals(expected)
}

type Calls = { multiple: Address[][]; program: number }

function fakeRpc(withProtection = true, calls: Calls = { multiple: [], program: 0 }): ReadRpc {
  const byAddress = new Map<string, RawAccount>()
  for (const a of Object.values(m0Fixture.accounts)) byAddress.set(a.address, a)
  for (const a of Object.values(m0Fixture.afterLoss.accounts)) byAddress.set(a.address, a)
  if (withProtection) {
    for (const a of Object.values(fixture.accounts)) byAddress.set(a.address, a)
  }
  const getMultipleAccounts = (addresses: readonly Address[]) => ({
    send: async () => {
      calls.multiple.push([...addresses])
      return {
        context: { slot: 1n },
        value: addresses.map((key) => {
          const account = byAddress.get(key)
          return account ? rpcAccount(account) : null
        }),
      }
    },
  })
  const getProgramAccounts = (program: Address, config: { filters: Filter[] }) => ({
    send: async () => {
      calls.program += 1
      return [...byAddress.values()]
        .filter((a) => a.owner === program && config.filters.every((f) => matches(a, f)))
        .map((a) => ({ pubkey: a.address, account: rpcAccount(a) }))
    },
  })
  return { getMultipleAccounts, getProgramAccounts } as unknown as ReadRpc
}

// 30 model days at 2 % a year: 1,000 → 1,643,835; 500 → 821,917; 100 → 164,383.
// The fee is 10 % of each premium, the rest goes to the collateral.
const NET_PREMIUMS = 1_479_452n + 739_726n + 147_945n
const COLLATERAL = 5_000_000_000n + NET_PREMIUMS - 150_000_000n
const TERM = BigInt(fixture.term)
const START = 30n * 86_400n

async function pool(rpc: ReadRpc) {
  const view = await readPool(rpc, fixture.poolId)
  if (!view) throw new Error('fixture pool missing')
  return view
}

describe('readProtection', () => {
  it('decodes the protection pool after three purchases and one settlement', async () => {
    const view = await readProtection(fakeRpc(), m0Fixture.accounts.pool.address)
    expect(view).toEqual({
      address: protectionFixtureAddress('protection'),
      pool: m0Fixture.accounts.pool.address,
      pvault: protectionFixtureAddress('pvault'),
      params: { premiumRateBps: 200, triggerBps: 100, premiumFeeBps: 1_000 },
      collateral: COLLATERAL,
      // The settled contract released its 1,000; 500 and 100 are still covered.
      reserved: 600_000_000n,
      free: COLLATERAL - 600_000_000n,
      shareSupply: 5_000_000_000n,
      // 4,852.367123 / 5,000 shares = 0.9704734… per share, rounded down.
      shareValue: 970_473n,
      contracts: 3n,
    })
  })

  it('returns null for a pool without a protection market', async () => {
    expect(await readProtection(fakeRpc(false), m0Fixture.accounts.pool.address)).toBeNull()
  })
})

describe('readContracts', () => {
  it("finds only this buyer's contracts in this pool, ordered by nonce", async () => {
    const contracts = await readContracts(fakeRpc(), m0Fixture.accounts.pool.address, fixture.buyer)
    expect(contracts).toEqual([
      {
        address: protectionFixtureAddress('contract0'),
        buyer: fixture.buyer,
        nonce: 0n,
        notional: 1_000_000_000n,
        premium: 1_643_835n,
        startModelTime: START,
        expiryModelTime: START + TERM,
        triggerBps: 100,
        lossIndexFrom: 0,
        status: ContractStatus.Settled,
        settledLossIndex: 0,
        payout: 150_000_000n,
      },
      {
        address: protectionFixtureAddress('contract1'),
        buyer: fixture.buyer,
        nonce: 1n,
        notional: 500_000_000n,
        premium: 821_917n,
        startModelTime: START,
        expiryModelTime: START + TERM,
        triggerBps: 100,
        lossIndexFrom: 0,
        status: ContractStatus.Active,
        settledLossIndex: 0,
        payout: 0n,
      },
    ])
  })

  it('finds nothing for another pool', async () => {
    const other = address('11111111111111111111111111111112')
    expect(await readContracts(fakeRpc(), other, fixture.buyer)).toEqual([])
  })
})

describe('readWallet with protection', () => {
  it("values the seller's shares at the collateral and lists the seller's own contract", async () => {
    const rpc = fakeRpc()
    const wallet = await readWallet(rpc, await pool(rpc), fixture.seller)
    expect(wallet.sellerShares).toBe(5_000_000_000n)
    // The only seller: the shares are worth the whole collateral.
    expect(wallet.sellerValue).toBe(COLLATERAL)
    expect(wallet.contracts.map((c) => c.address)).toEqual([protectionFixtureAddress('contract2')])
    expect(wallet.contracts[0]?.status).toBe(ContractStatus.Active)
  })

  it('reads a buyer without seller shares in one account call and one program scan', async () => {
    const calls: Calls = { multiple: [], program: 0 }
    const rpc = fakeRpc(true, calls)
    const view = await pool(rpc)
    calls.multiple.length = 0
    const wallet = await readWallet(rpc, view, fixture.buyer)
    expect(calls.multiple).toHaveLength(1)
    expect(calls.program).toBe(1)
    expect(wallet.sellerShares).toBe(0n)
    expect(wallet.sellerValue).toBe(0n)
    expect(wallet.contracts.map((c) => c.nonce)).toEqual([0n, 1n])
  })

  it('skips the program scan when the pool has no protection market', async () => {
    const calls: Calls = { multiple: [], program: 0 }
    const rpc = fakeRpc(false, calls)
    const wallet = await readWallet(rpc, await pool(rpc), fixture.buyer)
    expect(calls.program).toBe(0)
    expect(wallet.contracts).toEqual([])
    expect(wallet.sellerValue).toBe(0n)
  })
})

// The screens preview premiums and payouts with `@washapp/shared` before signing; these are
// the numbers `buy_protection` and `settle_protection` really wrote in SVM.
describe('the shared protection math against the program', () => {
  it('premium, fee and payout equal what the program wrote', async () => {
    const rpc = fakeRpc()
    const market = await readProtection(rpc, m0Fixture.accounts.pool.address)
    if (!market) throw new Error('fixture protection missing')
    const bought = [
      ...(await readContracts(rpc, m0Fixture.accounts.pool.address, fixture.buyer)),
      ...(await readContracts(rpc, m0Fixture.accounts.pool.address, fixture.seller)),
    ]
    expect(bought).toHaveLength(3)
    let net = 0n
    for (const c of bought) {
      const term = c.expiryModelTime - c.startModelTime
      expect(premium(c.notional, market.params.premiumRateBps, term)).toBe(c.premium)
      net += c.premium - premiumFee(c.premium, market.params.premiumFeeBps)
    }
    expect(net).toBe(NET_PREMIUMS)
    const settled = bought.find((c) => c.status === ContractStatus.Settled)
    expect(settled?.payout).toBe(payout(settled?.notional ?? 0n, fixture.lossBps))
  })
})
