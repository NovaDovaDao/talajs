import { z } from 'zod'
import { Id } from '../ids.js'
import { Currency, MinorUnits, NonNegativeMinorUnits } from '../money.js'
import { TaxRateBps } from '../pricing.js'
import { Name, Slug, Timestamp } from './common.js'

const SortOrder = z.number().int().min(0).max(1_000_000)
const archived = { archivedAt: Timestamp.nullable() }
const timestamps = { createdAt: Timestamp, updatedAt: Timestamp }

// ── stores ──────────────────────────────────────────────────────────────────

export const Store = z
  .object({
    id: Id,
    name: z.string(),
    slug: z.string(),
    currency: z.string(),
    timezone: z.string(),
    pricesIncludeTax: z.boolean(),
    ...archived,
    ...timestamps,
  })
  .meta({ id: 'Store' })
export type Store = z.infer<typeof Store>

const Timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}, 'Unknown IANA time zone')

export const CreateStore = z
  .object({
    id: Id.optional(),
    name: Name,
    slug: Slug,
    currency: Currency,
    timezone: Timezone.default('UTC'),
    pricesIncludeTax: z.boolean().default(false),
  })
  .meta({ id: 'CreateStore' })
export type CreateStore = z.infer<typeof CreateStore>

/** Currency is fixed once a store exists (orders and prices depend on it). */
export const UpdateStore = z
  .object({
    name: Name.optional(),
    slug: Slug.optional(),
    timezone: Timezone.optional(),
    pricesIncludeTax: z.boolean().optional(),
  })
  .meta({ id: 'UpdateStore' })
export type UpdateStore = z.infer<typeof UpdateStore>

// ── tax rates ───────────────────────────────────────────────────────────────

export const TaxRate = z
  .object({ id: Id, name: z.string(), rateBps: z.number().int(), ...archived, ...timestamps })
  .meta({ id: 'TaxRate' })
export type TaxRate = z.infer<typeof TaxRate>

export const CreateTaxRate = z
  .object({ id: Id.optional(), name: Name, rateBps: TaxRateBps })
  .meta({ id: 'CreateTaxRate' })
export type CreateTaxRate = z.infer<typeof CreateTaxRate>

export const UpdateTaxRate = z
  .object({ name: Name.optional(), rateBps: TaxRateBps.optional() })
  .meta({ id: 'UpdateTaxRate' })
export type UpdateTaxRate = z.infer<typeof UpdateTaxRate>

// ── categories ──────────────────────────────────────────────────────────────

export const Category = z
  .object({
    id: Id,
    name: z.string(),
    parentId: Id.nullable(),
    sortOrder: z.number().int(),
    ...archived,
    ...timestamps,
  })
  .meta({ id: 'Category' })
export type Category = z.infer<typeof Category>

export const CreateCategory = z
  .object({
    id: Id.optional(),
    name: Name,
    parentId: Id.nullable().default(null),
    sortOrder: SortOrder.default(0),
  })
  .meta({ id: 'CreateCategory' })
export type CreateCategory = z.infer<typeof CreateCategory>

export const UpdateCategory = z
  .object({
    name: Name.optional(),
    parentId: Id.nullable().optional(),
    sortOrder: SortOrder.optional(),
  })
  .meta({ id: 'UpdateCategory' })
export type UpdateCategory = z.infer<typeof UpdateCategory>

// ── variants & items ────────────────────────────────────────────────────────

export const Variant = z
  .object({
    id: Id,
    itemId: Id,
    name: z.string(),
    sku: z.string().nullable(),
    priceMinor: z.number().int(),
    currency: z.string(),
    stockLevelId: Id.nullable(),
    sortOrder: z.number().int(),
    ...archived,
    ...timestamps,
  })
  .meta({ id: 'Variant' })
export type Variant = z.infer<typeof Variant>

const Sku = z.string().trim().min(1).max(64)

export const CreateVariant = z
  .object({
    id: Id.optional(),
    /** e.g. "12oz". */
    name: Name,
    sku: Sku.nullable().default(null),
    priceMinor: NonNegativeMinorUnits,
    /** Defaults to the tenant's default currency. */
    currency: Currency.optional(),
    stockLevelId: Id.nullable().default(null),
    /** Defaults to the variant's position in the request (or 0 when added on its own). */
    sortOrder: SortOrder.optional(),
  })
  .meta({ id: 'CreateVariant' })
export type CreateVariant = z.infer<typeof CreateVariant>

export const UpdateVariant = z
  .object({
    name: Name.optional(),
    sku: Sku.nullable().optional(),
    priceMinor: NonNegativeMinorUnits.optional(),
    stockLevelId: Id.nullable().optional(),
    sortOrder: SortOrder.optional(),
  })
  .meta({ id: 'UpdateVariant' })
export type UpdateVariant = z.infer<typeof UpdateVariant>

export const Item = z
  .object({
    id: Id,
    name: z.string(),
    description: z.string().nullable(),
    taxRateId: Id.nullable(),
    /** Incremented on every change to the item or its variants. */
    version: z.number().int(),
    variants: z.array(Variant),
    categoryIds: z.array(Id),
    modifierGroupIds: z.array(Id),
    ...archived,
    ...timestamps,
  })
  .meta({ id: 'Item' })
export type Item = z.infer<typeof Item>

const Description = z.string().trim().max(2000)

export const CreateItem = z
  .object({
    id: Id.optional(),
    name: Name,
    description: Description.nullable().default(null),
    taxRateId: Id.nullable().default(null),
    variants: z.array(CreateVariant).min(1),
    categoryIds: z.array(Id).default([]),
    modifierGroupIds: z.array(Id).default([]),
  })
  .meta({ id: 'CreateItem' })
export type CreateItem = z.infer<typeof CreateItem>

/** `categoryIds` / `modifierGroupIds`, when given, replace the current set (in order). */
export const UpdateItem = z
  .object({
    name: Name.optional(),
    description: Description.nullable().optional(),
    taxRateId: Id.nullable().optional(),
    categoryIds: z.array(Id).optional(),
    modifierGroupIds: z.array(Id).optional(),
  })
  .meta({ id: 'UpdateItem' })
export type UpdateItem = z.infer<typeof UpdateItem>

export const ItemListQuery = z.object({ categoryId: Id.optional() })

// ── modifiers ───────────────────────────────────────────────────────────────

export const Modifier = z
  .object({
    id: Id,
    groupId: Id,
    name: z.string(),
    priceDeltaMinor: z.number().int(),
    stockLevelId: Id.nullable(),
    sortOrder: z.number().int(),
    ...archived,
    ...timestamps,
  })
  .meta({ id: 'Modifier' })
export type Modifier = z.infer<typeof Modifier>

export const CreateModifier = z
  .object({
    id: Id.optional(),
    /** e.g. "Oat". */
    name: Name,
    /** May be negative (e.g. "No milk"). */
    priceDeltaMinor: MinorUnits.default(0),
    stockLevelId: Id.nullable().default(null),
    /** Defaults to the modifier's position in the request (or 0 when added on its own). */
    sortOrder: SortOrder.optional(),
  })
  .meta({ id: 'CreateModifier' })
export type CreateModifier = z.infer<typeof CreateModifier>

export const UpdateModifier = z
  .object({
    name: Name.optional(),
    priceDeltaMinor: MinorUnits.optional(),
    stockLevelId: Id.nullable().optional(),
    sortOrder: SortOrder.optional(),
  })
  .meta({ id: 'UpdateModifier' })
export type UpdateModifier = z.infer<typeof UpdateModifier>

export const ModifierGroup = z
  .object({
    id: Id,
    name: z.string(),
    minSelect: z.number().int(),
    maxSelect: z.number().int(),
    modifiers: z.array(Modifier),
    ...archived,
    ...timestamps,
  })
  .meta({ id: 'ModifierGroup' })
export type ModifierGroup = z.infer<typeof ModifierGroup>

const SelectCount = z.number().int().min(0).max(100)

export const CreateModifierGroup = z
  .object({
    id: Id.optional(),
    /** e.g. "Milk". */
    name: Name,
    minSelect: SelectCount.default(0),
    maxSelect: SelectCount.default(1),
    modifiers: z.array(CreateModifier).default([]),
  })
  .refine((g) => g.maxSelect >= g.minSelect, {
    message: 'maxSelect must be >= minSelect',
    path: ['maxSelect'],
  })
  .meta({ id: 'CreateModifierGroup' })
export type CreateModifierGroup = z.infer<typeof CreateModifierGroup>

export const UpdateModifierGroup = z
  .object({
    name: Name.optional(),
    minSelect: SelectCount.optional(),
    maxSelect: SelectCount.optional(),
  })
  .meta({ id: 'UpdateModifierGroup' })
export type UpdateModifierGroup = z.infer<typeof UpdateModifierGroup>

// ── per-store availability ──────────────────────────────────────────────────

export const StoreItem = z
  .object({
    storeId: Id,
    itemId: Id,
    available: z.boolean(),
    priceOverrideMinor: z.number().int().nullable(),
  })
  .meta({ id: 'StoreItem' })
export type StoreItem = z.infer<typeof StoreItem>

export const PutStoreItem = z
  .object({
    available: z.boolean(),
    priceOverrideMinor: NonNegativeMinorUnits.nullable().default(null),
  })
  .meta({ id: 'PutStoreItem' })
export type PutStoreItem = z.infer<typeof PutStoreItem>
