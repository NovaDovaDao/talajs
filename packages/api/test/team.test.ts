import { env } from 'cloudflare:workers'
import { uuidv7 } from '@talajs/contracts'
import { describe, expect, it } from 'vitest'
import type { EmailMessage, Mailer } from '../src/index.js'
import { cafe } from './fixtures.js'
import {
  type Caller,
  call,
  createTestApp,
  service,
  sign,
  tenantWithOwner,
  testDb,
} from './helpers.js'

const sent: EmailMessage[] = []
const mailer: Mailer = {
  async send(message) {
    sent.push(message)
    return { id: `email-${sent.length}` }
  },
}
let mailerFails = false
const flakyMailer: Mailer = {
  async send(message) {
    if (mailerFails) throw new Error('smtp down')
    return mailer.send(message)
  },
}

const ORIGIN = 'https://cafe.example'
const app = createTestApp({
  invitations: { acceptUrl: (token) => `${ORIGIN}/admin/invite/${token}`, mailer: flakyMailer },
  allowSelfServeTenants: { maxTenantsPerPerson: 2 },
})
/** No mailer configured: the link comes back in the response. */
const noMailApp = createTestApp({
  invitations: { acceptUrl: (token) => `${ORIGIN}/admin/invite/${token}` },
})
const plainApp = createTestApp()

/** A person signed in through OIDC with an email claim. */
async function person(email = `p-${uuidv7()}@example.com`, verified = true) {
  const subject = `ba:${uuidv7()}`
  const caller: Caller = {
    bearer: await sign(subject, { claims: { email, email_verified: verified, name: 'Sam' } }),
  }
  return { subject, email, caller }
}

const lastLink = () => {
  const text = sent.at(-1)?.text ?? ''
  return /https:\/\/cafe\.example\/admin\/invite\/(\S+)/.exec(text)?.[1] as string
}

describe('invitations', () => {
  it('invites by email, previews, and accepts with the matching verified email', async () => {
    const t = await tenantWithOwner('USD', app)
    const sam = await person()
    const created = await t
      .as(t.owner.caller)
      .post('/invitations', { email: sam.email.toUpperCase(), role: 'STAFF' })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      email: sam.email,
      role: 'STAFF',
      status: 'PENDING',
      delivery: 'sent',
      acceptUrl: null,
    })
    expect(created.body).not.toHaveProperty('tokenHash')
    expect(sent.at(-1)).toMatchObject({
      to: sam.email,
      idempotencyKey: `invitation/${created.body.id}/1`,
    })
    const token = lastLink()
    expect(token).toMatch(/^tala_i_/)

    const preview = await call(null, 'GET', `/v1/invitations/${token}`, undefined, app)
    expect(preview.status).toBe(200)
    expect(preview.body).toMatchObject({ tenantName: 'Test Café', role: 'STAFF' })
    expect(preview.body.email).toMatch(/^p•••@example\.com$/)

    const accepted = await call(sam.caller, 'POST', '/v1/invitations/accept', { token }, app)
    expect(accepted.status).toBe(200)
    expect(accepted.body.membership).toMatchObject({
      subject: sam.subject,
      role: 'STAFF',
      email: sam.email,
      displayName: 'Sam',
    })
    expect((await t.as(sam.caller).get('/items')).status).toBe(200)

    // Single use.
    const again = await call(sam.caller, 'POST', '/v1/invitations/accept', { token }, app)
    expect(again.body.error.code).toBe('invitation_invalid')
    expect(
      (await call(null, 'GET', `/v1/invitations/${token}`, undefined, app)).body.error.code,
    ).toBe('invitation_invalid')
    const list = await t.as(t.owner.caller).get('/invitations?status=ACCEPTED')
    expect(list.body.data.map((i: { id: string }) => i.id)).toEqual([created.body.id])
  })

  it('rejects a different or unverified email, and only one of two racing accepts wins', async () => {
    const t = await tenantWithOwner('USD', app)
    const email = `r-${uuidv7()}@example.com`
    await t.as(t.owner.caller).post('/invitations', { email, role: 'STAFF' })
    const token = lastLink()

    const other = await person()
    const mismatch = await call(other.caller, 'POST', '/v1/invitations/accept', { token }, app)
    expect([mismatch.status, mismatch.body.error.code]).toEqual([403, 'email_mismatch'])
    const unverified = await person(email, false)
    const res = await call(unverified.caller, 'POST', '/v1/invitations/accept', { token }, app)
    expect([res.status, res.body.error.code]).toEqual([403, 'email_unverified'])
    const terminalLike = await call(service, 'POST', '/v1/invitations/accept', { token }, app)
    expect(terminalLike.status).toBe(403)

    const a = await person(email)
    const b = await person(email) // same email, another account (e.g. a second sign-in method)
    const results = await Promise.all([
      call(a.caller, 'POST', '/v1/invitations/accept', { token }, app),
      call(b.caller, 'POST', '/v1/invitations/accept', { token }, app),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const members = await t.as(t.owner.caller).get('/memberships')
    expect(members.body.data.filter((m: { email: string }) => m.email === email)).toHaveLength(1)
  })

  it('enforces who may invite whom', async () => {
    const ctx = await cafe({ target: app })
    const { t } = ctx
    const other = (
      await t.as(t.owner.caller).post('/stores', { name: 'Two', slug: 'two', currency: 'USD' })
    ).body
    const manager = await t.member('MANAGER')
    const localManager = await t.member('MANAGER', [ctx.store.id])
    const staff = await t.member('STAFF')
    const email = () => `w-${uuidv7()}@example.com`

    expect(
      (await t.as(staff.caller).post('/invitations', { email: email(), role: 'STAFF' })).status,
    ).toBe(403)
    expect(
      (await t.as(manager.caller).post('/invitations', { email: email(), role: 'STAFF' })).status,
    ).toBe(201)
    expect(
      (await t.as(manager.caller).post('/invitations', { email: email(), role: 'MANAGER' })).status,
    ).toBe(403)
    expect(
      (await t.as(t.owner.caller).post('/invitations', { email: email(), role: 'MANAGER' })).status,
    ).toBe(201)
    const lm = t.as(localManager.caller)
    expect((await lm.post('/invitations', { email: email(), role: 'STAFF' })).status).toBe(403) // all stores
    expect(
      (await lm.post('/invitations', { email: email(), role: 'STAFF', storeIds: [other.id] }))
        .status,
    ).toBe(403)
    expect(
      (await lm.post('/invitations', { email: email(), role: 'STAFF', storeIds: [ctx.store.id] }))
        .status,
    ).toBe(201)
  })

  it('re-sends with a new link, revokes, and keeps one pending invitation per email', async () => {
    const t = await tenantWithOwner('USD', app)
    const owner = t.as(t.owner.caller)
    const sam = await person()
    const created = await owner.post('/invitations', { email: sam.email, role: 'STAFF' })
    const first = lastLink()
    const dup = await owner.post('/invitations', { email: sam.email, role: 'MANAGER' })
    expect(dup.status).toBe(409)
    expect(dup.body.error.details.invitationId).toBe(created.body.id)

    const resent = await owner.post(`/invitations/${created.body.id}/resend`)
    expect(resent.body).toMatchObject({ sendCount: 2, delivery: 'sent' })
    expect(sent.at(-1)?.idempotencyKey).toBe(`invitation/${created.body.id}/2`)
    const second = lastLink()
    expect(second).not.toBe(first)
    expect((await call(null, 'GET', `/v1/invitations/${first}`, undefined, app)).status).toBe(404)

    const revoked = await owner.post(`/invitations/${created.body.id}/revoke`)
    expect(revoked.body.status).toBe('REVOKED')
    const res = await call(sam.caller, 'POST', '/v1/invitations/accept', { token: second }, app)
    expect(res.body.error.code).toBe('invitation_invalid')
    // Revoking frees the email for a new invitation.
    expect((await owner.post('/invitations', { email: sam.email, role: 'STAFF' })).status).toBe(201)
  })

  it('reports delivery failures and returns the link when no mailer is configured', async () => {
    const t = await tenantWithOwner('USD', app)
    mailerFails = true
    try {
      const failed = await t
        .as(t.owner.caller)
        .post('/invitations', { email: `f-${uuidv7()}@example.com`, role: 'STAFF' })
      expect(failed.body).toMatchObject({ status: 'PENDING', delivery: 'failed', acceptUrl: null })
    } finally {
      mailerFails = false
    }
    const n = await tenantWithOwner('USD', noMailApp)
    const skipped = await n
      .as(n.owner.caller)
      .post('/invitations', { email: `s-${uuidv7()}@example.com`, role: 'STAFF' })
    expect(skipped.body.delivery).toBe('skipped')
    expect(skipped.body.acceptUrl).toMatch(/^https:\/\/cafe\.example\/admin\/invite\/tala_i_/)
    const p = await tenantWithOwner('USD', plainApp)
    expect(
      (await p.as(p.owner.caller).post('/invitations', { email: 'x@example.com', role: 'STAFF' }))
        .status,
    ).toBe(404)
  })

  it("isolates tenants: another tenant's owner can't see or revoke an invitation", async () => {
    const a = await tenantWithOwner('USD', app)
    const b = await tenantWithOwner('USD', app)
    const inv = await a
      .as(a.owner.caller)
      .post('/invitations', { email: `i-${uuidv7()}@example.com`, role: 'STAFF' })
    expect((await b.as(b.owner.caller).get('/invitations')).body.data).toEqual([])
    expect((await b.as(b.owner.caller).post(`/invitations/${inv.body.id}/revoke`)).status).toBe(404)
    // Tenant B's owner can't use A's path either.
    expect(
      (await call(b.owner.caller, 'GET', `${a.base}/invitations`, undefined, app)).status,
    ).toBe(404)
  })

  it('revoking a membership takes effect on the next request', async () => {
    const t = await tenantWithOwner('USD', app)
    const sam = await person()
    await t.as(t.owner.caller).post('/invitations', { email: sam.email, role: 'STAFF' })
    const accepted = await call(
      sam.caller,
      'POST',
      '/v1/invitations/accept',
      { token: lastLink() },
      app,
    )
    expect((await t.as(sam.caller).get('/items')).status).toBe(200)
    await t.as(t.owner.caller).del(`/memberships/${accepted.body.membership.id}`)
    expect((await t.as(sam.caller).get('/items')).status).toBe(404)
  })
})

describe('self-serve tenants', () => {
  const body = () => ({ name: 'My Café', slug: `s-${uuidv7()}`, defaultCurrency: 'USD' })

  it('is off by default', async () => {
    const sam = await person()
    const me = await call(sam.caller, 'GET', '/v1/me', undefined, plainApp)
    expect(me.body).toMatchObject({ email: sam.email, emailVerified: true, canCreateTenant: false })
    expect((await call(sam.caller, 'POST', '/v1/tenants', body(), plainApp)).status).toBe(403)
  })

  it('lets a verified person create a business, up to the limit', async () => {
    const sam = await person()
    expect((await call(sam.caller, 'GET', '/v1/me', undefined, app)).body.canCreateTenant).toBe(
      true,
    )
    const created = await call(sam.caller, 'POST', '/v1/tenants', body(), app)
    expect(created.status).toBe(201)
    const me = await call(sam.caller, 'GET', '/v1/me', undefined, app)
    expect(me.body.memberships).toMatchObject([{ tenantId: created.body.id, role: 'OWNER' }])
    expect(
      (await call(sam.caller, 'POST', '/v1/tenants', { ...body(), ownerSubject: 'x' }, app)).status,
    ).toBe(400)
    expect((await call(sam.caller, 'POST', '/v1/tenants', body(), app)).status).toBe(201)
    expect((await call(sam.caller, 'POST', '/v1/tenants', body(), app)).status).toBe(403)

    const unverified = await person(undefined, false)
    const res = await call(unverified.caller, 'POST', '/v1/tenants', body(), app)
    expect([res.status, res.body.error.code]).toEqual([403, 'email_unverified'])
  })
})

describe('staff PINs', () => {
  const db = testDb(env)
  async function setup() {
    const ctx = await cafe({ target: app })
    const created = await ctx.api.post('/terminals', {
      storeId: ctx.store.id,
      name: 'Front',
      code: 'T1',
    })
    const paired = await call(
      null,
      'POST',
      '/v1/terminal/pair',
      { pairingCode: created.body.pairingCode },
      app,
    )
    const reg = ctx.t.as({ bearer: paired.body.token })
    const staff = await ctx.t.member('STAFF')
    const manager = await ctx.t.member('MANAGER')
    return { ...ctx, reg, staff, manager, terminalId: created.body.terminal.id as string }
  }

  it('sets PINs with the right length, unique within a store, by the right people', async () => {
    const { t, staff, manager } = await setup()
    const asStaff = t.as(staff.caller)
    expect(
      (await asStaff.put(`/memberships/${staff.membershipId}/pin`, { pin: '12345' })).status,
    ).toBe(400)
    expect(
      (await asStaff.put(`/memberships/${staff.membershipId}/pin`, { pin: '1234' })).status,
    ).toBe(204)
    expect(
      (await asStaff.put(`/memberships/${manager.membershipId}/pin`, { pin: '9999' })).status,
    ).toBe(403)
    const taken = await t
      .as(manager.caller)
      .put(`/memberships/${manager.membershipId}/pin`, { pin: '1234' })
    expect(taken.status).toBe(409)
    // A manager can reset a staff member's PIN; only an owner can change a manager's.
    expect((await t.as(manager.caller).del(`/memberships/${staff.membershipId}/pin`)).status).toBe(
      204,
    )
    expect(
      (await t.as(t.owner.caller).put(`/memberships/${manager.membershipId}/pin`, { pin: '1234' }))
        .status,
    ).toBe(204)

    expect((await t.as(t.owner.caller).patch('', { pinLength: 6 })).body.pinLength).toBe(6)
    expect(
      (await asStaff.put(`/memberships/${staff.membershipId}/pin`, { pin: '4321' })).status,
    ).toBe(400)

    const list = await t.as(t.owner.caller).get('/memberships')
    const byId = new Map(
      list.body.data.map((m: { id: string; hasPin: boolean }) => [m.id, m.hasPin]),
    )
    expect([byId.get(staff.membershipId), byId.get(manager.membershipId)]).toEqual([false, true])
    expect(list.body.data[0]).not.toHaveProperty('pinDigest')

    const audit = await t.as(t.owner.caller).get('/audit-log')
    expect(audit.body.data.map((e: { action: string }) => e.action).slice(0, 4)).toEqual([
      'tenant.updated',
      'pin.set',
      'pin.cleared',
      'pin.set',
    ])
    expect((await t.as(manager.caller).get('/audit-log')).status).toBe(403)
  })

  it('checks PINs at a register and locks after 5 wrong ones', async () => {
    const { t, reg, staff, terminalId } = await setup()
    await t.as(staff.caller).put(`/memberships/${staff.membershipId}/pin`, { pin: '2468' })
    const ok = await reg.post('/sync/pin', { pin: '2468' })
    expect(ok.body).toMatchObject({ id: staff.membershipId, role: 'STAFF', active: true })
    expect(ok.body).not.toHaveProperty('pinDigest')
    expect((await t.as(staff.caller).post('/sync/pin', { pin: '2468' })).status).toBe(403)

    for (let i = 4; i >= 1; i--) {
      const bad = await reg.post('/sync/pin', { pin: '0000' })
      expect([bad.status, bad.body.error.code, bad.body.error.details.attemptsLeft]).toEqual([
        403,
        'invalid_pin',
        i,
      ])
    }
    const locked = await reg.post('/sync/pin', { pin: '0000' })
    expect([locked.status, locked.body.error.code]).toEqual([423, 'pin_locked'])
    // Locked even for the right PIN, until it expires.
    expect((await reg.post('/sync/pin', { pin: '2468' })).status).toBe(423)
    const audit = await t.as(t.owner.caller).get(`/audit-log?subjectId=${terminalId}`)
    expect(audit.body.data.map((e: { action: string }) => e.action)).toEqual(['pin.locked'])

    await db.client.terminal.update({
      where: { id: terminalId },
      data: { pinLockedUntil: new Date(Date.now() - 1) },
    })
    expect((await reg.post('/sync/pin', { pin: '2468' })).status).toBe(200)
  })

  it('sends registers a staff feed and records PIN attribution on synced sales', async () => {
    const { t, reg, staff, store, terminalId } = await setup()
    await t.as(staff.caller).put(`/memberships/${staff.membershipId}/pin`, { pin: '1357' })
    let staffChange: any
    for (let i = 0; i < 50 && !staffChange?.data?.pinDigest; i++) {
      let cursor: string | undefined
      let more = true
      while (more) {
        const page = await reg.get(`/sync/pull?limit=500${cursor ? `&cursor=${cursor}` : ''}`)
        staffChange =
          page.body.changes.find((c: any) => c.entity === 'staff' && c.id === staff.membershipId) ??
          staffChange
        cursor = page.body.cursor
        more = page.body.hasMore
      }
      if (!staffChange?.data?.pinDigest) await new Promise((r) => setTimeout(r, 100))
    }
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${staff.membershipId}:1357`),
    )
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    expect(staffChange.data).toEqual({
      id: staff.membershipId,
      displayName: null,
      role: 'STAFF',
      active: true,
      pinDigest: hex,
    })

    const orderId = uuidv7()
    const res = await reg.post('/sync/push', {
      mutations: [
        {
          id: uuidv7(),
          clientTs: new Date().toISOString(),
          type: 'order.open',
          payload: { orderId },
          actorMembershipId: staff.membershipId,
        },
        {
          id: uuidv7(),
          clientTs: new Date().toISOString(),
          type: 'order.open',
          payload: { orderId: uuidv7() },
          actorMembershipId: uuidv7(),
        },
      ],
    })
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      'APPLIED',
      'APPLIED',
    ])
    const order = await db.forTenant(t.tenantId).order.findUnique({ where: { id: orderId } })
    expect(order?.openedBy).toBe(`pin:${staff.membershipId}@terminal:${terminalId}`)
    expect(store.id).toBeTruthy()
  })
})
