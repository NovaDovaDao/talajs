import type { TaxRate } from '@talajs/contracts'
import { Pencil, Percent, Plus } from 'lucide-react'
import { useState } from 'react'
import { ArchiveButton, ArchivedBadge } from '@/components/archive'
import { FormDialog } from '@/components/form-dialog'
import { PageBody, PageHeader } from '@/components/page'
import { EmptyState, ErrorState, Loading } from '@/components/states'
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

export const bpsToPercent = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`

function TaxRateDialog({ rate, trigger }: { rate?: TaxRate; trigger: React.ReactNode }) {
  const [name, setName] = useState('')
  const [percent, setPercent] = useState('')
  const bps = Math.round(Number(percent) * 100)
  const valid =
    name.trim() !== '' && percent !== '' && Number.isFinite(bps) && bps >= 0 && bps <= 100_000
  const save = useAction(
    (_: void, { api, tenant }) =>
      rate
        ? api.patch(tenant.path(`/tax-rates/${rate.id}`), { name, rateBps: bps })
        : api.post(tenant.path('/tax-rates'), { name, rateBps: bps }),
    { success: rate ? 'Tax rate updated' : 'Tax rate added' },
  )
  return (
    <FormDialog
      trigger={trigger}
      title={rate ? 'Edit tax rate' : 'New tax rate'}
      description="Changing a rate only affects new order lines; past orders keep the rate they were sold at."
      onOpen={() => {
        setName(rate?.name ?? '')
        setPercent(rate ? String(rate.rateBps / 100) : '')
      }}
      pending={save.isPending}
      disabled={!valid}
      onSubmit={async () =>
        await save
          .mutateAsync()
          .then(() => true)
          .catch(() => false)
      }
    >
      <Field>
        <FieldLabel htmlFor="tax-name">Name</FieldLabel>
        <Input
          id="tax-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sales tax"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="tax-rate">Rate (%)</FieldLabel>
        <Input
          id="tax-rate"
          inputMode="decimal"
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
          placeholder="8.25"
        />
        <FieldDescription>Up to two decimals, e.g. 8.25.</FieldDescription>
      </Field>
    </FormDialog>
  )
}

export function TaxRates() {
  const tenant = useTenant()
  const [showArchived, setShowArchived] = useState(false)
  const rates = useAll<TaxRate>('/tax-rates', { includeArchived: showArchived })
  const canEdit = tenant.can('MANAGER')
  return (
    <>
      <PageHeader
        title="Tax rates"
        description="Assigned to items; applied per rate and rounded once per order."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show archived
            </label>
            {canEdit && (
              <TaxRateDialog
                trigger={
                  <Button>
                    <Plus /> New tax rate
                  </Button>
                }
              />
            )}
          </>
        }
      />
      <PageBody>
        {rates.isPending ? (
          <Loading />
        ) : rates.error ? (
          <ErrorState error={rates.error} retry={() => rates.refetch()} />
        ) : rates.data.length === 0 ? (
          <EmptyState
            icon={<Percent />}
            title="No tax rates"
            description="Add the rates you charge."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.name} <ArchivedBadge archivedAt={r.archivedAt} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {bpsToPercent(r.rateBps)}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        <TaxRateDialog
                          rate={r}
                          trigger={
                            <Button size="sm" variant="ghost">
                              <Pencil /> Edit
                            </Button>
                          }
                        />
                        <ArchiveButton
                          path={`/tax-rates/${r.id}`}
                          archivedAt={r.archivedAt}
                          noun="Tax rate"
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
