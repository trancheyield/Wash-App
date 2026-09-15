import { useClient, useWalletAccountTransactionSendingSigner } from '@solana/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UiWalletAccount } from '@wallet-standard/react'
import {
  accruedView,
  buildAccrue,
  buildRecordLoss,
  type LossEventView,
  type PoolView,
  poolBalances,
  withBalances,
} from '@washapp/chain'
import { formatAmount } from '@washapp/shared'
import { useState } from 'react'
import { Nav } from '../../chrome/Chrome.tsx'
import { useWallet } from '../../chrome/Wallet.tsx'
import { Cascade } from '../../components/Cascade.tsx'
import {
  Btn,
  Columns,
  Field,
  Refused,
  Sheet,
  TitleBlock,
  useCompact,
} from '../../components/chrome.tsx'
import { formatBps } from '../../format.ts'
import { formatScale, modelDay, projectedModelTime, useUnixNow } from '../../model-clock.ts'
import { useAppConfig } from '../../providers.tsx'
import { poolQueryKey } from '../../queries/pool.ts'
import type { AppClient } from '../../rpc.ts'
import { TOKEN } from '../../tokens.ts'
import { explainSendError } from '../../tx/errors.ts'
import { sendInstructions } from '../../tx/send.ts'
import { shortAddress } from '../../wallets.ts'
import { LastLossPairs, LossTable } from '../Pool/LossHistory.tsx'
import { PoolGate } from '../Pool/PoolGate.tsx'
import { type LossPreview, lossFormSchema, lossPreview } from './loss-form.ts'

// Результат запису — рядок «confirmed …» і таймер SC-001 (підпис → `confirmed` →
// оновлений пул на екрані).
type Outcome = {
  kind: 'loss' | 'accrue'
  signature: string
  index: number
  juniorLoss: bigint
  seniorLoss: bigint
  confirmedMs: number
  refreshedMs: number
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

// Стан «до» для креслення: поточний пул плюс те, що подія забрала. Точні числа
// «до/після» — у парах з акаунта події; посудина лише показує, звідки впав рівень.
function beforeLastLoss(pool: PoolView, last: LossEventView): PoolView {
  const b = poolBalances(pool)
  return withBalances(pool, {
    ...b,
    assets: b.assets + last.amount,
    seniorAssets: b.seniorAssets + last.seniorLoss,
    juniorAssets: b.juniorAssets + last.juniorLoss,
  })
}

type PanelProps = {
  account: UiWalletAccount
  pool: PoolView
  projected: PoolView
  text: string
  onText: (next: string) => void
  preview: LossPreview | null
  onDone: (outcome: Outcome) => void
}

// Окремий компонент: `useWalletAccountTransactionSendingSigner` вимагає акаунта, а
// аркуш рендериться і без гаманця.
function OperatorPanel({ account, pool, projected, text, onText, preview, onDone }: PanelProps) {
  const { chain } = useAppConfig()
  const signer = useWalletAccountTransactionSendingSigner(account, chain)
  const client = useClient<AppClient>()
  const queryClient = useQueryClient()
  const send = useMutation({
    mutationFn: async (input: { kind: 'loss'; preview: LossPreview } | { kind: 'accrue' }) => {
      const t0 = performance.now()
      const ix =
        input.kind === 'loss' && input.preview.kind === 'ok'
          ? await buildRecordLoss({
              operator: signer,
              poolId: pool.id,
              lossBps: input.preview.lossBps,
              // Індекс нової події — лічильник пулу на момент відправки; застарілий
              // (хтось записав збиток між опитуваннями) програма відхилить на `init`.
              index: pool.lossCount,
            })
          : await buildAccrue({ poolId: pool.id })
      const signature = await sendInstructions(client.rpc, signer, [ix])
      const confirmedMs = performance.now() - t0
      await queryClient.invalidateQueries({ queryKey: poolQueryKey(pool.id) })
      const refreshedMs = performance.now() - t0
      const split = input.kind === 'loss' && input.preview.kind === 'ok' ? input.preview : null
      const outcome: Outcome = {
        kind: input.kind,
        signature,
        index: pool.lossCount,
        juniorLoss: split?.juniorLoss ?? 0n,
        seniorLoss: split?.seniorLoss ?? 0n,
        confirmedMs,
        refreshedMs,
      }
      if (import.meta.env.DEV) {
        console.info(
          `[SC-001] ${input.kind}${split ? ` ${formatBps(split.lossBps)}` : ''}: confirmed ${seconds(confirmedMs)} · screen refreshed ${seconds(refreshedMs)} · tx ${signature}`,
        )
      }
      return outcome
    },
    onSuccess: onDone,
  })
  const ready = preview !== null && preview.kind === 'ok' && !send.isPending
  return (
    <div className="flex flex-col gap-2">
      <div className="lbl">Operator · {shortAddress(account.address)}</div>
      <Field label="Loss %" unit="%" value={text} onChange={onText} />
      {preview === null ? (
        <div className="text-[11px] text-sec">enter a loss between 0 and 100 %</div>
      ) : preview.kind === 'ok' ? (
        <div className="text-[11px] text-sec">
          JUNIOR −{formatAmount(preview.juniorLoss)} · SENIOR −{formatAmount(preview.seniorLoss)} ·
          model day {modelDay(projected.modelTime)}
        </div>
      ) : (
        <Refused>{preview.reason}</Refused>
      )}
      <div className="flex flex-wrap gap-3">
        <Btn
          label={
            send.isPending && send.variables?.kind === 'loss'
              ? 'waiting for the wallet…'
              : preview?.kind === 'ok'
                ? `Record loss ${formatBps(preview.lossBps)}`
                : 'Record loss'
          }
          primary
          disabled={!ready}
          onClick={() => {
            if (preview) send.mutate({ kind: 'loss', preview })
          }}
        />
        <Btn
          label={send.isPending && send.variables?.kind === 'accrue' ? 'waiting…' : 'Accrue now'}
          disabled={send.isPending}
          onClick={() => send.mutate({ kind: 'accrue' })}
        />
      </div>
      <div className="text-[11px] text-sec">
        visible to the operator wallet only · one signature
      </div>
      {send.isError ? <Refused>{explainSendError(send.error)}</Refused> : null}
    </div>
  )
}

function OutcomeLine({ outcome }: { outcome: Outcome }) {
  const what =
    outcome.kind === 'loss'
      ? `loss event #${outcome.index} · junior −${formatAmount(outcome.juniorLoss)} · senior −${formatAmount(outcome.seniorLoss)} ${TOKEN}`
      : 'accrued'
  return (
    <div className="text-[12px]">
      confirmed · {what} · {seconds(outcome.confirmedMs)} to confirm, {seconds(outcome.refreshedMs)}{' '}
      to the screen · tx {shortAddress(outcome.signature)}
    </div>
  )
}

type Drawing = { pool: PoolView; before?: PoolView; fig: string }

// Прев'ю лише для оператора: решті форма не показується, тож і рахувати нема чого.
function derivePreview(isOperator: boolean, projected: PoolView, text: string): LossPreview | null {
  if (!isOperator || text.trim() === '') return null
  const parsed = lossFormSchema.safeParse({ percent: text })
  if (!parsed.success) {
    return { kind: 'refused', reason: parsed.error.issues[0]?.message ?? 'enter a loss' }
  }
  return lossPreview(projected, parsed.data.percent)
}

// Креслення: прев'ю оператора (рівень падає з `projected` до `after`), інакше —
// остання подія з ланцюга, інакше — сам пул.
function pickDrawing(
  pool: PoolView,
  projected: PoolView,
  preview: LossPreview | null,
  last: LossEventView | undefined,
): Drawing {
  if (preview?.kind === 'ok') {
    return {
      pool: preview.after,
      before: projected,
      fig: `FIG. 2 — LOSS ${formatBps(preview.lossBps)} (PREVIEW)`,
    }
  }
  if (last) {
    return {
      pool,
      before: beforeLastLoss(pool, last),
      fig: `FIG. 2 — LOSS ${formatBps(last.lossBps)}, MODEL DAY ${modelDay(last.modelTime)}`,
    }
  }
  return { pool, fig: `FIG. 1 — CASCADE, POOL ${pool.id}` }
}

function LossSheet({ pool }: { pool: PoolView }) {
  const compact = useCompact()
  const now = useUnixNow()
  const { account, address } = useWallet()
  const [text, setText] = useState('15.00')
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  // Оператор — той, кого перевіряє програма (`has_one = operator` на `Pool`).
  const isOperator = address !== null && address === pool.operator
  const projected = accruedView(pool, now)
  const preview = derivePreview(isOperator, projected, text)
  const last = pool.lossEvents.at(-1)
  const drawing = pickDrawing(pool, projected, preview, last)
  const day = modelDay(projectedModelTime(pool, now))

  return (
    <Sheet>
      <Nav />
      <Columns
        drawing={
          <Cascade
            pool={drawing.pool}
            {...(drawing.before ? { before: drawing.before } : {})}
            fig={drawing.fig}
            compact={compact}
            yieldRateBps={BigInt(pool.params.yieldRateBps)}
            seniorRateBps={BigInt(pool.params.seniorRateBps)}
            minJuniorBps={BigInt(pool.params.minJuniorBps)}
          />
        }
      >
        {last ? <LastLossPairs event={last} /> : null}
        <LossTable events={pool.lossEvents} />
        {account && isOperator ? (
          <OperatorPanel
            account={account}
            pool={pool}
            projected={projected}
            text={text}
            onText={(next) => {
              setText(next)
              setOutcome(null)
            }}
            preview={preview}
            onDone={(done) => {
              setOutcome(done)
              if (done.kind === 'loss') setText('')
            }}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <Refused>
              {account
                ? `recording a loss requires the operator wallet ${shortAddress(pool.operator)}`
                : 'connect the operator wallet to record a loss'}
            </Refused>
            <div className="text-[11px] text-sec">visible to the operator wallet only</div>
          </div>
        )}
        {outcome ? <OutcomeLine outcome={outcome} /> : null}
      </Columns>
      <TitleBlock
        title={
          last ? `Loss event ${last.index} — ${isOperator ? 'operator' : 'viewer'}` : 'Loss events'
        }
        sheet={3}
        modelDay={day}
        poolLabel={`POOL ${pool.id} · ${TOKEN}`}
        scale={formatScale(pool.params.timeScale)}
      />
    </Sheet>
  )
}

export function LossScreen() {
  return <PoolGate>{(pool) => <LossSheet pool={pool} />}</PoolGate>
}
