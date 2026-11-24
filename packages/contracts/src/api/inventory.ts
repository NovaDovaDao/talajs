import { z } from 'zod'
import { Id } from '../ids.js'
import { Name, Timestamp } from './common.js'

export const StockLevel = z
  .object({
    id: Id,
    storeId: Id,
    name: z.string(),
    unit: z.string(),
    onHand: z.number().int(),
    trackStrictly: z.boolean(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'StockLevel' })
export type StockLevel = z.infer<typeof StockLevel>

const Unit = z.string().trim().min(1).max(32)

export const CreateStockLevel = z
  .object({
    id: Id.optional(),
    storeId: Id,
    name: Name,
    unit: Unit.default('each'),
    /** Initial count, recorded as a RECOUNT movement. */
    onHand: z.number().int().min(0).default(0),
    trackStrictly: z.boolean().default(true),
  })
  .meta({ id: 'CreateStockLevel' })
export type CreateStockLevel = z.infer<typeof CreateStockLevel>

/** On-hand quantity only changes through adjustments (and sales), never by direct update. */
export const UpdateStockLevel = z
  .object({ name: Name.optional(), unit: Unit.optional(), trackStrictly: z.boolean().optional() })
  .meta({ id: 'UpdateStockLevel' })
export type UpdateStockLevel = z.infer<typeof UpdateStockLevel>

const Note = z.string().trim().max(500).optional()

export const StockAdjustment = z
  .discriminatedUnion('reason', [
    z.object({
      reason: z.literal('RECEIVE'),
      delta: z.number().int().positive(),
      note: Note,
    }),
    z.object({
      reason: z.literal('ADJUST'),
      delta: z
        .number()
        .int()
        .refine((n) => n !== 0, 'delta must not be 0'),
      note: Note,
    }),
    z.object({ reason: z.literal('RECOUNT'), count: z.number().int().min(0), note: Note }),
  ])
  .meta({ id: 'StockAdjustment' })
export type StockAdjustment = z.infer<typeof StockAdjustment>

export const StockMovementReason = z.enum([
  'SALE',
  'VOID',
  'REFUND',
  'ADJUST',
  'RECOUNT',
  'RECEIVE',
])

export const StockMovement = z
  .object({
    id: Id,
    stockLevelId: Id,
    delta: z.number().int(),
    reason: StockMovementReason,
    orderLineId: Id.nullable(),
    note: z.string().nullable(),
    actor: z.string(),
    createdAt: Timestamp,
  })
  .meta({ id: 'StockMovement' })
export type StockMovement = z.infer<typeof StockMovement>

export const StockLevelListQuery = z.object({ storeId: Id.optional() })
