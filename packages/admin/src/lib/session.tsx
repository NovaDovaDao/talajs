import type { Me, MemberRole, Store } from '@talajs/contracts'
import { useQuery } from '@tanstack/react-query'
import { createContext, type ReactNode, use, useEffect, useMemo, useState } from 'react'
import type { Api } from './api'
import type { Auth } from './auth'
import type { AdminConfig } from './config'

export interface AppContext {
  config: AdminConfig
  auth: Auth
  api: Api
}

const App = createContext<AppContext | null>(null)

export function AppProvider({ value, children }: { value: AppContext; children: ReactNode }) {
  return <App value={value}>{children}</App>
}

export function useApp(): AppContext {
  const ctx = use(App)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}

export function useMe() {
  const { api } = useApp()
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/v1/me'), retry: false })
}

const RANK: Record<MemberRole, number> = { STAFF: 1, MANAGER: 2, OWNER: 3 }

export interface TenantSession {
  tenantId: string
  tenantName: string
  /** The tenant's default currency (catalog prices). */
  currency: string
  role: MemberRole
  /** Empty = all stores. */
  storeIds: string[]
  subject: string
  /** The caller's membership in this tenant (null for service credentials). */
  membershipId: string | null
  hasPin: boolean
  /** Every business the caller belongs to, for the switcher. */
  memberships: Me['memberships']
  /** Name, else email, else subject. */
  displayName: string
  can(minimum: MemberRole): boolean
  /** Prefix for tenant-scoped API paths. */
  path(p: string): string
  /** The store the user is working in (register, inventory, filters). */
  storeId: string | null
  setStoreId(id: string | null): void
  stores: Store[]
}

const Tenant = createContext<TenantSession | null>(null)

export function TenantProvider({
  session,
  children,
}: {
  session: Omit<TenantSession, 'storeId' | 'setStoreId'>
  children: ReactNode
}) {
  const key = `tala-admin:store:${session.tenantId}`
  const [storeId, setStore] = useState<string | null>(() => localStorage.getItem(key))
  const visible = session.stores
  // Fall back to the first store when the remembered one is gone.
  useEffect(() => {
    if (visible.length > 0 && !visible.some((s) => s.id === storeId))
      setStore(visible[0]?.id ?? null)
  }, [visible, storeId])
  const value = useMemo<TenantSession>(
    () => ({
      ...session,
      storeId,
      setStoreId(id) {
        if (id) localStorage.setItem(key, id)
        else localStorage.removeItem(key)
        setStore(id)
      },
    }),
    [session, storeId, key],
  )
  return <Tenant value={value}>{children}</Tenant>
}

export function useTenant(): TenantSession {
  const ctx = use(Tenant)
  if (!ctx) throw new Error('useTenant outside TenantProvider')
  return ctx
}

export const hasRole = (role: MemberRole, minimum: MemberRole) => RANK[role] >= RANK[minimum]
