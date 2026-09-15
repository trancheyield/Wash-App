// Форма «зафіксувати збиток N %» і її прев'ю — ті самі сторожі, що в
// `record_loss_handler`, у тому ж порядку, на стані пулу після нарахування
// (`accruedView`): відмова тут — до підпису, програма лишається останнім суддею.
import { type PoolView, poolBalances, withBalances } from '@washapp/chain'
import { afterLoss, applyLoss, formatAmount, lossAmount, type Micro } from '@washapp/shared'
import { z } from 'zod'
import { TOKEN } from '../../tokens.ts'

export const MAX_LOSS_BPS = 10_000

// Відсоток як набрано («15», «15.5», «0.25») → базисні пункти; більше двох знаків
// після коми програма не вміщає (`u16` bps), тому це відмова, не округлення.
export function parseLossBps(text: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(text)
  if (!m) return null
  const whole = Number(m[1])
  const frac = (m[2] ?? '').padEnd(2, '0')
  const bps = whole * 100 + Number(frac)
  return bps > MAX_LOSS_BPS ? null : bps
}

export const lossFormSchema = z.object({
  percent: z.string().transform((text, ctx): number => {
    const bps = parseLossBps(text)
    if (bps === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'loss must be between 0 and 100 % with up to 2 decimals',
      })
      return z.NEVER
    }
    return bps
  }),
})

export type LossPreview =
  | {
      kind: 'ok'
      lossBps: number
      amount: Micro
      juniorLoss: Micro
      seniorLoss: Micro
      after: PoolView
    }
  | { kind: 'refused'; reason: string }

// Прев'ю на стані, який побачить інструкція (`projected` = `accruedView(pool, now)`).
// Нульовий збиток — відмова, як у програмі (`ZeroAmount`): нема що записувати.
export function lossPreview(projected: PoolView, lossBps: number): LossPreview {
  if (lossBps > MAX_LOSS_BPS) return { kind: 'refused', reason: 'loss cannot exceed 100 %' }
  const balances = poolBalances(projected)
  const amount = lossAmount(balances.assets, lossBps)
  if (amount === 0n) {
    return {
      kind: 'refused',
      reason:
        balances.assets === 0n
          ? 'the pool holds nothing to lose'
          : `${formatAmount(balances.assets)} ${TOKEN} × ${lossBps} bps rounds to zero`,
    }
  }
  const split = applyLoss(amount, balances.seniorAssets, balances.juniorAssets)
  return {
    kind: 'ok',
    lossBps,
    amount,
    juniorLoss: split.juniorLoss,
    seniorLoss: split.seniorLoss,
    after: withBalances(projected, afterLoss(balances, split)),
  }
}
