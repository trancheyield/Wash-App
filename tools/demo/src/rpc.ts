import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  type Instruction,
  pipe,
  type Rpc,
  type RpcSubscriptions,
  type Signature,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type TransactionSigner,
} from '@solana/kit'

export type DemoRpc = {
  rpc: Rpc<SolanaRpcApi>
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>
}

// Helius віддає WebSocket на тому самому хості з тим самим ключем у query.
export function wsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, 'ws')
}

export function createDemoRpc(url: string): DemoRpc {
  return {
    rpc: createSolanaRpc(url),
    rpcSubscriptions: createSolanaRpcSubscriptions(wsUrl(url)),
  }
}

// Одна транзакція = одна відправка: Helius Free пропускає ~1 sendTransaction/с,
// тож кроки демо йдуть послідовно й кожен чекає підтвердження. Blockhash —
// `finalized`: на `confirmed` Helius час від часу відповідає «Blockhash not found».
export async function sendInstructions(
  { rpc, rpcSubscriptions }: DemoRpc,
  payer: TransactionSigner,
  instructions: readonly Instruction[],
): Promise<Signature> {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'finalized' }).send()
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  )
  const transaction = await signTransactionMessageWithSigners(message)
  // Підпис повертає union lifetime-ів; blockhash-гілку звужуємо явно.
  assertIsTransactionWithBlockhashLifetime(transaction)
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })
  await sendAndConfirm(transaction, { commitment: 'confirmed' })
  return getSignatureFromTransaction(transaction)
}
