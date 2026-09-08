// Відправка транзакції з браузера: підписант wallet-standard сам підписує і шле
// (`signAndSendTransaction`), нам повертається лише підпис — підтвердження чекаємо
// опитуванням `getSignatureStatuses`: WebSocket-підписок клієнт не має (`rpc.ts`), а
// публічний devnet їх і не тримає. Одна транзакція = один виклик.

import {
  appendTransactionMessageInstructions,
  signature as asSignature,
  type Commitment,
  createTransactionMessage,
  type GetBlockHeightApi,
  type GetLatestBlockhashApi,
  type GetSignatureStatusesApi,
  getBase58Decoder,
  type Instruction,
  pipe,
  type Rpc,
  type Signature,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
  type TransactionError,
  type TransactionSendingSigner,
} from '@solana/kit'

export type SendRpc = Rpc<GetLatestBlockhashApi & GetSignatureStatusesApi & GetBlockHeightApi>

export type ConfirmOptions = {
  pollMs?: number
  signal?: AbortSignal
}

export class TransactionFailedError extends Error {
  readonly signature: Signature
  constructor(signature: Signature, cause: unknown) {
    super(`transaction ${signature} failed: ${JSON.stringify(cause)}`, { cause })
    this.name = 'TransactionFailedError'
    this.signature = signature
  }
}

export class TransactionExpiredError extends Error {
  readonly signature: Signature
  constructor(signature: Signature) {
    super(`transaction ${signature} expired before confirmation`)
    this.name = 'TransactionExpiredError'
    this.signature = signature
  }
}

// Достатня частина відповіді `getSignatureStatuses`; `null` — підпису ще не видно.
type SignatureStatus = Readonly<{
  confirmationStatus: Commitment | null
  err: TransactionError | null
}> | null

// `exactOptionalPropertyTypes`: kit не приймає `abortSignal: undefined`, лише відсутність.
function abortable(signal?: AbortSignal): { abortSignal?: AbortSignal } {
  return signal ? { abortSignal: signal } : {}
}

export type Outcome = 'pending' | 'confirmed' | 'failed'

// `processed` ще може відкотитися; рахуємо лише `confirmed`/`finalized`, як демо-скрипт.
export function outcomeOf(status: SignatureStatus): Outcome {
  if (!status) return 'pending'
  if (status.err !== null) return 'failed'
  return status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized'
    ? 'confirmed'
    : 'pending'
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

// Чекає `confirmed`; відмова транзакції — помилка з `err` ланцюга, вихід висоти блоку за
// `lastValidBlockHeight` — «застаріла» (гаманець не надіслав або мережа не взяла).
export async function waitForConfirmation(
  rpc: Pick<SendRpc, 'getSignatureStatuses' | 'getBlockHeight'>,
  signature: Signature,
  lastValidBlockHeight: bigint,
  { pollMs = 1_000, signal }: ConfirmOptions = {},
): Promise<void> {
  for (;;) {
    const { value } = await rpc.getSignatureStatuses([signature]).send(abortable(signal))
    const status = value[0] ?? null
    const outcome = outcomeOf(status)
    if (outcome === 'confirmed') return
    if (outcome === 'failed') throw new TransactionFailedError(signature, status?.err)
    const height = await rpc.getBlockHeight({ commitment: 'confirmed' }).send(abortable(signal))
    if (height > lastValidBlockHeight) throw new TransactionExpiredError(signature)
    await sleep(pollMs, signal)
  }
}

// Blockhash — `finalized`, як у `tools/demo`: на `confirmed` Helius час від часу відповідає
// «Blockhash not found», а гаманець ще й симулює транзакцію перед підписом.
export async function sendInstructions(
  rpc: SendRpc,
  signer: TransactionSendingSigner,
  instructions: readonly Instruction[],
  options: ConfirmOptions = {},
): Promise<Signature> {
  const { value: blockhash } = await rpc
    .getLatestBlockhash({ commitment: 'finalized' })
    .send(abortable(options.signal))
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  )
  const bytes = await signAndSendTransactionMessageWithSigners(message, abortable(options.signal))
  const signature = asSignature(getBase58Decoder().decode(bytes))
  await waitForConfirmation(rpc, signature, blockhash.lastValidBlockHeight, options)
  return signature
}
