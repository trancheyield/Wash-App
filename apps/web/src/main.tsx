import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { canonicalPath } from './canonical-path.ts'
import { readConfig } from './config.ts'
import './index.css'

const { pathname, search, hash } = window.location
const canonical = canonicalPath(pathname, import.meta.env.BASE_URL)
if (canonical !== pathname)
  window.history.replaceState(window.history.state, '', canonical + search + hash)

const config = readConfig(import.meta.env)
const root = document.getElementById('root')
if (!root) throw new Error('missing #root')
createRoot(root).render(
  <StrictMode>
    <App config={config} />
  </StrictMode>,
)
