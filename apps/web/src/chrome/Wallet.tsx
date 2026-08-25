import { useClient, useSelectedWalletAccount } from '@solana/react'
import { useRequestQuery } from '@solana/react/query'
import {
  type UiWallet,
  type UiWalletAccount,
  uiWalletAccountBelongsToUiWallet,
  useConnect,
  useDisconnect,
} from '@wallet-standard/react'
import { useMemo, useState } from 'react'
import type { AppClient } from '../rpc.ts'
import { shortAddress } from '../wallets.ts'

export type WalletState = {
  account: UiWalletAccount | undefined
  address: string | null
}

// Єдина точка, звідки екрани дізнаються про гаманець; підписант для T021
// береться з `account` через `useWalletAccountTransactionSendingSigner`.
export function useWallet(): WalletState {
  const [account] = useSelectedWalletAccount()
  return { account, address: account?.address ?? null }
}

function useSlot() {
  const client = useClient<AppClient>()
  const source = useMemo(() => client.rpc.getSlot({ commitment: 'confirmed' }), [client])
  return useRequestQuery(['slot'], source, { getAbortSignal: () => AbortSignal.timeout(4_000) })
}

function SlotCell() {
  const { data, error } = useSlot()
  if (error) return <span className="text-refused">RPC OFFLINE</span>
  return <span className="text-sec">SLOT {data === undefined ? '—' : data.toString()}</span>
}

function ConnectButton({ wallet, onError }: { wallet: UiWallet; onError: (e: unknown) => void }) {
  const [, setAccount] = useSelectedWalletAccount()
  const [isConnecting, connect] = useConnect(wallet)
  return (
    <button
      type="button"
      className="lbl hover:text-ink disabled:opacity-40"
      disabled={isConnecting}
      onClick={() => {
        connect()
          .then((accounts) => setAccount(accounts[0]))
          .catch(onError)
      }}
    >
      {isConnecting ? `${wallet.name}…` : `connect ${wallet.name}`}
    </button>
  )
}

function DisconnectButton({
  wallet,
  onError,
}: {
  wallet: UiWallet
  onError: (e: unknown) => void
}) {
  const [, setAccount] = useSelectedWalletAccount()
  const [isDisconnecting, disconnect] = useDisconnect(wallet)
  return (
    <button
      type="button"
      className="lbl hover:text-ink disabled:opacity-40"
      disabled={isDisconnecting}
      onClick={() => {
        disconnect()
          .then(() => setAccount(undefined))
          .catch(onError)
      }}
    >
      disconnect
    </button>
  )
}

export function WalletRow() {
  const [account, , wallets] = useSelectedWalletAccount()
  const [error, setError] = useState<string | null>(null)
  const owner = account
    ? wallets.find((w) => uiWalletAccountBelongsToUiWallet(account, w))
    : undefined

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px]">
      <SlotCell />
      {account ? (
        <>
          <span title={account.address}>{shortAddress(account.address)}</span>
          {owner ? <DisconnectButton wallet={owner} onError={(e) => setError(String(e))} /> : null}
        </>
      ) : wallets.length === 0 ? (
        <span className="text-sec">no wallet found</span>
      ) : (
        wallets.map((w) => (
          <ConnectButton key={w.name} wallet={w} onError={(e) => setError(String(e))} />
        ))
      )}
      {error ? <span className="text-refused">{error}</span> : null}
    </div>
  )
}
