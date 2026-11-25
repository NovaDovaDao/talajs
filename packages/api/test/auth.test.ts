import { describe, expect, it } from 'vitest'
import {
  ACCESS_AUD,
  ACCESS_TEAM,
  AUDIENCE,
  app,
  call,
  ISSUER,
  SERVICE_TOKEN,
  service,
  sign,
} from './helpers.js'

describe('authentication', () => {
  it('requires credentials', async () => {
    const res = await call(null, 'GET', '/v1/me')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('unauthenticated')
  })

  it('accepts a valid OIDC token', async () => {
    const res = await call({ bearer: await sign('alice') }, 'GET', '/v1/me')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      kind: 'staff',
      subject: 'alice',
      email: null,
      emailVerified: false,
      name: null,
      canCreateTenant: false,
      memberships: [],
    })
  })

  it.each([
    ['wrong issuer', { issuer: 'https://evil.example' }],
    ['wrong audience', { audience: 'someone-else' }],
    ['expired', { expiresIn: '-1m' }],
  ])('rejects an OIDC token with %s', async (_, options) => {
    expect((await call({ bearer: await sign('alice', options) }, 'GET', '/v1/me')).status).toBe(401)
  })

  it('rejects tokens signed by another key and garbage tokens', async () => {
    const forged = `${(await sign('alice')).slice(0, -10)}AAAAAAAAAA`
    expect((await call({ bearer: forged }, 'GET', '/v1/me')).status).toBe(401)
    expect((await call({ bearer: 'not-a-jwt' }, 'GET', '/v1/me')).status).toBe(401)
  })

  it('accepts Cloudflare Access assertions and uses the lower-cased email as subject', async () => {
    const access = await sign('access-sub', {
      issuer: `https://${ACCESS_TEAM}`,
      audience: ACCESS_AUD,
      claims: { email: 'Barista@Example.com' },
    })
    const res = await call({ access }, 'GET', '/v1/me')
    expect(res.status).toBe(200)
    expect(res.body.subject).toBe('barista@example.com')
  })

  it('maps Access service tokens to service-token:<client id>', async () => {
    const access = await sign(undefined, {
      issuer: `https://${ACCESS_TEAM}`,
      audience: ACCESS_AUD,
      claims: { common_name: 'abc123.access' },
    })
    expect((await call({ access }, 'GET', '/v1/me')).body.subject).toBe(
      'service-token:abc123.access',
    )
  })

  it('rejects Access assertions for another application', async () => {
    const access = await sign('x', {
      issuer: `https://${ACCESS_TEAM}`,
      audience: 'other-app',
      claims: { email: 'a@b.c' },
    })
    expect((await call({ access }, 'GET', '/v1/me')).status).toBe(401)
  })

  it('accepts the service token and rejects near misses', async () => {
    expect((await call(service, 'GET', '/v1/me')).body.kind).toBe('service')
    expect((await call({ bearer: `${SERVICE_TOKEN}x` }, 'GET', '/v1/me')).status).toBe(401)
  })

  it('does not let a staff token use the OIDC issuer for Access, or vice versa', async () => {
    const oidcToken = await sign('alice')
    expect((await call({ access: oidcToken }, 'GET', '/v1/me')).status).toBe(401)
    expect(ISSUER).not.toBe(`https://${ACCESS_TEAM}`)
    expect(AUDIENCE).not.toBe(ACCESS_AUD)
  })
})

describe('public surface', () => {
  it('serves the OpenAPI document without auth', async () => {
    const res = await app.request('/openapi.json')
    expect(res.status).toBe(200)
    const doc = (await res.json()) as {
      paths: Record<string, unknown>
      components: { schemas: Record<string, unknown> }
    }
    expect(doc.paths['/v1/tenants/{tenantId}/items']).toBeDefined()
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(['Item', 'Error', 'Customer']),
    )
  })

  it('returns JSON errors for unknown routes', async () => {
    const res = await call(service, 'GET', '/v1/nope')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('not_found')
  })
})
