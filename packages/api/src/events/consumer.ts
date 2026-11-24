import { EventMessage, type TalaEvent } from '@talajs/contracts'
import type { TalaDb } from '@talajs/db'
import { type ReceiptData, type RenderedEmail, renderReceipt } from '../email/receipt.js'
import type { Mailer } from '../email/types.js'
import { type Configurable, resolveConfig } from '../types.js'
import type { EventQueue } from './publish.js'

/** Structurally compatible with Cloudflare's `Message` and `MessageBatch`. */
export interface QueueMessage {
  readonly body: unknown
  readonly attempts: number
  ack(): void
  retry(options?: { delaySeconds?: number }): void
}
export interface QueueBatch {
  readonly messages: readonly QueueMessage[]
}

export interface TalaHooks<E> {
  /**
   * Called once per event after it has committed. At least once: after a failure (yours or a
   * receipt's) the event is retried, so key side effects on `event.id`.
   */
  onEvent?(event: TalaEvent, env: E): Promise<void> | void
}

export interface ReceiptOptions<E> {
  /** `null` turns receipts off, e.g. when the API key isn't set in this environment. */
  mailer: Configurable<Mailer | null, E>
  /** Replace the built-in receipt layout. */
  render?(data: ReceiptData): RenderedEmail
}

export interface TalaConsumerOptions<E> {
  db: (env: E) => TalaDb
  hooks?: TalaHooks<E>
  /** Email a receipt when an order with a customer email completes. */
  receipts?: ReceiptOptions<E>
}

/** Seconds to wait before retry n (1-based): 10s, 20s, 40s, … capped at 15 minutes. */
const backoff = (attempts: number) => Math.min(10 * 2 ** Math.max(attempts - 1, 0), 900)

/**
 * The queue consumer for Tala's domain events. Export it as your Worker's `queue` handler:
 *
 *     export default { fetch: app.fetch, queue: createTalaConsumer({ db, hooks, receipts }) }
 *
 * Each event is processed until it succeeds once: receipts are sent, `hooks.onEvent` runs, and
 * the outbox row is marked processed. Events already processed, or whose transaction rolled
 * back, are acknowledged and skipped.
 */
export function createTalaConsumer<E>(options: TalaConsumerOptions<E>) {
  return async (batch: QueueBatch, env: E): Promise<void> => {
    const db = options.db(env)
    try {
      for (const message of batch.messages) {
        const parsed = EventMessage.safeParse(message.body)
        if (!parsed.success) {
          console.error('tala: dropping malformed event message', message.body)
          message.ack()
          continue
        }
        const { eventId } = parsed.data
        const row = await db.client.domainEvent.findUnique({ where: { id: eventId } })
        if (!row || row.processedAt) {
          message.ack()
          continue
        }
        try {
          const event: TalaEvent = {
            id: row.id,
            tenantId: row.tenantId,
            type: row.type as TalaEvent['type'],
            orderId: row.orderId,
            payload: (row.payload ?? {}) as Record<string, unknown>,
            createdAt: row.createdAt.toISOString(),
          }
          if (options.receipts && event.type === 'order.completed' && event.orderId) {
            await sendReceipt(db, env, options.receipts, event.tenantId, event.orderId)
          }
          await options.hooks?.onEvent?.(event, env)
          await db.client.domainEvent.update({
            where: { id: eventId },
            data: { processedAt: new Date(), attempts: { increment: 1 }, lastError: null },
          })
          message.ack()
        } catch (error) {
          console.error(`tala: event ${eventId} (${row.type}) failed`, error)
          await db.client.domainEvent.update({
            where: { id: eventId },
            data: { attempts: { increment: 1 }, lastError: String(error).slice(0, 1000) },
          })
          message.retry({ delaySeconds: backoff(message.attempts) })
        }
      }
    } finally {
      await db.dispose()
    }
  }
}

/**
 * Send the order's receipt unless it has been sent. The idempotency key covers a crash between
 * sending and recording `receipt_sent_at`.
 */
async function sendReceipt<E>(
  db: TalaDb,
  env: E,
  receipts: ReceiptOptions<E>,
  tenantId: string,
  orderId: string,
) {
  const order = await db.client.order.findUnique({
    where: { id: orderId },
    select: {
      tenantId: true,
      id: true,
      number: true,
      currency: true,
      subtotalMinor: true,
      taxMinor: true,
      totalMinor: true,
      tipMinor: true,
      completedAt: true,
      receiptSentAt: true,
      customer: { select: { email: true } },
      tenant: { select: { name: true } },
      store: { select: { name: true, timezone: true } },
      lines: {
        where: { voidedAt: null },
        orderBy: { id: 'asc' },
        select: {
          itemName: true,
          variantName: true,
          quantity: true,
          lineTotalMinor: true,
          modifiers: { select: { name: true }, orderBy: { id: 'asc' } },
        },
      },
      payments: {
        where: { status: 'SUCCESS' },
        orderBy: { id: 'asc' },
        select: { method: true, amountMinor: true, tipMinor: true },
      },
    },
  })
  if (!order || order.tenantId !== tenantId || order.receiptSentAt) return
  const to = order.customer?.email
  const mailer = resolveConfig(receipts.mailer, env)
  if (!to || !mailer) return

  const { tenant, store, customer, receiptSentAt, tenantId: _, ...rest } = order
  const email = (receipts.render ?? renderReceipt)({
    tenantName: tenant.name,
    storeName: store.name,
    timezone: store.timezone,
    order: rest,
  })
  await mailer.send({
    to,
    ...email,
    idempotencyKey: `tala-receipt/${order.id}`,
  })
  await db.client.order.updateMany({
    where: { id: orderId, receiptSentAt: null },
    data: { receiptSentAt: new Date() },
  })
}

export interface RedeliverOptions {
  db: TalaDb
  queue: EventQueue
  /** Only events at least this old, so in-flight ones aren't doubled (default 300). */
  olderThanSeconds?: number
  /** Give up on events that have failed this many times (default 10). */
  maxAttempts?: number
  limit?: number
}

/**
 * Re-queue outbox events that were never processed: the queue send failed, or every retry
 * failed. Run it from a Cron Trigger. Returns how many were queued.
 */
export async function redeliverEvents(options: RedeliverOptions): Promise<number> {
  const cutoff = new Date(Date.now() - (options.olderThanSeconds ?? 300) * 1000)
  const rows = await options.db.client.domainEvent.findMany({
    where: {
      processedAt: null,
      createdAt: { lt: cutoff },
      attempts: { lt: options.maxAttempts ?? 10 },
    },
    orderBy: { createdAt: 'asc' },
    take: options.limit ?? 100,
    select: { id: true },
  })
  if (rows.length > 0) await options.queue.sendBatch(rows.map((r) => ({ body: { eventId: r.id } })))
  return rows.length
}
