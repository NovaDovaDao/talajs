import type { MemberRole, TalaDb, TenantDb } from '@talajs/db'
import type { Context } from 'hono'
import type { PaymentAdapter } from './payments.js'

/** Who is calling, as established by an auth adapter. */
export interface Identity {
  /**
   * `service` = platform operator: may provision tenants and act in any tenant as OWNER.
   * `terminal` = a paired register: STAFF in its own store, and the only caller of `/sync`.
   */
  kind: 'staff' | 'service' | 'terminal'
  /** Stable identifier: IdP `sub`, or the verified email for Cloudflare Access. */
  subject: string
  /** Verified token claims, for consumers' own hooks. */
  claims?: Record<string, unknown>
  /** Set when `kind` is `terminal`. */
  terminal?: TerminalIdentity
  /** Lower-cased email, when the identity source provides one. Invitations match on it. */
  email?: string
  /** Only a verified email can accept an invitation. */
  emailVerified?: boolean
  /** Display name, when the identity source provides one. */
  name?: string
}

export interface TerminalIdentity {
  id: string
  tenantId: string
  storeId: string
  code: string
}

/** The tenant a request acts in, resolved once by the tenant middleware. */
export interface TenantContext {
  tenantId: string
  /** Tenant-scoped client; the only database handle domain code receives. */
  db: TenantDb
  role: MemberRole
  /** Stores the caller may act in; empty = all stores. */
  storeIds: string[]
  /** Recorded on ledgers and notes. */
  actor: string
  /** The caller's membership, for staff identities. */
  membershipId: string | null
  /** The paired register making the request, if any. */
  terminal: TerminalIdentity | null
  /** Payment adapters configured for this request (cash needs none). */
  payments: readonly PaymentAdapter[]
  /** Ids of domain events written during this request, queued once it succeeds. */
  events: string[]
}

export interface TalaVariables {
  db: TalaDb
  identity: Identity
  tenant: TenantContext
}

export interface TalaEnv<E = unknown> {
  // Hono requires an object type here.
  Bindings: E & object
  Variables: TalaVariables
}

export type TalaContext<E = unknown> = Context<TalaEnv<E>>

/** A value given directly, or read from the Worker env per request. */
export type Configurable<T, E> = T | ((env: E) => T)

export function resolveConfig<T, E>(value: Configurable<T, E>, env: E): T {
  return typeof value === 'function' ? (value as (env: E) => T)(env) : value
}

export interface AuthAdapter<E = unknown> {
  readonly name: string
  /** Return an identity, or null if this adapter doesn't recognise the request. */
  authenticate(c: TalaContext<E>): Promise<Identity | null>
}

/** Tenant-scoped interactive transaction client. */
export type TenantTx = Parameters<Parameters<TenantDb['$transaction']>[0]>[0]
