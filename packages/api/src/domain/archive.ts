import type { ListQuery } from '@talajs/contracts'

/** Default list filter: hide archived rows unless asked. */
export function archivedFilter(query: Pick<ListQuery, 'includeArchived'>) {
  return query.includeArchived ? {} : { archivedAt: null }
}
