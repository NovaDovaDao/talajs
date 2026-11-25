import { type AuditAction, type AuditListQuery, uuidv7 } from '@talajs/contracts'
import type { Prisma } from '@talajs/db'
import { toPage, withCursor } from '../lib/pagination.js'
import type { TenantContext, TenantTx } from '../types.js'

export interface AuditRecord {
  actor: string
  action: AuditAction
  subjectType: 'invitation' | 'membership' | 'terminal' | 'tenant'
  subjectId: string
  details?: Record<string, unknown>
}

/** Append to the tenant's audit log, inside the transaction that made the change. */
export async function audit(tx: TenantTx, tenantId: string, record: AuditRecord) {
  await tx.auditLog.create({
    data: {
      id: uuidv7(),
      tenantId,
      actor: record.actor,
      action: record.action,
      subjectType: record.subjectType,
      subjectId: record.subjectId,
      details: (record.details ?? {}) as Prisma.InputJsonValue,
    },
  })
}

export async function listAudit(ctx: TenantContext, query: AuditListQuery) {
  const rows = await ctx.db.auditLog.findMany({
    where: withCursor(query.subjectId ? { subjectId: query.subjectId } : {}, query, 'desc'),
    orderBy: { id: 'desc' },
    take: query.limit + 1,
  })
  return toPage(rows, query.limit)
}
