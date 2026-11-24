import type { Customer, Tag } from '@talajs/contracts'
import { Plus, Search, UsersRound } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArchivedBadge } from '@/components/archive'
import { FormDialog } from '@/components/form-dialog'
import { PageBody, PageHeader } from '@/components/page'
import { EmptyState, ErrorState, Loading, LoadMore } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
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
import { useAction, useList, useResource } from '@/lib/queries'

const ALL = '__all__'

export const parseTags = (text: string) => [
  ...new Set(
    text
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  ),
]

export function CustomerDialog({
  customer,
  trigger,
  onSaved,
}: {
  customer?: Customer
  trigger: React.ReactNode
  onSaved?: (c: Customer) => void
}) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    tags: '',
    marketingOptIn: false,
  })
  const save = useAction(
    (_: void, { api, tenant }) => {
      const body = {
        name: form.name.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        marketingOptIn: form.marketingOptIn,
        tags: parseTags(form.tags),
      }
      return customer
        ? api.patch<Customer>(tenant.path(`/customers/${customer.id}`), body)
        : api.post<Customer>(tenant.path('/customers'), body)
    },
    {
      success: customer ? 'Customer updated' : 'Customer added',
      ...(onSaved ? { onSuccess: onSaved } : {}),
    },
  )
  const set =
    (k: 'name' | 'email' | 'phone' | 'tags') => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [k]: e.target.value })
  return (
    <FormDialog
      trigger={trigger}
      title={customer ? 'Edit customer' : 'New customer'}
      onOpen={() =>
        setForm({
          name: customer?.name ?? '',
          email: customer?.email ?? '',
          phone: customer?.phone ?? '',
          tags: customer?.tags.join(', ') ?? '',
          marketingOptIn: customer?.marketingOptIn ?? false,
        })
      }
      pending={save.isPending}
      disabled={!form.name.trim() && !form.email.trim() && !form.phone.trim()}
      onSubmit={() =>
        save
          .mutateAsync()
          .then(() => true)
          .catch(() => false)
      }
    >
      <Field>
        <FieldLabel htmlFor="c-name">Name</FieldLabel>
        <Input id="c-name" value={form.name} onChange={set('name')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="c-email">Email</FieldLabel>
          <Input id="c-email" type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field>
          <FieldLabel htmlFor="c-phone">Phone</FieldLabel>
          <Input id="c-phone" type="tel" value={form.phone} onChange={set('phone')} />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="c-tags">Tags</FieldLabel>
        <Input
          id="c-tags"
          value={form.tags}
          onChange={set('tags')}
          placeholder="regular, oat milk"
        />
        <FieldDescription>Separate with commas.</FieldDescription>
      </Field>
      <Field orientation="horizontal">
        <Switch
          id="c-mkt"
          checked={form.marketingOptIn}
          onCheckedChange={(marketingOptIn) => setForm({ ...form, marketingOptIn })}
        />
        <FieldLabel htmlFor="c-mkt">Agreed to marketing email</FieldLabel>
      </Field>
      <FieldDescription>
        Receipts are emailed to customers with an email address when their order completes.
      </FieldDescription>
    </FormDialog>
  )
}

export function Customers() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [tag, setTag] = useState(ALL)
  const [showArchived, setShowArchived] = useState(false)
  const search = useDeferredValue(q.trim())
  const customers = useList<Customer>('/customers', {
    q: search || undefined,
    tag: tag === ALL ? undefined : tag,
    includeArchived: showArchived,
  })
  const tags = useResource<{ data: Tag[] }>('/tags')
  return (
    <>
      <PageHeader
        title="Customers"
        description="Regulars, their notes and their orders."
        actions={
          <CustomerDialog
            trigger={
              <Button>
                <Plus /> New customer
              </Button>
            }
            onSaved={(c) => navigate(c.id)}
          />
        }
      />
      <PageBody>
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="max-w-sm">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Name, email or phone"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search customers"
            />
          </InputGroup>
          <Select value={tag} onValueChange={setTag}>
            <SelectTrigger className="w-44" aria-label="Tag">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All tags</SelectItem>
              {(tags.data?.data ?? []).map((t) => (
                <SelectItem key={t.id} value={t.name}>
                  {t.name} ({t.customerCount})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show archived
          </label>
        </div>
        {customers.isPending ? (
          <Loading />
        ) : customers.error ? (
          <ErrorState error={customers.error} retry={() => customers.refetch()} />
        ) : customers.items.length === 0 ? (
          <EmptyState icon={<UsersRound />} title={search ? 'No matches' : 'No customers yet'} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.items.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(c.id)}>
                    <TableCell className="font-medium">
                      {c.name ?? <span className="text-muted-foreground">No name</span>}{' '}
                      <ArchivedBadge archivedAt={c.archivedAt} />
                    </TableCell>
                    <TableCell>{c.email ?? '—'}</TableCell>
                    <TableCell>{c.phone ?? '—'}</TableCell>
                    <TableCell className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <LoadMore {...customers} />
          </>
        )}
      </PageBody>
    </>
  )
}
