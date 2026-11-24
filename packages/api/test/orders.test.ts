import { uuidv7 } from '@talajs/contracts'
import { describe, expect, it } from 'vitest'
import { cafe } from './fixtures.js'
import { tenantWithOwner } from './helpers.js'

describe('orders', () => {
  it('snapshots lines, prices them with tax and takes stock', async () => {
    const { api, store, ids, croissants, oatMilk, onHand } = await cafe()
    const res = await api.post('/orders', {
      storeId: store.id,
      lines: [
        { variantId: ids.latte16, modifierIds: [ids.oat, ids.double], note: 'Extra hot' },
        { variantId: ids.croissant, quantity: 2, modifierIds: [] },
      ],
    })
    expect(res.status).toBe(201)
    const order = res.body
    expect(order).toMatchObject({
      number: '1',
      status: 'OPEN',
      source: 'ADMIN',
      currency: 'USD',
      version: 1,
      openedBy: expect.any(String),
    })
    expect(order.lines).toHaveLength(2)
    expect(order.lines[0]).toMatchObject({
      itemName: 'Latte',
      variantName: '16oz',
      unitPriceMinor: 525,
      modifiersTotalMinor: 175,
      lineTotalMinor: 700,
      taxRateBps: 825,
      note: 'Extra hot',
    })
    expect(
      order.lines[0].modifiers.map((m: any) => [m.groupName, m.name, m.priceDeltaMinor]),
    ).toEqual(
      expect.arrayContaining([
        ['Milk', 'Oat', 75],
        ['Shots', 'Double', 100],
      ]),
    )
    expect(order.lines[1]).toMatchObject({ quantity: 2, lineTotalMinor: 700 })
    // 1400 net, 8.25% tax rounded once: 115.5 → 116.
    expect(order).toMatchObject({
      subtotalMinor: 1400,
      taxMinor: 116,
      totalMinor: 1516,
      paidMinor: 0,
      balanceDueMinor: 1516,
    })

    expect(await onHand(croissants.id)).toBe(3)
    expect(await onHand(oatMilk.id)).toBe(1)
    const ledger = (await api.get(`/stock-levels/${croissants.id}/movements`)).body.data
    expect(ledger[0]).toMatchObject({ reason: 'SALE', delta: -2, orderLineId: order.lines[1].id })

    const second = await api.post('/orders', { storeId: store.id })
    expect(second.body.number).toBe('2')
  })

  it('extracts tax when the store prices include it', async () => {
    const { api, store, ids } = await cafe({ pricesIncludeTax: true })
    const order = (
      await api.post('/orders', {
        storeId: store.id,
        lines: [{ variantId: ids.croissant, quantity: 3 }],
      })
    ).body
    // 1050 gross at 8.25%: tax = 1050 × 825 / 10825 = 80.03 → 80.
    expect(order).toMatchObject({ subtotalMinor: 970, taxMinor: 80, totalMinor: 1050 })
  })

  it('keeps line snapshots when the catalog changes later', async () => {
    const { api, store, ids, croissant } = await cafe()
    const order = (
      await api.post('/orders', { storeId: store.id, lines: [{ variantId: ids.croissant }] })
    ).body
    await api.patch(`/items/${croissant.id}`, { name: 'Butter croissant' })
    await api.patch(`/items/${croissant.id}/variants/${ids.croissant}`, { priceMinor: 999 })
    const reread = (await api.get(`/orders/${order.id}`)).body
    expect(reread.lines[0]).toMatchObject({ itemName: 'Croissant', unitPriceMinor: 350 })
    expect(reread.totalMinor).toBe(order.totalMinor)
  })

  it('enforces modifier rules, availability and store price overrides', async () => {
    const { api, store, ids, latte } = await cafe()
    const add = (line: object) => api.post('/orders', { storeId: store.id, lines: [line] })

    const missingShots = await add({ variantId: ids.latte12, modifierIds: [] })
    expect(missingShots.status).toBe(422)
    expect(missingShots.body.error.message).toContain('Shots')
    expect(
      (await add({ variantId: ids.latte12, modifierIds: [ids.single, ids.whole, ids.oat] })).status,
    ).toBe(422)
    expect((await add({ variantId: ids.croissant, modifierIds: [ids.oat] })).status).toBe(422)
    expect((await add({ variantId: uuidv7() })).body.error.code).toBe('item_unavailable')

    await api.put(`/stores/${store.id}/items/${latte.id}`, {
      available: true,
      priceOverrideMinor: 400,
    })
    const cheaper = await add({ variantId: ids.latte16, modifierIds: [ids.single] })
    expect(cheaper.body.lines[0].unitPriceMinor).toBe(400)

    await api.put(`/stores/${store.id}/items/${latte.id}`, { available: false })
    const off = await add({ variantId: ids.latte12, modifierIds: [ids.single] })
    expect(off.status).toBe(422)
    expect(off.body.error.code).toBe('item_unavailable')

    await api.del(`/items/${latte.id}`)
    expect((await add({ variantId: ids.latte12, modifierIds: [ids.single] })).status).toBe(422)

    // Nothing was left behind by the failed creates (numbers are only used by successful ones).
    expect((await api.get('/orders')).body.data.map((o: any) => o.number)).toEqual(['1'])
  })

  it('supports custom open-price lines', async () => {
    const { api, store, tax } = await cafe()
    const order = (
      await api.post('/orders', {
        storeId: store.id,
        lines: [{ name: 'Cake slice', unitPriceMinor: 500, taxRateId: tax.id, quantity: 2 }],
      })
    ).body
    expect(order.lines[0]).toMatchObject({
      variantId: null,
      itemName: 'Cake slice',
      lineTotalMinor: 1000,
      taxRateBps: 825,
    })
    expect(order.totalMinor).toBe(1083)
  })

  it('is retry-safe: repeating a create with the same id makes one order', async () => {
    const { api, store, ids, croissants, onHand } = await cafe()
    const body = { id: uuidv7(), storeId: store.id, lines: [{ variantId: ids.croissant }] }
    expect((await api.post('/orders', body)).status).toBe(201)
    const again = await api.post('/orders', body)
    expect(again.status).toBe(200)
    expect(again.body.lines).toHaveLength(1)
    expect(await onHand(croissants.id)).toBe(4)
  })
})

describe('tabs', () => {
  it('opens, grows, takes payment and completes', async () => {
    const { api, store, ids } = await cafe()
    expect((await api.post('/orders', { storeId: store.id, isTab: true })).status).toBe(400)

    const tab = (await api.post('/orders', { storeId: store.id, isTab: true, tabName: 'Table 4' }))
      .body
    expect(tab).toMatchObject({ isTab: true, tabName: 'Table 4', totalMinor: 0, version: 1 })

    const v2 = await api.post(`/orders/${tab.id}/lines`, {
      expectedVersion: 1,
      lines: [{ variantId: ids.croissant }],
    })
    expect(v2.body).toMatchObject({ version: 2, totalMinor: 379 })

    const stale = await api.post(`/orders/${tab.id}/lines`, {
      expectedVersion: 1,
      lines: [{ variantId: ids.croissant }],
    })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toMatchObject({
      code: 'version_conflict',
      details: { currentVersion: 2 },
    })

    const v3 = (
      await api.post(`/orders/${tab.id}/lines`, {
        lines: [{ variantId: ids.latte12, modifierIds: [ids.single] }],
      })
    ).body
    expect(v3).toMatchObject({ version: 3, subtotalMinor: 800, taxMinor: 66, totalMinor: 866 })

    const early = await api.post(`/orders/${tab.id}/complete`, {})
    expect(early.status).toBe(409)
    expect(early.body.error).toMatchObject({
      code: 'balance_due',
      details: { balanceDueMinor: 866 },
    })

    expect(
      (await api.post(`/orders/${tab.id}/payments`, { method: 'CASH', amountMinor: 900 })).status,
    ).toBe(422)
    expect(
      (await api.post(`/orders/${tab.id}/payments`, { method: 'CARD', amountMinor: 100 })).status,
    ).toBe(422)

    const paymentId = uuidv7()
    const split1 = await api.post(`/orders/${tab.id}/payments`, {
      id: paymentId,
      method: 'CASH',
      amountMinor: 500,
      tipMinor: 100,
    })
    expect(split1.status).toBe(201)
    expect(split1.body).toMatchObject({ paidMinor: 500, balanceDueMinor: 366, tipMinor: 100 })
    const replay = await api.post(`/orders/${tab.id}/payments`, {
      id: paymentId,
      method: 'CASH',
      amountMinor: 500,
      tipMinor: 100,
    })
    expect(replay.status).toBe(200)
    expect(replay.body.payments).toHaveLength(1)

    await api.post(`/orders/${tab.id}/payments`, { method: 'CASH', amountMinor: 366 })
    const done = await api.post(`/orders/${tab.id}/complete`, {})
    expect(done.status).toBe(200)
    expect(done.body).toMatchObject({
      status: 'COMPLETED',
      completedAt: expect.any(String),
      paidMinor: 866,
      balanceDueMinor: 0,
      tipMinor: 100,
    })
    expect(done.body.payments.map((p: any) => [p.method, p.status, p.amountMinor])).toEqual([
      ['CASH', 'SUCCESS', 500],
      ['CASH', 'SUCCESS', 366],
    ])

    const late = await api.post(`/orders/${tab.id}/lines`, {
      lines: [{ variantId: ids.croissant }],
    })
    expect(late.status).toBe(409)
    expect(late.body.error.code).toBe('invalid_state')

    const tabs = (await api.get('/orders?isTab=true')).body.data
    expect(tabs.map((o: any) => o.id)).toEqual([tab.id])
    expect(tabs[0]).not.toHaveProperty('lines')
    expect((await api.get('/orders?status=OPEN&isTab=true')).body.data).toEqual([])
  })

  it('serialises concurrent edits from two registers', async () => {
    const { api, store, ids } = await cafe()
    const tab = (await api.post('/orders', { storeId: store.id, isTab: true, tabName: 'Bar' })).body
    // Same base version from two registers: exactly one wins.
    const results = await Promise.all(
      [0, 1].map(() =>
        api.post(`/orders/${tab.id}/lines`, {
          expectedVersion: 1,
          lines: [{ variantId: ids.latte12, modifierIds: [ids.single] }],
        }),
      ),
    )
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    // Without a base version, both apply, one after the other.
    await Promise.all(
      [0, 1].map(() =>
        api.post(`/orders/${tab.id}/lines`, {
          lines: [{ variantId: ids.latte12, modifierIds: [ids.single] }],
        }),
      ),
    )
    const final = (await api.get(`/orders/${tab.id}`)).body
    expect(final.lines).toHaveLength(3)
    expect(final.version).toBe(4)
    expect(final.totalMinor).toBe(1461) // 1350 + 8.25% (111.375 → 111)
  })
})

describe('voids', () => {
  it('voids a line, puts its stock back and reprices', async () => {
    const { api, store, ids, croissants, onHand } = await cafe()
    const order = (
      await api.post('/orders', {
        storeId: store.id,
        lines: [
          { variantId: ids.croissant, quantity: 2 },
          { variantId: ids.latte12, modifierIds: [ids.single] },
        ],
      })
    ).body
    expect(await onHand(croissants.id)).toBe(3)

    const lineId = order.lines[0].id
    const res = await api.post(`/orders/${order.id}/lines/${lineId}/void`, { reason: 'Dropped' })
    expect(res.status).toBe(200)
    expect(res.body.lines[0]).toMatchObject({
      voidReason: 'Dropped',
      voidedAt: expect.any(String),
      voidedBy: expect.any(String),
      lineTotalMinor: 700,
    })
    expect(res.body).toMatchObject({ subtotalMinor: 450, totalMinor: 487 })
    expect(await onHand(croissants.id)).toBe(5)
    const ledger = (await api.get(`/stock-levels/${croissants.id}/movements`)).body.data
    expect(ledger[0]).toMatchObject({ reason: 'VOID', delta: 2, orderLineId: lineId })

    const twice = await api.post(`/orders/${order.id}/lines/${lineId}/void`, { reason: 'Again' })
    expect(twice.status).toBe(409)
    expect(
      (await api.post(`/orders/${order.id}/lines/${uuidv7()}/void`, { reason: 'x' })).status,
    ).toBe(404)
  })

  it("won't void a line that would leave the order overpaid", async () => {
    const { api, store, ids } = await cafe()
    const order = (
      await api.post('/orders', { storeId: store.id, lines: [{ variantId: ids.croissant }] })
    ).body
    await api.post(`/orders/${order.id}/payments`, { method: 'CASH', amountMinor: 379 })
    const res = await api.post(`/orders/${order.id}/lines/${order.lines[0].id}/void`, {
      reason: 'Changed mind',
    })
    expect(res.status).toBe(409)
    expect((await api.get(`/orders/${order.id}`)).body.lines[0].voidedAt).toBeNull()
  })

  it('voids an unpaid order and restocks every line, but not a paid one', async () => {
    const { api, store, ids, croissants, onHand } = await cafe()
    const order = (
      await api.post('/orders', {
        storeId: store.id,
        lines: [{ variantId: ids.croissant, quantity: 3 }],
      })
    ).body
    const voided = await api.post(`/orders/${order.id}/void`, { reason: 'Walked out' })
    expect(voided.body).toMatchObject({ status: 'VOIDED', voidReason: 'Walked out' })
    expect(await onHand(croissants.id)).toBe(5)
    expect((await api.post(`/orders/${order.id}/void`, { reason: 'again' })).status).toBe(409)

    const paid = (
      await api.post('/orders', { storeId: store.id, lines: [{ variantId: ids.croissant }] })
    ).body
    await api.post(`/orders/${paid.id}/payments`, { method: 'CASH', amountMinor: 100 })
    const refused = await api.post(`/orders/${paid.id}/void`, { reason: 'No' })
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('invalid_state')
  })
})

describe('inventory on sale', () => {
  it('refuses strictly tracked stock it does not have, all or nothing', async () => {
    const { api, store, ids, croissants, oatMilk, onHand } = await cafe()
    const res = await api.post('/orders', {
      storeId: store.id,
      lines: [
        { variantId: ids.latte12, modifierIds: [ids.single, ids.oat] },
        { variantId: ids.croissant, quantity: 6 },
      ],
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({
      code: 'insufficient_stock',
      details: { stockLevelId: croissants.id },
    })
    expect(await onHand(croissants.id)).toBe(5)
    expect(await onHand(oatMilk.id)).toBe(2)
    expect((await api.get('/orders')).body.data).toEqual([])

    // Oat milk isn't strictly tracked, so it may go negative.
    const order = await api.post('/orders', {
      storeId: store.id,
      lines: [{ variantId: ids.latte12, quantity: 3, modifierIds: [ids.single, ids.oat] }],
    })
    expect(order.status).toBe(201)
    expect(await onHand(oatMilk.id)).toBe(-1)
  })

  it('never oversells under parallel orders', async () => {
    const { api, store, ids, croissants, onHand } = await cafe()
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        api.post('/orders', { storeId: store.id, lines: [{ variantId: ids.croissant }] }),
      ),
    )
    const ok = results.filter((r) => r.status === 201)
    expect(ok).toHaveLength(5)
    expect(results.filter((r) => r.status === 409)).toHaveLength(7)
    expect(await onHand(croissants.id)).toBe(0)
    const sales = (await api.get(`/stock-levels/${croissants.id}/movements`)).body.data.filter(
      (m: any) => m.reason === 'SALE',
    )
    expect(sales).toHaveLength(5)
    expect(new Set(ok.map((r) => r.body.number)).size).toBe(5)
  })

  it("only draws down stock that belongs to the order's store", async () => {
    const { api, ids, croissants, onHand } = await cafe()
    const other = (await api.post('/stores', { name: 'Kiosk', slug: 'kiosk', currency: 'USD' }))
      .body
    const res = await api.post('/orders', {
      storeId: other.id,
      lines: [{ variantId: ids.croissant, quantity: 9 }],
    })
    expect(res.status).toBe(201)
    expect(await onHand(croissants.id)).toBe(5)
  })
})

describe('order access', () => {
  it('limits store-restricted staff to their stores and hides orders from other tenants', async () => {
    const { t, api, store, ids } = await cafe()
    const kiosk = (await api.post('/stores', { name: 'Kiosk', slug: 'kiosk', currency: 'USD' }))
      .body
    const mainOrder = (
      await api.post('/orders', { storeId: store.id, lines: [{ variantId: ids.croissant }] })
    ).body
    await api.post('/orders', { storeId: kiosk.id })

    const staff = await t.member('STAFF', [kiosk.id])
    const asStaff = t.as(staff.caller)
    expect((await asStaff.get('/orders')).body.data).toHaveLength(1)
    expect((await asStaff.get(`/orders/${mainOrder.id}`)).status).toBe(403)
    expect((await asStaff.post('/orders', { storeId: store.id })).status).toBe(403)
    expect(
      (await asStaff.post(`/orders/${mainOrder.id}/void`, { reason: 'mine now' })).status,
    ).toBe(403)
    const own = await asStaff.post('/orders', { storeId: kiosk.id, source: 'POS' })
    expect(own.body).toMatchObject({ source: 'POS', openedBy: staff.subject })

    const other = await tenantWithOwner()
    const otherApi = other.as(other.owner.caller)
    expect((await otherApi.get(`/orders/${mainOrder.id}`)).status).toBe(404)
    expect(
      (
        await otherApi.post(`/orders/${mainOrder.id}/lines`, {
          lines: [{ name: 'x', unitPriceMinor: 1 }],
        })
      ).status,
    ).toBe(404)
  })

  it('shows up in the customer order history', async () => {
    const { api, store } = await cafe()
    const customer = (await api.post('/customers', { name: 'Ada' })).body
    const order = (await api.post('/orders', { storeId: store.id, customerId: customer.id })).body
    expect(order.customerId).toBe(customer.id)
    const history = (await api.get(`/customers/${customer.id}/orders`)).body.data
    expect(history.map((o: any) => o.id)).toEqual([order.id])

    expect((await api.post('/orders', { storeId: store.id, customerId: uuidv7() })).status).toBe(
      422,
    )
  })
})
