import type { Tenant } from '@talajs/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ErrorState, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel, FieldSeparator } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/lib/api'
import { errorMessage } from '@/lib/queries'
import { useApp, useMe } from '@/lib/session'

/** Service tokens see every tenant but can't list them: open one by id, or create one. */
function ServicePicker() {
  const { api } = useApp()
  const navigate = useNavigate()
  const [tenantId, setTenantId] = useState('')
  const [form, setForm] = useState({ name: '', slug: '', defaultCurrency: 'USD', ownerSubject: '' })
  const create = useMutation({
    mutationFn: () => api.post<Tenant>('/v1/tenants', form),
    onSuccess: (t) => navigate(`/t/${t.id}`),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value })
  return (
    <CardContent>
      <FieldGroup>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            navigate(`/t/${tenantId.trim()}`)
          }}
        >
          <Input
            placeholder="Tenant id"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            aria-label="Tenant id"
          />
          <Button type="submit" disabled={!tenantId.trim()}>
            Open
          </Button>
        </form>
        <FieldSeparator>or create a business</FieldSeparator>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="t-name">Name</FieldLabel>
              <Input id="t-name" value={form.name} onChange={set('name')} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="t-slug">Slug</FieldLabel>
              <Input
                id="t-slug"
                value={form.slug}
                onChange={set('slug')}
                placeholder="my-cafe"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="t-cur">Currency</FieldLabel>
              <Input
                id="t-cur"
                value={form.defaultCurrency}
                onChange={set('defaultCurrency')}
                maxLength={3}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="t-owner">Owner (email or IdP subject)</FieldLabel>
              <Input
                id="t-owner"
                value={form.ownerSubject}
                onChange={set('ownerSubject')}
                required
              />
            </Field>
            <Button type="submit" disabled={create.isPending}>
              Create business
            </Button>
          </FieldGroup>
        </form>
      </FieldGroup>
    </CardContent>
  )
}

/** Self-serve (`allowSelfServeTenants`): a signed-in person creates a business and owns it. */
function CreateBusiness() {
  const { api } = useApp()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [form, setForm] = useState({ name: '', slug: '', defaultCurrency: 'USD' })
  const create = useMutation({
    mutationFn: () => api.post<Tenant>('/v1/tenants', form),
    onSuccess: async (t) => {
      await client.invalidateQueries({ queryKey: ['me'] })
      navigate(`/t/${t.id}`)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="nb-name">Business name</FieldLabel>
          <Input
            id="nb-name"
            value={form.name}
            onChange={(e) =>
              setForm({
                ...form,
                name: e.target.value,
                slug: e.target.value
                  .toLowerCase()
                  .normalize('NFKD')
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-|-$/g, '')
                  .slice(0, 64),
              })
            }
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="nb-slug">Short name</FieldLabel>
          <Input id="nb-slug" value={form.slug} onChange={set('slug')} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="nb-cur">Currency</FieldLabel>
          <Input
            id="nb-cur"
            value={form.defaultCurrency}
            onChange={(e) => setForm({ ...form, defaultCurrency: e.target.value.toUpperCase() })}
            maxLength={3}
          />
        </Field>
        <Button type="submit" disabled={create.isPending}>
          Create business
        </Button>
      </FieldGroup>
    </form>
  )
}

export function TenantPicker() {
  const me = useMe()
  const { auth } = useApp()
  const navigate = useNavigate()
  const client = useQueryClient()
  if (me.isPending) {
    return (
      <div className="mx-auto max-w-md p-8">
        <Loading rows={3} />
      </div>
    )
  }
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/sign-in" />
  if (me.error) {
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorState error={me.error} retry={() => me.refetch()} />
      </div>
    )
  }
  const { kind, memberships, canCreateTenant } = me.data
  const who = me.data.email ?? me.data.subject
  if (kind !== 'service' && memberships.length === 1 && !canCreateTenant) {
    return <Navigate to={`/t/${memberships[0]?.tenantId}`} replace />
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Choose a business</CardTitle>
          <CardDescription>Signed in as {who}</CardDescription>
        </CardHeader>
        {kind === 'service' ? (
          <ServicePicker />
        ) : (
          <CardContent className="flex flex-col gap-2">
            {kind === 'terminal' && (
              <p className="text-sm text-muted-foreground">This is a register token.</p>
            )}
            {memberships.length === 0 && !canCreateTenant && (
              <p className="text-sm text-muted-foreground">
                You're not a member of any business yet. Ask an owner or manager to invite {who},
                then open the link in the email.
              </p>
            )}
            {memberships.map((m) => (
              <Button
                key={m.tenantId}
                variant="outline"
                className="h-auto justify-start py-3"
                onClick={() => navigate(`/t/${m.tenantId}`)}
              >
                <Building2 />
                <span className="flex-1 text-left">
                  <span className="block font-medium">{m.tenantName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {m.role.toLowerCase()}
                  </span>
                </span>
                <ChevronRight />
              </Button>
            ))}
            {canCreateTenant && (
              <>
                <FieldSeparator>
                  {memberships.length === 0 ? 'Set up your business' : 'or create another'}
                </FieldSeparator>
                <CreateBusiness />
              </>
            )}
            {auth.mode === 'better-auth' && (
              <Button
                variant="ghost"
                onClick={async () => {
                  await auth.signOut()
                  await client.resetQueries()
                  navigate('/sign-in')
                }}
              >
                Sign out
              </Button>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}
