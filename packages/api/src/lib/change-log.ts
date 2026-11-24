import type { ChangeEntity } from '@talajs/contracts'
import type { TenantTx } from '../types.js'

export type { ChangeEntity }
export type ChangeOp = 'upsert' | 'archive' | 'restore'

/**
 * Append to the change feed terminals pull from (docs/PLAN.md §2.5). Call inside the same
 * transaction as the change, so the feed can never miss or invent a change. Pass `storeId` for
 * store-specific entities (`store`, `store_item`) so pulls can filter by store.
 */
export async function recordChange(
  tx: TenantTx,
  tenantId: string,
  entity: ChangeEntity,
  entityId: string,
  op: ChangeOp,
  storeId: string | null = null,
) {
  await tx.changeLog.create({ data: { tenantId, entity, entityId, op, storeId } })
}
