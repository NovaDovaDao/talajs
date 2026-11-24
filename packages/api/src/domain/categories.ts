import { type CreateCategory, type ListQuery, type UpdateCategory, uuidv7 } from '@talajs/contracts'
import { HttpError, notFound } from '../errors.js'
import { recordChange } from '../lib/change-log.js'
import { toPage, withCursor } from '../lib/pagination.js'
import type { TenantContext, TenantTx } from '../types.js'
import { archivedFilter } from './archive.js'

const select = {
  id: true,
  name: true,
  parentId: true,
  sortOrder: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

export async function listCategories(ctx: TenantContext, query: ListQuery) {
  const rows = await ctx.db.category.findMany({
    where: withCursor(archivedFilter(query), query),
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    select,
  })
  return toPage(rows, query.limit)
}

export async function getCategory(ctx: TenantContext, id: string) {
  const row = await ctx.db.category.findUnique({ where: { id }, select })
  if (!row) throw notFound('Category')
  return row
}

/** Reject parent assignments that would create a cycle. */
async function assertNoCycle(tx: TenantTx, id: string, parentId: string | null) {
  let current = parentId
  for (let depth = 0; current; depth++) {
    if (current === id || depth > 32) {
      throw new HttpError(422, 'validation_error', 'Category parent would create a cycle')
    }
    const parent = await tx.category.findUnique({
      where: { id: current },
      select: { parentId: true },
    })
    current = parent?.parentId ?? null
  }
}

export async function createCategory(ctx: TenantContext, input: CreateCategory) {
  const id = input.id ?? uuidv7()
  return ctx.db.$transaction(async (tx) => {
    const row = await tx.category.create({ data: { ...input, id, tenantId: ctx.tenantId }, select })
    await recordChange(tx, ctx.tenantId, 'category', id, 'upsert')
    return row
  })
}

export async function updateCategory(ctx: TenantContext, id: string, input: UpdateCategory) {
  return ctx.db.$transaction(async (tx) => {
    if (input.parentId !== undefined) await assertNoCycle(tx, id, input.parentId)
    const row = await tx.category.update({ where: { id }, data: input, select })
    await recordChange(tx, ctx.tenantId, 'category', id, 'upsert')
    return row
  })
}

export async function setCategoryArchived(ctx: TenantContext, id: string, archived: boolean) {
  return ctx.db.$transaction(async (tx) => {
    const row = await tx.category.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
      select,
    })
    await recordChange(tx, ctx.tenantId, 'category', id, archived ? 'archive' : 'restore')
    return row
  })
}
