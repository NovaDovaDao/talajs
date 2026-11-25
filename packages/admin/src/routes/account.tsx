import type { Tenant } from '@talajs/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, LogOut, Monitor } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Confirm } from '@/components/confirm'
import { PageBody, PageHeader } from '@/components/page'
import { ErrorState, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { AuthError, authErrorMessage } from '@/lib/better-auth'
import { useAction, useResource } from '@/lib/queries'
import { useApp, useMe, useTenant } from '@/lib/session'

const authMessage = (e: unknown) =>
  e instanceof AuthError ? authErrorMessage(e.code, e.message) : String(e)

function PinCard() {
  const tenant = useTenant()
  const settings = useResource<Tenant>('')
  const [pin, setPin] = useState('')
  const length = settings.data?.pinLength ?? 4
  const save = useAction(
    (_: void, { api, tenant }) =>
      api.put(tenant.path(`/memberships/${tenant.membershipId}/pin`), { pin }),
    { success: 'PIN saved', onSuccess: () => setPin('') },
  )
  const clear = useAction(
    (_: void, { api, tenant }) => api.del(tenant.path(`/memberships/${tenant.membershipId}/pin`)),
    { success: 'PIN removed' },
  )
  const client = useQueryClient()
  if (!tenant.membershipId) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" /> Register PIN{' '}
          {tenant.hasPin ? (
            <Badge variant="secondary">Set</Badge>
          ) : (
            <Badge variant="outline">Not set</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Identifies you at {tenant.tenantName}'s registers. It's for knowing who rang up a sale,
          not a password: keep it to yourself, but don't reuse a PIN that matters elsewhere.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            await save.mutateAsync()
            await client.invalidateQueries({ queryKey: ['me'] })
          }}
        >
          <Field className="w-40">
            <FieldLabel htmlFor="pin">{tenant.hasPin ? 'New PIN' : 'PIN'}</FieldLabel>
            <Input
              id="pin"
              inputMode="numeric"
              autoComplete="off"
              pattern={`\\d{${length}}`}
              maxLength={length}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder={'•'.repeat(length)}
            />
          </Field>
          <Button type="submit" disabled={pin.length !== length || save.isPending}>
            Save PIN
          </Button>
          {tenant.hasPin && (
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                await clear.mutateAsync()
                await client.invalidateQueries({ queryKey: ['me'] })
              }}
            >
              Remove
            </Button>
          )}
        </form>
        <FieldDescription className="mt-2">{length} digits.</FieldDescription>
      </CardContent>
    </Card>
  )
}

function ProfileCard() {
  const { auth } = useApp()
  const me = useMe()
  const client = useQueryClient()
  const [name, setName] = useState(me.data?.name ?? '')
  const save = useMutation({
    mutationFn: () => auth.client?.updateName(name.trim()) ?? Promise.resolve(),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['me'] })
      toast.success('Name saved')
    },
    onError: (e) => toast.error(authMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Shown to your team and on the registers.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Field className="min-w-60 flex-1">
            <FieldLabel htmlFor="acc-name">Name</FieldLabel>
            <Input
              id="acc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="How your team knows you"
              required
            />
          </Field>
          <Button type="submit" disabled={save.isPending || !name.trim()}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function PasswordCard() {
  const { auth } = useApp()
  const [form, setForm] = useState({ current: '', next: '' })
  const save = useMutation({
    mutationFn: () => auth.client?.changePassword(form.current, form.next) ?? Promise.resolve(),
    onSuccess: () => {
      setForm({ current: '', next: '' })
      toast.success('Password changed. Your other devices were signed out.')
    },
    onError: (e) => toast.error(authMessage(e)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changing it signs you out on your other devices.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <FieldGroup className="max-w-sm">
            <Field>
              <FieldLabel htmlFor="pw-current">Current password</FieldLabel>
              <Input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                value={form.current}
                onChange={(e) => setForm({ ...form, current: e.target.value })}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="pw-next">New password</FieldLabel>
              <Input
                id="pw-next"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={form.next}
                onChange={(e) => setForm({ ...form, next: e.target.value })}
                required
              />
            </Field>
            <Button type="submit" disabled={save.isPending} className="w-fit">
              Change password
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function SessionsCard() {
  const { auth } = useApp()
  const navigate = useNavigate()
  const client = useQueryClient()
  const current = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: () => auth.client?.getSession() ?? null,
  })
  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => auth.client?.listSessions() ?? [],
  })
  const revoke = useMutation({
    mutationFn: (token: string) => auth.client?.revokeSession(token) ?? Promise.resolve(),
    onSuccess: () => client.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
    onError: (e) => toast.error(authMessage(e)),
  })
  const everywhere = useMutation({
    mutationFn: () => auth.client?.revokeSessions() ?? Promise.resolve(),
    onSuccess: async () => {
      await client.resetQueries()
      navigate('/sign-in')
    },
    onError: (e) => toast.error(authMessage(e)),
  })
  const when = (iso: string) =>
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where you're signed in</CardTitle>
        <CardDescription>
          Sign out a device you don't recognise, or everywhere at once.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {sessions.isPending ? (
          <Loading rows={2} />
        ) : sessions.error ? (
          <ErrorState error={sessions.error} retry={() => sessions.refetch()} />
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {(sessions.data ?? []).map((s) => {
              const isCurrent = s.id === current.data?.session.id
              return (
                <li key={s.id} className="flex items-center gap-3 p-3 text-sm">
                  <Monitor className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{s.userAgent ?? 'Unknown device'}</div>
                    <div className="text-xs text-muted-foreground">
                      Since {when(s.createdAt)}
                      {s.ipAddress && !/^[0:.]*$/.test(s.ipAddress) ? ` · ${s.ipAddress}` : ''}
                    </div>
                  </div>
                  {isCurrent ? (
                    <Badge variant="outline">This device</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.token)}>
                      Sign out
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <Confirm
          trigger={
            <Button variant="outline" className="w-fit">
              <LogOut /> Sign out everywhere
            </Button>
          }
          title="Sign out everywhere?"
          description="Every device, this one included, has to sign in again."
          confirmLabel="Sign out everywhere"
          destructive
          onConfirm={() => everywhere.mutate()}
        />
      </CardContent>
    </Card>
  )
}

export function Account() {
  const { auth, config } = useApp()
  const password = config.auth.mode === 'better-auth' && config.auth.methods.password
  return (
    <>
      <PageHeader title="Your account" />
      <PageBody className="max-w-3xl">
        {auth.mode === 'better-auth' && <ProfileCard />}
        <PinCard />
        {password && <PasswordCard />}
        {auth.mode === 'better-auth' && <SessionsCard />}
      </PageBody>
    </>
  )
}
