// Показ чисел ланцюга. Облік ніколи не округлює (`nav` ділить вниз); тут — лише рядки.
import type { Micro } from '@washapp/shared'

export function formatBps(bps: bigint | number): string {
  const b = BigInt(bps)
  const whole = b / 100n
  const frac = (b % 100n).toString().padStart(2, '0')
  return `${whole}.${frac} %`
}

// 6 знаків з округленням до найближчого; облік ділить вниз (`nav`).
export function formatNav(assets: Micro, supply: Micro): string {
  const tenfold = supply === 0n ? 10_000_000n : (assets * 10_000_000n) / supply
  const n = (tenfold + 5n) / 10n
  return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, '0')}`
}
