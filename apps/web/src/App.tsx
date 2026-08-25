import type { AppConfig } from './config.ts'
import { Providers } from './providers.tsx'
import { Router } from './router.tsx'

export function App({ config }: { config: AppConfig }) {
  return (
    <Providers config={config}>
      <Router />
    </Providers>
  )
}
