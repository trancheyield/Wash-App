import { accruedView, type PoolView } from '@washapp/chain'
import { formatAmount, type Micro } from '@washapp/shared'
import { useState } from 'react'
import { Link } from 'react-router'
import { Nav } from '../../chrome/Chrome.tsx'
import { useWallet } from '../../chrome/Wallet.tsx'
import { Pairs, Refused, Sheet, TitleBlock } from '../../components/chrome.tsx'
import { formatBps, formatNav } from '../../format.ts'
import { formatScale, modelDay, projectedModelTime, useUnixNow } from '../../model-clock.ts'
import { useAppConfig } from '../../providers.tsx'
import { usePoolContracts, useProtection } from '../../queries/protection.ts'
import { useWalletBalances } from '../../queries/wallet.ts'
import { TOKEN } from '../../tokens.ts'
import { PoolGate } from '../Pool/PoolGate.tsx'
import { ProtectionBlock } from '../Pool/ProtectionBlock.tsx'
import { positionForecast } from './forecast.ts'

const SLIDER_STEP_BPS = 25

function delta(now: Micro, after: Micro): string {
  const d = after - now
  if (d === 0n) return '0.00'
  return `${d > 0n ? '+' : '−'}${formatAmount(d < 0n ? -d : d)}`
}

function Holdings({ pool, owner, now }: { pool: PoolView; owner: string; now: bigint }) {
  const [lossBps, setLossBps] = useState(1_500)
  const balances = useWalletBalances(pool, owner)
  const protection = useProtection(pool)
  const sells = (balances.data?.sellerShares ?? 0n) > 0n
  const contracts = usePoolContracts(pool, sells)

  const failed = balances.error ?? protection.error ?? contracts.error
  if (failed) return <Refused>rpc error: {failed.message}</Refused>
  if (!balances.data || protection.isPending || (sells && !contracts.data)) {
    return <div className="text-sec">reading the wallet…</div>
  }

  const forecast = positionForecast(
    {
      pool,
      nowUnix: now,
      wallet: balances.data,
      protection: protection.data ?? null,
      poolContracts: contracts.data ?? [],
    },
    lossBps,
  )
  if (forecast.rows.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <div>This wallet holds nothing in pool {pool.id}.</div>
        <Link to={`/pool/${pool.id}/deposit`} className="text-sec underline underline-offset-4">
          deposit into a tranche
        </Link>
      </div>
    )
  }

  const pctText = formatBps(lossBps)
  // Below xl the position name takes its own line: three amounts of a pool grown to nine
  // digits already fill a 375 px sheet.
  const grid =
    'grid grid-cols-3 gap-x-3 border-b border-hair py-1.5 text-[12px] [overflow-wrap:anywhere] xl:grid-cols-[2fr_1.3fr_1.3fr_1fr] xl:text-[14px]'
  const name = 'col-span-3 xl:col-span-1'
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="lbl">If the pool loses</span>
          <span className="text-[18px]">{pctText}</span>
        </div>
        <input
          type="range"
          min={0}
          max={10_000}
          step={SLIDER_STEP_BPS}
          value={lossBps}
          onChange={(e) => setLossBps(Number(e.target.value))}
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
          <span className={name}>Position, {TOKEN}</span>
          <span className="text-right">Now</span>
          <span className="text-right">If {pctText} loss</span>
          <span className="text-right">Change</span>
        </div>
        {forecast.rows.map((r) => (
          <div key={r.key} className={grid}>
            <span className={name}>
              {r.label}
              {r.note ? <span className="text-sec"> · {r.note}</span> : null}
            </span>
            <span className="text-right">{formatAmount(r.now)}</span>
            <span className="text-right">{formatAmount(r.after)}</span>
            <span className="text-right">{delta(r.now, r.after)}</span>
          </div>
        ))}
        <div className={`${grid} border-b-0 border-t-2 border-t-ink`}>
          <span className={name}>TOTAL</span>
          <span className="text-right">{formatAmount(forecast.now)}</span>
          <span className="text-right">{formatAmount(forecast.after)}</span>
          <span className="text-right">{delta(forecast.now, forecast.after)}</span>
        </div>
      </div>
      <div className="text-[11px] text-sec">
        now — what a redemption pays at this moment · after — if the operator recorded this loss now
        and every covered claim were settled · the pool's own waterfall, the same arithmetic the
        chain runs
      </div>
    </>
  )
}

function PublicState({ pool, now }: { pool: PoolView; now: bigint }) {
  const accrued = accruedView(pool, now)
  return (
    <>
      <div className="text-sec">Connect a wallet to see its positions and the loss forecast.</div>
      <Pairs
        rows={[
          ['Assets', `${formatAmount(accrued.assets)} ${TOKEN}`],
          ['Senior', `${formatAmount(accrued.senior.assets)} ${TOKEN}`],
          ['Senior NAV', formatNav(accrued.senior.assets, accrued.senior.supply)],
          ['Junior', `${formatAmount(accrued.junior.assets)} ${TOKEN}`],
          ['Junior NAV', formatNav(accrued.junior.assets, accrued.junior.supply)],
          ['Losses recorded', String(pool.lossCount)],
        ]}
      />
      <ProtectionBlock pool={pool} />
    </>
  )
}

function PositionSheet({ pool }: { pool: PoolView }) {
  const wallet = useWallet()
  const now = useUnixNow()
  const poolLabel = `POOL ${pool.id} · ${TOKEN}`
  return (
    <Sheet>
      <Nav />
      <div className="flex max-w-[900px] flex-col gap-[22px]">
        {/* A 44-character address has no break points and pushes a 375 px sheet sideways. */}
        <div className="break-all">
          POSITION · {poolLabel}
          {wallet.address ? ` · ${wallet.address}` : ''}
        </div>
        {wallet.address ? (
          <Holdings pool={pool} owner={wallet.address} now={now} />
        ) : (
          <PublicState pool={pool} now={now} />
        )}
      </div>
      <TitleBlock
        title={wallet.address ? 'Position sheet' : 'Position — no wallet'}
        sheet={5}
        modelDay={modelDay(projectedModelTime(pool, now))}
        poolLabel={poolLabel}
        scale={formatScale(pool.params.timeScale)}
      />
    </Sheet>
  )
}

export function PositionScreen() {
  const { defaultPool } = useAppConfig()
  return <PoolGate id={String(defaultPool)}>{(pool) => <PositionSheet pool={pool} />}</PoolGate>
}
