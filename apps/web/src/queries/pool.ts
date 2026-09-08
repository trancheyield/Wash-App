import { useClient } from '@solana/react'
import { useQuery } from '@tanstack/react-query'
import { type PoolView, readPool } from '@washapp/chain'
import { z } from 'zod'
import type { AppClient } from '../rpc.ts'

// `:id` з маршруту — u16, як `Pool.id` у програмі; будь-що інше = «пулу немає».
// Не `z.coerce`: він читає порожній рядок як 0.
const poolIdSchema = z
  .string()
  .regex(/^\d{1,5}$/)
  .transform(Number)
  .pipe(z.number().int().max(65_535))

export function parsePoolId(text: string | undefined): number | null {
  const parsed = poolIdSchema.safeParse(text)
  return parsed.success ? parsed.data : null
}

export const poolQueryKey = (id: number) => ['pool', id] as const

// `null` — пулу з таким id на цьому кластері немає (акаунта не існує); помилка RPC —
// окремо, у `error`. Інтервал опитування — з `QueryClient` (5 с).
export function usePool(id: number | null) {
  const client = useClient<AppClient>()
  return useQuery<PoolView | null>({
    queryKey: poolQueryKey(id ?? -1),
    queryFn: () => (id === null ? Promise.resolve(null) : readPool(client.rpc, id)),
  })
}
