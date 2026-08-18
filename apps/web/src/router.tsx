import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { LossScreen } from './screens/Operator/LossScreen.tsx'
import { DepositScreen } from './screens/Pool/DepositScreen.tsx'
import { PoolScreen } from './screens/Pool/PoolScreen.tsx'
import { PositionScreen } from './screens/Position/PositionScreen.tsx'
import { ProtectionScreen } from './screens/Protection/ProtectionScreen.tsx'

// Маршрути з PLAN; `:id` поки ігнорується — M0 знає лише пул 0.
const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/pool/0" replace /> },
  { path: '/pool/:id', element: <PoolScreen /> },
  { path: '/pool/:id/deposit', element: <DepositScreen /> },
  { path: '/pool/:id/loss', element: <LossScreen /> },
  { path: '/pool/:id/protection', element: <ProtectionScreen /> },
  { path: '/me', element: <PositionScreen /> },
  { path: '/operator', element: <Navigate to="/pool/0/loss" replace /> },
])

export function Router() {
  return <RouterProvider router={router} />
}
