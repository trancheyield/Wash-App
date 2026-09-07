import { describe, expect, it } from 'vitest'
import { demoParamsSchema, loadDemoParams, poolParamsView } from './params.ts'

describe('demo params', () => {
  it('loads fixtures/params.json — the same numbers the program tests use', () => {
    const params = loadDemoParams()
    expect(params.pool_id).toBe(0)
    expect(poolParamsView(params)).toEqual({
      yieldRateBps: 800,
      seniorRateBps: 500,
      minJuniorBps: 2000,
      perfFeeBps: 1000,
      timeScale: 43_200,
    })
    // 10 000 WUSD у мікро-одиницях, bigint — сума ніколи не Number.
    expect(params.faucet_cap).toBe(10_000_000_000n)
    expect(params.demo_loss_bps).toBe(1500)
  })

  it('rejects rates above 100 % and a zero time scale', () => {
    const base = loadDemoParams()
    const raw = { ...base, faucet_cap: 1 }
    expect(demoParamsSchema.safeParse({ ...raw, yield_rate_bps: 10_001 }).success).toBe(false)
    expect(demoParamsSchema.safeParse({ ...raw, time_scale: 0 }).success).toBe(false)
    expect(demoParamsSchema.safeParse({ ...raw, faucet_cap: 0 }).success).toBe(false)
  })
})
