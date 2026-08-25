import { formatAmount, parseAmount } from '@washapp/shared'
import { useState } from 'react'
import { Nav } from '../../chrome/Chrome.tsx'
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
import { OPERATOR, poolAfterAccrual, poolParams, TOKEN } from '../../mock/data.ts'
import { applyLoss, formatBps, poolAfterLoss, totalAssets } from '../../mock/forecast.ts'

type LossEvent = {
  index: number
  day: number
  bps: bigint
  amount: bigint
  junior: bigint
  senior: bigint
}

function toBps(text: string): bigint | null {
  const micro = parseAmount(text)
  if (micro === null) return null
  const bps = micro / 10_000n
  return bps > 10_000n ? null : bps
}

export function LossScreen() {
  const compact = useCompact()
  // Аркуш M0 на мок-даних: «оператор» — локальний перемикач до T026, де його
  // замінить порівняння гаманця з `Config.authority` з ланцюга.
  const [asOperator, setAsOperator] = useState(false)
  const [text, setText] = useState('15.00')
  const [events, setEvents] = useState<LossEvent[]>([])

  // Стан перед останньою подією — для пунктиру «BEFORE» і колонки «assets before».
  const before = events.slice(0, -1).reduce((p, e) => poolAfterLoss(p, e.bps), poolAfterAccrual)
  const last = events.at(-1)
  const pool = last ? poolAfterLoss(before, last.bps) : before
  const bps = toBps(text)
  const preview = bps === null ? null : applyLoss(pool, bps)

  function record() {
    if (!preview || bps === null) return
    setEvents([
      ...events,
      {
        index: events.length,
        day: poolParams.modelDay,
        bps,
        amount: preview.loss,
        junior: preview.juniorLoss,
        senior: preview.seniorLoss,
      },
    ])
  }

  const grid =
    'grid grid-cols-[1fr_1.2fr_1.4fr_2fr_2fr_1.6fr] gap-3 border-b border-hair py-1.5 text-[12px]'

  return (
    <Sheet>
      <Nav />
      <Columns
        drawing={
          <Cascade
            pool={pool}
            {...(last ? { before } : {})}
            fig={
              last
                ? `FIG. 2 — LOSS ${formatBps(last.bps)}, MODEL DAY ${last.day}`
                : 'FIG. 1 — CASCADE, POOL 0'
            }
            compact={compact}
            yieldRateBps={poolParams.yieldRateBps}
            seniorRateBps={poolParams.seniorRateBps}
            minJuniorBps={poolParams.minJuniorBps}
          />
        }
      >
        {last ? (
          <div className="flex flex-col gap-1">
            <div>LOSS EVENT {last.index}</div>
            <Pairs
              rows={[
                ['Recorded', `model day ${last.day}`],
                ['Loss', `${formatBps(last.bps)} OF ASSETS`],
                ['Amount', `${formatAmount(last.amount)} ${TOKEN}`],
                ['Junior absorbed', `${formatAmount(last.junior)} ${TOKEN}`],
                ['Senior absorbed', `${formatAmount(last.senior)} ${TOKEN}`],
                ['Assets before', `${formatAmount(totalAssets(before))} ${TOKEN}`],
                ['Assets after', `${formatAmount(totalAssets(pool))} ${TOKEN}`],
              ]}
            />
          </div>
        ) : (
          <div>
            <div>LOSS EVENTS</div>
            <div className="text-[11px] text-sec">
              none recorded · the operator records one below
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <div className="lbl">Loss events</div>
          <div className={`${grid} lbl border-b`}>
            <span>#</span>
            <span>Day</span>
            <span className="text-right">Loss</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Junior</span>
            <span className="text-right">Senior</span>
          </div>
          {events.length === 0 ? <div className="py-1.5 text-[11px] text-sec">—</div> : null}
          {events.map((e) => (
            <div key={e.index} className={grid}>
              <span>#{e.index}</span>
              <span>day {e.day}</span>
              <span className="text-right">{formatBps(e.bps)}</span>
              <span className="text-right">{formatAmount(e.amount)}</span>
              <span className="text-right">{formatAmount(e.junior)}</span>
              <span className="text-right">{formatAmount(e.senior)}</span>
            </div>
          ))}
        </div>
        {asOperator ? (
          <div className="flex flex-col gap-2">
            <div className="lbl">Operator · {OPERATOR}</div>
            <Field label="Loss %" unit="%" value={text} onChange={setText} />
            {preview ? (
              <div className="text-[11px] text-sec">
                JUNIOR −{formatAmount(preview.juniorLoss)} · SENIOR −
                {formatAmount(preview.seniorLoss)}
              </div>
            ) : (
              <Refused>Loss must be between 0 and 100 %.</Refused>
            )}
            <div className="flex flex-wrap gap-3">
              <Btn label="Record loss" primary disabled={!preview} onClick={record} />
              <Btn label="Accrue now" />
            </div>
            <div className="text-[11px] text-sec">visible to the operator wallet only</div>
            <button
              type="button"
              className="lbl self-start hover:text-ink"
              onClick={() => setAsOperator(false)}
            >
              view as a supporter wallet
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Refused>Recording a loss requires the operator wallet.</Refused>
            <button
              type="button"
              className="lbl self-start hover:text-ink"
              onClick={() => setAsOperator(true)}
            >
              preview as operator (mock until T026)
            </button>
          </div>
        )}
      </Columns>
      <TitleBlock
        title={
          last ? `Loss event ${last.index} — ${asOperator ? 'operator' : 'viewer'}` : 'Loss events'
        }
        sheet={3}
        modelDay={poolParams.modelDay}
      />
    </Sheet>
  )
}
