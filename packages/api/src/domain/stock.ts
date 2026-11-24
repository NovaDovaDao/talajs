import {
  type CreateStockLevel,
  type ListQuery,
  type StockAdjustment,
  type UpdateStockLevel,
  uuidv7,
} from '@talajs/contracts'
import { HttpError, notFound } from '../errors.js'
import { recordChange } from '../lib/change-log.js'
import { toPage, withCursor } from '../lib/pagination.js'
import type { TenantContext, TenantTx } from '../types.js'
import { assertStoreAccess, storeFilter } from './access.js'

const levelSelect = {
  id: true,
  storeId: true,
  name: true,
  unit: true,
  onHand: true,
  trackStrictly: true,
  createdAt: true,
  updatedAt: true,
} as const

const movementSelect = {
  id: true,
  stockLevelId: true,
  delta: true,
  reason: true,
  orderLineId: true,
  note: true,
  actor: true,
  createdAt: true,
} as const

async function loadLevel(ctx: TenantContext, tx: Pick<TenantTx, 'stockLevel'>, id: string) {
  const level = await tx.stockLevel.findUnique({ where: { id }, select: levelSelect })
  if (!level) throw notFound('Stock level')
  assertStoreAccess(ctx, level.storeId)
  return level
}

export async function listStockLevels(
  ctx: TenantContext,
  query: ListQuery & { storeId?: string | undefined },
) {
  if (query.storeId) assertStoreAccess(ctx, query.storeId)
  const rows = await ctx.db.stockLevel.findMany({
    where: withCursor(
      { ...storeFilter(ctx), ...(query.storeId ? { storeId: query.storeId } : {}) },
      query,
    ),
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    select: levelSelect,
  })
  return toPage(rows, query.limit)
}

export const getStockLevel = (ctx: TenantContext, id: string) => loadLevel(ctx, ctx.db, id)

export async function createStockLevel(ctx: TenantContext, input: CreateStockLevel) {
  assertStoreAccess(ctx, input.storeId)
  const id = input.id ?? uuidv7()
  return ctx.db.$transaction(async (tx) => {
    const level = await tx.stockLevel.create({
      data: { ...input, id, tenantId: ctx.tenantId },
      select: levelSelect,
    })
    if (input.onHand !== 0) {
      await tx.stockMovement.create({
        data: {
          id: uuidv7(),
          tenantId: ctx.tenantId,
          stockLevelId: id,
          delta: input.onHand,
          reason: 'RECOUNT',
          note: 'Initial count',
          actor: ctx.actor,
        },
      })
    }
    await recordChange(tx, ctx.tenantId, 'stock_level', id, 'upsert')
    return level
  })
}

export async function updateStockLevel(ctx: TenantContext, id: string, input: UpdateStockLevel) {
  return ctx.db.$transaction(async (tx) => {
    await loadLevel(ctx, tx, id)
    const level = await tx.stockLevel.update({ where: { id }, data: input, select: levelSelect })
    await recordChange(tx, ctx.tenantId, 'stock_level', id, 'upsert')
    return level
  })
}

const insufficient = () =>
  new HttpError(409, 'insufficient_stock', 'Adjustment would take stock below zero')

/**
 * Apply a manual adjustment atomically. Deltas use a single conditional UPDATE, so concurrent
 * sales and adjustments can't lose updates; a recount retries optimistically against the value
 * it read, so the recorded delta is always exact.
 */
export async function adjustStock(ctx: TenantContext, id: string, input: StockAdjustment) {
  return ctx.db.$transaction(async (tx) => {
    const level = await loadLevel(ctx, tx, id)
    let delta: number

    if (input.reason === 'RECOUNT') {
      let current = level.onHand
      for (let attempt = 0; ; attempt++) {
        const { count } = await tx.stockLevel.updateMany({
          where: { id, onHand: current },
          data: { onHand: input.count },
        })
        if (count === 1) break
        if (attempt >= 4)
          throw new HttpError(409, 'conflict', 'Stock is changing; retry the recount')
        current = (await loadLevel(ctx, tx, id)).onHand
      }
      delta = input.count - current
    } else {
      delta = input.delta
      const guard = delta < 0 && level.trackStrictly ? { onHand: { gte: -delta } } : {}
      const { count } = await tx.stockLevel.updateMany({
        where: { id, ...guard },
        data: { onHand: { increment: delta } },
      })
      if (count === 0) throw insufficient()
    }

    const movement = await tx.stockMovement.create({
      data: {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        stockLevelId: id,
        delta,
        reason: input.reason,
        note: input.note ?? null,
        actor: ctx.actor,
      },
      select: movementSelect,
    })
    await recordChange(tx, ctx.tenantId, 'stock_level', id, 'upsert')
    return { stockLevel: await loadLevel(ctx, tx, id), movement }
  })
}

/** Newest first. */
export async function listStockMovements(ctx: TenantContext, id: string, query: ListQuery) {
  await loadLevel(ctx, ctx.db, id)
  const rows = await ctx.db.stockMovement.findMany({
    where: withCursor({ stockLevelId: id }, query, 'desc'),
    orderBy: { id: 'desc' },
    take: query.limit + 1,
    select: movementSelect,
  })
  return toPage(rows, query.limit)
}
