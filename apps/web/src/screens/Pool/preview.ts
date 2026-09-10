// Попередній розрахунок депозиту/погашення — ті самі сторожі, що в `deposit_handler`
// і `redeem_handler`, у тому ж порядку, на стані пулу після нарахування (`accruedView`).
// Відмова тут — до підпису; програма лишається останнім суддею, бо між прев'ю і
// слотом транзакції минає кілька секунд модельного часу.
import { type PoolView, poolBalances, type WalletView, withBalances } from '@washapp/chain'
import {
  afterDeposit,
  afterRedeem,
  amountForRedeem,
  amountSchema,
  formatAmount,
  juniorShareBps,
  type Micro,
  type PoolBalances,
  sharesForDeposit,
  subordinationOk,
  type Tranche,
  trancheOf,
  WaterfallError,
} from '@washapp/shared'
import { z } from 'zod'
import { formatBps } from '../../format.ts'
import { JUNIOR_TOKEN, SENIOR_TOKEN, TOKEN } from '../../tokens.ts'

export type Mode = 'deposit' | 'redeem'

export const modeSchema = z.enum(['deposit', 'redeem'])
export const trancheSchema = z.enum(['senior', 'junior'])

// Поле — рядок як набрано (з групуванням і крапкою); `amountSchema` дає `bigint` > 0.
// Для депозиту це базовий токен, для погашення — частки траншу: обидва по 6 знаків.
export const panelFormSchema = z.object({ tranche: trancheSchema, amount: amountSchema })
export type PanelForm = z.infer<typeof panelFormSchema>

export function trancheToken(tranche: Tranche): string {
  return tranche === 'senior' ? SENIOR_TOKEN : JUNIOR_TOKEN
}

export type PreviewInput = {
  pool: PoolView
  mode: Mode
  tranche: Tranche
  // Депозит — сума базового токена; погашення — частки траншу.
  value: Micro
  wallet: WalletView | null
}

export type Preview =
  | {
      kind: 'ok'
      // Що вкладник віддає і що отримує, у своїх одиницях.
      give: Micro
      receive: Micro
      navNow: Micro
      after: PoolView
      juniorFloorAfter: bigint
      // Скільки часток траншу лишиться в гаманці після операції (для погашення).
      remainingShares: Micro | null
    }
  | { kind: 'refused'; reason: string }

function refused(reason: string): Preview {
  return { kind: 'refused', reason }
}

function nextBalances(input: PreviewInput): { give: Micro; receive: Micro; after: PoolBalances } {
  const balances = poolBalances(input.pool)
  const { assets, supply } = trancheOf(balances, input.tranche)
  if (input.mode === 'deposit') {
    const shares = sharesForDeposit(input.value, assets, supply)
    return {
      give: input.value,
      receive: shares,
      after: afterDeposit(balances, input.tranche, input.value, shares),
    }
  }
  const amount = amountForRedeem(input.value, assets, supply)
  return {
    give: input.value,
    receive: amount,
    after: afterRedeem(balances, input.tranche, input.value, amount),
  }
}

function floorReason(input: PreviewInput, after: PoolBalances): string {
  const floor = formatBps(juniorShareBps(after.seniorAssets, after.juniorAssets))
  const min = formatBps(input.pool.params.minJuniorBps)
  // Порожній пул: перший вкладник може зайти лише в junior — без підказки це виглядає
  // як зламана кнопка.
  if (after.juniorAssets === 0n && input.mode === 'deposit') {
    return `The junior tranche is empty: senior needs junior at ${min} of assets or more — deposit into junior first.`
  }
  // Останній junior не може вийти з-під senior — спершу виходить senior.
  if (after.juniorAssets === 0n) {
    return `Redeeming all ${formatAmount(input.value)} ${JUNIOR_TOKEN} would leave senior with no junior beneath it — senior holders redeem first.`
  }
  return input.mode === 'deposit'
    ? `Senior deposit of ${formatAmount(input.value)} ${TOKEN} would put the junior floor at ${floor}, below the ${min} minimum — refused before signing.`
    : `Redeeming ${formatAmount(input.value)} ${JUNIOR_TOKEN} would put the junior floor at ${floor}, below the ${min} minimum — refused before signing.`
}

function heldShares(wallet: WalletView, tranche: Tranche): Micro {
  return tranche === 'senior' ? wallet.seniorShares : wallet.juniorShares
}

// Баланс гаманця — перший сторож: без нього SPL-переказ/burn упав би вже в мережі.
function walletShortfall({ mode, tranche, value, wallet }: PreviewInput): string | null {
  if (!wallet) return null
  if (mode === 'deposit' && value > wallet.base) {
    return `Not enough ${TOKEN}: ${formatAmount(value)} asked, ${formatAmount(wallet.base)} in wallet.`
  }
  const held = heldShares(wallet, tranche)
  if (mode === 'redeem' && value > held) {
    return `Not enough ${trancheToken(tranche)}: ${formatAmount(value)} asked, ${formatAmount(held)} in wallet.`
  }
  return null
}

function waterfallReason(e: WaterfallError, { tranche, value }: PreviewInput): string {
  switch (e.code) {
    case 'TrancheWipedOut':
      return `The ${tranche} tranche has shares but no assets left — no deposits or redemptions until a new pool.`
    case 'ParameterOutOfRange':
      return `${formatAmount(value)} ${trancheToken(tranche)} exceeds the tranche supply.`
    default:
      return 'amount is too large'
  }
}

// Внесок на нуль часток був би подарунком старим держателям; частки на нуль
// токенів спалювалися б за ніщо — програма відмовляє на обох.
function zeroReason({ mode, tranche, value }: PreviewInput): string {
  return mode === 'deposit'
    ? `${formatAmount(value, 6)} ${TOKEN} rounds down to zero ${trancheToken(tranche)} — deposit more.`
    : `${formatAmount(value, 6)} ${trancheToken(tranche)} is worth less than one micro-unit of ${TOKEN}.`
}

// Субординацію перевіряють лише операції, що зменшують частку junior.
function breachesFloor({ pool, mode, tranche }: PreviewInput, after: PoolBalances): boolean {
  const guarded =
    (mode === 'deposit' && tranche === 'senior') || (mode === 'redeem' && tranche === 'junior')
  return (
    guarded && !subordinationOk(after.seniorAssets, after.juniorAssets, pool.params.minJuniorBps)
  )
}

export function preview(input: PreviewInput): Preview {
  const { pool, mode, tranche, value, wallet } = input
  if (value <= 0n) return refused('amount must be greater than zero')
  const shortfall = walletShortfall(input)
  if (shortfall) return refused(shortfall)

  let next: ReturnType<typeof nextBalances>
  try {
    next = nextBalances(input)
  } catch (e) {
    if (e instanceof WaterfallError) return refused(waterfallReason(e, input))
    throw e
  }
  if (next.receive === 0n) return refused(zeroReason(input))
  if (breachesFloor(input, next.after)) return refused(floorReason(input, next.after))

  return {
    kind: 'ok',
    give: next.give,
    receive: next.receive,
    navNow: tranche === 'senior' ? pool.senior.nav : pool.junior.nav,
    after: withBalances(pool, next.after),
    juniorFloorAfter: juniorShareBps(next.after.seniorAssets, next.after.juniorAssets),
    remainingShares: mode === 'redeem' && wallet ? heldShares(wallet, tranche) - value : null,
  }
}
