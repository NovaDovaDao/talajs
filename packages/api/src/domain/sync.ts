import {
  type ChangeEntity,
  type SyncLine,
  type SyncMutation,
  type SyncMutationResult,
  SyncMutationType,
  SyncPayloads,
  type SyncPullQuery,
  safeMul,
  uuidv7,
} from '@talajs/contracts'
import type { Prisma } from '@talajs/db'
import type { z } from 'zod'
import { HttpError, toHttpError } from '../errors.js'
import { emit } from '../events/publish.js'
import type { TenantContext, TenantTx, TerminalIdentity } from '../types.js'
import { canAccessStore } from './access.js'
import { getCategory } from './categories.js'
import { getItem } from './items.js'
import { getModifierGroup } from './modifiers.js'
import {
  committedMinor,
  type LockedOrder,
  loadOrder,
  lockOrder,
  reprice,
  restockLines,
  type StockTake,
  takeStock,
} from './orders.js'
import { getStockLevel } from './stock.js'
import { getStore } from './stores.js'
import { getTaxRate } from './tax-rates.js'

/*
 * Offline sync (docs/sync-protocol.md). A register's mutations describe things that already
 * happened at the counter, so they're applied as facts wherever possible:
 *
 * - APPLIED: done. May still open review items (stock below zero, price drift, overpayment).
 * - CONFLICT: not applied, because applying would be wrong (e.g. voiding a tab that changed
 *   since the register last saw it). The payload is kept in a review item.
 * - REJECTED: invalid (bad payload, unknown order, another store's order). Also kept for review.
 * - DUPLICATE: this mutation id was already received; nothing changes.
 *
 * Each mutation runs in its own transaction, in the order sent, so one failure doesn't block the
 * rest. The `sync_mutation` row is written in the same transaction as the effect, so a mutation is
 * applied exactly once even when the same batch is pushed twice at the same time.
 */

type ReviewKind = 'SYNC_CONFLICT' | 'NEGATIVE_STOCK' | 'PAYMENT_MISMATCH'

interface Review {
  kind: ReviewKind
  subjectType: string
  subjectId: string
  details: Record<string, unknown>
}

/** Thrown by a handler to roll back and record a CONFLICT instead. */
class SyncConflict extends Error {
  constructor(
    message: string,
    readonly kind: ReviewKind = 'SYNC_CONFLICT',
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

type Payload<T extends SyncMutationType> = z.output<(typeof SyncPayloads)[T]>

interface HandlerContext {
  ctx: TenantContext
  tx: TenantTx
  terminal: TerminalIdentity
  mutation: SyncMutation
  /** Reviews to open alongside an APPLIED mutation. */
  reviews: Review[]
}

type Handler<T extends SyncMutationType> = (h: HandlerContext, payload: Payload<T>) => Promise<void>

const asDate = (iso: string | undefined, fallback: string) => new Date(iso ?? fallback)

async function lockForSync(
  h: HandlerContext,
  orderId: string,
): Promise<LockedOrder & { version: number }> {
  const order = await lockOrder(h.ctx, h.tx, orderId, undefined, { requireOpen: false })
  const row = await h.tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { version: true },
  })
  // `version` was just bumped; the register compares against the version before this change.
  return { ...order, version: row.version - 1 }
}

function checkBaseVersion(h: HandlerContext, order: { version: number }) {
  const base = h.mutation.baseVersion
  if (base !== undefined && base !== order.version) {
    throw new SyncConflict('The order changed after the register last saw it', 'SYNC_CONFLICT', {
      baseVersion: base,
      currentVersion: order.version,
    })
  }
}

// ── handlers ────────────────────────────────────────────────────────────────

const openOrder: Handler<'order.open'> = async (h, p) => {
  const { ctx, tx, terminal } = h
  const existing = await tx.order.findUnique({
    where: { id: p.orderId },
    select: { terminalId: true },
  })
  if (existing) {
    if (existing.terminalId === terminal.id) return // opened by an earlier mutation
    throw new SyncConflict('An order with this id already exists')
  }
  if (p.number && !p.number.startsWith(`${terminal.code}-`)) {
    throw new HttpError(
      422,
      'validation_error',
      `Offline order numbers must start with "${terminal.code}-"`,
    )
  }
  if (p.isTab && !p.tabName) throw new HttpError(422, 'validation_error', 'A tab needs a name')
  const store = await tx.store.findUniqueOrThrow({
    where: { id: terminal.storeId },
    select: { currency: true },
  })
  let number = p.number
  if (!number) {
    const { nextOrderNumber } = await tx.store.update({
      where: { id: terminal.storeId },
      data: { nextOrderNumber: { increment: 1 } },
      select: { nextOrderNumber: true },
    })
    number = String(nextOrderNumber - 1)
  }
  await tx.order.create({
    data: {
      id: p.orderId,
      tenantId: ctx.tenantId,
      storeId: terminal.storeId,
      terminalId: terminal.id,
      customerId: p.customerId,
      number,
      source: 'POS',
      isTab: p.isTab,
      tabName: p.tabName,
      note: p.note,
      currency: store.currency,
      openedAt: asDate(p.openedAt, h.mutation.clientTs),
      openedBy: ctx.actor,
    },
  })
}

const addLines: Handler<'order.add_lines'> = async (h, p) => {
  const { ctx, tx, terminal } = h
  const order = await lockForSync(h, p.orderId)
  if (order.status !== 'OPEN') {
    throw new SyncConflict(
      `Lines were added to an order that is ${order.status.toLowerCase()}`,
      'SYNC_CONFLICT',
      {
        status: order.status,
      },
    )
  }
  const existing = new Set(
    (
      await tx.orderLine.findMany({
        where: { id: { in: p.lines.map((l) => l.id) } },
        select: { id: true, orderId: true },
      })
    ).map((l) => {
      if (l.orderId !== p.orderId)
        throw new HttpError(409, 'conflict', 'A line id is used on another order')
      return l.id
    }),
  )
  const lines = p.lines.filter((l) => !existing.has(l.id))
  if (lines.length === 0) return

  const variantIds = [...new Set(lines.flatMap((l) => (l.variantId ? [l.variantId] : [])))]
  const modifierIds = [
    ...new Set(
      lines.flatMap((l) => l.modifiers.flatMap((m) => (m.modifierId ? [m.modifierId] : []))),
    ),
  ]
  const [variants, modifiers] = await Promise.all([
    tx.variant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        priceMinor: true,
        stockLevel: { select: { id: true, storeId: true } },
        item: {
          select: {
            storeItems: {
              where: { storeId: terminal.storeId },
              select: { priceOverrideMinor: true },
            },
          },
        },
      },
    }),
    tx.modifier.findMany({
      where: { id: { in: modifierIds } },
      select: { id: true, stockLevel: { select: { id: true, storeId: true } } },
    }),
  ])
  const variantById = new Map(variants.map((v) => [v.id, v]))
  const modifierById = new Map(modifiers.map((m) => [m.id, m]))

  const lineRows: Prisma.OrderLineCreateManyInput[] = []
  const modifierRows: Prisma.OrderLineModifierCreateManyInput[] = []
  const takes: StockTake[] = []
  const drift: { lineId: string; chargedMinor: number; catalogMinor: number }[] = []

  for (const line of lines) {
    const modifiersTotalMinor = line.modifiers.reduce((s, m) => s + m.priceDeltaMinor, 0)
    const unitTotal = line.unitPriceMinor + modifiersTotalMinor
    if (unitTotal < 0) throw new HttpError(422, 'validation_error', 'A line has a negative total')
    if (line.variantId && !variantById.has(line.variantId)) {
      throw new HttpError(422, 'invalid_reference', 'Unknown variant', {
        variantId: line.variantId,
      })
    }
    lineRows.push(
      snapshotRow(ctx, p.orderId, line, modifiersTotalMinor, unitTotal, h.mutation.clientTs),
    )
    for (const m of line.modifiers) {
      modifierRows.push({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        orderLineId: line.id,
        modifierId: m.modifierId,
        groupName: m.groupName,
        name: m.name,
        priceDeltaMinor: m.priceDeltaMinor,
      })
    }

    const variant = line.variantId ? variantById.get(line.variantId) : undefined
    if (variant) {
      const catalogMinor = variant.item.storeItems[0]?.priceOverrideMinor ?? variant.priceMinor
      if (catalogMinor !== line.unitPriceMinor) {
        drift.push({ lineId: line.id, chargedMinor: line.unitPriceMinor, catalogMinor })
      }
    }
    const levels = [
      variant?.stockLevel,
      ...line.modifiers.map((m) =>
        m.modifierId ? modifierById.get(m.modifierId)?.stockLevel : null,
      ),
    ]
    for (const level of levels) {
      if (level && level.storeId === terminal.storeId) {
        takes.push({ stockLevelId: level.id, orderLineId: line.id, quantity: line.quantity })
      }
    }
  }

  await tx.orderLine.createMany({ data: lineRows })
  if (modifierRows.length > 0) await tx.orderLineModifier.createMany({ data: modifierRows })
  const negative = await takeStock(ctx, tx, takes, { force: true, syncMutationId: h.mutation.id })
  await reprice(tx, order)

  for (const stockLevelId of negative) {
    const level = await tx.stockLevel.findUnique({
      where: { id: stockLevelId },
      select: { name: true, onHand: true },
    })
    h.reviews.push({
      kind: 'NEGATIVE_STOCK',
      subjectType: 'stock_level',
      subjectId: stockLevelId,
      details: { reason: 'An offline sale took stock below zero', orderId: p.orderId, ...level },
    })
  }
  if (drift.length > 0) {
    h.reviews.push({
      kind: 'SYNC_CONFLICT',
      subjectType: 'order',
      subjectId: p.orderId,
      details: {
        reason: 'price_mismatch',
        message: 'Sold at a price that differs from the catalog',
        lines: drift,
      },
    })
  }
}

function snapshotRow(
  ctx: TenantContext,
  orderId: string,
  line: SyncLine,
  modifiersTotalMinor: number,
  unitTotal: number,
  clientTs: string,
): Prisma.OrderLineCreateManyInput {
  return {
    id: line.id,
    tenantId: ctx.tenantId,
    orderId,
    variantId: line.variantId,
    itemName: line.itemName,
    variantName: line.variantName,
    unitPriceMinor: line.unitPriceMinor,
    quantity: line.quantity,
    taxRateBps: line.taxRateBps,
    modifiersTotalMinor,
    lineTotalMinor: safeMul(unitTotal, line.quantity),
    note: line.note,
    addedAt: asDate(line.addedAt, clientTs),
    addedBy: ctx.actor,
  }
}

async function flagOverpayment(h: HandlerContext, orderId: string) {
  const { totalMinor } = await h.tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { totalMinor: true },
  })
  const paid = await committedMinor(h.tx, orderId)
  if (paid > totalMinor) {
    h.reviews.push({
      kind: 'PAYMENT_MISMATCH',
      subjectType: 'order',
      subjectId: orderId,
      details: {
        reason: 'The order is overpaid',
        paidMinor: paid,
        totalMinor,
        overpaidMinor: paid - totalMinor,
      },
    })
  }
}

const voidLine: Handler<'order.void_line'> = async (h, p) => {
  const { ctx, tx } = h
  const order = await lockForSync(h, p.orderId)
  if (order.status !== 'OPEN') {
    throw new SyncConflict(`A line was voided on an order that is ${order.status.toLowerCase()}`)
  }
  checkBaseVersion(h, order)
  const line = await tx.orderLine.findUnique({
    where: { id: p.lineId },
    select: { orderId: true, voidedAt: true },
  })
  if (!line || line.orderId !== p.orderId)
    throw new HttpError(404, 'not_found', 'Order line not found')
  if (line.voidedAt) return
  await tx.orderLine.update({
    where: { id: p.lineId },
    data: { voidedAt: new Date(h.mutation.clientTs), voidedBy: ctx.actor, voidReason: p.reason },
  })
  await restockLines(ctx, tx, [p.lineId], 'VOID')
  await reprice(tx, order)
  await flagOverpayment(h, p.orderId)
}

const pay: Handler<'order.pay'> = async (h, p) => {
  const { ctx, tx, terminal } = h
  if (p.method !== 'CASH') {
    throw new HttpError(422, 'validation_error', 'Only cash payments can be recorded offline')
  }
  const order = await lockForSync(h, p.orderId)
  const existing = await tx.payment.findUnique({
    where: { id: p.paymentId },
    select: { orderId: true },
  })
  if (existing) {
    if (existing.orderId !== p.orderId)
      throw new HttpError(409, 'conflict', 'Payment id already used')
    return
  }
  if (order.status === 'VOIDED') {
    throw new SyncConflict('Cash was taken on a voided order', 'PAYMENT_MISMATCH', {
      amountMinor: p.amountMinor,
      tipMinor: p.tipMinor,
    })
  }
  await tx.payment.create({
    data: {
      id: p.paymentId,
      tenantId: ctx.tenantId,
      orderId: p.orderId,
      terminalId: terminal.id,
      method: 'CASH',
      status: 'SUCCESS',
      amountMinor: p.amountMinor,
      tipMinor: p.tipMinor,
      currency: order.currency,
      createdAt: new Date(h.mutation.clientTs),
    },
  })
  if (p.tipMinor > 0) {
    await tx.order.update({
      where: { id: p.orderId },
      data: { tipMinor: { increment: p.tipMinor } },
    })
  }
  await emit(ctx, tx, 'payment.succeeded', p.orderId, { paymentId: p.paymentId })
  await flagOverpayment(h, p.orderId)
}

const complete: Handler<'order.complete'> = async (h, p) => {
  const { ctx, tx } = h
  const order = await lockForSync(h, p.orderId)
  if (order.status === 'COMPLETED') return
  if (order.status === 'VOIDED') throw new SyncConflict('The order was voided')
  const current = await loadOrder(ctx, tx, p.orderId)
  if (!current.lines.some((l) => l.voidedAt === null)) {
    throw new SyncConflict('The order has no lines')
  }
  if (current.balanceDueMinor > 0) {
    throw new SyncConflict('The order has an unpaid balance', 'PAYMENT_MISMATCH', {
      balanceDueMinor: current.balanceDueMinor,
    })
  }
  await tx.order.update({
    where: { id: p.orderId },
    data: {
      status: 'COMPLETED',
      completedAt: asDate(p.completedAt, h.mutation.clientTs),
      completedBy: ctx.actor,
    },
  })
  await emit(ctx, tx, 'order.completed', p.orderId)
}

const voidOrder: Handler<'order.void'> = async (h, p) => {
  const { ctx, tx } = h
  const order = await lockForSync(h, p.orderId)
  if (order.status === 'VOIDED') return
  if (order.status === 'COMPLETED') throw new SyncConflict('The order was already completed')
  checkBaseVersion(h, order)
  if ((await committedMinor(tx, p.orderId)) > 0) {
    throw new SyncConflict('The order has payments', 'PAYMENT_MISMATCH')
  }
  const lines = await tx.orderLine.findMany({
    where: { orderId: p.orderId, voidedAt: null },
    select: { id: true },
  })
  await restockLines(
    ctx,
    tx,
    lines.map((l) => l.id),
    'VOID',
  )
  await tx.order.update({
    where: { id: p.orderId },
    data: {
      status: 'VOIDED',
      voidedAt: new Date(h.mutation.clientTs),
      voidedBy: ctx.actor,
      voidReason: p.reason,
    },
  })
  await emit(ctx, tx, 'order.voided', p.orderId)
}

const handlers: { [T in SyncMutationType]: Handler<T> } = {
  'order.open': openOrder,
  'order.add_lines': addLines,
  'order.void_line': voidLine,
  'order.pay': pay,
  'order.complete': complete,
  'order.void': voidOrder,
}

// ── push ────────────────────────────────────────────────────────────────────

async function createReviews(
  tx: TenantTx,
  ctx: TenantContext,
  syncMutationId: string,
  reviews: Review[],
): Promise<string[]> {
  const ids: string[] = []
  for (const review of reviews) {
    const id = uuidv7()
    await tx.reviewItem.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        syncMutationId,
        kind: review.kind,
        subjectType: review.subjectType,
        subjectId: review.subjectId,
        details: review.details as Prisma.InputJsonValue,
      },
    })
    ids.push(id)
  }
  return ids
}

async function duplicateOf(ctx: TenantContext, id: string): Promise<SyncMutationResult | null> {
  const existing = await ctx.db.syncMutation.findUnique({
    where: { tenantId_id: { tenantId: ctx.tenantId, id } },
    select: { status: true, reviewItems: { select: { id: true }, orderBy: { id: 'asc' } } },
  })
  if (!existing) return null
  return {
    id,
    status: 'DUPLICATE',
    original: existing.status,
    reviewItemIds: existing.reviewItems.map((r) => r.id),
  }
}

function subjectOf(mutation: SyncMutation): { subjectType: string; subjectId: string } {
  const orderId = (mutation.payload as { orderId?: unknown } | null)?.orderId
  if (typeof orderId === 'string' && /^[0-9a-f-]{36}$/i.test(orderId)) {
    return { subjectType: 'order', subjectId: orderId }
  }
  return { subjectType: 'sync_mutation', subjectId: mutation.id }
}

/** Store a mutation that wasn't applied, with a review item holding its payload. */
async function recordUnapplied(
  ctx: TenantContext,
  terminal: TerminalIdentity,
  mutation: SyncMutation,
  status: 'CONFLICT' | 'REJECTED',
  kind: ReviewKind,
  message: string,
  details: Record<string, unknown>,
): Promise<SyncMutationResult> {
  try {
    return await ctx.db.$transaction(async (tx) => {
      await tx.syncMutation.create({
        data: {
          id: mutation.id,
          tenantId: ctx.tenantId,
          terminalId: terminal.id,
          type: mutation.type,
          payload: (mutation.payload ?? null) as Prisma.InputJsonValue,
          clientTs: new Date(mutation.clientTs),
          status,
          result: { message, ...details } as Prisma.InputJsonValue,
        },
      })
      const reviewItemIds = await createReviews(tx, ctx, mutation.id, [
        {
          kind,
          ...subjectOf(mutation),
          details: {
            reason: status === 'CONFLICT' ? 'conflict' : 'rejected',
            message,
            ...details,
            type: mutation.type,
            baseVersion: mutation.baseVersion ?? null,
            payload: mutation.payload ?? null,
          },
        },
      ])
      return { id: mutation.id, status, reviewItemIds, message }
    })
  } catch (error) {
    const duplicate = await duplicateOf(ctx, mutation.id)
    if (duplicate) return duplicate
    throw error
  }
}

async function applyMutation(
  ctx: TenantContext,
  terminal: TerminalIdentity,
  mutation: SyncMutation,
): Promise<SyncMutationResult> {
  const duplicate = await duplicateOf(ctx, mutation.id)
  if (duplicate) return duplicate

  const type = SyncMutationType.safeParse(mutation.type)
  if (!type.success) {
    return recordUnapplied(
      ctx,
      terminal,
      mutation,
      'REJECTED',
      'SYNC_CONFLICT',
      `Unknown mutation type "${mutation.type}"`,
      {},
    )
  }
  const payload = SyncPayloads[type.data].safeParse(mutation.payload)
  if (!payload.success) {
    return recordUnapplied(
      ctx,
      terminal,
      mutation,
      'REJECTED',
      'SYNC_CONFLICT',
      'Invalid payload',
      {
        issues: payload.error.issues,
      },
    )
  }

  try {
    return await ctx.db.$transaction(async (tx) => {
      // Claims the id first: a concurrent push of the same mutation waits here, then fails.
      await tx.syncMutation.create({
        data: {
          id: mutation.id,
          tenantId: ctx.tenantId,
          terminalId: terminal.id,
          type: type.data,
          payload: payload.data as Prisma.InputJsonValue,
          clientTs: new Date(mutation.clientTs),
          status: 'APPLIED',
        },
      })
      const h: HandlerContext = { ctx, tx, terminal, mutation, reviews: [] }
      await (handlers[type.data] as Handler<typeof type.data>)(h, payload.data as never)
      const reviewItemIds = await createReviews(tx, ctx, mutation.id, h.reviews)
      return { id: mutation.id, status: 'APPLIED' as const, reviewItemIds }
    })
  } catch (error) {
    const duplicate = await duplicateOf(ctx, mutation.id)
    if (duplicate) return duplicate
    if (error instanceof SyncConflict) {
      return recordUnapplied(
        ctx,
        terminal,
        mutation,
        'CONFLICT',
        error.kind,
        error.message,
        error.details,
      )
    }
    const http = toHttpError(error)
    if (http.status >= 500) throw error
    return recordUnapplied(ctx, terminal, mutation, 'REJECTED', 'SYNC_CONFLICT', http.message, {
      code: http.code,
      ...(http.details === undefined ? {} : { details: http.details }),
    })
  }
}

/** Apply a batch in order. Results line up with the input. */
export async function pushMutations(
  ctx: TenantContext,
  terminal: TerminalIdentity,
  mutations: SyncMutation[],
) {
  const results: SyncMutationResult[] = []
  for (const mutation of mutations) results.push(await applyMutation(ctx, terminal, mutation))
  return { results }
}

// ── pull ────────────────────────────────────────────────────────────────────

const loaders: Record<
  ChangeEntity,
  (ctx: TenantContext, id: string, storeId: string | null) => Promise<unknown>
> = {
  store: (ctx, id) => getStore(ctx, id),
  tax_rate: (ctx, id) => getTaxRate(ctx, id),
  category: (ctx, id) => getCategory(ctx, id),
  item: (ctx, id) => getItem(ctx, id),
  modifier_group: (ctx, id) => getModifierGroup(ctx, id),
  stock_level: (ctx, id) => getStockLevel(ctx, id),
  store_item: async (ctx, itemId, storeId) =>
    storeId
      ? ctx.db.storeItem.findUnique({
          where: { tenantId_storeId_itemId: { tenantId: ctx.tenantId, storeId, itemId } },
          select: { storeId: true, itemId: true, available: true, priceOverrideMinor: true },
        })
      : null,
}

function parseCursor(cursor: string | undefined): [string, string] {
  if (!cursor) return ['0', '0']
  const match = /^(\d{1,20})\.(\d{1,20})$/.exec(cursor)
  if (!match) throw new HttpError(400, 'validation_error', 'Invalid cursor')
  return [match[1] as string, match[2] as string]
}

interface ChangeRow {
  seq: string
  txid: string
  entity: ChangeEntity
  entity_id: string
  store_id: string | null
  op: 'upsert' | 'archive' | 'restore'
}

/**
 * The catalog change feed, oldest first, with each entity's current state. Rows are read in
 * `(txid, seq)` order and only from transactions older than every one still running, so a slow
 * transaction can never commit behind the cursor (see the ChangeLog model).
 */
export async function pullChanges(ctx: TenantContext, query: SyncPullQuery) {
  const [txid, seq] = parseCursor(query.cursor)
  const rows = await ctx.db.$queryRaw<ChangeRow[]>`
    SELECT seq::text AS seq, txid::text AS txid, entity, entity_id::text AS entity_id,
           store_id::text AS store_id, op
    FROM tala.change_log
    WHERE tenant_id = ${ctx.tenantId}::uuid
      AND (txid, seq) > (${txid}::xid8, ${seq}::bigint)
      AND txid < pg_snapshot_xmin(pg_current_snapshot())
    ORDER BY txid, seq
    LIMIT ${query.limit}`

  // Latest change per entity, in the order of that latest change.
  const latest = new Map<string, ChangeRow>()
  for (const row of rows) {
    const key = `${row.entity}/${row.entity_id}/${row.store_id ?? ''}`
    latest.delete(key)
    latest.set(key, row)
  }

  const changes = []
  for (const row of latest.values()) {
    if (row.store_id && !canAccessStore(ctx, row.store_id)) continue
    let data: unknown
    try {
      data = await loaders[row.entity](ctx, row.entity_id, row.store_id)
    } catch (error) {
      const http = toHttpError(error)
      if (http.status === 403 || http.status === 404) continue // another store's, or gone
      throw error
    }
    if (data === null) continue
    changes.push({ entity: row.entity, id: row.entity_id, op: row.op, data })
  }

  const last = rows.at(-1)
  return {
    changes,
    cursor: last ? `${last.txid}.${last.seq}` : `${txid}.${seq}`,
    hasMore: rows.length === query.limit,
  }
}
