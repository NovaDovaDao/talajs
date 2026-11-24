import {
  type CreateItem,
  type CreateVariant,
  type ListQuery,
  type UpdateItem,
  type UpdateVariant,
  uuidv7,
} from '@talajs/contracts'
import type { Prisma } from '@talajs/db'
import { notFound } from '../errors.js'
import { recordChange } from '../lib/change-log.js'
import { toPage, withCursor } from '../lib/pagination.js'
import type { TenantContext, TenantTx } from '../types.js'
import { archivedFilter } from './archive.js'

const variantSelect = {
  id: true,
  itemId: true,
  name: true,
  sku: true,
  priceMinor: true,
  currency: true,
  stockLevelId: true,
  sortOrder: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.VariantSelect

const itemInclude = {
  variants: { select: variantSelect, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  categories: { select: { categoryId: true }, orderBy: { sortOrder: 'asc' } },
  modifierGroups: { select: { groupId: true }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.ItemInclude

type ItemRow = {
  id: string
  name: string
  description: string | null
  taxRateId: string | null
  version: number
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
  variants: Array<Record<keyof typeof variantSelect, unknown>>
  categories: { categoryId: string }[]
  modifierGroups: { groupId: string }[]
}

function toItem<R extends ItemRow>(row: R) {
  const { categories, modifierGroups, ...rest } = row
  return {
    ...rest,
    categoryIds: categories.map((c) => c.categoryId),
    modifierGroupIds: modifierGroups.map((g) => g.groupId),
  }
}

async function loadItem(tx: Pick<TenantTx, 'item'>, id: string) {
  const row = await tx.item.findUnique({ where: { id }, include: itemInclude })
  if (!row) throw notFound('Item')
  return toItem(row)
}

async function defaultCurrency(tx: Pick<TenantTx, 'tenant'>): Promise<string> {
  const tenant = await tx.tenant.findFirst({ select: { defaultCurrency: true } })
  if (!tenant) throw notFound('Tenant')
  return tenant.defaultCurrency
}

function variantData(
  ctx: TenantContext,
  itemId: string,
  v: CreateVariant,
  currency: string,
  position = 0,
) {
  return {
    id: v.id ?? uuidv7(),
    tenantId: ctx.tenantId,
    itemId,
    name: v.name,
    sku: v.sku,
    priceMinor: v.priceMinor,
    currency: v.currency ?? currency,
    stockLevelId: v.stockLevelId,
    sortOrder: v.sortOrder ?? position,
  }
}

async function setItemLinks(
  tx: TenantTx,
  ctx: TenantContext,
  itemId: string,
  links: { categoryIds?: string[] | undefined; modifierGroupIds?: string[] | undefined },
) {
  if (links.categoryIds) {
    await tx.itemCategory.deleteMany({ where: { itemId } })
    await tx.itemCategory.createMany({
      data: [...new Set(links.categoryIds)].map((categoryId, sortOrder) => ({
        tenantId: ctx.tenantId,
        itemId,
        categoryId,
        sortOrder,
      })),
    })
  }
  if (links.modifierGroupIds) {
    await tx.itemModifierGroup.deleteMany({ where: { itemId } })
    await tx.itemModifierGroup.createMany({
      data: [...new Set(links.modifierGroupIds)].map((groupId, sortOrder) => ({
        tenantId: ctx.tenantId,
        itemId,
        groupId,
        sortOrder,
      })),
    })
  }
}

/** Every change to an item or its variants bumps `version` and appends to the change feed. */
async function touchItem(tx: TenantTx, ctx: TenantContext, itemId: string) {
  await tx.item.update({ where: { id: itemId }, data: { version: { increment: 1 } } })
  await recordChange(tx, ctx.tenantId, 'item', itemId, 'upsert')
}

export async function listItems(
  ctx: TenantContext,
  query: ListQuery & { categoryId?: string | undefined },
) {
  const rows = await ctx.db.item.findMany({
    where: withCursor(
      {
        ...archivedFilter(query),
        ...(query.categoryId ? { categories: { some: { categoryId: query.categoryId } } } : {}),
      },
      query,
    ),
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    include: itemInclude,
  })
  return toPage(rows.map(toItem), query.limit)
}

export const getItem = (ctx: TenantContext, id: string) => loadItem(ctx.db, id)

export async function createItem(ctx: TenantContext, input: CreateItem) {
  const id = input.id ?? uuidv7()
  return ctx.db.$transaction(async (tx) => {
    const currency = await defaultCurrency(tx)
    await tx.item.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description,
        taxRateId: input.taxRateId,
      },
    })
    await tx.variant.createMany({
      data: input.variants.map((v, i) => variantData(ctx, id, v, currency, i)),
    })
    await setItemLinks(tx, ctx, id, input)
    await recordChange(tx, ctx.tenantId, 'item', id, 'upsert')
    return loadItem(tx, id)
  })
}

export async function updateItem(ctx: TenantContext, id: string, input: UpdateItem) {
  const { categoryIds, modifierGroupIds, ...fields } = input
  return ctx.db.$transaction(async (tx) => {
    await tx.item.update({ where: { id }, data: { ...fields, version: { increment: 1 } } })
    await setItemLinks(tx, ctx, id, { categoryIds, modifierGroupIds })
    await recordChange(tx, ctx.tenantId, 'item', id, 'upsert')
    return loadItem(tx, id)
  })
}

export async function setItemArchived(ctx: TenantContext, id: string, archived: boolean) {
  return ctx.db.$transaction(async (tx) => {
    await tx.item.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } },
    })
    await recordChange(tx, ctx.tenantId, 'item', id, archived ? 'archive' : 'restore')
    return loadItem(tx, id)
  })
}

export async function createVariant(ctx: TenantContext, itemId: string, input: CreateVariant) {
  return ctx.db.$transaction(async (tx) => {
    const item = await tx.item.findUnique({ where: { id: itemId }, select: { id: true } })
    if (!item) throw notFound('Item')
    const variant = await tx.variant.create({
      data: variantData(ctx, itemId, input, await defaultCurrency(tx)),
      select: variantSelect,
    })
    await touchItem(tx, ctx, itemId)
    return variant
  })
}

async function variantOfItem(tx: TenantTx, itemId: string, variantId: string) {
  const v = await tx.variant.findFirst({ where: { id: variantId, itemId }, select: { id: true } })
  if (!v) throw notFound('Variant')
}

export async function updateVariant(
  ctx: TenantContext,
  itemId: string,
  variantId: string,
  input: UpdateVariant,
) {
  return ctx.db.$transaction(async (tx) => {
    await variantOfItem(tx, itemId, variantId)
    const variant = await tx.variant.update({
      where: { id: variantId },
      data: input,
      select: variantSelect,
    })
    await touchItem(tx, ctx, itemId)
    return variant
  })
}

export async function setVariantArchived(
  ctx: TenantContext,
  itemId: string,
  variantId: string,
  archived: boolean,
) {
  return ctx.db.$transaction(async (tx) => {
    await variantOfItem(tx, itemId, variantId)
    const variant = await tx.variant.update({
      where: { id: variantId },
      data: { archivedAt: archived ? new Date() : null },
      select: variantSelect,
    })
    await touchItem(tx, ctx, itemId)
    return variant
  })
}
