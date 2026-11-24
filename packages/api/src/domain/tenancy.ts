import {
  type CreateMembership,
  type CreateTenant,
  type ListQuery,
  type Me,
  type UpdateMembership,
  uuidv7,
} from '@talajs/contracts'
import type { TalaDb } from '@talajs/db'
import { conflict, notFound } from '../errors.js'
import { toPage, withCursor } from '../lib/pagination.js'
import type { Identity, TenantContext } from '../types.js'

const membershipSelect = {
  id: true,
  subject: true,
  role: true,
  storeIds: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

/** System operation (service identity): create a tenant and its first owner. */
export async function createTenant(db: TalaDb, input: CreateTenant) {
  const id = input.id ?? uuidv7()
  return db.client.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { id, name: input.name, slug: input.slug, defaultCurrency: input.defaultCurrency },
    })
    await tx.membership.create({
      data: { id: uuidv7(), tenantId: id, subject: input.ownerSubject, role: 'OWNER' },
    })
    return tenant
  })
}

export async function getTenant(ctx: TenantContext) {
  const tenant = await ctx.db.tenant.findFirst()
  if (!tenant) throw notFound('Tenant')
  return tenant
}

export async function getMe(db: TalaDb, identity: Identity): Promise<Me> {
  if (identity.kind === 'service')
    return { kind: 'service', subject: identity.subject, memberships: [] }
  if (identity.terminal) {
    const { tenantId, storeId } = identity.terminal
    const tenant = await db.client.tenant.findUnique({ where: { id: tenantId } })
    return {
      kind: 'terminal',
      subject: identity.subject,
      memberships: [
        { tenantId, tenantName: tenant?.name ?? '', role: 'STAFF', storeIds: [storeId] },
      ],
    }
  }
  const rows = await db.client.membership.findMany({
    where: { subject: identity.subject, revokedAt: null, tenant: { disabledAt: null } },
    include: { tenant: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return {
    kind: 'staff',
    subject: identity.subject,
    memberships: rows.map((m) => ({
      tenantId: m.tenantId,
      tenantName: m.tenant.name,
      role: m.role,
      storeIds: m.storeIds,
    })),
  }
}

export async function listMemberships(ctx: TenantContext, query: ListQuery) {
  const rows = await ctx.db.membership.findMany({
    where: withCursor(query.includeArchived ? {} : { revokedAt: null }, query),
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    select: membershipSelect,
  })
  return toPage(rows, query.limit)
}

export async function createMembership(ctx: TenantContext, input: CreateMembership) {
  // Re-inviting a revoked subject reactivates their membership.
  const existing = await ctx.db.membership.findFirst({ where: { subject: input.subject } })
  if (existing && !existing.revokedAt) throw conflict('This subject is already a member')
  if (existing) {
    return ctx.db.membership.update({
      where: { id: existing.id },
      data: { role: input.role, storeIds: input.storeIds, revokedAt: null },
      select: membershipSelect,
    })
  }
  return ctx.db.membership.create({
    data: {
      id: input.id ?? uuidv7(),
      tenantId: ctx.tenantId,
      subject: input.subject,
      role: input.role,
      storeIds: input.storeIds,
    },
    select: membershipSelect,
  })
}

async function assertNotLastOwner(ctx: TenantContext, membershipId: string) {
  const owners = await ctx.db.membership.findMany({
    where: { role: 'OWNER', revokedAt: null },
    select: { id: true },
  })
  if (owners.length === 1 && owners[0]?.id === membershipId) {
    throw conflict('A tenant must keep at least one owner')
  }
}

export async function updateMembership(ctx: TenantContext, id: string, input: UpdateMembership) {
  const current = await ctx.db.membership.findUnique({ where: { id } })
  if (!current || current.revokedAt) throw notFound('Membership')
  if (current.role === 'OWNER' && input.role && input.role !== 'OWNER') {
    await assertNotLastOwner(ctx, id)
  }
  return ctx.db.membership.update({
    where: { id },
    data: {
      ...(input.role ? { role: input.role } : {}),
      ...(input.storeIds ? { storeIds: input.storeIds } : {}),
    },
    select: membershipSelect,
  })
}

export async function revokeMembership(ctx: TenantContext, id: string) {
  const current = await ctx.db.membership.findUnique({ where: { id } })
  if (!current || current.revokedAt) throw notFound('Membership')
  if (current.role === 'OWNER') await assertNotLastOwner(ctx, id)
  return ctx.db.membership.update({
    where: { id },
    data: { revokedAt: new Date() },
    select: membershipSelect,
  })
}
