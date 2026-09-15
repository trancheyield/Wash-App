import type { PoolView } from '@washapp/chain'
import { formatAmount } from '@washapp/shared'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { Nav } from '../../chrome/Chrome.tsx'
import { Cascade } from '../../components/Cascade.tsx'
import { Btn, Columns, Pairs, Sheet, TitleBlock, useCompact } from '../../components/chrome.tsx'
import { formatBps } from '../../format.ts'
import {
  describeScale,
  formatScale,
  modelDay,
  projectedModelTime,
  useUnixNow,
} from '../../model-clock.ts'
import { TOKEN } from '../../tokens.ts'
import { FaucetRow } from './Faucet.tsx'
import { LossHistory } from './LossHistory.tsx'
import { PoolGate } from './PoolGate.tsx'

// Мітка першого рендера з даними пулу — число SC-008 знімається з
// `performance.getEntriesByName(POOL_RENDERED_MARK)` у браузері.
export const POOL_RENDERED_MARK = 'washapp:pool-rendered'

// Стан пулу, який показує аркуш; порожній стан і помилки — окремими гілками нижче.
function PoolSheet({ pool }: { pool: PoolView }) {
  useEffect(() => {
    performance.mark(POOL_RENDERED_MARK)
  }, [])
  const compact = useCompact()
  const navigate = useNavigate()
  const now = useUnixNow()
  const day = modelDay(projectedModelTime(pool, now))
  const accruedDay = modelDay(pool.modelTime)
  const base = `/pool/${pool.id}`
  const poolLabel = `POOL ${pool.id} · ${TOKEN}`
  return (
    <Sheet>
      <Nav />
      <Columns
        drawing={
          <Cascade
            pool={pool}
            fig={`FIG. 1 — CASCADE, POOL ${pool.id}`}
            compact={compact}
            yieldRateBps={BigInt(pool.params.yieldRateBps)}
            seniorRateBps={BigInt(pool.params.seniorRateBps)}
            minJuniorBps={BigInt(pool.params.minJuniorBps)}
          />
        }
      >
        <div>
          <div>{poolLabel}</div>
          <div className="text-[11px] text-sec">
            simulated lending pool · yield and losses set by the operator ·{' '}
            {describeScale(pool.params.timeScale)}
          </div>
        </div>
        <Pairs
          rows={[
            ['Yield', `${formatBps(pool.params.yieldRateBps)}/yr`],
            ['Senior rated', `${formatBps(pool.params.seniorRateBps)}/yr`],
            ['Junior floor', formatBps(pool.params.minJuniorBps)],
            ['Performance fee', formatBps(pool.params.perfFeeBps)],
            ['Clock', `${pool.params.timeScale.toLocaleString('en-US')}×`],
            ['Model day', String(day)],
            ['Last accrual', `model day ${accruedDay}`],
            ['Assets', `${formatAmount(pool.assets)} ${TOKEN}`],
          ]}
        />
        <LossHistory pool={pool} />
        <div className="flex flex-col gap-2.5">
          <div className="lbl">Protection</div>
          <div className="text-[11px] text-sec">
            not yet on this pool · the protection desk arrives with the next release
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-3">
            <Btn label="Deposit" primary onClick={() => navigate(`${base}/deposit`)} />
            <Btn label="Redeem" onClick={() => navigate(`${base}/redeem`)} />
          </div>
          <FaucetRow pool={pool} />
        </div>
      </Columns>
      <TitleBlock
        title={`Pool ${pool.id} — cascade`}
        sheet={1}
        modelDay={day}
        poolLabel={poolLabel}
        scale={formatScale(pool.params.timeScale)}
      />
    </Sheet>
  )
}

export function PoolScreen() {
  return <PoolGate>{(pool) => <PoolSheet pool={pool} />}</PoolGate>
}
