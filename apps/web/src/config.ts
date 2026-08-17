import { addressSchema } from '@washapp/shared'
import { z } from 'zod'

const envSchema = z.object({
  VITE_SOLANA_RPC_URL: z
    .string()
    .trim()
    .prefault('')
    .transform((url) => (url === '' ? 'https://api.devnet.solana.com' : url)),
  VITE_WASH_PROGRAM_ID: addressSchema,
  VITE_WASH_DEFAULT_POOL: z.coerce.number().int().min(0).max(65_535).prefault(0),
})

export type AppConfig = {
  rpcUrl: string
  programId: z.infer<typeof envSchema>['VITE_WASH_PROGRAM_ID']
  defaultPool: number
}

export function readConfig(env: Record<string, unknown>): AppConfig {
  const parsed = envSchema.parse(env)
  return {
    rpcUrl: parsed.VITE_SOLANA_RPC_URL,
    programId: parsed.VITE_WASH_PROGRAM_ID,
    defaultPool: parsed.VITE_WASH_DEFAULT_POOL,
  }
}
