import type { PoolView } from '@washapp/chain'
import { formatAmount } from '@washapp/shared'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Nav } from '../../chrome/Chrome.tsx'
import { Cascade } from '../../components/Cascade.tsx'
import {
  Btn,
  Columns,
  Pairs,
  Refused,
  Sheet,
  TitleBlock,
  useCompact,
} from '../../components/chrome.tsx'
import { formatBps } from '../../format.ts'
import {
  describeScale,
  formatScale,
  modelDay,
  projectedModelTime,
  useUnixNow,
} from '../../model-clock.ts'
import { useAppConfig } from '../../providers.tsx'
import { parsePoolId, usePool } from '../../queries/pool.ts'
import { TOKEN } from '../../tokens.ts'
import { FaucetRow } from './Faucet.tsx'

// Стан пулу, який показує аркуш; порожній стан і помилки — окремими гілками нижче.
function PoolSheet({ pool }: { pool: PoolView }) {
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
        <div>
          <div className="lbl">Loss events</div>
          <div className="text-[11px] text-sec">
            {pool.lossCount === 0 ? (
              'none recorded'
            ) : (
              <Link to={`${base}/loss`}>{pool.lossCount} recorded · see loss events</Link>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          <div className="lbl">Protection</div>
          <div className="text-[11px] text-sec">
            not yet on this pool · the protection desk arrives with the next release
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-3">
            <Btn label="Deposit" primary onClick={() => navigate(`${base}/deposit`)} />
            <Btn label="Redeem" onClick={() => navigate(`${base}/deposit`)} />
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

function Notice({ children }: { children: ReactNode }) {
  return (
    <Sheet>
      <Nav />
      <div className="flex flex-col gap-3 text-[12px]">{children}</div>
    </Sheet>
  )
}

export function PoolScreen() {
  const { id } = useParams()
  const { defaultPool, chain } = useAppConfig()
  const poolId = parsePoolId(id)
  const pool = usePool(poolId)

  if (pool.data) return <PoolSheet pool={pool.data} />
  if (pool.isPending) {
    return (
      <Notice>
        <span className="text-sec">
          reading pool {id} from {chain.replace('solana:', '')}…
        </span>
      </Notice>
    )
  }
  if (pool.isError) {
    return (
      <Notice>
        <Refused>rpc error: {pool.error.message}</Refused>
        <span className="text-sec">retrying every 5 s</span>
      </Notice>
    )
  }
  return (
    <Notice>
      <span>
        pool {id} does not exist on {chain.replace('solana:', '')}
      </span>
      {poolId !== defaultPool ? (
        <Link to={`/pool/${defaultPool}`} className="text-sec underline underline-offset-4">
          open pool {defaultPool}
        </Link>
      ) : (
        <span className="text-sec">
          the operator creates it with <code>pnpm demo:init</code>
        </span>
      )}
    </Notice>
  )
}
