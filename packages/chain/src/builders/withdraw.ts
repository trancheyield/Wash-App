import type { TransactionSigner } from '@solana/kit'
import { getCreateAssociatedTokenIdempotentInstruction } from '@solana-program/token'
import type { Micro } from '@washapp/shared'
import { getWithdrawProtectionInstruction } from '../generated/index.ts'
import { sellerAddress } from '../pda.ts'
import { ataAddress } from '../read.ts'
import { protectionAccounts } from './protection-accounts.ts'

export type WithdrawParams = {
  owner: TransactionSigner
  poolId: number
  shares: Micro
}

// Same shape as `buildRedeem`: the seller may have emptied and closed the base-token ATA
// since providing, so it is created idempotently in the same transaction.
export async function buildWithdraw({ owner, poolId, shares }: WithdrawParams) {
  const { pool, mint, protection, pvault } = await protectionAccounts(poolId)
  const [ownerAta, position] = await Promise.all([
    ataAddress(owner.address, mint),
    sellerAddress(pool, owner.address),
  ])
  const createAta = getCreateAssociatedTokenIdempotentInstruction({
    payer: owner,
    ata: ownerAta,
    owner: owner.address,
    mint,
  })
  const withdraw = getWithdrawProtectionInstruction({
    pool,
    protection,
    pvault,
    ownerAta,
    position,
    owner,
    shares,
  })
  return [createAta, withdraw] as const
}
