import type { StaffMember } from '@talajs/contracts'
import { conflict, forbidden, HttpError, notFound } from '../errors.js'
import { sha256Hex } from '../lib/secrets.js'
import { hasRole } from '../middleware/index.js'
import type { TenantContext, TerminalIdentity } from '../types.js'
import { audit } from './audit.js'
import { recordStaffChange } from './tenancy.js'

/** Wrong PINs in a row before a register's PIN entry locks. */
export const PIN_MAX_FAILURES = 5
export const PIN_LOCK_MS = 15 * 60_000

/**
 * Salted with the membership id, so equal PINs give different digests. It's a plain hash on
 * purpose: with at most a million PINs no hashing cost would stop a brute force, so the online
 * defence is the per-register lockout, and offline a PIN only attributes (docs/sync-protocol.md).
 */
export const pinDigest = (membershipId: string, pin: string) => sha256Hex(`${membershipId}:${pin}`)

const sharesStore = (a: string[], b: string[]) =>
  a.length === 0 || b.length === 0 || a.some((s) => b.includes(s))

const canUseStore = (storeIds: string[], storeId: string) =>
  storeIds.length === 0 || storeIds.includes(storeId)

/** Your own PIN; or a manager for staff, an owner for anyone. */
function assertCanManagePin(ctx: TenantContext, target: { id: string; role: string }) {
  if (target.id === ctx.membershipId) return
  if (ctx.role === 'OWNER') return
  if (hasRole(ctx.role, 'MANAGER') && target.role === 'STAFF') return
  throw forbidden("You can't change this member's PIN")
}

async function loadTarget(ctx: TenantContext, membershipId: string) {
  const target = await ctx.db.membership.findUnique({ where: { id: membershipId } })
  if (!target || target.revokedAt) throw notFound('Membership')
  assertCanManagePin(ctx, target)
  if (
    target.id !== ctx.membershipId &&
    ctx.storeIds.length > 0 &&
    !sharesStore(ctx.storeIds, target.storeIds)
  ) {
    throw notFound('Membership')
  }
  return target
}

export async function setPin(ctx: TenantContext, membershipId: string, pin: string) {
  const target = await loadTarget(ctx, membershipId)
  const tenant = await ctx.db.tenant.findFirst()
  if (!tenant) throw notFound('Tenant')
  if (pin.length !== tenant.pinLength) {
    throw new HttpError(400, 'validation_error', `A PIN has ${tenant.pinLength} digits here`)
  }
  await ctx.db.$transaction(async (tx) => {
    // Unique within a store, so a PIN alone picks the person at a register.
    const others = await tx.membership.findMany({
      where: { revokedAt: null, pinDigest: { not: null }, id: { not: target.id } },
      select: { id: true, storeIds: true, pinDigest: true },
    })
    for (const other of others) {
      if (!sharesStore(other.storeIds, target.storeIds)) continue
      if ((await pinDigest(other.id, pin)) === other.pinDigest) {
        throw conflict('Choose a different PIN')
      }
    }
    await tx.membership.update({
      where: { id: target.id },
      data: { pinDigest: await pinDigest(target.id, pin), pinSetAt: new Date() },
    })
    await recordStaffChange(tx, ctx.tenantId, target.id)
    await audit(tx, ctx.tenantId, {
      actor: ctx.actor,
      action: 'pin.set',
      subjectType: 'membership',
      subjectId: target.id,
      details: { self: target.id === ctx.membershipId },
    })
  })
}

export async function clearPin(ctx: TenantContext, membershipId: string) {
  const target = await loadTarget(ctx, membershipId)
  await ctx.db.$transaction(async (tx) => {
    await tx.membership.update({
      where: { id: target.id },
      data: { pinDigest: null, pinSetAt: null },
    })
    await recordStaffChange(tx, ctx.tenantId, target.id)
    await audit(tx, ctx.tenantId, {
      actor: ctx.actor,
      action: 'pin.cleared',
      subjectType: 'membership',
      subjectId: target.id,
      details: { self: target.id === ctx.membershipId },
    })
  })
}

/**
 * Online PIN check at a register. After PIN_MAX_FAILURES wrong PINs in a row the register's PIN
 * entry locks for PIN_LOCK_MS; a correct PIN resets the count.
 */
export async function verifyPin(
  ctx: TenantContext,
  terminal: TerminalIdentity,
  pin: string,
): Promise<StaffMember> {
  const now = new Date()
  const state = await ctx.db.terminal.findUnique({
    where: { id: terminal.id },
    select: { pinLockedUntil: true },
  })
  if (state?.pinLockedUntil && state.pinLockedUntil > now) {
    throw new HttpError(423, 'pin_locked', 'Too many wrong PINs; try again later', {
      lockedUntil: state.pinLockedUntil.toISOString(),
    })
  }

  const candidates = await ctx.db.membership.findMany({
    where: { revokedAt: null, pinDigest: { not: null } },
    select: { id: true, displayName: true, role: true, storeIds: true, pinDigest: true },
  })
  for (const m of candidates) {
    if (!canUseStore(m.storeIds, terminal.storeId)) continue
    if ((await pinDigest(m.id, pin)) === m.pinDigest) {
      await ctx.db.terminal.update({
        where: { id: terminal.id },
        data: { pinFailures: 0, pinLockedUntil: null },
      })
      return { id: m.id, displayName: m.displayName, role: m.role, active: true }
    }
  }

  // Atomic increment: concurrent wrong PINs can't slip past the limit.
  const after = await ctx.db.terminal.update({
    where: { id: terminal.id },
    data: { pinFailures: { increment: 1 } },
    select: { pinFailures: true },
  })
  if (after.pinFailures >= PIN_MAX_FAILURES) {
    const lockedUntil = new Date(now.getTime() + PIN_LOCK_MS)
    await ctx.db.$transaction(async (tx) => {
      await tx.terminal.update({
        where: { id: terminal.id },
        data: { pinFailures: 0, pinLockedUntil: lockedUntil },
      })
      await audit(tx, ctx.tenantId, {
        actor: ctx.actor,
        action: 'pin.locked',
        subjectType: 'terminal',
        subjectId: terminal.id,
        details: { failures: after.pinFailures, lockedUntil: lockedUntil.toISOString() },
      })
    })
    throw new HttpError(423, 'pin_locked', 'Too many wrong PINs; try again later', {
      lockedUntil: lockedUntil.toISOString(),
    })
  }
  throw new HttpError(403, 'invalid_pin', 'Wrong PIN', {
    attemptsLeft: PIN_MAX_FAILURES - after.pinFailures,
  })
}

/** The sync feed's `staff` entity, as one register's store sees it. */
export async function loadStaff(ctx: TenantContext, id: string): Promise<StaffMember | null> {
  const m = await ctx.db.membership.findUnique({
    where: { id },
    select: {
      id: true,
      displayName: true,
      role: true,
      storeIds: true,
      pinDigest: true,
      revokedAt: true,
    },
  })
  if (!m) return null
  const storeId = ctx.terminal?.storeId
  const active = !m.revokedAt && (storeId === undefined || canUseStore(m.storeIds, storeId))
  return {
    id: m.id,
    displayName: m.displayName,
    role: m.role,
    active,
    pinDigest: active ? m.pinDigest : null,
  }
}

/** The actor recorded for a synced mutation made by a PIN-identified person, if valid. */
export async function pinActor(
  ctx: TenantContext,
  terminal: TerminalIdentity,
  membershipId: string | undefined,
) {
  if (!membershipId) return null
  const m = await ctx.db.membership.findUnique({
    where: { id: membershipId },
    select: { revokedAt: true, storeIds: true },
  })
  if (!m || m.revokedAt || !canUseStore(m.storeIds, terminal.storeId)) return null
  return `pin:${membershipId}@terminal:${terminal.id}`
}
