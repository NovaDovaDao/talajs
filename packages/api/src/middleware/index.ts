import { Id, type MemberRole } from '@talajs/contracts'
import type { TalaDb } from '@talajs/db'
import { createMiddleware } from 'hono/factory'
import { bearerToken } from '../auth/jwt.js'
import { forbidden, HttpError, notFound } from '../errors.js'
import { sha256Hex, TERMINAL_TOKEN_PREFIX } from '../lib/secrets.js'
import type { PaymentAdapter } from '../payments.js'
import {
  type AuthAdapter,
  type Configurable,
  type Identity,
  resolveConfig,
  type TalaContext,
  type TalaEnv,
} from '../types.js'

/** One database client per request, disposed after the response (via waitUntil when available). */
export function dbMiddleware<E>(createDb: (env: E) => TalaDb) {
  return createMiddleware<TalaEnv<E>>(async (c, next) => {
    const db = createDb(c.env)
    c.set('db', db)
    try {
      await next()
    } finally {
      const done = db.dispose()
      try {
        c.executionCtx.waitUntil(done)
      } catch {
        await done // no ExecutionContext (e.g. app.request in tests)
      }
    }
  })
}

/** How often a terminal's `lastSeenAt` is refreshed, at most. */
const LAST_SEEN_INTERVAL_MS = 60_000

/**
 * Paired-register tokens (`tala_t_…`) are checked first, against the stored hash; a revoked or
 * unknown token is a 401 rather than falling through to other adapters.
 */
async function authenticateTerminal(db: TalaDb, token: string): Promise<Identity> {
  const terminal = await db.client.terminal.findUnique({
    where: { tokenHash: await sha256Hex(token) },
    select: {
      id: true,
      tenantId: true,
      storeId: true,
      code: true,
      revokedAt: true,
      lastSeenAt: true,
    },
  })
  if (!terminal || terminal.revokedAt) {
    throw new HttpError(401, 'unauthenticated', 'Unknown or revoked terminal token')
  }
  const now = Date.now()
  if (!terminal.lastSeenAt || now - terminal.lastSeenAt.getTime() > LAST_SEEN_INTERVAL_MS) {
    await db.client.terminal.update({
      where: { id: terminal.id },
      data: { lastSeenAt: new Date(now) },
    })
  }
  const { revokedAt, lastSeenAt, ...identity } = terminal
  return { kind: 'terminal', subject: `terminal:${terminal.id}`, terminal: identity }
}

/** First adapter that recognises the request wins; no identity → 401. */
export function authenticate<E>(adapters: AuthAdapter<E>[]) {
  return createMiddleware<TalaEnv<E>>(async (c, next) => {
    const bearer = bearerToken(c.req.header('authorization'))
    if (bearer?.startsWith(TERMINAL_TOKEN_PREFIX)) {
      c.set('identity', await authenticateTerminal(c.get('db'), bearer))
      return next()
    }
    for (const adapter of adapters) {
      const identity = await adapter.authenticate(c)
      if (identity) {
        c.set('identity', identity)
        return next()
      }
    }
    throw new HttpError(401, 'unauthenticated', 'Authentication required')
  })
}

/**
 * Resolve `:tenantId` and the caller's membership. Non-members get 404 (not 403), so tenant
 * ids can't be probed. Downstream handlers only receive the tenant-scoped client.
 */
export function tenantMiddleware<E>(payments?: Configurable<readonly PaymentAdapter[], E>) {
  return createMiddleware<TalaEnv<E>>(async (c, next) => {
    const services = {
      payments: payments ? resolveConfig(payments, c.env) : [],
      events: [] as string[],
    }
    const parsed = Id.safeParse(c.req.param('tenantId'))
    if (!parsed.success) throw notFound('Tenant')
    const tenantId = parsed.data
    const identity = c.get('identity')
    const db = c.get('db')

    if (identity.terminal) {
      if (identity.terminal.tenantId !== tenantId) throw notFound('Tenant')
      const tenant = await db.client.tenant.findUnique({ where: { id: tenantId } })
      if (!tenant) throw notFound('Tenant')
      if (tenant.disabledAt) throw forbidden('Tenant is disabled')
      c.set('tenant', {
        tenantId,
        db: db.forTenant(tenantId),
        role: 'STAFF',
        storeIds: [identity.terminal.storeId],
        actor: identity.subject,
        terminal: identity.terminal,
        ...services,
      })
      return next()
    }

    if (identity.kind === 'service') {
      const tenant = await db.client.tenant.findUnique({ where: { id: tenantId } })
      if (!tenant) throw notFound('Tenant')
      c.set('tenant', {
        tenantId,
        db: db.forTenant(tenantId),
        role: 'OWNER',
        storeIds: [],
        actor: identity.subject,
        terminal: null,
        ...services,
      })
      return next()
    }

    const membership = await db.client.membership.findUnique({
      where: { tenantId_subject: { tenantId, subject: identity.subject } },
      include: { tenant: { select: { disabledAt: true } } },
    })
    if (!membership || membership.revokedAt) throw notFound('Tenant')
    if (membership.tenant.disabledAt) throw forbidden('Tenant is disabled')
    c.set('tenant', {
      tenantId,
      db: db.forTenant(tenantId),
      role: membership.role,
      storeIds: membership.storeIds,
      actor: identity.subject,
      terminal: null,
      ...services,
    })
    return next()
  })
}

const RANK: Record<MemberRole, number> = { STAFF: 1, MANAGER: 2, OWNER: 3 }

export function hasRole(role: MemberRole, minimum: MemberRole): boolean {
  return RANK[role] >= RANK[minimum]
}

export function requireRole<E>(c: TalaContext<E>, minimum: MemberRole) {
  const { role } = c.get('tenant')
  if (!hasRole(role, minimum)) throw forbidden(`Requires role ${minimum} or higher`)
}

export function requireService<E>(c: TalaContext<E>) {
  if (c.get('identity').kind !== 'service') throw forbidden('Requires a service credential')
}

/** For `/sync`: only a paired register can push or pull. */
export function requireTerminal<E>(c: TalaContext<E>) {
  const terminal = c.get('tenant').terminal
  if (!terminal) throw forbidden('Requires a terminal token')
  return terminal
}
