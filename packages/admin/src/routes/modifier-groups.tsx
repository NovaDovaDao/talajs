import type { Modifier, ModifierGroup, StockLevel } from '@talajs/contracts'
import { Pencil, Plus, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { ArchiveButton, ArchivedBadge } from '@/components/archive'
import { FormDialog } from '@/components/form-dialog'
import { MoneyInput } from '@/components/money-input'
import { PageBody, PageHeader } from '@/components/page'
import { EmptyState, ErrorState, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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
import { useAction, useAll } from '@/lib/queries'
import { useTenant } from '@/lib/session'

const NONE = '__none__'

export function selectionRule(g: Pick<ModifierGroup, 'minSelect' | 'maxSelect'>) {
  if (g.minSelect === 0 && g.maxSelect === 1) return 'Optional, pick one'
  if (g.minSelect === 0) return `Optional, up to ${g.maxSelect}`
  if (g.minSelect === g.maxSelect) return `Pick exactly ${g.minSelect}`
  return `Pick ${g.minSelect}–${g.maxSelect}`
}

function GroupDialog({ group, trigger }: { group?: ModifierGroup; trigger: React.ReactNode }) {
  const [name, setName] = useState('')
  const [min, setMin] = useState('0')
  const [max, setMax] = useState('1')
  const valid = name.trim() !== '' && Number(max) >= Number(min) && Number(min) >= 0
  const save = useAction(
    (_: void, { api, tenant }) => {
      const body = { name, minSelect: Number(min), maxSelect: Number(max) }
      return group
        ? api.patch(tenant.path(`/modifier-groups/${group.id}`), body)
        : api.post(tenant.path('/modifier-groups'), body)
    },
    { success: group ? 'Group updated' : 'Group added' },
  )
  return (
    <FormDialog
      trigger={trigger}
      title={group ? 'Edit modifier group' : 'New modifier group'}
      onOpen={() => {
        setName(group?.name ?? '')
        setMin(String(group?.minSelect ?? 0))
        setMax(String(group?.maxSelect ?? 1))
      }}
      pending={save.isPending}
      disabled={!valid}
      onSubmit={() =>
        save
          .mutateAsync()
          .then(() => true)
          .catch(() => false)
      }
    >
      <Field>
        <FieldLabel htmlFor="g-name">Name</FieldLabel>
        <Input
          id="g-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Milk"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="g-min">At least</FieldLabel>
          <Input
            id="g-min"
            type="number"
            min={0}
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="g-max">At most</FieldLabel>
          <Input
            id="g-max"
            type="number"
            min={0}
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </Field>
      </div>
      <FieldDescription>
        Set "at least" to 1 to make a choice required (e.g. size of shot).
      </FieldDescription>
    </FormDialog>
  )
}

function ModifierDialog({
  group,
  modifier,
  stockLevels,
  trigger,
}: {
  group: ModifierGroup
  modifier?: Modifier
  stockLevels: StockLevel[]
  trigger: React.ReactNode
}) {
  const { currency, stores } = useTenant()
  const [name, setName] = useState('')
  const [delta, setDelta] = useState<number | null>(0)
  const [negative, setNegative] = useState(false)
  const [stockLevelId, setStockLevelId] = useState(NONE)
  const save = useAction(
    (_: void, { api, tenant }) => {
      const body = {
        name,
        priceDeltaMinor: (delta ?? 0) * (negative ? -1 : 1),
        stockLevelId: stockLevelId === NONE ? null : stockLevelId,
      }
      return modifier
        ? api.patch(tenant.path(`/modifier-groups/${group.id}/modifiers/${modifier.id}`), body)
        : api.post(tenant.path(`/modifier-groups/${group.id}/modifiers`), body)
    },
    { success: modifier ? 'Modifier updated' : 'Modifier added' },
  )
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? 'Other store'
  return (
    <FormDialog
      trigger={trigger}
      title={modifier ? `Edit ${modifier.name}` : `Add to ${group.name}`}
      onOpen={() => {
        setName(modifier?.name ?? '')
        setDelta(Math.abs(modifier?.priceDeltaMinor ?? 0))
        setNegative((modifier?.priceDeltaMinor ?? 0) < 0)
        setStockLevelId(modifier?.stockLevelId ?? NONE)
      }}
      pending={save.isPending}
      disabled={!name.trim()}
      onSubmit={() =>
        save
          .mutateAsync()
          .then(() => true)
          .catch(() => false)
      }
    >
      <Field>
        <FieldLabel htmlFor="m-name">Name</FieldLabel>
        <Input
          id="m-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Oat"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="m-delta">Price change</FieldLabel>
        <MoneyInput id="m-delta" value={delta} onChange={setDelta} currency={currency} />
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={negative} onCheckedChange={setNegative} /> Discount (subtracts from the
          price)
        </label>
      </Field>
      <Field>
        <FieldLabel>Uses stock</FieldLabel>
        <Select value={stockLevelId} onValueChange={setStockLevelId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not tracked</SelectItem>
            {stockLevels.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name} · {storeName(l.storeId)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </FormDialog>
  )
}

export function ModifierGroups() {
  const tenant = useTenant()
  const [showArchived, setShowArchived] = useState(false)
  const groups = useAll<ModifierGroup>('/modifier-groups', { includeArchived: showArchived })
  const stockLevels = useAll<StockLevel>('/stock-levels')
  const canEdit = tenant.can('MANAGER')
  return (
    <>
      <PageHeader
        title="Modifiers"
        description="Choices like milk, size of shot or extras, attached to items."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show archived
            </label>
            {canEdit && (
              <GroupDialog
                trigger={
                  <Button>
                    <Plus /> New group
                  </Button>
                }
              />
            )}
          </>
        }
      />
      <PageBody>
        {groups.isPending ? (
          <Loading />
        ) : groups.error ? (
          <ErrorState error={groups.error} retry={() => groups.refetch()} />
        ) : groups.data.length === 0 ? (
          <EmptyState
            icon={<SlidersHorizontal />}
            title="No modifier groups"
            description="Milk, Extra shots, Syrups…"
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {groups.data.map((g) => (
              <Card key={g.id}>
                <CardHeader>
                  <CardTitle>
                    {g.name} <ArchivedBadge archivedAt={g.archivedAt} />
                  </CardTitle>
                  <CardDescription>{selectionRule(g)}</CardDescription>
                  {canEdit && (
                    <CardAction className="flex gap-1">
                      <GroupDialog
                        group={g}
                        trigger={
                          <Button size="sm" variant="ghost">
                            <Pencil /> Edit
                          </Button>
                        }
                      />
                      <ArchiveButton
                        path={`/modifier-groups/${g.id}`}
                        archivedAt={g.archivedAt}
                        noun="Group"
                      />
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Option</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.modifiers
                        .filter((m) => showArchived || !m.archivedAt)
                        .map((m) => (
                          <TableRow key={m.id}>
                            <TableCell>
                              {m.name} <ArchivedBadge archivedAt={m.archivedAt} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {m.priceDeltaMinor === 0
                                ? '—'
                                : `${m.priceDeltaMinor > 0 ? '+' : '−'}${money(Math.abs(m.priceDeltaMinor), tenant.currency)}`}
                            </TableCell>
                            <TableCell className="text-right">
                              {canEdit && (
                                <div className="flex justify-end">
                                  <ModifierDialog
                                    group={g}
                                    modifier={m}
                                    stockLevels={stockLevels.data ?? []}
                                    trigger={
                                      <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        aria-label={`Edit ${m.name}`}
                                      >
                                        <Pencil />
                                      </Button>
                                    }
                                  />
                                  <ArchiveButton
                                    path={`/modifier-groups/${g.id}/modifiers/${m.id}`}
                                    archivedAt={m.archivedAt}
                                    noun="Modifier"
                                  />
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                  {canEdit && !g.archivedAt && (
                    <ModifierDialog
                      group={g}
                      stockLevels={stockLevels.data ?? []}
                      trigger={
                        <Button size="sm" variant="outline" className="mt-3">
                          <Plus /> Add option
                        </Button>
                      }
                    />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageBody>
    </>
  )
}
