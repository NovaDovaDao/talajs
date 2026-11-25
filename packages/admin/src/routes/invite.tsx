import type { AcceptedInvitation, InvitationPreview } from '@talajs/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import { SignInForm } from '@/components/sign-in-form'
import { Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { errorMessage } from '@/lib/queries'
import { useApp, useMe } from '@/lib/session'
import { AuthPage } from './sign-in'

const ROLE = { OWNER: 'an owner', MANAGER: 'a manager', STAFF: 'staff' } as const

/** The link in an invitation email: preview, sign in or sign up, then accept. */
export function Invite() {
  const { token = '' } = useParams()
  const { api, auth } = useApp()
  const client = useQueryClient()
  const navigate = useNavigate()
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.get<InvitationPreview>(`/v1/invitations/${encodeURIComponent(token)}`),
    retry: false,
  })
  const me = useMe()
  const accept = useMutation({
    mutationFn: () => api.post<AcceptedInvitation>('/v1/invitations/accept', { token }),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ['me'] })
      navigate(`/t/${result.tenantId}`)
    },
  })

  if (preview.isPending || me.isPending) {
    return (
      <AuthPage title="Invitation">
        <Loading rows={2} />
      </AuthPage>
    )
  }
  if (preview.error) {
    const gone = preview.error instanceof ApiError && preview.error.code === 'invitation_invalid'
    return (
      <AuthPage title="Invitation">
        <p className="text-sm text-muted-foreground">
          {gone
            ? 'This invitation was already used, was withdrawn, or has expired. Ask for a new one.'
            : "We couldn't find this invitation. Check the link in your email, or ask for a new one."}
        </p>
      </AuthPage>
    )
  }

  const inv = preview.data
  const title = `Join ${inv.tenantName}`
  const description = `You're invited as ${ROLE[inv.role]}. Sign in with ${inv.email} to accept.`
  const signedIn = me.isSuccess && me.data.kind === 'staff'

  if (!signedIn) {
    return (
      <AuthPage title={title} description={description}>
        <SignInForm
          next={`/invite/${token}`}
          allowSignUp
          onSignedIn={() => client.invalidateQueries({ queryKey: ['me'] })}
        />
      </AuthPage>
    )
  }

  const code = accept.error instanceof ApiError ? accept.error.code : null
  return (
    <AuthPage title={title} description={description}>
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          Signed in as <span className="font-medium">{me.data.email ?? me.data.subject}</span>.
        </p>
        {code === 'email_mismatch' && (
          <p className="text-sm text-destructive">
            This invitation is for {inv.email}. Sign out, then sign in with that address.
          </p>
        )}
        {code === 'email_unverified' && (
          <p className="text-sm text-destructive">Confirm your email first: check your inbox.</p>
        )}
        {accept.error && !code?.startsWith('email_') && (
          <p className="text-sm text-destructive">{errorMessage(accept.error)}</p>
        )}
        <Button onClick={() => accept.mutate()} disabled={accept.isPending}>
          Accept invitation
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            await auth.signOut()
            await client.resetQueries({ queryKey: ['me'] })
          }}
        >
          Use another account
        </Button>
      </div>
    </AuthPage>
  )
}
