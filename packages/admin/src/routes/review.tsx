import type { ReviewItem } from '@talajs/contracts'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { FormDialog } from '@/components/form-dialog'
import { PageBody, PageHeader } from '@/components/page'
import { EmptyState, ErrorState, Loading, LoadMore } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { when } from '@/lib/format'
import { useAction, useList } from '@/lib/queries'

const KIND: Record<ReviewItem['kind'], string> = {
  SYNC_CONFLICT: 'Register conflict',
  NEGATIVE_STOCK: 'Stock below zero',
  PAYMENT_MISMATCH: 'Payment mismatch',
}

function summary(item: ReviewItem) {
  const d = item.details as Record<string, unknown>
  if (typeof d.message === 'string') return d.message
  if (typeof d.reason === 'string') return d.reason
  return KIND[item.kind]
}

function ResolveDialog({ item }: { item: ReviewItem }) {
  const [status, setStatus] = useState<'RESOLVED' | 'DISMISSED'>('RESOLVED')
  const [note, setNote] = useState('')
  const resolve = useAction(
    (_: void, { api, tenant }) =>
      api.post(tenant.path(`/review-items/${item.id}/resolve`), {
        status,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    { success: 'Closed' },
  )
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <CheckCircle2 /> Close
        </Button>
      }
      title="Close this item"
      description="This records your decision. Make any fix (refund, recount, void) on the order or stock level itself."
      onOpen={() => {
        setStatus('RESOLVED')
        setNote('')
      }}
      pending={resolve.isPending}
      onSubmit={() =>
        resolve
          .mutateAsync()
          .then(() => true)
          .catch(() => false)
      }
    >
      <ToggleGroup
        type="single"
        variant="outline"
        value={status}
        onValueChange={(v) => v && setStatus(v as typeof status)}
      >
        <ToggleGroupItem value="RESOLVED">Resolved</ToggleGroupItem>
        <ToggleGroupItem value="DISMISSED">Dismiss</ToggleGroupItem>
      </ToggleGroup>
      <Field>
        <FieldLabel htmlFor="rv-note">Note</FieldLabel>
        <Textarea
          id="rv-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Refunded the double payment"
        />
      </Field>
    </FormDialog>
  )
}

export function Review() {
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED' | 'DISMISSED'>('OPEN')
  const items = useList<ReviewItem>('/review-items', { status })
  return (
    <>
      <PageHeader
        title="Review queue"
        description="Things registers recorded offline that need a person to look at them. Nothing here was lost."
      />
      <PageBody>
        <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <TabsList>
            <TabsTrigger value="OPEN">Open</TabsTrigger>
            <TabsTrigger value="RESOLVED">Resolved</TabsTrigger>
            <TabsTrigger value="DISMISSED">Dismissed</TabsTrigger>
          </TabsList>
        </Tabs>
        {items.isPending ? (
          <Loading />
        ) : items.error ? (
          <ErrorState error={items.error} retry={() => items.refetch()} />
        ) : items.items.length === 0 ? (
          <EmptyState
            icon={<TriangleAlert />}
            title={status === 'OPEN' ? 'All clear' : 'Nothing here'}
          />
        ) : (
          <>
            {items.items.map((item) => (
              <Card key={item.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Badge variant={item.kind === 'SYNC_CONFLICT' ? 'outline' : 'destructive'}>
                      {KIND[item.kind]}
                    </Badge>
                    {summary(item)}
                  </CardTitle>
                  <CardDescription>
                    {when(item.createdAt)}
                    {item.subjectType === 'order' && (
                      <>
                        {' · '}
                        <Link
                          className="underline"
                          to={`../orders/${item.subjectId}`}
                          relative="path"
                        >
                          Open order
                        </Link>
                      </>
                    )}
                    {item.resolvedAt && ` · closed by ${item.resolvedBy} ${when(item.resolvedAt)}`}
                  </CardDescription>
                  {item.status === 'OPEN' && (
                    <CardAction>
                      <ResolveDialog item={item} />
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {item.resolution && typeof item.resolution.note === 'string' && (
                    <p className="text-sm">Note: {item.resolution.note}</p>
                  )}
                  <details>
                    <summary className="cursor-pointer text-sm text-muted-foreground">
                      Details
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
                      {JSON.stringify(item.details, null, 2)}
                    </pre>
                  </details>
                </CardContent>
              </Card>
            ))}
            <LoadMore {...items} />
          </>
        )}
      </PageBody>
    </>
  )
}
