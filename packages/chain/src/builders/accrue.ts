import { getAccrueInstruction } from '../generated/index.ts'
import { poolAccounts } from './pool-accounts.ts'

export type AccrueParams = {
  poolId: number
}

// Без підписанта — crank може крутити будь-хто (оператор у панелі, сценарій демо).
export async function buildAccrue({ poolId }: AccrueParams) {
  return getAccrueInstruction(await poolAccounts(poolId))
}
