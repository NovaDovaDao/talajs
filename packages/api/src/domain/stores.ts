import {
  type CreateStore,
  type ListQuery,
  type PutStoreItem,
  type UpdateStore,
  uuidv7,
} from '@talajs/contracts'
import { notFound } from '../errors.js'
import { recordChange } from '../lib/change-log.js'
import { toPage, withCursor } from '../lib/pagination.js'
import type { TenantContext } from '../types.js'
import { assertStoreAccess, storeFilter } from './access.js'
import { archivedFilter } from './archive.js'

const storeSelect = {
  id: true,
  name: true,
  slug: true,
  currency: true,
  timezone: true,
  pricesIncludeTax: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

export async function listStores(ctx: TenantContext, query: ListQuery) {
  const rows = await ctx.db.store.findMany({
    where: withCursor({ ...archivedFilter(query), ...storeFilter(ctx, 'id') }, query),
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    select: storeSelect,
  })
  return toPage(rows, query.limit)
}

export async function getStore(ctx: TenantContext, id: string) {
  assertStoreAccess(ctx, id)
  const store = await ctx.db.store.findUnique({ where: { id }, select: storeSelect })
  if (!store) throw notFound('Store')
  return store
}

export async function createStore(ctx: TenantContext, input: CreateStore) {
  const id = input.id ?? uuidv7()
  return ctx.db.$transaction(async (tx) => {
    const store = await tx.store.create({
      data: { ...input, id, tenantId: ctx.tenantId },
      select: storeSelect,
    })
    await recordChange(tx, ctx.tenantId, 'store', id, 'upsert', id)
    return store
  })
}

export async function updateStore(ctx: TenantContext, id: string, input: UpdateStore) {
  assertStoreAccess(ctx, id)
  return ctx.db.$transaction(async (tx) => {
    const store = await tx.store.update({ where: { id }, data: input, select: storeSelect })
    await recordChange(tx, ctx.tenantId, 'store', id, 'upsert', id)
    return store
  })
}

export async function setStoreArchived(ctx: TenantContext, id: string, archived: boolean) {
  assertStoreAccess(ctx, id)
  return ctx.db.$transaction(async (tx) => {
    const store = await tx.store.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
      select: storeSelect,
    })
    await recordChange(tx, ctx.tenantId, 'store', id, archived ? 'archive' : 'restore', id)
    return store
  })
}

export async function listStoreItems(ctx: TenantContext, storeId: string) {
  assertStoreAccess(ctx, storeId)
  return ctx.db.storeItem.findMany({
    where: { storeId },
    orderBy: { itemId: 'asc' },
    select: { storeId: true, itemId: true, available: true, priceOverrideMinor: true },
  })
}

export async function putStoreItem(
  ctx: TenantContext,
  storeId: string,
  itemId: string,
  input: PutStoreItem,
) {
  assertStoreAccess(ctx, storeId)
  return ctx.db.$transaction(async (tx) => {
    const row = await tx.storeItem.upsert({
      where: { tenantId_storeId_itemId: { tenantId: ctx.tenantId, storeId, itemId } },
      create: { tenantId: ctx.tenantId, storeId, itemId, ...input },
      update: input,
      select: { storeId: true, itemId: true, available: true, priceOverrideMinor: true },
    })
    await recordChange(tx, ctx.tenantId, 'store_item', itemId, 'upsert', storeId)
    return row
  })
}
