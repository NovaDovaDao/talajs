import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { SignInForm } from '@/components/sign-in-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { authErrorMessage } from '@/lib/better-auth'
import { useApp } from '@/lib/session'

/** Only same-admin paths, so `?next=` can't send anyone elsewhere. */
export const safeNext = (next: string | null) =>
  next?.startsWith('/') && !next.startsWith('//') ? next : '/'

export function AuthPage({
  title,
  description,
  children,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-heading text-xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}

export function SignIn() {
  const { auth } = useApp()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [params] = useSearchParams()
  const [token, setToken] = useState('')
  const next = safeNext(params.get('next'))
  const finish = async () => {
    await client.resetQueries()
    navigate(next)
  }

  if (auth.mode === 'better-auth') {
    const error = params.get('error')
    return (
      <AuthPage title="Sign in" description="First time? Use the link in your invitation email.">
        {error && <p className="mb-4 text-sm text-destructive">{authErrorMessage(error)}</p>}
        <SignInForm next={next} onSignedIn={finish} />
      </AuthPage>
    )
  }

  return (
    <AuthPage
      title="Sign in to Tala"
      description={
        auth.mode === 'token'
          ? 'Paste an access token or service token.'
          : auth.mode === 'oidc'
            ? 'Continue with your organisation account.'
            : 'Your session is managed by Cloudflare Access.'
      }
    >
      {auth.mode === 'token' ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            await auth.signIn(token)
            await finish()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="token">Token</FieldLabel>
              <Input
                id="token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
              />
              <FieldDescription>Kept for this browser tab only.</FieldDescription>
            </Field>
            <Button type="submit" disabled={!token.trim()}>
              Sign in
            </Button>
          </FieldGroup>
        </form>
      ) : (
        <Button className="w-full" onClick={() => auth.signIn()}>
          {auth.mode === 'oidc' ? 'Continue' : 'Retry'}
        </Button>
      )}
    </AuthPage>
  )
}
