import type { Order } from '@talajs/contracts'
import { useState } from 'react'
import { FormDialog } from '@/components/form-dialog'
import { MoneyInput } from '@/components/money-input'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { money } from '@/lib/format'
import { useAction } from '@/lib/queries'

/** Take cash: what's applied to the bill, an optional tip, and the change to hand back. */
export function CashDialog({
  order,
  trigger,
  onPaid,
  open,
  onOpenChange,
}: {
  order: Order
  trigger?: React.ReactNode
  onPaid?: (order: Order) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const due = order.balanceDueMinor
  const [amount, setAmount] = useState<number | null>(due)
  const [tip, setTip] = useState<number | null>(0)
  const [tendered, setTendered] = useState<number | null>(null)
  const owed = (amount ?? 0) + (tip ?? 0)
  const change = tendered === null ? null : tendered - owed
  const pay = useAction(
    (_: void, { api, tenant }) =>
      api.post<Order>(tenant.path(`/orders/${order.id}/payments`), {
        id: crypto.randomUUID(),
        method: 'CASH',
        amountMinor: amount,
        tipMinor: tip ?? 0,
        expectedVersion: order.version,
      }),
    { success: 'Payment recorded', ...(onPaid ? { onSuccess: onPaid } : {}) },
  )
  const quick = [due, ...[500, 1000, 2000, 5000].filter((n) => n > owed)].slice(0, 4)
  return (
    <FormDialog
      trigger={trigger}
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange } : {})}
      title="Take cash"
      description={`Balance due ${money(due, order.currency)}`}
      submitLabel="Record payment"
      onOpen={() => {
        setAmount(due)
        setTip(0)
        setTendered(null)
      }}
      pending={pay.isPending}
      disabled={!amount || amount <= 0 || amount > due || (change !== null && change < 0)}
      onSubmit={() =>
        pay
          .mutateAsync()
          .then(() => true)
          .catch(() => false)
      }
    >
      <Field>
        <FieldLabel htmlFor="cash-amount">Towards the bill</FieldLabel>
        <MoneyInput
          id="cash-amount"
          value={amount}
          onChange={setAmount}
          currency={order.currency}
        />
        <FieldDescription>Less than the balance for a split payment.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="cash-tip">Tip</FieldLabel>
        <MoneyInput id="cash-tip" value={tip} onChange={setTip} currency={order.currency} />
      </Field>
      <Field>
        <FieldLabel htmlFor="cash-tendered">Cash handed over</FieldLabel>
        <MoneyInput
          id="cash-tendered"
          value={tendered}
          allowEmpty
          onChange={setTendered}
          currency={order.currency}
        />
        <div className="flex flex-wrap gap-2">
          {quick.map((n) => (
            <Button
              key={n}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setTendered(n)}
            >
              {money(n, order.currency)}
            </Button>
          ))}
        </div>
      </Field>
      {change !== null && (
        <div
          className={`rounded-md border p-3 text-center font-heading text-xl font-semibold ${change < 0 ? 'text-destructive' : ''}`}
        >
          {change < 0
            ? `Short ${money(-change, order.currency)}`
            : `Change ${money(change, order.currency)}`}
        </div>
      )}
    </FormDialog>
  )
}
