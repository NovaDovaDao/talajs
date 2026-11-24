import type { Tenant } from '@talajs/contracts'
import { useMutation } from '@tanstack/react-query'
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

export function TenantPicker() {
  const me = useMe()
  const navigate = useNavigate()
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
  const { kind, memberships } = me.data
  if (kind !== 'service' && memberships.length === 1) {
    return <Navigate to={`/t/${memberships[0]?.tenantId}`} replace />
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Choose a business</CardTitle>
          <CardDescription>Signed in as {me.data.subject}</CardDescription>
        </CardHeader>
        {kind === 'service' ? (
          <ServicePicker />
        ) : (
          <CardContent className="flex flex-col gap-2">
            {kind === 'terminal' && (
              <p className="text-sm text-muted-foreground">This is a register token.</p>
            )}
            {memberships.length === 0 && (
              <p className="text-sm text-muted-foreground">
                You're not a member of any business yet. Ask an owner to add {me.data.subject}.
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
          </CardContent>
        )}
      </Card>
    </div>
  )
}
