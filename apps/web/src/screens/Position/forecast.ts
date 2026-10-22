// What the position sheet forecasts: the wallet's holdings if the operator recorded a
// loss of `lossBps` now, and every covered claim were then settled. `record_loss`
// accrues first, so both columns stand on the pool accrued to `nowUnix` — "now" is what
// a redemption would pay at this moment, not the state of the last accrual.
import {
  accruedView,
  amountForShares,
  ContractStatus,
  type ContractView,
  type LossEventView,
  type PoolView,
  type ProtectionView,
  poolBalances,
  type WalletView,
} from '@washapp/chain'
import {
  afterLoss,
  afterSettle,
  applyLoss,
  type ContractTerms,
  formatAmount,
  type LossEventTerms,
  lossAmount,
  type Micro,
  type PoolBalances,
  settleContract,
  WaterfallError,
  type WaterfallErrorCode,
} from '@washapp/shared'
import { modelDay } from '../../model-clock.ts'
import { JUNIOR_TOKEN, SENIOR_TOKEN, TOKEN } from '../../tokens.ts'
import { SHARES } from '../Protection/cover.ts'

export type PositionRow = {
  key: string
  label: string
  now: Micro
  after: Micro
  // Why a contract pays nothing on the hypothetical loss.
  note?: string
}

export type Forecast = { rows: PositionRow[]; now: Micro; after: Micro }

export type PositionInput = {
  pool: PoolView
  nowUnix: bigint
  wallet: WalletView
  protection: ProtectionView | null
  // Every contract in the pool, not only the wallet's: the seller pays all of them.
  poolContracts: readonly ContractView[]
}

const NOTES: Partial<Record<WaterfallErrorCode, string>> = {
  LossBelowTrigger: 'below trigger',
  LossOutsideTerm: 'outside term',
  ZeroAmount: 'rounds to zero',
}

function terms(c: ContractView): ContractTerms {
  return {
    active: c.status === ContractStatus.Active,
    notional: c.notional,
    triggerBps: c.triggerBps,
    lossIndexFrom: c.lossIndexFrom,
    expiryModelTime: c.expiryModelTime,
  }
}

// A contract settles once, on whichever covered event its buyer picks — the largest.
function bestClaim(
  c: ContractView,
  events: readonly LossEventTerms[],
): { paid: Micro; refusal: WaterfallErrorCode | null } {
  let paid = 0n
  let refusal: WaterfallErrorCode | null = null
  for (const event of events) {
    try {
      const amount = settleContract(terms(c), event)
      if (amount > paid) paid = amount
    } catch (e) {
      if (!(e instanceof WaterfallError)) throw e
      refusal = e.code
    }
  }
  return { paid, refusal: paid > 0n ? null : refusal }
}

function eventTerms(e: LossEventView): LossEventTerms {
  return { index: e.index, modelTime: e.modelTime, lossBps: e.lossBps }
}

function trancheRows(wallet: WalletView, pool: PoolView, after: PoolBalances): PositionRow[] {
  const rows: PositionRow[] = []
  if (wallet.seniorShares > 0n) {
    rows.push({
      key: 'senior',
      label: `SENIOR ${formatAmount(wallet.seniorShares)} ${SENIOR_TOKEN}`,
      now: amountForShares(wallet.seniorShares, pool.senior.assets, pool.senior.supply),
      after: amountForShares(wallet.seniorShares, after.seniorAssets, after.seniorSupply),
    })
  }
  if (wallet.juniorShares > 0n) {
    rows.push({
      key: 'junior',
      label: `JUNIOR ${formatAmount(wallet.juniorShares)} ${JUNIOR_TOKEN}`,
      now: amountForShares(wallet.juniorShares, pool.junior.assets, pool.junior.supply),
      after: amountForShares(wallet.juniorShares, after.juniorAssets, after.juniorSupply),
    })
  }
  return rows
}

function contractRow(
  c: ContractView,
  recorded: readonly LossEventTerms[],
  withLoss: readonly LossEventTerms[],
): PositionRow {
  // The hypothetical event is the last one tried, so a refusal here is its own.
  const claim = bestClaim(c, withLoss)
  const note = claim.refusal ? NOTES[claim.refusal] : undefined
  return {
    key: `contract:${c.nonce}`,
    label: `COVER #${c.nonce} · ${formatAmount(c.notional)} ${TOKEN} to day ${modelDay(c.expiryModelTime)}`,
    now: bestClaim(c, recorded).paid,
    after: claim.paid,
    ...(note ? { note } : {}),
  }
}

function sellerRow(
  shares: Micro,
  protection: ProtectionView,
  poolContracts: readonly ContractView[],
  withLoss: readonly LossEventTerms[],
): PositionRow {
  let settled = { collateral: protection.collateral, reserved: protection.reserved }
  for (const c of poolContracts) {
    if (c.status !== ContractStatus.Active) continue
    const { paid } = bestClaim(c, withLoss)
    if (paid > 0n) settled = afterSettle(settled, c.notional, paid)
  }
  return {
    key: 'seller',
    label: `COVER SOLD ${formatAmount(shares)} ${SHARES}`,
    now: amountForShares(shares, protection.collateral, protection.shareSupply),
    after: amountForShares(shares, settled.collateral, protection.shareSupply),
  }
}

export function positionForecast(input: PositionInput, lossBps: number): Forecast {
  const pool = accruedView(input.pool, input.nowUnix)
  const { wallet, protection } = input
  const balances = poolBalances(pool)
  const loss = lossAmount(balances.assets, lossBps)
  const after = afterLoss(balances, applyLoss(loss, balances.seniorAssets, balances.juniorAssets))
  const recorded = pool.lossEvents.map(eventTerms)
  const hypothetical: LossEventTerms = { index: pool.lossCount, modelTime: pool.modelTime, lossBps }
  const withLoss = [...recorded, hypothetical]

  const rows = trancheRows(wallet, pool, after)
  for (const c of wallet.contracts) {
    if (c.status === ContractStatus.Active) rows.push(contractRow(c, recorded, withLoss))
  }
  if (protection && wallet.sellerShares > 0n) {
    rows.push(sellerRow(wallet.sellerShares, protection, input.poolContracts, withLoss))
  }
  return {
    rows,
    now: rows.reduce((s, r) => s + r.now, 0n),
    after: rows.reduce((s, r) => s + r.after, 0n),
  }
}
