import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useApp } from '@/lib/session'

export function SignIn() {
  const { auth } = useApp()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [token, setToken] = useState('')

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-heading text-xl">Sign in to Tala</CardTitle>
          <CardDescription>
            {auth.mode === 'token'
              ? 'Paste an access token or service token.'
              : auth.mode === 'oidc'
                ? 'Continue with your organisation account.'
                : 'Your session is managed by Cloudflare Access.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {auth.mode === 'token' ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                await auth.signIn(token)
                await client.resetQueries()
                navigate('/')
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
        </CardContent>
      </Card>
    </div>
  )
}
