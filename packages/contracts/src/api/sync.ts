import { z } from 'zod'
import { Id } from '../ids.js'
import { MinorUnits, NonNegativeMinorUnits } from '../money.js'
import { TaxRateBps } from '../pricing.js'
import { Name, Timestamp } from './common.js'
import { PaymentMethod } from './orders.js'

/**
 * Terminals (registers) and the offline sync protocol. See docs/sync-protocol.md.
 *
 * - A manager creates a terminal and gets a one-time pairing code. The register exchanges it
 *   for a long-lived token (`POST /v1/terminal/pair`) and authenticates with
 *   `Authorization: Bearer <token>` from then on.
 * - The register records sales locally and pushes them as mutations. Every mutation has a
 *   client-generated id, so pushing the same batch twice changes nothing.
 * - It pulls catalog and price changes from a feed with an opaque cursor.
 */

// ── terminals ───────────────────────────────────────────────────────────────

const TerminalCode = z
  .string()
  .regex(/^[A-Z0-9]{1,8}$/, 'Up to 8 upper-case letters or digits, e.g. "T2"')

export const Terminal = z
  .object({
    id: Id,
    storeId: Id,
    name: z.string(),
    /** Prefix for offline order numbers, e.g. "T2" → "T2-0042". */
    code: z.string(),
    paired: z.boolean(),
    pairingExpiresAt: Timestamp.nullable(),
    lastSeenAt: Timestamp.nullable(),
    revokedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Terminal' })
export type Terminal = z.infer<typeof Terminal>

export const CreateTerminal = z
  .object({ id: Id.optional(), storeId: Id, name: Name, code: TerminalCode })
  .meta({ id: 'CreateTerminal' })
export type CreateTerminal = z.infer<typeof CreateTerminal>

export const UpdateTerminal = z.object({ name: Name.optional() }).meta({ id: 'UpdateTerminal' })
export type UpdateTerminal = z.infer<typeof UpdateTerminal>

/** Returned once; only a hash of the code is stored. */
export const PairingCode = z
  .object({ terminal: Terminal, pairingCode: z.string(), pairingExpiresAt: Timestamp })
  .meta({ id: 'PairingCode' })
export type PairingCode = z.infer<typeof PairingCode>

export const PairRequest = z
  .object({ pairingCode: z.string().trim().min(1).max(64) })
  .meta({ id: 'PairRequest' })
export type PairRequest = z.infer<typeof PairRequest>

/** Returned once; store the token securely on the register. */
export const PairResponse = z
  .object({
    token: z.string(),
    terminal: z.object({
      id: Id,
      tenantId: Id,
      storeId: Id,
      name: z.string(),
      code: z.string(),
    }),
  })
  .meta({ id: 'PairResponse' })
export type PairResponse = z.infer<typeof PairResponse>

// ── push ────────────────────────────────────────────────────────────────────

/** A line as the register sold it: the snapshot is the record, not the current catalog. */
export const SyncLine = z.object({
  id: Id,
  variantId: Id.nullable(),
  itemName: Name,
  variantName: z.string().max(200).nullable().default(null),
  unitPriceMinor: NonNegativeMinorUnits,
  quantity: z.number().int().min(1).max(999),
  taxRateBps: TaxRateBps,
  modifiers: z
    .array(
      z.object({
        modifierId: Id.nullable(),
        groupName: z.string().min(1).max(200),
        name: z.string().min(1).max(200),
        priceDeltaMinor: MinorUnits,
      }),
    )
    .max(50)
    .default([]),
  note: z.string().max(500).nullable().default(null),
  addedAt: Timestamp.optional(),
})
export type SyncLine = z.infer<typeof SyncLine>

const OrderRef = { orderId: Id }

/** Each mutation type and its payload. */
export const SyncPayloads = {
  'order.open': z.object({
    ...OrderRef,
    /** Offline number, e.g. "T2-0042"; the server assigns one if omitted. */
    number: z.string().min(1).max(32).optional(),
    isTab: z.boolean().default(false),
    tabName: z.string().trim().min(1).max(100).nullable().default(null),
    customerId: Id.nullable().default(null),
    note: z.string().max(500).nullable().default(null),
    openedAt: Timestamp.optional(),
  }),
  /** Adding lines never conflicts: drinks poured on two registers both happened. */
  'order.add_lines': z.object({ ...OrderRef, lines: z.array(SyncLine).min(1).max(200) }),
  'order.void_line': z.object({ ...OrderRef, lineId: Id, reason: z.string().min(1).max(500) }),
  /** Money taken is a fact: an overpayment is recorded and flagged for review. */
  'order.pay': z.object({
    ...OrderRef,
    paymentId: Id,
    method: PaymentMethod,
    amountMinor: MinorUnits.refine((n) => n > 0, 'Amount must be > 0'),
    tipMinor: NonNegativeMinorUnits.default(0),
  }),
  'order.complete': z.object({ ...OrderRef, completedAt: Timestamp.optional() }),
  'order.void': z.object({ ...OrderRef, reason: z.string().min(1).max(500) }),
} as const
export type SyncMutationType = keyof typeof SyncPayloads
export const SyncMutationType = z.enum(Object.keys(SyncPayloads) as [SyncMutationType])

export const SyncMutation = z
  .object({
    /** Client-generated; the dedupe key. */
    id: Id,
    clientTs: Timestamp,
    type: z.string().min(1).max(64),
    /** Validated per type; an invalid payload rejects this mutation only. */
    payload: z.unknown(),
    /**
     * The order version the register last saw. A void (line or order) against an order that has
     * changed since becomes a conflict for review instead of being applied.
     */
    baseVersion: z.number().int().min(1).optional(),
    /**
     * The staff member (membership id) who did this at the counter, from a PIN check. Recorded
     * for attribution only; it grants nothing (see docs/sync-protocol.md).
     */
    actorMembershipId: Id.optional(),
  })
  .meta({ id: 'SyncMutation' })
export type SyncMutation = z.infer<typeof SyncMutation>

export const SyncPushRequest = z
  .object({ mutations: z.array(SyncMutation).min(1).max(100) })
  .meta({ id: 'SyncPushRequest' })
export type SyncPushRequest = z.infer<typeof SyncPushRequest>

export const SyncMutationStatus = z.enum(['APPLIED', 'DUPLICATE', 'CONFLICT', 'REJECTED'])
export type SyncMutationStatus = z.infer<typeof SyncMutationStatus>

export const SyncMutationResult = z
  .object({
    id: Id,
    /** `DUPLICATE`: already received; `original` is what happened the first time. */
    status: SyncMutationStatus,
    original: SyncMutationStatus.optional(),
    /** Set for conflicts, rejections and applied mutations that need a look (e.g. stock < 0). */
    reviewItemIds: z.array(Id),
    message: z.string().optional(),
  })
  .meta({ id: 'SyncMutationResult' })
export type SyncMutationResult = z.infer<typeof SyncMutationResult>

export const SyncPushResponse = z
  .object({ results: z.array(SyncMutationResult) })
  .meta({ id: 'SyncPushResponse' })
export type SyncPushResponse = z.infer<typeof SyncPushResponse>

// ── pull ────────────────────────────────────────────────────────────────────

export const ChangeEntity = z.enum([
  'store',
  'tax_rate',
  'category',
  'item',
  'modifier_group',
  'store_item',
  'stock_level',
  /** People who can sign in at this store's registers with a PIN (`StaffMember`). */
  'staff',
])
export type ChangeEntity = z.infer<typeof ChangeEntity>

export const SyncPullQuery = z.object({
  /** From the previous pull; omit to start from the beginning (a full catalog load). */
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})
export type SyncPullQuery = z.infer<typeof SyncPullQuery>

export const SyncChange = z
  .object({
    entity: ChangeEntity,
    /** The entity id; for `store_item`, the item id (see `data.storeId`). */
    id: Id,
    op: z.enum(['upsert', 'archive', 'restore']),
    /** The entity's current state, in the same shape as the REST API returns it. */
    data: z.unknown(),
  })
  .meta({ id: 'SyncChange' })
export type SyncChange = z.infer<typeof SyncChange>

export const SyncPullResponse = z
  .object({
    /** Latest state per entity; apply in order. */
    changes: z.array(SyncChange),
    /** Pass to the next pull. */
    cursor: z.string(),
    /** More changes are waiting: pull again straight away. */
    hasMore: z.boolean(),
  })
  .meta({ id: 'SyncPullResponse' })
export type SyncPullResponse = z.infer<typeof SyncPullResponse>

// ── review queue ────────────────────────────────────────────────────────────

export const ReviewKind = z.enum(['SYNC_CONFLICT', 'NEGATIVE_STOCK', 'PAYMENT_MISMATCH'])
export const ReviewStatus = z.enum(['OPEN', 'RESOLVED', 'DISMISSED'])

export const ReviewItem = z
  .object({
    id: Id,
    kind: ReviewKind,
    subjectType: z.string(),
    subjectId: Id,
    syncMutationId: Id.nullable(),
    /** Why it needs review, plus the original payload where there is one. */
    details: z.record(z.string(), z.unknown()),
    status: ReviewStatus,
    resolution: z.record(z.string(), z.unknown()).nullable(),
    resolvedBy: z.string().nullable(),
    resolvedAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'ReviewItem' })
export type ReviewItem = z.infer<typeof ReviewItem>

export const ReviewListQuery = z.object({
  status: ReviewStatus.optional(),
  kind: ReviewKind.optional(),
})

/** Close a review item. It records the decision; any fix is made through the normal API. */
export const ResolveReviewItem = z
  .object({
    status: z.enum(['RESOLVED', 'DISMISSED']),
    note: z.string().trim().max(2000).optional(),
  })
  .meta({ id: 'ResolveReviewItem' })
export type ResolveReviewItem = z.infer<typeof ResolveReviewItem>
