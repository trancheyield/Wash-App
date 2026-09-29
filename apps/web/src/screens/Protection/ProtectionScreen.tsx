import type { UiWalletAccount } from '@wallet-standard/react'
import {
  buildBuy,
  buildExpire,
  buildProvide,
  buildSettle,
  buildWithdraw,
  type ContractView,
  type PoolView,
  type ProtectionView,
  type WalletView,
} from '@washapp/chain'
import { amountSchema, formatAmount, type Micro } from '@washapp/shared'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { Nav } from '../../chrome/Chrome.tsx'
import { useWallet } from '../../chrome/Wallet.tsx'
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
import { formatBps, formatNav } from '../../format.ts'
import {
  DAY_SECONDS,
  formatScale,
  modelDay,
  projectedModelTime,
  useUnixNow,
} from '../../model-clock.ts'
import { useProtection } from '../../queries/protection.ts'
import { useWalletBalances } from '../../queries/wallet.ts'
import { TOKEN } from '../../tokens.ts'
import { shortAddress } from '../../wallets.ts'
import { Notice, PoolGate } from '../Pool/PoolGate.tsx'
import { CoverVessel } from './CoverVessel.tsx'
import {
  type BuyForm,
  type BuyPreview,
  buyFormSchema,
  type ContractState,
  type CoverState,
  contractState,
  type Holdings,
  maxWithdrawShares,
  premiumPreview,
  type SellMode,
  type SellPreview,
  SHARES,
  sellPreview,
  triggerLine,
} from './cover.ts'
import { SendButton, type Sent, seconds } from './SendButton.tsx'

type DeskProps = { pool: PoolView; protection: ProtectionView }
type Draft = 'sell' | 'buy' | null

function holdingsOf(wallet: WalletView | undefined): Holdings {
  return wallet ? { base: wallet.base, sellerShares: wallet.sellerShares } : null
}

function MarketPairs({ protection }: { protection: ProtectionView }) {
  return (
    <div className="flex flex-col gap-1">
      <div>COVER POOL</div>
      <Pairs
        rows={[
          ['Collateral', `${formatAmount(protection.collateral)} ${TOKEN}`],
          ['Reserved', `${formatAmount(protection.reserved)} ${TOKEN}`],
          ['Free', `${formatAmount(protection.free)} ${TOKEN}`],
          ['Premium', `${formatBps(protection.params.premiumRateBps)}/yr OF NOTIONAL`],
          ['Trigger', formatBps(protection.params.triggerBps)],
          ['Protocol fee', `${formatBps(protection.params.premiumFeeBps)} OF PREMIUM`],
          ['Share value', `${formatNav(protection.collateral, protection.shareSupply)} ${TOKEN}`],
        ]}
      />
    </div>
  )
}

function ModeSwitch({ mode, onPick }: { mode: SellMode; onPick: (mode: SellMode) => void }) {
  return (
    <div className="flex text-lbl uppercase text-sec">
      {(['provide', 'withdraw'] as const).map((m, i) => (
        <span key={m} className="flex">
          <button
            type="button"
            className={`px-1.5 uppercase ${m === mode ? 'text-ink underline underline-offset-4' : 'hover:text-ink'}`}
            onClick={() => onPick(m)}
          >
            {m}
          </button>
          {i === 0 ? <span className="px-1.5">·</span> : null}
        </span>
      ))}
    </div>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 text-[11px] text-sec">
      {children}
    </div>
  )
}

type SellHintProps = {
  mode: SellMode
  connected: boolean
  wallet: WalletView | undefined
  protection: ProtectionView
  onMax: () => void
}

// Under the field: what the seller has in the unit of the mode; for withdrawal, how much
// of it the reserve holds back and a "max" that fills the withdrawable shares.
function SellHint({ mode, connected, wallet, protection, onMax }: SellHintProps) {
  if (!connected) return <Hint>connect a wallet to see what you hold</Hint>
  if (!wallet) return <Hint>reading your balances…</Hint>
  if (mode === 'provide') {
    return (
      <Hint>
        available {formatAmount(wallet.base)} {TOKEN}
      </Hint>
    )
  }
  const max = maxWithdrawShares(protection, wallet.sellerShares)
  return (
    <Hint>
      <span>
        holding {formatAmount(wallet.sellerShares)} {SHARES} · worth{' '}
        {formatAmount(wallet.sellerValue)} {TOKEN}
        {max < wallet.sellerShares ? ` · ${formatAmount(max)} withdrawable now` : ''}
      </span>
      <button
        type="button"
        className="lbl underline underline-offset-4 hover:text-ink"
        onClick={onMax}
      >
        max
      </button>
    </Hint>
  )
}

function SellRows({ mode, preview }: { mode: SellMode; preview: SellPreview | null }) {
  if (!preview) return <Hint>enter an amount to preview</Hint>
  if (preview.kind === 'refused') return <Refused>{preview.reason}</Refused>
  return (
    <Pairs
      rows={
        mode === 'provide'
          ? [
              ['You receive', `${formatAmount(preview.receive)} ${SHARES}`],
              ['Collateral after', `${formatAmount(preview.after.collateral)} ${TOKEN}`],
            ]
          : [
              ['You receive', `${formatAmount(preview.receive)} ${TOKEN}`],
              ['Collateral after', `${formatAmount(preview.after.collateral)} ${TOKEN}`],
            ]
      }
    />
  )
}

function BuyRows({
  preview,
  protection,
}: {
  preview: BuyPreview | null
  protection: ProtectionView
}) {
  if (!preview) return <Hint>enter a notional and a term in whole model days</Hint>
  if (preview.kind === 'refused') return <Refused>{preview.reason}</Refused>
  return (
    <Pairs
      rows={[
        ['Premium', `${formatAmount(preview.premium, 6)} ${TOKEN}`],
        ['Of which fee', `${formatAmount(preview.fee, 6)} ${TOKEN}`],
        // The term starts at the confirming slot; on a fast clock that is a model day or two later.
        ['Expires', `≈ model day ${modelDay(preview.expiryModelTime)}`],
        ['Pays', triggerLine(protection)],
      ]}
    />
  )
}

type RowProps = {
  contract: ContractView
  state: ContractState
  account: UiWalletAccount | undefined
  pool: PoolView
  onDone: (sent: Sent) => void
}

const GRID =
  'grid grid-cols-[auto_1fr_1fr_1fr] gap-x-3 gap-y-1 border-b border-hair py-1.5 text-[12px] items-baseline xl:grid-cols-[auto_1fr_1fr_1fr_2fr]'

function StatusCell({ contract, state, account, pool, onDone }: RowProps) {
  const nonce = contract.nonce
  switch (state.kind) {
    case 'settled':
      return (
        <>
          SETTLED · paid {formatAmount(state.payout)} {TOKEN} on loss #{state.lossIndex}
        </>
      )
    case 'expired':
      return <>EXPIRED · premium kept by sellers</>
    case 'covered':
      return (
        <>
          ACTIVE · {String(state.daysLeft)} model {state.daysLeft === 1n ? 'day' : 'days'} left
        </>
      )
    case 'claim':
      return (
        <span className="flex flex-wrap items-center gap-2">
          LOSS #{state.event.index} {formatBps(state.event.lossBps)} · pays{' '}
          {formatAmount(state.payout)} {TOKEN}
          {account ? (
            <SendButton
              account={account}
              pool={pool}
              label="Settle"
              what={`settled #${nonce} on loss #${state.event.index}: ${formatAmount(state.payout)} ${TOKEN} paid`}
              disabled={false}
              build={async () => [
                await buildSettle({
                  poolId: pool.id,
                  buyer: contract.buyer,
                  nonce,
                  lossIndex: state.event.index,
                }),
              ]}
              onDone={onDone}
            />
          ) : null}
        </span>
      )
    case 'expirable':
      return (
        <span className="flex flex-wrap items-center gap-2">
          TERM OVER · no covered loss
          {account ? (
            <SendButton
              account={account}
              pool={pool}
              label="Close"
              what={`closed #${nonce}: ${formatAmount(contract.notional)} ${TOKEN} of reserve released`}
              disabled={false}
              build={async (signer) => [
                await buildExpire({ signer, poolId: pool.id, buyer: contract.buyer, nonce }),
              ]}
              onDone={onDone}
            />
          ) : null}
        </span>
      )
  }
}

type ContractsProps = {
  pool: PoolView
  modelTime: bigint
  account: UiWalletAccount | undefined
  wallet: WalletView | undefined
  onDone: (sent: Sent) => void
}

function Contracts({ pool, modelTime, account, wallet, onDone }: ContractsProps) {
  let body: ReactNode
  if (!account) body = <Hint>connect a wallet to see your contracts</Hint>
  else if (!wallet) body = <Hint>reading your contracts…</Hint>
  else if (wallet.contracts.length === 0) body = <Hint>none bought on this pool</Hint>
  else {
    body = wallet.contracts.map((c) => (
      <div key={c.address} className={GRID}>
        <span>#{String(c.nonce)}</span>
        <span>
          {formatAmount(c.notional)} {TOKEN}
        </span>
        <span>
          day {modelDay(c.startModelTime)} → {modelDay(c.expiryModelTime)}
        </span>
        <span className="text-right">{formatAmount(c.premium)}</span>
        <span className="col-span-4 xl:col-span-1">
          <StatusCell
            contract={c}
            state={contractState(c, pool.lossEvents, modelTime)}
            account={account}
            pool={pool}
            onDone={onDone}
          />
        </span>
      </div>
    ))
  }
  return (
    <div className="flex flex-col gap-1">
      <div>YOUR CONTRACTS</div>
      <div className={`${GRID} lbl`}>
        <span>#</span>
        <span>Notional</span>
        <span>Term</span>
        <span className="text-right">Premium</span>
        <span className="hidden xl:block">Status</span>
      </div>
      {body}
      <Hint>
        settle pays notional × loss % from the collateral; a closed contract leaves the premium with
        the sellers
      </Hint>
    </div>
  )
}

function SentLine({ sent }: { sent: Sent }) {
  return (
    <div className="text-[12px]">
      confirmed · {sent.what} · {seconds(sent.confirmedMs)} to confirm, {seconds(sent.refreshedMs)}{' '}
      to the screen · tx {shortAddress(sent.signature)}
    </div>
  )
}

// Everything the desk computes from the forms and the chain; the drawing follows the form
// edited last, so it shows the pool the next signature would leave behind.
function derive(
  protection: ProtectionView,
  modelTime: bigint,
  wallet: WalletView | undefined,
  sell: { mode: SellMode; text: string },
  buy: { notional: string; term: string },
  draft: Draft,
) {
  const holdings = holdingsOf(wallet)
  const sellValue = amountSchema.safeParse(sell.text)
  const sellResult: SellPreview | null =
    sell.text.trim() === ''
      ? null
      : sellValue.success
        ? sellPreview({ protection, mode: sell.mode, value: sellValue.data, wallet: holdings })
        : { kind: 'refused', reason: sellValue.error.issues[0]?.message ?? 'enter an amount' }
  const buyForm = buyFormSchema.safeParse({ notional: buy.notional, termDays: buy.term })
  const buyResult: BuyPreview | null =
    buy.notional.trim() === '' && buy.term.trim() === ''
      ? null
      : buyForm.success
        ? premiumPreview({ protection, modelTime, form: buyForm.data, wallet: holdings })
        : { kind: 'refused', reason: buyForm.error.issues[0]?.message ?? 'enter a notional' }
  const current: CoverState = { collateral: protection.collateral, reserved: protection.reserved }
  const pick = draft === 'sell' ? sellResult : draft === 'buy' ? buyResult : null
  return {
    sellValue: sellValue.success ? sellValue.data : null,
    sellResult,
    buyForm: buyForm.success ? buyForm.data : null,
    buyResult,
    drawn: pick?.kind === 'ok' ? pick.after : current,
  }
}

type SellButtonProps = {
  account: UiWalletAccount | undefined
  pool: PoolView
  mode: SellMode
  value: Micro | null
  ready: boolean
  onDone: (sent: Sent) => void
}

function SellButton({ account, pool, mode, value, ready, onDone }: SellButtonProps) {
  if (!account) return <Btn label="connect a wallet to sign" disabled />
  const amount = value ?? 0n
  const shown = formatAmount(amount)
  const verb = mode === 'provide' ? 'Provide' : 'Withdraw'
  return (
    <SendButton
      account={account}
      pool={pool}
      label={
        value === null ? `${verb} —` : `${verb} ${shown} ${mode === 'provide' ? TOKEN : SHARES}`
      }
      what={mode === 'provide' ? `provided ${shown} ${TOKEN}` : `withdrew ${shown} ${SHARES}`}
      disabled={!ready}
      build={async (signer) =>
        mode === 'provide'
          ? [await buildProvide({ owner: signer, poolId: pool.id, amount })]
          : buildWithdraw({ owner: signer, poolId: pool.id, shares: amount })
      }
      onDone={onDone}
    />
  )
}

type BuyButtonProps = {
  account: UiWalletAccount | undefined
  pool: PoolView
  protection: ProtectionView
  form: BuyForm | null
  ready: boolean
  onDone: (sent: Sent) => void
}

function BuyButton({ account, pool, protection, form, ready, onDone }: BuyButtonProps) {
  if (!account) return <Btn label="connect a wallet to sign" primary disabled />
  return (
    <SendButton
      account={account}
      pool={pool}
      primary
      label={form ? `Buy ${formatAmount(form.notional)} ${TOKEN} of cover` : 'Buy cover —'}
      what={
        form
          ? `bought ${formatAmount(form.notional)} ${TOKEN} of cover for ${form.termDays} model ${form.termDays === 1n ? 'day' : 'days'}`
          : 'bought cover'
      }
      disabled={!ready}
      build={async (signer) => {
        if (!form) throw new Error('buy without a valid form')
        return [
          await buildBuy({
            buyer: signer,
            poolId: pool.id,
            notional: form.notional,
            term: form.termDays * DAY_SECONDS,
            // The market's counter at send time; the contract PDA includes the buyer,
            // so a nonce another buyer took does not collide.
            nonce: protection.contracts,
          }),
        ]
      }}
      onDone={onDone}
    />
  )
}

function Desk({ pool, protection }: DeskProps) {
  const compact = useCompact()
  const now = useUnixNow()
  const modelTime = projectedModelTime(pool, now)
  const { account, address } = useWallet()
  const balances = useWalletBalances(pool, address)
  const wallet = balances.data
  const [mode, setMode] = useState<SellMode>('provide')
  const [sellText, setSellText] = useState('')
  const [notional, setNotional] = useState('1,000.00')
  const [term, setTerm] = useState('30')
  const [draft, setDraft] = useState<Draft>(null)
  const [sent, setSent] = useState<Sent | null>(null)

  const d = derive(
    protection,
    modelTime,
    wallet,
    { mode, text: sellText },
    { notional, term },
    draft,
  )
  const ready = Boolean(wallet)
  const sellOk = d.sellResult?.kind === 'ok' && d.sellValue !== null && ready
  const buyOk = d.buyResult?.kind === 'ok' && d.buyForm !== null && ready

  function editSell(next: string) {
    setSellText(next)
    setDraft('sell')
    setSent(null)
  }
  function editBuy(set: (v: string) => void) {
    return (next: string) => {
      set(next)
      setDraft('buy')
      setSent(null)
    }
  }
  function done(clear: () => void) {
    return (result: Sent) => {
      setSent(result)
      clear()
      setDraft(null)
    }
  }

  return (
    <Sheet>
      <Nav />
      <Columns
        drawing={
          <CoverVessel
            poolId={pool.id}
            collateral={d.drawn.collateral}
            reserved={d.drawn.reserved}
            compact={compact}
          />
        }
      >
        <MarketPairs protection={protection} />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div>SELL COVER</div>
              <div className="text-[11px] text-sec">
                {mode === 'provide'
                  ? 'collateral earns the premiums and pays the claims, pro rata to shares'
                  : 'only the free part of the collateral can leave'}
              </div>
            </div>
            <ModeSwitch
              mode={mode}
              onPick={(m) => {
                setMode(m)
                setSellText('')
                setDraft(null)
                setSent(null)
              }}
            />
          </div>
          <Field
            label="Amount"
            unit={mode === 'provide' ? TOKEN : SHARES}
            value={sellText}
            onChange={editSell}
          />
          <SellHint
            mode={mode}
            connected={Boolean(account)}
            wallet={wallet}
            protection={protection}
            onMax={() =>
              editSell(formatAmount(maxWithdrawShares(protection, wallet?.sellerShares ?? 0n), 6))
            }
          />
          <SellRows mode={mode} preview={d.sellResult} />
          <div className="flex flex-wrap gap-3">
            <SellButton
              account={account}
              pool={pool}
              mode={mode}
              value={d.sellValue}
              ready={sellOk}
              onDone={done(() => setSellText(''))}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div>
            <div>BUY COVER</div>
            <div className="text-[11px] text-sec">
              premium paid up front · the notional is reserved from the collateral for the term
            </div>
          </div>
          <Field label="Notional" unit={TOKEN} value={notional} onChange={editBuy(setNotional)} />
          <Field label="Term" unit="model days" value={term} onChange={editBuy(setTerm)} />
          <BuyRows preview={d.buyResult} protection={protection} />
          <div className="flex flex-wrap gap-3">
            <BuyButton
              account={account}
              pool={pool}
              protection={protection}
              form={d.buyForm}
              ready={buyOk}
              onDone={done(() => setNotional(''))}
            />
          </div>
        </div>
        <Contracts
          pool={pool}
          modelTime={modelTime}
          account={account}
          wallet={wallet}
          onDone={done(() => undefined)}
        />
        {sent ? <SentLine sent={sent} /> : null}
      </Columns>
      <TitleBlock
        title="Protection desk"
        sheet={4}
        modelDay={modelDay(modelTime)}
        poolLabel={`POOL ${pool.id} · ${TOKEN}`}
        scale={formatScale(pool.params.timeScale)}
      />
    </Sheet>
  )
}

// The market is read after the pool: without `init_protection` the pool is fine, only
// the desk has nothing to show.
function ProtectionGate({ pool }: { pool: PoolView }) {
  const protection = useProtection(pool)
  if (protection.data) return <Desk pool={pool} protection={protection.data} />
  if (protection.isPending) {
    return (
      <Notice>
        <span className="text-sec">reading the protection market of pool {pool.id}…</span>
      </Notice>
    )
  }
  if (protection.isError) {
    return (
      <Notice>
        <Refused>rpc error: {protection.error.message}</Refused>
        <span className="text-sec">retrying every 5 s</span>
      </Notice>
    )
  }
  return (
    <Notice>
      <span>pool {pool.id} has no protection market yet</span>
      <span className="text-sec">
        the operator opens it with <code>pnpm demo:init</code>
      </span>
      <Link to={`/pool/${pool.id}`} className="text-sec underline underline-offset-4">
        back to pool {pool.id}
      </Link>
    </Notice>
  )
}

export function ProtectionScreen() {
  return <PoolGate>{(pool) => <ProtectionGate pool={pool} />}</PoolGate>
}
