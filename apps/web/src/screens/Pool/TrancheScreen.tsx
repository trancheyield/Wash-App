import { PoolGate } from './PoolGate.tsx'
import type { Mode } from './preview.ts'
import { TranchePanel } from './TranchePanel.tsx'

// Аркуш 2 у двох режимах — маршрути `/pool/:id/deposit` і `/pool/:id/redeem`; режим
// у маршруті, а не в стані, щоб кнопка REDEEM на аркуші пулу відкривала одразу його.
export function TrancheScreen({ mode }: { mode: Mode }) {
  return <PoolGate>{(pool) => <TranchePanel key={mode} pool={pool} mode={mode} />}</PoolGate>
}
