import { type Address, address } from '@solana/kit'
import type { PoolView } from '@washapp/chain'
import { describe, expect, it } from 'vitest'
import { lossFormSchema, lossPreview, parseLossBps } from './loss-form.ts'

// Пул брифу M0 після 30 модельних днів — золоті числа, звірені у SVM (`read.test.ts`).
const ADDR = address('11111111111111111111111111111111') as Address
const pool: PoolView = {
  address: ADDR,
  id: 0,
  operator: ADDR,
  mint: ADDR,
  vault: ADDR,
  params: {
    yieldRateBps: 800,
    seniorRateBps: 500,
    minJuniorBps: 2000,
    perfFeeBps: 1000,
    timeScale: 43_200,
  },
  assets: 100_591_780_822n,
  senior: { mint: ADDR, assets: 75_308_219_178n, supply: 75_000_000_000n, nav: 1_004_109n },
  junior: { mint: ADDR, assets: 25_283_561_644n, supply: 25_000_000_000n, nav: 1_011_342n },
  modelTime: 30n * 86_400n,
  lastAccruedTs: 0n,
  createdAt: 0n,
  lossCount: 0,
  lossEvents: [],
}

describe('parseLossBps', () => {
  it('reads whole and fractional percents into basis points', () => {
    expect(parseLossBps('15')).toBe(1500)
    expect(parseLossBps('15.00')).toBe(1500)
    expect(parseLossBps('0.25 %')).toBe(25)
    expect(parseLossBps('100')).toBe(10_000)
    expect(parseLossBps('0')).toBe(0)
  })

  it('refuses more than 100 %, more than two decimals and junk', () => {
    expect(parseLossBps('100.01')).toBeNull()
    expect(parseLossBps('15.005')).toBeNull()
    expect(parseLossBps('')).toBeNull()
    expect(parseLossBps('-5')).toBeNull()
    expect(parseLossBps('1e2')).toBeNull()
  })

  it('is what the form schema uses', () => {
    expect(lossFormSchema.parse({ percent: '15.00' })).toEqual({ percent: 1500 })
    expect(lossFormSchema.safeParse({ percent: '101' }).success).toBe(false)
  })
})

describe('lossPreview', () => {
  it('matches loss event 0 of the brief: junior absorbs all of 15 %', () => {
    const p = lossPreview(pool, 1500)
    expect(p.kind).toBe('ok')
    if (p.kind !== 'ok') return
    expect(p.amount).toBe(15_088_767_123n)
    expect(p.juniorLoss).toBe(15_088_767_123n)
    expect(p.seniorLoss).toBe(0n)
    expect(p.after.senior.assets).toBe(75_308_219_178n)
    expect(p.after.junior.assets).toBe(10_194_794_521n)
    expect(p.after.assets).toBe(85_503_013_699n)
    // NAV junior після збитку — 0.407791, вниз.
    expect(p.after.junior.nav).toBe(407_791n)
  })

  it('reaches senior once junior is exhausted', () => {
    const p = lossPreview(pool, 3000)
    if (p.kind !== 'ok') throw new Error(p.reason)
    expect(p.juniorLoss).toBe(25_283_561_644n)
    expect(p.seniorLoss).toBe(30_177_534_246n - 25_283_561_644n)
    expect(p.after.junior.assets).toBe(0n)
    expect(p.after.senior.assets).toBe(70_414_246_576n)
  })

  it('refuses a zero loss like the program does', () => {
    expect(lossPreview(pool, 0)).toEqual({
      kind: 'refused',
      reason: '100,591.78 WUSD × 0 bps rounds to zero',
    })
    const empty: PoolView = {
      ...pool,
      assets: 0n,
      senior: { ...pool.senior, assets: 0n, supply: 0n },
      junior: { ...pool.junior, assets: 0n, supply: 0n },
    }
    expect(lossPreview(empty, 1500)).toEqual({
      kind: 'refused',
      reason: 'the pool holds nothing to lose',
    })
  })
})
