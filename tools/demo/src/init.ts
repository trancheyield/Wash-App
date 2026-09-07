// `pnpm --filter @washapp/demo init` — Config + демо-мінт + treasury і пул 0 на
// devnet. Ідемпотентний: те, що вже є в мережі, пропускається, тож повторний
// запуск лише друкує адреси. Запуск: `node --env-file=../../.env src/init.ts`.

import {
  buildCreatePool,
  buildInitConfig,
  configAddress,
  fetchMaybeConfig,
  mintAddress,
  poolAccounts,
  readPool,
  treasuryAddress,
  WASHAPP_PROGRAM_ADDRESS,
} from '@washapp/chain'
import { demoEnvSchema } from './env.ts'
import { loadKeypair } from './keys.ts'
import { loadDemoParams, poolParamsView } from './params.ts'
import { createDemoRpc, sendInstructions } from './rpc.ts'

const env = demoEnvSchema.parse(process.env)
if (env.WASH_PROGRAM_ID !== WASHAPP_PROGRAM_ADDRESS) {
  throw new Error(
    `WASH_PROGRAM_ID ${env.WASH_PROGRAM_ID} ≠ клієнт ${WASHAPP_PROGRAM_ADDRESS} — перегенерувати codama`,
  )
}

const params = loadDemoParams()
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
