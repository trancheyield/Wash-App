import { formatAmount } from '@washapp/shared'
import { useNavigate } from 'react-router'
import { Nav } from '../../chrome/Chrome.tsx'
import { Cascade } from '../../components/Cascade.tsx'
import { Btn, Columns, Pairs, Sheet, TitleBlock, useCompact } from '../../components/chrome.tsx'
import {
  faucetPerRequest,
  poolAfterAccrual,
  poolParams,
  protectionState,
  TOKEN,
} from '../../mock/data.ts'
import { formatBps } from '../../mock/forecast.ts'

export function PoolScreen() {
  const compact = useCompact()
  const navigate = useNavigate()
  const free = protectionState.collateral - protectionState.reserved
  return (
    <Sheet>
      <Nav />
      <Columns
        drawing={
          <Cascade
            pool={poolAfterAccrual}
            fig="FIG. 1 — CASCADE, POOL 0"
            compact={compact}
            yieldRateBps={poolParams.yieldRateBps}
            seniorRateBps={poolParams.seniorRateBps}
            minJuniorBps={poolParams.minJuniorBps}
          />
        }
      >
        <div>
          <div>POOL 0 · {TOKEN}</div>
          <div className="text-[11px] text-sec">
            simulated lending pool · yield and losses set by the operator · clock 1 min : 30 days
          </div>
        </div>
        <Pairs
          rows={[
            ['Yield', `${formatBps(poolParams.yieldRateBps)}/yr`],
            ['Senior rated', `${formatBps(poolParams.seniorRateBps)}/yr`],
            ['Junior floor', formatBps(poolParams.minJuniorBps)],
            ['Performance fee', '10 %'],
            ['Clock', `${poolParams.timeScale.toLocaleString('en-US')}×`],
            ['Model day', String(poolParams.modelDay)],
            ['Last accrual', `model day ${poolParams.modelDay}`],
          ]}
        />
        <div>
          <div className="lbl">Loss events</div>
          <div className="text-[11px] text-sec">none recorded</div>
        </div>
        <div className="flex flex-col gap-2.5">
          <div className="lbl">Protection</div>
          <Pairs
            rows={[
              ['Collateral', `${formatAmount(protectionState.collateral)} ${TOKEN}`],
              ['Reserved', `${formatAmount(protectionState.reserved)} ${TOKEN}`],
              ['Free', `${formatAmount(free)} ${TOKEN}`],
            ]}
          />
          <div>
            <Btn label="Open protection desk" onClick={() => navigate('/pool/0/protection')} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-3">
            <Btn label="Deposit" primary onClick={() => navigate('/pool/0/deposit')} />
            <Btn label="Redeem" onClick={() => navigate('/pool/0/deposit')} />
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px] text-sec">
            <span>
              devnet faucet: {formatAmount(faucetPerRequest)} {TOKEN} per request
            </span>
            <Btn label="Request" />
          </div>
        </div>
      </Columns>
      <TitleBlock title="Pool 0 — cascade" sheet={1} modelDay={poolParams.modelDay} />
    </Sheet>
  )
}
