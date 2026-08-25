import { formatAmount } from '@washapp/shared'
import { useState } from 'react'
import { Nav } from '../../chrome/Chrome.tsx'
import { useWallet } from '../../chrome/Wallet.tsx'
import { Sheet, TitleBlock } from '../../components/chrome.tsx'
import {
  contract0,
  JUNIOR_TOKEN,
  poolAfterAccrual,
  poolParams,
  protectionParams,
  protectionState,
  SENIOR_TOKEN,
  TOKEN,
  walletPosition,
} from '../../mock/data.ts'
import { amountForShares, formatBps, payout, poolAfterLoss } from '../../mock/forecast.ts'

type Row = { position: string; now: bigint; after: bigint; signed?: boolean }

function delta(now: bigint, after: bigint): string {
  const d = after - now
  if (d === 0n) return '0.00'
  return `${d > 0n ? '+' : '−'}${formatAmount(d < 0n ? -d : d)}`
}

export function forecastRows(lossBps: bigint): Row[] {
  const pool = poolAfterAccrual
  const after = poolAfterLoss(pool, lossBps)
  const paid = payout(contract0.notional, lossBps, protectionParams.triggerBps)
  return [
    {
      position: `SENIOR ${formatAmount(walletPosition.seniorShares)} ${SENIOR_TOKEN}`,
      now: amountForShares(walletPosition.seniorShares, pool.senior.assets, pool.senior.supply),
      after: amountForShares(walletPosition.seniorShares, after.senior.assets, after.senior.supply),
    },
    {
      position: `JUNIOR ${formatAmount(walletPosition.juniorShares)} ${JUNIOR_TOKEN}`,
      now: amountForShares(walletPosition.juniorShares, pool.junior.assets, pool.junior.supply),
      after: amountForShares(walletPosition.juniorShares, after.junior.assets, after.junior.supply),
    },
    { position: `COVER BOUGHT #${contract0.nonce}`, now: 0n, after: paid, signed: true },
    {
      position: `COVER SOLD ${formatBps(walletPosition.sellerShareBps)}`,
      now: protectionState.collateral,
      after: protectionState.collateral - paid,
    },
  ]
}

export function PositionScreen() {
  const wallet = useWallet()
  const [pct, setPct] = useState(15)
  const lossBps = BigInt(pct * 100)
  const rows = forecastRows(lossBps)
  const totalNow = rows.reduce((s, r) => s + r.now, 0n)
  const totalAfter = rows.reduce((s, r) => s + r.after, 0n)
  const pctText = `${pct.toFixed(2)} %`
  const grid =
    'grid grid-cols-[1.4fr_1fr_1fr_.8fr] gap-3 border-b border-hair py-1.5 text-[12px] xl:grid-cols-[2fr_1.3fr_1.3fr_1fr] xl:text-[14px]'

  return (
    <Sheet>
      <Nav />
      <div className="flex max-w-[900px] flex-col gap-[22px]">
        {wallet.address ? (
          <>
            <div>POSITION · {wallet.address}</div>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="lbl">If the pool loses</span>
                <span className="text-[18px]">{pctText}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={pct}
                onChange={(e) => setPct(Number(e.target.value))}
                aria-label="If the pool loses, percent"
              />
              <div className="flex justify-between text-[11px] text-sec">
                {['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100 %'].map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </div>
            <div>
              <div className={`${grid} lbl`}>
                <span>Position</span>
                <span className="text-right">Now</span>
                <span className="text-right">If {pctText} loss</span>
                <span className="text-right">Change</span>
              </div>
              {rows.map((r) => (
                <div key={r.position} className={grid}>
                  <span>{r.position}</span>
                  <span className="text-right">
                    {formatAmount(r.now)} {TOKEN}
                  </span>
                  <span className="text-right">
                    {r.signed && r.after > 0n ? '+' : ''}
                    {formatAmount(r.after)} {TOKEN}
                  </span>
                  <span className="text-right">{delta(r.now, r.after)}</span>
                </div>
              ))}
              <div className={`${grid} border-b-0 border-t-2 border-t-ink`}>
                <span>TOTAL</span>
                <span className="text-right">
                  {formatAmount(totalNow)} {TOKEN}
                </span>
                <span className="text-right">
                  {formatAmount(totalAfter)} {TOKEN}
                </span>
                <span className="text-right">{delta(totalNow, totalAfter)}</span>
              </div>
            </div>
            <div className="text-[11px] text-sec">
              forecast uses the pool's own waterfall · the same arithmetic the chain runs when the
              operator records a loss
            </div>
          </>
        ) : (
          <>
            <div>POSITION</div>
            <div className="flex flex-col gap-2">
              <div className="lbl">Without a wallet</div>
              <div>Connect a wallet to see positions. Pool 0 public figures are on sheet 1.</div>
            </div>
          </>
        )}
      </div>
      <TitleBlock
        title={wallet.address ? 'Position sheet' : 'Position — no wallet'}
        sheet={5}
        modelDay={poolParams.modelDay}
      />
    </Sheet>
  )
}
