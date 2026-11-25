import {
  type CreateInvitation,
  type InvitationListQuery,
  type InvitationStatus,
  type MemberRole,
  uuidv7,
} from '@talajs/contracts'
import type { TalaDb } from '@talajs/db'
import type { Mailer } from '../email/types.js'
import { conflict, HttpError, notFound } from '../errors.js'
import { toPage, withCursor } from '../lib/pagination.js'
import { newInvitationToken, sha256Hex } from '../lib/secrets.js'
import type { Identity, TenantContext } from '../types.js'
import { audit } from './audit.js'
import { assertCanGrant, membershipSelect, recordStaffChange, toMembership } from './tenancy.js'

export interface InvitationEmailData {
  to: string
  tenantName: string
  role: MemberRole
  /** Who sent it, as best known (display name or email). */
  invitedBy: string | null
  acceptUrl: string
  expiresAt: Date
}

export interface InvitationSettings {
  /** Link in the email, e.g. `(token) => \`${origin}/admin/invite/${token}\``. */
  acceptUrl: (token: string) => string
  mailer: Mailer | null
  /** Days until an invitation expires. Default 7. */
  ttlDays: number
  render: (data: InvitationEmailData) => { subject: string; html: string; text: string }
}

interface InvitationRow {
  id: string
  tenantId: string
  email: string
  role: MemberRole
  storeIds: string[]
  tokenHash: string
  expiresAt: Date
  invitedBy: string
  acceptedAt: Date | null
  acceptedBy: string | null
  revokedAt: Date | null
  lastSentAt: Date
  sendCount: number
  createdAt: Date
  updatedAt: Date
}

export function invitationStatus(row: InvitationRow, now = new Date()): InvitationStatus {
  if (row.acceptedAt) return 'ACCEPTED'
  if (row.revokedAt) return 'REVOKED'
  if (row.expiresAt <= now) return 'EXPIRED'
  return 'PENDING'
}

function toInvitation(
  row: InvitationRow,
): Omit<InvitationRow, 'tokenHash' | 'tenantId' | 'updatedAt'> & { status: InvitationStatus } {
  const { tokenHash, tenantId, updatedAt, ...rest } = row
  return { ...rest, status: invitationStatus(row) }
}

const pendingWhere = (now: Date) => ({ acceptedAt: null, revokedAt: null, expiresAt: { gt: now } })

function statusWhere(status: InvitationStatus | undefined, now: Date) {
  switch (status) {
    case 'PENDING':
      return pendingWhere(now)
    case 'ACCEPTED':
      return { acceptedAt: { not: null } }
    case 'REVOKED':
      return { revokedAt: { not: null }, acceptedAt: null }
    case 'EXPIRED':
      return { acceptedAt: null, revokedAt: null, expiresAt: { lte: now } }
    default:
      return {}
  }
}

export async function listInvitations(ctx: TenantContext, query: InvitationListQuery) {
  const rows = await ctx.db.invitation.findMany({
    where: withCursor(statusWhere(query.status, new Date()), query, 'desc'),
    orderBy: { id: 'desc' },
    take: query.limit + 1,
  })
  const page = toPage(rows, query.limit)
  return { ...page, data: page.data.map(toInvitation) }
}

async function inviterName(ctx: TenantContext) {
  if (!ctx.membershipId) return null
  const m = await ctx.db.membership.findUnique({ where: { id: ctx.membershipId } })
  return m?.displayName ?? m?.email ?? null
}

async function deliver(
  ctx: TenantContext,
  settings: InvitationSettings,
  row: InvitationRow,
  token: string,
) {
  const acceptUrl = settings.acceptUrl(token)
  if (!settings.mailer) return { delivery: 'skipped' as const, acceptUrl }
  const tenant = await ctx.db.tenant.findFirst()
  const email = settings.render({
    to: row.email,
    tenantName: tenant?.name ?? '',
    role: row.role,
    invitedBy: await inviterName(ctx),
    acceptUrl,
    expiresAt: row.expiresAt,
  })
  try {
    await settings.mailer.send({
      to: row.email,
      ...email,
      idempotencyKey: `invitation/${row.id}/${row.sendCount}`,
    })
    return { delivery: 'sent' as const, acceptUrl: null }
  } catch (error) {
    console.error('tala: invitation email failed', error)
    return { delivery: 'failed' as const, acceptUrl: null }
  }
}

export async function createInvitation(
  ctx: TenantContext,
  settings: InvitationSettings,
  input: CreateInvitation,
) {
  assertCanGrant(ctx, input.role, input.storeIds)
  const token = newInvitationToken()
  const now = new Date()
  const row = await ctx.db.$transaction(async (tx) => {
    const member = await tx.membership.findFirst({ where: { email: input.email, revokedAt: null } })
    if (member) throw conflict('This person is already a member')
    const pending = await tx.invitation.findFirst({
      where: { email: input.email, acceptedAt: null, revokedAt: null },
    })
    if (pending && pending.expiresAt > now) {
      throw conflict('There is already a pending invitation for this email; re-send it instead', {
        invitationId: pending.id,
      })
    }
    // An expired invitation still holds the one-pending-per-email slot; release it.
    if (pending) await tx.invitation.update({ where: { id: pending.id }, data: { revokedAt: now } })
    const created = await tx.invitation.create({
      data: {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        email: input.email,
        role: input.role,
        storeIds: input.storeIds,
        tokenHash: await sha256Hex(token),
        expiresAt: new Date(now.getTime() + settings.ttlDays * 86_400_000),
        invitedBy: ctx.actor,
      },
    })
    await audit(tx, ctx.tenantId, {
      actor: ctx.actor,
      action: 'invitation.created',
      subjectType: 'invitation',
      subjectId: created.id,
      details: { email: input.email, role: input.role, storeIds: input.storeIds },
    })
    return created
  })
  return { ...toInvitation(row), ...(await deliver(ctx, settings, row, token)) }
}

async function findManageable(ctx: TenantContext, id: string) {
  const row = await ctx.db.invitation.findUnique({ where: { id } })
  if (!row) throw notFound('Invitation')
  assertCanGrant(ctx, row.role, row.storeIds)
  return row
}

/** A fresh token (the old link stops working) and a fresh expiry. */
export async function resendInvitation(
  ctx: TenantContext,
  settings: InvitationSettings,
  id: string,
) {
  const current = await findManageable(ctx, id)
  if (current.acceptedAt || current.revokedAt) {
    throw new HttpError(
      409,
      'invitation_invalid',
      'This invitation was already accepted or revoked',
    )
  }
  const token = newInvitationToken()
  const now = new Date()
  const row = await ctx.db.$transaction(async (tx) => {
    const updated = await tx.invitation.update({
      where: { id },
      data: {
        tokenHash: await sha256Hex(token),
        expiresAt: new Date(now.getTime() + settings.ttlDays * 86_400_000),
        lastSentAt: now,
        sendCount: { increment: 1 },
      },
    })
    await audit(tx, ctx.tenantId, {
      actor: ctx.actor,
      action: 'invitation.resent',
      subjectType: 'invitation',
      subjectId: id,
      details: { sendCount: updated.sendCount },
    })
    return updated
  })
  return { ...toInvitation(row), ...(await deliver(ctx, settings, row, token)) }
}

export async function revokeInvitation(ctx: TenantContext, id: string) {
  const current = await findManageable(ctx, id)
  if (current.acceptedAt || current.revokedAt) {
    throw new HttpError(
      409,
      'invitation_invalid',
      'This invitation was already accepted or revoked',
    )
  }
  return ctx.db.$transaction(async (tx) => {
    const row = await tx.invitation.update({ where: { id }, data: { revokedAt: new Date() } })
    await audit(tx, ctx.tenantId, {
      actor: ctx.actor,
      action: 'invitation.revoked',
      subjectType: 'invitation',
      subjectId: id,
      details: { email: row.email },
    })
    return toInvitation(row)
  })
}

/** `jane@example.com` → `j•••@example.com` */
export function maskEmail(email: string) {
  const at = email.lastIndexOf('@')
  if (at < 1) return '•••'
  return `${email[0]}•••${email.slice(at)}`
}

async function findByToken(db: TalaDb, token: string) {
  return db.client.invitation.findUnique({
    where: { tokenHash: await sha256Hex(token) },
    include: { tenant: { select: { name: true, disabledAt: true } } },
  })
}

const invalid = () =>
  new HttpError(409, 'invitation_invalid', 'This invitation has been used, revoked or has expired')

/** For the accept screen, before signing in. Reveals only the business, role and masked email. */
export async function previewInvitation(db: TalaDb, token: string) {
  const row = await findByToken(db, token)
  if (!row || row.tenant.disabledAt) throw notFound('Invitation')
  if (invitationStatus(row) !== 'PENDING') throw invalid()
  return {
    tenantName: row.tenant.name,
    role: row.role,
    email: maskEmail(row.email),
    expiresAt: row.expiresAt,
  }
}

/**
 * Join the tenant. The caller must be signed in with the invited email, verified; the token alone
 * is not enough, so a forwarded or leaked link is useless to anyone else.
 */
export async function acceptInvitation(db: TalaDb, identity: Identity, token: string) {
  if (identity.kind !== 'staff') {
    throw new HttpError(403, 'forbidden', 'Sign in as a person to accept an invitation')
  }
  const row = await findByToken(db, token)
  if (!row || row.tenant.disabledAt) throw notFound('Invitation')
  if (invitationStatus(row) !== 'PENDING') throw invalid()
  if (!identity.email || identity.email !== row.email) {
    throw new HttpError(403, 'email_mismatch', 'This invitation is for a different email address')
  }
  if (!identity.emailVerified) {
    throw new HttpError(403, 'email_unverified', 'Verify your email address first')
  }

  const tenantId = row.tenantId
  const membership = await db.forTenant(tenantId).$transaction(async (tx) => {
    const now = new Date()
    // Single use: only one accept can flip a pending invitation.
    const claimed = await tx.invitation.updateMany({
      where: { id: row.id, ...pendingWhere(now) },
      data: { acceptedAt: now, acceptedBy: identity.subject },
    })
    if (claimed.count !== 1) throw invalid()

    const profile = { email: row.email, ...(identity.name ? { displayName: identity.name } : {}) }
    const existing = await tx.membership.findFirst({ where: { subject: identity.subject } })
    let result: { id: string }
    if (existing && !existing.revokedAt) {
      result = existing // already a member: the invitation grants nothing new
    } else if (existing) {
      result = await tx.membership.update({
        where: { id: existing.id },
        data: { role: row.role, storeIds: row.storeIds, revokedAt: null, ...profile },
      })
      await recordStaffChange(tx, tenantId, result.id, 'restore')
    } else {
      result = await tx.membership.create({
        data: {
          id: uuidv7(),
          tenantId,
          subject: identity.subject,
          role: row.role,
          storeIds: row.storeIds,
          ...profile,
        },
      })
      await recordStaffChange(tx, tenantId, result.id)
    }
    await audit(tx, tenantId, {
      actor: identity.subject,
      action: 'invitation.accepted',
      subjectType: 'invitation',
      subjectId: row.id,
      details: { membershipId: result.id },
    })
    if (result !== existing) {
      await audit(tx, tenantId, {
        actor: identity.subject,
        action: 'membership.created',
        subjectType: 'membership',
        subjectId: result.id,
        details: { role: row.role, storeIds: row.storeIds, invitationId: row.id },
      })
    }
    return tx.membership.findUniqueOrThrow({ where: { id: result.id }, select: membershipSelect })
  })
  return { tenantId, tenantName: row.tenant.name, membership: toMembership(membership) }
}

/** For invite-only sign-up: is there a pending invitation for this email in any tenant? */
export async function hasPendingInvitation(db: TalaDb, email: string) {
  const row = await db.client.invitation.findFirst({
    where: { email: email.toLowerCase(), ...pendingWhere(new Date()) },
    select: { id: true },
  })
  return row !== null
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  )

/** A plain invitation email. Pass `invitations.render` to brand it. */
export function renderInvitation(data: InvitationEmailData) {
  const role = data.role.charAt(0) + data.role.slice(1).toLowerCase()
  const who = data.invitedBy ? `${data.invitedBy} invited you` : "You've been invited"
  const subject = `Join ${data.tenantName}`
  const days = Math.max(1, Math.round((data.expiresAt.getTime() - Date.now()) / 86_400_000))
  const text = `${who} to join ${data.tenantName} as ${role}.

Accept the invitation: ${data.acceptUrl}

Sign in with ${data.to} to accept. The link expires in ${days} day${days === 1 ? '' : 's'}.
If you weren't expecting this, you can ignore it.`
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111">
<p>${escapeHtml(who)} to join <strong>${escapeHtml(data.tenantName)}</strong> as ${escapeHtml(role)}.</p>
<p><a href="${escapeHtml(data.acceptUrl)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Accept invitation</a></p>
<p style="color:#555;font-size:14px">Sign in with ${escapeHtml(data.to)} to accept. The link expires in ${days} day${days === 1 ? '' : 's'}. If you weren't expecting this, you can ignore it.</p>
</body></html>`
  return { subject, html, text }
}
