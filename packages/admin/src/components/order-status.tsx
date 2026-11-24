import { Badge } from '@/components/ui/badge'

export function OrderStatusBadge({ status, isTab }: { status: string; isTab?: boolean }) {
  if (status === 'COMPLETED') return <Badge variant="secondary">Completed</Badge>
  if (status === 'VOIDED') return <Badge variant="destructive">Voided</Badge>
  return <Badge>{isTab ? 'Open tab' : 'Open'}</Badge>
}
