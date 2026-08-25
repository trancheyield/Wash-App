// Мок-дані M0: константи брифу `docs/m0-noah-prompt.md` у мікро-одиницях (6 знаків).
// Замінюються читачами `packages/chain` у US1 (T020); формули в `forecast.ts` — дзеркалом
// `math.rs` у US4 (T037).
import type { Micro } from '@washapp/shared'

export const BPS = 10_000n
export const YEAR_SECONDS = 365n * 86_400n
export const DAY_SECONDS = 86_400n

export const TOKEN = 'WUSD'
export const SENIOR_TOKEN = 'sWUSD'
export const JUNIOR_TOKEN = 'jWUSD'

export const OPERATOR = 'Op3r…tR7a'
export const BUYER = 'Buy1…9kQd'

export const poolParams = {
  id: 0,
  yieldRateBps: 800n,
  seniorRateBps: 500n,
  minJuniorBps: 2_000n,
  perfFeeBps: 1_000n,
  timeScale: 43_200n,
  modelDay: 30,
}

export type TrancheState = { assets: Micro; supply: Micro }
export type PoolState = { senior: TrancheState; junior: TrancheState }

// Стан «після 30 модельних днів» — його показує більшість аркушів.
export const poolAfterAccrual: PoolState = {
  senior: { assets: 75_308_219_178n, supply: 75_000_000_000n },
  junior: { assets: 25_283_561_644n, supply: 25_000_000_000n },
}

export const accrualSummary = {
  yield: 657_534_246n,
  fee: 65_753_424n,
  seniorGain: 308_219_178n,
  juniorGain: 283_561_644n,
}

export const demoLossBps = 1_500n

export const protectionParams = {
  premiumRateBps: 200n,
  triggerBps: 100n,
  premiumFeeBps: 1_000n,
}

export const protectionState = {
  collateral: 30_088_767_123n,
  reserved: 20_000_000_000n,
}

export type ContractStatus = 'ACTIVE' | 'SETTLED' | 'EXPIRED'
export type Contract = {
  nonce: number
  buyer: string
  notional: Micro
  premium: Micro
  startDay: number
  expiryDay: number
  status: ContractStatus
  payout: Micro
}

export const contract0: Contract = {
  nonce: 0,
  buyer: BUYER,
  notional: 20_000_000_000n,
  premium: 98_630_136n,
  startDay: 30,
  expiryDay: 120,
  status: 'ACTIVE',
  payout: 0n,
}

export const walletPosition = {
  seniorShares: 10_000_000_000n,
  juniorShares: 5_000_000_000n,
  free: 12_500_000_000n,
  sellerShareBps: 10_000n,
}

export const faucetPerRequest: Micro = 1_000_000_000n
