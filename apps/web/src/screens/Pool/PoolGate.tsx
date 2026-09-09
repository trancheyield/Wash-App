import type { PoolView } from '@washapp/chain'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { Nav } from '../../chrome/Chrome.tsx'
import { Refused, Sheet } from '../../components/chrome.tsx'
import { useAppConfig } from '../../providers.tsx'
import { parsePoolId, usePool } from '../../queries/pool.ts'

function Notice({ children }: { children: ReactNode }) {
  return (
    <Sheet>
      <Nav />
      <div className="flex flex-col gap-3 text-[12px]">{children}</div>
    </Sheet>
  )
}

// Один вхід для всіх аркушів за `/pool/:id`: читає пул і віддає його дитині, а стани
// «читаю» / «RPC error» / «пулу немає» показує сам — інакше кожен аркуш дублював би їх.
export function PoolGate({ children }: { children: (pool: PoolView) => ReactNode }) {
  const { id } = useParams()
  const { defaultPool, chain } = useAppConfig()
  const cluster = chain.replace('solana:', '')
  const poolId = parsePoolId(id)
  const pool = usePool(poolId)

  if (pool.data) return <>{children(pool.data)}</>
  if (pool.isPending) {
    return (
      <Notice>
        <span className="text-sec">
          reading pool {id} from {cluster}…
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
        pool {id} does not exist on {cluster}
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
