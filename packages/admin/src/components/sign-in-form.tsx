import { MailCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel, FieldSeparator } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AuthError, authErrorMessage } from '@/lib/better-auth'
import { useApp } from '@/lib/session'

const messageOf = (error: unknown) =>
  error instanceof AuthError ? authErrorMessage(error.code, error.message) : authErrorMessage(null)

function MagicLinkForm({ next, initialEmail }: { next: string; initialEmail?: string }) {
  const client = useApp().auth.client
  const [email, setEmail] = useState(initialEmail ?? '')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  if (state === 'sent') {
    return (
      <Alert>
        <MailCheck />
        <AlertDescription>
          If {email} can sign in here, a link is on its way. It works once and expires in 5 minutes.
          You can close this tab.
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setState('sending')
        setError(null)
        try {
          await client?.sendMagicLink(email.trim(), next)
          setState('sent')
        } catch (err) {
          setError(messageOf(err))
          setState('idle')
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="ml-email">Email</FieldLabel>
          <Input
            id="ml-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={state === 'sending' || !email.trim()}>
          Email me a sign-in link
        </Button>
      </FieldGroup>
    </form>
  )
}

function PasswordForm({
  initialEmail,
  onSignedIn,
}: {
  initialEmail?: string
  onSignedIn: () => void
}) {
  const client = useApp().auth.client
  const [email, setEmail] = useState(initialEmail ?? '')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setPending(true)
        setError(null)
        try {
          await client?.signInPassword(email.trim(), password)
          onSignedIn()
        } catch (err) {
          setError(messageOf(err))
        } finally {
          setPending(false)
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="pw-email">Email</FieldLabel>
          <Input
            id="pw-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="pw-password">Password</FieldLabel>
            <Link
              to="/forgot-password"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Forgot it?
            </Link>
          </div>
          <Input
            id="pw-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending}>
          Sign in
        </Button>
      </FieldGroup>
    </form>
  )
}

function SignUpForm({ next, initialEmail }: { next: string; initialEmail?: string }) {
  const client = useApp().auth.client
  const [form, setForm] = useState({ name: '', email: initialEmail ?? '', password: '' })
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value })
  if (state === 'sent') {
    return (
      <Alert>
        <MailCheck />
        <AlertDescription>
          Check {form.email} for a link to confirm your email. It brings you back here.
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setState('sending')
        setError(null)
        try {
          await client?.signUpPassword(form.name.trim(), form.email.trim(), form.password, next)
          setState('sent')
        } catch (err) {
          setError(messageOf(err))
          setState('idle')
        }
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="su-name">Your name</FieldLabel>
          <Input
            id="su-name"
            autoComplete="name"
            value={form.name}
            onChange={set('name')}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="su-email">Email</FieldLabel>
          <Input
            id="su-email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={set('email')}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="su-password">Password</FieldLabel>
          <Input
            id="su-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={form.password}
            onChange={set('password')}
            required
          />
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={state === 'sending'}>
          Create account
        </Button>
      </FieldGroup>
    </form>
  )
}

/**
 * Better Auth sign-in: an emailed link by default, plus password and Google when the server
 * enables them. `next` is where to land afterwards (also used in emailed links).
 */
export function SignInForm({
  next,
  initialEmail,
  allowSignUp = false,
  onSignedIn,
}: {
  next: string
  initialEmail?: string
  /** Offer "create account" (password mode); used on the invitation screen. */
  allowSignUp?: boolean
  onSignedIn: () => void
}) {
  const { config, auth } = useApp()
  const methods =
    config.auth.mode === 'better-auth'
      ? config.auth.methods
      : { magicLink: true, password: false, google: false }
  const tabs = [
    methods.magicLink && 'link',
    methods.password && 'password',
    methods.password && allowSignUp && 'signup',
  ].filter(Boolean) as string[]

  return (
    <div className="flex flex-col gap-4">
      {tabs.length > 1 ? (
        <Tabs defaultValue={tabs[0]}>
          <TabsList className="w-full">
            {tabs.includes('link') && <TabsTrigger value="link">Email link</TabsTrigger>}
            {tabs.includes('password') && <TabsTrigger value="password">Password</TabsTrigger>}
            {tabs.includes('signup') && <TabsTrigger value="signup">New account</TabsTrigger>}
          </TabsList>
          <TabsContent value="link" className="pt-2">
            <MagicLinkForm next={next} initialEmail={initialEmail} />
          </TabsContent>
          <TabsContent value="password" className="pt-2">
            <PasswordForm initialEmail={initialEmail} onSignedIn={onSignedIn} />
          </TabsContent>
          <TabsContent value="signup" className="pt-2">
            <SignUpForm next={next} initialEmail={initialEmail} />
          </TabsContent>
        </Tabs>
      ) : tabs[0] === 'password' ? (
        <PasswordForm initialEmail={initialEmail} onSignedIn={onSignedIn} />
      ) : (
        <MagicLinkForm next={next} initialEmail={initialEmail} />
      )}
      {methods.google && (
        <>
          <FieldSeparator>or</FieldSeparator>
          <Button variant="outline" onClick={() => auth.client?.signInGoogle(next)}>
            Continue with Google
          </Button>
        </>
      )}
    </div>
  )
}
