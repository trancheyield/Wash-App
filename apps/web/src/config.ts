import { WASHAPP_PROGRAM_ADDRESS } from '@washapp/chain'
import { addressSchema } from '@washapp/shared'
import { z } from 'zod'

const envSchema = z.object({
  VITE_SOLANA_RPC_URL: z
    .string()
    .trim()
    .prefault('')
    .transform((url) => (url === '' ? 'https://api.devnet.solana.com' : url)),
  // Порожньо → адреса з `declare_id!` (та сама константа, що в клієнті ланцюга).
  VITE_WASH_PROGRAM_ID: z.string().trim().prefault(WASHAPP_PROGRAM_ADDRESS).pipe(addressSchema),
  VITE_WASH_DEFAULT_POOL: z.coerce.number().int().min(0).max(65_535).prefault(0),
  // Ідентифікатор ланцюга wallet-standard — явно, не з URL: у Helius і в локального
  // валідатора слова «devnet» у хості однаково немає.
  VITE_SOLANA_CHAIN: z
    .enum(['solana:devnet', 'solana:testnet', 'solana:mainnet', 'solana:localnet'])
    .prefault('solana:devnet'),
})

export type SolanaChain = z.infer<typeof envSchema>['VITE_SOLANA_CHAIN']

export type AppConfig = {
  rpcUrl: string
  programId: z.infer<typeof envSchema>['VITE_WASH_PROGRAM_ID']
  defaultPool: number
  chain: SolanaChain
}

// The Pages build passes every repository variable, set or not, and an unset one arrives as
// ''. Blank must mean "use the default", otherwise an empty program id fails the address check.
function dropBlank(env: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => !(typeof value === 'string' && value.trim() === '')),
  )
}

export function readConfig(env: Record<string, unknown>): AppConfig {
  const parsed = envSchema.parse(dropBlank(env))
  return {
    rpcUrl: parsed.VITE_SOLANA_RPC_URL,
    programId: parsed.VITE_WASH_PROGRAM_ID,
    defaultPool: parsed.VITE_WASH_DEFAULT_POOL,
    chain: parsed.VITE_SOLANA_CHAIN,
  }
}
