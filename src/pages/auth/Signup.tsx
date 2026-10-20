import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle, ArrowRight, CheckCircle, Mail } from 'lucide-react'
import api from '@/lib/api'
import logo from '@/assets/logo.png'

// bcrypt truncates at 72 bytes, so the backend rejects anything longer rather
// than silently ignoring the tail. A generated passphrase can cross that line,
// and the rule has to be visible while the password is being chosen.
const MAX_PASSWORD_BYTES = 72
const MIN_PASSWORD_LENGTH = 8
const PASSWORD_HELP_ID = 'signup-password-help'
const ERROR_ID = 'signup-error'
const SUPPORT_EMAIL = 'support@yourguava.co.za'

const passwordBytes = (value: string) => new TextEncoder().encode(value).length

type RegistrationErrorPayload = {
  code?: string
  email?: string
  message?: string
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null

const registrationErrorPayload = (error: unknown): RegistrationErrorPayload | null => {
  const errorRecord = asRecord(error)
  const responseRecord = asRecord(errorRecord?.response)
  const responseData = asRecord(responseRecord?.data)
  const nestedData = asRecord(responseData?.data)
  const payload = nestedData || responseData || errorRecord
  if (!payload) return null

  return {
    code: typeof payload.code === 'string' ? payload.code : undefined,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    message: typeof payload.message === 'string' ? payload.message : undefined,
  }
}

export default function Signup() {
  const { register } = useAuth()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [cafeName, setCafeName] = useState('')
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null)
  const [deliveryMode, setDeliveryMode] = useState<string | undefined>()
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    // Checked here rather than after a round trip: six filled-in fields is the
    // wrong moment to learn about a limit that was never stated.
    if (passwordBytes(password) > MAX_PASSWORD_BYTES) {
      setError(
        `Your password is longer than the ${MAX_PASSWORD_BYTES}-byte limit (roughly ${MAX_PASSWORD_BYTES} characters). Shorten it and try again.`
      )
      return
    }
    setIsLoading(true)
    const submittedEmail = email.trim().toLowerCase()

    try {
      const result = await register(submittedEmail, password, name, cafeName, orgName.trim() || undefined)
      setVerificationMessage(result.message)
      setDeliveryMode(result.deliveryMode)
      setPendingEmail(result.email?.trim().toLowerCase() || submittedEmail)
    } catch (err: unknown) {
      const payload = registrationErrorPayload(err)
      // The server answers every accepted address with the same 202 (BE-02-T01), so the only
      // error that still lands on the pending screen is a saved registration whose email failed.
      if (payload?.code === 'VERIFICATION_EMAIL_FAILED') {
        setVerificationMessage(
          payload.message || 'Your registration is pending. Request a fresh verification link below.'
        )
        setPendingEmail(payload.email?.trim().toLowerCase() || submittedEmail)
      } else if (payload?.message) {
        setError(payload.message)
      } else {
        setError('Could not create account. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const resendVerification = async () => {
    if (!pendingEmail) return
    setError(null)
    setResent(false)
    setResending(true)
    try {
      await api.post('/auth/resend-verification', { email: pendingEmail })
      setResent(true)
    } catch {
      setError('Could not resend the verification email. Please try again.')
    } finally {
      setResending(false)
    }
  }

  if (pendingEmail) {
    return (
      <div className="min-h-screen bg-[#0A0808] flex items-center justify-center px-6">
        <div className="w-full max-w-md rounded-2xl border border-white/8 bg-[#111111] p-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-guava-green/10">
            <Mail className="h-6 w-6 text-guava-green" />
          </div>
          <h1 className="text-xl font-bold text-text">Check your inbox</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            {verificationMessage || 'Open the verification link to finish creating your account.'}
          </p>
          <p className="mt-2 text-sm text-muted">
            Verification email: <span className="font-medium text-text">{pendingEmail}</span>
          </p>
          {deliveryMode === 'console' && (
            <p className="mt-2 rounded-lg border border-border px-3 py-2 text-xs text-muted" role="note">
              Development mode: no email was sent. The link is in the server log when EMAIL_CONSOLE_LINKS is on.
            </p>
          )}
          <p className="mt-2 text-sm text-muted">
            When you open the link, you will enter the password you just chose to finish.
          </p>
          {/* The 24-hour window and the spam folder are the two things an owner
              needs when the link is slow, and neither was stated anywhere. */}
          <p className="mt-4 text-xs leading-5 text-muted">
            The link works for 24 hours. If it hasn't arrived in a few minutes, check your
            spam or promotions folder before asking for another one. We send up to 3 emails an
            hour to one address.
          </p>
          {resent && (
            <div className="mt-5 flex items-start justify-center gap-2 text-left text-sm text-guava-green" role="status">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {/* Hedged on purpose: resendVerification answers the same 200 when
                  the mail provider refused the send and the token was rolled back. */}
              <span>If your registration is still pending, a fresh link is on its way.</span>
            </div>
          )}
          {error && <p className="mt-5 text-sm text-red-400" role="alert">{error}</p>}
          <Button className="mt-6 w-full" variant="outline" onClick={resendVerification} disabled={resending}>
            {resending ? 'Sending...' : 'Resend verification email'}
          </Button>
          <p className="mt-5 text-xs text-muted">
            Still nothing after two tries? Email{' '}
            <a
              className="text-guava-green underline underline-offset-2 hover:no-underline"
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Verification email not arriving')}`}
            >
              {SUPPORT_EMAIL}
            </a>{' '}
            and we'll verify the account for you.
          </p>
          <Link className="mt-5 inline-block text-sm text-guava-green hover:underline" to="/login">
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen relative flex overflow-hidden">
      {/* Full-page background — coffee shop photo with gradient fallback */}
      <div className="absolute inset-0 bg-[#0A0808]" />
      <div
        className="absolute inset-0 bg-cover bg-center opacity-40"
        style={{ backgroundImage: `url('https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1920&q=80')` }}
      />
      <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/40 to-black/60" />
      {/* Fallback warm glow if image fails to load */}
      <div className="absolute bottom-0 left-0 w-200 h-200 -translate-x-1/3 translate-y-1/3 rounded-full blur-[200px] opacity-10" style={{ background: '#D43D3D' }} />
      <div className="absolute top-0 right-0 w-125 h-125 translate-x-1/4 -translate-y-1/4 rounded-full blur-[180px] opacity-[0.06]" style={{ background: '#4DA63B' }} />

      {/* Center container — logo left, form right */}
      <div className="relative z-10 flex items-center justify-center gap-16 w-full max-w-4xl mx-auto px-6 py-16 min-h-screen">
        {/* Left — branding */}
        <div className="hidden lg:block w-85 shrink-0">
          <img src={logo} alt="Your Guava" className="w-48 mx-auto mb-6" />
          <p className="text-muted text-center leading-relaxed">
            Know what your customers want<br />before they walk in.
          </p>
          {/* Capability statements, not performance claims. The previous "94%
              Accuracy" sat one screen away from a History page reporting ~88%
              on a typical day, which undermines trust at the front door. */}
          <div className="mt-8 flex items-start justify-center gap-6">
            <div className="text-center whitespace-nowrap">
              <p className="text-guava-green text-2xl font-bold">7 days</p>
              <p className="text-muted text-xs mt-0.5">Forecast ahead</p>
            </div>
            <div className="w-px h-8 bg-white/10 mt-1.5" />
            <div className="text-center whitespace-nowrap">
              <p className="text-guava-red-text text-2xl font-bold">Daily</p>
              <p className="text-muted text-xs mt-0.5">Prep list</p>
            </div>
            <div className="w-px h-8 bg-white/10 mt-1.5" />
            <div className="text-center whitespace-nowrap">
              <p className="text-guava-yellow text-2xl font-bold">Live</p>
              <p className="text-muted text-xs mt-0.5">Weather signals</p>
            </div>
          </div>
        </div>

        {/* Right — form */}
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <img src={logo} alt="Your Guava" className="w-32 mx-auto mb-3" />
            <p className="text-muted text-sm">Know what's brewing before they do.</p>
          </div>

          <div className="bg-[#111111]/60 backdrop-blur-xl border border-white/8 rounded-2xl p-8">
            <h1 className="text-text text-xl font-bold tracking-tight mb-1">Welcome to Your Guava</h1>
            <p className="text-muted text-sm mb-6">Create your portal account</p>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 bg-red-900/20 border border-red-900/40 rounded-lg px-3.5 py-3 mb-5"
              >
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p id={ERROR_ID} className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="Jane Smith"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="name"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="owner@yourcafe.co.za"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? ERROR_ID : undefined}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Choose a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  aria-describedby={PASSWORD_HELP_ID}
                />
                {/* Persistent, not a placeholder: the rule has to survive the
                    first keystroke, and the byte ceiling was previously only
                    ever stated by a rejection. */}
                <p id={PASSWORD_HELP_ID} className="text-muted text-xs">
                  At least {MIN_PASSWORD_LENGTH} characters, up to {MAX_PASSWORD_BYTES} bytes
                  (about {MAX_PASSWORD_BYTES} characters).
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  name="confirm-password"
                  type="password"
                  placeholder="Repeat your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cafeName">Cafe name</Label>
                <Input
                  id="cafeName"
                  name="cafeName"
                  type="text"
                  placeholder="The Daily Grind"
                  value={cafeName}
                  onChange={(e) => setCafeName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="organization"
                />
              </div>

              <div className="space-y-1.5">
                {/* "Organization" is an internal tenancy concept (Organization →
                    Cafe → User) that a single-cafe owner has no model for, and
                    it sat as the last field before submit with a developer's
                    placeholder. Named and explained for what it is actually for. */}
                <Label htmlFor="orgName">Business or group name (optional)</Label>
                <Input
                  id="orgName"
                  name="orgName"
                  type="text"
                  placeholder="Only if you run more than one cafe"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  minLength={2}
                  maxLength={120}
                  autoComplete="off"
                  aria-describedby="signup-org-help"
                />
                <p id="signup-org-help" className="text-muted text-xs">
                  Leave this blank and we'll use your cafe name.
                </p>
              </div>

              <Button
                type="submit"
                className="w-full mt-2 bg-guava-green-strong hover:bg-guava-green-strong/90 text-white"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating account...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Create account
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </Button>
            </form>

            <p className="text-muted text-xs text-center mt-6">
              Already have an account?{' '}
              <Link to="/login" className="text-guava-green hover:underline">Sign in</Link>
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="absolute bottom-6 left-0 right-0 text-center z-10">
        <p className="text-muted text-xs">
          &copy; {new Date().getFullYear()} Your Guava &mdash; Cape Town, South Africa
        </p>
      </div>
    </div>
  )
}
