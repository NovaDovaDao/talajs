import type { Category, Item, ModifierGroup, StockLevel, TaxRate } from '@talajs/contracts'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArchiveButton, ArchivedBadge } from '@/components/archive'
import { MoneyInput } from '@/components/money-input'
import { PageBody, PageHeader } from '@/components/page'
import { ErrorState, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useAction, useAll, useResource } from '@/lib/queries'
import { useTenant } from '@/lib/session'
import { categoryTree } from './categories'
import { selectionRule } from './modifier-groups'
import { bpsToPercent } from './tax-rates'

const NONE = '__none__'

interface VariantDraft {
  /** Present for saved variants. */
  id?: string
  key: string
  name: string
  sku: string
  priceMinor: number | null
  stockLevelId: string
  archivedAt: string | null
}

interface Draft {
  name: string
  description: string
  taxRateId: string
  categoryIds: string[]
  modifierGroupIds: string[]
  variants: VariantDraft[]
}

const newVariant = (name = ''): VariantDraft => ({
  key: crypto.randomUUID(),
  name,
  sku: '',
  priceMinor: null,
  stockLevelId: NONE,
  archivedAt: null,
})

function fromItem(item: Item): Draft {
  return {
    name: item.name,
    description: item.description ?? '',
    taxRateId: item.taxRateId ?? NONE,
    categoryIds: item.categoryIds,
    modifierGroupIds: item.modifierGroupIds,
    variants: item.variants.map((v) => ({
      id: v.id,
      key: v.id,
      name: v.name,
      sku: v.sku ?? '',
      priceMinor: v.priceMinor,
      stockLevelId: v.stockLevelId ?? NONE,
      archivedAt: v.archivedAt,
    })),
  }
}

const toggle = (list: string[], id: string, on: boolean) =>
  on ? [...list, id] : list.filter((x) => x !== id)

function CheckList<T extends { id: string; name: string }>({
  options,
  selected,
  onChange,
  describe,
  indent,
}: {
  options: T[]
  selected: string[]
  onChange: (ids: string[]) => void
  describe?: (o: T) => string
  indent?: (o: T) => number
}) {
  if (options.length === 0)
    return <p className="text-sm text-muted-foreground">None defined yet.</p>
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <label
          key={o.id}
          className="flex items-center gap-2 text-sm"
          style={indent ? { paddingLeft: `${indent(o) * 1.25}rem` } : undefined}
        >
          <Checkbox
            checked={selected.includes(o.id)}
            onCheckedChange={(v) => onChange(toggle(selected, o.id, v === true))}
          />
          <span>
            {o.name}
            {describe && <span className="ml-1 text-muted-foreground">· {describe(o)}</span>}
          </span>
        </label>
      ))}
    </div>
  )
}

export function ItemEditor() {
  const { itemId } = useParams()
  const navigate = useNavigate()
  const tenant = useTenant()
  const canEdit = tenant.can('MANAGER')
  const existing = useResource<Item>(itemId ? `/items/${itemId}` : null)
  const taxRates = useAll<TaxRate>('/tax-rates')
  const categories = useAll<Category>('/categories')
  const groups = useAll<ModifierGroup>('/modifier-groups')
  const stockLevels = useAll<StockLevel>('/stock-levels')
  const [draft, setDraft] = useState<Draft | null>(
    itemId
      ? null
      : {
          name: '',
          description: '',
          taxRateId: NONE,
          categoryIds: [],
          modifierGroupIds: [],
          variants: [newVariant('Regular')],
        },
  )
  useEffect(() => {
    if (existing.data) setDraft(fromItem(existing.data))
  }, [existing.data])

  const save = useAction(
    async (d: Draft, { api, tenant }) => {
      const fields = {
        name: d.name.trim(),
        description: d.description.trim() || null,
        taxRateId: d.taxRateId === NONE ? null : d.taxRateId,
        categoryIds: d.categoryIds,
        modifierGroupIds: d.modifierGroupIds,
      }
      const variant = (v: VariantDraft) => ({
        name: v.name.trim(),
        sku: v.sku.trim() || null,
        priceMinor: v.priceMinor ?? 0,
        stockLevelId: v.stockLevelId === NONE ? null : v.stockLevelId,
      })
      if (!existing.data) {
        return api.post<Item>(tenant.path('/items'), {
          ...fields,
          variants: d.variants.map(variant),
        })
      }
      const id = existing.data.id
      await api.patch(tenant.path(`/items/${id}`), fields)
      const before = new Map(existing.data.variants.map((v) => [v.id, v]))
      for (const v of d.variants) {
        if (!v.id) {
          await api.post(tenant.path(`/items/${id}/variants`), variant(v))
          continue
        }
        const old = before.get(v.id)
        const next = variant(v)
        if (
          old &&
          (old.name !== next.name ||
            old.sku !== next.sku ||
            old.priceMinor !== next.priceMinor ||
            old.stockLevelId !== next.stockLevelId)
        ) {
          await api.patch(tenant.path(`/items/${id}/variants/${v.id}`), next)
        }
      }
      return existing.data
    },
    {
      success: itemId ? 'Item saved' : 'Item created',
      onSuccess: (item) => {
        if (!itemId) navigate(`../${item.id}`, { relative: 'path', replace: true })
      },
    },
  )

  if (itemId && existing.error) return <ErrorState error={existing.error} />
  if (!draft) {
    return (
      <PageBody>
        <Loading rows={6} />
      </PageBody>
    )
  }
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const setVariant = (key: string, patch: Partial<VariantDraft>) =>
    set({ variants: draft.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)) })
  const liveVariants = draft.variants.filter((v) => !v.archivedAt)
  const valid =
    draft.name.trim() !== '' &&
    liveVariants.length > 0 &&
    draft.variants.every((v) => v.archivedAt || (v.name.trim() !== '' && v.priceMinor !== null))
  const storeName = (id: string) => tenant.stores.find((s) => s.id === id)?.name ?? 'Other store'

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Button asChild size="icon-sm" variant="ghost" aria-label="Back to items">
              <Link to={itemId ? '..' : '..'} relative="path">
                <ArrowLeft />
              </Link>
            </Button>
            {itemId ? draft.name || 'Item' : 'New item'}
            {existing.data && <ArchivedBadge archivedAt={existing.data.archivedAt} />}
          </span>
        }
        actions={
          canEdit && (
            <>
              {existing.data && (
                <ArchiveButton
                  path={`/items/${existing.data.id}`}
                  archivedAt={existing.data.archivedAt}
                  noun="Item"
                />
              )}
              <Button disabled={!valid || save.isPending} onClick={() => save.mutate(draft)}>
                {save.isPending && <Spinner />} Save
              </Button>
            </>
          )
        }
      />
      <PageBody className="lg:grid lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="item-name">Name</FieldLabel>
                  <Input
                    id="item-name"
                    value={draft.name}
                    onChange={(e) => set({ name: e.target.value })}
                    disabled={!canEdit}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="item-desc">Description</FieldLabel>
                  <Textarea
                    id="item-desc"
                    value={draft.description}
                    onChange={(e) => set({ description: e.target.value })}
                    disabled={!canEdit}
                  />
                </Field>
                <Field>
                  <FieldLabel>Tax rate</FieldLabel>
                  <Select
                    value={draft.taxRateId}
                    onValueChange={(v) => set({ taxRateId: v })}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No tax</SelectItem>
                      {(taxRates.data ?? []).map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name} ({bpsToPercent(r.rateBps)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Variants</CardTitle>
              <CardDescription>
                Sizes or versions, each with its own price. Use one called "Regular" if there's only
                one.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-40">Price</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {draft.variants.map((v) => (
                    <TableRow key={v.key} className={v.archivedAt ? 'opacity-60' : ''}>
                      <TableCell>
                        <Input
                          aria-label="Variant name"
                          value={v.name}
                          onChange={(e) => setVariant(v.key, { name: e.target.value })}
                          disabled={!canEdit || !!v.archivedAt}
                        />
                      </TableCell>
                      <TableCell>
                        <MoneyInput
                          value={v.priceMinor}
                          onChange={(priceMinor) => setVariant(v.key, { priceMinor })}
                          currency={tenant.currency}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label="SKU"
                          value={v.sku}
                          onChange={(e) => setVariant(v.key, { sku: e.target.value })}
                          disabled={!canEdit || !!v.archivedAt}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={v.stockLevelId}
                          onValueChange={(stockLevelId) => setVariant(v.key, { stockLevelId })}
                          disabled={!canEdit || !!v.archivedAt}
                        >
                          <SelectTrigger aria-label="Stock level">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Not tracked</SelectItem>
                            {(stockLevels.data ?? []).map((l) => (
                              <SelectItem key={l.id} value={l.id}>
                                {l.name} · {storeName(l.storeId)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        {canEdit &&
                          (v.id && existing.data ? (
                            <ArchiveButton
                              path={`/items/${existing.data.id}/variants/${v.id}`}
                              archivedAt={v.archivedAt}
                              noun="Variant"
                            />
                          ) : (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Remove variant"
                              onClick={() =>
                                set({ variants: draft.variants.filter((x) => x.key !== v.key) })
                              }
                            >
                              <Trash2 />
                            </Button>
                          ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => set({ variants: [...draft.variants, newVariant()] })}
                >
                  <Plus /> Add variant
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Categories</CardTitle>
            </CardHeader>
            <CardContent>
              <CheckList
                options={categoryTree(categories.data ?? []).map((c) => ({
                  ...c.category,
                  depth: c.depth,
                }))}
                selected={draft.categoryIds}
                onChange={(categoryIds) => canEdit && set({ categoryIds })}
                indent={(o) => o.depth}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Modifier groups</CardTitle>
              <CardDescription>Choices offered when this item is sold.</CardDescription>
            </CardHeader>
            <CardContent>
              <CheckList
                options={groups.data ?? []}
                selected={draft.modifierGroupIds}
                onChange={(modifierGroupIds) => canEdit && set({ modifierGroupIds })}
                describe={selectionRule}
              />
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  )
}
