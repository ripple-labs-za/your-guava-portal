import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { CheckCircle } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import logo from '@/assets/logo.png'

const SUPPORT_EMAIL = 'support@yourguava.co.za'
// authLimiter is 30 requests per 15 minutes per IP, and it is shared with login,
// register, verify and resend — so a locked-out owner who has already retried a
// few sign-ins can arrive here already throttled.
const THROTTLED_MESSAGE =
  'Too many attempts from this connection. Wait 15 minutes before asking for another link — retrying now will keep failing.'
const UNREACHABLE_MESSAGE =
  'The request could not be sent. Check your connection and try again.'

type RequestFailure = {
  response?: { status?: number; data?: { message?: unknown } }
}

function forgotErrorMessage(error: unknown): string {
  const failure = (error ?? {}) as RequestFailure
  const response = failure.response
  if (!response) return UNREACHABLE_MESSAGE
  const message = response.data?.message
  if (typeof message === 'string' && message.trim()) return message
  if (response.status === 429) return THROTTLED_MESSAGE
  return UNREACHABLE_MESSAGE
}

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (requestError: unknown) {
      setError(forgotErrorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0808] flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-white/8 bg-[#111111] p-8">
        <img src={logo} alt="Your Guava" className="mx-auto mb-8 w-36" />
        <h1 className="text-xl font-bold text-text">Reset your password</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Enter your sign-in email. If an account exists, we’ll send a one-time reset link.
        </p>

        {sent ? (
          <div className="mt-6">
            {/* The link's lifetime and single-use nature were never stated, so a
                user whose email was slow had nothing to judge waiting against —
                and asking again silently revokes the link that may still land. */}
            <div className="rounded-lg border border-guava-green/20 bg-guava-green/10 p-4 text-sm text-guava-green" role="status">
              <div className="flex items-start gap-3">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-2">
                  <p>Check your inbox. If an account uses {email}, a reset link is on its way.</p>
                  <p className="text-muted">
                    The link works once and expires after 1 hour. If it hasn’t arrived in a few
                    minutes, check your spam or promotions folder. You can ask for up to 3 links an
                    hour, and each new link cancels the one before.
                  </p>
                </div>
              </div>
            </div>
            <Button type="button" variant="outline" className="mt-4 w-full" onClick={() => setSent(false)}>
              Send another link
            </Button>
            <p className="mt-4 text-xs text-muted">
              Nothing after two tries? Email{' '}
              <a
                className="text-guava-green underline underline-offset-2 hover:no-underline"
                href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Password reset email not arriving')}`}
              >
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email address</Label>
              <Input
                id="reset-email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'forgot-password-error' : undefined}
                autoFocus
              />
            </div>
            {error && (
              <p id="forgot-password-error" className="text-sm text-red-400" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Sending...' : 'Send reset link'}
            </Button>
          </form>
        )}
        <Link className="mt-6 block text-center text-sm text-guava-green hover:underline" to="/login">
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
