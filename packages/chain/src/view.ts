// Стан пулу для екранів — чисті перетворення декодованих акаунтів. Усі суми —
// `bigint` мікро-одиниць; NAV — вартість однієї частки × 10⁶ (1 000 000 = 1.000000),
// ділення вниз, як у `math.rs`. Читання з RPC — у `read.ts`.

import type { Address } from '@solana/kit'
import {
  accrue,
  afterAccrual,
  type Micro,
  type PoolBalances,
  type Rates,
  type Tranche as TrancheSide,
} from '@washapp/shared'
import { type Pool, Tranche } from './generated/index.ts'

export const NAV_ONE: Micro = 1_000_000n

export type PoolParamsView = {
  yieldRateBps: number
  seniorRateBps: number
  minJuniorBps: number
  perfFeeBps: number
  timeScale: number
}

export type TrancheView = {
  mint: Address
  assets: Micro
  supply: Micro
  nav: Micro
}

export type PoolView = {
  address: Address
  id: number
  operator: Address
  mint: Address
  vault: Address
  params: PoolParamsView
  assets: Micro
  senior: TrancheView
  junior: TrancheView
  modelTime: bigint
  lastAccruedTs: bigint
  createdAt: bigint
  lossCount: number
}

export type WalletView = {
  owner: Address
  base: Micro
  seniorShares: Micro
  juniorShares: Micro
  // Вартість часток за поточним NAV — те, що вкладник отримав би при погашенні.
  seniorValue: Micro
  juniorValue: Micro
}

// Порожній транш коштує рівно 1: перший вкладник заходить 1:1.
export function nav(assets: Micro, supply: Micro): Micro {
  return supply === 0n ? NAV_ONE : (assets * NAV_ONE) / supply
}

// Вартість часток для показу: вичерпаний транш коштує нуль, а не кидає — це не
// операція, а рядок на екрані. Для операцій — `amountForRedeem` із `@washapp/shared`.
export function amountForShares(shares: Micro, assets: Micro, supply: Micro): Micro {
  return supply === 0n ? 0n : (shares * assets) / supply
}

function tranche(mint: Address, assets: Micro, supply: Micro): TrancheView {
  return { mint, assets, supply, nav: nav(assets, supply) }
}

export function poolView(
  address: Address,
  pool: Pool,
  seniorSupply: Micro,
  juniorSupply: Micro,
): PoolView {
  return {
    address,
    id: pool.id,
    operator: pool.operator,
    mint: pool.mint,
    vault: pool.vault,
    params: {
      yieldRateBps: pool.yieldRateBps,
      seniorRateBps: pool.seniorRateBps,
      minJuniorBps: pool.minJuniorBps,
      perfFeeBps: pool.perfFeeBps,
      timeScale: pool.timeScale,
    },
    assets: pool.assets,
    senior: tranche(pool.seniorMint, pool.seniorAssets, seniorSupply),
    junior: tranche(pool.juniorMint, pool.juniorAssets, juniorSupply),
    modelTime: pool.modelTime,
    lastAccruedTs: pool.lastAccruedTs,
    createdAt: pool.createdAt,
    lossCount: pool.lossCount,
  }
}

export function walletView(
  owner: Address,
  pool: PoolView,
  base: Micro,
  seniorShares: Micro,
  juniorShares: Micro,
): WalletView {
  return {
    owner,
    base,
    seniorShares,
    juniorShares,
    seniorValue: amountForShares(seniorShares, pool.senior.assets, pool.senior.supply),
    juniorValue: amountForShares(juniorShares, pool.junior.assets, pool.junior.supply),
  }
}

// Модельний час у секундах → модельні дні (для підписів «MODEL DAY 30»).
export function modelDays(modelTime: bigint): bigint {
  return modelTime / 86_400n
}

// Транш екрана ('senior' | 'junior') ↔ числовий `Tranche` Codama в інструкціях.
export function trancheIndex(side: TrancheSide): Tranche {
  return side === 'senior' ? Tranche.Senior : Tranche.Junior
}

export function poolBalances(pool: PoolView): PoolBalances {
  return {
    assets: pool.assets,
    seniorAssets: pool.senior.assets,
    juniorAssets: pool.junior.assets,
    seniorSupply: pool.senior.supply,
    juniorSupply: pool.junior.supply,
  }
}

export function poolRates(pool: PoolView): Rates {
  return {
    yieldBps: pool.params.yieldRateBps,
    seniorBps: pool.params.seniorRateBps,
    feeBps: pool.params.perfFeeBps,
  }
}

// Той самий `PoolView` з іншими балансами — стан «після» для прев'ю і креслення.
export function withBalances(pool: PoolView, b: PoolBalances): PoolView {
  return {
    ...pool,
    assets: b.assets,
    senior: tranche(pool.senior.mint, b.seniorAssets, b.seniorSupply),
    junior: tranche(pool.junior.mint, b.juniorAssets, b.juniorSupply),
  }
}

// Стан пулу, який побачить інструкція, надіслана в момент `nowUnix`: кожна починається
// з `accrue`, тож прев'ю за голим станом із ланцюга розійшлося б із фактом на весь дохід
// із останнього нарахування (на демо-масштабі — місяці за хвилини). Годинник ланцюга
// назад не йде: `dt = max(0, now − lastAccruedTs) × timeScale`, як в `accrue_pool`.
export function accruedView(pool: PoolView, nowUnix: bigint): PoolView {
  const elapsed = nowUnix > pool.lastAccruedTs ? nowUnix - pool.lastAccruedTs : 0n
  const dtModel = elapsed * BigInt(pool.params.timeScale)
  const balances = poolBalances(pool)
  const next = afterAccrual(balances, accrue(balances, poolRates(pool), dtModel))
  return {
    ...withBalances(pool, next),
    modelTime: pool.modelTime + dtModel,
    lastAccruedTs: pool.lastAccruedTs + elapsed,
  }
}
