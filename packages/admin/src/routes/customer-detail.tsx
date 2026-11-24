import type { Customer, CustomerNote, OrderSummary } from '@talajs/contracts'
import { ArrowLeft, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArchiveButton, ArchivedBadge } from '@/components/archive'
import { OrderStatusBadge } from '@/components/order-status'
import { PageBody, PageHeader } from '@/components/page'
import { ErrorState, Loading, LoadMore } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { money, when } from '@/lib/format'
import { useAction, useList, useResource } from '@/lib/queries'
import { CustomerDialog } from './customers'

function Notes({ customerId }: { customerId: string }) {
  const notes = useList<CustomerNote>(`/customers/${customerId}/notes`)
  const [body, setBody] = useState('')
  const add = useAction(
    (_: void, { api, tenant }) => api.post(tenant.path(`/customers/${customerId}/notes`), { body }),
    { success: 'Note added', onSuccess: () => setBody('') },
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            add.mutate()
          }}
        >
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Allergic to nuts, likes extra hot…"
            aria-label="New note"
          />
          <Button
            type="submit"
            size="sm"
            className="self-end"
            disabled={!body.trim() || add.isPending}
          >
            Add note
          </Button>
        </form>
        {notes.isPending ? (
          <Loading rows={2} />
        ) : (
          <>
            {notes.items.map((n) => (
              <div key={n.id} className="rounded-md border p-3 text-sm">
                <p className="whitespace-pre-wrap">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {n.author} · {when(n.createdAt)}
                </p>
              </div>
            ))}
            <LoadMore {...notes} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function History({ customerId }: { customerId: string }) {
  const navigate = useNavigate()
  const orders = useList<OrderSummary>(`/customers/${customerId}/orders`)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
      </CardHeader>
      <CardContent>
        {orders.isPending ? (
          <Loading rows={3} />
        ) : orders.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.items.map((o) => (
                  <TableRow
                    key={o.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`../../orders/${o.id}`, { relative: 'path' })}
                  >
                    <TableCell className="font-medium">{o.number}</TableCell>
                    <TableCell>{when(o.openedAt)}</TableCell>
                    <TableCell>
                      <OrderStatusBadge status={o.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(o.totalMinor, o.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <LoadMore {...orders} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function CustomerDetail() {
  const { customerId = '' } = useParams()
  const customer = useResource<Customer>(`/customers/${customerId}`)
  if (customer.error) return <ErrorState error={customer.error} />
  const c = customer.data
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Button asChild size="icon-sm" variant="ghost" aria-label="Back to customers">
              <Link to=".." relative="path">
                <ArrowLeft />
              </Link>
            </Button>
            {c ? (c.name ?? c.email ?? c.phone ?? 'Customer') : 'Customer'}
            {c && <ArchivedBadge archivedAt={c.archivedAt} />}
          </span>
        }
        actions={
          c && (
            <>
              <ArchiveButton
                path={`/customers/${c.id}`}
                archivedAt={c.archivedAt}
                noun="Customer"
              />
              <CustomerDialog
                customer={c}
                trigger={
                  <Button variant="outline">
                    <Pencil /> Edit
                  </Button>
                }
              />
            </>
          )
        }
      />
      <PageBody className="lg:grid lg:grid-cols-[1fr_2fr]">
        {!c ? (
          <Loading rows={5} />
        ) : (
          <>
            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Contact</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  <div>{c.email ?? <span className="text-muted-foreground">No email</span>}</div>
                  <div>{c.phone ?? <span className="text-muted-foreground">No phone</span>}</div>
                  <div className="text-muted-foreground">
                    {c.marketingOptIn ? 'Agreed to marketing email' : 'No marketing email'}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Notes customerId={c.id} />
            </div>
            <History customerId={c.id} />
          </>
        )}
      </PageBody>
    </>
  )
}
