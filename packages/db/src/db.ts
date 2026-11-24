import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaPg } from '@prisma/adapter-pg'
import type { PrismaClient } from './generated/node/client.js'
import { scopeToTenant, type TenantDb } from './tenant.js'

/**
 * - `neon`: Neon serverless driver over a per-request WebSocket pool. Supports interactive
 *   transactions; holds no connection once the request ends, so the compute can scale to zero.
 * - `pg`: node-postgres. Use with Cloudflare Hyperdrive (requires `nodejs_compat`), local
 *   Postgres, or any non-Neon host.
 *
 * Neon's HTTP mode is deliberately not offered: it cannot run transactions, which order
 * commit and payment processing require.
 */
export type DbDriver = 'neon' | 'pg'

export interface CreateDbOptions {
  /** Postgres connection string (for Hyperdrive, `env.HYPERDRIVE.connectionString`). */
  url: string
  /** Defaults to `neon` for `*.neon.tech` hosts and `pg` otherwise. */
  driver?: DbDriver
}

export interface TalaDb {
  /** Unscoped client. Only for system work (webhook ingestion, tenant provisioning, migrations of data). */
  readonly client: PrismaClient
  /** A client that can only see and write rows belonging to `tenantId`. */
  forTenant(tenantId: string): TenantDb
  /** Close the underlying pool. In a Worker, pass to `ctx.waitUntil(db.dispose())`. */
  dispose(): Promise<void>
}

export function detectDriver(url: string): DbDriver {
  try {
    return new URL(url).hostname.endsWith('.neon.tech') ? 'neon' : 'pg'
  } catch {
    return 'pg'
  }
}

export type PrismaClientConstructor = new (options: {
  adapter: PrismaNeon | PrismaPg
}) => PrismaClient

/** Internal: binds createDb to the runtime-specific generated client. */
export function makeCreateDb(Client: PrismaClientConstructor) {
  return function createDb(options: CreateDbOptions): TalaDb {
    const driver = options.driver ?? detectDriver(options.url)
    const adapter =
      driver === 'neon'
        ? new PrismaNeon({ connectionString: options.url })
        : new PrismaPg({ connectionString: options.url })
    const client = new Client({ adapter })
    return {
      client,
      forTenant: (tenantId) => scopeToTenant(client, tenantId),
      dispose: () => client.$disconnect(),
    }
  }
}
