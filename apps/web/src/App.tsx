import type { AppConfig } from './config.ts'
import { MockWalletProvider } from './mock/wallet.tsx'
import { Router } from './router.tsx'

// Конфіг ще не використовується екранами M0 (мок-дані); RPC і програма підключаються в T009/T020.
export function App(_props: { config: AppConfig }) {
  return (
    <MockWalletProvider>
      <Router />
    </MockWalletProvider>
  )
}
