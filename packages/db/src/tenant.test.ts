import { uuidv7 } from '@talajs/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from './index.node.js'
import { migrate } from './migrate.js'
import { applyTenantScope, TenantScopeError } from './tenant.js'
import { resetTalaSchema, TEST_URL } from './test/db.js'

describe('applyTenantScope', () => {
  const t = 'tenant-a'

  it('adds tenantId to where and data', () => {
    expect(applyTenantScope('Item', 'findMany', { where: { name: 'Latte' } }, t)).toEqual({
      where: { name: 'Latte', tenantId: t },
    })
    expect(applyTenantScope('Item', 'create', { data: { id: '1', name: 'Latte' } }, t)).toEqual({
      data: { id: '1', name: 'Latte', tenantId: t },
    })
    expect(applyTenantScope('Item', 'createMany', { data: [{ id: '1' }, { id: '2' }] }, t)).toEqual(
      {
        data: [
          { id: '1', tenantId: t },
          { id: '2', tenantId: t },
        ],
      },
    )
  })

  it('overrides a caller-supplied tenantId in where', () => {
    expect(applyTenantScope('Item', 'findFirst', { where: { tenantId: 'other' } }, t)).toEqual({
      where: { tenantId: t },
    })
  })

  it('rejects writes for another tenant', () => {
    expect(() =>
      applyTenantScope('Item', 'create', { data: { tenantId: 'other', name: 'x' } }, t),
    ).toThrow(TenantScopeError)
    expect(() =>
      applyTenantScope('Item', 'update', { where: { id: '1' }, data: { tenantId: 'other' } }, t),
    ).toThrow(TenantScopeError)
    expect(() =>
      applyTenantScope('Item', 'create', { data: { tenant: { connect: { id: t } } } }, t),
    ).toThrow(TenantScopeError)
  })

  it('refuses system models and keeps Tenant read-only', () => {
    expect(() => applyTenantScope('ProviderEvent', 'findMany', {}, t)).toThrow(TenantScopeError)
    expect(applyTenantScope('Tenant', 'findFirst', {}, t)).toEqual({ where: { id: t } })
    expect(() => applyTenantScope('Tenant', 'update', { where: {}, data: {} }, t)).toThrow(
      TenantScopeError,
    )
  })
})

describe('tenant isolation against Postgres', () => {
  const db = createDb({ url: TEST_URL })
  const tenantA = uuidv7()
  const tenantB = uuidv7()
  const itemOfB = uuidv7()

  beforeAll(async () => {
    await resetTalaSchema()
    await migrate({ url: TEST_URL })
    for (const [id, slug] of [
      [tenantA, 'a'],
      [tenantB, 'b'],
    ] as const) {
      await db.client.tenant.create({ data: { id, name: slug, slug, defaultCurrency: 'USD' } })
    }
    await db.client.item.create({ data: { id: itemOfB, tenantId: tenantB, name: 'B latte' } })
  })

  afterAll(() => db.dispose())

  it("cannot read another tenant's rows, even by id", async () => {
    const a = db.forTenant(tenantA)
    expect(await a.item.findMany()).toEqual([])
    expect(await a.item.findUnique({ where: { id: itemOfB } })).toBeNull()
    expect(await a.item.count()).toBe(0)
    expect((await db.forTenant(tenantB).item.findMany()).map((i) => i.id)).toEqual([itemOfB])
  })

  it("cannot update or delete another tenant's rows", async () => {
    const a = db.forTenant(tenantA)
    expect(
      (await a.item.updateMany({ where: { id: itemOfB }, data: { name: 'pwned' } })).count,
    ).toBe(0)
    expect((await a.item.deleteMany({ where: { id: itemOfB } })).count).toBe(0)
    await expect(
      a.item.update({ where: { id: itemOfB }, data: { name: 'pwned' } }),
    ).rejects.toThrow()
    expect((await db.client.item.findUniqueOrThrow({ where: { id: itemOfB } })).name).toBe(
      'B latte',
    )
  })

  it('stamps tenantId on create', async () => {
    const id = uuidv7()
    const item = await db.forTenant(tenantA).item.create({ data: { id, name: 'A latte' } as never })
    expect(item.tenantId).toBe(tenantA)
  })

  it('the database rejects cross-tenant references (composite FKs)', async () => {
    // Bypass the scoped client entirely: tenant A's variant pointing at tenant B's item.
    await expect(
      db.client.variant.create({
        data: {
          id: uuidv7(),
          tenantId: tenantA,
          itemId: itemOfB,
          name: 'Regular',
          priceMinor: 450,
          currency: 'USD',
        },
      }),
    ).rejects.toThrow(/foreign key/i)
  })

  it('customer email is unique per tenant, not globally', async () => {
    const email = 'sam@example.com'
    await db.forTenant(tenantA).customer.create({ data: { id: uuidv7(), email } as never })
    await db.forTenant(tenantB).customer.create({ data: { id: uuidv7(), email } as never })
    await expect(
      db.forTenant(tenantA).customer.create({ data: { id: uuidv7(), email } as never }),
    ).rejects.toThrow(/unique/i)
  })

  it('check constraints guard money and currency', async () => {
    const t = db.forTenant(tenantA)
    await expect(
      t.store.create({ data: { id: uuidv7(), name: 'x', slug: 'x', currency: 'usd' } as never }),
    ).rejects.toThrow(/store_currency_iso/)
    await expect(
      t.customer.create({ data: { id: uuidv7(), email: 'Sam@Example.com' } as never }),
    ).rejects.toThrow(/customer_email_lowercase/)
  })

  it('interactive transactions keep the tenant scope', async () => {
    const a = db.forTenant(tenantA)
    const seen = await a.$transaction(async (tx) =>
      tx.item.findMany({ select: { tenantId: true } }),
    )
    expect(seen.every((i) => i.tenantId === tenantA)).toBe(true)
  })
})
