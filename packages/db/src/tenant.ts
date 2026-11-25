import type { Prisma, PrismaClient } from './generated/node/client.js'

/**
 * Tenant scoping: the one place where tenant isolation is enforced in application code.
 * (The database enforces it too: every relation is a composite `(tenant_id, …)` foreign key.)
 *
 * `scopeToTenant(client, tenantId)` returns a client that, for every top-level operation:
 * - adds `tenantId` to `where` (reads, updates, deletes, counts, aggregates),
 * - sets `tenantId` on created rows (`create`, `createMany`, `upsert`),
 * - rejects any attempt to write a different `tenantId`,
 * - refuses models that aren't tenant-scoped (`ProviderEvent`, the `tala_auth` models), and exposes the `Tenant`
 *   model read-only, limited to the current tenant.
 *
 * Use unchecked (scalar) inputs, e.g. `{ storeId }` rather than `{ store: { connect } }`.
 * Nested writes are not rewritten; the composite foreign keys reject cross-tenant rows anyway.
 * Raw SQL (`$queryRaw`, `$executeRaw`) is NOT scoped: domain code must not use it on a
 * tenant client except through helpers that bind `tenant_id` explicitly.
 */

type Scope = 'tenant-owned' | 'tenant-root' | 'system'

const MODEL_SCOPE: Record<Prisma.ModelName, Scope> = {
  Tenant: 'tenant-root',
  Store: 'tenant-owned',
  Membership: 'tenant-owned',
  Terminal: 'tenant-owned',
  TaxRate: 'tenant-owned',
  Category: 'tenant-owned',
  Item: 'tenant-owned',
  ItemCategory: 'tenant-owned',
  Variant: 'tenant-owned',
  ModifierGroup: 'tenant-owned',
  Modifier: 'tenant-owned',
  ItemModifierGroup: 'tenant-owned',
  StoreItem: 'tenant-owned',
  StockLevel: 'tenant-owned',
  StockMovement: 'tenant-owned',
  Customer: 'tenant-owned',
  CustomerNote: 'tenant-owned',
  Tag: 'tenant-owned',
  CustomerTag: 'tenant-owned',
  Order: 'tenant-owned',
  OrderLine: 'tenant-owned',
  OrderLineModifier: 'tenant-owned',
  Payment: 'tenant-owned',
  Refund: 'tenant-owned',
  PaymentAccount: 'tenant-owned',
  ProviderEvent: 'system',
  SyncMutation: 'tenant-owned',
  ReviewItem: 'tenant-owned',
  ChangeLog: 'tenant-owned',
  DomainEvent: 'tenant-owned',
  Invitation: 'tenant-owned',
  AuditLog: 'tenant-owned',
  // People and their sessions belong to no single tenant (see @talajs/auth).
  AuthUser: 'system',
  AuthSession: 'system',
  AuthAccount: 'system',
  AuthVerification: 'system',
  AuthRateLimit: 'system',
}

export class TenantScopeError extends Error {
  override name = 'TenantScopeError'
}

type Args = Record<string, unknown>
type Data = Record<string, unknown>

const READ_ONLY_TENANT_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
])

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
])

function scopedData(data: unknown, tenantId: string, model: string): Data {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new TenantScopeError(`${model}: expected an object for data`)
  }
  const d = data as Data
  if ('tenantId' in d && d.tenantId !== tenantId) {
    throw new TenantScopeError(`${model}: cannot write a row for another tenant`)
  }
  if ('tenant' in d) {
    throw new TenantScopeError(`${model}: use scalar tenant-scoped inputs, not a "tenant" relation`)
  }
  return { ...d, tenantId }
}

function guardUpdate(data: unknown, tenantId: string, model: string): unknown {
  if (typeof data === 'object' && data !== null && 'tenantId' in data) {
    if ((data as Data).tenantId !== tenantId) {
      throw new TenantScopeError(`${model}: tenantId cannot be changed`)
    }
  }
  return data
}

/** Exported for tests; prefer `scopeToTenant`. */
export function applyTenantScope(
  model: string,
  operation: string,
  args: Args | undefined,
  tenantId: string,
): Args {
  const scope = MODEL_SCOPE[model as Prisma.ModelName]
  if (scope === undefined || scope === 'system') {
    throw new TenantScopeError(`${model} is not tenant-scoped; use the unscoped client`)
  }
  const a: Args = { ...(args ?? {}) }

  if (scope === 'tenant-root') {
    if (!READ_ONLY_TENANT_OPS.has(operation)) {
      throw new TenantScopeError(`Tenant is read-only through a tenant-scoped client`)
    }
    a.where = { ...((a.where as Args | undefined) ?? {}), id: tenantId }
    return a
  }

  if (WHERE_OPS.has(operation)) {
    a.where = { ...((a.where as Args | undefined) ?? {}), tenantId }
  }

  switch (operation) {
    case 'create':
      a.data = scopedData(a.data, tenantId, model)
      break
    case 'createMany':
    case 'createManyAndReturn': {
      const rows = Array.isArray(a.data) ? a.data : [a.data]
      a.data = rows.map((row) => scopedData(row, tenantId, model))
      break
    }
    case 'upsert':
      a.create = scopedData(a.create, tenantId, model)
      a.update = guardUpdate(a.update, tenantId, model)
      break
    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn':
      a.data = guardUpdate(a.data, tenantId, model)
      break
    default:
      if (!WHERE_OPS.has(operation)) {
        throw new TenantScopeError(
          `${model}.${operation} is not supported on a tenant-scoped client`,
        )
      }
  }
  return a
}

export function scopeToTenant(client: PrismaClient, tenantId: string) {
  if (!tenantId) throw new TenantScopeError('tenantId is required')
  return client.$extends({
    name: 'tala-tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return query(applyTenantScope(model, operation, args as Args, tenantId) as typeof args)
        },
      },
    },
  })
}

export type TenantDb = ReturnType<typeof scopeToTenant>
