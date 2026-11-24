import { env } from 'cloudflare:workers'
import { uuidv7 } from '@talajs/contracts'
import { createDb } from '@talajs/db'
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose'
import { cloudflareAccess } from '../src/auth/cloudflare-access.js'
import { oidc } from '../src/auth/oidc.js'
import { serviceToken } from '../src/auth/service-token.js'
import { createTalaApp, type TalaAppOptions } from '../src/index.js'

export const SERVICE_TOKEN = 'test-service-token-0123456789abcdef0123456789'
export const ISSUER = 'https://idp.example.test'
export const AUDIENCE = 'tala-api'
export const ACCESS_TEAM = 'team.cloudflareaccess.com'
export const ACCESS_AUD = 'access-aud-tag'

const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }
export const jwks = { keys: [jwk] }

export const testDb = (e: Cloudflare.Env) =>
  createDb({ url: e.HYPERDRIVE.connectionString, driver: 'pg' })

type Extra = Omit<TalaAppOptions<Cloudflare.Env>, 'db' | 'auth'>

export function createTestApp(extra: Extra = {}) {
  return createTalaApp<Cloudflare.Env>({
    db: testDb,
    auth: [
      serviceToken({ token: SERVICE_TOKEN }),
      oidc({ issuer: ISSUER, audience: AUDIENCE, jwks }),
      cloudflareAccess({ teamDomain: ACCESS_TEAM, audience: ACCESS_AUD, jwks }),
    ],
    ...extra,
  })
}

export const app = createTestApp()
export type TestApp = typeof app

export interface TokenOptions {
  issuer?: string
  audience?: string
  expiresIn?: string
  claims?: Record<string, unknown>
}

export function sign(subject: string | undefined, options: TokenOptions = {}) {
  const jwt = new SignJWT(options.claims ?? {})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '5m')
  if (subject) jwt.setSubject(subject)
  return jwt.sign(privateKey)
}

export type Caller = { bearer: string } | { access: string } | null

/** A fresh, unique staff subject with a signed OIDC token. */
export async function user(name = 'user'): Promise<{ subject: string; caller: Caller }> {
  const subject = `${name}-${uuidv7()}`
  return { subject, caller: { bearer: await sign(subject) } }
}

export const service: Caller = { bearer: SERVICE_TOKEN }

export async function call(
  caller: Caller,
  method: string,
  path: string,
  body?: unknown,
  target: TestApp = app,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {}
  if (caller && 'bearer' in caller) headers.authorization = `Bearer ${caller.bearer}`
  if (caller && 'access' in caller) headers['cf-access-jwt-assertion'] = caller.access
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await target.request(
    path,
    { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    env,
  )
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

/** Provision a tenant owned by a new user; returns helpers bound to it. */
export async function tenantWithOwner(currency = 'USD', target: TestApp = app) {
  const owner = await user('owner')
  const slug = `t-${uuidv7()}`
  const res = await call(
    service,
    'POST',
    '/v1/tenants',
    { name: 'Test Café', slug, defaultCurrency: currency, ownerSubject: owner.subject },
    target,
  )
  if (res.status !== 201) throw new Error(`tenant setup failed: ${JSON.stringify(res.body)}`)
  const tenantId: string = res.body.id
  const base = `/v1/tenants/${tenantId}`
  return {
    tenantId,
    base,
    owner,
    as: (caller: Caller) => ({
      get: (p: string) => call(caller, 'GET', `${base}${p}`, undefined, target),
      post: (p: string, b?: unknown) => call(caller, 'POST', `${base}${p}`, b ?? {}, target),
      patch: (p: string, b: unknown) => call(caller, 'PATCH', `${base}${p}`, b, target),
      put: (p: string, b: unknown) => call(caller, 'PUT', `${base}${p}`, b, target),
      del: (p: string) => call(caller, 'DELETE', `${base}${p}`, undefined, target),
    }),
    /** Add a member with a role; returns their caller. */
    async member(role: 'OWNER' | 'MANAGER' | 'STAFF', storeIds: string[] = []) {
      const m = await user(role.toLowerCase())
      const r = await call(
        owner.caller,
        'POST',
        `${base}/memberships`,
        { subject: m.subject, role, storeIds },
        target,
      )
      if (r.status !== 201) throw new Error(`member setup failed: ${JSON.stringify(r.body)}`)
      return { ...m, membershipId: r.body.id as string }
    },
  }
}
