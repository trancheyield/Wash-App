import type { TransactionSigner } from '@solana/kit'
import type { Micro } from '@washapp/shared'
import { getFaucetInstructionAsync } from '../generated/index.ts'
import { mintAddress } from '../pda.ts'

export type FaucetParams = {
  owner: TransactionSigner
  amount: Micro
}

// ATA базового токена створює сама програма (`init_if_needed`), тож тут одна інструкція.
export async function buildFaucet({ owner, amount }: FaucetParams) {
  const mint = await mintAddress()
  return getFaucetInstructionAsync({ mint, owner, amount })
}
