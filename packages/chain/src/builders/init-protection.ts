import type { TransactionSigner } from '@solana/kit'
import { getInitProtectionInstruction } from '../generated/index.ts'
import { protectionAccounts } from './protection-accounts.ts'

export type InitProtectionParams = {
  operator: TransactionSigner
  poolId: number
  premiumRateBps: number
  triggerBps: number
  premiumFeeBps: number
}

export async function buildInitProtection({
  operator,
  poolId,
  premiumRateBps,
  triggerBps,
  premiumFeeBps,
}: InitProtectionParams) {
  const { pool, mint, protection, pvault } = await protectionAccounts(poolId)
  return getInitProtectionInstruction({
    pool,
    mint,
    protection,
    pvault,
    operator,
    premiumRateBps,
    triggerBps,
    premiumFeeBps,
  })
}
