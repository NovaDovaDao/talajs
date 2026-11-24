import type { MemberRole, Membership } from '@talajs/contracts'
import { Pencil, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { Confirm } from '@/components/confirm'
import { FormDialog } from '@/components/form-dialog'
import { PageBody, PageHeader } from '@/components/page'
import { EmptyState, ErrorState, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

const ROLES: { value: MemberRole; label: string; hint: string }[] = [
  { value: 'STAFF', label: 'Staff', hint: 'Sell, manage tabs and customers, adjust stock' },
  {
    value: 'MANAGER',
    label: 'Manager',
    hint: 'Also edit the menu, refund, manage registers and review',
  },
  { value: 'OWNER', label: 'Owner', hint: 'Also manage the team' },
]

function MemberDialog({ member, trigger }: { member?: Membership; trigger: React.ReactNode }) {
  const { stores } = useTenant()
  const [subject, setSubject] = useState('')
  const [role, setRole] = useState<MemberRole>('STAFF')
  const [storeIds, setStoreIds] = useState<string[]>([])
  const save = useAction(
    (_: void, { api, tenant }) =>
      member
        ? api.patch(tenant.path(`/memberships/${member.id}`), { role, storeIds })
        : api.post(tenant.path('/memberships'), { subject: subject.trim(), role, storeIds }),
    { success: member ? 'Member updated' : 'Member added' },
  )
  return (
    <FormDialog
      trigger={trigger}
      title={member ? `Edit ${member.subject}` : 'Add a team member'}
      onOpen={() => {
        setSubject(member?.subject ?? '')
        setRole(member?.role ?? 'STAFF')
        setStoreIds(member?.storeIds ?? [])
      }}
      pending={save.isPending}
      disabled={!member && !subject.trim()}
      onSubmit={() =>
        save
          .mutateAsync()
          .then(() => true)
          .catch(() => false)
      }
    >
      {!member && (
        <Field>
          <FieldLabel htmlFor="mb-subject">Email or sign-in id</FieldLabel>
          <Input
            id="mb-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="sam@cafe.com"
          />
          <FieldDescription>
            What they sign in with: their email behind Cloudflare Access, or their IdP subject.
          </FieldDescription>
        </Field>
      )}
      <Field>
        <FieldLabel>Role</FieldLabel>
        <Select value={role} onValueChange={(v) => setRole(v as MemberRole)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label} — {r.hint}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel>Stores</FieldLabel>
        <div className="flex flex-col gap-2">
          {stores.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={storeIds.includes(s.id)}
                onCheckedChange={(v) =>
                  setStoreIds(v === true ? [...storeIds, s.id] : storeIds.filter((x) => x !== s.id))
                }
              />
              {s.name}
            </label>
          ))}
        </div>
        <FieldDescription>Leave all unticked for access to every store.</FieldDescription>
      </Field>
    </FormDialog>
  )
}

export function Members() {
  const tenant = useTenant()
  const members = useAll<Membership>('/memberships')
  const storeName = new Map(tenant.stores.map((s) => [s.id, s.name]))
  const revoke = useAction(
    (id: string, { api, tenant }) => api.del(tenant.path(`/memberships/${id}`)),
    { success: 'Access removed' },
  )
  return (
    <>
      <PageHeader
        title="Team"
        description="Who can sign in to this business, and what they can do."
        actions={
          <MemberDialog
            trigger={
              <Button>
                <Plus /> Add member
              </Button>
            }
          />
        }
      />
      <PageBody>
        {members.isPending ? (
          <Loading />
        ) : members.error ? (
          <ErrorState error={members.error} retry={() => members.refetch()} />
        ) : members.data.length === 0 ? (
          <EmptyState icon={<Users />} title="No members" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Stores</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data
                .filter((m) => !m.revokedAt)
                .map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      {m.subject}{' '}
                      {m.subject === tenant.subject && <Badge variant="outline">You</Badge>}
                    </TableCell>
                    <TableCell>{ROLES.find((r) => r.value === m.role)?.label}</TableCell>
                    <TableCell>
                      {m.storeIds.length === 0
                        ? 'All stores'
                        : m.storeIds.map((id) => storeName.get(id) ?? '…').join(', ')}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <MemberDialog
                          member={m}
                          trigger={
                            <Button size="sm" variant="ghost">
                              <Pencil /> Edit
                            </Button>
                          }
                        />
                        <Confirm
                          trigger={
                            <Button size="sm" variant="ghost">
                              Remove
                            </Button>
                          }
                          title={`Remove ${m.subject}?`}
                          description="They lose access straight away. Their name stays on past orders and notes."
                          confirmLabel="Remove"
                          destructive
                          onConfirm={() => revoke.mutate(m.id)}
                        />
                      </div>
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
