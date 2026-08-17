import { addressSchema } from '@washapp/shared'
import { z } from 'zod'

// Сценарій і init читають `.env` кореня через `node --env-file`; RPC тут
// обов'язковий — публічний devnet ріже серію відправок.
export const demoEnvSchema = z.object({
  SOLANA_RPC_URL: z.string().url(),
  WASH_PROGRAM_ID: addressSchema,
  WASH_KEYS_DIR: z.string().trim().min(1),
})

export type DemoEnv = z.infer<typeof demoEnvSchema>
