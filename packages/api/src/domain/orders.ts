import {
  type AddLine,
  type AddLines,
  type CompleteOrder,
  type CreateOrder,
  type CreatePayment,
  type CreateRefund,
  type ListQuery,
  type OrderListQuery,
  priceOrder,
  safeMul,
  type UpdateOrder,
  uuidv7,
  type VoidRequest,
} from '@talajs/contracts'
import type { Prisma } from '@talajs/db'
import { HttpError, notFound } from '../errors.js'
import { emit } from '../events/publish.js'
import { recordChange } from '../lib/change-log.js'
import { toPage, withCursor } from '../lib/pagination.js'
import type { ChargeResult, RefundResult } from '../payments.js'
import type { TenantContext, TenantTx } from '../types.js'
import { assertStoreAccess, storeFilter } from './access.js'

// ── errors ──────────────────────────────────────────────────────────────────

const notOpen = (status: string) =>
  new HttpError(409, 'invalid_state', `The order is ${status.toLowerCase()} and can't be changed`)
const unavailable = (message: string, details?: unknown) =>
  new HttpError(422, 'item_unavailable', message, details)
const invalid = (message: string, details?: unknown) =>
  new HttpError(422, 'validation_error', message, details)

// ── reading ─────────────────────────────────────────────────────────────────

const headerSelect = {
  id: true,
  storeId: true,
  terminalId: true,
  customerId: true,
  number: true,
  status: true,
  source: true,
  isTab: true,
  tabName: true,
  note: true,
  currency: true,
  subtotalMinor: true,
  discountMinor: true,
  taxMinor: true,
  totalMinor: true,
  tipMinor: true,
  version: true,
  openedAt: true,
  openedBy: true,
  completedAt: true,
  completedBy: true,
  voidedAt: true,
  voidedBy: true,
  voidReason: true,
  createdAt: true,
  updatedAt: true,
  receiptSentAt: true,
  payments: {
    select: {
      status: true,
      amountMinor: true,
      refunds: { select: { status: true, amountMinor: true } },
    },
  },
} satisfies Prisma.OrderSelect

const lineSelect = {
  id: true,
  variantId: true,
  itemName: true,
  variantName: true,
  unitPriceMinor: true,
  quantity: true,
  taxRateBps: true,
  modifiersTotalMinor: true,
  lineTotalMinor: true,
  note: true,
  addedAt: true,
  addedBy: true,
  voidedAt: true,
  voidedBy: true,
  voidReason: true,
  modifiers: {
    select: { id: true, modifierId: true, groupName: true, name: true, priceDeltaMinor: true },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.OrderLineSelect

const paymentSelect = {
  id: true,
  orderId: true,
  method: true,
  provider: true,
  status: true,
  amountMinor: true,
  tipMinor: true,
  currency: true,
  externalId: true,
  asset: true,
  failureReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PaymentSelect

const refundSelect = {
  id: true,
  paymentId: true,
  amountMinor: true,
  currency: true,
  reason: true,
  status: true,
  externalId: true,
  lineIds: true,
  restock: true,
  actor: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RefundSelect

const orderSelect = {
  ...headerSelect,
  lines: { select: lineSelect, orderBy: { id: 'asc' } },
  payments: {
    select: { ...paymentSelect, refunds: { select: refundSelect, orderBy: { id: 'asc' } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.OrderSelect

interface Money {
  status: string
  amountMinor: number
}
const sumWhere = (rows: Money[], status: string) =>
  rows.reduce((sum, r) => (r.status === status ? sum + r.amountMinor : sum), 0)

/** Paid = successful payments − successful refunds. Balance due only applies to open orders. */
function withBalance<
  O extends { status: string; totalMinor: number; payments: (Money & { refunds: Money[] })[] },
>(order: O) {
  const refundedMinor = sumWhere(
    order.payments.flatMap((p) => p.refunds),
    'SUCCESS',
  )
  const paidMinor = sumWhere(order.payments, 'SUCCESS') - refundedMinor
  const balanceDueMinor = order.status === 'OPEN' ? Math.max(order.totalMinor - paidMinor, 0) : 0
  return { ...order, paidMinor, refundedMinor, balanceDueMinor }
}

export async function loadOrder(ctx: TenantContext, tx: Pick<TenantTx, 'order'>, id: string) {
  const row = await tx.order.findUnique({ where: { id }, select: orderSelect })
  if (!row) throw notFound('Order')
  assertStoreAccess(ctx, row.storeId)
  const order = withBalance(row)
  return {
    ...order,
    payments: order.payments.map(({ refunds, ...p }) => p),
    refunds: order.payments.flatMap((p) => p.refunds),
  }
}

/** What's still committed to the total: successful and in-flight payments, less refunds. */
export async function committedMinor(tx: TenantTx, orderId: string) {
  const payments = await tx.payment.findMany({
    where: { orderId, status: { in: ['SUCCESS', 'PENDING'] } },
    select: { amountMinor: true, refunds: { select: { status: true, amountMinor: true } } },
  })
  return payments.reduce(
    (sum, p) =>
      sum +
      p.amountMinor -
      p.refunds.reduce((r, x) => (x.status === 'FAILED' ? r : r + x.amountMinor), 0),
    0,
  )
}

export const getOrder = (ctx: TenantContext, id: string) => loadOrder(ctx, ctx.db, id)

/** Newest first. */
export async function listOrders(ctx: TenantContext, query: ListQuery & OrderListQuery) {
  if (query.storeId) assertStoreAccess(ctx, query.storeId)
  const filter = {
    ...storeFilter(ctx),
    ...(query.storeId ? { storeId: query.storeId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.isTab === undefined ? {} : { isTab: query.isTab }),
    ...(query.customerId ? { customerId: query.customerId } : {}),
  }
  const rows = await ctx.db.order.findMany({
    where: withCursor(filter, query, 'desc'),
    orderBy: { id: 'desc' },
    take: query.limit + 1,
    select: headerSelect,
  })
  return toPage(
    rows.map((row) => {
      const { payments, ...header } = withBalance(row)
      return header
    }),
    query.limit,
  )
}

// ── locking ─────────────────────────────────────────────────────────────────

export interface LockedOrder {
  id: string
  storeId: string
  status: string
  currency: string
  pricesIncludeTax: boolean
}

/**
 * Take the order's row lock and bump its version, in one statement. Every mutation starts here,
 * so concurrent edits to one order (a tab open on two registers) run one after another, and an
 * `expectedVersion` check can't race. Stock rows are only ever locked after the order row, in id
 * order, so two orders can't deadlock on each other's stock.
 */
export async function lockOrder(
  ctx: TenantContext,
  tx: TenantTx,
  id: string,
  expectedVersion: number | undefined,
  { requireOpen = true } = {},
): Promise<LockedOrder> {
  const { count } = await tx.order.updateMany({
    where: { id, ...(expectedVersion === undefined ? {} : { version: expectedVersion }) },
    data: { version: { increment: 1 } },
  })
  const order = await tx.order.findUnique({
    where: { id },
    select: {
      id: true,
      storeId: true,
      status: true,
      currency: true,
      version: true,
      store: { select: { pricesIncludeTax: true } },
    },
  })
  if (!order) throw notFound('Order')
  assertStoreAccess(ctx, order.storeId)
  if (count === 0) {
    throw new HttpError(409, 'version_conflict', 'The order has changed; reload and retry', {
      currentVersion: order.version,
    })
  }
  if (requireOpen && order.status !== 'OPEN') throw notOpen(order.status)
  return { ...order, pricesIncludeTax: order.store.pricesIncludeTax }
}

// ── stock ───────────────────────────────────────────────────────────────────

export interface StockTake {
  stockLevelId: string
  orderLineId: string
  quantity: number
}

/**
 * Take stock for new lines with the conditional decrement from docs/PLAN.md §2.4. A strictly
 * tracked level that would go below zero aborts the whole transaction with `insufficient_stock`.
 *
 * With `force` (sales a register already completed offline), stock is always taken; the ids of
 * strictly tracked levels that went below zero are returned for review.
 */
export async function takeStock(
  ctx: TenantContext,
  tx: TenantTx,
  takes: StockTake[],
  { force = false, syncMutationId = null as string | null } = {},
) {
  const negative: string[] = []
  const sorted = [...takes].sort((a, b) =>
    a.stockLevelId === b.stockLevelId
      ? a.orderLineId.localeCompare(b.orderLineId)
      : a.stockLevelId.localeCompare(b.stockLevelId),
  )
  const touched = new Set<string>()
  for (const take of sorted) {
    const { count } = await tx.stockLevel.updateMany({
      where: {
        id: take.stockLevelId,
        ...(force ? {} : { OR: [{ trackStrictly: false }, { onHand: { gte: take.quantity } }] }),
      },
      data: { onHand: { decrement: take.quantity } },
    })
    if (force) {
      const level = await tx.stockLevel.findUnique({
        where: { id: take.stockLevelId },
        select: { onHand: true, trackStrictly: true },
      })
      if (level?.trackStrictly && level.onHand < 0 && !negative.includes(take.stockLevelId)) {
        negative.push(take.stockLevelId)
      }
    }
    if (count === 0) {
      throw new HttpError(409, 'insufficient_stock', 'Not enough stock for this order', {
        stockLevelId: take.stockLevelId,
      })
    }
    await tx.stockMovement.create({
      data: {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        stockLevelId: take.stockLevelId,
        delta: -take.quantity,
        reason: 'SALE',
        orderLineId: take.orderLineId,
        syncMutationId,
        actor: ctx.actor,
      },
    })
    touched.add(take.stockLevelId)
  }
  for (const id of touched) await recordChange(tx, ctx.tenantId, 'stock_level', id, 'upsert')
  return negative
}

/**
 * Put back what the given lines still hold: each line's net movements per stock level (SALE
 * minus earlier VOID/REFUND), so restocking the same line twice is a no-op.
 */
export async function restockLines(
  ctx: TenantContext,
  tx: TenantTx,
  lineIds: string[],
  reason: 'VOID' | 'REFUND',
) {
  if (lineIds.length === 0) return
  const movements = await tx.stockMovement.findMany({
    where: { orderLineId: { in: lineIds } },
    select: { stockLevelId: true, orderLineId: true, delta: true },
  })
  const held = new Map<string, { stockLevelId: string; orderLineId: string; quantity: number }>()
  for (const m of movements) {
    const key = `${m.stockLevelId}/${m.orderLineId}`
    const entry = held.get(key) ?? {
      stockLevelId: m.stockLevelId,
      orderLineId: m.orderLineId as string,
      quantity: 0,
    }
    entry.quantity -= m.delta
    held.set(key, entry)
  }
  const touched = new Set<string>()
  const sorted = [...held.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [, { stockLevelId, orderLineId, quantity }] of sorted) {
    if (quantity <= 0) continue
    await tx.stockLevel.updateMany({
      where: { id: stockLevelId },
      data: { onHand: { increment: quantity } },
    })
    await tx.stockMovement.create({
      data: {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        stockLevelId,
        delta: quantity,
        reason,
        orderLineId,
        actor: ctx.actor,
      },
    })
    touched.add(stockLevelId)
  }
  for (const id of touched) await recordChange(tx, ctx.tenantId, 'stock_level', id, 'upsert')
}

// ── lines ───────────────────────────────────────────────────────────────────

const variantForSale = (storeId: string) =>
  ({
    id: true,
    name: true,
    priceMinor: true,
    currency: true,
    archivedAt: true,
    stockLevel: { select: { id: true, storeId: true } },
    item: {
      select: {
        name: true,
        archivedAt: true,
        taxRate: { select: { rateBps: true } },
        storeItems: { where: { storeId }, select: { available: true, priceOverrideMinor: true } },
        modifierGroups: {
          select: {
            group: {
              select: { id: true, name: true, minSelect: true, maxSelect: true, archivedAt: true },
            },
          },
        },
      },
    },
  }) satisfies Prisma.VariantSelect

const modifierForSale = {
  id: true,
  groupId: true,
  name: true,
  priceDeltaMinor: true,
  archivedAt: true,
  stockLevel: { select: { id: true, storeId: true } },
} satisfies Prisma.ModifierSelect

/**
 * Snapshot, insert and take stock for new lines. Catalog lines are priced from the catalog (with
 * the store's price override, if any) and validated: the item must be sold in this store and the
 * modifier choice must satisfy each group's min/max. A variant's or modifier's stock level is
 * only drawn down when it belongs to the order's store.
 */
async function insertLines(ctx: TenantContext, tx: TenantTx, order: LockedOrder, lines: AddLine[]) {
  const ids = lines.map((l) => l.id ?? uuidv7())
  if (new Set(ids).size !== ids.length) throw invalid('Line ids must be unique')

  const variantIds = [...new Set(lines.flatMap((l) => ('variantId' in l ? [l.variantId] : [])))]
  const modifierIds = [...new Set(lines.flatMap((l) => ('variantId' in l ? l.modifierIds : [])))]
  const taxRateIds = [
    ...new Set(lines.flatMap((l) => ('taxRateId' in l && l.taxRateId ? [l.taxRateId] : []))),
  ]
  const [variants, modifiers, taxRates] = await Promise.all([
    tx.variant.findMany({
      where: { id: { in: variantIds } },
      select: variantForSale(order.storeId),
    }),
    tx.modifier.findMany({ where: { id: { in: modifierIds } }, select: modifierForSale }),
    tx.taxRate.findMany({
      where: { id: { in: taxRateIds }, archivedAt: null },
      select: { id: true, rateBps: true },
    }),
  ])
  const variantById = new Map(variants.map((v) => [v.id, v]))
  const modifierById = new Map(modifiers.map((m) => [m.id, m]))
  const rateById = new Map(taxRates.map((r) => [r.id, r.rateBps]))

  const takes: StockTake[] = []
  const lineRows: Prisma.OrderLineCreateManyInput[] = []
  const modifierRows: Prisma.OrderLineModifierCreateManyInput[] = []

  lines.forEach((line, index) => {
    const lineId = ids[index] as string
    const base = {
      id: lineId,
      tenantId: ctx.tenantId,
      orderId: order.id,
      quantity: line.quantity,
      note: line.note ?? null,
      addedBy: ctx.actor,
    }

    if (!('variantId' in line)) {
      let taxRateBps = 0
      if (line.taxRateId) {
        const rate = rateById.get(line.taxRateId)
        if (rate === undefined) throw invalid('Unknown or archived tax rate', { index })
        taxRateBps = rate
      }
      lineRows.push({
        ...base,
        itemName: line.name,
        unitPriceMinor: line.unitPriceMinor,
        taxRateBps,
        lineTotalMinor: safeMul(line.unitPriceMinor, line.quantity),
      })
      return
    }

    const variant = variantById.get(line.variantId)
    if (!variant || variant.archivedAt || variant.item.archivedAt) {
      throw unavailable('This item is no longer sold', { index, variantId: line.variantId })
    }
    const storeItem = variant.item.storeItems[0]
    if (storeItem && !storeItem.available) {
      throw unavailable('This item is not sold in this store', { index, variantId: variant.id })
    }
    if (variant.currency !== order.currency) {
      throw invalid(
        `The item is priced in ${variant.currency}, the order is in ${order.currency}`,
        {
          index,
        },
      )
    }

    // Modifiers: each must belong to one of the item's groups; each group's limits hold.
    const groups = new Map(
      variant.item.modifierGroups
        .filter((g) => !g.group.archivedAt)
        .map((g) => [g.group.id, g.group]),
    )
    const chosen = new Map<string, number>()
    if (new Set(line.modifierIds).size !== line.modifierIds.length) {
      throw invalid('A modifier was chosen twice', { index })
    }
    const lineModifiers = line.modifierIds.map((id) => {
      const modifier = modifierById.get(id)
      const group = modifier && groups.get(modifier.groupId)
      if (!modifier || modifier.archivedAt || !group) {
        throw invalid("A modifier isn't available for this item", { index, modifierId: id })
      }
      chosen.set(group.id, (chosen.get(group.id) ?? 0) + 1)
      return { modifier, group }
    })
    for (const group of groups.values()) {
      const n = chosen.get(group.id) ?? 0
      if (n < group.minSelect || n > group.maxSelect) {
        throw invalid(
          `Choose ${group.minSelect === group.maxSelect ? group.minSelect : `${group.minSelect}–${group.maxSelect}`} from "${group.name}"`,
          { index, groupId: group.id },
        )
      }
    }

    const unitPriceMinor = storeItem?.priceOverrideMinor ?? variant.priceMinor
    const modifiersTotalMinor = lineModifiers.reduce((s, m) => s + m.modifier.priceDeltaMinor, 0)
    if (unitPriceMinor + modifiersTotalMinor < 0) {
      throw invalid('Modifiers would make this line negative', { index })
    }
    lineRows.push({
      ...base,
      variantId: variant.id,
      itemName: variant.item.name,
      variantName: variant.name,
      unitPriceMinor,
      taxRateBps: variant.item.taxRate?.rateBps ?? 0,
      modifiersTotalMinor,
      lineTotalMinor: safeMul(unitPriceMinor + modifiersTotalMinor, line.quantity),
    })
    for (const { modifier, group } of lineModifiers) {
      modifierRows.push({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        orderLineId: lineId,
        modifierId: modifier.id,
        groupName: group.name,
        name: modifier.name,
        priceDeltaMinor: modifier.priceDeltaMinor,
      })
    }

    for (const level of [variant.stockLevel, ...lineModifiers.map((m) => m.modifier.stockLevel)]) {
      if (level && level.storeId === order.storeId) {
        takes.push({ stockLevelId: level.id, orderLineId: lineId, quantity: line.quantity })
      }
    }
  })

  await tx.orderLine.createMany({ data: lineRows })
  if (modifierRows.length > 0) await tx.orderLineModifier.createMany({ data: modifierRows })
  await takeStock(ctx, tx, takes)
}

/** Recompute the order's totals from its lines with the shared pricing function. */
export async function reprice(tx: TenantTx, order: LockedOrder) {
  const lines = await tx.orderLine.findMany({
    where: { orderId: order.id },
    select: {
      unitPriceMinor: true,
      modifiersTotalMinor: true,
      quantity: true,
      taxRateBps: true,
      voidedAt: true,
    },
  })
  const priced = priceOrder({
    currency: order.currency,
    pricesIncludeTax: order.pricesIncludeTax,
    lines: lines.map((l) => ({
      unitPriceMinor: l.unitPriceMinor,
      modifierDeltasMinor: l.modifiersTotalMinor === 0 ? [] : [l.modifiersTotalMinor],
      quantity: l.quantity,
      taxRateBps: l.taxRateBps,
      voided: l.voidedAt !== null,
    })),
  })
  await tx.order.update({
    where: { id: order.id },
    data: {
      subtotalMinor: priced.subtotalMinor,
      taxMinor: priced.taxMinor,
      totalMinor: priced.totalMinor,
    },
  })
}

// ── mutations ───────────────────────────────────────────────────────────────

/** Returns `created: false` when an order with this id already exists (a retried create). */
export async function createOrder(ctx: TenantContext, input: CreateOrder) {
  assertStoreAccess(ctx, input.storeId)
  if (input.id) {
    const existing = await ctx.db.order.findUnique({
      where: { id: input.id },
      select: { id: true },
    })
    if (existing) return { order: await loadOrder(ctx, ctx.db, input.id), created: false }
  }
  const id = input.id ?? uuidv7()

  const order = await ctx.db.$transaction(async (tx) => {
    const store = await tx.store.findUnique({
      where: { id: input.storeId },
      select: { archivedAt: true },
    })
    if (!store) throw notFound('Store')
    if (store.archivedAt) throw new HttpError(409, 'invalid_state', 'The store is archived')
    // Row-locks the store, so numbers are handed out one at a time.
    const { nextOrderNumber, currency, pricesIncludeTax } = await tx.store.update({
      where: { id: input.storeId },
      data: { nextOrderNumber: { increment: 1 } },
      select: { nextOrderNumber: true, currency: true, pricesIncludeTax: true },
    })
    await tx.order.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        storeId: input.storeId,
        customerId: input.customerId,
        number: String(nextOrderNumber - 1),
        source: ctx.terminal ? 'POS' : input.source,
        terminalId: ctx.terminal?.id ?? null,
        isTab: input.isTab,
        tabName: input.tabName,
        note: input.note,
        currency,
        openedBy: ctx.actor,
      },
    })
    const locked = { id, storeId: input.storeId, status: 'OPEN', currency, pricesIncludeTax }
    if (input.lines.length > 0) {
      await insertLines(ctx, tx, locked, input.lines)
      await reprice(tx, locked)
    }
    return loadOrder(ctx, tx, id)
  })
  return { order, created: true }
}

export async function updateOrder(ctx: TenantContext, id: string, input: UpdateOrder) {
  const { expectedVersion, ...fields } = input
  return ctx.db.$transaction(async (tx) => {
    await lockOrder(ctx, tx, id, expectedVersion)
    const current = await tx.order.findUnique({
      where: { id },
      select: { isTab: true, tabName: true },
    })
    const isTab = fields.isTab ?? current?.isTab
    const tabName = fields.tabName === undefined ? current?.tabName : fields.tabName
    if (isTab && !tabName) throw invalid('A tab needs a name', { path: ['tabName'] })
    await tx.order.update({ where: { id }, data: fields })
    return loadOrder(ctx, tx, id)
  })
}

export async function addLines(ctx: TenantContext, id: string, input: AddLines) {
  return ctx.db.$transaction(async (tx) => {
    const order = await lockOrder(ctx, tx, id, input.expectedVersion)
    const lineIds = input.lines.flatMap((l) => (l.id ? [l.id] : []))
    if (lineIds.length > 0) {
      const existing = await tx.orderLine.count({ where: { id: { in: lineIds } } })
      if (existing > 0) throw new HttpError(409, 'conflict', 'A line with this id already exists')
    }
    await insertLines(ctx, tx, order, input.lines)
    await reprice(tx, order)
    return loadOrder(ctx, tx, id)
  })
}

export async function voidLine(ctx: TenantContext, id: string, lineId: string, input: VoidRequest) {
  return ctx.db.$transaction(async (tx) => {
    const order = await lockOrder(ctx, tx, id, input.expectedVersion)
    const { count } = await tx.orderLine.updateMany({
      where: { id: lineId, orderId: id, voidedAt: null },
      data: { voidedAt: new Date(), voidedBy: ctx.actor, voidReason: input.reason },
    })
    if (count === 0) {
      const line = await tx.orderLine.findUnique({
        where: { id: lineId },
        select: { orderId: true },
      })
      if (!line || line.orderId !== id) throw notFound('Order line')
      throw new HttpError(409, 'invalid_state', 'The line is already voided')
    }
    await restockLines(ctx, tx, [lineId], 'VOID')
    await reprice(tx, order)
    const result = await loadOrder(ctx, tx, id)
    if (result.paidMinor > result.totalMinor) {
      throw new HttpError(
        409,
        'invalid_state',
        'Voiding this line would leave the order overpaid; refund a payment first',
      )
    }
    return result
  })
}

/** Abandon an open order. Orders with a successful payment must be refunded instead. */
export async function voidOrder(ctx: TenantContext, id: string, input: VoidRequest) {
  return ctx.db.$transaction(async (tx) => {
    await lockOrder(ctx, tx, id, input.expectedVersion)
    if ((await committedMinor(tx, id)) > 0) {
      throw new HttpError(409, 'invalid_state', 'The order has payments; refund them instead')
    }
    const lines = await tx.orderLine.findMany({
      where: { orderId: id, voidedAt: null },
      select: { id: true },
    })
    await restockLines(
      ctx,
      tx,
      lines.map((l) => l.id),
      'VOID',
    )
    await tx.order.update({
      where: { id },
      data: {
        status: 'VOIDED',
        voidedAt: new Date(),
        voidedBy: ctx.actor,
        voidReason: input.reason,
      },
    })
    await emit(ctx, tx, 'order.voided', id)
    return loadOrder(ctx, tx, id)
  })
}

export async function completeOrder(ctx: TenantContext, id: string, input: CompleteOrder) {
  return ctx.db.$transaction(async (tx) => {
    await lockOrder(ctx, tx, id, input.expectedVersion)
    const current = await loadOrder(ctx, tx, id)
    if (!current.lines.some((l) => l.voidedAt === null)) {
      throw new HttpError(409, 'invalid_state', 'The order has no lines; void it instead')
    }
    if (current.balanceDueMinor > 0) {
      throw new HttpError(409, 'balance_due', 'The order has an unpaid balance', {
        balanceDueMinor: current.balanceDueMinor,
      })
    }
    await tx.order.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date(), completedBy: ctx.actor },
    })
    await emit(ctx, tx, 'order.completed', id)
    return loadOrder(ctx, tx, id)
  })
}

/** Returns `created: false` if the id already exists on this order (a retried request). */
async function existingOn(
  find: () => Promise<{ orderId: string } | null>,
  orderId: string,
  what: string,
) {
  const existing = await find()
  if (!existing) return false
  if (existing.orderId !== orderId) throw new HttpError(409, 'conflict', `${what} id already used`)
  return true
}

function adapterFor(ctx: TenantContext, method: string) {
  const adapter = ctx.payments.find((a) => a.methods.includes(method as never))
  if (!adapter) throw invalid(`No payment adapter is configured for ${method}`)
  return adapter
}

/**
 * Take a payment. Cash is recorded as successful in one transaction. Other methods go through
 * their adapter: the payment is recorded `PENDING` (reserving its amount against the balance),
 * the adapter is called outside the transaction, and the outcome is stored.
 */
export async function createPayment(ctx: TenantContext, id: string, input: CreatePayment) {
  const paymentId = input.id ?? uuidv7()
  if (
    input.id &&
    (await existingOn(
      () => ctx.db.payment.findUnique({ where: { id: paymentId }, select: { orderId: true } }),
      id,
      'Payment',
    ))
  ) {
    return { order: await loadOrder(ctx, ctx.db, id), created: false }
  }
  const adapter = input.method === 'CASH' ? null : adapterFor(ctx, input.method)

  const pending = await ctx.db.$transaction(async (tx) => {
    const locked = await lockOrder(ctx, tx, id, input.expectedVersion)
    const { totalMinor } = await loadOrder(ctx, tx, id)
    const dueMinor = Math.max(totalMinor - (await committedMinor(tx, id)), 0)
    if (input.amountMinor > dueMinor) {
      throw invalid('The payment is more than the balance due', { balanceDueMinor: dueMinor })
    }
    await tx.payment.create({
      data: {
        id: paymentId,
        tenantId: ctx.tenantId,
        orderId: id,
        method: input.method,
        provider: adapter?.id ?? null,
        terminalId: ctx.terminal?.id ?? null,
        status: adapter ? 'PENDING' : 'SUCCESS',
        amountMinor: input.amountMinor,
        tipMinor: input.tipMinor,
        currency: locked.currency,
      },
    })
    if (adapter) return locked
    if (input.tipMinor > 0) {
      await tx.order.update({ where: { id }, data: { tipMinor: { increment: input.tipMinor } } })
    }
    await emit(ctx, tx, 'payment.succeeded', id, { paymentId })
    return null
  })
  if (!adapter || !pending) return { order: await loadOrder(ctx, ctx.db, id), created: true }

  let result: ChargeResult
  try {
    result = await adapter.charge({
      tenantId: ctx.tenantId,
      storeId: pending.storeId,
      orderId: id,
      paymentId,
      method: input.method,
      amountMinor: input.amountMinor,
      tipMinor: input.tipMinor,
      currency: pending.currency,
    })
  } catch (error) {
    console.error(`tala: payment adapter "${adapter.id}" failed`, error)
    result = { status: 'FAILED', failureReason: 'The payment processor returned an error' }
  }

  const order = await ctx.db.$transaction(async (tx) => {
    await lockOrder(ctx, tx, id, undefined, { requireOpen: false })
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: result.status,
        externalId: result.externalId ?? null,
        failureReason: result.status === 'FAILED' ? (result.failureReason ?? 'Declined') : null,
        asset: result.asset ?? null,
      },
    })
    if (result.status === 'SUCCESS' && input.tipMinor > 0) {
      await tx.order.update({ where: { id }, data: { tipMinor: { increment: input.tipMinor } } })
    }
    await emit(ctx, tx, result.status === 'SUCCESS' ? 'payment.succeeded' : 'payment.failed', id, {
      paymentId,
    })
    return loadOrder(ctx, tx, id)
  })
  return { order, created: true }
}

/**
 * Refund (part of) a successful payment. Cash refunds succeed at once; others go through the
 * payment's adapter, in the same two steps as a charge. Named lines can have their stock put
 * back; refunding a line twice never restocks it twice.
 */
export async function createRefund(ctx: TenantContext, id: string, input: CreateRefund) {
  const refundId = input.id ?? uuidv7()
  if (
    input.id &&
    (await existingOn(
      async () => {
        const r = await ctx.db.refund.findUnique({
          where: { id: refundId },
          select: { payment: { select: { orderId: true } } },
        })
        return r && { orderId: r.payment.orderId }
      },
      id,
      'Refund',
    ))
  ) {
    return { order: await loadOrder(ctx, ctx.db, id), created: false }
  }

  const prepared = await ctx.db.$transaction(async (tx) => {
    const locked = await lockOrder(ctx, tx, id, undefined, { requireOpen: false })
    if (locked.status === 'VOIDED') throw notOpen(locked.status)
    const payment = await tx.payment.findUnique({
      where: { id: input.paymentId },
      select: {
        orderId: true,
        status: true,
        provider: true,
        externalId: true,
        amountMinor: true,
        currency: true,
        refunds: { select: { status: true, amountMinor: true } },
      },
    })
    if (!payment || payment.orderId !== id) throw notFound('Payment')
    if (payment.status !== 'SUCCESS') {
      throw new HttpError(409, 'invalid_state', 'Only successful payments can be refunded')
    }
    const refundable =
      payment.amountMinor -
      payment.refunds.reduce((s, r) => (r.status === 'FAILED' ? s : s + r.amountMinor), 0)
    if (input.amountMinor > refundable) {
      throw invalid('The refund is more than what is left of the payment', {
        refundableMinor: refundable,
      })
    }
    const lineIds = [...new Set(input.lineIds)]
    if (lineIds.length > 0) {
      const found = await tx.orderLine.count({
        where: { id: { in: lineIds }, orderId: id, voidedAt: null },
      })
      if (found !== lineIds.length) throw invalid('A line is not on this order or is voided')
    }

    const adapter = payment.provider
      ? ctx.payments.find((a) => a.id === payment.provider)
      : undefined
    if (payment.provider && !adapter) {
      throw invalid(`The payment adapter "${payment.provider}" is not configured`)
    }
    await tx.refund.create({
      data: {
        id: refundId,
        tenantId: ctx.tenantId,
        paymentId: input.paymentId,
        amountMinor: input.amountMinor,
        currency: payment.currency,
        reason: input.reason,
        status: adapter ? 'PENDING' : 'SUCCESS',
        lineIds,
        restock: input.restock,
        actor: ctx.actor,
      },
    })
    if (adapter) return { adapter, payment, lineIds }
    if (input.restock) await restockLines(ctx, tx, lineIds, 'REFUND')
    await emit(ctx, tx, 'refund.succeeded', id, { refundId, paymentId: input.paymentId })
    return null
  })
  if (!prepared) return { order: await loadOrder(ctx, ctx.db, id), created: true }

  let result: RefundResult
  try {
    result = await prepared.adapter.refund({
      tenantId: ctx.tenantId,
      paymentId: input.paymentId,
      refundId,
      externalId: prepared.payment.externalId,
      amountMinor: input.amountMinor,
      currency: prepared.payment.currency,
    })
  } catch (error) {
    console.error(`tala: payment adapter "${prepared.adapter.id}" refund failed`, error)
    result = { status: 'FAILED' }
  }
  const order = await ctx.db.$transaction(async (tx) => {
    await lockOrder(ctx, tx, id, undefined, { requireOpen: false })
    await tx.refund.update({
      where: { id: refundId },
      data: { status: result.status, externalId: result.externalId ?? null },
    })
    if (result.status === 'SUCCESS') {
      if (input.restock) await restockLines(ctx, tx, prepared.lineIds, 'REFUND')
      await emit(ctx, tx, 'refund.succeeded', id, { refundId, paymentId: input.paymentId })
    }
    return loadOrder(ctx, tx, id)
  })
  return { order, created: true }
}
