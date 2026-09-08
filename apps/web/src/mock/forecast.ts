// Waterfall на мок-даних: ті самі цілочисельні формули, що підуть у `math.rs`
// (усі добутки в bigint, ділення вниз, залишок округлення — junior). У US4 (T037)
// цей модуль заміняється дзеркалом із `packages/shared`, звіреним по фікстурі.
import type { Micro } from '@washapp/shared'
import { BPS, DAY_SECONDS, type PoolState, YEAR_SECONDS } from './data.ts'

export function totalAssets(pool: PoolState): Micro {
  return pool.senior.assets + pool.junior.assets
}

export function nav(assets: Micro, supply: Micro): Micro {
  return supply === 0n ? 1_000_000n : (assets * 1_000_000n) / supply
}

export function sharesForDeposit(amount: Micro, assets: Micro, supply: Micro): Micro {
  return supply === 0n ? amount : (amount * supply) / assets
}

export function amountForShares(shares: Micro, assets: Micro, supply: Micro): Micro {
  return supply === 0n ? 0n : (shares * assets) / supply
}

export type LossSplit = { loss: Micro; juniorLoss: Micro; seniorLoss: Micro }

export function applyLoss(pool: PoolState, lossBps: bigint): LossSplit {
  const loss = (totalAssets(pool) * lossBps) / BPS
  const juniorLoss = loss < pool.junior.assets ? loss : pool.junior.assets
  return { loss, juniorLoss, seniorLoss: loss - juniorLoss }
}

export function poolAfterLoss(pool: PoolState, lossBps: bigint): PoolState {
  const { juniorLoss, seniorLoss } = applyLoss(pool, lossBps)
  return {
    senior: { assets: pool.senior.assets - seniorLoss, supply: pool.senior.supply },
    junior: { assets: pool.junior.assets - juniorLoss, supply: pool.junior.supply },
  }
}

// Частка junior в активах після операції, bps; senior-депозит і junior-погашення
// перевіряються проти `minJuniorBps`.
export function juniorShareBps(senior: Micro, junior: Micro): bigint {
  const total = senior + junior
  return total === 0n ? BPS : (junior * BPS) / total
}

export function premium(notional: Micro, rateBps: bigint, termDays: bigint): Micro {
  return (notional * rateBps * termDays * DAY_SECONDS) / (BPS * YEAR_SECONDS)
}

export function payout(notional: Micro, lossBps: bigint, triggerBps: bigint): Micro {
  return lossBps >= triggerBps ? (notional * lossBps) / BPS : 0n
}

// Форматери переїхали у `format.ts`; реекспорт — доки екрани M0 ще на моках.
export { formatBps, formatNav } from '../format.ts'
