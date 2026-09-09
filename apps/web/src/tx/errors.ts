import { getWashappErrorMessage, type WashappError } from '@washapp/chain'
import { TransactionExpiredError, TransactionFailedError } from './send.ts'

// Коди Anchor-помилок програми починаються з 6000; нижче — системні й SPL Token.
const ANCHOR_CUSTOM_BASE = 6000
const ANCHOR_CUSTOM_MAX = 6999

// `err` ланцюга має форму `{ InstructionError: [index, { Custom: code }] }`; інші
// варіанти (`InsufficientFundsForRent`, рядкові коди) лишаємо як є.
function customCode(cause: unknown): number | null {
  if (typeof cause !== 'object' || cause === null) return null
  const detail = (cause as { InstructionError?: unknown }).InstructionError
  if (!Array.isArray(detail) || detail.length !== 2) return null
  const inner = detail[1]
  if (typeof inner !== 'object' || inner === null) return null
  const code = (inner as { Custom?: unknown }).Custom
  return typeof code === 'number' ? code : null
}

// Текст для рядка відмови: назва помилки програми, а не JSON з `getSignatureStatuses`.
export function explainSendError(error: unknown): string {
  if (error instanceof TransactionExpiredError) {
    return 'transaction expired before confirmation — the wallet may not have sent it; try again'
  }
  if (error instanceof TransactionFailedError) {
    const code = customCode(error.cause)
    if (code !== null && code >= ANCHOR_CUSTOM_BASE && code <= ANCHOR_CUSTOM_MAX) {
      return `refused by the program: ${getWashappErrorMessage(code as WashappError)}`
    }
    if (code !== null) return `transaction failed with program error ${code}`
    return `transaction failed: ${JSON.stringify(error.cause)}`
  }
  if (error instanceof Error) return error.message
  return String(error)
}
