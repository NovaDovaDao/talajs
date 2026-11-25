import {
  type CreateMembership,
  type CreateTenant,
  type ListQuery,
  type Me,
  type MemberRole,
  type UpdateMembership,
  type UpdateTenant,
  uuidv7,
} from '@talajs/contracts'
import type { TalaDb } from '@talajs/db'
import { conflict, forbidden, HttpError, notFound } from '../errors.js'
import { toPage, withCursor } from '../lib/pagination.js'
import { hasRole } from '../middleware/index.js'
import type { Identity, TenantContext, TenantTx } from '../types.js'
import { audit } from './audit.js'

export const membershipSelect = {
  id: true,
  subject: true,
  role: true,
  storeIds: true,
  email: true,
  displayName: true,
  pinDigest: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

type MembershipRow = {
  id: string
  subject: string
  role: MemberRole
  storeIds: string[]
  email: string | null
  displayName: string | null
  pinDigest: string | null
  revokedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** The API shape: the PIN digest never leaves the server except in the terminal sync feed. */
export function toMembership({ pinDigest, ...m }: MembershipRow) {
  return { ...m, hasPin: pinDigest !== null }
}

/** Registers learn about people through the sync feed's `staff` entity. */
export async function recordStaffChange(
  tx: TenantTx,
  tenantId: string,
  membershipId: string,
  op: 'upsert' | 'archive' | 'restore' = 'upsert',
) {
  await tx.changeLog.create({ data: { tenantId, entity: 'staff', entityId: membershipId, op } })
}

export interface SelfServeTenants {
  /** OWNER memberships one person may hold before self-serve creation is refused. Default 3. */
  maxTenantsPerPerson?: number
}

export function selfServeLimit(option: boolean | SelfServeTenants | undefined): number | null {
  if (!option) return null
  return (option === true ? undefined : option.maxTenantsPerPerson) ?? 3
}

/**
 * Create a tenant and its first owner. A service identity names the owner; with
 * `allowSelfServeTenants`, a person with a verified email creates one for themselves.
 */
export async function createTenant(
  db: TalaDb,
  identity: Identity,
  input: CreateTenant,
  selfServe: number | null,
) {
  let owner: { subject: string; email: string | null; displayName: string | null }
  if (identity.kind === 'service') {
    if (!input.ownerSubject) {
      throw new HttpError(400, 'validation_error', 'ownerSubject is required')
    }
    owner = { subject: input.ownerSubject, email: null, displayName: null }
  } else {
    if (identity.kind !== 'staff' || selfServe === null) {
      throw forbidden('Requires a service credential')
    }
    if (input.ownerSubject !== undefined) {
      throw new HttpError(400, 'validation_error', 'ownerSubject is only for service credentials')
    }
    if (!identity.email || !identity.emailVerified) {
      throw new HttpError(403, 'email_unverified', 'Verify your email before creating a business')
    }
    const owned = await db.client.membership.count({
      where: { subject: identity.subject, role: 'OWNER', revokedAt: null },
    })
    if (owned >= selfServe) {
      throw forbidden(`You can own at most ${selfServe} businesses`)
    }
    owner = {
      subject: identity.subject,
      email: identity.email,
      displayName: identity.name ?? null,
    }
  }

  const id = input.id ?? uuidv7()
  return db.client.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { id, name: input.name, slug: input.slug, defaultCurrency: input.defaultCurrency },
    })
    const membershipId = uuidv7()
    await tx.membership.create({
      data: { id: membershipId, tenantId: id, role: 'OWNER', ...owner },
    })
    await recordStaffChange(tx as unknown as TenantTx, id, membershipId)
    await audit(tx as unknown as TenantTx, id, {
      actor: identity.subject,
      action: 'tenant.created',
      subjectType: 'tenant',
      subjectId: id,
      details: { owner: owner.subject, selfServe: identity.kind !== 'service' },
    })
    return tenant
  })
}

export async function getTenant(ctx: TenantContext) {
  const tenant = await ctx.db.tenant.findFirst()
  if (!tenant) throw notFound('Tenant')
  return tenant
}

export async function updateTenant(ctx: TenantContext, input: UpdateTenant) {
  return ctx.db.$transaction(async (tx) => {
    // The tenant row is read-only through the scoped client; the id is the scope itself.
    await tx.$executeRaw`
      UPDATE tala.tenant SET
        name = COALESCE(${input.name ?? null}, name),
        pin_length = COALESCE(${input.pinLength ?? null}::smallint, pin_length),
        updated_at = now()
      WHERE id = ${ctx.tenantId}::uuid`
    await audit(tx, ctx.tenantId, {
      actor: ctx.actor,
      action: 'tenant.updated',
      subjectType: 'tenant',
      subjectId: ctx.tenantId,
      details: { ...input },
    })
    const tenant = await tx.tenant.findFirst()
    if (!tenant) throw notFound('Tenant')
    return tenant
  })
}

export async function getMe(db: TalaDb, identity: Identity, selfServe: number | null): Promise<Me> {
  const profile = {
    subject: identity.subject,
    email: identity.email ?? null,
    emailVerified: identity.emailVerified ?? false,
    name: identity.name ?? null,
  }
  if (identity.kind === 'service') {
    return { kind: 'service', ...profile, canCreateTenant: true, memberships: [] }
  }
  if (identity.terminal) {
    const { tenantId, storeId } = identity.terminal
    const tenant = await db.client.tenant.findUnique({ where: { id: tenantId } })
    return {
      kind: 'terminal',
      ...profile,
      canCreateTenant: false,
      memberships: [
        {
          tenantId,
          tenantName: tenant?.name ?? '',
          membershipId: null,
          role: 'STAFF',
          storeIds: [storeId],
          hasPin: false,
        },
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
    ...profile,
    canCreateTenant: selfServe !== null && profile.emailVerified && profile.email !== null,
    memberships: rows.map((m) => ({
      tenantId: m.tenantId,
      tenantName: m.tenant.name,
      membershipId: m.id,
      role: m.role,
      storeIds: m.storeIds,
      hasPin: m.pinDigest !== null,
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
  const page = toPage(rows, query.limit)
  return { ...page, data: page.data.map(toMembership) }
}

export async function createMembership(ctx: TenantContext, input: CreateMembership) {
  return ctx.db.$transaction(async (tx) => {
    // Adding a revoked subject again reactivates their membership.
    const existing = await tx.membership.findFirst({ where: { subject: input.subject } })
    if (existing && !existing.revokedAt) throw conflict('This subject is already a member')
    const profile = {
      ...(input.email ? { email: input.email } : {}),
      ...(input.displayName ? { displayName: input.displayName } : {}),
    }
    const row = existing
      ? await tx.membership.update({
          where: { id: existing.id },
          data: { role: input.role, storeIds: input.storeIds, revokedAt: null, ...profile },
          select: membershipSelect,
        })
      : await tx.membership.create({
          data: {
            id: input.id ?? uuidv7(),
            tenantId: ctx.tenantId,
            subject: input.subject,
            role: input.role,
            storeIds: input.storeIds,
            ...profile,
          },
          select: membershipSelect,
        })
    await recordStaffChange(tx, ctx.tenantId, row.id, existing ? 'restore' : 'upsert')
    await audit(tx, ctx.tenantId, {
      actor: ctx.actor,
      action: 'membership.created',
      subjectType: 'membership',
      subjectId: row.id,
      details: { subject: row.subject, role: row.role, storeIds: row.storeIds },
    })
    return toMembership(row)
  })
}

async function assertNotLastOwner(tx: TenantTx, membershipId: string) {
  const owners = await tx.membership.findMany({
    where: { role: 'OWNER', revokedAt: null },
    select: { id: true },
  })
  if (owners.length === 1 && owners[0]?.id === membershipId) {
    throw conflict('A tenant must keep at least one owner')
  }
}

export async function updateMembership(ctx: TenantContext, id: string, input: UpdateMembership) {
  return ctx.db.$transaction(async (tx) => {
    const current = await tx.membership.findUnique({ where: { id } })
    if (!current || current.revokedAt) throw notFound('Membership')
    if (current.role === 'OWNER' && input.role && input.role !== 'OWNER') {
      await assertNotLastOwner(tx, id)
    }
    const row = await tx.membership.update({
      where: { id },
      data: {
        ...(input.role ? { role: input.role } : {}),
        ...(input.storeIds ? { storeIds: input.storeIds } : {}),
        ...(input.displayName ? { displayName: input.displayName } : {}),
      },
      select: membershipSelect,
    })
    await recordStaffChange(tx, ctx.tenantId, id)
    await audit(tx, ctx.tenantId, {
      actor: ctx.actor,
      action: 'membership.updated',
      subjectType: 'membership',
      subjectId: id,
      details: { ...input },
    })
    return toMembership(row)
  })
}

export async function revokeMembership(ctx: TenantContext, id: string) {
  return ctx.db.$transaction(async (tx) => {
    const current = await tx.membership.findUnique({ where: { id } })
    if (!current || current.revokedAt) throw notFound('Membership')
    if (current.role === 'OWNER') await assertNotLastOwner(tx, id)
    const row = await tx.membership.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: membershipSelect,
    })
    await recordStaffChange(tx, ctx.tenantId, id, 'archive')
    await audit(tx, ctx.tenantId, {
      actor: ctx.actor,
      action: 'membership.revoked',
      subjectType: 'membership',
      subjectId: id,
      details: { subject: row.subject },
    })
    return toMembership(row)
  })
}

/**
 * Who may grant what: a MANAGER may add STAFF, only an OWNER may add MANAGERs or OWNERs, and a
 * manager limited to some stores may only grant those stores.
 */
export function assertCanGrant(ctx: TenantContext, role: MemberRole, storeIds: string[]) {
  if (!hasRole(ctx.role, 'MANAGER')) throw forbidden('Requires role MANAGER or higher')
  if (role !== 'STAFF' && ctx.role !== 'OWNER') {
    throw forbidden('Only an owner can grant the MANAGER or OWNER role')
  }
  if (ctx.storeIds.length > 0) {
    if (storeIds.length === 0 || storeIds.some((s) => !ctx.storeIds.includes(s))) {
      throw forbidden('You can only grant access to your own stores')
    }
  }
}
