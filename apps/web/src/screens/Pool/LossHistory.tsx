import type { LossEventView, PoolView } from '@washapp/chain'
import { formatAmount } from '@washapp/shared'
import { Link } from 'react-router'
import { Pairs } from '../../components/chrome.tsx'
import { formatBps } from '../../format.ts'
import { modelDay } from '../../model-clock.ts'
import { TOKEN } from '../../tokens.ts'

const GRID =
  'grid grid-cols-[auto_auto_auto_1fr_1fr_1fr] gap-3 whitespace-nowrap border-b border-hair py-1.5 text-[12px]'

// Таблиця подій збитку з ланцюга — на сторінці пулу і на аркуші збитку та сама:
// `#`, модельний день, частка, сума і розклад на транші.
export function LossTable({ events }: { events: LossEventView[] }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="lbl">Loss events</div>
      <div className={`${GRID} lbl border-b`}>
        <span>#</span>
        <span>Day</span>
        <span className="text-right">Loss</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Junior</span>
        <span className="text-right">Senior</span>
      </div>
      {events.length === 0 ? (
        <div className="py-1.5 text-[11px] text-sec">none recorded</div>
      ) : null}
      {events.map((e) => (
        <div key={e.index} className={GRID}>
          <span>#{e.index}</span>
          <span>{modelDay(e.modelTime)}</span>
          <span className="text-right">{formatBps(e.lossBps)}</span>
          <span className="text-right">{formatAmount(e.amount)}</span>
          <span className="text-right">{formatAmount(e.juniorLoss)}</span>
          <span className="text-right">{formatAmount(e.seniorLoss)}</span>
        </div>
      ))}
    </div>
  )
}

// Пари «до/після» останньої події — числа з самого акаунта `LossEvent`, не з
// поточного стану пулу: після події могли бути депозити і дохід.
export function LastLossPairs({ event }: { event: LossEventView }) {
  return (
    <div className="flex flex-col gap-1">
      <div>LOSS EVENT {event.index}</div>
      <Pairs
        rows={[
          ['Recorded', `model day ${modelDay(event.modelTime)}`],
          ['Loss', `${formatBps(event.lossBps)} OF ASSETS`],
          ['Amount', `${formatAmount(event.amount)} ${TOKEN}`],
          ['Junior absorbed', `${formatAmount(event.juniorLoss)} ${TOKEN}`],
          ['Senior absorbed', `${formatAmount(event.seniorLoss)} ${TOKEN}`],
          ['Assets before', `${formatAmount(event.assetsBefore)} ${TOKEN}`],
          ['Assets after', `${formatAmount(event.assetsAfter)} ${TOKEN}`],
        ]}
      />
    </div>
  )
}

// Блок на сторінці пулу: остання подія коротко і посилання на аркуш збитку.
export function LossHistory({ pool }: { pool: PoolView }) {
  const last = pool.lossEvents.at(-1)
  const base = `/pool/${pool.id}`
  return (
    <div className="flex flex-col gap-2">
      <LossTable events={pool.lossEvents} />
      {last ? (
        <div className="text-[11px] text-sec">
          last event #{last.index}: {formatAmount(last.assetsBefore)} →{' '}
          {formatAmount(last.assetsAfter)} {TOKEN} ·{' '}
          <Link to={`${base}/loss`} className="underline underline-offset-4 hover:text-ink">
            see the drawing
          </Link>
        </div>
      ) : (
        <div className="text-[11px] text-sec">the operator records losses on the loss sheet</div>
      )}
    </div>
  )
}
