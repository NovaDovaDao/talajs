import { describe, expect, it } from 'vitest'
import { tenantWithOwner } from './helpers.js'

async function setup() {
  const t = await tenantWithOwner()
  const api = t.as(t.owner.caller)
  const store = (await api.post('/stores', { name: 'Main', slug: 'main', currency: 'USD' })).body
  const level = (
    await api.post('/stock-levels', { storeId: store.id, name: 'Croissants', onHand: 10 })
  ).body
  return { t, api, store, level }
}

describe('stock levels', () => {
  it('records the initial count and every adjustment in the ledger', async () => {
    const { api, level } = await setup()
    expect(level.onHand).toBe(10)

    const received = await api.post(`/stock-levels/${level.id}/adjustments`, {
      reason: 'RECEIVE',
      delta: 5,
    })
    expect(received.status).toBe(201)
    expect(received.body.stockLevel.onHand).toBe(15)

    const recount = await api.post(`/stock-levels/${level.id}/adjustments`, {
      reason: 'RECOUNT',
      count: 12,
      note: 'Morning count',
    })
    expect(recount.body.movement).toMatchObject({
      reason: 'RECOUNT',
      delta: -3,
      note: 'Morning count',
    })

    const ledger = await api.get(`/stock-levels/${level.id}/movements`)
    expect(
      ledger.body.data.map((m: { reason: string; delta: number }) => [m.reason, m.delta]),
    ).toEqual([
      ['RECOUNT', -3],
      ['RECEIVE', 5],
      ['RECOUNT', 10],
    ])
  })

  it('refuses to take strictly tracked stock below zero', async () => {
    const { api, level, store } = await setup()
    const res = await api.post(`/stock-levels/${level.id}/adjustments`, {
      reason: 'ADJUST',
      delta: -11,
    })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('insufficient_stock')
    expect((await api.get(`/stock-levels/${level.id}`)).body.onHand).toBe(10)

    const loose = (
      await api.post('/stock-levels', { storeId: store.id, name: 'Milk', trackStrictly: false })
    ).body
    const neg = await api.post(`/stock-levels/${loose.id}/adjustments`, {
      reason: 'ADJUST',
      delta: -2,
    })
    expect(neg.body.stockLevel.onHand).toBe(-2)
  })

  it('has no direct way to set on-hand', async () => {
    const { api, level } = await setup()
    const res = await api.patch(`/stock-levels/${level.id}`, {
      name: 'Butter croissants',
      onHand: 999,
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ name: 'Butter croissants', onHand: 10 })
  })

  it('concurrent adjustments never lose updates', async () => {
    const { api, level } = await setup()
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        api.post(`/stock-levels/${level.id}/adjustments`, { reason: 'ADJUST', delta: -1 }),
      ),
    )
    expect(results.every((r) => r.status === 201)).toBe(true)
    expect((await api.get(`/stock-levels/${level.id}`)).body.onHand).toBe(0)
  })

  it('limits store-restricted members to their stores', async () => {
    const { t, api, level } = await setup()
    const other = (await api.post('/stores', { name: 'Kiosk', slug: 'kiosk', currency: 'USD' }))
      .body
    const kioskStaff = await t.member('STAFF', [other.id])
    const as = t.as(kioskStaff.caller)

    expect((await as.get(`/stock-levels/${level.id}`)).status).toBe(403)
    expect((await as.get('/stock-levels')).body.data).toEqual([])
    expect((await as.get('/stores')).body.data.map((s: { slug: string }) => s.slug)).toEqual([
      'kiosk',
    ])
    expect(
      (await as.post(`/stock-levels/${level.id}/adjustments`, { reason: 'RECEIVE', delta: 1 }))
        .status,
    ).toBe(403)
  })
})
