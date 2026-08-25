import { ClientProvider, SelectedWalletAccountContextProvider } from '@solana/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'
import type { AppConfig } from './config.ts'
import { createAppClient } from './rpc.ts'
import { filterWallets, safeStorage, selectedWalletStorage } from './wallets.ts'

const AppConfigContext = createContext<AppConfig | null>(null)

export function useAppConfig(): AppConfig {
  const config = useContext(AppConfigContext)
  if (!config) throw new Error('Providers missing')
  return config
}

// Опитування раз на 5 с — для всіх запитів до ланцюга (PLAN); екрани не
// повторюють інтервал самі. `retry: 1` — публічний devnet відповідає 429
// частіше, ніж падає, а другий запит через 5 с і так прийде.
export const POLL_MS = 5_000

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { refetchInterval: POLL_MS, staleTime: POLL_MS, retry: 1 },
    },
  })
}

export function Providers({ config, children }: { config: AppConfig; children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient)
  const client = useMemo(() => createAppClient(config), [config])
  const walletFilter = useMemo(() => filterWallets(config.chain), [config.chain])
  const [stateSync] = useState(() => selectedWalletStorage(safeStorage()))
  return (
    <AppConfigContext.Provider value={config}>
      <QueryClientProvider client={queryClient}>
        <ClientProvider client={client}>
          <SelectedWalletAccountContextProvider filterWallets={walletFilter} stateSync={stateSync}>
            {children}
          </SelectedWalletAccountContextProvider>
        </ClientProvider>
      </QueryClientProvider>
    </AppConfigContext.Provider>
  )
}
