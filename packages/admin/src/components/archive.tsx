import { Archive, ArchiveRestore } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAction } from '@/lib/queries'

/** Archive (DELETE) or restore (POST …/restore) a resource at `path`. */
export function ArchiveButton({
  path,
  archivedAt,
  noun,
}: {
  path: string
  archivedAt: string | null
  noun: string
}) {
  const action = useAction(
    (archived: boolean, { api, tenant }) =>
      archived ? api.del(tenant.path(path)) : api.post(tenant.path(`${path}/restore`)),
    { success: archivedAt ? `${noun} restored` : `${noun} archived` },
  )
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={action.isPending}
      onClick={() => action.mutate(!archivedAt)}
    >
      {archivedAt ? <ArchiveRestore /> : <Archive />}
      {archivedAt ? 'Restore' : 'Archive'}
    </Button>
  )
}

export function ArchivedBadge({ archivedAt }: { archivedAt: string | null }) {
  return archivedAt ? <Badge variant="outline">Archived</Badge> : null
}
