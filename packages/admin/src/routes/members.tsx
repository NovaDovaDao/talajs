import type { Invitation, MemberRole, Membership, SentInvitation } from '@talajs/contracts'
import { Mail, Pencil, Plus, Send, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
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

/** The admin decides which roles the caller may grant; the API enforces it too. */
function grantableRoles(role: MemberRole) {
  return role === 'OWNER' ? ROLES : ROLES.filter((r) => r.value === 'STAFF')
}

function StorePicker({
  storeIds,
  onChange,
}: {
  storeIds: string[]
  onChange: (ids: string[]) => void
}) {
  const tenant = useTenant()
  // A manager limited to some stores can only grant those.
  const stores =
    tenant.storeIds.length === 0
      ? tenant.stores
      : tenant.stores.filter((s) => tenant.storeIds.includes(s.id))
  return (
    <Field>
      <FieldLabel>Stores</FieldLabel>
      <div className="flex flex-col gap-2">
        {stores.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={storeIds.includes(s.id)}
              onCheckedChange={(v) =>
                onChange(v === true ? [...storeIds, s.id] : storeIds.filter((x) => x !== s.id))
              }
            />
            {s.name}
          </label>
        ))}
      </div>
      <FieldDescription>
        {tenant.storeIds.length === 0
          ? 'Leave all unticked for access to every store.'
          : 'Tick at least one of your stores.'}
      </FieldDescription>
    </Field>
  )
}

function delivered(result: SentInvitation) {
  if (result.delivery === 'sent') {
    toast.success(`Invitation emailed to ${result.email}`)
  } else if (result.delivery === 'failed') {
    toast.error("The email couldn't be sent. Try re-sending it in a moment.")
  } else if (result.acceptUrl) {
    const url = result.acceptUrl
    void navigator.clipboard?.writeText(url).catch(() => {})
    toast.success(
      "Invitation created. Email isn't set up, so the link was copied: send it yourself.",
      {
        description: url,
        duration: 20_000,
      },
    )
  }
}

function InviteDialog() {
  const tenant = useTenant()
  const roles = grantableRoles(tenant.role)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('STAFF')
  const [storeIds, setStoreIds] = useState<string[]>([])
  const invite = useAction(
    (_: void, { api, tenant }) =>
      api.post<SentInvitation>(tenant.path('/invitations'), {
        email: email.trim(),
        role,
        storeIds,
      }),
    { onSuccess: delivered },
  )
  return (
    <FormDialog
      trigger={
        <Button>
          <Mail /> Invite
        </Button>
      }
      title="Invite someone"
      description="They get an email with a link. It only works for this address, once, within 7 days."
      onOpen={() => {
        setEmail('')
        setRole('STAFF')
        setStoreIds(tenant.storeIds.length === 0 ? [] : [...tenant.storeIds])
      }}
      pending={invite.isPending}
      disabled={!email.trim() || (tenant.storeIds.length > 0 && storeIds.length === 0)}
      onSubmit={() =>
        invite
          .mutateAsync()
          .then(() => true)
          .catch(() => false)
      }
    >
      <Field>
        <FieldLabel htmlFor="inv-email">Email</FieldLabel>
        <Input
          id="inv-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="sam@example.com"
        />
      </Field>
      <Field>
        <FieldLabel>Role</FieldLabel>
        <Select value={role} onValueChange={(v) => setRole(v as MemberRole)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label} — {r.hint}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <StorePicker storeIds={storeIds} onChange={setStoreIds} />
    </FormDialog>
  )
}

function Invitations() {
  const invitations = useAll<Invitation>('/invitations', { status: 'PENDING' })
  const expired = useAll<Invitation>('/invitations', { status: 'EXPIRED' })
  const resend = useAction(
    (id: string, { api, tenant }) =>
      api.post<SentInvitation>(tenant.path(`/invitations/${id}/resend`)),
    { onSuccess: delivered },
  )
  const revoke = useAction(
    (id: string, { api, tenant }) => api.post(tenant.path(`/invitations/${id}/revoke`)),
    { success: 'Invitation withdrawn' },
  )
  const rows = [...(invitations.data ?? []), ...(expired.data ?? [])]
  if (invitations.isPending || invitations.error || rows.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-heading text-sm font-semibold">Invitations</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-medium">{i.email}</TableCell>
              <TableCell>{ROLES.find((r) => r.value === i.role)?.label}</TableCell>
              <TableCell>
                {i.status === 'EXPIRED' ? (
                  <Badge variant="outline">Expired</Badge>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Sent {new Date(i.lastSentAt).toLocaleDateString()}
                    {i.sendCount > 1 ? ` (${i.sendCount}×)` : ''}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => resend.mutate(i.id)}>
                    <Send /> Re-send
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>
                    Withdraw
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

function MemberDialog({ member, trigger }: { member?: Membership; trigger: React.ReactNode }) {
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
      title={
        member
          ? `Edit ${member.displayName ?? member.email ?? member.subject}`
          : 'Add by sign-in id'
      }
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
            For sign-in without email invitations: their email behind Cloudflare Access, or their
            IdP subject. Prefer Invite for people.
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
      <StorePicker storeIds={storeIds} onChange={setStoreIds} />
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
  const resetPin = useAction(
    (id: string, { api, tenant }) => api.del(tenant.path(`/memberships/${id}/pin`)),
    { success: 'PIN reset. They can set a new one under Your account.' },
  )
  const isOwner = tenant.role === 'OWNER'
  return (
    <>
      <PageHeader
        title="Team"
        description="Who can sign in to this business, and what they can do."
        actions={
          <>
            {isOwner && (
              <MemberDialog
                trigger={
                  <Button variant="outline">
                    <Plus /> Add by id
                  </Button>
                }
              />
            )}
            <InviteDialog />
          </>
        }
      />
      <PageBody>
        <Invitations />
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
                <TableHead>PIN</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data
                .filter((m) => !m.revokedAt)
                .map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="font-medium">
                        {m.displayName ?? m.email ?? m.subject}{' '}
                        {m.subject === tenant.subject && <Badge variant="outline">You</Badge>}
                      </div>
                      {m.displayName && m.email && (
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      )}
                    </TableCell>
                    <TableCell>{ROLES.find((r) => r.value === m.role)?.label}</TableCell>
                    <TableCell>
                      {m.storeIds.length === 0
                        ? 'All stores'
                        : m.storeIds.map((id) => storeName.get(id) ?? '…').join(', ')}
                    </TableCell>
                    <TableCell>
                      {m.hasPin ? (
                        <Badge variant="secondary">Set</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {m.hasPin &&
                          m.subject !== tenant.subject &&
                          (isOwner || m.role === 'STAFF') && (
                            <Button size="sm" variant="ghost" onClick={() => resetPin.mutate(m.id)}>
                              Reset PIN
                            </Button>
                          )}
                        {isOwner && (
                          <MemberDialog
                            member={m}
                            trigger={
                              <Button size="sm" variant="ghost">
                                <Pencil /> Edit
                              </Button>
                            }
                          />
                        )}
                        {isOwner && (
                          <Confirm
                            trigger={
                              <Button size="sm" variant="ghost">
                                Remove
                              </Button>
                            }
                            title={`Remove ${m.displayName ?? m.email ?? m.subject}?`}
                            description="They lose access straight away. Their name stays on past orders and notes."
                            confirmLabel="Remove"
                            destructive
                            onConfirm={() => revoke.mutate(m.id)}
                          />
                        )}
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
