import type { Address } from '@solana/kit'
import { getSettleProtectionInstruction } from '../generated/index.ts'
import { contractAddress, lossEventAddress } from '../pda.ts'
import { ataAddress } from '../read.ts'
import { protectionAccounts } from './protection-accounts.ts'

export type SettleParams = {
  poolId: number
  buyer: Address
  nonce: bigint
  lossIndex: number
}

// No signer in the instruction: anyone may settle, and the program pays only to the
// buyer's base-token ATA. The fee payer of the transaction is the only signature.
export async function buildSettle({ poolId, buyer, nonce, lossIndex }: SettleParams) {
  const { pool, mint, protection, pvault } = await protectionAccounts(poolId)
  const [contract, lossEvent, buyerAta] = await Promise.all([
    contractAddress(pool, buyer, nonce),
    lossEventAddress(pool, lossIndex),
    ataAddress(buyer, mint),
  ])
  return getSettleProtectionInstruction({
    pool,
    protection,
    pvault,
    contract,
    lossEvent,
    buyerAta,
  })
}
