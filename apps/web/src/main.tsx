import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { readConfig } from './config.ts'
import './index.css'

const config = readConfig(import.meta.env)
const root = document.getElementById('root')
if (!root) throw new Error('missing #root')
createRoot(root).render(
  <StrictMode>
    <App config={config} />
  </StrictMode>,
)
