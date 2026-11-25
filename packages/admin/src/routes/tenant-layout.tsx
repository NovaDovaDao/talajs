import type { MemberRole, Store, Tenant } from '@talajs/contracts'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Navigate, Outlet, useLocation, useParams } from 'react-router'
import { ErrorState, Loading } from '@/components/states'
import { ApiError } from '@/lib/api'
import type { Page } from '@/lib/queries'
import { hasRole, TenantProvider, useApp, useMe } from '@/lib/session'

/** Resolves the tenant, the caller's role in it and its stores, then renders the app. */
export function TenantLayout() {
  const { tenantId = '' } = useParams()
  const { api } = useApp()
  const me = useMe()
  const location = useLocation()
  const path = (p: string) => `/v1/tenants/${tenantId}${p}`
  const tenant = useQuery({
    queryKey: ['t', tenantId, 'tenant'],
    queryFn: () => api.get<Tenant>(path('')),
    retry: false,
  })
  const stores = useQuery({
    queryKey: ['t', tenantId, 'stores', 'all'],
    queryFn: () => api.get<Page<Store>>(path('/stores'), { limit: 200 }),
    enabled: tenant.isSuccess,
  })

  const session = useMemo(() => {
    if (!me.data || !tenant.data) return null
    const membership = me.data.memberships.find((m) => m.tenantId === tenantId)
    const role: MemberRole = me.data.kind === 'service' ? 'OWNER' : (membership?.role ?? 'STAFF')
    return {
      tenantId,
      tenantName: tenant.data.name,
      currency: tenant.data.defaultCurrency,
      role,
      storeIds: membership?.storeIds ?? [],
      subject: me.data.subject,
      membershipId: membership?.membershipId ?? null,
      hasPin: membership?.hasPin ?? false,
      memberships: me.data.memberships,
      displayName: me.data.name ?? me.data.email ?? me.data.subject,
      can: (minimum: MemberRole) => hasRole(role, minimum),
      path: (p: string) => `/v1/tenants/${tenantId}${p}`,
      stores: stores.data?.data ?? [],
    }
  }, [me.data, tenant.data, stores.data, tenantId])

  const error = me.error ?? tenant.error
  if (error instanceof ApiError && error.status === 401) {
    return (
      <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} />
    )
  }
  if (error instanceof ApiError && error.status === 404) return <Navigate to="/" replace />
  if (error) {
    return (
      <div className="p-8">
        <ErrorState error={error} />
      </div>
    )
  }
  if (!session || stores.isPending) {
    return (
      <div className="p-8">
        <Loading />
      </div>
    )
  }
  return (
    <TenantProvider session={session}>
      <Outlet />
    </TenantProvider>
  )
}
