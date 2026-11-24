import { AlertCircle, Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '@/lib/queries'

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  )
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-2">
        <span>{errorMessage(error)}</span>
        {retry && (
          <Button size="sm" variant="outline" onClick={retry}>
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon = <Inbox />,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

export function LoadMore({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => unknown
}) {
  if (!hasNextPage) return null
  return (
    <div className="flex justify-center">
      <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
        {isFetchingNextPage && <Spinner />} Load more
      </Button>
    </div>
  )
}
