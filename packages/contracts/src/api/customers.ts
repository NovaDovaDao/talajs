import { z } from 'zod'
import { Id } from '../ids.js'
import { Email, Name, Timestamp } from './common.js'
import { OrderStatus } from './orders.js'

const Phone = z.string().trim().min(3).max(32)
const TagName = z.string().trim().min(1).max(64)

export const Customer = z
  .object({
    id: Id,
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    marketingOptIn: z.boolean(),
    tags: z.array(z.string()),
    archivedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Customer' })
export type Customer = z.infer<typeof Customer>

export const CreateCustomer = z
  .object({
    id: Id.optional(),
    name: Name.nullable().default(null),
    email: Email.nullable().default(null),
    phone: Phone.nullable().default(null),
    marketingOptIn: z.boolean().default(false),
    tags: z.array(TagName).default([]),
  })
  .meta({ id: 'CreateCustomer' })
export type CreateCustomer = z.infer<typeof CreateCustomer>

/** `tags`, when given, replaces the customer's tags. */
export const UpdateCustomer = z
  .object({
    name: Name.nullable().optional(),
    email: Email.nullable().optional(),
    phone: Phone.nullable().optional(),
    marketingOptIn: z.boolean().optional(),
    tags: z.array(TagName).optional(),
  })
  .meta({ id: 'UpdateCustomer' })
export type UpdateCustomer = z.infer<typeof UpdateCustomer>

export const CustomerListQuery = z.object({
  /** Case-insensitive match on name, email or phone. */
  q: z.string().trim().min(1).max(100).optional(),
  tag: TagName.optional(),
})

export const CustomerNote = z
  .object({ id: Id, customerId: Id, body: z.string(), author: z.string(), createdAt: Timestamp })
  .meta({ id: 'CustomerNote' })
export type CustomerNote = z.infer<typeof CustomerNote>

export const CreateCustomerNote = z
  .object({ id: Id.optional(), body: z.string().trim().min(1).max(5000) })
  .meta({ id: 'CreateCustomerNote' })
export type CreateCustomerNote = z.infer<typeof CreateCustomerNote>

export const Tag = z
  .object({ id: Id, name: z.string(), customerCount: z.number().int() })
  .meta({ id: 'Tag' })
export type Tag = z.infer<typeof Tag>

export const OrderSummary = z
  .object({
    id: Id,
    storeId: Id,
    number: z.string(),
    status: OrderStatus,
    currency: z.string(),
    totalMinor: z.number().int(),
    openedAt: Timestamp,
    completedAt: Timestamp.nullable(),
  })
  .meta({ id: 'OrderSummary' })
export type OrderSummary = z.infer<typeof OrderSummary>
