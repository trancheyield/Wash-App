import { type Address, address } from '@solana/kit'
import type { PoolView, WalletView } from '@washapp/chain'
import { describe, expect, it } from 'vitest'
import { panelFormSchema, preview } from './preview.ts'

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
}

const wallet: WalletView = {
  owner: ADDR,
  base: 30_000_000_000n,
  seniorShares: 10_000_000_000n,
  juniorShares: 5_000_000_000n,
  seniorValue: 0n,
  juniorValue: 0n,
}

function ok(p: ReturnType<typeof preview>) {
  if (p.kind !== 'ok') throw new Error(`refused: ${p.reason}`)
  return p
}

function refusedReason(p: ReturnType<typeof preview>) {
  if (p.kind !== 'refused') throw new Error('expected a refusal')
  return p.reason
}

describe('preview · deposit', () => {
  it('senior 2,500 gives the brief figures: 2,489.77 sWUSD, floor 24.52 %', () => {
    const p = ok(
      preview({ pool, mode: 'deposit', tranche: 'senior', value: 2_500_000_000n, wallet }),
    )
    expect(p.receive).toBe(2_489_768_076n)
    expect(p.navNow).toBe(1_004_109n)
    expect(p.juniorFloorAfter).toBe(2_452n)
    expect(p.after.senior.assets).toBe(77_808_219_178n)
    expect(p.after.senior.supply).toBe(77_489_768_076n)
    expect(p.after.assets).toBe(p.after.senior.assets + p.after.junior.assets)
  })

  it('junior 2,500 gives 2,471.96 jWUSD and floor 26.95 %', () => {
    const p = ok(
      preview({ pool, mode: 'deposit', tranche: 'junior', value: 2_500_000_000n, wallet }),
    )
    expect(p.receive).toBe(2_471_961_857n)
    expect(p.juniorFloorAfter).toBe(2_695n)
  })

  it('senior 25,000 is allowed, 26,000 breaches the junior floor before signing', () => {
    const rich = { ...wallet, base: 100_000_000_000n }
    ok(preview({ pool, mode: 'deposit', tranche: 'senior', value: 25_000_000_000n, wallet: rich }))
    const reason = refusedReason(
      preview({ pool, mode: 'deposit', tranche: 'senior', value: 26_000_000_000n, wallet: rich }),
    )
    expect(reason).toContain('19.97 %')
    expect(reason).toContain('refused before signing')
  })

  it('junior deposits never trip the floor', () => {
    const rich = { ...wallet, base: 10n ** 15n }
    ok(preview({ pool, mode: 'deposit', tranche: 'junior', value: 10n ** 15n, wallet: rich }))
  })

  it('refuses more than the wallet holds, and computes without a wallet', () => {
    const reason = refusedReason(
      preview({ pool, mode: 'deposit', tranche: 'senior', value: 30_000_000_001n, wallet }),
    )
    expect(reason).toContain('Not enough WUSD')
    ok(preview({ pool, mode: 'deposit', tranche: 'junior', value: 30_000_000_001n, wallet: null }))
  })

  it('tells the first depositor of an empty pool to start with junior', () => {
    const empty = {
      ...pool,
      assets: 0n,
      senior: { ...pool.senior, assets: 0n, supply: 0n, nav: 1_000_000n },
      junior: { ...pool.junior, assets: 0n, supply: 0n, nav: 1_000_000n },
    }
    expect(
      refusedReason(
        preview({ pool: empty, mode: 'deposit', tranche: 'senior', value: 1_000_000_000n, wallet }),
      ),
    ).toContain('deposit into junior first')
    const p = ok(
      preview({ pool: empty, mode: 'deposit', tranche: 'junior', value: 1_000_000_000n, wallet }),
    )
    expect(p.receive).toBe(1_000_000_000n)
    expect(p.juniorFloorAfter).toBe(10_000n)
  })

  it('refuses a deposit that rounds down to zero shares', () => {
    expect(
      refusedReason(preview({ pool, mode: 'deposit', tranche: 'junior', value: 1n, wallet })),
    ).toContain('rounds down to zero')
  })

  it('refuses a wiped-out tranche by the program error name', () => {
    const wiped = { ...pool, junior: { ...pool.junior, assets: 0n } }
    expect(
      refusedReason(
        preview({ pool: wiped, mode: 'deposit', tranche: 'junior', value: 1_000_000n, wallet }),
      ),
    ).toContain('no assets left')
  })
})

describe('preview · redeem', () => {
  it('senior 10,000 shares return their value at NAV and leave the rest in the wallet', () => {
    const p = ok(
      preview({ pool, mode: 'redeem', tranche: 'senior', value: 10_000_000_000n, wallet }),
    )
    expect(p.receive).toBe(10_041_095_890n)
    expect(p.remainingShares).toBe(0n)
    expect(p.after.senior.supply).toBe(65_000_000_000n)
    expect(p.after.senior.assets).toBe(65_267_123_288n)
    expect(p.after.assets).toBe(p.after.senior.assets + p.after.junior.assets)
  })

  it('junior redemption that breaches the floor is refused, senior redemption is not', () => {
    const whale = { ...wallet, seniorShares: 75_000_000_000n, juniorShares: 25_000_000_000n }
    // 6 000 jWUSD → junior ≈ 19 216 / 94 524 = 20.33 % — ще можна; 7 000 → 18.5 % — ні.
    ok(preview({ pool, mode: 'redeem', tranche: 'junior', value: 6_000_000_000n, wallet: whale }))
    const reason = refusedReason(
      preview({ pool, mode: 'redeem', tranche: 'junior', value: 7_000_000_000n, wallet: whale }),
    )
    expect(reason).toContain('junior floor')
    ok(preview({ pool, mode: 'redeem', tranche: 'senior', value: 75_000_000_000n, wallet: whale }))
  })

  it('refuses more shares than the wallet holds', () => {
    expect(
      refusedReason(
        preview({ pool, mode: 'redeem', tranche: 'junior', value: 5_000_000_001n, wallet }),
      ),
    ).toContain('Not enough jWUSD')
  })

  it('refuses shares beyond the supply without a wallet', () => {
    expect(
      refusedReason(
        preview({ pool, mode: 'redeem', tranche: 'junior', value: 25_000_000_001n, wallet: null }),
      ),
    ).toContain('exceeds the tranche supply')
  })

  it('refuses zero', () => {
    expect(
      refusedReason(preview({ pool, mode: 'redeem', tranche: 'junior', value: 0n, wallet })),
    ).toContain('greater than zero')
  })
})

describe('panelFormSchema', () => {
  it('parses the tranche and a grouped decimal amount into micro-units', () => {
    const parsed = panelFormSchema.parse({ tranche: 'senior', amount: '2,500.00' })
    expect(parsed).toEqual({ tranche: 'senior', amount: 2_500_000_000n })
  })

  it('refuses an empty field, seven decimals, a negative and a wrong tranche', () => {
    for (const bad of [
      { tranche: 'senior', amount: '' },
      { tranche: 'senior', amount: '1.0000001' },
      { tranche: 'senior', amount: '-5' },
      { tranche: 'mezzanine', amount: '5' },
      { tranche: 'junior', amount: '0' },
    ]) {
      expect(panelFormSchema.safeParse(bad).success).toBe(false)
    }
  })
})
