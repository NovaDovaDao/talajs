import { MailCheck } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { AuthError, authErrorMessage } from '@/lib/better-auth'
import { useApp } from '@/lib/session'
import { AuthPage } from './sign-in'

export function ForgotPassword() {
  const client = useApp().auth.client
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)
  return (
    <AuthPage title="Reset your password" description="We'll email you a link to choose a new one.">
      {sent ? (
        <Alert>
          <MailCheck />
          <AlertDescription>
            If {email} has a password here, a reset link is on its way. It expires in 1 hour.
          </AlertDescription>
        </Alert>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setPending(true)
            // The answer is the same whether or not the account exists.
            await client?.requestPasswordReset(email.trim()).catch(() => {})
            setPending(false)
            setSent(true)
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="fp-email">Email</FieldLabel>
              <Input
                id="fp-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Button type="submit" disabled={pending}>
              Send reset link
            </Button>
          </FieldGroup>
        </form>
      )}
      <p className="mt-4 text-sm">
        <Link to="/sign-in" className="text-muted-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthPage>
  )
}

export function ResetPassword() {
  const client = useApp().auth.client
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(
    params.get('error') ? authErrorMessage(params.get('error')) : null,
  )
  return (
    <AuthPage
      title="Choose a new password"
      description="This signs you out on every device. Sign in again afterwards."
    >
      {!token ? (
        <p className="text-sm text-destructive">
          {error ?? authErrorMessage('INVALID_TOKEN')}{' '}
          <Link to="/forgot-password" className="underline">
            Request a new link
          </Link>
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setPending(true)
            setError(null)
            try {
              await client?.resetPassword(token, password)
              toast.success('Password changed. Sign in with your new password.')
              navigate('/sign-in')
            } catch (err) {
              setError(
                err instanceof AuthError ? authErrorMessage(err.code, err.message) : String(err),
              )
            } finally {
              setPending(false)
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="rp-password">New password</FieldLabel>
              <Input
                id="rp-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </Field>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={pending}>
              Change password
            </Button>
          </FieldGroup>
        </form>
      )}
    </AuthPage>
  )
}
