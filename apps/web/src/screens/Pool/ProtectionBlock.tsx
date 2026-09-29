import type { PoolView } from '@washapp/chain'
import { formatAmount } from '@washapp/shared'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Pairs, Refused } from '../../components/chrome.tsx'
import { formatBps } from '../../format.ts'
import { useProtection } from '../../queries/protection.ts'
import { TOKEN } from '../../tokens.ts'

// The public state of the pool's protection market (FR-011) — read without a wallet;
// buying, selling and claims live on the desk.
export function ProtectionBlock({ pool }: { pool: PoolView }) {
  const protection = useProtection(pool)
  const desk = `/pool/${pool.id}/protection`
  let body: ReactNode
  if (protection.data) {
    const p = protection.data
    body = (
      <>
        <Pairs
          rows={[
            ['Collateral', `${formatAmount(p.collateral)} ${TOKEN}`],
            ['Reserved', `${formatAmount(p.reserved)} ${TOKEN}`],
            ['Free', `${formatAmount(p.free)} ${TOKEN}`],
            ['Premium', `${formatBps(p.params.premiumRateBps)}/yr`],
            ['Trigger', formatBps(p.params.triggerBps)],
          ]}
        />
        <div className="text-[11px] text-sec">
          {String(p.contracts)} {p.contracts === 1n ? 'contract' : 'contracts'} bought ·{' '}
          <Link to={desk} className="underline underline-offset-4 hover:text-ink">
            open the protection desk
          </Link>
        </div>
      </>
    )
  } else if (protection.isPending) {
    body = <div className="text-[11px] text-sec">reading the protection market…</div>
  } else if (protection.isError) {
    body = <Refused>rpc error: {protection.error.message}</Refused>
  } else {
    body = <div className="text-[11px] text-sec">no protection market on this pool yet</div>
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="lbl">Protection</div>
      {body}
    </div>
  )
}
