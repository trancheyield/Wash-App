import type { TransactionSigner } from '@solana/kit'
import type { Micro } from '@washapp/shared'
import { getProvideProtectionInstruction } from '../generated/index.ts'
import { sellerAddress } from '../pda.ts'
import { ataAddress } from '../read.ts'
import { protectionAccounts } from './protection-accounts.ts'

export type ProvideParams = {
  owner: TransactionSigner
  poolId: number
  amount: Micro
}

// No ATA creation in front: the collateral comes from the base-token ATA, which has to
// hold the amount already. The position is `init_if_needed` in the program itself.
export async function buildProvide({ owner, poolId, amount }: ProvideParams) {
  const { pool, mint, protection, pvault } = await protectionAccounts(poolId)
  const [ownerAta, position] = await Promise.all([
    ataAddress(owner.address, mint),
    sellerAddress(pool, owner.address),
  ])
  return getProvideProtectionInstruction({
    pool,
    protection,
    pvault,
    ownerAta,
    position,
    owner,
    amount,
  })
}
