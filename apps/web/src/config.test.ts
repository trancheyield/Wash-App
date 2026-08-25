import { describe, expect, it } from 'vitest'
import { readConfig } from './config.ts'

const PROGRAM = '2Yq39tVgTH5e8be8YdssyhvM6339f2WG6QweNmxGpBbf'

describe('readConfig', () => {
  it('falls back to public devnet and pool 0 when optional vars are absent', () => {
    const config = readConfig({ VITE_WASH_PROGRAM_ID: PROGRAM })
    expect(config.rpcUrl).toBe('https://api.devnet.solana.com')
    expect(config.defaultPool).toBe(0)
    expect(config.programId).toBe(PROGRAM)
    expect(config.chain).toBe('solana:devnet')
  })

  it('takes a known chain id and refuses an unknown one', () => {
    expect(readConfig({ VITE_SOLANA_CHAIN: 'solana:localnet' }).chain).toBe('solana:localnet')
    expect(() => readConfig({ VITE_SOLANA_CHAIN: 'devnet' })).toThrow()
  })

  it('takes an explicit RPC and pool id', () => {
    const config = readConfig({
      VITE_WASH_PROGRAM_ID: PROGRAM,
      VITE_SOLANA_RPC_URL: ' https://rpc.example ',
      VITE_WASH_DEFAULT_POOL: '3',
    })
    expect(config.rpcUrl).toBe('https://rpc.example')
    expect(config.defaultPool).toBe(3)
  })

  it('refuses a malformed program id and defaults to declare_id when absent', () => {
    expect(() => readConfig({ VITE_WASH_PROGRAM_ID: 'nope' })).toThrow()
    expect(readConfig({}).programId).toBe(PROGRAM)
  })
})
