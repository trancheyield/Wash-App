import { type Address, isAddress } from '@solana/kit'
import { z } from 'zod'

export type { Address }

export const addressSchema = z.string().transform((value, ctx): Address => {
  if (isAddress(value)) return value
  ctx.addIssue({ code: 'custom', message: 'not a base58 address of 32 bytes' })
  return z.NEVER
})
