import { formatAmount, parseAmount } from '@washapp/shared'
import { useState } from 'react'
import { Cascade } from '../../components/Cascade.tsx'
import {
  Btn,
  Columns,
  Field,
  Nav,
  Pairs,
  Refused,
  Sheet,
  TitleBlock,
  useCompact,
} from '../../components/chrome.tsx'
import {
  JUNIOR_TOKEN,
  type PoolState,
  poolAfterAccrual,
  poolParams,
  SENIOR_TOKEN,
  TOKEN,
  walletPosition,
} from '../../mock/data.ts'
import { formatBps, formatNav, juniorShareBps, sharesForDeposit } from '../../mock/forecast.ts'

type Tranche = 'senior' | 'junior'

export function DepositScreen() {
  const compact = useCompact()
  const [tranche, setTranche] = useState<Tranche>('senior')
  const [text, setText] = useState('2,500.00')
  const [confirmed, setConfirmed] = useState<PoolState | null>(null)

  const pool = confirmed ?? poolAfterAccrual
  const amount = parseAmount(text)
  const t = pool[tranche]
  const shares = amount === null ? null : sharesForDeposit(amount, t.assets, t.supply)
  const seniorAfter = pool.senior.assets + (tranche === 'senior' && amount ? amount : 0n)
  const juniorAfter = pool.junior.assets + (tranche === 'junior' && amount ? amount : 0n)
  const floorAfter = juniorShareBps(seniorAfter, juniorAfter)
  const breaches = tranche === 'senior' && amount !== null && floorAfter < poolParams.minJuniorBps
  const canDeposit = amount !== null && amount > 0n && !breaches && confirmed === null

  function confirm() {
    if (!amount || !shares) return
    setConfirmed({
      senior: {
        assets: seniorAfter,
        supply: pool.senior.supply + (tranche === 'senior' ? shares : 0n),
      },
      junior: {
        assets: juniorAfter,
        supply: pool.junior.supply + (tranche === 'junior' ? shares : 0n),
      },
    })
  }

  const pick = (which: Tranche) =>
    `border border-ink px-3 py-2.5 text-left text-lbl uppercase leading-[1.6] ${tranche === which ? 'border-2' : ''}`

  return (
    <Sheet>
      <Nav />
      <Columns
        drawing={
          <Cascade
            pool={pool}
            baseline={poolAfterAccrual}
            fig="FIG. 1 — CASCADE, POOL 0"
            compact={compact}
            yieldRateBps={poolParams.yieldRateBps}
            seniorRateBps={poolParams.seniorRateBps}
            minJuniorBps={poolParams.minJuniorBps}
          />
        }
      >
        <div>
          <div>DEPOSIT</div>
          <div className="text-[11px] text-sec">choose a tranche, then an amount</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className={pick('senior')} onClick={() => setTranche('senior')}>
            Senior
            <br />
            {formatBps(poolParams.seniorRateBps)}/yr rated
            <br />
            paid first
          </button>
          <button type="button" className={pick('junior')} onClick={() => setTranche('junior')}>
            Junior
            <br />
            residual yield
            <br />
            absorbs loss first
          </button>
        </div>
        <div className="flex flex-col gap-1">
          <Field label="Amount" unit={TOKEN} value={text} onChange={setText} />
          <div className="text-[11px] text-sec">
            available {formatAmount(walletPosition.free)} {TOKEN}
          </div>
        </div>
        {breaches ? (
          <Refused>
            Senior deposit of 25,000.00 {TOKEN} would put the junior floor at 20.13 % — allowed;{' '}
            {formatAmount(amount ?? 0n)} {TOKEN} would put it at {formatBps(floorAfter)} and is
            refused before signing.
          </Refused>
        ) : amount === null ? (
          <Refused>Enter an amount with up to six decimals.</Refused>
        ) : (
          <Pairs
            rows={[
              ['NAV now', formatNav(t.assets, t.supply)],
              [
                'You receive',
                `${formatAmount(shares ?? 0n)} ${tranche === 'senior' ? SENIOR_TOKEN : JUNIOR_TOKEN}`,
              ],
              ['Junior floor after', formatBps(floorAfter)],
            ]}
          />
        )}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-3">
            <Btn
              label={`Deposit ${amount ? formatAmount(amount) : '—'} ${TOKEN}`}
              primary
              disabled={!canDeposit}
              onClick={confirm}
            />
            <Btn label="Cancel" onClick={() => setConfirmed(null)} />
          </div>
          <div className="text-[11px] text-sec">
            one signature · the drawing updates within 10 s of confirmation
          </div>
          {confirmed && shares ? (
            <div className="text-[12px]">
              confirmed · model day {poolParams.modelDay} · {formatAmount(shares)}{' '}
              {tranche === 'senior' ? SENIOR_TOKEN : JUNIOR_TOKEN} in wallet
            </div>
          ) : null}
        </div>
      </Columns>
      <TitleBlock title={`Deposit — ${tranche}`} sheet={2} modelDay={poolParams.modelDay} />
    </Sheet>
  )
}
