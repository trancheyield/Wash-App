import type { TransactionSigner } from '@solana/kit'
import { getCreateAssociatedTokenIdempotentInstruction } from '@solana-program/token'
import type { Micro } from '@washapp/shared'
import { getDepositInstruction, type Tranche } from '../generated/index.ts'
import { ataAddress } from '../read.ts'
import { poolAccounts, trancheMint } from './pool-accounts.ts'

export type DepositParams = {
  owner: TransactionSigner
  poolId: number
  tranche: Tranche
  amount: Micro
}

// Пара інструкцій в одній транзакції: ATA траншу створює клієнт, бо `init_if_needed`
// у програмі не вмістився в кадр 4 КіБ (PLAN, ризик #1). Idempotent — повторний
// депозит не падає на вже відкритому ATA. ATA базового токена вже є після faucet.
export async function buildDeposit({ owner, poolId, tranche, amount }: DepositParams) {
  const accounts = await poolAccounts(poolId)
  const mint = trancheMint(accounts, tranche)
  const [ownerAta, ownerTrancheAta] = await Promise.all([
    ataAddress(owner.address, accounts.mint),
    ataAddress(owner.address, mint),
  ])
  const createAta = getCreateAssociatedTokenIdempotentInstruction({
    payer: owner,
    ata: ownerTrancheAta,
    owner: owner.address,
    mint,
  })
  const deposit = getDepositInstruction({
    ...accounts,
    ownerAta,
    ownerTrancheAta,
    owner,
    tranche,
    amount,
  })
  return [createAta, deposit] as const
}
