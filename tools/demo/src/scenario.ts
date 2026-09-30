// `pnpm demo:scenario` — the M2 demo from fresh wallets on devnet with no manual steps:
// two fresh keys (a depositor who also buys protection, and a seller) → SOL from the
// deployer → catch-up `accrue` → faucet → junior and senior deposits → the seller funds
// the cover pool → the buyer takes a covered contract and a one-day one → 60 s (= 30 model
// days) → `accrue` → `record_loss` by the operator → the waterfall checked against the
// on-chain event → `settle` pays the buyer `notional × loss` → the one-day contract expires →
// both tranches redeemed → the seller withdraws → SOL back. Every step is timed (SC-001);
// the checks and timings go to `fixtures/demo-run.json` (SC-004, SC-007 ≤ 3 min).
// Run: `node --env-file=../../.env src/scenario.ts [--pool <id>] [--wait <s>]`.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { generateKeyPairSigner, type KeyPairSigner, type Signature } from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'
import {
  buildAccrue,
  buildBuy,
  buildDeposit,
  buildExpire,
  buildFaucet,
  buildProvide,
  buildRecordLoss,
  buildRedeem,
  buildSettle,
  buildWithdraw,
  ContractStatus,
  type ContractView,
  type PoolView,
  type ProtectionView,
  readPool,
  readProtection,
  readWallet,
  Tranche,
  WASHAPP_PROGRAM_ADDRESS,
  type WalletView,
} from '@washapp/chain'
import { formatAmount, type Micro } from '@washapp/shared'
import { demoEnvSchema } from './env.ts'
import { loadKeypair } from './keys.ts'
import {
  allMismatches,
  checkExpire,
  checkPurchase,
  checkSeller,
  checkSettle,
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
const DAY = 86_400n
// Rent of three token accounts and two contracts, plus fees, with room to spare.
const FUND_LAMPORTS = 20_000_000n
const TX_FEE_LAMPORTS = 5_000n
const JUNIOR_DEPOSIT: Micro = 1_000n * MICRO
const SENIOR_DEPOSIT: Micro = 2_000n * MICRO
// Deposits plus both premiums (≈ 4.96 WUSD at 2 % a year).
const BUYER_FAUCET: Micro = 3_100n * MICRO
const SELLER_COLLATERAL: Micro = 2_000n * MICRO
// Covers the loss: 90 model days outlast the 30-day wait and the few days of steps around it.
const COVER = { notional: 1_000n * MICRO, term: 90n * DAY }
// Two chain seconds at the demo time scale — over long before the loss, so it can only expire.
const SHORT = { notional: 500n * MICRO, term: DAY }
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
    `WASH_PROGRAM_ID ${env.WASH_PROGRAM_ID} ≠ client ${WASHAPP_PROGRAM_ADDRESS} — rerun codama`,
  )
}
const params = loadDemoParams()
const poolId = args.pool === undefined ? params.pool_id : Number(args.pool)
const waitSeconds = Number(args.wait)
if (!Number.isInteger(poolId) || poolId < 0 || !Number.isFinite(waitSeconds) || waitSeconds < 0) {
  throw new Error(`--pool ${args.pool} / --wait ${args.wait}: an integer pool id and seconds ≥ 0`)
}

const client = createDemoRpc(env.SOLANA_RPC_URL)
const [operator, deployer, buyer, seller] = await Promise.all([
  loadKeypair(env.WASH_KEYS_DIR, 'operator'),
  loadKeypair(env.WASH_KEYS_DIR, 'devnet-deployer'),
  generateKeyPairSigner(),
  generateKeyPairSigner(),
])

const steps: Step[] = []
const t0 = performance.now()

function log(step: Step) {
  steps.push(step)
  const visible = step.visibleMs === null ? '' : ` · visible ${fmtMs(step.visibleMs)}`
  const sig = step.signature ? ` · ${step.signature.slice(0, 8)}…` : ''
  console.log(`${step.name.padEnd(16)} ${fmtMs(step.confirmedMs)}${visible}${sig}  ${step.note}`)
}

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

async function pool(): Promise<PoolView> {
  const view = await readPool(client.rpc, poolId)
  if (!view) throw new Error(`pool ${poolId} does not exist on this cluster — pnpm demo:init`)
  return view
}

async function market(poolView: PoolView): Promise<ProtectionView> {
  const view = await readProtection(client.rpc, poolView.address)
  if (!view) throw new Error(`pool ${poolId} has no protection market — pnpm demo:init`)
  return view
}

type Desk = { wallet: WalletView; market: ProtectionView }

// The buyer's wallet (base balance and contracts) and the market, read together so a
// check compares the two sides of the same transaction.
async function desk(poolView: PoolView, owner: KeyPairSigner): Promise<Desk> {
  const [wallet, m] = await Promise.all([
    readWallet(client.rpc, poolView, owner.address),
    market(poolView),
  ])
  return { wallet, market: m }
}

function modelDays(term: bigint): string {
  const days = term / DAY
  return `${days} model day${days === 1n ? '' : 's'}`
}

function contract(d: Desk, nonce: bigint): ContractView | undefined {
  return d.wallet.contracts.find((c) => c.nonce === nonce)
}

function mustContract(d: Desk, nonce: bigint): ContractView {
  const found = contract(d, nonce)
  if (!found) throw new Error(`contract #${nonce} did not show up in readWallet`)
  return found
}

// A step with a transaction: signature → `confirmed` → the first RPC answer with the change.
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
  console.log(`returned ${Number(balance - TX_FEE_LAMPORTS) / 1e9} SOL to the deployer`)
}

async function buyStep(name: string, poolView: PoolView, cover: typeof COVER, before: Desk) {
  const nonce = before.market.contracts
  const after = await step(
    name,
    async () =>
      sendInstructions(client, buyer, [
        await buildBuy({ buyer, poolId, notional: cover.notional, term: cover.term, nonce }),
      ]),
    () => desk(poolView, buyer),
    (d) => contract(d, nonce) !== undefined && d.market.contracts > nonce,
    (d) =>
      `#${nonce}: ${formatAmount(cover.notional)} WUSD for ${modelDays(cover.term)}, premium ${formatAmount(mustContract(d, nonce).premium)}`,
  )
  const check = checkPurchase(
    mustContract(after, nonce),
    cover.term,
    before.wallet.base,
    after.wallet.base,
    before.market,
    after.market,
  )
  return { after, check }
}

console.log(`program:  ${WASHAPP_PROGRAM_ADDRESS}`)
console.log(`pool:     ${poolId}`)
console.log(`buyer:    ${buyer.address} (fresh, also the depositor)`)
console.log(`seller:   ${seller.address} (fresh)`)
console.log(`operator: ${operator.address}`)
console.log()

let funded = false
try {
  await step(
    'fund',
    () =>
      sendInstructions(
        client,
        deployer,
        [buyer, seller].map((to) =>
          getTransferSolInstruction({
            source: deployer,
            destination: to.address,
            amount: FUND_LAMPORTS,
          }),
        ),
      ),
    () =>
      Promise.all(
        [buyer, seller].map(async (k) => (await client.rpc.getBalance(k.address).send()).value),
      ),
    (balances) => balances.every((lamports) => lamports >= FUND_LAMPORTS),
    () => `${Number(FUND_LAMPORTS) / 1e9} SOL each from the deployer`,
  )
  funded = true

  // An idle pool gains `time_scale` model seconds of yield per chain second; this accrual
  // is separate so the deposit step is not the one carrying hours of catch-up.
  const idle = await pool()
  const start = await step(
    'catch-up accrue',
    async () => sendInstructions(client, buyer, [await buildAccrue({ poolId })]),
    pool,
    (p) => p.lastAccruedTs > idle.lastAccruedTs,
    (p) =>
      `idle ${(Number(p.lastAccruedTs - idle.lastAccruedTs) / 3600).toFixed(1)} h: ${formatAmount(idle.assets)} → ${formatAmount(p.assets)} WUSD`,
  )
  const catchUp = {
    idleSeconds: Number(start.lastAccruedTs - idle.lastAccruedTs),
    assetsBefore: idle.assets,
    assetsAfter: start.assets,
  }

  for (const [name, owner, amount] of [
    ['faucet buyer', buyer, BUYER_FAUCET],
    ['faucet seller', seller, SELLER_COLLATERAL],
  ] as const) {
    await step(
      name,
      async () => sendInstructions(client, owner, [await buildFaucet({ owner, amount })]),
      () => readWallet(client.rpc, start, owner.address),
      (w) => w.base >= amount,
      (w) => `${formatAmount(w.base)} WUSD in the wallet`,
    )
  }

  const afterJunior = await step(
    'deposit junior',
    async () =>
      sendInstructions(
        client,
        buyer,
        await buildDeposit({
          owner: buyer,
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
        buyer,
        await buildDeposit({
          owner: buyer,
          poolId,
          tranche: Tranche.Senior,
          amount: SENIOR_DEPOSIT,
        }),
      ),
    pool,
    (p) => p.senior.supply > afterJunior.senior.supply,
    (p) => `senior ${formatAmount(p.senior.assets)} WUSD, NAV ${formatAmount(p.senior.nav, 6)}`,
  )

  const emptyMarket = await market(afterSenior)
  // The seller's result is predictable only when nobody else shares the premiums and the payout.
  const soleSeller = emptyMarket.shareSupply === 0n && emptyMarket.collateral === 0n
  const afterProvide = await step(
    'provide',
    async () =>
      sendInstructions(client, seller, [
        await buildProvide({ owner: seller, poolId, amount: SELLER_COLLATERAL }),
      ]),
    () => market(afterSenior),
    (m) => m.collateral >= emptyMarket.collateral + SELLER_COLLATERAL,
    (m) =>
      `collateral ${formatAmount(emptyMarket.collateral)} → ${formatAmount(m.collateral)} WUSD, free ${formatAmount(m.free)}`,
  )

  const cover = await buyStep('buy cover', afterSenior, COVER, {
    wallet: await readWallet(client.rpc, afterSenior, buyer.address),
    market: afterProvide,
  })
  const short = await buyStep('buy short', afterSenior, SHORT, cover.after)
  const coverNonce = cover.check.nonce
  const shortNonce = short.check.nonce

  // A chain minute is 30 model days: yield shows up in NAV, and the short contract runs out.
  const { ms: waitedMs } = await timed(
    () => new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000)),
  )
  log({
    name: 'wait',
    signature: null,
    confirmedMs: waitedMs,
    visibleMs: null,
    note: `${waitSeconds} s = ${(waitSeconds * params.time_scale) / 86_400} model days`,
  })

  const afterAccrue = await step(
    'accrue',
    async () => sendInstructions(client, buyer, [await buildAccrue({ poolId })]),
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
        ? `event #${e.index}: −${formatAmount(e.amount)} WUSD, junior −${formatAmount(e.juniorLoss)}, senior −${formatAmount(e.seniorLoss)}`
        : 'event not read'
    },
  )
  const event = afterLoss.lossEvents.find((e) => e.index === afterAccrue.lossCount)
  if (!event) throw new Error(`event #${afterAccrue.lossCount} did not show up in readPool`)
  const waterfall = checkWaterfall(afterAccrue, afterLoss, event)
  console.log(
    `waterfall        senior ${formatAmount(waterfall.seniorBefore)} → ${formatAmount(waterfall.seniorAfter)} (${waterfall.seniorUnchanged ? 'unchanged' : `−${formatAmount(waterfall.seniorLoss)}`}), junior ${formatAmount(waterfall.juniorBefore)} → ${formatAmount(waterfall.juniorAfter)}`,
  )

  // Settle takes no signer; the buyer only pays the fee, the payout goes to the contract's buyer.
  const beforeSettle = await desk(afterLoss, buyer)
  const afterSettle = await step(
    'settle',
    async () =>
      sendInstructions(client, buyer, [
        await buildSettle({
          poolId,
          buyer: buyer.address,
          nonce: coverNonce,
          lossIndex: event.index,
        }),
      ]),
    () => desk(afterLoss, buyer),
    (d) => mustContract(d, coverNonce).status === ContractStatus.Settled,
    (d) =>
      `#${coverNonce} pays ${formatAmount(mustContract(d, coverNonce).payout)}: buyer ${formatAmount(beforeSettle.wallet.base)} → ${formatAmount(d.wallet.base)} WUSD`,
  )
  const settle = checkSettle(
    mustContract(afterSettle, coverNonce),
    event,
    beforeSettle.wallet.base,
    afterSettle.wallet.base,
    beforeSettle.market,
    afterSettle.market,
  )

  const afterExpire = await step(
    'expire',
    async () =>
      sendInstructions(client, buyer, [
        await buildExpire({ signer: buyer, poolId, buyer: buyer.address, nonce: shortNonce }),
      ]),
    () => desk(afterLoss, buyer),
    (d) => mustContract(d, shortNonce).status === ContractStatus.Expired,
    (d) =>
      `#${shortNonce} over: reserved ${formatAmount(afterSettle.market.reserved)} → ${formatAmount(d.market.reserved)}, collateral ${formatAmount(d.market.collateral)} kept`,
  )
  const expire = checkExpire(
    mustContract(afterExpire, shortNonce),
    afterSettle.market,
    afterExpire.market,
  )

  // Redemption accrues again, so the amount received is read from the wallet, not
  // estimated from the pool before the step.
  const wallet = afterExpire.wallet
  const redeemed = async () => {
    const [p, w] = await Promise.all([pool(), readWallet(client.rpc, afterLoss, buyer.address)])
    return { pool: p, base: w.base }
  }
  const afterRedeemSenior = await step(
    'redeem senior',
    async () =>
      sendInstructions(
        client,
        buyer,
        await buildRedeem({
          owner: buyer,
          poolId,
          tranche: Tranche.Senior,
          shares: wallet.seniorShares,
        }),
      ),
    redeemed,
    (r) => r.pool.senior.supply < afterLoss.senior.supply,
    (r) =>
      `${formatAmount(wallet.seniorShares)} sWUSD → ${formatAmount(r.base - wallet.base)} WUSD; senior left ${formatAmount(r.pool.senior.assets)}`,
  )
  const afterRedeemJunior = await step(
    'redeem junior',
    async () =>
      sendInstructions(
        client,
        buyer,
        await buildRedeem({
          owner: buyer,
          poolId,
          tranche: Tranche.Junior,
          shares: wallet.juniorShares,
        }),
      ),
    redeemed,
    (r) => r.pool.junior.supply < afterRedeemSenior.pool.junior.supply,
    (r) =>
      `${formatAmount(wallet.juniorShares)} jWUSD → ${formatAmount(r.base - afterRedeemSenior.base)} WUSD; junior left ${formatAmount(r.pool.junior.assets)}`,
  )

  const sellerBefore = await readWallet(client.rpc, afterRedeemJunior.pool, seller.address)
  const sellerAfter = await step(
    'withdraw',
    async () =>
      sendInstructions(
        client,
        seller,
        await buildWithdraw({ owner: seller, poolId, shares: sellerBefore.sellerShares }),
      ),
    () => readWallet(client.rpc, afterRedeemJunior.pool, seller.address),
    (w) => w.sellerShares === 0n,
    (w) =>
      `${formatAmount(sellerBefore.sellerShares)} shares → ${formatAmount(w.base - sellerBefore.base)} WUSD (provided ${formatAmount(SELLER_COLLATERAL)})`,
  )
  const sellerCheck = checkSeller(
    SELLER_COLLATERAL,
    sellerAfter.base - sellerBefore.base,
    [cover.check, short.check],
    settle.payout,
    soleSeller,
  )

  const final = await readWallet(client.rpc, afterRedeemJunior.pool, buyer.address)
  const totalMs = performance.now() - t0
  const run: DemoRun = {
    comment:
      'Timings of the M2 demo scenario on devnet (tools/demo scenario): signature → confirmed → change visible in RPC for every step (SC-001 ≤ 10 s); the loss waterfall checked against the on-chain event (SC-003); premiums, the payout of notional × loss (SC-004), the expiry and the seller result checked against the mirror; total time (SC-007 ≤ 180 s). Sums are micro-units as strings.',
    ranAt: new Date().toISOString(),
    programId: WASHAPP_PROGRAM_ADDRESS,
    poolId,
    wallet: buyer.address,
    seller: seller.address,
    steps,
    catchUp,
    waterfall,
    nav: {
      seniorBefore: afterSenior.senior.nav,
      seniorAfterAccrue: afterAccrue.senior.nav,
      juniorBefore: afterSenior.junior.nav,
      juniorAfterAccrue: afterAccrue.junior.nav,
    },
    protection: {
      covered: cover.check,
      expiring: short.check,
      settle,
      expire,
      seller: sellerCheck,
    },
    totalMs,
    sc001MaxMs: sc001Max(steps),
  }
  writeFileSync(RUN_URL, toJson(run))

  const failed = allMismatches(run)
  console.log()
  console.log(
    `buyer at the end:  ${formatAmount(final.base)} WUSD (faucet ${formatAmount(BUYER_FAUCET)}, payout ${formatAmount(settle.payout)})`,
  )
  console.log(
    `seller at the end: ${formatAmount(sellerAfter.base)} WUSD (provided ${formatAmount(SELLER_COLLATERAL)})`,
  )
  console.log(`SC-001: slowest step ${fmtMs(run.sc001MaxMs)} (limit ${fmtMs(SC001_LIMIT_MS)})`)
  console.log(
    `SC-004: payout ${formatAmount(settle.payout)} = ${formatAmount(COVER.notional)} × ${event.lossBps / 100} %`,
  )
  console.log(`SC-007: whole scenario ${fmtMs(totalMs)} (limit ${fmtMs(SC007_LIMIT_MS)})`)
  console.log(`written ${fileURLToPath(RUN_URL)}`)
  if (failed.length > 0) {
    process.exitCode = 1
    console.error('checks failed')
    for (const m of failed) console.error(`  ${m}`)
  }
  if (run.sc001MaxMs > SC001_LIMIT_MS || totalMs > SC007_LIMIT_MS) {
    process.exitCode = 1
    console.error('SC limit exceeded')
  }
} finally {
  // The one-off keys are not stored — SOL goes back always, after a failure too.
  if (funded) {
    await refund(client, buyer, deployer)
    await refund(client, seller, deployer)
  }
}
