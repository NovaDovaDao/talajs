import type { ListQuery } from '@talajs/contracts'

/**
 * Keyset pagination over UUIDv7 ids (which sort by creation time). Query `take: limit + 1`
 * rows ordered by id, with `where: withCursor(filter, query)`, then pass them to `toPage`.
 */
export function withCursor<W extends object>(
  filter: W,
  query: Pick<ListQuery, 'cursor'>,
  direction: 'asc' | 'desc' = 'asc',
) {
  if (!query.cursor) return filter
  return { ...filter, id: direction === 'asc' ? { gt: query.cursor } : { lt: query.cursor } }
}

export function toPage<T extends { id: string }>(rows: T[], limit: number) {
  const data = rows.slice(0, limit)
  return { data, nextCursor: rows.length > limit ? (data.at(-1)?.id ?? null) : null }
}
