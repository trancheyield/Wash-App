import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'
import { OPERATOR, WALLET } from './data.ts'

// Мок-гаманець M0: «disconnect» скидає адресу, «connect» повертає; кнопка на аркуші
// збитку перемикає на гаманець оператора. Замінюється wallet-standard у T009.
export type MockWallet = {
  address: string | null
  isOperator: boolean
  toggle: () => void
  asOperator: (on: boolean) => void
}

const MockWalletContext = createContext<MockWallet | null>(null)

export function MockWalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(WALLET)
  const value = useMemo<MockWallet>(
    () => ({
      address,
      isOperator: address === OPERATOR,
      toggle: () => setAddress((a) => (a ? null : WALLET)),
      asOperator: (on) => setAddress(on ? OPERATOR : WALLET),
    }),
    [address],
  )
  return <MockWalletContext.Provider value={value}>{children}</MockWalletContext.Provider>
}

export function useMockWallet(): MockWallet {
  const wallet = useContext(MockWalletContext)
  if (!wallet) throw new Error('MockWalletProvider missing')
  return wallet
}
