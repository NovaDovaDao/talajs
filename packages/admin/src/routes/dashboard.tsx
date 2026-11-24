import type { OrderHeader, ReviewItem, StockLevel } from '@talajs/contracts'
import { Link } from 'react-router'
import { PageBody, PageHeader } from '@/components/page'
import { Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { money, when } from '@/lib/format'
import { useAll, useList } from '@/lib/queries'
import { useTenant } from '@/lib/session'

const isToday = (iso: string | null) =>
  !!iso && new Date(iso).toDateString() === new Date().toDateString()

function Stat({
  title,
  value,
  hint,
  to,
}: {
  title: string
  value: React.ReactNode
  hint?: string
  to?: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="font-heading text-3xl tabular-nums">{value}</CardTitle>
        {to && (
          <CardAction>
            <Button asChild size="sm" variant="ghost">
              <Link to={to}>View</Link>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      {hint && <CardContent className="text-sm text-muted-foreground">{hint}</CardContent>}
    </Card>
  )
}

function ReviewStat() {
  const open = useList<ReviewItem>('/review-items', { status: 'OPEN' })
  return (
    <Stat
      title="Needs review"
      value={open.isPending ? '…' : `${open.items.length}${open.hasNextPage ? '+' : ''}`}
      hint="Register conflicts, negative stock, payment mismatches"
      to="review"
    />
  )
}

export function Dashboard() {
  const tenant = useTenant()
  const store = tenant.stores.find((s) => s.id === tenant.storeId)
  const tabs = useList<OrderHeader>('/orders', {
    storeId: tenant.storeId,
    status: 'OPEN',
    isTab: true,
  })
  const completed = useList<OrderHeader>('/orders', {
    storeId: tenant.storeId,
    status: 'COMPLETED',
  })
  const levels = useAll<StockLevel>('/stock-levels', { storeId: tenant.storeId })
  const today = completed.items.filter((o) => isToday(o.completedAt))
  const currency = store?.currency ?? tenant.currency
  const sales = today.reduce((s, o) => s + o.totalMinor, 0)
  const tips = today.reduce((s, o) => s + o.tipMinor, 0)
  const low = (levels.data ?? []).filter((l) => l.onHand <= 0)

  return (
    <>
      <PageHeader
        title="Overview"
        description={store ? `${store.name} today` : tenant.tenantName}
      />
      <PageBody>
        {tabs.isPending || completed.isPending ? (
          <Loading rows={3} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                title="Sales today"
                value={money(sales, currency)}
                hint={`${today.length} orders${tips ? ` · ${money(tips, currency)} tips` : ''}`}
                to="orders"
              />
              <Stat title="Open tabs" value={tabs.items.length} to="orders" />
              <Stat
                title="Out of stock"
                value={low.length}
                hint={low.map((l) => l.name).join(', ') || 'All good'}
                to="inventory"
              />
              {tenant.can('MANAGER') && tenant.storeIds.length === 0 && <ReviewStat />}
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Open tabs</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col divide-y">
                {tabs.items.length === 0 && (
                  <p className="text-sm text-muted-foreground">No open tabs.</p>
                )}
                {tabs.items.map((o) => (
                  <Link
                    key={o.id}
                    to={`orders/${o.id}`}
                    className="flex items-center justify-between py-2 text-sm hover:underline"
                  >
                    <span>
                      <span className="font-medium">{o.tabName}</span>{' '}
                      <span className="text-muted-foreground">
                        #{o.number} · {when(o.openedAt)}
                      </span>
                    </span>
                    <span className="tabular-nums">{money(o.balanceDueMinor, o.currency)} due</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </PageBody>
    </>
  )
}
