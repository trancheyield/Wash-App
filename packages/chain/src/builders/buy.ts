import type { TransactionSigner } from '@solana/kit'
import type { Micro } from '@washapp/shared'
import { getBuyProtectionInstruction } from '../generated/index.ts'
import { contractAddress } from '../pda.ts'
import { ataAddress } from '../read.ts'
import { protectionAccounts } from './protection-accounts.ts'

export type BuyParams = {
  buyer: TransactionSigner
  poolId: number
  notional: Micro
  // Model seconds, like the pool clock: 30 model days = 2 592 000.
  term: bigint
  // `ProtectionView.contracts` at send time. A nonce already taken by this buyer fails
  // on the existing PDA; one taken by another buyer does not collide — the PDA has the buyer.
  nonce: bigint
}

export async function buildBuy({ buyer, poolId, notional, term, nonce }: BuyParams) {
  const accounts = await protectionAccounts(poolId)
  const [buyerAta, contract] = await Promise.all([
    ataAddress(buyer.address, accounts.mint),
    contractAddress(accounts.pool, buyer.address, nonce),
  ])
  return getBuyProtectionInstruction({
    ...accounts,
    buyerAta,
    contract,
    buyer,
    notional,
    term,
    nonce,
  })
}
