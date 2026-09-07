import { readFileSync } from 'node:fs'
import { z } from 'zod'

// `fixtures/params.json` — одне джерело демо-параметрів для `init`, брифу M0 і
// тестів програми (`demo_params()` у Rust читає той самий файл).
const bps = z.number().int().min(0).max(10_000)

export const demoParamsSchema = z.object({
  pool_id: z.number().int().min(0).max(65_535),
  yield_rate_bps: bps,
  senior_rate_bps: bps,
  min_junior_bps: bps,
  perf_fee_bps: bps,
  time_scale: z.number().int().min(1).max(1_000_000),
  protection: z.object({
    premium_rate_bps: bps,
    trigger_bps: bps,
    premium_fee_bps: bps,
  }),
  // Суми в JSON — цілі мікро-одиниці; Number їх уміщає (≤ 2⁵³), bigint — далі.
  faucet_cap: z.number().int().positive().transform(BigInt),
  demo_loss_bps: bps,
})

export type DemoParams = z.infer<typeof demoParamsSchema>

export const PARAMS_URL = new URL('../../../fixtures/params.json', import.meta.url)

export function loadDemoParams(url: URL = PARAMS_URL): DemoParams {
  return demoParamsSchema.parse(JSON.parse(readFileSync(url, 'utf8')))
}

export function poolParamsView(params: DemoParams) {
  return {
    yieldRateBps: params.yield_rate_bps,
    seniorRateBps: params.senior_rate_bps,
    minJuniorBps: params.min_junior_bps,
    perfFeeBps: params.perf_fee_bps,
    timeScale: params.time_scale,
  }
}
