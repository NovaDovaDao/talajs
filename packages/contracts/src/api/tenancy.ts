import { z } from 'zod'
import { Id } from '../ids.js'
import { Currency } from '../money.js'
import { Name, Slug, Timestamp } from './common.js'

export const MemberRole = z.enum(['OWNER', 'MANAGER', 'STAFF'])
export type MemberRole = z.infer<typeof MemberRole>

export const Tenant = z
  .object({
    id: Id,
    name: z.string(),
    slug: z.string(),
    defaultCurrency: z.string(),
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
    /** Becomes the tenant's first OWNER. */
    ownerSubject: Subject,
  })
  .meta({ id: 'CreateTenant' })
export type CreateTenant = z.infer<typeof CreateTenant>

export const Membership = z
  .object({
    id: Id,
    subject: z.string(),
    role: MemberRole,
    /** Empty = all stores. */
    storeIds: z.array(Id),
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
  })
  .meta({ id: 'CreateMembership' })
export type CreateMembership = z.infer<typeof CreateMembership>

export const UpdateMembership = z
  .object({ role: MemberRole.optional(), storeIds: z.array(Id).optional() })
  .meta({ id: 'UpdateMembership' })
export type UpdateMembership = z.infer<typeof UpdateMembership>

export const Me = z
  .object({
    kind: z.enum(['staff', 'service', 'terminal']),
    subject: z.string(),
    memberships: z.array(
      z.object({ tenantId: Id, tenantName: z.string(), role: MemberRole, storeIds: z.array(Id) }),
    ),
  })
  .meta({ id: 'Me' })
export type Me = z.infer<typeof Me>
