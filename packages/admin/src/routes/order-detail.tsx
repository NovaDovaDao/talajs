import type { Customer, Order } from '@talajs/contracts'
import { ArrowLeft, Ban, Banknote, CheckCircle2, Plus, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { CashDialog } from '@/components/cash-dialog'
import { Confirm } from '@/components/confirm'
import { FormDialog } from '@/components/form-dialog'
import { MoneyInput } from '@/components/money-input'
import { OrderStatusBadge } from '@/components/order-status'
import { PageBody, PageHeader } from '@/components/page'
import { ErrorState, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { money, when } from '@/lib/format'
import { useAction, useResource } from '@/lib/queries'
import { useTenant } from '@/lib/session'

function RefundDialog({ order }: { order: Order }) {
  const payments = order.payments
    .filter((p) => p.status === 'SUCCESS')
    .map((p) => {
      const refunded = order.refunds
        .filter((r) => r.paymentId === p.id && r.status !== 'FAILED')
        .reduce((s, r) => s + r.amountMinor, 0)
      return { ...p, refundable: p.amountMinor - refunded }
    })
    .filter((p) => p.refundable > 0)
  const [paymentId, setPaymentId] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [lineIds, setLineIds] = useState<string[]>([])
  const [restock, setRestock] = useState(false)
  const payment = payments.find((p) => p.id === paymentId)
  const refund = useAction(
    (_: void, { api, tenant }) =>
      api.post(tenant.path(`/orders/${order.id}/refunds`), {
        id: crypto.randomUUID(),
        paymentId,
        amountMinor: amount,
        reason,
        lineIds,
        restock: restock && lineIds.length > 0,
      }),
    { success: 'Refund recorded' },
  )
  if (payments.length === 0) return null
  return (
    <FormDialog
      trigger={
        <Button variant="outline">
          <Undo2 /> Refund
        </Button>
      }
      title="Refund"
      description="Cash refunds are recorded at once; hand the money back from the drawer."
      submitLabel="Refund"
      onOpen={() => {
        const first = payments[0]
        setPaymentId(first?.id ?? '')
        setAmount(first?.refundable ?? null)
        setReason('')
        setLineIds([])
        setRestock(false)
      }}
      pending={refund.isPending}
      disabled={!payment || !amount || amount > payment.refundable || !reason.trim()}
      onSubmit={() =>
        refund
          .mutateAsync()
          .then(() => true)
          .catch(() => false)
      }
    >
      <Field>
        <FieldLabel>Payment</FieldLabel>
        <Select
          value={paymentId}
          onValueChange={(id) => {
            setPaymentId(id)
            setAmount(payments.find((p) => p.id === id)?.refundable ?? null)
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {payments.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.method.toLowerCase()} · {money(p.refundable, p.currency)} refundable
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="r-amount">Amount</FieldLabel>
        <MoneyInput id="r-amount" value={amount} onChange={setAmount} currency={order.currency} />
      </Field>
      <Field>
        <FieldLabel htmlFor="r-reason">Reason</FieldLabel>
        <Input
          id="r-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Wrong order"
        />
      </Field>
      <Field>
        <FieldLabel>Lines refunded (optional)</FieldLabel>
        <div className="flex flex-col gap-2">
          {order.lines
            .filter((l) => !l.voidedAt)
            .map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={lineIds.includes(l.id)}
                  onCheckedChange={(v) =>
                    setLineIds(v === true ? [...lineIds, l.id] : lineIds.filter((x) => x !== l.id))
                  }
                />
                {l.quantity} × {l.itemName} {l.variantName}
              </label>
            ))}
        </div>
      </Field>
      <Field orientation="horizontal">
        <Switch
          id="r-restock"
          checked={restock}
          onCheckedChange={setRestock}
          disabled={lineIds.length === 0}
        />
        <FieldLabel htmlFor="r-restock">Put their stock back</FieldLabel>
      </Field>
    </FormDialog>
  )
}

function EditOrderDialog({ order }: { order: Order }) {
  const [tabName, setTabName] = useState('')
  const [note, setNote] = useState('')
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const matches = useResource<{ data: Customer[] }>(
    customerQuery.trim().length >= 2 ? '/customers' : null,
    { q: customerQuery.trim(), limit: 5 },
  )
  const save = useAction(
    (_: void, { api, tenant }) =>
      api.patch(tenant.path(`/orders/${order.id}`), {
        expectedVersion: order.version,
        tabName: tabName.trim() || null,
        isTab: tabName.trim() !== '',
        note: note.trim() || null,
        customerId,
      }),
    { success: 'Order updated' },
  )
  return (
    <FormDialog
      trigger={<Button variant="outline">Edit</Button>}
      title={`Edit order ${order.number}`}
      onOpen={() => {
        setTabName(order.tabName ?? '')
        setNote(order.note ?? '')
        setCustomerId(order.customerId)
        setCustomerQuery('')
      }}
      pending={save.isPending}
      onSubmit={() =>
        save
          .mutateAsync()
          .then(() => true)
          .catch(() => false)
      }
    >
      <Field>
        <FieldLabel htmlFor="o-tab">Tab name</FieldLabel>
        <Input
          id="o-tab"
          value={tabName}
          onChange={(e) => setTabName(e.target.value)}
          placeholder="Leave empty for a plain order"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="o-note">Note</FieldLabel>
        <Input id="o-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor="o-cust">Customer</FieldLabel>
        {customerId ? (
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="secondary">Linked</Badge>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCustomerId(null)}>
              <X /> Unlink
            </Button>
          </div>
        ) : (
          <>
            <Input
              id="o-cust"
              placeholder="Search by name, email or phone"
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
            />
            {(matches.data?.data ?? []).map((c) => (
              <Button
                key={c.id}
                type="button"
                variant="ghost"
                className="justify-start"
                onClick={() => setCustomerId(c.id)}
              >
                {c.name ?? c.email ?? c.phone}
              </Button>
            ))}
          </>
        )}
      </Field>
    </FormDialog>
  )
}

export function OrderDetail() {
  const { orderId = '' } = useParams()
  const tenant = useTenant()
  const query = useResource<Order>(`/orders/${orderId}`)
  const order = query.data
  const act = useAction(
    (
      {
        action,
        reason,
        lineId,
      }: { action: 'void' | 'complete' | 'void-line'; reason?: string; lineId?: string },
      { api, tenant },
    ) => {
      const base = `/orders/${orderId}`
      const expectedVersion = order?.version
      if (action === 'complete')
        return api.post(tenant.path(`${base}/complete`), { expectedVersion })
      if (action === 'void')
        return api.post(tenant.path(`${base}/void`), { expectedVersion, reason })
      return api.post(tenant.path(`${base}/lines/${lineId}/void`), { expectedVersion, reason })
    },
    {
      success: (r) => {
        const o = r as Order
        return o.status === 'COMPLETED'
          ? 'Order completed'
          : o.status === 'VOIDED'
            ? 'Order voided'
            : 'Line voided'
      },
    },
  )

  if (query.error) {
    return (
      <PageBody>
        <ErrorState error={query.error} retry={() => query.refetch()} />
      </PageBody>
    )
  }
  if (!order) {
    return (
      <PageBody>
        <Loading rows={8} />
      </PageBody>
    )
  }
  const open = order.status === 'OPEN'
  const cur = order.currency
  const hasLines = order.lines.some((l) => !l.voidedAt)

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Button asChild size="icon-sm" variant="ghost" aria-label="Back to orders">
              <Link to=".." relative="path">
                <ArrowLeft />
              </Link>
            </Button>
            Order {order.number}
            {order.tabName && <span className="text-muted-foreground">· {order.tabName}</span>}
            <OrderStatusBadge status={order.status} isTab={order.isTab} />
          </span>
        }
        description={`Opened ${when(order.openedAt)} by ${order.openedBy}${order.source === 'POS' ? ' on a register' : ''}`}
        actions={
          <>
            {open && (
              <>
                <EditOrderDialog order={order} />
                <Button asChild variant="outline">
                  <Link to={`../../register?order=${order.id}`} relative="path">
                    <Plus /> Add items
                  </Link>
                </Button>
                {order.paidMinor === 0 && (
                  <Confirm
                    trigger={
                      <Button variant="outline">
                        <Ban /> Void
                      </Button>
                    }
                    title={`Void order ${order.number}?`}
                    description="Its stock is put back. This can't be undone."
                    confirmLabel="Void order"
                    destructive
                    reason="Reason"
                    onConfirm={(reason) => act.mutate({ action: 'void', reason })}
                  />
                )}
                {order.balanceDueMinor > 0 && (
                  <CashDialog
                    order={order}
                    trigger={
                      <Button variant="outline">
                        <Banknote /> Take cash
                      </Button>
                    }
                  />
                )}
                <Button
                  disabled={!hasLines || order.balanceDueMinor > 0 || act.isPending}
                  onClick={() => act.mutate({ action: 'complete' })}
                >
                  <CheckCircle2 /> Complete
                </Button>
              </>
            )}
            {order.status !== 'VOIDED' && tenant.can('MANAGER') && <RefundDialog order={order} />}
          </>
        }
      />
      <PageBody className="lg:grid lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Lines</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Each</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines.map((l) => (
                  <TableRow
                    key={l.id}
                    className={l.voidedAt ? 'text-muted-foreground line-through' : ''}
                  >
                    <TableCell>
                      <div className="font-medium">
                        {l.itemName}{' '}
                        {l.variantName && <span className="font-normal">· {l.variantName}</span>}
                      </div>
                      {l.modifiers.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {l.modifiers.map((m) => m.name).join(', ')}
                        </div>
                      )}
                      {l.note && <div className="text-xs italic">{l.note}</div>}
                      {l.voidedAt && (
                        <div className="text-xs no-underline">Voided: {l.voidReason}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(l.unitPriceMinor + l.modifiersTotalMinor, cur)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(l.lineTotalMinor, cur)}
                    </TableCell>
                    <TableCell className="text-right">
                      {open && !l.voidedAt && (
                        <Confirm
                          trigger={
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Void ${l.itemName}`}
                            >
                              <X />
                            </Button>
                          }
                          title={`Void ${l.itemName}?`}
                          description="The line stays on the order for the record and its stock is put back."
                          confirmLabel="Void line"
                          destructive
                          reason="Reason"
                          onConfirm={(reason) =>
                            act.mutate({ action: 'void-line', lineId: l.id, reason })
                          }
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Subtotal</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(order.subtotalMinor, cur)}
                  </TableCell>
                  <TableCell />
                </TableRow>
                <TableRow>
                  <TableCell colSpan={3}>Tax</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(order.taxMinor, cur)}
                  </TableCell>
                  <TableCell />
                </TableRow>
                <TableRow className="font-semibold">
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(order.totalMinor, cur)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Money</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span>Paid</span>
                <span className="tabular-nums">{money(order.paidMinor, cur)}</span>
              </div>
              {order.refundedMinor > 0 && (
                <div className="flex justify-between">
                  <span>Refunded</span>
                  <span className="tabular-nums">{money(order.refundedMinor, cur)}</span>
                </div>
              )}
              {order.tipMinor > 0 && (
                <div className="flex justify-between">
                  <span>Tips</span>
                  <span className="tabular-nums">{money(order.tipMinor, cur)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold">
                <span>Balance due</span>
                <span className="tabular-nums">{money(order.balanceDueMinor, cur)}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {order.payments.length === 0 && <p className="text-muted-foreground">None yet.</p>}
              {order.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2">
                  <span>
                    {p.method.toLowerCase()}{' '}
                    {p.status !== 'SUCCESS' && (
                      <Badge variant="outline">{p.status.toLowerCase()}</Badge>
                    )}
                    <span className="block text-xs text-muted-foreground">{when(p.createdAt)}</span>
                  </span>
                  <span className="tabular-nums">
                    {money(p.amountMinor, cur)}
                    {p.tipMinor > 0 && (
                      <span className="text-muted-foreground"> + {money(p.tipMinor, cur)} tip</span>
                    )}
                  </span>
                </div>
              ))}
              {order.refunds.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 text-destructive"
                >
                  <span>
                    Refund · {r.reason}
                    <span className="block text-xs text-muted-foreground">
                      {r.actor} · {when(r.createdAt)}
                    </span>
                  </span>
                  <span className="tabular-nums">−{money(r.amountMinor, cur)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          {(order.completedAt || order.voidedAt || order.note) && (
            <Card>
              <CardContent className="flex flex-col gap-1 text-sm">
                {order.note && <p>Note: {order.note}</p>}
                {order.completedAt && (
                  <p>
                    Completed {when(order.completedAt)} by {order.completedBy}
                  </p>
                )}
                {order.voidedAt && (
                  <p>
                    Voided {when(order.voidedAt)} by {order.voidedBy}: {order.voidReason}
                  </p>
                )}
                {order.receiptSentAt && <p>Receipt emailed {when(order.receiptSentAt)}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      </PageBody>
    </>
  )
}
