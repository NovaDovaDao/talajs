import { z } from 'zod'
import { Id } from '../ids.js'
import { Timestamp } from './common.js'

/**
 * Domain events, delivered to `hooks.onEvent` after the change has committed. Delivery is
 * at least once: a hook can see the same event again after a failure, so key side effects on
 * `event.id`.
 */
export const EventType = z.enum([
  'order.completed',
  'order.voided',
  'payment.succeeded',
  'payment.failed',
  'refund.succeeded',
])
export type EventType = z.infer<typeof EventType>

export const TalaEvent = z
  .object({
    id: Id,
    tenantId: Id,
    type: EventType,
    orderId: Id.nullable(),
    /** Type-specific details, e.g. `{ paymentId }` or `{ refundId }`. */
    payload: z.record(z.string(), z.unknown()),
    createdAt: Timestamp,
  })
  .meta({ id: 'Event' })
export type TalaEvent = z.infer<typeof TalaEvent>

/** The body of a queue message. The event itself is read from the database. */
export const EventMessage = z.object({ eventId: Id })
export type EventMessage = z.infer<typeof EventMessage>
