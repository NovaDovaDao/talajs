import {
  type CreateModifier,
  type CreateModifierGroup,
  type ListQuery,
  type UpdateModifier,
  type UpdateModifierGroup,
  uuidv7,
} from '@talajs/contracts'
import type { Prisma } from '@talajs/db'
import { HttpError, notFound } from '../errors.js'
import { recordChange } from '../lib/change-log.js'
import { toPage, withCursor } from '../lib/pagination.js'
import type { TenantContext, TenantTx } from '../types.js'
import { archivedFilter } from './archive.js'

const modifierSelect = {
  id: true,
  groupId: true,
  name: true,
  priceDeltaMinor: true,
  stockLevelId: true,
  sortOrder: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ModifierSelect

const groupSelect = {
  id: true,
  name: true,
  minSelect: true,
  maxSelect: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  modifiers: { select: modifierSelect, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ModifierGroupSelect

function modifierData(ctx: TenantContext, groupId: string, m: CreateModifier, position = 0) {
  return {
    id: m.id ?? uuidv7(),
    tenantId: ctx.tenantId,
    groupId,
    name: m.name,
    priceDeltaMinor: m.priceDeltaMinor,
    stockLevelId: m.stockLevelId,
    sortOrder: m.sortOrder ?? position,
  }
}

async function loadGroup(tx: Pick<TenantTx, 'modifierGroup'>, id: string) {
  const group = await tx.modifierGroup.findUnique({ where: { id }, select: groupSelect })
  if (!group) throw notFound('Modifier group')
  return group
}

async function touchGroup(tx: TenantTx, ctx: TenantContext, groupId: string) {
  await recordChange(tx, ctx.tenantId, 'modifier_group', groupId, 'upsert')
}

export async function listModifierGroups(ctx: TenantContext, query: ListQuery) {
  const rows = await ctx.db.modifierGroup.findMany({
    where: withCursor(archivedFilter(query), query),
    orderBy: { id: 'asc' },
    take: query.limit + 1,
    select: groupSelect,
  })
  return toPage(rows, query.limit)
}

export const getModifierGroup = (ctx: TenantContext, id: string) => loadGroup(ctx.db, id)

export async function createModifierGroup(ctx: TenantContext, input: CreateModifierGroup) {
  const id = input.id ?? uuidv7()
  return ctx.db.$transaction(async (tx) => {
    await tx.modifierGroup.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        name: input.name,
        minSelect: input.minSelect,
        maxSelect: input.maxSelect,
      },
    })
    if (input.modifiers.length > 0) {
      await tx.modifier.createMany({
        data: input.modifiers.map((m, i) => modifierData(ctx, id, m, i)),
      })
    }
    await touchGroup(tx, ctx, id)
    return loadGroup(tx, id)
  })
}

export async function updateModifierGroup(
  ctx: TenantContext,
  id: string,
  input: UpdateModifierGroup,
) {
  return ctx.db.$transaction(async (tx) => {
    const current = await loadGroup(tx, id)
    const minSelect = input.minSelect ?? current.minSelect
    const maxSelect = input.maxSelect ?? current.maxSelect
    if (maxSelect < minSelect) {
      throw new HttpError(422, 'validation_error', 'maxSelect must be >= minSelect')
    }
    await tx.modifierGroup.update({ where: { id }, data: input })
    await touchGroup(tx, ctx, id)
    return loadGroup(tx, id)
  })
}

export async function setModifierGroupArchived(ctx: TenantContext, id: string, archived: boolean) {
  return ctx.db.$transaction(async (tx) => {
    await tx.modifierGroup.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
    })
    await recordChange(tx, ctx.tenantId, 'modifier_group', id, archived ? 'archive' : 'restore')
    return loadGroup(tx, id)
  })
}

export async function createModifier(ctx: TenantContext, groupId: string, input: CreateModifier) {
  return ctx.db.$transaction(async (tx) => {
    await loadGroup(tx, groupId)
    const modifier = await tx.modifier.create({
      data: modifierData(ctx, groupId, input),
      select: modifierSelect,
    })
    await touchGroup(tx, ctx, groupId)
    return modifier
  })
}

async function modifierOfGroup(tx: TenantTx, groupId: string, modifierId: string) {
  const m = await tx.modifier.findFirst({
    where: { id: modifierId, groupId },
    select: { id: true },
  })
  if (!m) throw notFound('Modifier')
}

export async function updateModifier(
  ctx: TenantContext,
  groupId: string,
  modifierId: string,
  input: UpdateModifier,
) {
  return ctx.db.$transaction(async (tx) => {
    await modifierOfGroup(tx, groupId, modifierId)
    const modifier = await tx.modifier.update({
      where: { id: modifierId },
      data: input,
      select: modifierSelect,
    })
    await touchGroup(tx, ctx, groupId)
    return modifier
  })
}

export async function setModifierArchived(
  ctx: TenantContext,
  groupId: string,
  modifierId: string,
  archived: boolean,
) {
  return ctx.db.$transaction(async (tx) => {
    await modifierOfGroup(tx, groupId, modifierId)
    const modifier = await tx.modifier.update({
      where: { id: modifierId },
      data: { archivedAt: archived ? new Date() : null },
      select: modifierSelect,
    })
    await touchGroup(tx, ctx, groupId)
    return modifier
  })
}
