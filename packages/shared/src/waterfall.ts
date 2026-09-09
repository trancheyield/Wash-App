// Дзеркало `programs/washapp/src/math.rs`: нарахування, частки, waterfall збитку,
// субординація. Ті самі формули у `bigint` — добутки без переповнення, ділення вниз,
// залишок округлення доходу — junior. Обидві сторони проходять
// `fixtures/waterfall.json` (генерується з Rust); правити формулу — в обох.
import type { Micro } from './units.ts'

export const BPS = 10_000n
export const YEAR_SECONDS = 365n * 86_400n
const U64_MAX = 2n ** 64n - 1n

export type Tranche = 'senior' | 'junior'

export type PoolBalances = {
  assets: Micro
  seniorAssets: Micro
  juniorAssets: Micro
  seniorSupply: Micro
  juniorSupply: Micro
}

export type Rates = {
  yieldBps: number
  seniorBps: number
  feeBps: number
}

export type Accrual = {
  yieldAmount: Micro
  fee: Micro
  seniorGain: Micro
  juniorGain: Micro
}

export type LossSplit = {
  juniorLoss: Micro
  seniorLoss: Micro
}

// Імена збігаються з `WashError` — програма відмовляє тим самим кодом.
export type WaterfallErrorCode = 'TrancheWipedOut' | 'ParameterOutOfRange' | 'Overflow'

// Без параметра-властивості в конструкторі: Node зі strip-only типами його не терпить.
export class WaterfallError extends Error {
  readonly code: WaterfallErrorCode
  constructor(code: WaterfallErrorCode) {
    super(code)
    this.name = 'WaterfallError'
    this.code = code
  }
}

function toU64(value: bigint): Micro {
  if (value < 0n || value > U64_MAX) throw new WaterfallError('Overflow')
  return value
}

// `amount × rate_bps × dt / (BPS × YEAR)` — річна ставка за модельний проміжок.
function proRata(amount: Micro, rateBps: number, dtModel: bigint): Micro {
  return toU64((amount * BigInt(rateBps) * dtModel) / (BPS * YEAR_SECONDS))
}

function mulBps(amount: Micro, bps: number): Micro {
  return toU64((amount * BigInt(bps)) / BPS)
}

function mulDiv(a: Micro, b: Micro, d: Micro): Micro {
  return toU64((a * b) / d)
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b
}

// Дохід за `dtModel` модельних секунд: комісія — з доходу, senior — не більше
// своєї ставки від своїх активів, решта — junior. Порожній транш доходу не
// отримує; порожній пул доходу не дає.
export function accrue(pool: PoolBalances, rates: Rates, dtModel: bigint): Accrual {
  if (pool.seniorSupply === 0n && pool.juniorSupply === 0n) {
    return { yieldAmount: 0n, fee: 0n, seniorGain: 0n, juniorGain: 0n }
  }
  const yieldAmount = proRata(pool.assets, rates.yieldBps, dtModel)
  const fee = mulBps(yieldAmount, rates.feeBps)
  const net = yieldAmount - fee
  let seniorGain: Micro
  if (pool.juniorSupply === 0n) seniorGain = net
  else if (pool.seniorSupply === 0n) seniorGain = 0n
  else seniorGain = min(proRata(pool.seniorAssets, rates.seniorBps, dtModel), net)
  return { yieldAmount, fee, seniorGain, juniorGain: net - seniorGain }
}

export function sharesForDeposit(amount: Micro, trancheAssets: Micro, supply: Micro): Micro {
  if (supply === 0n) return amount
  if (trancheAssets === 0n) throw new WaterfallError('TrancheWipedOut')
  return mulDiv(amount, supply, trancheAssets)
}

export function amountForRedeem(shares: Micro, trancheAssets: Micro, supply: Micro): Micro {
  if (shares > supply) throw new WaterfallError('ParameterOutOfRange')
  if (supply === 0n) return 0n
  if (trancheAssets === 0n) throw new WaterfallError('TrancheWipedOut')
  return mulDiv(shares, trancheAssets, supply)
}

export function lossAmount(assets: Micro, lossBps: number): Micro {
  return mulBps(assets, lossBps)
}

// Збиток спочатку з junior, лише надлишок — із senior (SC-003).
export function applyLoss(loss: Micro, seniorAssets: Micro, juniorAssets: Micro): LossSplit {
  const juniorLoss = min(loss, juniorAssets)
  const seniorLoss = loss - juniorLoss
  if (seniorLoss > seniorAssets) throw new WaterfallError('ParameterOutOfRange')
  return { juniorLoss, seniorLoss }
}

// Поріг включно: junior рівно на мінімумі — дозволено.
export function subordinationOk(seniorAfter: Micro, juniorAfter: Micro, minBps: number): boolean {
  return juniorAfter * BPS >= BigInt(minBps) * (seniorAfter + juniorAfter)
}

// Частка junior в активах, bps, для підпису «junior floor after»; порожній пул — 100 %.
// Рішення приймає `subordinationOk`, не ця величина: вона ділиться вниз і на межі
// показала б 19.99 % там, де програма ще дозволяє.
export function juniorShareBps(senior: Micro, junior: Micro): bigint {
  const total = senior + junior
  return total === 0n ? BPS : (junior * BPS) / total
}

export function trancheOf(pool: PoolBalances, tranche: Tranche): { assets: Micro; supply: Micro } {
  return tranche === 'senior'
    ? { assets: pool.seniorAssets, supply: pool.seniorSupply }
    : { assets: pool.juniorAssets, supply: pool.juniorSupply }
}

// Методи `after_*` з `math.rs`: усі три поля зсуваються з одних доданків, тож
// `assets == seniorAssets + juniorAssets` тримається за побудовою.
export function afterAccrual(pool: PoolBalances, accrual: Accrual): PoolBalances {
  const net = toU64(accrual.seniorGain + accrual.juniorGain)
  return {
    ...pool,
    assets: toU64(pool.assets + net),
    seniorAssets: toU64(pool.seniorAssets + accrual.seniorGain),
    juniorAssets: toU64(pool.juniorAssets + accrual.juniorGain),
  }
}

export function afterDeposit(
  pool: PoolBalances,
  tranche: Tranche,
  amount: Micro,
  shares: Micro,
): PoolBalances {
  const next = { ...pool, assets: toU64(pool.assets + amount) }
  if (tranche === 'senior') {
    next.seniorAssets = toU64(pool.seniorAssets + amount)
    next.seniorSupply = toU64(pool.seniorSupply + shares)
  } else {
    next.juniorAssets = toU64(pool.juniorAssets + amount)
    next.juniorSupply = toU64(pool.juniorSupply + shares)
  }
  return next
}

export function afterRedeem(
  pool: PoolBalances,
  tranche: Tranche,
  shares: Micro,
  amount: Micro,
): PoolBalances {
  const next = { ...pool, assets: toU64(pool.assets - amount) }
  if (tranche === 'senior') {
    next.seniorAssets = toU64(pool.seniorAssets - amount)
    next.seniorSupply = toU64(pool.seniorSupply - shares)
  } else {
    next.juniorAssets = toU64(pool.juniorAssets - amount)
    next.juniorSupply = toU64(pool.juniorSupply - shares)
  }
  return next
}

export function afterLoss(pool: PoolBalances, split: LossSplit): PoolBalances {
  const loss = toU64(split.seniorLoss + split.juniorLoss)
  return {
    ...pool,
    assets: toU64(pool.assets - loss),
    seniorAssets: toU64(pool.seniorAssets - split.seniorLoss),
    juniorAssets: toU64(pool.juniorAssets - split.juniorLoss),
  }
}
