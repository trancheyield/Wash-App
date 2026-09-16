// `pnpm demo:scenario` — демо M1 з чистого гаманця на devnet без ручних кроків:
// свіжий ключ → 0,02 SOL від deployer → faucet → депозит junior і senior → 60 с
// (= 30 модельних днів) → `accrue` → `record_loss` оператором → звірка waterfall з
// подією на ланцюзі → погашення обох траншів → повернення SOL. Кожен крок міряється
// (SC-001), підсумок і таймінги — у `fixtures/demo-run.json` (SC-007 ≤ 3 хв).
// Запуск: `node --env-file=../../.env src/scenario.ts [--pool <id>] [--wait <s>]`.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { generateKeyPairSigner, type KeyPairSigner, type Signature } from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'
import {
  buildAccrue,
  buildDeposit,
  buildFaucet,
  buildRecordLoss,
  buildRedeem,
  type PoolView,
  readPool,
  readWallet,
  Tranche,
  WASHAPP_PROGRAM_ADDRESS,
} from '@washapp/chain'
import { formatAmount, type Micro } from '@washapp/shared'
import { demoEnvSchema } from './env.ts'
import { loadKeypair } from './keys.ts'
import {
  checkWaterfall,
  type DemoRun,
  SC001_LIMIT_MS,
  SC007_LIMIT_MS,
  type Step,
  sc001Max,
  timed,
  toJson,
  waitUntil,
} from './measure.ts'
import { loadDemoParams } from './params.ts'
import { createDemoRpc, type DemoRpc, sendInstructions } from './rpc.ts'

const MICRO = 1_000_000n
const FUND_LAMPORTS = 20_000_000n
const TX_FEE_LAMPORTS = 5_000n
const FAUCET_AMOUNT: Micro = 3_000n * MICRO
const JUNIOR_DEPOSIT: Micro = 1_000n * MICRO
const SENIOR_DEPOSIT: Micro = 2_000n * MICRO
const WAIT = { timeoutMs: 30_000, intervalMs: 250 }
const RUN_URL = new URL('../../../fixtures/demo-run.json', import.meta.url)

const { values: args } = parseArgs({
  options: {
    pool: { type: 'string' },
    wait: { type: 'string', default: '60' },
  },
})

const env = demoEnvSchema.parse(process.env)
if (env.WASH_PROGRAM_ID !== WASHAPP_PROGRAM_ADDRESS) {
  throw new Error(
    `WASH_PROGRAM_ID ${env.WASH_PROGRAM_ID} ≠ клієнт ${WASHAPP_PROGRAM_ADDRESS} — перегенерувати codama`,
  )
}
const params = loadDemoParams()
const poolId = args.pool === undefined ? params.pool_id : Number(args.pool)
const waitSeconds = Number(args.wait)
if (!Number.isInteger(poolId) || poolId < 0 || !Number.isFinite(waitSeconds) || waitSeconds < 0) {
  throw new Error(`--pool ${args.pool} / --wait ${args.wait}: цілий id пулу і секунди ≥ 0`)
}

const client = createDemoRpc(env.SOLANA_RPC_URL)
const [operator, deployer, user] = await Promise.all([
  loadKeypair(env.WASH_KEYS_DIR, 'operator'),
  loadKeypair(env.WASH_KEYS_DIR, 'devnet-deployer'),
  generateKeyPairSigner(),
])

const steps: Step[] = []
const t0 = performance.now()

function log(step: Step) {
  steps.push(step)
  const visible = step.visibleMs === null ? '' : ` · видно ${fmtMs(step.visibleMs)}`
  const sig = step.signature ? ` · ${step.signature.slice(0, 8)}…` : ''
  console.log(`${step.name.padEnd(16)} ${fmtMs(step.confirmedMs)}${visible}${sig}  ${step.note}`)
}

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} с`
}

async function pool(): Promise<PoolView> {
  const view = await readPool(client.rpc, poolId)
  if (!view) throw new Error(`пулу ${poolId} на цьому кластері немає — pnpm demo:init`)
  return view
}

// Крок із транзакцією: підпис → `confirmed` → перша відповідь RPC, де зміну видно.
async function step<T>(
  name: string,
  send: () => Promise<Signature>,
  read: () => Promise<T>,
  changed: (value: T) => boolean,
  note: (value: T) => string,
): Promise<T> {
  const start = performance.now()
  const { value: signature, ms: confirmedMs } = await timed(send)
  const value = await waitUntil(read, changed, WAIT)
  const visibleMs = performance.now() - start
  log({ name, signature, confirmedMs, visibleMs, note: note(value) })
  return value
}

async function refund(rpc: DemoRpc, from: KeyPairSigner, to: KeyPairSigner) {
  const { value: balance } = await rpc.rpc.getBalance(from.address).send()
  if (balance <= TX_FEE_LAMPORTS) return
  const ix = getTransferSolInstruction({
    source: from,
    destination: to.address,
    amount: balance - TX_FEE_LAMPORTS,
  })
  await sendInstructions(rpc, from, [ix])
  console.log(`повернено ${Number(balance - TX_FEE_LAMPORTS) / 1e9} SOL на deployer`)
}

console.log(`програма: ${WASHAPP_PROGRAM_ADDRESS}`)
console.log(`пул:      ${poolId}`)
console.log(`гаманець: ${user.address} (свіжий)`)
console.log(`оператор: ${operator.address}`)
console.log()

let funded = false
try {
  await step(
    'fund',
    () =>
      sendInstructions(client, deployer, [
        getTransferSolInstruction({
          source: deployer,
          destination: user.address,
          amount: FUND_LAMPORTS,
        }),
      ]),
    async () => (await client.rpc.getBalance(user.address).send()).value,
    (lamports) => lamports >= FUND_LAMPORTS,
    (lamports) => `${Number(lamports) / 1e9} SOL від deployer`,
  )
  funded = true

  const start = await pool()
  await step(
    'faucet',
    async () =>
      sendInstructions(client, user, [await buildFaucet({ owner: user, amount: FAUCET_AMOUNT })]),
    () => readWallet(client.rpc, start, user.address),
    (w) => w.base >= FAUCET_AMOUNT,
    (w) => `${formatAmount(w.base)} WUSD у гаманці`,
  )

  const afterJunior = await step(
    'deposit junior',
    async () =>
      sendInstructions(
        client,
        user,
        await buildDeposit({
          owner: user,
          poolId,
          tranche: Tranche.Junior,
          amount: JUNIOR_DEPOSIT,
        }),
      ),
    pool,
    (p) => p.junior.supply > start.junior.supply,
    (p) => `junior ${formatAmount(p.junior.assets)} WUSD, NAV ${formatAmount(p.junior.nav, 6)}`,
  )

  const afterSenior = await step(
    'deposit senior',
    async () =>
      sendInstructions(
        client,
        user,
        await buildDeposit({
          owner: user,
          poolId,
          tranche: Tranche.Senior,
          amount: SENIOR_DEPOSIT,
        }),
      ),
    pool,
    (p) => p.senior.supply > afterJunior.senior.supply,
    (p) => `senior ${formatAmount(p.senior.assets)} WUSD, NAV ${formatAmount(p.senior.nav, 6)}`,
  )

  // Хвилина ланцюга = 30 модельних днів: дохід стає видимим у NAV.
  const { ms: waitedMs } = await timed(
    () => new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000)),
  )
  log({
    name: 'wait',
    signature: null,
    confirmedMs: waitedMs,
    visibleMs: null,
    note: `${waitSeconds} с = ${(waitSeconds * params.time_scale) / 86_400} модельних днів`,
  })

  const afterAccrue = await step(
    'accrue',
    async () => sendInstructions(client, user, [await buildAccrue({ poolId })]),
    pool,
    (p) => p.lastAccruedTs > afterSenior.lastAccruedTs,
    (p) =>
      `NAV senior ${formatAmount(afterSenior.senior.nav, 6)} → ${formatAmount(p.senior.nav, 6)}, junior ${formatAmount(afterSenior.junior.nav, 6)} → ${formatAmount(p.junior.nav, 6)}`,
  )

  const afterLoss = await step(
    'record_loss',
    async () =>
      sendInstructions(client, operator, [
        await buildRecordLoss({
          operator,
          poolId,
          lossBps: params.demo_loss_bps,
          index: afterAccrue.lossCount,
        }),
      ]),
    pool,
    (p) => p.lossCount > afterAccrue.lossCount,
    (p) => {
      const e = p.lossEvents.at(-1)
      return e
        ? `подія #${e.index}: −${formatAmount(e.amount)} WUSD, junior −${formatAmount(e.juniorLoss)}, senior −${formatAmount(e.seniorLoss)}`
        : 'подію не прочитано'
    },
  )
  const event = afterLoss.lossEvents.find((e) => e.index === afterAccrue.lossCount)
  if (!event) throw new Error(`подія #${afterAccrue.lossCount} не з'явилась у readPool`)
  const waterfall = checkWaterfall(afterAccrue, afterLoss, event)
  console.log(
    `waterfall        senior ${formatAmount(waterfall.seniorBefore)} → ${formatAmount(waterfall.seniorAfter)} (${waterfall.seniorUnchanged ? 'без змін' : `−${formatAmount(waterfall.seniorLoss)}`}), junior ${formatAmount(waterfall.juniorBefore)} → ${formatAmount(waterfall.juniorAfter)}`,
  )
  if (waterfall.mismatches.length > 0) {
    throw new Error(`waterfall розійшовся з подією: ${waterfall.mismatches.join('; ')}`)
  }

  const wallet = await readWallet(client.rpc, afterLoss, user.address)
  const afterRedeemSenior = await step(
    'redeem senior',
    async () =>
      sendInstructions(
        client,
        user,
        await buildRedeem({
          owner: user,
          poolId,
          tranche: Tranche.Senior,
          shares: wallet.seniorShares,
        }),
      ),
    pool,
    (p) => p.senior.supply < afterLoss.senior.supply,
    (p) =>
      `${formatAmount(wallet.seniorShares)} sWUSD → ${formatAmount(wallet.seniorValue)} WUSD; senior лишилось ${formatAmount(p.senior.assets)}`,
  )
  const afterRedeemJunior = await step(
    'redeem junior',
    async () =>
      sendInstructions(
        client,
        user,
        await buildRedeem({
          owner: user,
          poolId,
          tranche: Tranche.Junior,
          shares: wallet.juniorShares,
        }),
      ),
    pool,
    (p) => p.junior.supply < afterRedeemSenior.junior.supply,
    (p) =>
      `${formatAmount(wallet.juniorShares)} jWUSD → ${formatAmount(wallet.juniorValue)} WUSD; junior лишилось ${formatAmount(p.junior.assets)}`,
  )

  const final = await readWallet(client.rpc, afterRedeemJunior, user.address)
  const totalMs = performance.now() - t0
  const run: DemoRun = {
    comment:
      'Таймінги демо-сценарію M1 на devnet (tools/demo scenario): підпис → confirmed → зміна Pool в RPC на кожному кроці (SC-001 ≤ 10 с), waterfall збитку звірено з подією на ланцюзі (SC-003), загальний час (SC-007 ≤ 180 с). Суми — мікро-одиниці рядками.',
    ranAt: new Date().toISOString(),
    programId: WASHAPP_PROGRAM_ADDRESS,
    poolId,
    wallet: user.address,
    steps,
    waterfall,
    nav: {
      seniorBefore: afterSenior.senior.nav,
      seniorAfterAccrue: afterAccrue.senior.nav,
      juniorBefore: afterSenior.junior.nav,
      juniorAfterAccrue: afterAccrue.junior.nav,
    },
    totalMs,
    sc001MaxMs: sc001Max(steps),
  }
  writeFileSync(RUN_URL, toJson(run))

  console.log()
  console.log(
    `гаманець у кінці: ${formatAmount(final.base)} WUSD (внесено ${formatAmount(JUNIOR_DEPOSIT + SENIOR_DEPOSIT)})`,
  )
  console.log(`SC-001: найдовший крок ${fmtMs(run.sc001MaxMs)} (ліміт ${fmtMs(SC001_LIMIT_MS)})`)
  console.log(`SC-007: увесь сценарій ${fmtMs(totalMs)} (ліміт ${fmtMs(SC007_LIMIT_MS)})`)
  console.log(`записано ${fileURLToPath(RUN_URL)}`)
  if (run.sc001MaxMs > SC001_LIMIT_MS || totalMs > SC007_LIMIT_MS) {
    process.exitCode = 1
    console.error('ліміт SC перевищено')
  }
} finally {
  // Одноразовий ключ не зберігається — SOL повертається завжди, і після падіння.
  if (funded) await refund(client, user, deployer)
}
