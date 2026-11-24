import type { Item, Store, StoreItem } from '@talajs/contracts'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { MoneyInput } from '@/components/money-input'
import { PageBody, PageHeader } from '@/components/page'
import { ErrorState, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAction, useAll, useResource } from '@/lib/queries'
import { useTenant } from '@/lib/session'
import { priceRange } from './items'

function ItemRow({ store, item, setting }: { store: Store; item: Item; setting?: StoreItem }) {
  const tenant = useTenant()
  const available = setting?.available ?? true
  const override = setting?.priceOverrideMinor ?? null
  const put = useAction(
    (body: { available: boolean; priceOverrideMinor: number | null }, { api, tenant }) =>
      api.put(tenant.path(`/stores/${store.id}/items/${item.id}`), body),
  )
  const canEdit = tenant.can('MANAGER')
  const [draft, setDraft] = useState<number | null>(override)
  useEffect(() => setDraft(override), [override])
  return (
    <TableRow>
      <TableCell className="font-medium">{item.name}</TableCell>
      <TableCell className="tabular-nums text-muted-foreground">{priceRange(item)}</TableCell>
      <TableCell>
        <Switch
          checked={available}
          disabled={!canEdit || put.isPending}
          aria-label={`${item.name} sold in ${store.name}`}
          onCheckedChange={(v) => put.mutate({ available: v, priceOverrideMinor: override })}
        />
      </TableCell>
      <TableCell className="w-48">
        {canEdit ? (
          <MoneyInput
            value={draft}
            allowEmpty
            placeholder="Catalog price"
            currency={store.currency}
            onChange={setDraft}
            onBlur={() => {
              if (draft !== override) put.mutate({ available, priceOverrideMinor: draft })
            }}
          />
        ) : (
          (override ?? '—')
        )}
      </TableCell>
    </TableRow>
  )
}

export function StoreDetail() {
  const { storeId = '' } = useParams()
  const store = useResource<Store>(`/stores/${storeId}`)
  const items = useAll<Item>('/items')
  const settings = useResource<{ data: StoreItem[] }>(`/stores/${storeId}/items`)
  const byItem = new Map((settings.data?.data ?? []).map((s) => [s.itemId, s]))
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Button asChild size="icon-sm" variant="ghost" aria-label="Back to stores">
              <Link to=".." relative="path">
                <ArrowLeft />
              </Link>
            </Button>
            {store.data?.name ?? 'Store'}
          </span>
        }
        description="What this store sells, and at what price. A price override applies to every variant of the item."
      />
      <PageBody>
        {store.error || items.error || settings.error ? (
          <ErrorState error={store.error ?? items.error ?? settings.error} />
        ) : !store.data || !items.data || !settings.data ? (
          <Loading rows={6} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Catalog price</TableHead>
                <TableHead>Sold here</TableHead>
                <TableHead>Price override</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.data.map((item) => (
                <ItemRow
                  key={item.id}
                  store={store.data}
                  item={item}
                  setting={byItem.get(item.id)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </PageBody>
    </>
  )
}
