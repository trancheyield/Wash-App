import { address } from '@solana/kit'
import {
  ContractStatus,
  type ContractView,
  type LossEventView,
  type PoolView,
  type ProtectionView,
  type WalletView,
} from '@washapp/chain'
import { describe, expect, it } from 'vitest'
import { type PositionInput, positionForecast } from './forecast.ts'

const DAY = 86_400n
const T0 = 1_760_000_000n
const ME = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const OTHER = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
const ANY = address('11111111111111111111111111111111')

// The M0 brief after 30 model days: the numbers below were computed independently
// (python, integers) for the mock sheet and must survive the move to live data.
function pool(over: Partial<PoolView> = {}): PoolView {
  return {
    address: ANY,
    id: 0,
    operator: ANY,
    mint: ANY,
    vault: ANY,
    params: {
      yieldRateBps: 800,
      seniorRateBps: 500,
      minJuniorBps: 2_000,
      perfFeeBps: 1_000,
      timeScale: 43_200,
    },
    assets: 100_591_780_822n,
    senior: { mint: ANY, assets: 75_308_219_178n, supply: 75_000_000_000n, nav: 1_004_109n },
    junior: { mint: ANY, assets: 25_283_561_644n, supply: 25_000_000_000n, nav: 1_011_342n },
    modelTime: 30n * DAY,
    lastAccruedTs: T0,
    createdAt: T0,
    lossCount: 0,
    lossEvents: [],
    ...over,
  }
}

const protection: ProtectionView = {
  address: ANY,
  pool: ANY,
  pvault: ANY,
  params: { premiumRateBps: 200, triggerBps: 100, premiumFeeBps: 1_000 },
  collateral: 30_088_767_123n,
  reserved: 20_000_000_000n,
  free: 10_088_767_123n,
  shareSupply: 30_000_000_000n,
  shareValue: 1_002_958n,
  contracts: 1n,
}

function contract(over: Partial<ContractView> = {}): ContractView {
  return {
    address: ANY,
    buyer: ME,
    nonce: 0n,
    notional: 20_000_000_000n,
    premium: 98_630_136n,
    startModelTime: 30n * DAY,
    expiryModelTime: 120n * DAY,
    triggerBps: 100,
    lossIndexFrom: 0,
    status: ContractStatus.Active,
    settledLossIndex: 0,
    payout: 0n,
    ...over,
  }
}

function wallet(over: Partial<WalletView> = {}): WalletView {
  return {
    owner: ME,
    base: 0n,
    seniorShares: 10_000_000_000n,
    juniorShares: 5_000_000_000n,
    seniorValue: 0n,
    juniorValue: 0n,
    sellerShares: 30_000_000_000n,
    sellerValue: 0n,
    contracts: [contract()],
    ...over,
  }
}

function lossEvent(index: number, lossBps: number, modelTime: bigint): LossEventView {
  return {
    address: ANY,
    index,
    ts: T0,
    modelTime,
    lossBps,
    amount: 0n,
    juniorLoss: 0n,
    seniorLoss: 0n,
    assetsBefore: 0n,
    assetsAfter: 0n,
  }
}

const input: PositionInput = {
  pool: pool(),
  nowUnix: T0,
  wallet: wallet(),
  protection,
  poolContracts: [contract()],
}

const afters = (lossBps: number, i: PositionInput = input) =>
  positionForecast(i, lossBps).rows.map((r) => r.after)

describe('positionForecast', () => {
  it('matches the M0 brief at 15 %: junior absorbs, senior stands, cover pays', () => {
    const f = positionForecast(input, 1_500)
    expect(f.rows.map((r) => r.key)).toEqual(['senior', 'junior', 'contract:0', 'seller'])
    expect(f.rows.map((r) => r.now)).toEqual([10_041_095_890n, 5_056_712_328n, 0n, 30_088_767_123n])
    expect(f.rows.map((r) => r.after)).toEqual([
      10_041_095_890n,
      2_038_958_904n,
      3_000_000_000n,
      27_088_767_123n,
    ])
    expect(f.now).toBe(45_186_575_341n)
    expect(f.after).toBe(42_168_821_917n)
  })

  it('moves senior only once junior is empty', () => {
    expect(afters(4_000).slice(0, 2)).toEqual([8_047_342_465n, 0n])
  })

  it('wipes both tranches at 100 % and pays the full notional out of the collateral', () => {
    expect(afters(10_000)).toEqual([0n, 0n, 20_000_000_000n, 10_088_767_123n])
  })

  it('pays nothing below the trigger and says why', () => {
    const row = positionForecast(input, 50).rows.find((r) => r.key === 'contract:0')
    expect(row).toMatchObject({ now: 0n, after: 0n, note: 'below trigger' })
    expect(afters(0)).toEqual([10_041_095_890n, 5_056_712_328n, 0n, 30_088_767_123n])
  })

  it('accrues to now first, as record_loss does: the event lands later than the last accrual', () => {
    // 60 s × 43,200 = 30 model days: day 60, past a contract that ends on day 45.
    const late = {
      ...input,
      nowUnix: T0 + 60n,
      wallet: wallet({ contracts: [contract({ expiryModelTime: 45n * DAY })] }),
      poolContracts: [contract({ expiryModelTime: 45n * DAY })],
    }
    const f = positionForecast(late, 1_500)
    expect(f.rows.find((r) => r.key === 'contract:0')).toMatchObject({
      after: 0n,
      note: 'outside term',
    })
    const junior = f.rows.find((r) => r.key === 'junior')
    expect(junior?.now).toBeGreaterThan(5_056_712_328n)
    expect(f.rows.find((r) => r.key === 'seller')?.after).toBe(30_088_767_123n)
  })

  it('counts a claim already on the chain: now is claimable, the larger loss wins', () => {
    const claimed = {
      ...input,
      pool: pool({ lossCount: 1, lossEvents: [lossEvent(0, 1_000, 30n * DAY)] }),
    }
    const at5 = positionForecast(claimed, 500).rows
    expect(at5.find((r) => r.key === 'contract:0')).toMatchObject({
      now: 2_000_000_000n,
      after: 2_000_000_000n,
    })
    expect(at5.find((r) => r.key === 'seller')?.after).toBe(28_088_767_123n)
    expect(positionForecast(claimed, 1_500).rows.find((r) => r.key === 'contract:0')?.after).toBe(
      3_000_000_000n,
    )
  })

  it("charges the seller for every buyer's claim in the pool, pro rata to the shares", () => {
    const shared = {
      ...input,
      protection: { ...protection, reserved: 25_000_000_000n, free: 5_088_767_123n },
      wallet: wallet({
        seniorShares: 0n,
        juniorShares: 0n,
        sellerShares: 15_000_000_000n,
        contracts: [],
      }),
      poolContracts: [
        contract({ buyer: OTHER, nonce: 0n }),
        contract({ buyer: OTHER, nonce: 1n, notional: 5_000_000_000n }),
        contract({ buyer: OTHER, nonce: 2n, status: ContractStatus.Settled }),
        contract({ buyer: OTHER, nonce: 3n, status: ContractStatus.Expired }),
      ],
    }
    const f = positionForecast(shared, 1_500)
    expect(f.rows.map((r) => r.key)).toEqual(['seller'])
    // (30,088.767123 − 3,000 − 750) / 2, rounded down.
    expect(f.rows[0]).toMatchObject({ now: 15_044_383_561n, after: 13_169_383_561n })
  })

  it('lists only the active contracts of this wallet', () => {
    const closed = {
      ...input,
      wallet: wallet({
        contracts: [
          contract({ status: ContractStatus.Settled, payout: 1n }),
          contract({ nonce: 4n }),
          contract({ nonce: 5n, status: ContractStatus.Expired }),
        ],
      }),
    }
    expect(positionForecast(closed, 1_500).rows.map((r) => r.key)).toEqual([
      'senior',
      'junior',
      'contract:4',
      'seller',
    ])
  })

  it('an empty wallet has no rows and a zero total', () => {
    const empty = {
      ...input,
      wallet: wallet({ seniorShares: 0n, juniorShares: 0n, sellerShares: 0n, contracts: [] }),
    }
    expect(positionForecast(empty, 1_500)).toEqual({ rows: [], now: 0n, after: 0n })
  })

  it('a pool without a protection market leaves the tranches alone', () => {
    const bare = {
      ...input,
      protection: null,
      wallet: wallet({ sellerShares: 0n, contracts: [] }),
      poolContracts: [],
    }
    expect(afters(1_500, bare)).toEqual([10_041_095_890n, 2_038_958_904n])
  })
})
