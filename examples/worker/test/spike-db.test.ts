// M1 spike: Prisma 7 (workerd client) + node-postgres through Hyperdrive, inside workerd.

import { env, exports } from 'cloudflare:workers'
import { uuidv7 } from '@talajs/contracts'
import { createDb, type TalaDb } from '@talajs/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let db: TalaDb
const tenantId = uuidv7()
const storeId = uuidv7()

beforeAll(async () => {
  const started = performance.now()
  db = createDb({ url: env.HYPERDRIVE.connectionString, driver: 'pg' })
  await db.client.tenant.create({
    data: { id: tenantId, name: 'Spike', slug: `spike-${tenantId}`, defaultCurrency: 'USD' },
  })
  console.log(`first query incl. client init: ${(performance.now() - started).toFixed(0)}ms`)
  await db
    .forTenant(tenantId)
    .store.create({ data: { id: storeId, name: 'Main', slug: 'main', currency: 'USD' } as never })
})

afterAll(() => db.dispose())

describe('Prisma on workerd via Hyperdrive', () => {
  it('runs inside workerd with the workerd Prisma client', () => {
    expect(navigator.userAgent).toBe('Cloudflare-Workers')
    // The nodejs client sets __dirname from import.meta.url; the workerd client pins it to '/'.
    expect((globalThis as { __dirname?: string }).__dirname).toBe('/')
  })

  it('serves a request through the example worker', async () => {
    const res = await exports.default.fetch('http://example.com/health')
    expect(await res.json()).toEqual({ ok: true })
  })

  it('rolls back interactive transactions', async () => {
    const t = db.forTenant(tenantId)
    const id = uuidv7()
    await expect(
      t.$transaction(async (tx) => {
        await tx.item.create({ data: { id, name: 'Ghost' } as never })
        throw new Error('abort')
      }),
    ).rejects.toThrow('abort')
    expect(await t.item.findUnique({ where: { id } })).toBeNull()
  })

  it('a conditional decrement cannot oversell under concurrent transactions', async () => {
    const t = db.forTenant(tenantId)
    const stockLevelId = uuidv7()
    await t.stockLevel.create({
      data: { id: stockLevelId, storeId, name: 'Croissant', onHand: 5 } as never,
    })

    // 12 concurrent "order commits", each wanting 1 unit; each in its own transaction.
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        t.$transaction(async (tx) => {
          const { count } = await tx.stockLevel.updateMany({
            where: { id: stockLevelId, onHand: { gte: 1 } },
            data: { onHand: { decrement: 1 } },
          })
          if (count === 0) throw new Error('insufficient_stock')
          await tx.stockMovement.create({
            data: {
              id: uuidv7(),
              stockLevelId,
              delta: -1,
              reason: 'SALE',
              actor: 'spike',
            } as never,
          })
        }),
      ),
    )

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(7)
    expect((await t.stockLevel.findUniqueOrThrow({ where: { id: stockLevelId } })).onHand).toBe(0)
    expect(await t.stockMovement.count({ where: { stockLevelId } })).toBe(5)
  })
})
