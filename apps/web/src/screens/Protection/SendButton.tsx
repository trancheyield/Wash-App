import type { Instruction, TransactionSendingSigner } from '@solana/kit'
import { useClient, useWalletAccountTransactionSendingSigner } from '@solana/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UiWalletAccount } from '@wallet-standard/react'
import type { PoolView } from '@washapp/chain'
import { Btn, Refused } from '../../components/chrome.tsx'
import { useAppConfig } from '../../providers.tsx'
import { poolQueryKey } from '../../queries/pool.ts'
import { protectionQueryKey } from '../../queries/protection.ts'
import { walletQueryKey } from '../../queries/wallet.ts'
import type { AppClient } from '../../rpc.ts'
import { explainSendError } from '../../tx/errors.ts'
import { sendInstructions } from '../../tx/send.ts'

// One confirmed action of the desk — the "confirmed …" line and the SC-001 timer:
// click → `confirmed` on the chain → the refreshed pool, market and wallet on screen.
export type Sent = {
  what: string
  signature: string
  confirmedMs: number
  refreshedMs: number
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

type Props = {
  account: UiWalletAccount
  pool: PoolView
  label: string
  // What the confirmed line says was done, e.g. "bought 1,000.00 WUSD of cover".
  what: string
  primary?: boolean
  disabled: boolean
  build: (signer: TransactionSendingSigner) => Promise<readonly Instruction[]>
  onDone: (sent: Sent) => void
}

// A separate component per button: `useWalletAccountTransactionSendingSigner` needs an
// account, and each button keeps its own pending state and error.
export function SendButton({
  account,
  pool,
  label,
  what,
  primary,
  disabled,
  build,
  onDone,
}: Props) {
  const { chain } = useAppConfig()
  const signer = useWalletAccountTransactionSendingSigner(account, chain)
  const client = useClient<AppClient>()
  const queryClient = useQueryClient()
  const send = useMutation({
    mutationFn: async (): Promise<Sent> => {
      const t0 = performance.now()
      const signature = await sendInstructions(client.rpc, signer, await build(signer))
      const confirmedMs = performance.now() - t0
      // Waits for the refetch of the active queries — the moment the screen shows it.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: poolQueryKey(pool.id) }),
        queryClient.invalidateQueries({ queryKey: protectionQueryKey(pool.address) }),
        queryClient.invalidateQueries({ queryKey: walletQueryKey(pool.address, account.address) }),
      ])
      const refreshedMs = performance.now() - t0
      if (import.meta.env.DEV) {
        console.info(
          `[SC-001] ${what}: confirmed ${seconds(confirmedMs)} · screen refreshed ${seconds(refreshedMs)} · tx ${signature}`,
        )
      }
      return { what, signature, confirmedMs, refreshedMs }
    },
    onSuccess: onDone,
  })
  return (
    <>
      <Btn
        label={send.isPending ? 'waiting for the wallet…' : label}
        primary={primary ?? false}
        disabled={disabled || send.isPending}
        onClick={() => send.mutate()}
      />
      {send.isError ? <Refused>{explainSendError(send.error)}</Refused> : null}
    </>
  )
}
