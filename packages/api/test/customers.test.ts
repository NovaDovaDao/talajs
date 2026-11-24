import { describe, expect, it } from 'vitest'
import { tenantWithOwner } from './helpers.js'

describe('customers', () => {
  it('creates customers with tags and normalises email', async () => {
    const t = await tenantWithOwner()
    const api = t.as(t.owner.caller)
    const res = await api.post('/customers', {
      name: 'Sam',
      email: 'Sam@Example.com',
      tags: ['regular', 'oat-milk'],
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ email: 'sam@example.com', tags: ['oat-milk', 'regular'] })

    const updated = await api.patch(`/customers/${res.body.id}`, {
      tags: ['regular'],
      phone: '+351 900 000 000',
    })
    expect(updated.body).toMatchObject({ tags: ['regular'], phone: '+351 900 000 000' })
    expect((await api.get('/tags')).body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'regular', customerCount: 1 }),
        expect.objectContaining({ name: 'oat-milk', customerCount: 0 }),
      ]),
    )
  })

  it('email is unique per tenant, not globally', async () => {
    const a = await tenantWithOwner()
    const b = await tenantWithOwner()
    const body = { email: 'same@example.com' }
    expect((await a.as(a.owner.caller).post('/customers', body)).status).toBe(201)
    expect((await b.as(b.owner.caller).post('/customers', body)).status).toBe(201)
    expect(
      (await a.as(a.owner.caller).post('/customers', { email: 'SAME@example.com' })).status,
    ).toBe(409)
  })

  it('searches by name, email or phone and filters by tag', async () => {
    const t = await tenantWithOwner()
    const api = t.as(t.owner.caller)
    await api.post('/customers', { name: 'Ana Silva', email: 'ana@example.com', tags: ['vip'] })
    await api.post('/customers', { name: 'Bo', phone: '555-0101' })
    const names = async (q: string) =>
      (await api.get(`/customers?${q}`)).body.data.map((c: { name: string }) => c.name)
    expect(await names('q=silva')).toEqual(['Ana Silva'])
    expect(await names('q=ANA%40EXAMPLE')).toEqual(['Ana Silva'])
    expect(await names('q=0101')).toEqual(['Bo'])
    expect(await names('tag=vip')).toEqual(['Ana Silva'])
  })

  it('keeps notes authored by the caller, newest first, and an (empty) order history', async () => {
    const t = await tenantWithOwner()
    const staff = await t.member('STAFF')
    const api = t.as(staff.caller)
    const customer = (await api.post('/customers', { name: 'Sam' })).body
    await api.post(`/customers/${customer.id}/notes`, { body: 'Prefers oat milk' })
    await api.post(`/customers/${customer.id}/notes`, { body: 'Birthday in June' })
    const notes = await api.get(`/customers/${customer.id}/notes`)
    expect(notes.body.data.map((n: { body: string }) => n.body)).toEqual([
      'Birthday in June',
      'Prefers oat milk',
    ])
    expect(notes.body.data[0].author).toBe(staff.subject)
    expect((await api.get(`/customers/${customer.id}/orders`)).body).toEqual({
      data: [],
      nextCursor: null,
    })
  })

  it('staff can add customers but only managers can archive them', async () => {
    const t = await tenantWithOwner()
    const staff = await t.member('STAFF')
    const customer = (await t.as(staff.caller).post('/customers', { name: 'Sam' })).body
    expect((await t.as(staff.caller).del(`/customers/${customer.id}`)).status).toBe(403)
    const manager = await t.member('MANAGER')
    expect(
      (await t.as(manager.caller).del(`/customers/${customer.id}`)).body.archivedAt,
    ).not.toBeNull()
  })
})
