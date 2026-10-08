import { type Address, address } from '@solana/kit'
import {
  ContractStatus,
  type ContractView,
  type LossEventView,
  type ProtectionView,
} from '@washapp/chain'
import { describe, expect, it } from 'vitest'
import {
  type BuyPreview,
  buyFormSchema,
  buyRequested,
  contractState,
  maxWithdrawShares,
  premiumPreview,
  type SellPreview,
  sellPreview,
  settleable,
  termDaysSchema,
} from './cover.ts'

const ADDR = address('11111111111111111111111111111111') as Address
const DAY = 86_400n

// The protection market of the SVM fixture (`read-protection.test.ts`): 5,000 provided,
// three contracts bought for 30 model days, 1,000 of cover settled on a 15 % loss.
const market: ProtectionView = {
  address: ADDR,
  pool: ADDR,
  pvault: ADDR,
  params: { premiumRateBps: 200, triggerBps: 100, premiumFeeBps: 1_000 },
  collateral: 4_852_367_123n,
  reserved: 600_000_000n,
  free: 4_252_367_123n,
  shareSupply: 5_000_000_000n,
  shareValue: 970_473n,
  contracts: 3n,
}

const rich = { base: 30_000_000_000n, sellerShares: 5_000_000_000n }

function ok<T extends BuyPreview | SellPreview>(p: T): Extract<T, { kind: 'ok' }> {
  if (p.kind !== 'ok') throw new Error(`refused: ${p.reason}`)
  return p as Extract<T, { kind: 'ok' }>
}

function reason(p: BuyPreview | SellPreview): string {
  if (p.kind !== 'refused') throw new Error('expected a refusal')
  return p.reason
}

function buyForm(notional: string, termDays: string) {
  return buyFormSchema.parse({ notional, termDays })
}

describe('termDaysSchema', () => {
  it('takes whole model days from one to ten years', () => {
    expect(termDaysSchema.parse(' 30 ')).toBe(30n)
    expect(termDaysSchema.parse('3650')).toBe(3_650n)
    for (const bad of ['0', '3651', '1.5', '', '-3', 'ten']) {
      expect(termDaysSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('premiumPreview', () => {
  const modelTime = 45n * DAY

  it('1,000 for 30 model days gives the premium the program wrote in the fixture', () => {
    const p = ok(
      premiumPreview({
        protection: market,
        modelTime,
        form: buyForm('1,000', '30'),
        wallet: rich,
      }),
    )
    expect(p.premium).toBe(1_643_835n)
    expect(p.fee).toBe(164_383n)
    expect(p.net).toBe(1_479_452n)
    expect(p.term).toBe(30n * DAY)
    expect(p.expiryModelTime).toBe(75n * DAY)
    expect(p.after).toEqual({
      collateral: 4_852_367_123n + 1_479_452n,
      reserved: 1_600_000_000n,
    })
  })

  it('refuses cover beyond the free collateral, naming the reserve', () => {
    const r = reason(
      premiumPreview({
        protection: market,
        modelTime,
        form: buyForm('4,300', '30'),
        wallet: rich,
      }),
    )
    expect(r).toContain('Free collateral is 4,252.37 WUSD')
    expect(r).toContain('600.00 WUSD is reserved')
  })

  it('an empty market says sellers come first', () => {
    const empty = { ...market, collateral: 0n, reserved: 0n, free: 0n, shareSupply: 0n }
    const form = buyForm('1,000', '30')
    expect(reason(premiumPreview({ protection: empty, modelTime, form, wallet: rich }))).toBe(
      'No collateral in the market yet — sellers provide it before cover can be bought.',
    )
  })

  it('takes exactly the free collateral', () => {
    const form = { notional: market.free, termDays: 30n }
    expect(premiumPreview({ protection: market, modelTime, form, wallet: rich }).kind).toBe('ok')
  })

  it('refuses a premium that rounds to zero at a non-zero rate, as the program does', () => {
    const r = reason(
      premiumPreview({
        protection: market,
        modelTime,
        form: buyForm('0.001', '1'),
        wallet: rich,
      }),
    )
    expect(r).toContain('rounds down to zero')
    const free = { ...market, params: { ...market.params, premiumRateBps: 0 } }
    const p = ok(
      premiumPreview({ protection: free, modelTime, form: buyForm('0.001', '1'), wallet: rich }),
    )
    expect(p.premium).toBe(0n)
  })

  it('refuses when the wallet cannot pay the premium, and skips the check without a wallet', () => {
    const form = buyForm('1,000', '30')
    const poor = { base: 1_000_000n, sellerShares: 0n }
    expect(reason(premiumPreview({ protection: market, modelTime, form, wallet: poor }))).toBe(
      'Not enough WUSD for the premium: 1.643835 due, 1.00 in wallet.',
    )
    expect(premiumPreview({ protection: market, modelTime, form, wallet: null }).kind).toBe('ok')
  })
})

describe('sellPreview', () => {
  it('provide prices new shares at the collateral per share', () => {
    const p = ok(
      sellPreview({ protection: market, mode: 'provide', value: 1_000_000_000n, wallet: rich }),
    )
    expect(p.receive).toBe(1_030_424_919n)
    expect(p.after).toEqual({ collateral: 5_852_367_123n, reserved: 600_000_000n })
  })

  it('provide refuses more than the wallet holds and a deposit worth zero shares', () => {
    const poor = { base: 1_000_000n, sellerShares: 0n }
    expect(
      reason(sellPreview({ protection: market, mode: 'provide', value: 2_000_000n, wallet: poor })),
    ).toContain('Not enough WUSD')
    const dear = { ...market, collateral: 10_000_000_000n, free: 9_400_000_000n }
    expect(
      reason(sellPreview({ protection: dear, mode: 'provide', value: 1n, wallet: rich })),
    ).toBe('0.000001 WUSD rounds down to zero shares — provide more.')
  })

  it('refuses both directions once payouts took all the collateral', () => {
    const wiped = { ...market, collateral: 0n, reserved: 0n, free: 0n }
    for (const mode of ['provide', 'withdraw'] as const) {
      expect(
        reason(sellPreview({ protection: wiped, mode, value: 1_000_000n, wallet: rich })),
      ).toContain('Payouts took all the collateral')
    }
  })

  it('withdraw of all shares is refused while cover is reserved', () => {
    const r = reason(
      sellPreview({ protection: market, mode: 'withdraw', value: 5_000_000_000n, wallet: rich }),
    )
    expect(r).toContain('only 4,252.37 WUSD is free')
    expect(r).toContain('600.00 WUSD is reserved')
  })

  it('max withdrawable shares stay within the free collateral', () => {
    const max = maxWithdrawShares(market, rich.sellerShares)
    expect(max).toBe(4_381_745_048n)
    const p = ok(sellPreview({ protection: market, mode: 'withdraw', value: max, wallet: rich }))
    expect(p.receive).toBe(4_252_367_122n)
    expect(p.receive <= market.free).toBe(true)
    expect(maxWithdrawShares(market, 1_000_000n)).toBe(1_000_000n)
  })

  it('withdraw refuses more shares than held', () => {
    const seller = { base: 0n, sellerShares: 1_000_000n }
    expect(
      reason(
        sellPreview({ protection: market, mode: 'withdraw', value: 2_000_000n, wallet: seller }),
      ),
    ).toBe('Not enough shares: 2.00 asked, 1.00 held.')
  })
})

function contract(overrides: Partial<ContractView> = {}): ContractView {
  return {
    address: ADDR,
    buyer: ADDR,
    nonce: 1n,
    notional: 500_000_000n,
    premium: 821_917n,
    startModelTime: 30n * DAY,
    expiryModelTime: 60n * DAY,
    triggerBps: 100,
    lossIndexFrom: 1,
    status: ContractStatus.Active,
    settledLossIndex: 0,
    payout: 0n,
    ...overrides,
  }
}

function loss(index: number, lossBps: number, day: bigint): LossEventView {
  return {
    address: ADDR,
    index,
    ts: 0n,
    modelTime: day * DAY,
    lossBps,
    amount: 0n,
    juniorLoss: 0n,
    seniorLoss: 0n,
    assetsBefore: 0n,
    assetsAfter: 0n,
  }
}

describe('settleable', () => {
  const events = [
    loss(0, 3_000, 20n), // before the purchase
    loss(1, 50, 40n), // below the 1 % trigger
    loss(2, 1_500, 45n),
    loss(3, 2_500, 50n),
    loss(4, 5_000, 70n), // after the term
  ]

  it('offers the covered event with the largest payout', () => {
    const claim = settleable(contract(), events)
    expect(claim?.event.index).toBe(3)
    expect(claim?.payout).toBe(125_000_000n)
  })

  it('an event exactly at expiry and exactly at the trigger is covered', () => {
    const edge = [loss(1, 100, 60n)]
    expect(settleable(contract(), edge)?.payout).toBe(5_000_000n)
  })

  it('ties go to the earlier event', () => {
    const tie = [loss(2, 1_500, 45n), loss(3, 1_500, 50n)]
    expect(settleable(contract(), tie)?.event.index).toBe(2)
  })

  it('nothing to settle: no covered event, a payout rounding to zero, or a closed contract', () => {
    const uncovered = events.filter((e) => e.index !== 2 && e.index !== 3)
    expect(settleable(contract(), uncovered)).toBeNull()
    expect(settleable(contract({ notional: 6n }), [loss(2, 1_500, 45n)])).toBeNull()
    expect(settleable(contract({ status: ContractStatus.Settled }), events)).toBeNull()
    expect(settleable(contract({ status: ContractStatus.Expired }), events)).toBeNull()
  })
})

describe('contractState', () => {
  it('a running contract counts whole model days left, rounding up', () => {
    expect(contractState(contract(), [], 45n * DAY)).toEqual({ kind: 'covered', daysLeft: 15n })
    expect(contractState(contract(), [], 45n * DAY + 1n)).toEqual({
      kind: 'covered',
      daysLeft: 15n,
    })
  })

  it('after expiry without a covered loss it offers expire', () => {
    expect(contractState(contract(), [loss(1, 50, 40n)], 60n * DAY)).toEqual({ kind: 'expirable' })
  })

  it('a covered loss is claimed before expire, even after the term', () => {
    const s = contractState(contract(), [loss(2, 1_500, 45n)], 90n * DAY)
    expect(s.kind).toBe('claim')
  })

  it('closed contracts report how they closed', () => {
    const settled = contract({
      status: ContractStatus.Settled,
      payout: 75_000_000n,
      settledLossIndex: 2,
    })
    expect(contractState(settled, [], 0n)).toEqual({
      kind: 'settled',
      payout: 75_000_000n,
      lossIndex: 2,
    })
    expect(contractState(contract({ status: ContractStatus.Expired }), [], 0n)).toEqual({
      kind: 'expired',
    })
  })
})

describe('buyRequested', () => {
  it('treats a blank notional as no request, whatever the term', () => {
    expect(buyRequested('')).toBe(false)
    expect(buyRequested('   ')).toBe(false)
  })

  it('treats anything typed as a request, to be validated', () => {
    expect(buyRequested('1,000.00')).toBe(true)
    expect(buyRequested('abc')).toBe(true)
  })
})
