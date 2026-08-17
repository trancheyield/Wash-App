import { z } from 'zod'

// Усі суми в системі — цілі мікро-одиниці (6 знаків) у `bigint`. `Number` тут не
// з'являється: 2^53 менше за u64, і округлення сховало б розбіжність з ланцюгом.
export const DECIMALS = 6
const ONE = 10n ** BigInt(DECIMALS)
const U64_MAX = 2n ** 64n - 1n

export type Micro = bigint

const AMOUNT_TEXT = /^(\d+)(?:\.(\d{1,6}))?$/

export function parseAmount(text: string): Micro | null {
  const match = AMOUNT_TEXT.exec(text.trim().replaceAll(',', ''))
  if (!match) return null
  const whole = match[1] ?? '0'
  const fraction = (match[2] ?? '').padEnd(DECIMALS, '0')
  const value = BigInt(whole) * ONE + BigInt(fraction)
  return value > U64_MAX ? null : value
}

export function formatAmount(value: Micro, fractionDigits = 2): string {
  const whole = value / ONE
  const fraction = (value % ONE).toString().padStart(DECIMALS, '0').slice(0, fractionDigits)
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fractionDigits > 0 ? `${grouped}.${fraction}` : grouped
}

export const amountSchema = z
  .string()
  .transform((text, ctx): Micro => {
    const value = parseAmount(text)
    if (value === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'amount must be a positive number with up to 6 decimals',
      })
      return z.NEVER
    }
    return value
  })
  .refine((value) => value > 0n, { message: 'amount must be greater than zero' })
