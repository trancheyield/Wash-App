import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { useAppConfig } from './providers.tsx'
import { LossScreen } from './screens/Operator/LossScreen.tsx'
import { DepositScreen } from './screens/Pool/DepositScreen.tsx'
import { PoolScreen } from './screens/Pool/PoolScreen.tsx'
import { PositionScreen } from './screens/Position/PositionScreen.tsx'
import { ProtectionScreen } from './screens/Protection/ProtectionScreen.tsx'

// Маршрути з PLAN; `:id` екрани M0 ще ігнорують — живі дані приходять у T020.
export function makeRouter(defaultPool: number) {
  const home = `/pool/${defaultPool}`
  return createBrowserRouter([
    { path: '/', element: <Navigate to={home} replace /> },
    { path: '/pool/:id', element: <PoolScreen /> },
    { path: '/pool/:id/deposit', element: <DepositScreen /> },
    { path: '/pool/:id/loss', element: <LossScreen /> },
    { path: '/pool/:id/protection', element: <ProtectionScreen /> },
    { path: '/me', element: <PositionScreen /> },
    { path: '/operator', element: <Navigate to={`${home}/loss`} replace /> },
    { path: '*', element: <Navigate to={home} replace /> },
  ])
}

export function Router() {
  const { defaultPool } = useAppConfig()
  return <RouterProvider router={makeRouter(defaultPool)} />
}
