import type { Address, TransactionSigner } from '@solana/kit'
import { getExpireProtectionInstruction } from '../generated/index.ts'
import { contractAddress } from '../pda.ts'
import { protectionAccounts } from './protection-accounts.ts'

export type ExpireParams = {
  // The buyer or the pool operator; the program refuses anyone else so that a seller
  // cannot close a claim that has not been filed yet.
  signer: TransactionSigner
  poolId: number
  buyer: Address
  nonce: bigint
}

export async function buildExpire({ signer, poolId, buyer, nonce }: ExpireParams) {
  const accounts = await protectionAccounts(poolId)
  const contract = await contractAddress(accounts.pool, buyer, nonce)
  return getExpireProtectionInstruction({ ...accounts, contract, signer })
}
