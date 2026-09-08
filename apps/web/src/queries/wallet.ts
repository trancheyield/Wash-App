import { type Address, address } from '@solana/kit'
import { useClient } from '@solana/react'
import { useQuery } from '@tanstack/react-query'
import { type PoolView, readWallet, type WalletView } from '@washapp/chain'
import type { AppClient } from '../rpc.ts'

export const walletQueryKey = (pool: Address | null, owner: string | null) =>
  ['wallet', pool, owner] as const

// Баланси гаманця в пулі: базовий токен і частки обох траншів. Без гаманця або без
// пулу запит не йде; ключ включає адресу пулу — в іншому пулі інші мінти.
export function useWalletBalances(pool: PoolView | null | undefined, owner: string | null) {
  const client = useClient<AppClient>()
  return useQuery<WalletView>({
    queryKey: walletQueryKey(pool?.address ?? null, owner),
    queryFn: () => {
      if (!pool || !owner) throw new Error('wallet query without pool or owner')
      return readWallet(client.rpc, pool, address(owner))
    },
    enabled: Boolean(pool && owner),
  })
}
