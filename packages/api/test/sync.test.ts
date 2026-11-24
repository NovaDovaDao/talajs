import { env } from 'cloudflare:workers'
import { uuidv7 } from '@talajs/contracts'
import { describe, expect, it } from 'vitest'
import { cafe } from './fixtures.js'
import { call, tenantWithOwner, testDb } from './helpers.js'

const db = testDb(env)
const pair = (pairingCode: string) => call(null, 'POST', '/v1/terminal/pair', { pairingCode })

/** A café with a paired register ("T1") in its main store. */
async function withRegister(code = 'T1') {
  const ctx = await cafe()
  const created = await ctx.api.post('/terminals', { storeId: ctx.store.id, name: 'Front', code })
  const paired = await pair(created.body.pairingCode)
  const token: string = paired.body.token
  const reg = ctx.t.as({ bearer: token })
  return { ...ctx, terminal: created.body.terminal, token, reg, pushed: [] as unknown[] }
}

type Ctx = Awaited<ReturnType<typeof withRegister>>

let clock = Date.parse('2026-11-19T09:00:00Z')
const ts = () => {
  clock += 1000
  return new Date(clock).toISOString()
}
const mutation = (type: string, payload: unknown, extra: object = {}) => ({
  id: uuidv7(),
  clientTs: ts(),
  type,
  payload,
  ...extra,
})

/** What a register would have recorded for an offline sale of two croissants, paid in cash. */
function offlineSale(ctx: Ctx, { number = 'T1-0001', quantity = 2, unitPriceMinor = 350 } = {}) {
  const orderId = uuidv7()
  const total = quantity * unitPriceMinor + Math.round(quantity * unitPriceMinor * 0.0825)
  return {
    orderId,
    total,
    mutations: [
      mutation('order.open', { orderId, number }),
      mutation('order.add_lines', {
        orderId,
        lines: [
          {
            id: uuidv7(),
            variantId: ctx.ids.croissant,
            itemName: 'Croissant',
            variantName: 'Regular',
            unitPriceMinor,
            quantity,
            taxRateBps: 825,
          },
        ],
      }),
      mutation('order.pay', { orderId, paymentId: uuidv7(), method: 'CASH', amountMinor: total }),
      mutation('order.complete', { orderId }),
    ],
  }
}

const push = (ctx: Ctx, mutations: unknown[]) => ctx.reg.post('/sync/push', { mutations })
const statuses = (res: { body: { results: { status: string }[] } }) =>
  res.body.results.map((r) => r.status)

describe('terminal pairing', () => {
  it('pairs once with a code, then authenticates with the token', async () => {
    const { t, api, store } = await cafe()
    const staff = t.as((await t.member('STAFF')).caller)
    expect(
      (await staff.post('/terminals', { storeId: store.id, name: 'x', code: 'T9' })).status,
    ).toBe(403)

    const created = await api.post('/terminals', { storeId: store.id, name: 'Front', code: 'T1' })
    expect(created.status).toBe(201)
    expect(created.body.pairingCode).toMatch(/^[2-9A-Z]{5}-[2-9A-Z]{5}$/)
    expect(created.body.terminal).toMatchObject({ paired: false, code: 'T1' })
    expect(created.body.terminal).not.toHaveProperty('tokenHash')

    // Typed casually: lower case, no dash.
    const typed = created.body.pairingCode.toLowerCase().replace('-', '')
    const paired = await pair(typed)
    expect(paired.status).toBe(200)
    expect(paired.body.token).toMatch(/^tala_t_[\w-]{43}$/)
    expect(paired.body.terminal).toMatchObject({
      tenantId: t.tenantId,
      storeId: store.id,
      code: 'T1',
    })
    expect((await pair(created.body.pairingCode)).status).toBe(401)

    const reg = t.as({ bearer: paired.body.token })
    expect((await reg.get('/items')).status).toBe(200)
    const me = await call({ bearer: paired.body.token }, 'GET', '/v1/me')
    expect(me.body).toMatchObject({
      kind: 'terminal',
      memberships: [{ tenantId: t.tenantId, role: 'STAFF', storeIds: [store.id] }],
    })
    const listed = (await api.get('/terminals')).body.data[0]
    expect(listed).toMatchObject({ paired: true, lastSeenAt: expect.any(String) })

    // A wrong token is a 401, not a fall-through to other adapters.
    expect((await call({ bearer: 'tala_t_nope' }, 'GET', '/v1/me')).status).toBe(401)
  })

  it('rejects expired codes, rotates on re-pair and revokes', async () => {
    const { api, store, t } = await cafe()
    const created = await api.post('/terminals', { storeId: store.id, name: 'Bar', code: 'T2' })
    await db.client.terminal.update({
      where: { id: created.body.terminal.id },
      data: { pairingExpiresAt: new Date(Date.now() - 1000) },
    })
    expect((await pair(created.body.pairingCode)).status).toBe(401)

    const fresh = await api.post(`/terminals/${created.body.terminal.id}/pairing-code`)
    const first = (await pair(fresh.body.pairingCode)).body.token
    const again = await api.post(`/terminals/${created.body.terminal.id}/pairing-code`)
    expect((await t.as({ bearer: first }).get('/items')).status).toBe(200) // still valid
    const second = (await pair(again.body.pairingCode)).body.token
    expect((await t.as({ bearer: first }).get('/items')).status).toBe(401)
    expect((await t.as({ bearer: second }).get('/items')).status).toBe(200)

    const revoked = await api.post(`/terminals/${created.body.terminal.id}/revoke`)
    expect(revoked.body.revokedAt).not.toBeNull()
    expect((await t.as({ bearer: second }).get('/items')).status).toBe(401)
    expect((await api.post(`/terminals/${created.body.terminal.id}/pairing-code`)).status).toBe(409)
    expect((await api.get('/terminals')).body.data).toEqual([])
  })

  it('limits a terminal to staff rights in its own store and tenant', async () => {
    const { reg, store, api, terminal, ids } = await withRegister()
    const kiosk = (await api.post('/stores', { name: 'Kiosk', slug: 'kiosk', currency: 'USD' }))
      .body
    expect((await reg.post('/tax-rates', { name: 'x', rateBps: 1 })).status).toBe(403)
    expect((await reg.post('/orders', { storeId: kiosk.id })).status).toBe(403)
    const order = await reg.post('/orders', {
      storeId: store.id,
      lines: [{ variantId: ids.croissant }],
    })
    expect(order.body).toMatchObject({ source: 'POS', terminalId: terminal.id })

    const other = await tenantWithOwner()
    expect(
      (await call({ bearer: (await withRegister()).token }, 'GET', `${other.base}/items`)).status,
    ).toBe(404)
    // Only terminals sync.
    expect((await api.post('/sync/push', { mutations: [mutation('order.open', {})] })).status).toBe(
      403,
    )
    expect((await api.get('/sync/pull')).status).toBe(403)
  })
})

describe('sync push', () => {
  it('applies an offline sale once, however often it is pushed', async () => {
    const ctx = await withRegister()
    const sale = offlineSale(ctx)
    const first = await push(ctx, sale.mutations)
    expect(first.status).toBe(200)
    expect(statuses(first)).toEqual(['APPLIED', 'APPLIED', 'APPLIED', 'APPLIED'])

    const again = await push(ctx, sale.mutations)
    expect(again.body.results.map((r: any) => [r.status, r.original])).toEqual(
      Array(4).fill(['DUPLICATE', 'APPLIED']),
    )

    const order = (await ctx.api.get(`/orders/${sale.orderId}`)).body
    expect(order).toMatchObject({
      number: 'T1-0001',
      status: 'COMPLETED',
      source: 'POS',
      terminalId: ctx.terminal.id,
      totalMinor: sale.total,
      paidMinor: sale.total,
      openedAt: sale.mutations[0]?.clientTs,
      completedAt: sale.mutations[3]?.clientTs,
    })
    expect(order.lines).toHaveLength(1)
    expect(order.payments).toHaveLength(1)
    expect(await ctx.onHand(ctx.croissants.id)).toBe(3)
  })

  it('applies a batch exactly once when the same push races itself', async () => {
    const ctx = await withRegister()
    const sale = offlineSale(ctx)
    const [a, b] = await Promise.all([push(ctx, sale.mutations), push(ctx, sale.mutations)])
    for (let i = 0; i < 4; i++) {
      expect([a?.body.results[i].status, b?.body.results[i].status].sort()).toEqual([
        'APPLIED',
        'DUPLICATE',
      ])
    }
    const orders = (await ctx.api.get('/orders')).body.data
    expect(orders).toHaveLength(1)
    expect(await ctx.onHand(ctx.croissants.id)).toBe(3)
  })

  it('records sales that take stock below zero, and flags them', async () => {
    const ctx = await withRegister()
    const res = await push(ctx, offlineSale(ctx, { quantity: 7 }).mutations)
    expect(statuses(res)).toEqual(['APPLIED', 'APPLIED', 'APPLIED', 'APPLIED'])
    expect(await ctx.onHand(ctx.croissants.id)).toBe(-2)
    const [reviewId] = res.body.results[1].reviewItemIds
    const item = (await ctx.api.get(`/review-items/${reviewId}`)).body
    expect(item).toMatchObject({
      kind: 'NEGATIVE_STOCK',
      subjectType: 'stock_level',
      subjectId: ctx.croissants.id,
      details: { onHand: -2 },
    })
  })

  it('keeps the price the register charged, and flags drift from the catalog', async () => {
    const ctx = await withRegister()
    const sale = offlineSale(ctx, { unitPriceMinor: 300 })
    const res = await push(ctx, sale.mutations)
    expect(statuses(res)).toEqual(['APPLIED', 'APPLIED', 'APPLIED', 'APPLIED'])
    expect((await ctx.api.get(`/orders/${sale.orderId}`)).body.totalMinor).toBe(sale.total)
    const item = (await ctx.api.get(`/review-items/${res.body.results[1].reviewItemIds[0]}`)).body
    expect(item).toMatchObject({
      kind: 'SYNC_CONFLICT',
      subjectType: 'order',
      details: { reason: 'price_mismatch', lines: [{ chargedMinor: 300, catalogMinor: 350 }] },
    })
  })

  it('rejects bad mutations for review without blocking the rest', async () => {
    const ctx = await withRegister()
    const sale = offlineSale(ctx)
    const res = await push(ctx, [
      mutation('order.teleport', { orderId: uuidv7() }),
      mutation('order.open', { orderId: 'not-a-uuid' }),
      mutation('order.add_lines', {
        orderId: uuidv7(),
        lines: sale.mutations[1]?.payload && (sale.mutations[1].payload as any).lines,
      }),
      mutation('order.open', { orderId: uuidv7(), number: 'T7-0001' }),
      ...sale.mutations,
    ])
    expect(statuses(res)).toEqual([
      'REJECTED',
      'REJECTED',
      'REJECTED',
      'REJECTED',
      'APPLIED',
      'APPLIED',
      'APPLIED',
      'APPLIED',
    ])
    expect(res.body.results[2].message).toBe('Order not found')
    const reviews = (await ctx.api.get('/review-items?status=OPEN')).body.data
    expect(reviews).toHaveLength(4)
    expect(reviews.at(-1).details).toMatchObject({
      reason: 'rejected',
      type: 'order.teleport',
      payload: { orderId: expect.any(String) },
    })
    // A rejected id stays rejected: pushing it again is a duplicate.
    const again = await push(ctx, [
      { ...mutation('order.open', {}), id: res.body.results[0].id, type: 'order.teleport' },
    ])
    expect(again.body.results[0]).toMatchObject({ status: 'DUPLICATE', original: 'REJECTED' })
  })
})

describe('conflicts and the review queue', () => {
  it('turns a stale tab edit into a review item instead of applying it', async () => {
    const ctx = await withRegister()
    const tabId = uuidv7()
    const lineId = uuidv7()
    const opened = await push(ctx, [
      mutation('order.open', {
        orderId: tabId,
        number: 'T1-0002',
        isTab: true,
        tabName: 'Table 4',
      }),
      mutation('order.add_lines', {
        orderId: tabId,
        lines: [
          {
            id: lineId,
            variantId: ctx.ids.croissant,
            itemName: 'Croissant',
            unitPriceMinor: 350,
            quantity: 1,
            taxRateBps: 825,
          },
        ],
      }),
    ])
    expect(statuses(opened)).toEqual(['APPLIED', 'APPLIED'])
    const seen = (await ctx.reg.get(`/orders/${tabId}`)).body.version

    // Meanwhile, someone adds a line to the same tab from the admin.
    await ctx.api.post(`/orders/${tabId}/lines`, { lines: [{ variantId: ctx.ids.croissant }] })

    const res = await push(ctx, [
      mutation(
        'order.void_line',
        { orderId: tabId, lineId, reason: 'Spilled' },
        { baseVersion: seen },
      ),
    ])
    expect(res.body.results[0]).toMatchObject({
      status: 'CONFLICT',
      reviewItemIds: [expect.any(String)],
    })
    const tab = (await ctx.api.get(`/orders/${tabId}`)).body
    expect(tab.lines.every((l: any) => l.voidedAt === null)).toBe(true)
    expect(tab.version).toBe(seen + 1)

    const reviewId = res.body.results[0].reviewItemIds[0]
    const item = (await ctx.api.get(`/review-items/${reviewId}`)).body
    expect(item).toMatchObject({
      kind: 'SYNC_CONFLICT',
      subjectType: 'order',
      subjectId: tabId,
      syncMutationId: res.body.results[0].id,
      status: 'OPEN',
      details: {
        reason: 'conflict',
        type: 'order.void_line',
        baseVersion: seen,
        currentVersion: seen + 1,
        payload: { lineId, reason: 'Spilled' },
      },
    })

    const restricted = ctx.t.as((await ctx.t.member('MANAGER', [ctx.store.id])).caller)
    expect((await restricted.get('/review-items')).status).toBe(403)
    expect((await ctx.reg.get('/review-items')).status).toBe(403)

    const resolved = await ctx.api.post(`/review-items/${reviewId}/resolve`, {
      status: 'RESOLVED',
      note: 'Voided it by hand',
    })
    expect(resolved.body).toMatchObject({
      status: 'RESOLVED',
      resolution: { note: 'Voided it by hand' },
      resolvedBy: ctx.t.owner.subject,
    })
    expect(
      (await ctx.api.post(`/review-items/${reviewId}/resolve`, { status: 'DISMISSED' })).status,
    ).toBe(409)
    expect((await ctx.api.get('/review-items?status=OPEN')).body.data).toEqual([])
  })

  it('records cash taken twice for one tab, and flags the overpayment', async () => {
    const ctx = await withRegister()
    const sale = offlineSale(ctx)
    await push(ctx, sale.mutations.slice(0, 3))
    // A second register took the full amount too, before hearing about the first payment.
    const res = await push(ctx, [
      mutation('order.pay', {
        orderId: sale.orderId,
        paymentId: uuidv7(),
        method: 'CASH',
        amountMinor: sale.total,
      }),
    ])
    expect(res.body.results[0].status).toBe('APPLIED')
    const item = (await ctx.api.get(`/review-items/${res.body.results[0].reviewItemIds[0]}`)).body
    expect(item).toMatchObject({
      kind: 'PAYMENT_MISMATCH',
      details: { overpaidMinor: sale.total },
    })
    expect((await ctx.api.get(`/orders/${sale.orderId}`)).body.paidMinor).toBe(2 * sale.total)
  })
})

describe('sync pull', () => {
  async function pullAll(ctx: Ctx, cursor?: string, limit = 500) {
    const changes: any[] = []
    for (;;) {
      const res = await ctx.reg.get(
        `/sync/pull?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      )
      expect(res.status).toBe(200)
      changes.push(...res.body.changes)
      cursor = res.body.cursor
      if (!res.body.hasMore) return { changes, cursor: cursor as string }
    }
  }

  /**
   * A change becomes visible once every write transaction older than it has finished, anywhere in
   * the database (other test files write in parallel), so poll briefly, as a register would.
   */
  async function pullUntil(
    ctx: Ctx,
    cursor: string,
    done: (changes: any[]) => boolean,
    limit = 500,
  ) {
    const changes: any[] = []
    for (let i = 0; i < 50; i++) {
      const page = await pullAll(ctx, cursor || undefined, limit)
      changes.push(...page.changes)
      cursor = page.cursor
      if (done(changes)) return { changes, cursor }
      await new Promise((r) => setTimeout(r, 100))
    }
    return { changes, cursor }
  }

  /** Pull until the café fixture's whole catalog has arrived. */
  const fullLoad = (ctx: Ctx, limit = 500) =>
    pullUntil(
      ctx,
      '',
      (cs) => {
        const n = (e: string) => new Set(cs.filter((c) => c.entity === e).map((c) => c.id)).size
        return (
          n('item') === 2 &&
          n('stock_level') === 2 &&
          n('modifier_group') === 2 &&
          n('tax_rate') === 1
        )
      },
      limit,
    )

  it("loads the catalog for the register's store, then only what changed", async () => {
    const ctx = await withRegister()
    const kiosk = (await ctx.api.post('/stores', { name: 'Kiosk', slug: 'kiosk', currency: 'USD' }))
      .body
    await ctx.api.post('/stock-levels', { storeId: kiosk.id, name: 'Kiosk milk' })
    await ctx.api.put(`/stores/${kiosk.id}/items/${ctx.latte.id}`, { available: false })

    const first = await fullLoad(ctx)
    const kinds = (e: string) => first.changes.filter((c) => c.entity === e)
    expect(kinds('store').map((c) => c.data.id)).toEqual([ctx.store.id])
    expect(kinds('tax_rate')).toHaveLength(1)
    expect(kinds('modifier_group')).toHaveLength(2)
    expect(
      kinds('item')
        .map((c) => c.data.name)
        .sort(),
    ).toEqual(['Croissant', 'Latte'])
    expect(
      kinds('stock_level')
        .map((c) => c.data.name)
        .sort(),
    ).toEqual(['Croissants', 'Oat milk'])
    expect(kinds('store_item')).toEqual([])
    expect(kinds('item').find((c) => c.data.name === 'Croissant').data.variants[0].priceMinor).toBe(
      350,
    )

    // Paging with a small limit sees the same final state.
    const latest = (cs: any[]) =>
      Object.fromEntries(cs.map((c) => [`${c.entity}/${c.id}`, JSON.stringify(c.data)]))
    expect(latest((await fullLoad(ctx, 2)).changes)).toEqual(latest(first.changes))

    await ctx.api.patch(`/items/${ctx.croissant.id}/variants/${ctx.ids.croissant}`, {
      priceMinor: 375,
    })
    const next = await pullUntil(ctx, first.cursor, (cs) => cs.length > 0)
    expect(next.changes).toEqual([
      expect.objectContaining({ entity: 'item', id: ctx.croissant.id, op: 'upsert' }),
    ])
    expect(next.changes[0].data.variants[0].priceMinor).toBe(375)
    expect((await pullAll(ctx, next.cursor)).changes).toEqual([])
    expect((await ctx.reg.get('/sync/pull?cursor=garbage')).status).toBe(400)
  })

  it('never skips a change that commits after a later one', async () => {
    const ctx = await withRegister()
    const start = await fullLoad(ctx)

    // A slow transaction writes a change first and commits last.
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let written!: () => void
    const wrote = new Promise<void>((r) => {
      written = r
    })
    const slow = db.client.$transaction(
      async (tx) => {
        await tx.changeLog.create({
          data: {
            tenantId: ctx.t.tenantId,
            entity: 'tax_rate',
            entityId: ctx.tax.id,
            op: 'upsert',
          },
        })
        written()
        await gate
      },
      { timeout: 20_000 },
    )
    await wrote
    await ctx.api.patch(`/items/${ctx.croissant.id}`, { name: 'Butter croissant' })

    const during = await pullAll(ctx, start.cursor)
    expect(during.changes).toEqual([]) // held back until the slow transaction finishes

    release()
    await slow
    const after = await pullUntil(ctx, during.cursor, (cs) => cs.length >= 2)
    expect(after.changes.map((c) => c.entity).sort()).toEqual(['item', 'tax_rate'])
  })
})
