import type { OrderHeader } from '@talajs/contracts'
import { ReceiptText } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { OrderStatusBadge } from '@/components/order-status'
import { PageBody, PageHeader } from '@/components/page'
import { EmptyState, ErrorState, Loading, LoadMore } from '@/components/states'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { money, when } from '@/lib/format'
import { useList } from '@/lib/queries'
import { useTenant } from '@/lib/session'

type View = 'tabs' | 'open' | 'completed' | 'voided' | 'all'

const FILTERS: Record<View, { status?: string; isTab?: boolean }> = {
  tabs: { status: 'OPEN', isTab: true },
  open: { status: 'OPEN' },
  completed: { status: 'COMPLETED' },
  voided: { status: 'VOIDED' },
  all: {},
}

export function Orders() {
  const tenant = useTenant()
  const navigate = useNavigate()
  const [view, setView] = useState<View>('tabs')
  const orders = useList<OrderHeader>('/orders', { storeId: tenant.storeId, ...FILTERS[view] })
  return (
    <>
      <PageHeader title="Orders & tabs" description="Newest first, for the selected store." />
      <PageBody>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="tabs">Open tabs</TabsTrigger>
            <TabsTrigger value="open">All open</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="voided">Voided</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        {orders.isPending ? (
          <Loading />
        ) : orders.error ? (
          <ErrorState error={orders.error} retry={() => orders.refetch()} />
        ) : orders.items.length === 0 ? (
          <EmptyState
            icon={<ReceiptText />}
            title="Nothing here"
            description="Orders appear as they're rung up."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Tab</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.items.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => navigate(o.id)}>
                    <TableCell className="font-medium">{o.number}</TableCell>
                    <TableCell>{o.tabName ?? '—'}</TableCell>
                    <TableCell>{when(o.openedAt)}</TableCell>
                    <TableCell>
                      <OrderStatusBadge status={o.status} isTab={o.isTab} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(o.totalMinor, o.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {o.balanceDueMinor > 0 ? money(o.balanceDueMinor, o.currency) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <LoadMore {...orders} />
          </>
        )}
      </PageBody>
    </>
  )
}
