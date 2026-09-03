// Стан пулу для екранів — чисті перетворення декодованих акаунтів. Усі суми —
// `bigint` мікро-одиниць; NAV — вартість однієї частки × 10⁶ (1 000 000 = 1.000000),
// ділення вниз, як у `math.rs`. Читання з RPC — у `read.ts`.

import type { Address } from '@solana/kit'
import type { Micro } from '@washapp/shared'
import type { Pool } from './generated/index.ts'

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

export function amountForShares(shares: Micro, assets: Micro, supply: Micro): Micro {
  return supply === 0n ? 0n : (shares * assets) / supply
}

export function sharesForDeposit(amount: Micro, assets: Micro, supply: Micro): Micro {
  return supply === 0n ? amount : (amount * supply) / assets
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
