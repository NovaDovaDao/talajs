import {
  type CreateCustomer,
  type CreateCustomerNote,
  type ListQuery,
  type OrderSummary,
  type UpdateCustomer,
  uuidv7,
} from '@talajs/contracts'
import { notFound } from '../errors.js'
import { toPage, withCursor } from '../lib/pagination.js'
import type { TenantContext, TenantTx } from '../types.js'
import { storeFilter } from './access.js'
import { archivedFilter } from './archive.js'

const customerSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  marketingOptIn: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  tags: { select: { tag: { select: { name: true } } } },
} as const

type CustomerRow = { tags: { tag: { name: string } }[] }

function toCustomer<R extends CustomerRow>(row: R) {
  const { tags, ...rest } = row
  return { ...rest, tags: tags.map((t) => t.tag.name).sort() }
}

async function loadCustomer(tx: Pick<TenantTx, 'customer'>, id: string) {
  const row = await tx.customer.findUnique({ where: { id }, select: customerSelect })
  if (!row) throw notFound('Customer')
  return toCustomer(row)
}

/** Replace a customer's tags, creating tags that don't exist yet. */
async function setTags(tx: TenantTx, ctx: TenantContext, customerId: string, names: string[]) {
  await tx.customerTag.deleteMany({ where: { customerId } })
  for (const name of [...new Set(names)]) {
    const tag = await tx.tag.upsert({
      where: { tenantId_name: { tenantId: ctx.tenantId, name } },
      create: { id: uuidv7(), tenantId: ctx.tenantId, name },
      update: {},
      select: { id: true },
    })
    await tx.customerTag.create({ data: { tenantId: ctx.tenantId, customerId, tagId: tag.id } })
  }
}

export async function listCustomers(
  ctx: TenantContext,
  query: ListQuery & { q?: string | undefined; tag?: string | undefined },
) {
  const search = query.q
    ? {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' as const } },
          { email: { contains: query.q.toLowerCase() } },
          { phone: { contains: query.q } },
        ],
      }
    : {}
  const tag = query.tag ? { tags: { some: { tag: { name: query.tag } } } } : {}
  const rows = await ctx.db.customer.findMany({
    where: withCursor({ ...archivedFilter(query), ...search, ...tag }, query),
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    select: customerSelect,
  })
  return toPage(rows.map(toCustomer), query.limit)
}

export const getCustomer = (ctx: TenantContext, id: string) => loadCustomer(ctx.db, id)

export async function createCustomer(ctx: TenantContext, input: CreateCustomer) {
  const { tags, ...fields } = input
  const id = input.id ?? uuidv7()
  return ctx.db.$transaction(async (tx) => {
    await tx.customer.create({ data: { ...fields, id, tenantId: ctx.tenantId } })
    if (tags.length > 0) await setTags(tx, ctx, id, tags)
    return loadCustomer(tx, id)
  })
}

export async function updateCustomer(ctx: TenantContext, id: string, input: UpdateCustomer) {
  const { tags, ...fields } = input
  return ctx.db.$transaction(async (tx) => {
    await tx.customer.update({ where: { id }, data: fields })
    if (tags) await setTags(tx, ctx, id, tags)
    return loadCustomer(tx, id)
  })
}

export async function setCustomerArchived(ctx: TenantContext, id: string, archived: boolean) {
  await ctx.db.customer.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
  })
  return loadCustomer(ctx.db, id)
}

const noteSelect = {
  id: true,
  customerId: true,
  body: true,
  author: true,
  createdAt: true,
} as const

/** Newest first. */
export async function listCustomerNotes(ctx: TenantContext, customerId: string, query: ListQuery) {
  await loadCustomer(ctx.db, customerId)
  const rows = await ctx.db.customerNote.findMany({
    where: withCursor({ customerId }, query, 'desc'),
    orderBy: { id: 'desc' },
    take: query.limit + 1,
    select: noteSelect,
  })
  return toPage(rows, query.limit)
}

export async function createCustomerNote(
  ctx: TenantContext,
  customerId: string,
  input: CreateCustomerNote,
) {
  await loadCustomer(ctx.db, customerId)
  return ctx.db.customerNote.create({
    data: {
      id: input.id ?? uuidv7(),
      tenantId: ctx.tenantId,
      customerId,
      body: input.body,
      author: ctx.actor,
    },
    select: noteSelect,
  })
}

/** Order history, newest first, limited to the caller's stores. */
export async function listCustomerOrders(
  ctx: TenantContext,
  customerId: string,
  query: ListQuery,
): Promise<{
  data: Array<
    Omit<OrderSummary, 'openedAt' | 'completedAt'> & { openedAt: Date; completedAt: Date | null }
  >
  nextCursor: string | null
}> {
  await loadCustomer(ctx.db, customerId)
  const rows = await ctx.db.order.findMany({
    where: withCursor({ customerId, ...storeFilter(ctx) }, query, 'desc'),
    orderBy: { id: 'desc' },
    take: query.limit + 1,
    select: {
      id: true,
      storeId: true,
      number: true,
      status: true,
      currency: true,
      totalMinor: true,
      openedAt: true,
      completedAt: true,
    },
  })
  return toPage(rows, query.limit)
}

export async function listTags(ctx: TenantContext) {
  const rows = await ctx.db.tag.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, _count: { select: { customers: true } } },
  })
  return rows.map(({ _count, ...t }) => ({ ...t, customerCount: _count.customers }))
}
