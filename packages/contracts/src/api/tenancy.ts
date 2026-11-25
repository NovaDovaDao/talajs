import { z } from 'zod'
import { Id } from '../ids.js'
import { Currency } from '../money.js'
import { Email, Name, Slug, Timestamp } from './common.js'

export const MemberRole = z.enum(['OWNER', 'MANAGER', 'STAFF'])
export type MemberRole = z.infer<typeof MemberRole>

/** Digits in a staff PIN. */
export const PinLength = z.number().int().min(4).max(6)

export const Tenant = z
  .object({
    id: Id,
    name: z.string(),
    slug: z.string(),
    defaultCurrency: z.string(),
    pinLength: PinLength,
    disabledAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Tenant' })
export type Tenant = z.infer<typeof Tenant>

/** Subject as issued by the identity provider (`sub`, or email for Cloudflare Access). */
export const Subject = z.string().trim().min(1).max(320)

export const CreateTenant = z
  .object({
    id: Id.optional(),
    name: Name,
    slug: Slug,
    defaultCurrency: Currency,
    /**
     * Becomes the tenant's first OWNER. Required for service credentials; for self-serve sign-up
     * (`allowSelfServeTenants`) the caller becomes the owner and this must be omitted.
     */
    ownerSubject: Subject.optional(),
  })
  .meta({ id: 'CreateTenant' })
export type CreateTenant = z.infer<typeof CreateTenant>

export const UpdateTenant = z
  .object({ name: Name.optional(), pinLength: PinLength.optional() })
  .meta({ id: 'UpdateTenant' })
export type UpdateTenant = z.infer<typeof UpdateTenant>

export const Membership = z
  .object({
    id: Id,
    subject: z.string(),
    role: MemberRole,
    /** Empty = all stores. */
    storeIds: z.array(Id),
    /** From the identity source, when it provides them. */
    email: z.string().nullable(),
    displayName: z.string().nullable(),
    hasPin: z.boolean(),
    revokedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Membership' })
export type Membership = z.infer<typeof Membership>

export const CreateMembership = z
  .object({
    id: Id.optional(),
    subject: Subject,
    role: MemberRole,
    storeIds: z.array(Id).default([]),
    email: Email.optional(),
    displayName: Name.optional(),
  })
  .meta({ id: 'CreateMembership' })
export type CreateMembership = z.infer<typeof CreateMembership>

export const UpdateMembership = z
  .object({
    role: MemberRole.optional(),
    storeIds: z.array(Id).optional(),
    displayName: Name.optional(),
  })
  .meta({ id: 'UpdateMembership' })
export type UpdateMembership = z.infer<typeof UpdateMembership>

export const Me = z
  .object({
    kind: z.enum(['staff', 'service', 'terminal']),
    subject: z.string(),
    /** From the identity source, when it provides them. */
    email: z.string().nullable(),
    emailVerified: z.boolean(),
    name: z.string().nullable(),
    /** Whether this identity may create a business (`allowSelfServeTenants`). */
    canCreateTenant: z.boolean(),
    memberships: z.array(
      z.object({
        tenantId: Id,
        tenantName: z.string(),
        /** Null for terminals and service credentials. */
        membershipId: Id.nullable(),
        role: MemberRole,
        storeIds: z.array(Id),
        hasPin: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'Me' })
export type Me = z.infer<typeof Me>

// ── invitations ─────────────────────────────────────────────────────────────

export const InvitationStatus = z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'])
export type InvitationStatus = z.infer<typeof InvitationStatus>

export const Invitation = z
  .object({
    id: Id,
    email: z.string(),
    role: MemberRole,
    storeIds: z.array(Id),
    status: InvitationStatus,
    expiresAt: Timestamp,
    invitedBy: z.string(),
    acceptedAt: Timestamp.nullable(),
    acceptedBy: z.string().nullable(),
    revokedAt: Timestamp.nullable(),
    lastSentAt: Timestamp,
    sendCount: z.number().int(),
    createdAt: Timestamp,
  })
  .meta({ id: 'Invitation' })
export type Invitation = z.infer<typeof Invitation>

export const CreateInvitation = z
  .object({
    email: Email,
    role: MemberRole,
    /** Empty = all stores. */
    storeIds: z.array(Id).default([]),
  })
  .meta({ id: 'CreateInvitation' })
export type CreateInvitation = z.infer<typeof CreateInvitation>

/** Returned when an invitation is created or re-sent. */
export const SentInvitation = Invitation.extend({
  /** `sent`, `failed` (re-send it later), or `skipped` when no mailer is configured. */
  delivery: z.enum(['sent', 'failed', 'skipped']),
  /** Only when `delivery` is `skipped`: share it yourself. It only works for the invited email. */
  acceptUrl: z.string().nullable(),
}).meta({ id: 'SentInvitation' })
export type SentInvitation = z.infer<typeof SentInvitation>

export const InvitationListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: Id.optional(),
  status: InvitationStatus.optional(),
})
export type InvitationListQuery = z.infer<typeof InvitationListQuery>

export const InvitationToken = z.string().min(20).max(200)

/** What the accept screen may show before signing in. */
export const InvitationPreview = z
  .object({
    tenantName: z.string(),
    role: MemberRole,
    /** Masked, e.g. `j•••@example.com`. */
    email: z.string(),
    expiresAt: Timestamp,
  })
  .meta({ id: 'InvitationPreview' })
export type InvitationPreview = z.infer<typeof InvitationPreview>

export const AcceptInvitation = z
  .object({ token: InvitationToken })
  .meta({ id: 'AcceptInvitation' })
export type AcceptInvitation = z.infer<typeof AcceptInvitation>

export const AcceptedInvitation = z
  .object({ tenantId: Id, tenantName: z.string(), membership: Membership })
  .meta({ id: 'AcceptedInvitation' })
export type AcceptedInvitation = z.infer<typeof AcceptedInvitation>

// ── staff PINs ──────────────────────────────────────────────────────────────

export const Pin = z.string().regex(/^\d{4,6}$/, 'A PIN is 4 to 6 digits')

export const SetPin = z.object({ pin: Pin }).meta({ id: 'SetPin' })
export type SetPin = z.infer<typeof SetPin>

export const VerifyPin = z.object({ pin: Pin }).meta({ id: 'VerifyPin' })
export type VerifyPin = z.infer<typeof VerifyPin>

/** A person who can work at a register: the result of a PIN check, and the sync `staff` entity. */
export const StaffMember = z
  .object({
    /** The membership id. */
    id: Id,
    displayName: z.string().nullable(),
    role: MemberRole,
    /** False once revoked or no longer allowed in this store; drop it locally. */
    active: z.boolean(),
    /**
     * sha256 of `<id>:<pin>` as lower-case hex, for offline attribution. Not a secret: a PIN is
     * too short to protect, see docs/sync-protocol.md. Only in the sync feed.
     */
    pinDigest: z.string().nullable().optional(),
  })
  .meta({ id: 'StaffMember' })
export type StaffMember = z.infer<typeof StaffMember>

// ── audit log ───────────────────────────────────────────────────────────────

export const AuditAction = z.enum([
  'invitation.created',
  'invitation.resent',
  'invitation.revoked',
  'invitation.accepted',
  'membership.created',
  'membership.updated',
  'membership.revoked',
  'pin.set',
  'pin.cleared',
  'pin.locked',
  'tenant.created',
  'tenant.updated',
])
export type AuditAction = z.infer<typeof AuditAction>

export const AuditEntry = z
  .object({
    id: Id,
    actor: z.string(),
    action: AuditAction,
    subjectType: z.string(),
    subjectId: Id,
    details: z.record(z.string(), z.unknown()),
    createdAt: Timestamp,
  })
  .meta({ id: 'AuditEntry' })
export type AuditEntry = z.infer<typeof AuditEntry>

export const AuditListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: Id.optional(),
  subjectId: Id.optional(),
})
export type AuditListQuery = z.infer<typeof AuditListQuery>
