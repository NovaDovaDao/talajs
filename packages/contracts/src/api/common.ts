import { z } from 'zod'
import { Id } from '../ids.js'

/** ISO 8601 timestamp, as serialised in API responses. */
export const Timestamp = z.iso.datetime({ offset: true })

export const Slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lower-case letters, digits and single dashes')

export const Name = z.string().trim().min(1).max(200)

/** Stored and compared lower-cased. */
export const Email = z
  .email()
  .max(320)
  .transform((e) => e.toLowerCase())

export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Opaque: the last id of the previous page. */
  cursor: Id.optional(),
  includeArchived: z.stringbool().default(false),
})
export type ListQuery = z.infer<typeof ListQuery>

export function Page<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), nextCursor: Id.nullable() })
}

export const ErrorCode = z.enum([
  'validation_error',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'invalid_reference',
  'insufficient_stock',
  /** The order changed since `expectedVersion`. */
  'version_conflict',
  /** The resource isn't in a state that allows this, e.g. adding lines to a completed order. */
  'invalid_state',
  /** The order can't be completed until it's paid. */
  'balance_due',
  /** The item is archived or not sold in this store. */
  'item_unavailable',
  /** Accepting an invitation needs a signed-in identity with the invited email, verified. */
  'email_mismatch',
  'email_unverified',
  /** The invitation was accepted, revoked or has expired. */
  'invitation_invalid',
  /** Wrong PIN, or the register's PIN entry is locked after too many wrong PINs. */
  'invalid_pin',
  'pin_locked',
  'too_many_requests',
  'internal_error',
])
export type ErrorCode = z.infer<typeof ErrorCode>

export const ErrorBody = z
  .object({
    error: z.object({ code: ErrorCode, message: z.string(), details: z.unknown().optional() }),
  })
  .meta({ id: 'Error' })
export type ErrorBody = z.infer<typeof ErrorBody>

export const TenantParams = z.object({ tenantId: Id })
export const TenantResourceParams = z.object({ tenantId: Id, id: Id })
