import type { TransactionSigner } from '@solana/kit'
import { getCreatePoolInstructionAsync } from '../generated/index.ts'
import { mintAddress } from '../pda.ts'
import type { PoolParamsView } from '../view.ts'

export type CreatePoolParams = {
  operator: TransactionSigner
  id: number
  params: PoolParamsView
}

export async function buildCreatePool({ operator, id, params }: CreatePoolParams) {
  const mint = await mintAddress()
  // Поля перелічені явно, а не `...params`: зайве поле в об'єкті кодер проігнорує,
  // а відсутнє запише нулем — TypeScript має бачити кожне.
  return getCreatePoolInstructionAsync({
    operator,
    mint,
    id,
    yieldRateBps: params.yieldRateBps,
    seniorRateBps: params.seniorRateBps,
    minJuniorBps: params.minJuniorBps,
    perfFeeBps: params.perfFeeBps,
    timeScale: params.timeScale,
  })
}
