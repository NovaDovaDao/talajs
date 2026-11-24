import type { Store } from '@talajs/contracts'
import { Pencil, Plus, Store as StoreIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ArchiveButton, ArchivedBadge } from '@/components/archive'
import { FormDialog } from '@/components/form-dialog'
import { PageBody, PageHeader } from '@/components/page'
import { EmptyState, ErrorState, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAction, useAll } from '@/lib/queries'
import { useTenant } from '@/lib/session'

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')

export function StoreDialog({ store, trigger }: { store?: Store; trigger: React.ReactNode }) {
  const { currency: tenantCurrency } = useTenant()
  const [form, setForm] = useState({
    name: '',
    slug: '',
    currency: tenantCurrency,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pricesIncludeTax: false,
  })
  const save = useAction(
    (_: void, { api, tenant }) =>
      store
        ? api.patch(tenant.path(`/stores/${store.id}`), {
            name: form.name,
            slug: form.slug,
            timezone: form.timezone,
            pricesIncludeTax: form.pricesIncludeTax,
          })
        : api.post(tenant.path('/stores'), form),
    { success: store ? 'Store updated' : 'Store added' },
  )
  return (
    <FormDialog
      trigger={trigger}
      title={store ? 'Edit store' : 'New store'}
      onOpen={() =>
        setForm(
          store
            ? {
                name: store.name,
                slug: store.slug,
                currency: store.currency,
                timezone: store.timezone,
                pricesIncludeTax: store.pricesIncludeTax,
              }
            : { ...form, name: '', slug: '' },
        )
      }
      pending={save.isPending}
      disabled={!form.name.trim() || !form.slug}
      onSubmit={() =>
        save
          .mutateAsync()
          .then(() => true)
          .catch(() => false)
      }
    >
      <Field>
        <FieldLabel htmlFor="s-name">Name</FieldLabel>
        <Input
          id="s-name"
          value={form.name}
          onChange={(e) =>
            setForm({
              ...form,
              name: e.target.value,
              slug: store || form.slug !== slugify(form.name) ? form.slug : slugify(e.target.value),
            })
          }
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="s-slug">Slug</FieldLabel>
        <Input
          id="s-slug"
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="s-cur">Currency</FieldLabel>
          <Input
            id="s-cur"
            value={form.currency}
            maxLength={3}
            disabled={!!store}
            onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="s-tz">Time zone</FieldLabel>
          <Input
            id="s-tz"
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          />
        </Field>
      </div>
      <Field orientation="horizontal">
        <Switch
          id="s-vat"
          checked={form.pricesIncludeTax}
          onCheckedChange={(pricesIncludeTax) => setForm({ ...form, pricesIncludeTax })}
        />
        <FieldLabel htmlFor="s-vat">Menu prices include tax</FieldLabel>
      </Field>
      <FieldDescription>
        On for VAT-style menus (tax is taken out of the price); off when tax is added at checkout.
      </FieldDescription>
    </FormDialog>
  )
}

export function Stores() {
  const tenant = useTenant()
  const navigate = useNavigate()
  const [showArchived, setShowArchived] = useState(false)
  const stores = useAll<Store>('/stores', { includeArchived: showArchived })
  const canEdit = tenant.can('MANAGER')
  return (
    <>
      <PageHeader
        title="Stores"
        description="Locations. Each has its own currency, time zone, stock and registers."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show archived
            </label>
            {canEdit && (
              <StoreDialog
                trigger={
                  <Button>
                    <Plus /> New store
                  </Button>
                }
              />
            )}
          </>
        }
      />
      <PageBody>
        {stores.isPending ? (
          <Loading />
        ) : stores.error ? (
          <ErrorState error={stores.error} retry={() => stores.refetch()} />
        ) : stores.data.length === 0 ? (
          <EmptyState
            icon={<StoreIcon />}
            title="No stores"
            description="Add your first location."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Time zone</TableHead>
                <TableHead>Prices</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.data.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => navigate(s.id)}>
                  <TableCell className="font-medium">
                    {s.name} <span className="text-muted-foreground">/{s.slug}</span>{' '}
                    <ArchivedBadge archivedAt={s.archivedAt} />
                  </TableCell>
                  <TableCell>{s.currency}</TableCell>
                  <TableCell>{s.timezone}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {s.pricesIncludeTax ? 'Tax included' : 'Plus tax'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        <StoreDialog
                          store={s}
                          trigger={
                            <Button size="sm" variant="ghost">
                              <Pencil /> Edit
                            </Button>
                          }
                        />
                        <ArchiveButton
                          path={`/stores/${s.id}`}
                          archivedAt={s.archivedAt}
                          noun="Store"
                        />
                      </div>
                    )}
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
