import type { Address } from '@solana/kit'
import { useClient } from '@solana/react'
import { useQuery } from '@tanstack/react-query'
import { type PoolView, type ProtectionView, readProtection } from '@washapp/chain'
import type { AppClient } from '../rpc.ts'

export const protectionQueryKey = (pool: Address | null) => ['protection', pool] as const

// `null` — the pool has no protection market (`init_protection` was never sent); an RPC
// failure is in `error`. Polled with the `QueryClient` default, like the pool.
export function useProtection(pool: PoolView | null | undefined) {
  const client = useClient<AppClient>()
  return useQuery<ProtectionView | null>({
    queryKey: protectionQueryKey(pool?.address ?? null),
    queryFn: () => {
      if (!pool) throw new Error('protection query without a pool')
      return readProtection(client.rpc, pool.address)
    },
    enabled: Boolean(pool),
  })
}
