import { type EventMessage, type EventType, uuidv7 } from '@talajs/contracts'
import { createMiddleware } from 'hono/factory'
import type { Configurable, TalaEnv, TenantContext, TenantTx } from '../types.js'
import { resolveConfig } from '../types.js'

/** The producer side of a Cloudflare Queue (structurally compatible with `Queue<EventMessage>`). */
export interface EventQueue {
  sendBatch(messages: Iterable<{ body: EventMessage }>): Promise<unknown>
}

/**
 * Record a domain event in the outbox, inside the caller's transaction. It's queued once the
 * request succeeds. If the transaction rolls back, the queued id points at nothing and the
 * consumer skips it.
 */
export async function emit(
  ctx: TenantContext,
  tx: TenantTx,
  type: EventType,
  orderId: string | null,
  payload: Record<string, string | number | boolean | null> = {},
) {
  const id = uuidv7()
  await tx.domainEvent.create({ data: { id, tenantId: ctx.tenantId, type, orderId, payload } })
  ctx.events.push(id)
}

/** After a successful response, send the request's events to the queue (if one is configured). */
export function publishEvents<E>(queue: Configurable<EventQueue, E> | undefined) {
  return createMiddleware<TalaEnv<E>>(async (c, next) => {
    await next()
    const ids = c.get('tenant')?.events
    if (!queue || !ids?.length || c.res.status >= 400) return
    const sent = resolveConfig(queue, c.env)
      .sendBatch(ids.map((eventId) => ({ body: { eventId } })))
      // Not fatal: unsent events stay unprocessed in the outbox for `redeliverEvents`.
      .catch((error: unknown) => console.error('tala: failed to queue events', error))
    try {
      c.executionCtx.waitUntil(sent)
    } catch {
      await sent
    }
  })
}
