import type { PairingCode, Terminal } from '@talajs/contracts'
import { Copy, KeyRound, Monitor, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Confirm } from '@/components/confirm'
import { FormDialog } from '@/components/form-dialog'
import { PageBody, PageHeader } from '@/components/page'
import { EmptyState, ErrorState, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { ago, when } from '@/lib/format'
import { useAction, useAll } from '@/lib/queries'
import { useTenant } from '@/lib/session'

function CodeDialog({ code, onClose }: { code: PairingCode | null; onClose: () => void }) {
  return (
    <Dialog open={!!code} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pair {code?.terminal.name}</DialogTitle>
          <DialogDescription>
            Enter this code on the register. It works once and expires{' '}
            {code && ago(code.pairingExpiresAt)}.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted p-6 text-center font-mono text-3xl font-semibold tracking-widest select-all">
          {code?.pairingCode}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (code) void navigator.clipboard.writeText(code.pairingCode)
              toast.success('Copied')
            }}
          >
            <Copy /> Copy
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Terminals() {
  const tenant = useTenant()
  const [showRevoked, setShowRevoked] = useState(false)
  const terminals = useAll<Terminal>('/terminals', {
    storeId: tenant.storeId,
    includeArchived: showRevoked,
  })
  const [code, setCode] = useState<PairingCode | null>(null)
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const create = useAction(
    (_: void, { api, tenant }) =>
      api.post<PairingCode>(tenant.path('/terminals'), {
        storeId: tenant.storeId,
        name,
        code: prefix,
      }),
    { onSuccess: setCode },
  )
  const repair = useAction(
    (id: string, { api, tenant }) =>
      api.post<PairingCode>(tenant.path(`/terminals/${id}/pairing-code`)),
    { onSuccess: setCode },
  )
  const revoke = useAction(
    (id: string, { api, tenant }) => api.post(tenant.path(`/terminals/${id}/revoke`)),
    { success: 'Register revoked' },
  )
  const nextCode = `T${(terminals.data?.length ?? 0) + 1}`

  return (
    <>
      <PageHeader
        title="Registers"
        description="Paired point-of-sale devices for the selected store. They keep selling offline and sync when back online."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={showRevoked} onCheckedChange={setShowRevoked} /> Show revoked
            </label>
            <FormDialog
              trigger={
                <Button disabled={!tenant.storeId}>
                  <Plus /> Add register
                </Button>
              }
              title="Add a register"
              submitLabel="Create pairing code"
              onOpen={() => {
                setName('')
                setPrefix(nextCode)
              }}
              pending={create.isPending}
              disabled={!name.trim() || !/^[A-Z0-9]{1,8}$/.test(prefix)}
              onSubmit={() =>
                create
                  .mutateAsync()
                  .then(() => true)
                  .catch(() => false)
              }
            >
              <Field>
                <FieldLabel htmlFor="t-name">Name</FieldLabel>
                <Input
                  id="t-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Front counter"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="t-code">Short code</FieldLabel>
                <Input
                  id="t-code"
                  value={prefix}
                  maxLength={8}
                  onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                />
                <FieldDescription>
                  Prefix for orders rung up offline, e.g. {prefix || 'T1'}-0042.
                </FieldDescription>
              </Field>
            </FormDialog>
          </>
        }
      />
      <PageBody>
        {terminals.isPending ? (
          <Loading />
        ) : terminals.error ? (
          <ErrorState error={terminals.error} retry={() => terminals.refetch()} />
        ) : terminals.data.length === 0 ? (
          <EmptyState
            icon={<Monitor />}
            title="No registers"
            description="Add one, then enter its pairing code on the device."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Register</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {terminals.data.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="font-mono">{t.code}</TableCell>
                  <TableCell>
                    {t.revokedAt ? (
                      <Badge variant="destructive">Revoked {when(t.revokedAt)}</Badge>
                    ) : t.paired ? (
                      <Badge variant="secondary">Paired</Badge>
                    ) : t.pairingExpiresAt ? (
                      <Badge variant="outline">Waiting for code</Badge>
                    ) : (
                      <Badge variant="outline">Not paired</Badge>
                    )}
                  </TableCell>
                  <TableCell title={when(t.lastSeenAt)}>{ago(t.lastSeenAt)}</TableCell>
                  <TableCell>
                    {!t.revokedAt && (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => repair.mutate(t.id)}
                          disabled={repair.isPending}
                        >
                          <KeyRound /> New code
                        </Button>
                        <Confirm
                          trigger={
                            <Button size="sm" variant="ghost">
                              Revoke
                            </Button>
                          }
                          title={`Revoke ${t.name}?`}
                          description="It stops working at once and can't be re-enabled. Sales it hasn't synced yet stay on the device."
                          confirmLabel="Revoke"
                          destructive
                          onConfirm={() => revoke.mutate(t.id)}
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
      <CodeDialog code={code} onClose={() => setCode(null)} />
    </>
  )
}
