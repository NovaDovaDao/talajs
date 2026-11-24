import type { ComponentType } from 'react'
import { createBrowserRouter } from 'react-router'
import { AppShell } from '@/components/app-shell'
import { Loading } from '@/components/states'
import { basePath } from '@/lib/config'
import { NotFound } from './routes/not-found'
import { SignIn } from './routes/sign-in'
import { TenantLayout } from './routes/tenant-layout'
import { TenantPicker } from './routes/tenant-picker'

const PageLoading = () => (
  <div className="p-8">
    <Loading />
  </div>
)

/** Load a screen on first visit, so the first page load stays small. */
const page =
  <M, K extends keyof M>(load: () => Promise<M>, name: K) =>
  async () => ({ Component: (await load())[name] as ComponentType })

export function createAppRouter() {
  return createBrowserRouter(
    [
      { path: '/sign-in', element: <SignIn /> },
      { path: '/', element: <TenantPicker /> },
      {
        path: '/t/:tenantId',
        element: <TenantLayout />,
        hydrateFallbackElement: <PageLoading />,
        children: [
          {
            element: <AppShell />,
            hydrateFallbackElement: <PageLoading />,
            children: [
              { index: true, lazy: page(() => import('./routes/dashboard'), 'Dashboard') },
              { path: 'register', lazy: page(() => import('./routes/register'), 'Register') },
              { path: 'orders', lazy: page(() => import('./routes/orders'), 'Orders') },
              {
                path: 'orders/:orderId',
                lazy: page(() => import('./routes/order-detail'), 'OrderDetail'),
              },
              { path: 'customers', lazy: page(() => import('./routes/customers'), 'Customers') },
              {
                path: 'customers/:customerId',
                lazy: page(() => import('./routes/customer-detail'), 'CustomerDetail'),
              },
              { path: 'items', lazy: page(() => import('./routes/items'), 'Items') },
              { path: 'items/new', lazy: page(() => import('./routes/item-editor'), 'ItemEditor') },
              {
                path: 'items/:itemId',
                lazy: page(() => import('./routes/item-editor'), 'ItemEditor'),
              },
              { path: 'categories', lazy: page(() => import('./routes/categories'), 'Categories') },
              {
                path: 'modifier-groups',
                lazy: page(() => import('./routes/modifier-groups'), 'ModifierGroups'),
              },
              { path: 'tax-rates', lazy: page(() => import('./routes/tax-rates'), 'TaxRates') },
              { path: 'inventory', lazy: page(() => import('./routes/inventory'), 'Inventory') },
              { path: 'stores', lazy: page(() => import('./routes/stores'), 'Stores') },
              {
                path: 'stores/:storeId',
                lazy: page(() => import('./routes/store-detail'), 'StoreDetail'),
              },
              { path: 'terminals', lazy: page(() => import('./routes/terminals'), 'Terminals') },
              { path: 'review', lazy: page(() => import('./routes/review'), 'Review') },
              { path: 'members', lazy: page(() => import('./routes/members'), 'Members') },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
    { basename: basePath().replace(/\/$/, '') || '/' },
  )
}
