import { env } from 'cloudflare:workers'
import { uuidv7 } from '@talajs/contracts'
import { createDb } from '@talajs/db'
import { describe, expect, it } from 'vitest'
import { tenantWithOwner } from './helpers.js'

async function setup() {
  const t = await tenantWithOwner()
  return { t, api: t.as(t.owner.caller) }
}

describe('stores', () => {
  it('creates, lists with pagination, updates, archives and restores', async () => {
    const { api } = await setup()
    for (const slug of ['a', 'b', 'c']) {
      expect(
        (await api.post('/stores', { name: `Store ${slug}`, slug, currency: 'USD' })).status,
      ).toBe(201)
    }
    const page1 = await api.get('/stores?limit=2')
    expect(page1.body.data.map((s: { slug: string }) => s.slug)).toEqual(['a', 'b'])
    const page2 = await api.get(`/stores?limit=2&cursor=${page1.body.nextCursor}`)
    expect(page2.body).toMatchObject({ data: [{ slug: 'c' }], nextCursor: null })

    const id = page1.body.data[0].id
    const updated = await api.patch(`/stores/${id}`, {
      timezone: 'Europe/Lisbon',
      pricesIncludeTax: true,
    })
    expect(updated.body).toMatchObject({
      timezone: 'Europe/Lisbon',
      pricesIncludeTax: true,
      currency: 'USD',
    })

    expect((await api.del(`/stores/${id}`)).body.archivedAt).not.toBeNull()
    expect((await api.get('/stores')).body.data).toHaveLength(2)
    expect((await api.get('/stores?includeArchived=true')).body.data).toHaveLength(3)
    expect((await api.post(`/stores/${id}/restore`)).body.archivedAt).toBeNull()
  })

  it('validates currency and timezone, and rejects duplicate slugs', async () => {
    const { api } = await setup()
    expect((await api.post('/stores', { name: 'x', slug: 'x', currency: 'XYZ' })).status).toBe(400)
    expect(
      (await api.post('/stores', { name: 'x', slug: 'x', currency: 'USD', timezone: 'Mars/Base' }))
        .status,
    ).toBe(400)
    expect((await api.post('/stores', { name: 'x', slug: 'x', currency: 'USD' })).status).toBe(201)
    expect((await api.post('/stores', { name: 'y', slug: 'x', currency: 'USD' })).status).toBe(409)
  })
})

describe('categories', () => {
  it('rejects parent cycles', async () => {
    const { api } = await setup()
    const a = (await api.post('/categories', { name: 'Drinks' })).body
    const b = (await api.post('/categories', { name: 'Coffee', parentId: a.id })).body
    const res = await api.patch(`/categories/${a.id}`, { parentId: b.id })
    expect(res.status).toBe(422)
    expect((await api.patch(`/categories/${a.id}`, { parentId: a.id })).status).toBe(422)
  })
})

describe('items, variants and modifiers', () => {
  async function menu() {
    const ctx = await setup()
    const { api } = ctx
    const tax = (await api.post('/tax-rates', { name: 'Sales tax', rateBps: 825 })).body
    const coffee = (await api.post('/categories', { name: 'Coffee' })).body
    const milk = (
      await api.post('/modifier-groups', {
        name: 'Milk',
        minSelect: 0,
        maxSelect: 1,
        modifiers: [
          { name: 'Whole', priceDeltaMinor: 0 },
          { name: 'Oat', priceDeltaMinor: 75 },
        ],
      })
    ).body
    const latte = await api.post('/items', {
      name: 'Latte',
      taxRateId: tax.id,
      variants: [
        { name: '12oz', priceMinor: 450 },
        { name: '16oz', priceMinor: 525, sortOrder: 1 },
      ],
      categoryIds: [coffee.id],
      modifierGroupIds: [milk.id],
    })
    return { ...ctx, tax, coffee, milk, latte }
  }

  it('creates an item with variants, categories and modifier groups', async () => {
    const { latte, coffee, milk } = await menu()
    expect(latte.status).toBe(201)
    expect(latte.body).toMatchObject({
      name: 'Latte',
      version: 1,
      categoryIds: [coffee.id],
      modifierGroupIds: [milk.id],
      variants: [
        { name: '12oz', priceMinor: 450, currency: 'USD' },
        { name: '16oz', priceMinor: 525, currency: 'USD' },
      ],
    })
    expect(milk.modifiers.map((m: { name: string }) => m.name)).toEqual(['Whole', 'Oat'])
  })

  it('filters by category and bumps version on every change', async () => {
    const { api, latte, coffee } = await menu()
    await api.post('/items', {
      name: 'Croissant',
      variants: [{ name: 'Regular', priceMinor: 350 }],
    })
    expect(
      (await api.get(`/items?categoryId=${coffee.id}`)).body.data.map(
        (i: { name: string }) => i.name,
      ),
    ).toEqual(['Latte'])

    const id = latte.body.id
    const v2 = await api.patch(`/items/${id}`, { name: 'Caffè latte', categoryIds: [] })
    expect(v2.body).toMatchObject({ name: 'Caffè latte', version: 2, categoryIds: [] })

    const variant = await api.post(`/items/${id}/variants`, { name: '20oz', priceMinor: 600 })
    expect(variant.status).toBe(201)
    const archived = await api.del(`/items/${id}/variants/${variant.body.id}`)
    expect(archived.body.archivedAt).not.toBeNull()
    expect((await api.get(`/items/${id}`)).body.version).toBe(4)
  })

  it('requires at least one variant and valid modifier ranges', async () => {
    const { api, milk } = await menu()
    expect((await api.post('/items', { name: 'Empty', variants: [] })).status).toBe(400)
    expect(
      (await api.post('/modifier-groups', { name: 'Bad', minSelect: 2, maxSelect: 1 })).status,
    ).toBe(400)
    expect((await api.patch(`/modifier-groups/${milk.id}`, { minSelect: 3 })).status).toBe(422)
  })

  it('manages modifiers within their group only', async () => {
    const { api, milk } = await menu()
    const added = await api.post(`/modifier-groups/${milk.id}/modifiers`, {
      name: 'No milk',
      priceDeltaMinor: -25,
    })
    expect(added.body.priceDeltaMinor).toBe(-25)
    const other = (await api.post('/modifier-groups', { name: 'Shots' })).body
    expect(
      (await api.patch(`/modifier-groups/${other.id}/modifiers/${added.body.id}`, { name: 'x' }))
        .status,
    ).toBe(404)
  })

  it("can't see or reference another tenant's catalog", async () => {
    const a = await menu()
    const b = await setup()
    expect((await b.api.get(`/items/${a.latte.body.id}`)).status).toBe(404)
    expect((await b.api.patch(`/items/${a.latte.body.id}`, { name: 'pwned' })).status).toBe(404)

    // Referencing tenant A's category from tenant B is rejected by the composite FKs.
    const res = await b.api.post('/items', {
      name: 'Sneaky',
      variants: [{ name: 'Regular', priceMinor: 1 }],
      categoryIds: [a.coffee.id],
    })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('invalid_reference')
    expect((await b.api.get('/items')).body.data).toEqual([]) // rolled back entirely
  })

  it('records catalog changes in the change feed, in the same transaction', async () => {
    const { t, latte } = await menu()
    const db = createDb({ url: env.HYPERDRIVE.connectionString, driver: 'pg' })
    try {
      const changes = await db.forTenant(t.tenantId).changeLog.findMany({ orderBy: { seq: 'asc' } })
      expect(changes.map((c) => c.entity)).toEqual([
        'tax_rate',
        'category',
        'modifier_group',
        'item',
      ])
      expect(changes.at(-1)?.entityId).toBe(latte.body.id)
    } finally {
      await db.dispose()
    }
  })

  it('sets per-store availability and price overrides', async () => {
    const { api, latte } = await menu()
    const store = (await api.post('/stores', { name: 'Main', slug: 'main', currency: 'USD' })).body
    const put = await api.put(`/stores/${store.id}/items/${latte.body.id}`, {
      available: false,
      priceOverrideMinor: 500,
    })
    expect(put.body).toEqual({
      storeId: store.id,
      itemId: latte.body.id,
      available: false,
      priceOverrideMinor: 500,
    })
    expect((await api.get(`/stores/${store.id}/items`)).body.data).toHaveLength(1)
    expect(
      (await api.put(`/stores/${store.id}/items/${uuidv7()}`, { available: true })).status,
    ).toBe(422)
  })
})
