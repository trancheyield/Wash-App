// `pnpm demo:init` — Config + demo mint + treasury, pool 0 (or `WASH_POOL_ID`) and its
// protection market on devnet. Idempotent: what is already on the chain is skipped, so a
// rerun only prints the addresses. Run: `node --env-file=../../.env src/init.ts`.

import {
  buildCreatePool,
  buildInitConfig,
  buildInitProtection,
  configAddress,
  fetchMaybeConfig,
  mintAddress,
  poolAccounts,
  protectionAccounts,
  readPool,
  readProtection,
  treasuryAddress,
  WASHAPP_PROGRAM_ADDRESS,
} from '@washapp/chain'
import { demoEnvSchema } from './env.ts'
import { loadKeypair } from './keys.ts'
import { loadDemoParams, poolParamsView, withPoolId } from './params.ts'
import { createDemoRpc, sendInstructions } from './rpc.ts'

const env = demoEnvSchema.parse(process.env)
if (env.WASH_PROGRAM_ID !== WASHAPP_PROGRAM_ADDRESS) {
  throw new Error(
    `WASH_PROGRAM_ID ${env.WASH_PROGRAM_ID} ≠ клієнт ${WASHAPP_PROGRAM_ADDRESS} — перегенерувати codama`,
  )
}

const params = withPoolId(loadDemoParams(), process.env.WASH_POOL_ID)
const client = createDemoRpc(env.SOLANA_RPC_URL)
const operator = await loadKeypair(env.WASH_KEYS_DIR, 'operator')

const [config, mint, treasury] = await Promise.all([
  configAddress(),
  mintAddress(),
  treasuryAddress(),
])
console.log(`програма:  ${WASHAPP_PROGRAM_ADDRESS}`)
console.log(`оператор:  ${operator.address}`)
console.log(`config:    ${config}`)
console.log(`mint:      ${mint}`)
console.log(`treasury:  ${treasury}`)

const existing = await fetchMaybeConfig(client.rpc, config)
if (existing.exists) {
  if (existing.data.authority !== operator.address) {
    throw new Error(
      `Config належить ${existing.data.authority}, а не оператору ${operator.address}`,
    )
  }
  console.log(`init_config: уже є (faucet_cap ${existing.data.faucetCap})`)
} else {
  const ix = await buildInitConfig({ authority: operator, faucetCap: params.faucet_cap })
  const signature = await sendInstructions(client, operator, [ix])
  console.log(`init_config: ${signature}`)
}

const accounts = await poolAccounts(params.pool_id)
console.log(`pool ${params.pool_id}:    ${accounts.pool}`)
console.log(`vault:     ${accounts.vault}`)
console.log(`sWUSD:     ${accounts.seniorMint}`)
console.log(`jWUSD:     ${accounts.juniorMint}`)

const pool = await readPool(client.rpc, params.pool_id)
if (pool) {
  console.log(`create_pool: уже є (model_time ${pool.modelTime} с, assets ${pool.assets})`)
} else {
  const ix = await buildCreatePool({
    operator,
    id: params.pool_id,
    params: poolParamsView(params),
  })
  const signature = await sendInstructions(client, operator, [ix])
  console.log(`create_pool: ${signature}`)
}

// The protection market comes after the pool: `init_protection` needs the pool and its
// operator. Parameters are the demo ones from `fixtures/params.json`.
const market = await protectionAccounts(params.pool_id)
console.log(`protection: ${market.protection}`)
console.log(`pvault:    ${market.pvault}`)
const existingMarket = await readProtection(client.rpc, market.pool)
if (existingMarket) {
  console.log(
    `init_protection: already there (collateral ${existingMarket.collateral}, reserved ${existingMarket.reserved}, contracts ${existingMarket.contracts})`,
  )
} else {
  const ix = await buildInitProtection({
    operator,
    poolId: params.pool_id,
    premiumRateBps: params.protection.premium_rate_bps,
    triggerBps: params.protection.trigger_bps,
    premiumFeeBps: params.protection.premium_fee_bps,
  })
  const signature = await sendInstructions(client, operator, [ix])
  console.log(`init_protection: ${signature}`)
}
