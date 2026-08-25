import { describe, expect, it } from 'vitest'
import {
  filterWallets,
  SELECTED_WALLET_KEY,
  selectedWalletStorage,
  shortAddress,
  type WalletShape,
} from './wallets.ts'

const wallet = (chains: string[], features: string[]): WalletShape =>
  ({ chains, features }) as unknown as WalletShape

describe('filterWallets', () => {
  const onDevnet = filterWallets('solana:devnet')

  it('keeps a wallet that serves the chain and can sign-and-send', () => {
    expect(
      onDevnet(
        wallet(
          ['solana:mainnet', 'solana:devnet'],
          ['standard:connect', 'solana:signAndSendTransaction'],
        ),
      ),
    ).toBe(true)
  })

  it('drops a wallet on another chain', () => {
    expect(onDevnet(wallet(['solana:mainnet'], ['solana:signAndSendTransaction']))).toBe(false)
  })

  it('drops a wallet that can only sign without sending', () => {
    expect(onDevnet(wallet(['solana:devnet'], ['solana:signTransaction']))).toBe(false)
  })

  it('is keyed on the configured chain', () => {
    const w = wallet(['solana:localnet'], ['solana:signAndSendTransaction'])
    expect(onDevnet(w)).toBe(false)
    expect(filterWallets('solana:localnet')(w)).toBe(true)
  })
})

describe('shortAddress', () => {
  it('keeps the ends of a base58 address', () => {
    expect(shortAddress('2Yq39tVgTH5e8be8YdssyhvM6339f2WG6QweNmxGpBbf')).toBe('2Yq3…pBbf')
  })

  it('leaves a short label alone', () => {
    expect(shortAddress('abc')).toBe('abc')
  })
})

describe('selectedWalletStorage', () => {
  it('reads, writes and deletes one key only', () => {
    const store = new Map<string, string>()
    const sync = selectedWalletStorage({
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    })
    expect(sync.getSelectedWallet()).toBeNull()
    sync.storeSelectedWallet('Phantom:abc')
    expect([...store.keys()]).toEqual([SELECTED_WALLET_KEY])
    expect(sync.getSelectedWallet()).toBe('Phantom:abc')
    sync.deleteSelectedWallet()
    expect(store.size).toBe(0)
  })
})
