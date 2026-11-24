import { makeCreateDb } from './db.js'
import { PrismaClient } from './generated/node/client.js'

export { type CreateDbOptions, type DbDriver, detectDriver, type TalaDb } from './db.js'
export { Prisma } from './generated/node/client.js'
export * from './generated/node/enums.js'
export { scopeToTenant, type TenantDb, TenantScopeError } from './tenant.js'
export type * from './types.js'

export const createDb = makeCreateDb(PrismaClient)
