import { env } from 'cloudflare:workers'
import { type TalaEvent, uuidv7 } from '@talajs/contracts'
import { describe, expect, it } from 'vitest'
import { ResendError, resend } from '../src/email/resend.js'
import {
  createTalaConsumer,
  type EmailMessage,
  type EventQueue,
  type QueueMessage,
  redeliverEvents,
} from '../src/index.js'
import { cafe } from './fixtures.js'
import { createTestApp, testDb } from './helpers.js'

const queued: string[] = []
const queue: EventQueue = {
  async sendBatch(messages) {
    for (const m of messages) queued.push(m.body.eventId)
  },
}
const target = createTestApp({ events: { queue } })

const db = testDb(env)

function message(eventId: string) {
  const state = { acked: false, retried: null as null | { delaySeconds?: number } }
  const msg: QueueMessage = {
    body: { eventId },
    attempts: 1,
    ack: () => {
      state.acked = true
    },
    retry: (options) => {
      state.retried = options ?? {}
    },
  }
  return { msg, state }
}

/** A completed order for a customer; returns the ids of the events its requests queued. */
async function completedOrder(email: string | null = 'ada@example.com') {
  const ctx = await cafe({ target })
  const { api, store, ids } = ctx
  const customer = (await api.post('/customers', { name: 'Ada', email })).body
  const before = queued.length
  const order = (
    await api.post('/orders', {
      storeId: store.id,
      customerId: customer.id,
      lines: [{ variantId: ids.croissant, quantity: 2, note: '<b>warm</b>' }],
    })
  ).body
  await api.post(`/orders/${order.id}/payments`, { method: 'CASH', amountMinor: order.totalMinor })
  await api.post(`/orders/${order.id}/complete`, {})
  return { ...ctx, order, eventIds: queued.slice(before) }
}

async function eventsOf(orderId: string) {
  return db.client.domainEvent.findMany({ where: { orderId }, orderBy: { id: 'asc' } })
}

describe('domain events', () => {
  it('writes events in the same transaction and queues them after the response', async () => {
    const { order, eventIds } = await completedOrder()
    const rows = await eventsOf(order.id)
    expect(rows.map((r) => r.type)).toEqual(['payment.succeeded', 'order.completed'])
    expect(eventIds).toEqual(rows.map((r) => r.id))
    expect(rows[0]?.payload).toEqual({ paymentId: expect.any(String) })
  })

  it('queues nothing for a failed request', async () => {
    const { api, order } = await completedOrder()
    const before = queued.length
    expect((await api.post(`/orders/${order.id}/complete`, {})).status).toBe(409)
    expect(queued.length).toBe(before)
  })
})

describe('event consumer', () => {
  function consumer(onEvent?: (e: TalaEvent) => Promise<void>) {
    const sent: EmailMessage[] = []
    const handler = createTalaConsumer<Cloudflare.Env>({
      db: testDb,
      hooks: { onEvent: onEvent ?? (async () => {}) },
      receipts: {
        mailer: {
          async send(m) {
            sent.push(m)
            return { id: `email-${sent.length}` }
          },
        },
      },
    })
    return { sent, run: (...msgs: QueueMessage[]) => handler({ messages: msgs }, env) }
  }

  it('emails one receipt, runs the hook and marks events processed', async () => {
    const { order, eventIds } = await completedOrder()
    const seen: TalaEvent[] = []
    const { sent, run } = consumer(async (e) => {
      seen.push(e)
    })
    const messages = eventIds.map((id) => message(id))
    await run(...messages.map((m) => m.msg))
    expect(messages.every((m) => m.state.acked)).toBe(true)
    expect(seen.map((e) => e.type)).toEqual(['payment.succeeded', 'order.completed'])
    expect(seen[1]).toMatchObject({ orderId: order.id, tenantId: expect.any(String) })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to: 'ada@example.com',
      subject: `Your receipt from Main (order ${order.number})`,
      idempotencyKey: `tala-receipt/${order.id}`,
    })
    expect(sent[0]?.text).toContain('2 × Croissant Regular  $7.00')
    expect(sent[0]?.text).toContain('Total: $7.58')
    expect(sent[0]?.html).not.toContain('<b>warm</b>')

    const rows = await eventsOf(order.id)
    expect(rows.every((r) => r.processedAt !== null && r.attempts === 1)).toBe(true)
    const reread = await db.client.order.findUnique({ where: { id: order.id } })
    expect(reread?.receiptSentAt).not.toBeNull()

    // Redelivery is acknowledged and skipped: no second email, no second hook call.
    const again = message(eventIds[1] as string)
    await run(again.msg)
    expect(again.state.acked).toBe(true)
    expect(sent).toHaveLength(1)
    expect(seen).toHaveLength(2)
  })

  it('retries when a hook fails, recording the error', async () => {
    const { order, eventIds } = await completedOrder(null)
    const failing = consumer(async () => {
      throw new Error('webhook to ERP failed')
    })
    const first = message(eventIds[1] as string)
    await failing.run(first.msg)
    expect(first.state).toMatchObject({ acked: false, retried: { delaySeconds: 10 } })
    const [, completed] = await eventsOf(order.id)
    expect(completed).toMatchObject({ processedAt: null, attempts: 1 })
    expect(completed?.lastError).toContain('webhook to ERP failed')

    const ok = consumer()
    const second = message(eventIds[1] as string)
    await ok.run(second.msg)
    expect(second.state.acked).toBe(true)
    expect(ok.sent).toHaveLength(0) // the customer has no email
    expect((await eventsOf(order.id))[1]).toMatchObject({ attempts: 2, lastError: null })
  })

  it('skips events that never committed and malformed messages', async () => {
    const { run } = consumer()
    const ghost = message(uuidv7())
    const junk: QueueMessage = { ...message(uuidv7()).msg, body: { nope: 1 } }
    let junkAcked = false
    junk.ack = () => {
      junkAcked = true
    }
    await run(ghost.msg, junk)
    expect(ghost.state.acked).toBe(true)
    expect(junkAcked).toBe(true)
  })

  it('redelivers unprocessed events', async () => {
    const { order } = await completedOrder()
    const resent: string[] = []
    const count = await redeliverEvents({
      db,
      queue: {
        async sendBatch(ms) {
          for (const m of ms) resent.push(m.body.eventId)
        },
      },
      olderThanSeconds: 0,
      limit: 1000,
    })
    expect(count).toBeGreaterThan(0)
    const ids = (await eventsOf(order.id)).map((r) => r.id)
    expect(resent).toEqual(expect.arrayContaining(ids))
  })
})

describe('resend mailer', () => {
  it('posts to the Resend API with an idempotency key', async () => {
    const requests: Request[] = []
    const mailer = resend({
      apiKey: 're_test',
      from: 'Café <receipts@cafe.test>',
      fetch: async (input, init) => {
        requests.push(new Request(input, init))
        return Response.json({ id: 'em_123' })
      },
    })
    const result = await mailer.send({
      to: 'ada@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
      idempotencyKey: 'tala-receipt/1',
    })
    expect(result).toEqual({ id: 'em_123' })
    const req = requests[0] as Request
    expect(req.url).toBe('https://api.resend.com/emails')
    expect(req.headers.get('authorization')).toBe('Bearer re_test')
    expect(req.headers.get('idempotency-key')).toBe('tala-receipt/1')
    expect(await req.json()).toEqual({
      from: 'Café <receipts@cafe.test>',
      to: 'ada@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    })
  })

  it('throws on API errors so the queue retries', async () => {
    const mailer = resend({
      apiKey: 're_test',
      from: 'x@cafe.test',
      fetch: async () =>
        Response.json({ name: 'rate_limit_exceeded', message: 'Slow down' }, { status: 429 }),
    })
    const error = await mailer
      .send({ to: 'a@b.test', subject: 's', html: '', text: '' })
      .catch((e) => e)
    expect(error).toBeInstanceOf(ResendError)
    expect(error).toMatchObject({ status: 429, code: 'rate_limit_exceeded' })
  })
})
