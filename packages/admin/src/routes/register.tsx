import {
  type Category,
  type Item,
  type ModifierGroup,
  type Order,
  priceOrder,
  type StoreItem,
  type TaxRate,
} from '@talajs/contracts'
import { Coffee, Minus, Plus, Search, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { CashDialog } from '@/components/cash-dialog'
import { FormDialog } from '@/components/form-dialog'
import { PageHeader } from '@/components/page'
import { EmptyState, ErrorState, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { money } from '@/lib/format'
import { errorMessage, useAction, useAll, useResource } from '@/lib/queries'
import { useApp, useTenant } from '@/lib/session'
import { selectionRule } from './modifier-groups'

interface CartLine {
  key: string
  item: Item
  variantId: string
  modifierIds: string[]
  quantity: number
  note: string
}

const ALL = '__all__'

/** Choose a variant, modifiers, quantity and note for one item. */
function ItemDialog({
  item,
  groups,
  unitPrice,
  currency,
  onClose,
  onAdd,
}: {
  item: Item
  groups: ModifierGroup[]
  unitPrice: (item: Item, variantId: string) => number
  currency: string
  onClose: () => void
  onAdd: (line: Omit<CartLine, 'key' | 'item'>) => void
}) {
  const variants = item.variants.filter((v) => !v.archivedAt)
  const itemGroups = item.modifierGroupIds
    .map((id) => groups.find((g) => g.id === id))
    .filter((g): g is ModifierGroup => !!g && !g.archivedAt)
  const [variantId, setVariantId] = useState(variants[0]?.id ?? '')
  const [chosen, setChosen] = useState<string[]>([])
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState('')
  const problems = itemGroups.filter((g) => {
    const n = g.modifiers.filter((m) => chosen.includes(m.id)).length
    return n < g.minSelect || n > g.maxSelect
  })
  const deltas = itemGroups.flatMap((g) => g.modifiers).filter((m) => chosen.includes(m.id))
  const each = unitPrice(item, variantId) + deltas.reduce((s, m) => s + m.priceDeltaMinor, 0)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          {item.description && <DialogDescription>{item.description}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {variants.length > 1 && (
            <FieldSet>
              <FieldLegend variant="label">Size</FieldLegend>
              <ToggleGroup
                type="single"
                variant="outline"
                value={variantId}
                onValueChange={(v) => v && setVariantId(v)}
                className="flex-wrap"
              >
                {variants.map((v) => (
                  <ToggleGroupItem key={v.id} value={v.id}>
                    {v.name} · {money(unitPrice(item, v.id), currency)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </FieldSet>
          )}
          {itemGroups.map((g) => {
            const options = g.modifiers.filter((m) => !m.archivedAt)
            const single = g.maxSelect === 1
            return (
              <FieldSet key={g.id}>
                <FieldLegend variant="label">
                  {g.name}{' '}
                  <span className="font-normal text-muted-foreground">· {selectionRule(g)}</span>
                </FieldLegend>
                {single ? (
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    className="flex-wrap"
                    value={options.find((m) => chosen.includes(m.id))?.id ?? ''}
                    onValueChange={(id) =>
                      setChosen([
                        ...chosen.filter((c) => !options.some((m) => m.id === c)),
                        ...(id ? [id] : []),
                      ])
                    }
                  >
                    {options.map((m) => (
                      <ToggleGroupItem key={m.id} value={m.id}>
                        {m.name}
                        {m.priceDeltaMinor !== 0 &&
                          ` ${m.priceDeltaMinor > 0 ? '+' : '−'}${money(Math.abs(m.priceDeltaMinor), currency)}`}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {options.map((m) => (
                      <label key={m.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={chosen.includes(m.id)}
                          onCheckedChange={(v) =>
                            setChosen(
                              v === true ? [...chosen, m.id] : chosen.filter((c) => c !== m.id),
                            )
                          }
                        />
                        {m.name}
                        {m.priceDeltaMinor !== 0 && (
                          <span className="text-muted-foreground">
                            {m.priceDeltaMinor > 0 ? '+' : '−'}
                            {money(Math.abs(m.priceDeltaMinor), currency)}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </FieldSet>
            )
          })}
          <div className="flex items-end gap-3">
            <Field className="w-auto">
              <FieldLabel>Quantity</FieldLabel>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  aria-label="Fewer"
                >
                  <Minus />
                </Button>
                <span className="w-8 text-center tabular-nums">{quantity}</span>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setQuantity(quantity + 1)}
                  aria-label="More"
                >
                  <Plus />
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="line-note">Note</FieldLabel>
              <Input
                id="line-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Extra hot"
              />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button
            className="w-full"
            disabled={problems.length > 0 || !variantId}
            onClick={() => onAdd({ variantId, modifierIds: chosen, quantity, note })}
          >
            {problems.length > 0
              ? `Choose ${problems[0]?.name}`
              : `Add · ${money(Math.max(each, 0) * quantity, currency)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Register() {
  const tenant = useTenant()
  const { api } = useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const addToOrderId = params.get('order')
  const store = tenant.stores.find((s) => s.id === tenant.storeId)
  const items = useAll<Item>('/items')
  const groups = useAll<ModifierGroup>('/modifier-groups')
  const categories = useAll<Category>('/categories')
  const taxRates = useAll<TaxRate>('/tax-rates', { includeArchived: true })
  const storeItems = useResource<{ data: StoreItem[] }>(store ? `/stores/${store.id}/items` : null)
  const target = useResource<Order>(addToOrderId ? `/orders/${addToOrderId}` : null)

  const [category, setCategory] = useState(ALL)
  const [search, setSearch] = useState('')
  const [picking, setPicking] = useState<Item | null>(null)
  const [cart, setCart] = useState<CartLine[]>([])
  const [charging, setCharging] = useState<Order | null>(null)
  const [tabOpen, setTabOpen] = useState(false)
  const [tabName, setTabName] = useState('')
  // Set when a payment went through, so the dialog closing afterwards isn't read as "cancelled".
  const justPaid = useRef(false)

  const settings = useMemo(
    () => new Map((storeItems.data?.data ?? []).map((s) => [s.itemId, s])),
    [storeItems.data],
  )
  const rateOf = useMemo(
    () => new Map((taxRates.data ?? []).map((r) => [r.id, r.rateBps])),
    [taxRates.data],
  )
  const modifierById = useMemo(
    () => new Map((groups.data ?? []).flatMap((g) => g.modifiers.map((m) => [m.id, m] as const))),
    [groups.data],
  )
  const currency = store?.currency ?? tenant.currency
  const unitPrice = useCallback(
    (item: Item, variantId: string) =>
      settings.get(item.id)?.priceOverrideMinor ??
      item.variants.find((v) => v.id === variantId)?.priceMinor ??
      0,
    [settings],
  )

  const sellable = (items.data ?? []).filter(
    (i) =>
      !i.archivedAt &&
      i.variants.some((v) => !v.archivedAt && v.currency === currency) &&
      settings.get(i.id)?.available !== false &&
      (category === ALL || i.categoryIds.includes(category)) &&
      (!search.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase())),
  )

  const totals = useMemo(
    () =>
      priceOrder({
        currency,
        pricesIncludeTax: store?.pricesIncludeTax ?? false,
        lines: cart.map((l) => ({
          unitPriceMinor: unitPrice(l.item, l.variantId),
          quantity: l.quantity,
          modifierDeltasMinor: l.modifierIds.map(
            (id) => modifierById.get(id)?.priceDeltaMinor ?? 0,
          ),
          taxRateBps: l.item.taxRateId ? (rateOf.get(l.item.taxRateId) ?? 0) : 0,
        })),
      }),
    [cart, currency, store, modifierById, rateOf, unitPrice],
  )

  const add = (item: Item) => {
    const live = item.variants.filter((v) => !v.archivedAt)
    if (live.length === 1 && item.modifierGroupIds.length === 0) {
      setCart([
        ...cart,
        {
          key: crypto.randomUUID(),
          item,
          variantId: live[0]?.id ?? '',
          modifierIds: [],
          quantity: 1,
          note: '',
        },
      ])
    } else {
      setPicking(item)
    }
  }
  const lines = () =>
    cart.map((l) => ({
      id: crypto.randomUUID(),
      variantId: l.variantId,
      quantity: l.quantity,
      modifierIds: l.modifierIds,
      ...(l.note.trim() ? { note: l.note.trim() } : {}),
    }))

  const submit = useAction(
    async (mode: 'charge' | 'tab' | 'add', { api, tenant }) => {
      if (mode === 'add' && target.data) {
        return api.post<Order>(tenant.path(`/orders/${target.data.id}/lines`), {
          expectedVersion: target.data.version,
          lines: lines(),
        })
      }
      return api.post<Order>(tenant.path('/orders'), {
        id: crypto.randomUUID(),
        storeId: tenant.storeId,
        source: 'ADMIN',
        isTab: mode === 'tab',
        tabName: mode === 'tab' ? tabName.trim() : null,
        lines: lines(),
      })
    },
    {
      onSuccess: (order) => {
        setCart([])
        if (addToOrderId) {
          toast.success('Added to order')
          navigate(`../orders/${order.id}`, { relative: 'path' })
        } else if (order.isTab) {
          toast.success(`Tab "${order.tabName}" opened`)
          setTabOpen(false)
        } else {
          setCharging(order)
        }
      },
    },
  )

  const finish = async (order: Order) => {
    justPaid.current = true
    if (order.balanceDueMinor > 0) {
      setCharging(order)
      return
    }
    try {
      await api.post(tenant.path(`/orders/${order.id}/complete`), {
        expectedVersion: order.version,
      })
      toast.success(`Order ${order.number} completed`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
    setCharging(null)
  }

  const loading = items.isPending || groups.isPending || storeItems.isPending
  const error = items.error ?? groups.error ?? storeItems.error

  return (
    <>
      <PageHeader
        title={
          target.data
            ? `Add to order ${target.data.number}${target.data.tabName ? ` · ${target.data.tabName}` : ''}`
            : 'Register'
        }
        description={store ? store.name : 'Choose a store in the sidebar'}
      />
      {!store ? (
        <div className="p-4">
          <EmptyState icon={<Coffee />} title="No store selected" />
        </div>
      ) : error ? (
        <div className="p-4">
          <ErrorState error={error} />
        </div>
      ) : (
        <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[1fr_22rem]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <InputGroup className="max-w-xs">
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="Find an item"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </InputGroup>
              <ToggleGroup
                type="single"
                variant="outline"
                value={category}
                onValueChange={(v) => setCategory(v || ALL)}
                className="flex-wrap"
              >
                <ToggleGroupItem value={ALL}>All</ToggleGroupItem>
                {(categories.data ?? []).map((c) => (
                  <ToggleGroupItem key={c.id} value={c.id}>
                    {c.name}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            {loading ? (
              <Loading rows={6} />
            ) : sellable.length === 0 ? (
              <EmptyState
                icon={<Coffee />}
                title="Nothing to sell here"
                description="Add items, or check what this store sells."
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {sellable.map((item) => {
                  const live = item.variants.filter((v) => !v.archivedAt)
                  const from = Math.min(...live.map((v) => unitPrice(item, v.id)))
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => add(item)}
                      className="flex min-h-24 flex-col justify-between rounded-lg border bg-card p-3 text-left transition hover:border-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span className="font-medium">{item.name}</span>
                      <span className="text-sm text-muted-foreground tabular-nums">
                        {live.length > 1 ? 'from ' : ''}
                        {money(from, currency)}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <Card className="lg:sticky lg:top-4 lg:max-h-[calc(100svh-6rem)]">
            <CardHeader>
              <CardTitle>Current order</CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col">
              {cart.length === 0 ? (
                <p className="text-sm text-muted-foreground">Tap items to add them.</p>
              ) : (
                <ScrollArea className="min-h-0 flex-1">
                  <ul className="flex flex-col gap-3 pr-2">
                    {cart.map((l, i) => {
                      const variant = l.item.variants.find((v) => v.id === l.variantId)
                      const mods = l.modifierIds
                        .map((id) => modifierById.get(id)?.name)
                        .filter(Boolean)
                      return (
                        <li key={l.key} className="flex items-start gap-2 text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">
                              {l.item.name}
                              {l.item.variants.filter((v) => !v.archivedAt).length > 1 &&
                                ` · ${variant?.name}`}
                            </div>
                            {mods.length > 0 && (
                              <div className="text-xs text-muted-foreground">{mods.join(', ')}</div>
                            )}
                            {l.note && <div className="text-xs italic">{l.note}</div>}
                            <div className="mt-1 flex items-center gap-1">
                              <Button
                                size="icon-xs"
                                variant="outline"
                                aria-label="Fewer"
                                onClick={() =>
                                  setCart(
                                    cart.map((c) =>
                                      c.key === l.key
                                        ? { ...c, quantity: Math.max(1, c.quantity - 1) }
                                        : c,
                                    ),
                                  )
                                }
                              >
                                <Minus />
                              </Button>
                              <span className="w-6 text-center tabular-nums">{l.quantity}</span>
                              <Button
                                size="icon-xs"
                                variant="outline"
                                aria-label="More"
                                onClick={() =>
                                  setCart(
                                    cart.map((c) =>
                                      c.key === l.key ? { ...c, quantity: c.quantity + 1 } : c,
                                    ),
                                  )
                                }
                              >
                                <Plus />
                              </Button>
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                aria-label="Remove"
                                onClick={() => setCart(cart.filter((c) => c.key !== l.key))}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </div>
                          <span className="tabular-nums">
                            {money(totals.lines[i]?.lineTotalMinor ?? 0, currency)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </ScrollArea>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-3 border-t">
              <dl className="grid w-full grid-cols-2 gap-1 text-sm">
                <dt>Subtotal</dt>
                <dd className="text-right tabular-nums">{money(totals.subtotalMinor, currency)}</dd>
                <dt>Tax</dt>
                <dd className="text-right tabular-nums">{money(totals.taxMinor, currency)}</dd>
                <dt className="font-heading text-base font-semibold">Total</dt>
                <dd className="text-right font-heading text-base font-semibold tabular-nums">
                  {money(totals.totalMinor, currency)}
                </dd>
              </dl>
              {addToOrderId ? (
                <Button
                  className="w-full"
                  size="lg"
                  disabled={cart.length === 0 || submit.isPending || !target.data}
                  onClick={() => submit.mutate('add')}
                >
                  Add to order
                </Button>
              ) : (
                <div className="grid w-full grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="lg"
                    disabled={cart.length === 0 || submit.isPending}
                    onClick={() => {
                      setTabName('')
                      setTabOpen(true)
                    }}
                  >
                    Open tab
                  </Button>
                  <Button
                    size="lg"
                    disabled={cart.length === 0 || submit.isPending}
                    onClick={() => submit.mutate('charge')}
                  >
                    Charge
                  </Button>
                </div>
              )}
            </CardFooter>
          </Card>
        </div>
      )}

      {picking && (
        <ItemDialog
          item={picking}
          groups={groups.data ?? []}
          unitPrice={unitPrice}
          currency={currency}
          onClose={() => setPicking(null)}
          onAdd={(line) => {
            setCart([...cart, { ...line, key: crypto.randomUUID(), item: picking }])
            setPicking(null)
          }}
        />
      )}

      <FormDialog
        open={tabOpen}
        onOpenChange={setTabOpen}
        title="Open a tab"
        description="Lines can be added to it later from Orders & tabs."
        submitLabel="Open tab"
        pending={submit.isPending}
        disabled={!tabName.trim()}
        onSubmit={async () => {
          submit.mutate('tab')
          return false
        }}
      >
        <Field>
          <FieldLabel htmlFor="tab-name">Name</FieldLabel>
          <Input
            id="tab-name"
            value={tabName}
            onChange={(e) => setTabName(e.target.value)}
            placeholder="Table 4"
            autoFocus
          />
        </Field>
      </FormDialog>

      {charging && (
        <CashDialog
          key={`${charging.id}-${charging.version}`}
          order={charging}
          open
          onOpenChange={(open) => {
            if (open) return
            if (justPaid.current) {
              justPaid.current = false
              return
            }
            toast.info(`Order ${charging.number} is still open in Orders & tabs`)
            setCharging(null)
          }}
          onPaid={finish}
        />
      )}
    </>
  )
}
