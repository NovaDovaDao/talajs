import type { Category, Item, TaxRate } from '@talajs/contracts'
import { LayoutGrid, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArchivedBadge } from '@/components/archive'
import { PageBody, PageHeader } from '@/components/page'
import { EmptyState, ErrorState, Loading, LoadMore } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { money } from '@/lib/format'
import { useAll, useList } from '@/lib/queries'
import { useTenant } from '@/lib/session'
import { bpsToPercent } from './tax-rates'

const ALL = '__all__'

export function priceRange(item: Item) {
  const live = item.variants.filter((v) => !v.archivedAt)
  if (live.length === 0) return '—'
  const prices = live.map((v) => v.priceMinor)
  const [min, max] = [Math.min(...prices), Math.max(...prices)]
  const currency = live[0]?.currency ?? 'USD'
  return min === max ? money(min, currency) : `${money(min, currency)} – ${money(max, currency)}`
}

export function Items() {
  const tenant = useTenant()
  const navigate = useNavigate()
  const [categoryId, setCategoryId] = useState(ALL)
  const [showArchived, setShowArchived] = useState(false)
  const items = useList<Item>('/items', {
    includeArchived: showArchived,
    categoryId: categoryId === ALL ? undefined : categoryId,
  })
  const categories = useAll<Category>('/categories')
  const taxRates = useAll<TaxRate>('/tax-rates', { includeArchived: true })
  const catName = new Map((categories.data ?? []).map((c) => [c.id, c.name]))
  const rate = new Map((taxRates.data ?? []).map((r) => [r.id, r.rateBps]))

  return (
    <>
      <PageHeader
        title="Items"
        description="What you sell, with sizes (variants), modifiers and tax."
        actions={
          <>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-44" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {(categories.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show archived
            </label>
            {tenant.can('MANAGER') && (
              <Button asChild>
                <Link to="new">
                  <Plus /> New item
                </Link>
              </Button>
            )}
          </>
        }
      />
      <PageBody>
        {items.isPending ? (
          <Loading />
        ) : items.error ? (
          <ErrorState error={items.error} retry={() => items.refetch()} />
        ) : items.items.length === 0 ? (
          <EmptyState
            icon={<LayoutGrid />}
            title="No items yet"
            description="Add your first drink or pastry."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Categories</TableHead>
                  <TableHead>Variants</TableHead>
                  <TableHead>Tax</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.items.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => navigate(item.id)}
                  >
                    <TableCell className="font-medium">
                      {item.name} <ArchivedBadge archivedAt={item.archivedAt} />
                    </TableCell>
                    <TableCell className="flex flex-wrap gap-1">
                      {item.categoryIds.map((id) => (
                        <Badge key={id} variant="secondary">
                          {catName.get(id) ?? '…'}
                        </Badge>
                      ))}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.variants
                        .filter((v) => !v.archivedAt)
                        .map((v) => v.name)
                        .join(', ')}
                    </TableCell>
                    <TableCell>
                      {item.taxRateId && rate.has(item.taxRateId)
                        ? bpsToPercent(rate.get(item.taxRateId) ?? 0)
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{priceRange(item)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <LoadMore {...items} />
          </>
        )}
      </PageBody>
    </>
  )
}
