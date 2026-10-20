import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router'
import { RouteFocusContext } from '@/components/layout/AppLayout'
import { useAuth } from '@/hooks/useAuth'
import { WORKFORCE_ENABLED } from '@/lib/features'

const Login = lazy(() => import('@/pages/auth/Login'))
const Signup = lazy(() => import('@/pages/auth/Signup'))
const AcceptInvite = lazy(() => import('@/pages/auth/AcceptInvite'))
const VerifyEmail = lazy(() => import('@/pages/auth/VerifyEmail'))
const ForgotPassword = lazy(() => import('@/pages/auth/ForgotPassword'))
const ResetPassword = lazy(() => import('@/pages/auth/ResetPassword'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Connect = lazy(() => import('@/pages/Connect'))
const Insights = lazy(() => import('@/pages/Insights'))
const Settings = lazy(() => import('@/pages/Settings'))
const Forecasts = lazy(() => import('@/pages/Forecasts'))
const Factors = lazy(() => import('@/pages/Factors'))
const History = lazy(() => import('@/pages/History'))
const Team = lazy(() => import('@/pages/Team'))
const Analytics = lazy(() => import('@/pages/Analytics'))
const MenuItems = lazy(() => import('@/pages/MenuItems'))
const UploadDetail = lazy(() => import('@/pages/UploadDetail'))
const Integrations = lazy(() => import('@/pages/Integrations'))
const IntegrationCallback = lazy(() => import('@/pages/IntegrationCallback'))
const Improvements = lazy(() => import('@/pages/Improvements'))

const workforcePages = WORKFORCE_ENABLED
  ? {
      Roster: lazy(() => import('@/pages/Roster')),
      Staff: lazy(() => import('@/pages/Staff')),
      Leave: lazy(() => import('@/pages/Leave')),
    }
  : null

function RouteFallback() {
  return (
    <div className='min-h-screen bg-[#0F0F0F] flex items-center justify-center' role='status'>
      <div className='flex flex-col items-center gap-4'>
        <div className='w-8 h-8 border-2 border-guava-red/30 border-t-guava-red rounded-full animate-spin' />
        <p className='text-muted text-sm'>Loading portal...</p>
      </div>
    </div>
  )
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading, bootstrapError, signedOut } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0F0F0F] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-guava-red/30 border-t-guava-red rounded-full animate-spin" />
          <p className="text-muted text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  // The session could not be checked because nothing answered — not because the
  // visitor is signed out. Sending them to /login told a signed-in owner on bad
  // mobile data that they were logged out, so they retyped a password that was
  // never wrong and spent attempts against the login rate limit doing it. Their
  // refresh cookie is good for another seven days.
  if (!user && bootstrapError === 'unreachable') {
    return (
      <div className='min-h-screen bg-bg flex items-center justify-center px-6' role='alert'>
        <div className='w-full max-w-md rounded-xl border border-border bg-surface p-6 text-center'>
          <h1 className='text-lg font-semibold text-text'>Can't reach Your Guava</h1>
          <p className='mt-2 text-sm text-muted'>
            Your sign-in is still valid. The app just could not get an answer from the server.
            Check your connection and try again.
          </p>
          <button
            type='button'
            onClick={() => window.location.reload()}
            className='mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-guava-green-strong px-4 text-sm font-medium text-white hover:bg-guava-green-strong/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guava-green'
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!user) {
    // A deliberate Sign Out keeps no return page (UAT-14-S20): the next sign-in, perhaps someone else's, starts on Today.
    return <Navigate to='/login' replace state={signedOut ? undefined : { from: location.pathname + location.search }} />
  }

  return <>{children}</>
}

function ProtectedPage({ children }: { children: ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>
}

/**
 * Owns the two things a route change owes a screen-reader or keyboard user:
 * a focus move into the new page's main region, and a polite announcement of
 * its title. It lives above <Routes> so it survives every navigation - the live
 * region has to be in the DOM before its text changes to be announced at all.
 */
export function RouteFocusProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const previousPathname = useRef(location.pathname)
  const [shouldFocusMain, setShouldFocusMain] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (previousPathname.current === location.pathname) return
    previousPathname.current = location.pathname
    // A `<Navigate replace>` off the entry URL ("/" -> "/today", or the catch-all
    // route) is still the first paint: there was nothing on screen to move focus
    // away from, so leave the landing position alone.
    if (navigationType === 'REPLACE' && !shouldFocusMain) return
    setShouldFocusMain(true)
  }, [location.pathname, navigationType, shouldFocusMain])

  const announcePage = useCallback((title: string) => setAnnouncement(title), [])
  const value = useMemo(() => ({ shouldFocusMain, announcePage }), [shouldFocusMain, announcePage])

  return (
    <RouteFocusContext.Provider value={value}>
      {children}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
    </RouteFocusContext.Provider>
  )
}

export default function App() {
  return (
    <RouteFocusProvider>
    <Suspense fallback={<RouteFallback />}>
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/" element={<Navigate to="/today" replace />} />

      <Route path="/today" element={<ProtectedPage><Dashboard /></ProtectedPage>} />
      <Route path="/dashboard" element={<ProtectedPage><Dashboard /></ProtectedPage>} />

      <Route path="/planning" element={<ProtectedPage><Forecasts /></ProtectedPage>} />
      <Route path="/forecasts" element={<ProtectedPage><Forecasts /></ProtectedPage>} />
      <Route path="/planning/factors" element={<ProtectedPage><Factors /></ProtectedPage>} />
      <Route path="/factors" element={<ProtectedPage><Factors /></ProtectedPage>} />

      <Route path="/performance" element={<ProtectedPage><Analytics /></ProtectedPage>} />
      <Route path="/analytics" element={<ProtectedPage><Analytics /></ProtectedPage>} />
      <Route path="/history" element={<ProtectedPage><History /></ProtectedPage>} />

      <Route path="/ask-guava" element={<ProtectedPage><Insights /></ProtectedPage>} />
      <Route path="/insights" element={<ProtectedPage><Insights /></ProtectedPage>} />

      <Route path="/data-health" element={<ProtectedPage><Connect /></ProtectedPage>} />
      <Route path="/connect" element={<ProtectedPage><Connect /></ProtectedPage>} />
      <Route path="/data-health/menu-items" element={<ProtectedPage><MenuItems /></ProtectedPage>} />
      <Route path="/menu-items" element={<ProtectedPage><MenuItems /></ProtectedPage>} />

      <Route path="/settings" element={<ProtectedPage><Settings /></ProtectedPage>} />
      <Route path="/improvements" element={<ProtectedPage><Improvements /></ProtectedPage>} />
      <Route path="/account" element={<ProtectedPage><Navigate to="/settings?section=account" replace /></ProtectedPage>} />
      <Route path="/team" element={<ProtectedPage><Team /></ProtectedPage>} />

      {workforcePages && (
        <>
          <Route path="/roster" element={<ProtectedPage><workforcePages.Roster /></ProtectedPage>} />
          <Route path="/staff" element={<ProtectedPage><workforcePages.Staff /></ProtectedPage>} />
          <Route path="/leave" element={<ProtectedPage><workforcePages.Leave /></ProtectedPage>} />
        </>
      )}

      <Route path="/uploads/:id" element={<ProtectedPage><UploadDetail /></ProtectedPage>} />

      <Route path="/integrations" element={<ProtectedPage><Integrations /></ProtectedPage>} />
      <Route path="/integrations/:provider/callback" element={<ProtectedPage><IntegrationCallback /></ProtectedPage>} />

      <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
    </Suspense>
    </RouteFocusProvider>
  )
}
