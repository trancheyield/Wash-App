// The protection pool and its vault are PDAs of the pool address, so like `poolAccounts`
// the builder needs only `poolId` — no read of `ProtectionView` before signing.

import type { Address } from '@solana/kit'
import { protectionAddress, pvaultAddress } from '../pda.ts'
import { type PoolAccounts, poolAccounts } from './pool-accounts.ts'

export type ProtectionAccounts = PoolAccounts & {
  protection: Address
  pvault: Address
}

export async function protectionAccounts(poolId: number): Promise<ProtectionAccounts> {
  const accounts = await poolAccounts(poolId)
  const [protection, pvault] = await Promise.all([
    protectionAddress(accounts.pool),
    pvaultAddress(accounts.pool),
  ])
  return { ...accounts, protection, pvault }
}
