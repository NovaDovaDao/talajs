import { env } from 'cloudflare:workers'
import { consumeRateLimit, createTalaApp, type EmailMessage, type Mailer } from '@talajs/api'
import { serviceToken } from '@talajs/api/auth/service-token'
import { uuidv7 } from '@talajs/contracts'
import { createDb } from '@talajs/db'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { createTalaAuth } from '../src/index.js'

const ORIGIN = 'https://cafe.example'
const SERVICE = 'test-service-token-0123456789abcdef0123456789'
const db = (e: Cloudflare.Env) => createDb({ url: e.HYPERDRIVE.connectionString, driver: 'pg' })

const inbox: EmailMessage[] = []
const mailer: Mailer = {
  async send(message) {
    inbox.push(message)
    return { id: String(inbox.length) }
  },
}

/** A consumer Worker: Better Auth at /tala/auth, the API at /tala. */
function worker({ password = false, selfServe = false } = {}) {
  const auth = createTalaAuth<Cloudflare.Env>({
    db,
    secret: 'test-secret-test-secret-test-secret-0123',
    baseURL: `${ORIGIN}/tala/auth`,
    mailer,
    appName: 'Test Café',
    methods: { magicLink: true, password },
    allowSelfServeTenants: selfServe,
  })
  const app = new Hono<{ Bindings: Cloudflare.Env }>()
  app.on(['GET', 'POST'], '/tala/auth/*', (c) => auth.handler(c.req.raw, c.env))
  app.route(
    '/tala',
    createTalaApp<Cloudflare.Env>({
      db,
      auth: [auth.adapter, serviceToken({ token: SERVICE })],
      invitations: { acceptUrl: (token) => `${ORIGIN}/admin/invite/${token}`, mailer },
      allowSelfServeTenants: selfServe,
    }),
  )
  return app
}

const magicOnly = worker()
const withPassword = worker({ password: true })
const selfServe = worker({ selfServe: true })
type App = typeof magicOnly

/** A fresh client IP per request, so per-IP rate limits don't leak between tests. */
const freshIp = () => {
  const hex = crypto.randomUUID().replace(/-/g, '')
  return `2001:db8:${hex.slice(0, 4)}:${hex.slice(4, 8)}:${hex.slice(8, 12)}:${hex.slice(12, 16)}:${hex.slice(16, 20)}:${hex.slice(20, 24)}`
}

async function req(
  app: App,
  method: string,
  path: string,
  {
    body,
    cookie,
    ip,
    bearer,
  }: { body?: unknown; cookie?: string; ip?: string; bearer?: string } = {},
) {
  const headers = new Headers({ origin: ORIGIN, 'cf-connecting-ip': ip ?? freshIp() })
  if (body !== undefined) headers.set('content-type', 'application/json')
  if (cookie) headers.set('cookie', cookie)
  if (bearer) headers.set('authorization', `Bearer ${bearer}`)
  const res = await app.request(
    `${ORIGIN}${path}`,
    {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    },
    env,
  )
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {}
  return { status: res.status, body: json, headers: res.headers }
}

const sessionCookie = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((c) => c.split(';')[0] as string)
    .find((c) => c.includes('tala.session_token=')) ?? ''

const lastLinkTo = (to: string) => {
  const mail = inbox.filter((m) => m.to === to).at(-1)
  return /(https:\/\/cafe\.example\/\S+)/.exec(mail?.text ?? '')?.[1] ?? ''
}

/** Follow an emailed link the way a browser would; returns the session cookie it sets. */
async function follow(app: App, link: string) {
  const url = new URL(link)
  const res = await req(app, 'GET', `${url.pathname}${url.search}`)
  return { ...res, cookie: sessionCookie(res.headers), location: res.headers.get('location') ?? '' }
}

async function magicSignIn(app: App, email: string) {
  const sent = await req(app, 'POST', '/tala/auth/sign-in/magic-link', {
    body: { email, callbackURL: '/admin/' },
  })
  expect(sent.status).toBe(200)
  return follow(app, lastLinkTo(email))
}

/** A tenant provisioned by the operator, and an invitation to it. */
async function tenantAndInvite(app: App, email: string, role = 'STAFF') {
  const tenant = await req(app, 'POST', '/tala/v1/tenants', {
    bearer: SERVICE,
    body: {
      name: 'Test Café',
      slug: `t-${uuidv7()}`,
      defaultCurrency: 'USD',
      ownerSubject: 'operator',
    },
  })
  expect(tenant.status).toBe(201)
  const base = `/tala/v1/tenants/${tenant.body.id}`
  const inv = await req(app, 'POST', `${base}/invitations`, {
    bearer: SERVICE,
    body: { email, role },
  })
  expect(inv.status).toBe(201)
  const token = /invite\/(\S+)/.exec(lastLinkTo(email))?.[1] as string
  return { tenantId: tenant.body.id as string, base, token, invitationId: inv.body.id as string }
}

const userCount = async (email: string) => {
  const d = db(env)
  try {
    return await d.client.authUser.count({ where: { email } })
  } finally {
    await d.dispose()
  }
}

describe('magic link sign-in (the default)', () => {
  it('is invite-only: no account is created without a pending invitation', async () => {
    const email = `nobody-${uuidv7()}@example.com`
    const link = await magicSignIn(magicOnly, email)
    expect(link.cookie).toBe('')
    expect(await userCount(email)).toBe(0)
  })

  it('signs an invited person up, then they accept and use the API', async () => {
    const email = `sam-${uuidv7()}@example.com`
    const { base, token } = await tenantAndInvite(magicOnly, email)
    const signedIn = await magicSignIn(magicOnly, email)
    expect(signedIn.status).toBe(302)
    // https, so the cookie gets the __Secure- prefix.
    expect(signedIn.cookie).toMatch(/^__Secure-tala\.session_token=/)
    const cookie = signedIn.cookie

    const me = await req(magicOnly, 'GET', '/tala/v1/me', { cookie })
    expect(me.body).toMatchObject({ kind: 'staff', email, emailVerified: true, memberships: [] })
    expect(me.body.subject).toMatch(/^ba:[0-9a-f-]{36}$/)
    expect((await req(magicOnly, 'GET', `${base}/items`, { cookie })).status).toBe(404)

    const accepted = await req(magicOnly, 'POST', '/tala/v1/invitations/accept', {
      cookie,
      body: { token },
    })
    expect(accepted.status).toBe(200)
    expect((await req(magicOnly, 'GET', `${base}/items`, { cookie })).status).toBe(200)
    expect((await req(magicOnly, 'GET', `${base}/memberships`, { cookie })).status).toBe(403) // STAFF
  })

  it('rejects a missing, forged or signed-out session', async () => {
    const email = `out-${uuidv7()}@example.com`
    await tenantAndInvite(magicOnly, email)
    const { cookie } = await magicSignIn(magicOnly, email)
    expect((await req(magicOnly, 'GET', '/tala/v1/me')).status).toBe(401)
    const forged = cookie.replace(/=(.)/, (_, ch) => `=${ch === 'a' ? 'b' : 'a'}`)
    expect((await req(magicOnly, 'GET', '/tala/v1/me', { cookie: forged })).status).toBe(401)
    expect((await req(magicOnly, 'GET', '/tala/v1/me', { cookie })).status).toBe(200)
    await req(magicOnly, 'POST', '/tala/auth/sign-out', { cookie, body: {} })
    expect((await req(magicOnly, 'GET', '/tala/v1/me', { cookie })).status).toBe(401)
  })

  it('"sign out everywhere" revokes every session on the next request', async () => {
    const email = `all-${uuidv7()}@example.com`
    await tenantAndInvite(magicOnly, email)
    const a = (await magicSignIn(magicOnly, email)).cookie
    const b = (await magicSignIn(magicOnly, email)).cookie
    expect(a).not.toBe(b)
    expect(
      (await req(magicOnly, 'POST', '/tala/auth/revoke-sessions', { cookie: a, body: {} })).status,
    ).toBe(200)
    expect((await req(magicOnly, 'GET', '/tala/v1/me', { cookie: a })).status).toBe(401)
    expect((await req(magicOnly, 'GET', '/tala/v1/me', { cookie: b })).status).toBe(401)
  })

  it("keeps tenants apart: a member of one business can't reach another", async () => {
    const email = `iso-${uuidv7()}@example.com`
    const a = await tenantAndInvite(magicOnly, email)
    const other = await tenantAndInvite(magicOnly, `other-${uuidv7()}@example.com`)
    const { cookie } = await magicSignIn(magicOnly, email)
    await req(magicOnly, 'POST', '/tala/v1/invitations/accept', {
      cookie,
      body: { token: a.token },
    })
    expect((await req(magicOnly, 'GET', `${a.base}/items`, { cookie })).status).toBe(200)
    expect((await req(magicOnly, 'GET', `${other.base}/items`, { cookie })).status).toBe(404)
    // Someone else's invitation can't be accepted with this account either.
    const res = await req(magicOnly, 'POST', '/tala/v1/invitations/accept', {
      cookie,
      body: { token: other.token },
    })
    expect(res.body.error.code).toBe('email_mismatch')
  })

  it('revoking the membership locks the person out of the business at once', async () => {
    const email = `rev-${uuidv7()}@example.com`
    const { base, token } = await tenantAndInvite(magicOnly, email)
    const { cookie } = await magicSignIn(magicOnly, email)
    const accepted = await req(magicOnly, 'POST', '/tala/v1/invitations/accept', {
      cookie,
      body: { token },
    })
    await req(magicOnly, 'DELETE', `${base}/memberships/${accepted.body.membership.id}`, {
      bearer: SERVICE,
    })
    expect((await req(magicOnly, 'GET', `${base}/items`, { cookie })).status).toBe(404)
  })

  it('self-serve: anyone can sign up and create a business when enabled', async () => {
    const email = `owner-${uuidv7()}@example.com`
    const { cookie } = await magicSignIn(selfServe, email)
    expect(cookie).not.toBe('')
    const me = await req(selfServe, 'GET', '/tala/v1/me', { cookie })
    expect(me.body.canCreateTenant).toBe(true)
    const created = await req(selfServe, 'POST', '/tala/v1/tenants', {
      cookie,
      body: { name: 'Mine', slug: `m-${uuidv7()}`, defaultCurrency: 'USD' },
    })
    expect(created.status).toBe(201)
    expect(
      (await req(selfServe, 'GET', `/tala/v1/tenants/${created.body.id}/memberships`, { cookie }))
        .body.data,
    ).toMatchObject([{ role: 'OWNER', email }])
  })
})

describe('email and password (opt-in)', () => {
  it('is disabled unless enabled', async () => {
    const email = `pw-${uuidv7()}@example.com`
    await tenantAndInvite(magicOnly, email)
    const res = await req(magicOnly, 'POST', '/tala/auth/sign-up/email', {
      body: { email, password: 'correct horse battery', name: 'Pat' },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('needs an invitation and a confirmed email, and a reset signs out everywhere', async () => {
    const strangerEmail = `s-${uuidv7()}@example.com`
    const stranger = await req(withPassword, 'POST', '/tala/auth/sign-up/email', {
      body: { email: strangerEmail, password: 'correct horse battery', name: 'X' },
    })
    // Refused without saying so (no account enumeration), and no account is created.
    expect(stranger.status).toBeLessThan(500)
    expect(await userCount(strangerEmail)).toBe(0)
    expect(inbox.some((m) => m.to === strangerEmail)).toBe(false)

    const email = `pat-${uuidv7()}@example.com`
    const { token } = await tenantAndInvite(withPassword, email)
    const up = await req(withPassword, 'POST', '/tala/auth/sign-up/email', {
      body: { email, password: 'correct horse battery', name: 'Pat' },
    })
    expect(up.status).toBe(200)
    expect(sessionCookie(up.headers)).toBe('') // not signed in until confirmed
    const early = await req(withPassword, 'POST', '/tala/auth/sign-in/email', {
      body: { email, password: 'correct horse battery' },
    })
    expect(early.status).toBe(403)

    const verified = await follow(withPassword, lastLinkTo(email))
    expect(verified.cookie).not.toBe('')
    const signIn = await req(withPassword, 'POST', '/tala/auth/sign-in/email', {
      body: { email, password: 'correct horse battery' },
    })
    expect(signIn.status).toBe(200)
    const cookie = sessionCookie(signIn.headers)
    expect(
      (await req(withPassword, 'POST', '/tala/v1/invitations/accept', { cookie, body: { token } }))
        .status,
    ).toBe(200)

    await req(withPassword, 'POST', '/tala/auth/request-password-reset', {
      body: { email, redirectTo: '/admin/reset' },
    })
    const resetLink = new URL(lastLinkTo(email))
    const resetToken = resetLink.pathname.split('/').at(-1) as string
    const reset = await req(withPassword, 'POST', '/tala/auth/reset-password', {
      body: { token: resetToken, newPassword: 'a whole new password' },
    })
    expect(reset.status).toBe(200)
    expect((await req(withPassword, 'GET', '/tala/v1/me', { cookie })).status).toBe(401)
    expect(
      (await req(withPassword, 'GET', '/tala/v1/me', { cookie: verified.cookie })).status,
    ).toBe(401)
  })
})

describe('rate limiting', () => {
  it('counts atomically under concurrency', async () => {
    const d = db(env)
    try {
      const key = `test:${uuidv7()}`
      const results = await Promise.all(
        Array.from({ length: 12 }, () => consumeRateLimit(d, key, { window: 60, max: 5 })),
      )
      expect(results.filter((r) => r.allowed)).toHaveLength(5)
      expect(results.find((r) => !r.allowed)?.retryAfter).toBeGreaterThan(0)
      // A new window starts over.
      expect(
        (await consumeRateLimit(d, key, { window: 60, max: 5 }, Date.now() + 61_000)).allowed,
      ).toBe(true)
    } finally {
      await d.dispose()
    }
  })

  it('limits sign-in attempts per IP and links per email', async () => {
    const ip = freshIp()
    const statuses = []
    for (let i = 0; i < 7; i++) {
      const res = await req(withPassword, 'POST', '/tala/auth/sign-in/email', {
        ip,
        body: { email: `nope-${uuidv7()}@example.com`, password: 'wrong password!' },
      })
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true)
    expect(statuses.slice(5)).toEqual([429, 429])

    const email = `flood-${uuidv7()}@example.com`
    await tenantAndInvite(magicOnly, email)
    for (let i = 0; i < 5; i++) {
      await req(magicOnly, 'POST', '/tala/auth/sign-in/magic-link', { body: { email } })
    }
    expect(inbox.filter((m) => m.to === email && m.subject.includes('sign-in link'))).toHaveLength(
      3,
    )
  })
})
