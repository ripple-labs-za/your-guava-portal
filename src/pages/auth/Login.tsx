import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate, Link } from 'react-router'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle, ArrowRight, CheckCircle } from 'lucide-react'
import logo from '@/assets/logo.png'
import api from '@/lib/api'

const ERROR_ID = 'login-error'

export default function Login() {
  const { login, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const requestedPath = (location.state as { from?: unknown } | null)?.from
  const returnTo = typeof requestedPath === 'string' && requestedPath.startsWith('/') && !requestedPath.startsWith('//')
    ? requestedPath
    : '/today'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Success has its own channel. Confirming a resend through `error` rendered
  // "your link has been sent" inside the red failure banner, which tells the
  // user the thing they asked for went wrong.
  const [notice, setNotice] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [needsVerification, setNeedsVerification] = useState(false)
  const [resending, setResending] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setNeedsVerification(false)
    setIsLoading(true)

    try {
      await login(email, password)
      navigate(returnTo, { replace: true })
    } catch (err: unknown) {
      const responseData =
        err &&
        typeof err === 'object' &&
        'response' in err &&
        err.response &&
        typeof err.response === 'object' &&
        'data' in err.response &&
        err.response.data &&
        typeof err.response.data === 'object'
          ? (err.response.data as { message?: string; code?: string })
          : null
      setNeedsVerification(responseData?.code === 'EMAIL_VERIFICATION_REQUIRED')
      if (
        err &&
        typeof err === 'object' &&
        'response' in err &&
        err.response &&
        typeof err.response === 'object' &&
        'data' in err.response &&
        err.response.data &&
        typeof err.response.data === 'object' &&
        'message' in err.response.data
      ) {
        setError(String((err.response.data as { message: string }).message))
      } else {
        setError('Invalid email or password. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  // A signup whose verification email never arrived has no User document at
  // all, so the API answers the owner's correct password with a plain 401
  // "Invalid credentials" and no code to branch on. The resend therefore cannot
  // wait to be offered -- it has to be reachable from the failure the owner
  // actually sees, which is an ordinary wrong-password message.
  const resendVerification = async () => {
    const address = email.trim()
    setNotice(null)
    if (!address) {
      setError('Enter your email address above, then ask for a new link.')
      return
    }
    setError(null)
    setResending(true)
    try {
      await api.post('/auth/resend-verification', { email: address })
      // Hedged deliberately: the endpoint answers the same 200 whether a pending
      // registration exists or the mail provider refused the send.
      setNotice(
        `If a signup for ${address} is still waiting to be verified, a fresh verification link has been sent. It expires 24 hours after it is issued — check your spam folder if it does not arrive within a few minutes.`
      )
    } catch {
      setError('Could not send the verification email just now. Please try again in a moment.')
    } finally {
      // Back to idle, not a permanent "sent" state: a second email failing to
      // arrive is exactly the situation this control exists for.
      setResending(false)
    }
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
      <div className="relative z-10 flex items-center justify-center gap-16 w-full max-w-4xl mx-auto px-6 min-h-screen">
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
            <h1 className="text-text text-xl font-bold tracking-tight mb-1">Welcome back</h1>
            <p className="text-muted text-sm mb-6">Sign in to your portal</p>
            {user && (
              <p role="status" className="mb-6 text-sm text-text">
                You are signed in as {user.email}.{' '}
                <Link to="/today" className="text-guava-green underline underline-offset-2">Go to Today</Link>
              </p>
            )}

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 bg-red-900/20 border border-red-900/40 rounded-lg px-3.5 py-3 mb-5"
              >
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p id={ERROR_ID} className="text-red-400 text-sm">{error}</p>
              </div>
            )}
            {notice && (
              <div
                role="status"
                className="flex items-start gap-2.5 bg-guava-green/10 border border-guava-green/20 rounded-lg px-3.5 py-3 mb-5"
              >
                <CheckCircle className="w-4 h-4 text-guava-green shrink-0 mt-0.5" />
                <p className="text-guava-green text-sm">{notice}</p>
              </div>
            )}
            {needsVerification && (
              <Button
                type="button"
                variant="outline"
                className="mb-5 w-full"
                onClick={resendVerification}
                disabled={resending}
              >
                {resending ? 'Sending...' : 'Resend verification email'}
              </Button>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
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
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link to="/forgot-password" className="text-xs text-guava-green hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? ERROR_ID : undefined}
                />
              </div>

              <Button
                type="submit"
                className="w-full mt-2 bg-guava-green-strong hover:bg-guava-green-strong/90 text-white"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Sign In
                    <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </Button>
            </form>

            {!needsVerification && (
              <p className="text-muted text-xs text-center mt-6">
                Didn't get your verification email?{' '}
                <button
                  type="button"
                  onClick={resendVerification}
                  disabled={resending}
                  className="text-guava-green hover:underline disabled:opacity-50"
                >
                  {resending ? 'Sending...' : 'Send it again'}
                </button>
              </p>
            )}

            <p className="text-muted text-xs text-center mt-3">
              Don't have an account?{' '}
              <Link to="/signup" className="text-guava-green hover:underline">Sign up</Link>
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
