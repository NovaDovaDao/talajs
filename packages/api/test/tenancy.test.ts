import { uuidv7 } from '@talajs/contracts'
import { describe, expect, it } from 'vitest'
import { call, service, tenantWithOwner, user } from './helpers.js'

describe('tenants', () => {
  it('only a service credential can provision tenants', async () => {
    const someone = await user()
    const body = {
      name: 'X',
      slug: `x-${uuidv7()}`,
      defaultCurrency: 'USD',
      ownerSubject: someone.subject,
    }
    expect((await call(someone.caller, 'POST', '/v1/tenants', body)).status).toBe(403)
    expect((await call(service, 'POST', '/v1/tenants', body)).status).toBe(201)
    expect((await call(service, 'POST', '/v1/tenants', body)).status).toBe(409) // slug taken
  })

  it('validates input', async () => {
    const res = await call(service, 'POST', '/v1/tenants', {
      name: '',
      slug: 'Bad Slug',
      defaultCurrency: 'usd',
      ownerSubject: 'x',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('validation_error')
    expect(res.body.error.details.map((i: { path: string[] }) => i.path[0])).toEqual(
      expect.arrayContaining(['name', 'slug', 'defaultCurrency']),
    )
  })

  it('the owner sees the tenant; outsiders get 404, not 403', async () => {
    const t = await tenantWithOwner()
    const me = await call(t.owner.caller, 'GET', '/v1/me')
    expect(me.body.memberships).toEqual([
      {
        tenantId: t.tenantId,
        tenantName: 'Test Café',
        membershipId: t.owner.membershipId,
        role: 'OWNER',
        storeIds: [],
        hasPin: false,
      },
    ])
    expect((await t.as(t.owner.caller).get('')).body.id).toBe(t.tenantId)

    const outsider = await user()
    expect((await t.as(outsider.caller).get('')).status).toBe(404)
    expect((await call(outsider.caller, 'GET', `/v1/tenants/${uuidv7()}`)).status).toBe(404)
    expect((await call(outsider.caller, 'GET', '/v1/tenants/not-a-uuid/items')).status).toBe(404)
  })

  it('service credentials act as owner in any tenant', async () => {
    const t = await tenantWithOwner()
    expect((await t.as(service).get('/memberships')).status).toBe(200)
  })
})

describe('memberships and roles', () => {
  it('enforces roles: staff read, managers write, owners manage members', async () => {
    const t = await tenantWithOwner()
    const staff = await t.member('STAFF')
    const manager = await t.member('MANAGER')
    const taxRate = { name: 'Sales tax', rateBps: 825 }

    expect((await t.as(staff.caller).get('/tax-rates')).status).toBe(200)
    expect((await t.as(staff.caller).post('/tax-rates', taxRate)).status).toBe(403)
    expect((await t.as(manager.caller).post('/tax-rates', taxRate)).status).toBe(201)
    expect((await t.as(staff.caller).get('/memberships')).status).toBe(403)
    expect((await t.as(manager.caller).get('/memberships')).status).toBe(200)
    expect(
      (await t.as(manager.caller).post('/memberships', { subject: 'x', role: 'STAFF' })).status,
    ).toBe(403)
    expect((await t.as(t.owner.caller).get('/memberships')).body.data).toHaveLength(3)
  })

  it('revoking a member cuts access immediately; re-adding reactivates', async () => {
    const t = await tenantWithOwner()
    const staff = await t.member('STAFF')
    expect((await t.as(staff.caller).get('/stores')).status).toBe(200)

    const revoked = await t.as(t.owner.caller).del(`/memberships/${staff.membershipId}`)
    expect(revoked.body.revokedAt).not.toBeNull()
    expect((await t.as(staff.caller).get('/stores')).status).toBe(404)

    const again = await t
      .as(t.owner.caller)
      .post('/memberships', { subject: staff.subject, role: 'MANAGER' })
    expect(again.status).toBe(201)
    expect(again.body.id).toBe(staff.membershipId)
    expect((await t.as(staff.caller).get('/stores')).status).toBe(200)
  })

  it('rejects duplicate members', async () => {
    const t = await tenantWithOwner()
    const res = await t
      .as(t.owner.caller)
      .post('/memberships', { subject: t.owner.subject, role: 'STAFF' })
    expect(res.status).toBe(409)
  })

  it('never leaves a tenant without an owner', async () => {
    const t = await tenantWithOwner()
    const list = await t.as(t.owner.caller).get('/memberships')
    const ownerId = list.body.data[0].id
    expect((await t.as(t.owner.caller).del(`/memberships/${ownerId}`)).status).toBe(409)
    expect(
      (await t.as(t.owner.caller).patch(`/memberships/${ownerId}`, { role: 'STAFF' })).status,
    ).toBe(409)

    await t.member('OWNER')
    expect(
      (await t.as(t.owner.caller).patch(`/memberships/${ownerId}`, { role: 'STAFF' })).status,
    ).toBe(200)
  })
})
