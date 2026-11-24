import { uuidv7 } from '@talajs/contracts'
import { describe, expect, it } from 'vitest'
import type { ChargeRequest, PaymentAdapter, RefundRequest } from '../src/index.js'
import { cafe } from './fixtures.js'
import { createTestApp } from './helpers.js'

// A fake card processor. The amount picks the outcome: 13 is declined, 66 throws.
const charges: ChargeRequest[] = []
const refunds: RefundRequest[] = []
const card: PaymentAdapter = {
  id: 'fakecard',
  methods: ['CARD'],
  async charge(request) {
    charges.push(request)
    if (request.amountMinor === 66) throw new Error('processor down')
    if (request.amountMinor === 13) return { status: 'FAILED', failureReason: 'Card declined' }
    return { status: 'SUCCESS', externalId: `ch_${request.paymentId}` }
  },
  async refund(request) {
    refunds.push(request)
    return { status: 'SUCCESS', externalId: `re_${request.refundId}` }
  },
}
const target = createTestApp({ payments: [card] })

/** A completed order: 2 croissants (700 + 58 tax = 758), paid in cash. */
async function paidOrder() {
  const ctx = await cafe({ target })
  const { api, store, ids } = ctx
  const order = (
    await api.post('/orders', {
      storeId: store.id,
      lines: [
        { variantId: ids.croissant, quantity: 2 },
        { variantId: ids.latte12, modifierIds: [ids.single] },
      ],
    })
  ).body
  const paid = (
    await api.post(`/orders/${order.id}/payments`, {
      method: 'CASH',
      amountMinor: order.totalMinor,
    })
  ).body
  await api.post(`/orders/${order.id}/complete`, {})
  return { ...ctx, order: paid, payment: paid.payments[0] }
}

describe('cash refunds', () => {
  it('refunds part of a payment and restocks the named lines once', async () => {
    const { api, order, payment, croissants, onHand, t } = await paidOrder()
    expect(order.totalMinor).toBe(1245)
    expect(await onHand(croissants.id)).toBe(3)
    const croissantLine = order.lines[0].id

    const staff = t.as((await t.member('STAFF')).caller)
    expect(
      (
        await staff.post(`/orders/${order.id}/refunds`, {
          paymentId: payment.id,
          amountMinor: 100,
          reason: 'x',
        })
      ).status,
    ).toBe(403)

    const refundId = uuidv7()
    const body = {
      id: refundId,
      paymentId: payment.id,
      amountMinor: 758,
      reason: 'Stale',
      lineIds: [croissantLine],
      restock: true,
    }
    const res = await api.post(`/orders/${order.id}/refunds`, body)
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      status: 'COMPLETED',
      paidMinor: 487,
      refundedMinor: 758,
      balanceDueMinor: 0,
    })
    expect(res.body.refunds).toEqual([
      expect.objectContaining({
        id: refundId,
        paymentId: payment.id,
        status: 'SUCCESS',
        amountMinor: 758,
        lineIds: [croissantLine],
        restock: true,
      }),
    ])
    expect(await onHand(croissants.id)).toBe(5)
    const ledger = (await api.get(`/stock-levels/${croissants.id}/movements`)).body.data
    expect(ledger[0]).toMatchObject({ reason: 'REFUND', delta: 2, orderLineId: croissantLine })

    // A retry returns the same order; nothing is refunded or restocked twice.
    const replay = await api.post(`/orders/${order.id}/refunds`, body)
    expect(replay.status).toBe(200)
    expect(replay.body.refunds).toHaveLength(1)

    // Refunding the same line again (new id) doesn't restock it again.
    await api.post(`/orders/${order.id}/refunds`, { ...body, id: uuidv7(), amountMinor: 1 })
    expect(await onHand(croissants.id)).toBe(5)

    const tooMuch = await api.post(`/orders/${order.id}/refunds`, {
      paymentId: payment.id,
      amountMinor: 487,
      reason: 'Everything',
    })
    expect(tooMuch.status).toBe(422)
    expect(tooMuch.body.error.details).toEqual({ refundableMinor: 486 })
  })

  it('validates the payment and lines', async () => {
    const { api, order, payment } = await paidOrder()
    const refund = (b: object) =>
      api.post(`/orders/${order.id}/refunds`, { reason: 'x', amountMinor: 1, ...b })
    expect((await refund({ paymentId: uuidv7() })).status).toBe(404)
    expect((await refund({ paymentId: payment.id, lineIds: [uuidv7()] })).status).toBe(422)
    expect((await refund({ paymentId: payment.id, restock: true })).status).toBe(400)
  })

  it('lets an open order be voided once its payments are refunded', async () => {
    const { api, store, ids, croissants, onHand } = await cafe({ target })
    const order = (
      await api.post('/orders', { storeId: store.id, lines: [{ variantId: ids.croissant }] })
    ).body
    const paid = (
      await api.post(`/orders/${order.id}/payments`, { method: 'CASH', amountMinor: 200 })
    ).body
    expect((await api.post(`/orders/${order.id}/void`, { reason: 'Left' })).status).toBe(409)
    const refunded = await api.post(`/orders/${order.id}/refunds`, {
      paymentId: paid.payments[0].id,
      amountMinor: 200,
      reason: 'Left',
    })
    expect(refunded.body).toMatchObject({ paidMinor: 0, balanceDueMinor: 379 })
    const voided = await api.post(`/orders/${order.id}/void`, { reason: 'Left' })
    expect(voided.body.status).toBe('VOIDED')
    expect(await onHand(croissants.id)).toBe(5)
    expect(
      (
        await api.post(`/orders/${order.id}/refunds`, {
          paymentId: paid.payments[0].id,
          amountMinor: 1,
          reason: 'x',
        })
      ).status,
    ).toBe(409)
  })
})

describe('payment adapters', () => {
  async function openOrder() {
    const ctx = await cafe({ target })
    const order = (
      await ctx.api.post('/orders', {
        storeId: ctx.store.id,
        lines: [{ variantId: ctx.ids.croissant }],
      })
    ).body
    return { ...ctx, order }
  }

  it('charges through the adapter and records the outcome', async () => {
    const { api, order, t } = await openOrder()
    const res = await api.post(`/orders/${order.id}/payments`, {
      method: 'CARD',
      amountMinor: 379,
      tipMinor: 50,
    })
    expect(res.status).toBe(201)
    const payment = res.body.payments[0]
    expect(payment).toMatchObject({
      method: 'CARD',
      provider: 'fakecard',
      status: 'SUCCESS',
      externalId: `ch_${payment.id}`,
      tipMinor: 50,
    })
    expect(res.body).toMatchObject({ paidMinor: 379, balanceDueMinor: 0, tipMinor: 50 })
    expect(charges.at(-1)).toMatchObject({
      tenantId: t.tenantId,
      orderId: order.id,
      paymentId: payment.id,
      amountMinor: 379,
      tipMinor: 50,
      currency: 'USD',
    })

    const refunded = await api.post(`/orders/${order.id}/refunds`, {
      paymentId: payment.id,
      amountMinor: 100,
      reason: 'Cold',
    })
    expect(refunded.body.refunds[0]).toMatchObject({
      status: 'SUCCESS',
      externalId: expect.stringMatching(/^re_/),
    })
    expect(refunds.at(-1)).toMatchObject({ paymentId: payment.id, externalId: `ch_${payment.id}` })
  })

  it('records declines and processor errors as failed payments', async () => {
    const { api, order } = await openOrder()
    const declined = await api.post(`/orders/${order.id}/payments`, {
      method: 'CARD',
      amountMinor: 13,
      tipMinor: 5,
    })
    expect(declined.status).toBe(201)
    expect(declined.body.payments[0]).toMatchObject({
      status: 'FAILED',
      failureReason: 'Card declined',
    })
    expect(declined.body).toMatchObject({ paidMinor: 0, balanceDueMinor: 379, tipMinor: 0 })

    const broken = await api.post(`/orders/${order.id}/payments`, {
      method: 'CARD',
      amountMinor: 66,
    })
    expect(broken.body.payments[1]).toMatchObject({ status: 'FAILED' })

    // Failed payments don't reserve the balance.
    const cash = await api.post(`/orders/${order.id}/payments`, {
      method: 'CASH',
      amountMinor: 379,
    })
    expect(cash.status).toBe(201)
    expect(
      (await api.post(`/orders/${order.id}/payments`, { method: 'CRYPTO', amountMinor: 1 })).status,
    ).toBe(422)
  })
})
