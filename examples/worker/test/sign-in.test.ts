import { exports } from 'cloudflare:workers'
import { uuidv7 } from '@talajs/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGIN = 'https://pos.example.com'
const SERVICE = 'test-service-token-0123456789abcdef0123456789'

async function call(
  path: string,
  init: { method?: string; body?: unknown; bearer?: string; cookie?: string } = {},
) {
  const headers = new Headers({ origin: ORIGIN, 'cf-connecting-ip': '198.51.100.7' })
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  if (init.bearer) headers.set('authorization', `Bearer ${init.bearer}`)
  if (init.cookie) headers.set('cookie', init.cookie)
  const res = await exports.default.fetch(`${ORIGIN}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    redirect: 'manual',
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {}
  return { status: res.status, body: json, headers: res.headers }
}

afterEach(() => vi.restoreAllMocks())

describe('merchant sign-in through the example Worker', () => {
  it('invites, signs in with an emailed link, and accepts', async () => {
    // Without RESEND_API_KEY the example logs emails; read the links from the log.
    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      logged.push(args.join(' '))
    })
    const link = (prefix: string) =>
      logged
        .map((l) => new RegExp(`(${prefix.replace(/[/.]/g, '\\$&')}\\S+)`).exec(l)?.[1])
        .filter(Boolean)
        .at(-1) as string

    const tenant = await call('/tala/v1/tenants', {
      bearer: SERVICE,
      body: {
        name: 'Example Café',
        slug: `e-${uuidv7()}`,
        defaultCurrency: 'USD',
        ownerSubject: 'ops@example.com',
      },
    })
    expect(tenant.status).toBe(201)
    const email = `barista-${uuidv7()}@example.com`
    const invite = await call(`/tala/v1/tenants/${tenant.body.id}/invitations`, {
      bearer: SERVICE,
      body: { email, role: 'STAFF' },
    })
    expect(invite.body.delivery).toBe('sent')
    const acceptUrl = link(`${ORIGIN}/admin/invite/`)
    const token = acceptUrl.split('/').at(-1) as string

    const preview = await call(`/tala/v1/invitations/${token}`)
    expect(preview.body.tenantName).toBe('Example Café')

    expect(
      (await call('/tala/auth/sign-in/magic-link', { body: { email, callbackURL: '/admin/' } }))
        .status,
    ).toBe(200)
    const verify = new URL(link(`${ORIGIN}/tala/auth/magic-link/verify`))
    const signedIn = await call(`${verify.pathname}${verify.search}`)
    expect(signedIn.status).toBe(302)
    const cookie = signedIn.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .find((c) => c?.includes('tala.session_token=')) as string
    expect(cookie).toBeTruthy()

    const accepted = await call('/tala/v1/invitations/accept', { cookie, body: { token } })
    expect(accepted.status).toBe(200)
    const me = await call('/tala/v1/me', { cookie })
    expect(me.body.memberships).toMatchObject([{ tenantName: 'Example Café', role: 'STAFF' }])
  })
})
