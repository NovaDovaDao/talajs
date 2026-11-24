import { makeCreateDb, type PrismaClientConstructor } from './db.js'
import { PrismaClient } from './generated/workerd/client.js'

export { type CreateDbOptions, type DbDriver, detectDriver, type TalaDb } from './db.js'
// enums.ts is identical in both clients (no imports); share one so types are nameable.
export * from './generated/node/enums.js'
export { Prisma } from './generated/workerd/client.js'
export { scopeToTenant, type TenantDb, TenantScopeError } from './tenant.js'
export type * from './types.js'

// The workerd and nodejs generated clients are produced from the same schema and differ only in
// how the query-compiler wasm is loaded, but TypeScript sees them as unrelated nominal types.
// All public types are expressed in terms of the nodejs client; this cast bridges the two.
export const createDb = makeCreateDb(PrismaClient as unknown as PrismaClientConstructor)
