// Білдери інструкцій: типізовані параметри (`bigint` для сум), підписант —
// `TransactionSigner`, щоб та сама інструкція йшла і через wallet-standard у
// браузері, і через `KeyPairSigner` у `tools/demo`. Кожен білдер має round-trip
// decode-тест, бо кодери kit пишуть `undefined` як 0.

import type { TransactionSigner } from '@solana/kit'
import type { Micro } from '@washapp/shared'
import { getInitConfigInstructionAsync } from '../generated/index.ts'

export type InitConfigParams = {
  authority: TransactionSigner
  faucetCap: Micro
}

export async function buildInitConfig({ authority, faucetCap }: InitConfigParams) {
  return getInitConfigInstructionAsync({ authority, faucetCap })
}
