import { type CreateTaxRate, type ListQuery, type UpdateTaxRate, uuidv7 } from '@talajs/contracts'
import { notFound } from '../errors.js'
import { recordChange } from '../lib/change-log.js'
import { toPage, withCursor } from '../lib/pagination.js'
import type { TenantContext } from '../types.js'
import { archivedFilter } from './archive.js'

const select = {
  id: true,
  name: true,
  rateBps: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

export async function listTaxRates(ctx: TenantContext, query: ListQuery) {
  const rows = await ctx.db.taxRate.findMany({
    where: withCursor(archivedFilter(query), query),
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    select,
  })
  return toPage(rows, query.limit)
}

export async function getTaxRate(ctx: TenantContext, id: string) {
  const row = await ctx.db.taxRate.findUnique({ where: { id }, select })
  if (!row) throw notFound('Tax rate')
  return row
}

export async function createTaxRate(ctx: TenantContext, input: CreateTaxRate) {
  const id = input.id ?? uuidv7()
  return ctx.db.$transaction(async (tx) => {
    const row = await tx.taxRate.create({ data: { ...input, id, tenantId: ctx.tenantId }, select })
    await recordChange(tx, ctx.tenantId, 'tax_rate', id, 'upsert')
    return row
  })
}

export async function updateTaxRate(ctx: TenantContext, id: string, input: UpdateTaxRate) {
  return ctx.db.$transaction(async (tx) => {
    const row = await tx.taxRate.update({ where: { id }, data: input, select })
    await recordChange(tx, ctx.tenantId, 'tax_rate', id, 'upsert')
    return row
  })
}

export async function setTaxRateArchived(ctx: TenantContext, id: string, archived: boolean) {
  return ctx.db.$transaction(async (tx) => {
    const row = await tx.taxRate.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
      select,
    })
    await recordChange(tx, ctx.tenantId, 'tax_rate', id, archived ? 'archive' : 'restore')
    return row
  })
}
