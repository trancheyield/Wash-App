import { useClient, useWalletAccountTransactionSendingSigner } from '@solana/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UiWalletAccount } from '@wallet-standard/react'
import {
  accruedView,
  buildDeposit,
  buildRedeem,
  type PoolView,
  trancheIndex,
  type WalletView,
} from '@washapp/chain'
import { formatAmount, type Micro, type Tranche } from '@washapp/shared'
import { type ReactNode, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Nav } from '../../chrome/Chrome.tsx'
import { useWallet } from '../../chrome/Wallet.tsx'
import { Cascade } from '../../components/Cascade.tsx'
import {
  Btn,
  Columns,
  Field,
  Pairs,
  Refused,
  Sheet,
  TitleBlock,
  useCompact,
} from '../../components/chrome.tsx'
import { formatBps, formatNav } from '../../format.ts'
import { formatScale, modelDay, useUnixNow } from '../../model-clock.ts'
import { useAppConfig } from '../../providers.tsx'
import { poolQueryKey } from '../../queries/pool.ts'
import { useWalletBalances, walletQueryKey } from '../../queries/wallet.ts'
import type { AppClient } from '../../rpc.ts'
import { TOKEN } from '../../tokens.ts'
import { explainSendError } from '../../tx/errors.ts'
import { sendInstructions } from '../../tx/send.ts'
import { shortAddress } from '../../wallets.ts'
import {
  type Mode,
  type PanelForm,
  type Preview,
  panelFormSchema,
  preview,
  trancheToken,
} from './preview.ts'

// Результат однієї операції — для рядка «confirmed …» і таймера SC-001: підпис →
// `confirmed` у мережі → оновлені NAV/баланс на екрані (після рефетчу запитів).
export type Outcome = {
  signature: string
  form: PanelForm
  receive: Micro
  modelDay: number
  confirmedMs: number
  refreshedMs: number
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

type SubmitProps = {
  account: UiWalletAccount
  pool: PoolView
  projected: PoolView
  mode: Mode
  form: PanelForm | null
  result: Preview
  ready: boolean
  onDone: (outcome: Outcome) => void
}

// Окремий компонент: `useWalletAccountTransactionSendingSigner` вимагає акаунта,
// а панель рендериться і без гаманця.
function SubmitButton({
  account,
  pool,
  projected,
  mode,
  form,
  result,
  ready,
  onDone,
}: SubmitProps) {
  const { chain } = useAppConfig()
  const signer = useWalletAccountTransactionSendingSigner(account, chain)
  const client = useClient<AppClient>()
  const queryClient = useQueryClient()
  const send = useMutation({
    mutationFn: async (input: { form: PanelForm; receive: Micro }): Promise<Outcome> => {
      const t0 = performance.now()
      const tranche = trancheIndex(input.form.tranche)
      const common = { owner: signer, poolId: pool.id, tranche }
      const ixs =
        mode === 'deposit'
          ? await buildDeposit({ ...common, amount: input.form.amount })
          : await buildRedeem({ ...common, shares: input.form.amount })
      const signature = await sendInstructions(client.rpc, signer, ixs)
      const confirmedMs = performance.now() - t0
      // `invalidateQueries` чекає на рефетч активних запитів — момент, коли екран
      // уже показує новий NAV і баланс.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: poolQueryKey(pool.id) }),
        queryClient.invalidateQueries({ queryKey: walletQueryKey(pool.address, account.address) }),
      ])
      const refreshedMs = performance.now() - t0
      const outcome: Outcome = {
        signature,
        form: input.form,
        receive: input.receive,
        modelDay: modelDay(projected.modelTime),
        confirmedMs,
        refreshedMs,
      }
      if (import.meta.env.DEV) {
        console.info(
          `[SC-001] ${mode} ${input.form.tranche} ${formatAmount(input.form.amount)}: confirmed ${seconds(confirmedMs)} · screen refreshed ${seconds(refreshedMs)} · tx ${signature}`,
        )
      }
      return outcome
    },
    onSuccess: onDone,
  })
  const label = form
    ? `${mode === 'deposit' ? 'Deposit' : 'Redeem'} ${formatAmount(form.amount)} ${mode === 'deposit' ? TOKEN : trancheToken(form.tranche)}`
    : `${mode === 'deposit' ? 'Deposit' : 'Redeem'} —`
  const canSend = ready && form !== null && result.kind === 'ok' && !send.isPending
  return (
    <>
      <Btn
        label={send.isPending ? 'waiting for the wallet…' : label}
        primary
        disabled={!canSend}
        onClick={() => {
          if (form && result.kind === 'ok') send.mutate({ form, receive: result.receive })
        }}
      />
      {send.isError ? <Refused>{explainSendError(send.error)}</Refused> : null}
    </>
  )
}

type TrancheBoxProps = {
  tranche: Tranche
  selected: boolean
  pool: PoolView
  wallet: WalletView | undefined
  mode: Mode
  onPick: (tranche: Tranche) => void
}

function TrancheBox({ tranche, selected, pool, wallet, mode, onPick }: TrancheBoxProps) {
  const held = wallet ? (tranche === 'senior' ? wallet.seniorShares : wallet.juniorShares) : null
  const third =
    mode === 'redeem' && held !== null
      ? `${formatAmount(held)} ${trancheToken(tranche)} held`
      : tranche === 'senior'
        ? 'paid first'
        : 'absorbs loss first'
  return (
    <button
      type="button"
      className={`border border-ink px-3 py-2.5 text-left text-lbl uppercase leading-[1.6] ${selected ? 'border-2' : ''}`}
      onClick={() => onPick(tranche)}
    >
      {tranche === 'senior' ? 'Senior' : 'Junior'}
      <br />
      {tranche === 'senior' ? `${formatBps(pool.params.seniorRateBps)}/yr rated` : 'residual yield'}
      <br />
      {third}
    </button>
  )
}

type HoldingsRowProps = {
  mode: Mode
  unit: string
  connected: boolean
  wallet: WalletView | undefined
  held: Micro | null
  onAll: () => void
}

// Під полем: що вкладник має у потрібній одиниці; для погашення — «all» підставляє всі
// частки з повними шістьма знаками, щоб спалити рівно все.
function HoldingsRow({ mode, unit, connected, wallet, held, onAll }: HoldingsRowProps) {
  let body: ReactNode
  if (!connected) body = <span>connect a wallet to see what you hold</span>
  else if (!wallet) body = <span>reading your balances…</span>
  else if (mode === 'deposit') {
    body = (
      <span>
        available {formatAmount(wallet.base)} {TOKEN}
      </span>
    )
  } else {
    body = (
      <>
        <span>
          holding {formatAmount(held ?? 0n)} {unit}
        </span>
        <button
          type="button"
          className="lbl underline underline-offset-4 hover:text-ink"
          onClick={onAll}
        >
          all
        </button>
      </>
    )
  }
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 text-[11px] text-sec">
      {body}
    </div>
  )
}

type PreviewRowsProps = {
  result: Preview
  mode: Mode
  unit: string
  receiveUnit: string
  navNow: string
}

function PreviewRows({ result, mode, unit, receiveUnit, navNow }: PreviewRowsProps) {
  if (result.kind === 'refused') return <Refused>{result.reason}</Refused>
  const rows: Array<[string, string]> = [
    ['NAV now', navNow],
    ['You receive', `${formatAmount(result.receive)} ${receiveUnit}`],
    ['Junior floor after', formatBps(result.juniorFloorAfter)],
  ]
  if (mode === 'redeem' && result.remainingShares !== null) {
    rows.push(['Left in wallet', `${formatAmount(result.remainingShares)} ${unit}`])
  }
  return <Pairs rows={rows} />
}

function OutcomeLine({ outcome, mode }: { outcome: Outcome; mode: Mode }) {
  const what =
    mode === 'deposit'
      ? `${formatAmount(outcome.receive)} ${trancheToken(outcome.form.tranche)} minted`
      : `${formatAmount(outcome.receive)} ${TOKEN} returned`
  return (
    <div className="text-[12px]">
      confirmed · model day {outcome.modelDay} · {what} · {seconds(outcome.confirmedMs)} to confirm,{' '}
      {seconds(outcome.refreshedMs)} to the screen · tx {shortAddress(outcome.signature)}
    </div>
  )
}

// Усе, що екран рахує з форми і пулу. Прев'ю — на стані після нарахування на зараз:
// саме його побачить інструкція, бо кожна починається з `accrue`.
function derive(
  pool: PoolView,
  now: bigint,
  mode: Mode,
  tranche: Tranche,
  text: string,
  wallet: WalletView | undefined,
) {
  const projected = accruedView(pool, now)
  const parsed = panelFormSchema.safeParse({ tranche, amount: text })
  const form = parsed.success ? parsed.data : null
  const result: Preview = form
    ? preview({ pool: projected, mode, tranche, value: form.amount, wallet: wallet ?? null })
    : {
        kind: 'refused',
        reason:
          text.trim() === ''
            ? 'enter an amount'
            : (parsed.error?.issues[0]?.message ?? 'enter an amount'),
      }
  const side = tranche === 'senior' ? projected.senior : projected.junior
  return {
    projected,
    form,
    result,
    drawn: result.kind === 'ok' ? result.after : projected,
    navNow: formatNav(side.assets, side.supply),
    held: wallet ? (tranche === 'senior' ? wallet.seniorShares : wallet.juniorShares) : null,
  }
}

function ModeSwitch({ base, mode }: { base: string; mode: Mode }) {
  return (
    <div className="flex text-lbl uppercase text-sec">
      {(['deposit', 'redeem'] as const).map((m, i) => (
        <span key={m} className="flex">
          <Link
            to={`${base}/${m}`}
            className={`px-1.5 ${m === mode ? 'text-ink underline underline-offset-4' : 'hover:text-ink'}`}
          >
            {m}
          </Link>
          {i === 0 ? <span className="px-1.5">·</span> : null}
        </span>
      ))}
    </div>
  )
}

export function TranchePanel({ pool, mode }: { pool: PoolView; mode: Mode }) {
  const compact = useCompact()
  const navigate = useNavigate()
  const now = useUnixNow()
  const { account, address } = useWallet()
  const balances = useWalletBalances(pool, address)
  const [tranche, setTranche] = useState<Tranche>('senior')
  const [text, setText] = useState(mode === 'deposit' ? '1,000.00' : '')
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const { projected, form, result, drawn, navNow, held } = derive(
    pool,
    now,
    mode,
    tranche,
    text,
    balances.data,
  )
  const base = `/pool/${pool.id}`
  const unit = mode === 'deposit' ? TOKEN : trancheToken(tranche)

  function edit(next: string) {
    setText(next)
    setOutcome(null)
  }

  return (
    <Sheet>
      <Nav />
      <Columns
        drawing={
          <Cascade
            pool={drawn}
            baseline={projected}
            fig={`FIG. 1 — CASCADE, POOL ${pool.id}`}
            compact={compact}
            yieldRateBps={BigInt(pool.params.yieldRateBps)}
            seniorRateBps={BigInt(pool.params.seniorRateBps)}
            minJuniorBps={BigInt(pool.params.minJuniorBps)}
          />
        }
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div>{mode === 'deposit' ? 'DEPOSIT' : 'REDEEM'}</div>
            <div className="text-[11px] text-sec">
              {mode === 'deposit'
                ? 'choose a tranche, then an amount'
                : 'choose a tranche, then how many shares to burn'}
            </div>
          </div>
          <ModeSwitch base={base} mode={mode} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(['senior', 'junior'] as const).map((t) => (
            <TrancheBox
              key={t}
              tranche={t}
              selected={tranche === t}
              pool={pool}
              wallet={balances.data}
              mode={mode}
              onPick={(next) => {
                setTranche(next)
                setOutcome(null)
              }}
            />
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Field label="Amount" unit={unit} value={text} onChange={edit} />
          <HoldingsRow
            mode={mode}
            unit={unit}
            connected={Boolean(account)}
            wallet={balances.data}
            held={held}
            onAll={() => edit(formatAmount(held ?? 0n, 6))}
          />
        </div>
        <PreviewRows
          result={result}
          mode={mode}
          unit={unit}
          receiveUnit={mode === 'deposit' ? trancheToken(tranche) : TOKEN}
          navNow={navNow}
        />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-3">
            {account ? (
              <SubmitButton
                account={account}
                pool={pool}
                projected={projected}
                mode={mode}
                form={form}
                result={result}
                ready={Boolean(balances.data)}
                onDone={setOutcome}
              />
            ) : (
              <Btn label="connect a wallet to sign" primary disabled />
            )}
            <Btn label="Cancel" onClick={() => navigate(base)} />
          </div>
          <div className="text-[11px] text-sec">
            one signature · the drawing updates within 10 s of confirmation
          </div>
          {outcome ? <OutcomeLine outcome={outcome} mode={mode} /> : null}
        </div>
      </Columns>
      <TitleBlock
        title={`${mode === 'deposit' ? 'Deposit' : 'Redeem'} — ${tranche}`}
        sheet={2}
        modelDay={modelDay(projected.modelTime)}
        poolLabel={`POOL ${pool.id} · ${TOKEN}`}
        scale={formatScale(pool.params.timeScale)}
      />
    </Sheet>
  )
}
