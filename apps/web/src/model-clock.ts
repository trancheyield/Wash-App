// Модельний годинник пулу для показу. Ланцюг зсуває `model_time` лише в `accrue`, тож
// між нарахуваннями екран домальовує його сам тим самим правилом, що й програма:
// `model_time + (now − last_accrued_ts) × time_scale`. Це підпис «MODEL DAY N», не
// облік: активи й NAV беруться лише з ланцюга.
import { useEffect, useState } from 'react'

export const DAY_SECONDS = 86_400n

export type ClockView = {
  modelTime: bigint
  lastAccruedTs: bigint
  params: { timeScale: number }
}

// Годинник назад (локальний час відстає від ланцюга) → проєкція не рухається назад,
// як і `now = max(clock, last_accrued_ts)` у програмі.
export function projectedModelTime(pool: ClockView, nowUnix: bigint): bigint {
  const elapsed = nowUnix > pool.lastAccruedTs ? nowUnix - pool.lastAccruedTs : 0n
  return pool.modelTime + elapsed * BigInt(pool.params.timeScale)
}

export function modelDay(modelTime: bigint): number {
  return Number(modelTime / DAY_SECONDS)
}

// Підпис масштабу в титульному блоці: 43 200× → `1 MIN : 30 DAYS`. Коли хвилина показу
// не дає цілого числа днів чи годин — чистий множник.
export function formatScale(timeScale: number): string {
  if (timeScale === 1) return 'SCALE 1 : 1'
  const perMinute = BigInt(timeScale) * 60n
  if (perMinute % DAY_SECONDS === 0n) {
    const days = perMinute / DAY_SECONDS
    return `SCALE 1 MIN : ${days} ${days === 1n ? 'DAY' : 'DAYS'}`
  }
  if (perMinute % 3_600n === 0n) {
    const hours = perMinute / 3_600n
    return `SCALE 1 MIN : ${hours} ${hours === 1n ? 'HOUR' : 'HOURS'}`
  }
  return `SCALE ${timeScale.toLocaleString('en-US')}×`
}

// Той самий підпис малими літерами для рядка під назвою пулу.
export function describeScale(timeScale: number): string {
  return formatScale(timeScale)
    .replace(/^SCALE /, 'clock ')
    .toLowerCase()
}

export function unixNow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000))
}

// Секунда показу = `time_scale` модельних секунд; тік раз на секунду достатній,
// щоб «MODEL DAY» рухався на очах (на демо-масштабі — день за дві секунди).
export function useUnixNow(tickMs = 1_000): bigint {
  const [now, setNow] = useState(unixNow)
  useEffect(() => {
    const timer = setInterval(() => setNow(unixNow()), tickMs)
    return () => clearInterval(timer)
  }, [tickMs])
  return now
}
