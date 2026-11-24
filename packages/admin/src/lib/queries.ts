import {
  type QueryKey,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, type Query } from './api'
import { useApp, useTenant } from './session'

export interface Page<T> {
  data: T[]
  nextCursor: string | null
}

/** Query keys start with the tenant, so switching tenants never shows stale data. */
export function useTenantKey() {
  const { tenantId } = useTenant()
  return (...parts: unknown[]): QueryKey => ['t', tenantId, ...parts]
}

/** A single tenant-scoped resource. */
export function useResource<T>(path: string | null, query?: Query) {
  const { api } = useApp()
  const tenant = useTenant()
  const key = useTenantKey()
  return useQuery({
    queryKey: key(path, query),
    queryFn: () => api.get<T>(tenant.path(path as string), query),
    enabled: path !== null,
  })
}

/** A paginated list with "load more". */
export function useList<T>(path: string, query?: Query) {
  const { api } = useApp()
  const tenant = useTenant()
  const key = useTenantKey()
  const q = useInfiniteQuery({
    queryKey: key(path, 'list', query),
    queryFn: ({ pageParam }) =>
      api.get<Page<T>>(tenant.path(path), { limit: 100, ...query, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  return { ...q, items: q.data?.pages.flatMap((p) => p.data) ?? [] }
}

/** Every page of a list, for small reference data (tax rates, categories, groups). */
export function useAll<T>(path: string, query?: Query) {
  const { api } = useApp()
  const tenant = useTenant()
  const key = useTenantKey()
  return useQuery({
    queryKey: key(path, 'all', query),
    queryFn: async () => {
      const all: T[] = []
      let cursor: string | undefined
      do {
        const page = await api.get<Page<T>>(tenant.path(path), { limit: 200, ...query, cursor })
        all.push(...page.data)
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      return all
    },
  })
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const issues = Array.isArray(error.details)
      ? (error.details as { message?: string; path?: unknown[] }[])
          .map((i) => [i.path?.join('.'), i.message].filter(Boolean).join(': '))
          .join('; ')
      : ''
    return issues ? `${error.message}: ${issues}` : error.message
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * A tenant-scoped write. On success it invalidates everything under the tenant (cheap at
 * café scale, and never leaves a stale list) and optionally toasts.
 */
export function useAction<V, R = unknown>(
  fn: (
    vars: V,
    ctx: ReturnType<typeof useApp> & { tenant: ReturnType<typeof useTenant> },
  ) => Promise<R>,
  options: { success?: string | ((r: R) => string); onSuccess?: (r: R) => void } = {},
) {
  const app = useApp()
  const tenant = useTenant()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: V) => fn(vars, { ...app, tenant }),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ['t', tenant.tenantId] })
      const msg = typeof options.success === 'function' ? options.success(result) : options.success
      if (msg) toast.success(msg)
      options.onSuccess?.(result)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
}
