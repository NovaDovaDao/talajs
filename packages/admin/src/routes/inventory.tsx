import type { StockLevel, StockMovement } from '@talajs/contracts'
import { Boxes, History, Pencil, Plus, SlidersVertical } from 'lucide-react'
import { useState } from 'react'
import { FormDialog } from '@/components/form-dialog'
import { PageBody, PageHeader } from '@/components/page'
import { EmptyState, ErrorState, Loading, LoadMore } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { when } from '@/lib/format'
import { useAction, useAll, useList } from '@/lib/queries'
import { useTenant } from '@/lib/session'

type Reason = 'RECEIVE' | 'ADJUST' | 'RECOUNT'

function LevelDialog({ level, trigger }: { level?: StockLevel; trigger: React.ReactNode }) {
  const { storeId } = useTenant()
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('each')
  const [onHand, setOnHand] = useState('0')
  const [strict, setStrict] = useState(true)
  const save = useAction(
    (_: void, { api, tenant }) =>
      level
        ? api.patch(tenant.path(`/stock-levels/${level.id}`), { name, unit, trackStrictly: strict })
        : api.post(tenant.path('/stock-levels'), {
            storeId,
            name,
            unit,
            onHand: Number(onHand) || 0,
            trackStrictly: strict,
          }),
    { success: level ? 'Stock level updated' : 'Stock level added' },
  )
  return (
    <FormDialog
      trigger={trigger}
      title={level ? `Edit ${level.name}` : 'Track a new stock item'}
      onOpen={() => {
        setName(level?.name ?? '')
        setUnit(level?.unit ?? 'each')
        setOnHand('0')
        setStrict(level?.trackStrictly ?? true)
      }}
      pending={save.isPending}
      disabled={!name.trim() || (!level && !storeId)}
      onSubmit={() =>
        save
          .mutateAsync()
          .then(() => true)
          .catch(() => false)
      }
    >
      <Field>
        <FieldLabel htmlFor="l-name">Name</FieldLabel>
        <Input
          id="l-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Croissants"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="l-unit">Unit</FieldLabel>
          <Input id="l-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
        {!level && (
          <Field>
            <FieldLabel htmlFor="l-count">Count now</FieldLabel>
            <Input
              id="l-count"
              type="number"
              min={0}
              value={onHand}
              onChange={(e) => setOnHand(e.target.value)}
            />
          </Field>
        )}
      </div>
      <Field orientation="horizontal">
        <Switch id="l-strict" checked={strict} onCheckedChange={setStrict} />
        <FieldLabel htmlFor="l-strict">Never sell below zero</FieldLabel>
      </Field>
      <FieldDescription>
        Online and admin sales are refused when it would go below zero. Offline register sales are
        always recorded and flagged for review instead.
      </FieldDescription>
    </FormDialog>
  )
}

function AdjustDialog({ level }: { level: StockLevel }) {
  const [reason, setReason] = useState<Reason>('RECEIVE')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const n = Number(amount)
  const valid =
    amount !== '' &&
    Number.isInteger(n) &&
    (reason === 'RECOUNT' ? n >= 0 : reason === 'RECEIVE' ? n > 0 : n !== 0)
  const save = useAction(
    (_: void, { api, tenant }) =>
      api.post(tenant.path(`/stock-levels/${level.id}/adjustments`), {
        reason,
        ...(reason === 'RECOUNT' ? { count: n } : { delta: n }),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    { success: 'Stock updated' },
  )
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          <SlidersVertical /> Adjust
        </Button>
      }
      title={`Adjust ${level.name}`}
      description={`On hand: ${level.onHand} ${level.unit}`}
      onOpen={() => {
        setReason('RECEIVE')
        setAmount('')
        setNote('')
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
      <ToggleGroup
        type="single"
        variant="outline"
        value={reason}
        onValueChange={(v) => v && setReason(v as Reason)}
        className="w-full"
      >
        <ToggleGroupItem value="RECEIVE" className="flex-1">
          Received
        </ToggleGroupItem>
        <ToggleGroupItem value="ADJUST" className="flex-1">
          Adjust ±
        </ToggleGroupItem>
        <ToggleGroupItem value="RECOUNT" className="flex-1">
          Recount
        </ToggleGroupItem>
      </ToggleGroup>
      <Field>
        <FieldLabel htmlFor="a-amount">
          {reason === 'RECOUNT'
            ? 'Counted'
            : reason === 'RECEIVE'
              ? 'Quantity received'
              : 'Change (e.g. -2 for waste)'}
        </FieldLabel>
        <Input
          id="a-amount"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="a-note">Note</FieldLabel>
        <Input
          id="a-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
        />
      </Field>
    </FormDialog>
  )
}

const REASON_LABEL: Record<StockMovement['reason'], string> = {
  SALE: 'Sale',
  VOID: 'Void',
  REFUND: 'Refund',
  ADJUST: 'Adjustment',
  RECOUNT: 'Recount',
  RECEIVE: 'Received',
}

function Movements({ level }: { level: StockLevel }) {
  const movements = useList<StockMovement>(`/stock-levels/${level.id}/movements`)
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="sm" variant="ghost">
          <History /> History
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{level.name}</SheetTitle>
          <SheetDescription>Every change to the count, newest first.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
          {movements.isPending ? (
            <Loading />
          ) : movements.error ? (
            <ErrorState error={movements.error} />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Why</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.items.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-xs">{when(m.createdAt)}</TableCell>
                      <TableCell>
                        <div>{REASON_LABEL[m.reason]}</div>
                        <div className="text-xs text-muted-foreground">{m.note ?? m.actor}</div>
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${m.delta < 0 ? 'text-destructive' : ''}`}
                      >
                        {m.delta > 0 ? `+${m.delta}` : m.delta}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <LoadMore {...movements} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function Inventory() {
  const tenant = useTenant()
  const store = tenant.stores.find((s) => s.id === tenant.storeId)
  const levels = useAll<StockLevel>('/stock-levels', { storeId: tenant.storeId })
  return (
    <>
      <PageHeader
        title="Inventory"
        description={store ? `Stock at ${store.name}` : 'Choose a store in the sidebar'}
        actions={
          tenant.can('MANAGER') &&
          tenant.storeId && (
            <LevelDialog
              trigger={
                <Button>
                  <Plus /> Track item
                </Button>
              }
            />
          )
        }
      />
      <PageBody>
        {!tenant.storeId ? (
          <EmptyState icon={<Boxes />} title="No store yet" description="Create a store first." />
        ) : levels.isPending ? (
          <Loading />
        ) : levels.error ? (
          <ErrorState error={levels.error} retry={() => levels.refetch()} />
        ) : levels.data.length === 0 ? (
          <EmptyState
            icon={<Boxes />}
            title="Nothing tracked yet"
            description="Track stock for items that can run out, then link them to variants or modifiers."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {levels.data.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={l.onHand <= 0 ? 'font-semibold text-destructive' : ''}>
                      {l.onHand}
                    </span>{' '}
                    <span className="text-muted-foreground">{l.unit}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {l.trackStrictly ? 'Never below zero' : 'May go negative'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <AdjustDialog level={l} />
                      <Movements level={l} />
                      {tenant.can('MANAGER') && (
                        <LevelDialog
                          level={l}
                          trigger={
                            <Button size="icon-sm" variant="ghost" aria-label={`Edit ${l.name}`}>
                              <Pencil />
                            </Button>
                          }
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PageBody>
    </>
  )
}
