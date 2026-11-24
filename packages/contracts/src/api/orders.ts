import { z } from 'zod'
import { Id } from '../ids.js'
import { MinorUnits, NonNegativeMinorUnits } from '../money.js'
import { Name, Timestamp } from './common.js'

/**
 * Orders and tabs (docs/PLAN.md §5).
 *
 * - An order is `OPEN` while it's being built: a cart, or a tab (`isTab`) that stays open while
 *   lines are added. It ends `COMPLETED` (fully paid) or `VOIDED` (abandoned before payment).
 * - Lines snapshot the item name, variant, price, modifiers and tax rate when they're added, so
 *   later catalog edits never change an order.
 * - Stock is taken when a line is added (the drink has been poured) and put back when a line or
 *   the order is voided.
 * - Every change bumps `version`. Send it back as `expectedVersion` to make an edit conditional,
 *   e.g. when the same tab is open on two registers.
 * - Client-supplied ids make creates retry-safe: repeating a create with an id that already exists
 *   returns the current order instead of creating a second one.
 */

export const OrderStatus = z.enum(['OPEN', 'COMPLETED', 'VOIDED'])
export type OrderStatus = z.infer<typeof OrderStatus>

export const OrderSource = z.enum(['POS', 'ONLINE', 'ADMIN'])
export type OrderSource = z.infer<typeof OrderSource>

export const PaymentMethod = z.enum(['CASH', 'CARD', 'CRYPTO'])
export type PaymentMethod = z.infer<typeof PaymentMethod>

export const PaymentStatus = z.enum(['PENDING', 'SUCCESS', 'FAILED', 'CANCELED'])
export type PaymentStatus = z.infer<typeof PaymentStatus>

// ── responses ───────────────────────────────────────────────────────────────

export const OrderLineModifier = z
  .object({
    id: Id,
    modifierId: Id.nullable(),
    groupName: z.string(),
    name: z.string(),
    priceDeltaMinor: z.number().int(),
  })
  .meta({ id: 'OrderLineModifier' })
export type OrderLineModifier = z.infer<typeof OrderLineModifier>

export const OrderLine = z
  .object({
    id: Id,
    /** Null for custom (open-price) lines. */
    variantId: Id.nullable(),
    itemName: z.string(),
    variantName: z.string().nullable(),
    unitPriceMinor: z.number().int(),
    quantity: z.number().int(),
    taxRateBps: z.number().int(),
    modifiersTotalMinor: z.number().int(),
    /** `(unitPrice + modifiers) × quantity`. Kept on voided lines, which count as zero. */
    lineTotalMinor: z.number().int(),
    note: z.string().nullable(),
    modifiers: z.array(OrderLineModifier),
    addedAt: Timestamp,
    addedBy: z.string(),
    voidedAt: Timestamp.nullable(),
    voidedBy: z.string().nullable(),
    voidReason: z.string().nullable(),
  })
  .meta({ id: 'OrderLine' })
export type OrderLine = z.infer<typeof OrderLine>

export const Payment = z
  .object({
    id: Id,
    orderId: Id,
    method: PaymentMethod,
    provider: z.string().nullable(),
    status: PaymentStatus,
    amountMinor: z.number().int(),
    tipMinor: z.number().int(),
    currency: z.string(),
    externalId: z.string().nullable(),
    asset: z.string().nullable(),
    failureReason: z.string().nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Payment' })
export type Payment = z.infer<typeof Payment>

export const RefundStatus = z.enum(['PENDING', 'SUCCESS', 'FAILED'])
export type RefundStatus = z.infer<typeof RefundStatus>

export const Refund = z
  .object({
    id: Id,
    paymentId: Id,
    amountMinor: z.number().int(),
    currency: z.string(),
    reason: z.string(),
    status: RefundStatus,
    externalId: z.string().nullable(),
    /** Lines being refunded, for reporting and restock. */
    lineIds: z.array(Id),
    restock: z.boolean(),
    actor: z.string(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Refund' })
export type Refund = z.infer<typeof Refund>

const orderFields = {
  id: Id,
  storeId: Id,
  terminalId: Id.nullable(),
  customerId: Id.nullable(),
  /** Display number, unique per store. The id is the identity. */
  number: z.string(),
  status: OrderStatus,
  source: OrderSource,
  isTab: z.boolean(),
  tabName: z.string().nullable(),
  note: z.string().nullable(),
  currency: z.string(),
  /** Net of tax; `subtotalMinor + taxMinor === totalMinor`. */
  subtotalMinor: z.number().int(),
  discountMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  /** Tips taken with successful payments, on top of the total. */
  tipMinor: z.number().int(),
  /** Successful payments towards the total (tips excluded), less successful refunds. */
  paidMinor: z.number().int(),
  refundedMinor: z.number().int(),
  /** What's left to pay on an open order; always 0 once completed or voided. */
  balanceDueMinor: z.number().int(),
  receiptSentAt: Timestamp.nullable(),
  version: z.number().int(),
  openedAt: Timestamp,
  openedBy: z.string(),
  completedAt: Timestamp.nullable(),
  completedBy: z.string().nullable(),
  voidedAt: Timestamp.nullable(),
  voidedBy: z.string().nullable(),
  voidReason: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}

/** An order without its lines and payments, as returned by lists. */
export const OrderHeader = z.object(orderFields).meta({ id: 'OrderHeader' })
export type OrderHeader = z.infer<typeof OrderHeader>

export const Order = z
  .object({
    ...orderFields,
    lines: z.array(OrderLine),
    payments: z.array(Payment),
    refunds: z.array(Refund),
  })
  .meta({ id: 'Order' })
export type Order = z.infer<typeof Order>

// ── requests ────────────────────────────────────────────────────────────────

const Quantity = z.number().int().min(1).max(999)
const LineNote = z.string().trim().min(1).max(500)
const Reason = z.string().trim().min(1).max(500)
const TabName = z.string().trim().min(1).max(100)
/** Make the change only if the order is still at this version; otherwise 409 `version_conflict`. */
const ExpectedVersion = z.number().int().min(1).optional()

export const AddCatalogLine = z
  .strictObject({
    id: Id.optional(),
    variantId: Id,
    quantity: Quantity.default(1),
    /** Chosen modifiers; each group's min/max selection rules are enforced. */
    modifierIds: z.array(Id).max(50).default([]),
    note: LineNote.optional(),
  })
  .meta({ id: 'AddCatalogLine' })

/** An open-price line that isn't in the catalog. */
export const AddCustomLine = z
  .strictObject({
    id: Id.optional(),
    name: Name,
    unitPriceMinor: NonNegativeMinorUnits,
    taxRateId: Id.nullable().default(null),
    quantity: Quantity.default(1),
    note: LineNote.optional(),
  })
  .meta({ id: 'AddCustomLine' })

export const AddLine = z.union([AddCatalogLine, AddCustomLine]).meta({ id: 'AddLine' })
export type AddLine = z.infer<typeof AddLine>

const Lines = z.array(AddLine).max(200)

export const CreateOrder = z
  .object({
    id: Id.optional(),
    storeId: Id,
    /** Online orders arrive through the storefront API (not yet available). */
    source: z.enum(['POS', 'ADMIN']).default('ADMIN'),
    customerId: Id.nullable().default(null),
    isTab: z.boolean().default(false),
    tabName: TabName.nullable().default(null),
    note: LineNote.nullable().default(null),
    lines: Lines.default([]),
  })
  .refine((o) => !o.isTab || o.tabName !== null, {
    path: ['tabName'],
    message: 'A tab needs a name',
  })
  .meta({ id: 'CreateOrder' })
export type CreateOrder = z.infer<typeof CreateOrder>

export const UpdateOrder = z
  .object({
    expectedVersion: ExpectedVersion,
    customerId: Id.nullable().optional(),
    isTab: z.boolean().optional(),
    tabName: TabName.nullable().optional(),
    note: LineNote.nullable().optional(),
  })
  .meta({ id: 'UpdateOrder' })
export type UpdateOrder = z.infer<typeof UpdateOrder>

export const AddLines = z
  .object({ expectedVersion: ExpectedVersion, lines: Lines.min(1) })
  .meta({ id: 'AddLines' })
export type AddLines = z.infer<typeof AddLines>

export const VoidRequest = z
  .object({ expectedVersion: ExpectedVersion, reason: Reason })
  .meta({ id: 'VoidRequest' })
export type VoidRequest = z.infer<typeof VoidRequest>

export const CompleteOrder = z
  .object({ expectedVersion: ExpectedVersion })
  .meta({ id: 'CompleteOrder' })
export type CompleteOrder = z.infer<typeof CompleteOrder>

/**
 * Take a payment on an open order. `amountMinor` is the amount applied to the order (for cash,
 * the register works out change) and can't exceed the balance due. Cash is built in; other
 * methods need a payment adapter configured for them.
 */
export const CreatePayment = z
  .object({
    id: Id.optional(),
    expectedVersion: ExpectedVersion,
    method: PaymentMethod,
    amountMinor: MinorUnits.refine((n) => n > 0, 'Amount must be > 0'),
    tipMinor: NonNegativeMinorUnits.default(0),
  })
  .meta({ id: 'CreatePayment' })
export type CreatePayment = z.infer<typeof CreatePayment>

/**
 * Refund part or all of a successful payment, up to what's left of it. Optionally name the lines
 * being refunded and put their stock back.
 */
export const CreateRefund = z
  .object({
    id: Id.optional(),
    paymentId: Id,
    amountMinor: MinorUnits.refine((n) => n > 0, 'Amount must be > 0'),
    reason: Reason,
    lineIds: z.array(Id).max(200).default([]),
    /** Put back the stock the named lines took. Requires `lineIds`. */
    restock: z.boolean().default(false),
  })
  .refine((r) => !r.restock || r.lineIds.length > 0, {
    path: ['lineIds'],
    message: 'Name the lines to restock',
  })
  .meta({ id: 'CreateRefund' })
export type CreateRefund = z.infer<typeof CreateRefund>

export const OrderListQuery = z.object({
  storeId: Id.optional(),
  status: OrderStatus.optional(),
  isTab: z.stringbool().optional(),
  customerId: Id.optional(),
})
export type OrderListQuery = z.infer<typeof OrderListQuery>

export const OrderLineParams = z.object({ tenantId: Id, id: Id, lineId: Id })
