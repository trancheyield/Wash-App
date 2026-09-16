// Вимірювання сценарію демо: таймер кроку (SC-001: підпис → `confirmed` → зміна
// `Pool` видима в RPC), звірка waterfall збитку з подією на ланцюзі (SC-003) і
// схема `fixtures/demo-run.json` (SC-007). Чисті функції — сценарій лише кличе їх.
import { accruedView, type LossEventView, type PoolView } from '@washapp/chain'
import { applyLoss, type Micro } from '@washapp/shared'
import { z } from 'zod'

export const SC001_LIMIT_MS = 10_000
export const SC007_LIMIT_MS = 180_000

export type Timed<T> = { value: T; ms: number }

export async function timed<T>(run: () => Promise<T>): Promise<Timed<T>> {
  const t0 = performance.now()
  const value = await run()
  return { value, ms: performance.now() - t0 }
}

export type WaitOptions = { timeoutMs: number; intervalMs: number }

// Опитування RPC до першого стану, що задовольняє умову; WebSocket-підписок на
// акаунти сценарій не тримає — так само, як сторінка (опитування 5 с).
export async function waitUntil<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  { timeoutMs, intervalMs }: WaitOptions,
): Promise<T> {
  const deadline = performance.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (ok(value)) return value
    if (performance.now() >= deadline) {
      throw new Error(`стан не з'явився в RPC за ${timeoutMs} мс`)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

export type WaterfallCheck = {
  lossBps: number
  amount: Micro
  juniorLoss: Micro
  seniorLoss: Micro
  assetsBefore: Micro
  assetsAfter: Micro
  seniorBefore: Micro
  seniorAfter: Micro
  juniorBefore: Micro
  juniorAfter: Micro
  // SC-003: `L ≤ junior` → senior байт у байт той самий; інакше `senior_loss = L − junior`.
  seniorUnchanged: boolean
  mismatches: string[]
}

// `before` — пул після кроку `accrue`; `record_loss` нараховує ще раз до слоту події,
// тож стан «до збитку» — це `accruedView(before, event.ts)`, і він має збігтися з
// `assets_before` події байт у байт. Далі — той самий `applyLoss`, що в `math.rs`.
export function checkWaterfall(
  before: PoolView,
  after: PoolView,
  event: LossEventView,
): WaterfallCheck {
  const atEvent = accruedView(before, event.ts)
  const expected = applyLoss(event.amount, atEvent.senior.assets, atEvent.junior.assets)
  const mismatches: string[] = []
  const same = (label: string, got: Micro, want: Micro) => {
    if (got !== want) mismatches.push(`${label}: ${got} ≠ ${want}`)
  }
  same('assets_before', event.assetsBefore, atEvent.assets)
  same('junior_loss', event.juniorLoss, expected.juniorLoss)
  same('senior_loss', event.seniorLoss, expected.seniorLoss)
  same('senior after', after.senior.assets, atEvent.senior.assets - event.seniorLoss)
  same('junior after', after.junior.assets, atEvent.junior.assets - event.juniorLoss)
  same('assets after', after.assets, event.assetsAfter)
  if (event.amount <= atEvent.junior.assets) {
    same('senior untouched', after.senior.assets, atEvent.senior.assets)
  } else {
    same('senior_loss = L − junior', event.seniorLoss, event.amount - atEvent.junior.assets)
  }
  return {
    lossBps: event.lossBps,
    amount: event.amount,
    juniorLoss: event.juniorLoss,
    seniorLoss: event.seniorLoss,
    assetsBefore: event.assetsBefore,
    assetsAfter: event.assetsAfter,
    seniorBefore: atEvent.senior.assets,
    seniorAfter: after.senior.assets,
    juniorBefore: atEvent.junior.assets,
    juniorAfter: after.junior.assets,
    seniorUnchanged: after.senior.assets === atEvent.senior.assets,
    mismatches,
  }
}

// Суми в JSON — рядками: `bigint` у `JSON.stringify` не йде, а `Number` губить одиниці.
const micro = z
  .string()
  .regex(/^-?\d+$/)
  .transform(BigInt)

export const stepSchema = z.object({
  name: z.string().min(1),
  signature: z.string().nullable(),
  // Підпис → `confirmed`.
  confirmedMs: z.number().nonnegative(),
  // Підпис → змінений стан у RPC (`Pool` або баланс гаманця); `null` — крок без ланцюга.
  visibleMs: z.number().nonnegative().nullable(),
  note: z.string(),
})

export const demoRunSchema = z.object({
  comment: z.string(),
  ranAt: z.string().datetime(),
  programId: z.string(),
  poolId: z.number().int().nonnegative(),
  wallet: z.string(),
  steps: z.array(stepSchema).min(1),
  waterfall: z.object({
    lossBps: z.number().int(),
    amount: micro,
    juniorLoss: micro,
    seniorLoss: micro,
    assetsBefore: micro,
    assetsAfter: micro,
    seniorBefore: micro,
    seniorAfter: micro,
    juniorBefore: micro,
    juniorAfter: micro,
    seniorUnchanged: z.boolean(),
    mismatches: z.array(z.string()),
  }),
  nav: z.object({
    seniorBefore: micro,
    seniorAfterAccrue: micro,
    juniorBefore: micro,
    juniorAfterAccrue: micro,
  }),
  totalMs: z.number().nonnegative(),
  sc001MaxMs: z.number().nonnegative(),
})

export type Step = z.infer<typeof stepSchema>
export type DemoRun = z.infer<typeof demoRunSchema>

// Лише кроки з транзакцією: «wait» — це сценарій чекає доходу, не користувач екрана.
export function sc001Max(steps: readonly Step[]): number {
  return Math.max(
    0,
    ...steps.filter((s) => s.signature !== null).map((s) => s.visibleMs ?? s.confirmedMs),
  )
}

// Серіалізація з `bigint` → рядок; читається назад `demoRunSchema`.
export function toJson(run: DemoRun): string {
  return `${JSON.stringify(run, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n`
}
