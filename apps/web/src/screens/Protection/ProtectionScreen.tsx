import { formatAmount, parseAmount } from '@washapp/shared'
import { useState } from 'react'
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
  type Contract,
  contract0,
  demoLossBps,
  poolParams,
  protectionParams,
  protectionState,
  TOKEN,
} from '../../mock/data.ts'
import { formatBps, payout, premium } from '../../mock/forecast.ts'
import { CoverVessel } from './CoverVessel.tsx'

export function ProtectionScreen() {
  const compact = useCompact()
  const [collateral, setCollateral] = useState(protectionState.collateral)
  const [reserved, setReserved] = useState(protectionState.reserved)
  const [sellText, setSellText] = useState('5,000.00')
  const [notionalText, setNotionalText] = useState('20,000.00')
  const [termText, setTermText] = useState('90')
  const [contracts, setContracts] = useState<Contract[]>([contract0])

  const free = collateral - reserved
  const sellAmount = parseAmount(sellText)
  const withdrawRefused = sellAmount !== null && sellAmount > free
  const notional = parseAmount(notionalText)
  const termDays = /^\d{1,4}$/.test(termText.trim()) ? BigInt(termText.trim()) : null
  const buyPremium =
    notional !== null && termDays !== null
      ? premium(notional, protectionParams.premiumRateBps, termDays)
      : null
  const buyRefused = notional !== null && notional > free

  function provide() {
    if (sellAmount === null || sellAmount === 0n) return
    setCollateral(collateral + sellAmount)
  }
  function withdraw() {
    if (sellAmount === null || withdrawRefused) return
    setCollateral(collateral - sellAmount)
  }
  function buy() {
    if (notional === null || termDays === null || buyPremium === null || buyRefused) return
    const fee = (buyPremium * protectionParams.premiumFeeBps) / 10_000n
    setCollateral(collateral + buyPremium - fee)
    setReserved(reserved + notional)
    setContracts([
      ...contracts,
      {
        nonce: contracts.length,
        buyer: '7xKp…mN4e',
        notional,
        premium: buyPremium,
        startDay: poolParams.modelDay,
        expiryDay: poolParams.modelDay + Number(termDays),
        status: 'ACTIVE',
        payout: 0n,
      },
    ])
  }
  function settle(c: Contract) {
    const paid = payout(c.notional, demoLossBps, protectionParams.triggerBps)
    setCollateral(collateral - paid)
    setReserved(reserved - c.notional)
    setContracts(
      contracts.map((x) => (x.nonce === c.nonce ? { ...x, status: 'SETTLED', payout: paid } : x)),
    )
  }

  const grid =
    'grid grid-cols-[.5fr_1.5fr_1.5fr_.9fr_2fr] gap-3 border-b border-hair py-1.5 text-[12px] items-baseline'

  return (
    <Sheet>
      <Nav />
      <Columns
        drawing={<CoverVessel collateral={collateral} reserved={reserved} compact={compact} />}
      >
        <div className="flex flex-col gap-2">
          <div>SELL COVER</div>
          <Pairs
            rows={[
              ['Premium', `${formatBps(protectionParams.premiumRateBps)}/yr OF NOTIONAL`],
              ['Trigger', formatBps(protectionParams.triggerBps)],
              ['Your share', `100.00 % · ${formatAmount(collateral)} ${TOKEN}`],
              ['Withdrawable', `${formatAmount(free)} ${TOKEN}`],
            ]}
          />
          <Field label="Amount" unit={TOKEN} value={sellText} onChange={setSellText} />
          {withdrawRefused ? (
            <Refused>
              {formatAmount(free)} {TOKEN} is free; {formatAmount(reserved)} {TOKEN} is reserved by
              active cover.
            </Refused>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Btn label="Provide" disabled={sellAmount === null} onClick={provide} />
            <Btn
              label="Withdraw"
              disabled={sellAmount === null || withdrawRefused}
              onClick={withdraw}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div>BUY COVER</div>
          <Field label="Notional" unit={TOKEN} value={notionalText} onChange={setNotionalText} />
          <Field label="Term" unit="model days" value={termText} onChange={setTermText} />
          {buyRefused ? (
            <Refused>
              Free collateral is {formatAmount(free)} {TOKEN}.
            </Refused>
          ) : buyPremium !== null && termDays !== null ? (
            <Pairs
              rows={[
                ['Premium', `${formatAmount(buyPremium)} ${TOKEN}`],
                ['Expires', `model day ${poolParams.modelDay + Number(termDays)}`],
                ['Pays', `notional × loss % when loss ≥ ${formatBps(protectionParams.triggerBps)}`],
              ]}
            />
          ) : (
            <Refused>Enter a notional and a term in whole model days.</Refused>
          )}
          <div>
            <Btn
              label="Buy cover"
              primary
              disabled={buyRefused || buyPremium === null}
              onClick={buy}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div>YOUR CONTRACTS</div>
          <div className={`${grid} lbl`}>
            <span>#</span>
            <span>Notional</span>
            <span>Term</span>
            <span className="text-right">Premium</span>
            <span>Status</span>
          </div>
          {contracts.map((c) => (
            <div key={c.nonce} className={grid}>
              <span>#{c.nonce}</span>
              <span>
                {formatAmount(c.notional)} {TOKEN}
              </span>
              <span>
                day {c.startDay} → {c.expiryDay}
              </span>
              <span className="text-right">{formatAmount(c.premium)}</span>
              <span className="flex flex-wrap items-center gap-2">
                {c.status === 'SETTLED' ? (
                  `SETTLED · paid ${formatAmount(c.payout)} ${TOKEN}`
                ) : (
                  <>
                    ACTIVE <Btn label="Settle" onClick={() => settle(c)} />
                  </>
                )}
              </span>
            </div>
          ))}
          <div className="text-[11px] text-sec">
            loss event 0 ({formatBps(demoLossBps)}) qualifies · payout{' '}
            {formatAmount(payout(contract0.notional, demoLossBps, protectionParams.triggerBps))}{' '}
            {TOKEN} on #0
          </div>
        </div>
      </Columns>
      <TitleBlock title="Protection desk" sheet={4} modelDay={poolParams.modelDay} />
    </Sheet>
  )
}
