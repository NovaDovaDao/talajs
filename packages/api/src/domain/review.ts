import type { ListQuery, ResolveReviewItem } from '@talajs/contracts'
import { forbidden, HttpError, notFound } from '../errors.js'
import { toPage, withCursor } from '../lib/pagination.js'
import type { TenantContext } from '../types.js'

const reviewSelect = {
  id: true,
  kind: true,
  subjectType: true,
  subjectId: true,
  syncMutationId: true,
  details: true,
  status: true,
  resolution: true,
  resolvedBy: true,
  resolvedAt: true,
  createdAt: true,
} as const

/** Review items span stores, so the queue is for managers with access to every store. */
function assertAllStores(ctx: TenantContext) {
  if (ctx.storeIds.length > 0) throw forbidden('The review queue needs access to all stores')
}

/** Newest first. */
export async function listReviewItems(
  ctx: TenantContext,
  query: ListQuery & { status?: string | undefined; kind?: string | undefined },
) {
  assertAllStores(ctx)
  const rows = await ctx.db.reviewItem.findMany({
    where: withCursor(
      {
        ...(query.status ? { status: query.status as 'OPEN' } : {}),
        ...(query.kind ? { kind: query.kind as 'SYNC_CONFLICT' } : {}),
      },
      query,
      'desc',
    ),
    orderBy: { id: 'desc' },
    take: query.limit + 1,
    select: reviewSelect,
  })
  return toPage(rows, query.limit)
}

export async function getReviewItem(ctx: TenantContext, id: string) {
  assertAllStores(ctx)
  const row = await ctx.db.reviewItem.findUnique({ where: { id }, select: reviewSelect })
  if (!row) throw notFound('Review item')
  return row
}

/** Records the decision. Fixes (a refund, a stock recount) are made through the normal API. */
export async function resolveReviewItem(ctx: TenantContext, id: string, input: ResolveReviewItem) {
  assertAllStores(ctx)
  const { count } = await ctx.db.reviewItem.updateMany({
    where: { id, status: 'OPEN' },
    data: {
      status: input.status,
      resolution: input.note ? { note: input.note } : {},
      resolvedBy: ctx.actor,
      resolvedAt: new Date(),
    },
  })
  if (count === 0) {
    await getReviewItem(ctx, id)
    throw new HttpError(409, 'invalid_state', 'The review item is already closed')
  }
  return getReviewItem(ctx, id)
}
