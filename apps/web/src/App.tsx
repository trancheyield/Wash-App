import type { AppConfig } from './config.ts'

// Екрани приходять з переносу прототипу M0; до того оболонка показує лише конфіг.
export function App({ config }: { config: AppConfig }) {
  return (
    <main className="min-h-screen bg-ground p-6 font-sans text-ink">
      <h1 className="text-2xl">Wash App</h1>
      <p className="mt-2 font-mono text-sm text-muted">
        program {config.programId} · pool {config.defaultPool}
      </p>
    </main>
  )
}
