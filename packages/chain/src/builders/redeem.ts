import type { TransactionSigner } from '@solana/kit'
import { getCreateAssociatedTokenIdempotentInstruction } from '@solana-program/token'
import type { Micro } from '@washapp/shared'
import { getRedeemInstruction, type Tranche } from '../generated/index.ts'
import { ataAddress } from '../read.ts'
import { poolAccounts, trancheMint } from './pool-accounts.ts'

export type RedeemParams = {
  owner: TransactionSigner
  poolId: number
  tranche: Tranche
  shares: Micro
}

// Дзеркало `buildDeposit`: тут може бракувати ATA базового токена (частки могли
// прийти переказом), тому idempotent-створення — для нього; ATA траншу вже є, бо
// на ньому лежать частки.
export async function buildRedeem({ owner, poolId, tranche, shares }: RedeemParams) {
  const accounts = await poolAccounts(poolId)
  const [ownerAta, ownerTrancheAta] = await Promise.all([
    ataAddress(owner.address, accounts.mint),
    ataAddress(owner.address, trancheMint(accounts, tranche)),
  ])
  const createAta = getCreateAssociatedTokenIdempotentInstruction({
    payer: owner,
    ata: ownerAta,
    owner: owner.address,
    mint: accounts.mint,
  })
  const redeem = getRedeemInstruction({
    ...accounts,
    ownerAta,
    ownerTrancheAta,
    owner,
    tranche,
    shares,
  })
  return [createAta, redeem] as const
}
