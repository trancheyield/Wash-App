import {
  type Client,
  type ClientWithRpc,
  createClient,
  createSolanaRpc,
  type SolanaRpcApi,
} from '@solana/kit'
import type { AppConfig } from './config.ts'

// Клієнт kit без плагінів: підписок немає — увесь стан читається опитуванням
// раз на 5 с (PLAN), а публічний devnet-RPC WebSocket-и ріже першим.
export type AppClient = Client<ClientWithRpc<SolanaRpcApi>>

export function createAppClient(config: Pick<AppConfig, 'rpcUrl'>): AppClient {
  return createClient({ rpc: createSolanaRpc(config.rpcUrl) })
}
