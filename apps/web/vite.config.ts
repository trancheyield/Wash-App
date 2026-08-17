import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // The codama client gates its error messages on `process.env["NODE_ENV"]`, and the
  // browser has no `process`.
  define: { 'process.env': JSON.stringify({ NODE_ENV: mode }) },
  build: { target: 'esnext' },
  // One `.env` at the repo root for every app; Vite still exposes only `VITE_*`.
  envDir: '../..',
  server: { port: 5173 },
}))
