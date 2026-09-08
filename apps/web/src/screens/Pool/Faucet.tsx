import { useClient, useWalletAccountTransactionSendingSigner } from '@solana/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UiWalletAccount } from '@wallet-standard/react'
import { buildFaucet, type PoolView } from '@washapp/chain'
import { formatAmount, type Micro } from '@washapp/shared'
import { useWallet } from '../../chrome/Wallet.tsx'
import { Btn, Refused } from '../../components/chrome.tsx'
import { useAppConfig } from '../../providers.tsx'
import { poolQueryKey } from '../../queries/pool.ts'
import { useWalletBalances, walletQueryKey } from '../../queries/wallet.ts'
import type { AppClient } from '../../rpc.ts'
import { TOKEN } from '../../tokens.ts'
import { sendInstructions } from '../../tx/send.ts'
import { shortAddress } from '../../wallets.ts'

// Одне натискання — 1 000 WUSD (бриф M0); стеля програми `faucet_cap` вища, але
// демо-суми мають лишатися читабельними.
export const FAUCET_AMOUNT: Micro = 1_000_000_000n

function RequestButton({ account, pool }: { account: UiWalletAccount; pool: PoolView }) {
  const { chain } = useAppConfig()
  const signer = useWalletAccountTransactionSendingSigner(account, chain)
  const client = useClient<AppClient>()
  const queryClient = useQueryClient()
  const request = useMutation({
    mutationFn: async () => {
      const ix = await buildFaucet({ owner: signer, amount: FAUCET_AMOUNT })
      return sendInstructions(client.rpc, signer, [ix])
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: walletQueryKey(pool.address, account.address) }),
        queryClient.invalidateQueries({ queryKey: poolQueryKey(pool.id) }),
      ]),
  })
  return (
    <div className="flex flex-col items-end gap-1">
      <Btn
        label={request.isPending ? 'requesting…' : 'Request'}
        disabled={request.isPending}
        onClick={() => request.mutate()}
      />
      {request.isSuccess ? (
        <span className="text-[11px] text-sec">
          minted {formatAmount(FAUCET_AMOUNT)} {TOKEN} · tx {shortAddress(request.data)}
        </span>
      ) : null}
      {request.isError ? <Refused>{String(request.error.message)}</Refused> : null}
    </div>
  )
}

// Рядок faucet під кнопками пулу: без гаманця — лише підпис; з гаманцем — його баланс
// базового токена і кнопка. Баланс тут, бо інакше результат карбування невидимий.
export function FaucetRow({ pool }: { pool: PoolView }) {
  const { account, address } = useWallet()
  const balances = useWalletBalances(pool, address)
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 text-[11px] text-sec">
      <span className="flex flex-col">
        <span>
          devnet faucet: {formatAmount(FAUCET_AMOUNT)} {TOKEN} per request
        </span>
        {account ? (
          <span>
            your balance: {balances.data ? `${formatAmount(balances.data.base)} ${TOKEN}` : '—'}
          </span>
        ) : (
          <span>connect a wallet to request</span>
        )}
      </span>
      {account ? <RequestButton account={account} pool={pool} /> : null}
    </div>
  )
}
