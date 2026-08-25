import type { UiWallet, UiWalletAccount } from '@wallet-standard/react'
import type { SolanaChain } from './config.ts'

// Один рядок у localStorage — ключ обраного акаунта wallet-standard, більше нічого.
export const SELECTED_WALLET_KEY = 'washapp:selected-wallet'

// Підпис у T021 іде через `signAndSendTransaction`; гаманець без нього або без
// нашого ланцюга у списку лише вводив би в оману.
export const SIGN_AND_SEND = 'solana:signAndSendTransaction'

export type WalletShape = Pick<UiWallet, 'chains' | 'features'>

export function filterWallets(chain: SolanaChain): (wallet: WalletShape) => boolean {
  return (wallet) => wallet.chains.includes(chain) && wallet.features.includes(SIGN_AND_SEND)
}

export function shortAddress(address: string, keep = 4): string {
  return address.length <= keep * 2 + 1
    ? address
    : `${address.slice(0, keep)}…${address.slice(-keep)}`
}

export function selectedWalletStorage(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
) {
  return {
    getSelectedWallet: () => storage.getItem(SELECTED_WALLET_KEY),
    storeSelectedWallet: (key: string) => storage.setItem(SELECTED_WALLET_KEY, key),
    deleteSelectedWallet: () => storage.removeItem(SELECTED_WALLET_KEY),
  }
}

// localStorage у приватному вікні або за політикою може кидати — тоді вибір
// гаманця живе лише до перезавантаження, а застосунок не падає.
export function safeStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const memory = new Map<string, string>()
  const fallback = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  }
  try {
    const probe = '__washapp_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    return fallback
  }
}

export type { UiWalletAccount }
