import { forbidden } from '../errors.js'
import type { TenantContext } from '../types.js'

export function canAccessStore(ctx: TenantContext, storeId: string): boolean {
  return ctx.storeIds.length === 0 || ctx.storeIds.includes(storeId)
}

export function assertStoreAccess(ctx: TenantContext, storeId: string) {
  if (!canAccessStore(ctx, storeId)) throw forbidden('No access to this store')
}

/** Prisma filter limiting a query to the caller's stores (no-op for all-store members). */
export function storeFilter(ctx: TenantContext, field = 'storeId') {
  return ctx.storeIds.length === 0 ? {} : { [field]: { in: ctx.storeIds } }
}
