import type { TransactionSigner } from '@solana/kit'
import { getRecordLossInstruction } from '../generated/index.ts'
import { lossEventAddress } from '../pda.ts'
import { poolAccounts } from './pool-accounts.ts'

export type RecordLossParams = {
  operator: TransactionSigner
  poolId: number
  lossBps: number
  // Індекс нової події = `Pool.lossCount` на момент відправки: PDA виводиться
  // з нього, а програма відмовить, якщо він уже зайнятий (гонка двох записів).
  index: number
}

export async function buildRecordLoss({ operator, poolId, lossBps, index }: RecordLossParams) {
  const accounts = await poolAccounts(poolId)
  const lossEvent = await lossEventAddress(accounts.pool, index)
  return getRecordLossInstruction({ ...accounts, lossEvent, operator, lossBps })
}
