import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AlertCircle, CheckCircle, Loader2, ShieldCheck } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
const MAX_PASSWORD_BYTES = 72
const INVALID_INVITATION_MESSAGE = 'This invitation is invalid or has expired.'
// A page load with no fragment at all is almost always a reload: this page
// strips the token from history on first mount, so F5 finds nothing. The
// invitation in the inbox is untouched, and telling the user it expired sends
// them to request a replacement — which revokes the one that still worked.
const CONSUMED_LINK_MESSAGE =
  'This page has already used the sign-up link. Open the invitation link from your email again to continue.'

interface InvitationPreview {
  email: string
  name: string
  organizationName: string
  cafeNames: string[]
  expiresAt: string
}

type Phase = 'capturing' | 'loading' | 'ready' | 'submitting' | 'success' | 'error'

const passwordBytes = (value: string) => new TextEncoder().encode(value).length

export default function AcceptInvite() {
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null)
  const [phase, setPhase] = useState<Phase>('capturing')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Distinguishes "this page load carried no token" from "the token was
  // malformed", which need different advice.
  const [linkAbsent, setLinkAbsent] = useState(false)
  const captured = useRef(false)

  // The email link carries the capability in the fragment, which is never sent
  // to the hosting server. Capture it before paint, then remove it from history.
  useLayoutEffect(() => {
    if (captured.current) return
    captured.current = true
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const candidate = fragment.get('token')?.trim() || ''
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    if (!candidate) {
      setToken(null)
      setLinkAbsent(true)
      return
    }
    setToken(INVITE_TOKEN_RE.test(candidate) ? candidate : null)
  }, [])

  useEffect(() => {
    if (token === undefined) return
    if (!token) {
      // Three different situations used to share one message that blamed the
      // invitation: a malformed link, a genuinely expired one, and this page
      // having already spent the fragment.
      setError(linkAbsent ? CONSUMED_LINK_MESSAGE : INVALID_INVITATION_MESSAGE)
      setPhase('error')
      return
    }

    const controller = new AbortController()
    setPhase('loading')
    api
      .post<{ invitation: InvitationPreview }>(
        '/team/invitations/preview',
        { token },
        { signal: controller.signal }
      )
      .then(({ data }) => {
        setInvitation(data.invitation)
        setPhase('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(INVALID_INVITATION_MESSAGE)
          setPhase('error')
        }
      })
    return () => controller.abort()
  }, [token, linkAbsent])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!token || !invitation) {
      setError(INVALID_INVITATION_MESSAGE)
      setPhase('error')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (passwordBytes(password) > MAX_PASSWORD_BYTES) {
      setError(`Password cannot exceed ${MAX_PASSWORD_BYTES} UTF-8 bytes.`)
      return
    }
    if (password !== confirmPassword) {
      setError('Password and confirmation do not match.')
      return
    }

    setPhase('submitting')
    try {
      await api.post('/team/invitations/accept', { token, password })
      setPassword('')
      setConfirmPassword('')
      setPhase('success')
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : null
      setError(message || 'This invitation could not be accepted. Ask the account owner for a new invitation.')
      setPhase('ready')
    }
  }

  return (
    <main className="min-h-screen bg-[#0F0F0F] px-4 py-12 text-text flex items-center justify-center">
      <section className="w-full max-w-md rounded-2xl border border-border bg-[#111111] p-6 shadow-2xl sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-guava-green/20 bg-guava-green/10">
            <ShieldCheck className="h-5 w-5 text-guava-green" />
          </div>
          <div>
            <p className="text-sm font-semibold"><span className="text-guava-green">Your</span> <span className="text-guava-red-text">Guava</span></p>
            <h1 className="text-xl font-semibold">Accept your invitation</h1>
          </div>
        </div>

        {(phase === 'capturing' || phase === 'loading') && (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-[#0F0F0F] px-4 py-5" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-guava-green" />
            <span className="text-sm text-muted">Checking your invitation…</span>
          </div>
        )}

        {phase === 'error' && (
          <div role="alert" className="space-y-4">
            <div className="flex gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error || INVALID_INVITATION_MESSAGE}</span>
            </div>
            <Button asChild className="w-full"><Link to="/login">Go to sign in</Link></Button>
          </div>
        )}

        {(phase === 'ready' || phase === 'submitting') && invitation && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="rounded-xl border border-border bg-[#0F0F0F] p-4 text-sm">
              <p className="font-medium">Welcome, {invitation.name}</p>
              <p className="mt-1 text-muted">Join {invitation.organizationName} as {invitation.email}.</p>
              {invitation.cafeNames.length > 0 && (
                <p className="mt-2 text-xs text-muted">Cafe access: {invitation.cafeNames.join(', ')}</p>
              )}
            </div>

            {error && (
              <div role="alert" className="flex gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="invite-password">Choose a password</Label>
              <Input
                id="invite-password"
                name="new-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                aria-describedby="invite-password-help"
              />
              {/* The browser's own length check stops the submit before this page's message can show, so the rule is
                  stated up front, as signup does (UAT-09-S02). */}
              <p id="invite-password-help" className="text-muted text-xs">
                At least 8 characters, up to 72 bytes (about 72 characters).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-password-confirm">Confirm password</Label>
              <Input
                id="invite-password-confirm"
                name="confirm-new-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <Button type="submit" className="w-full bg-guava-green-strong text-white hover:bg-guava-green-strong/90" disabled={phase === 'submitting'}>
              {phase === 'submitting' ? <><Loader2 className="h-4 w-4 animate-spin" /> Accepting…</> : 'Create account'}
            </Button>
          </form>
        )}

        {phase === 'success' && (
          <div className="space-y-5 text-center">
            <CheckCircle className="mx-auto h-10 w-10 text-guava-green" />
            <div>
              <h2 className="font-semibold">Your account is ready</h2>
              <p className="mt-1 text-sm text-muted">Sign in with the password you just chose.</p>
            </div>
            <Button asChild className="w-full bg-guava-green-strong text-white hover:bg-guava-green-strong/90"><Link to="/login">Sign in</Link></Button>
          </div>
        )}
      </section>
    </main>
  )
}
