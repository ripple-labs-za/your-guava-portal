import { createContext, useEffect, useState, type ReactNode } from 'react'
import api, { API_CONFIG_ERROR, isSessionRejection, refreshAccessToken } from '@/lib/api'
import { clearInsightChatStorage } from '@/lib/chatStorage'
import { clearAccessToken, getAccessToken, setAccessToken } from '@/lib/accessToken'
import { CafeContextChangedError, clearTabCafeId, setTabCafeId } from '@/lib/cafeContext'
import type { User } from '@/types'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isOwner: boolean
  /**
   * Set when the session could not be restored because the request never got an
   * answer, as opposed to the server refusing the credential. The difference
   * decides whether a visitor is signed out or simply offline, and only the
   * protected-route guard knows whether the page they asked for cares.
   */
  bootstrapError?: 'unreachable' | null
  /**
   * The user pressed Sign Out in this tab. The protected-route guard then sends
   * them to sign in without the page they left as the place to return to: the
   * next person to sign in starts on Today, not on the last person's page.
   */
  signedOut?: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  register: (
    email: string,
    password: string,
    name: string,
    cafeName: string,
    orgName?: string
  ) => Promise<{ email: string; message: string; deliveryMode?: 'email' | 'console' | 'none' }>
  switchCafe: (cafeId: string) => Promise<void>
  updateCurrentUser?: (user: User) => void
}

export const AuthContext = createContext<AuthContextType | null>(null)

interface AuthProviderProps {
  children: ReactNode
}

/**
 * Shown instead of the app when the portal cannot reach its API at all, or was
 * deployed without a usable one. Both used to end in the login screen or a blank
 * page — each of which blames the wrong thing and offers the wrong action.
 */
function StartupNotice({ title, detail, onRetry }: { title: string; detail: string; onRetry?: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6" role="alert">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 text-center">
        <h1 className="text-lg font-semibold text-text">{title}</h1>
        <p className="mt-2 text-sm text-muted">{detail}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-guava-green-strong px-4 text-sm font-medium text-white hover:bg-guava-green-strong/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guava-green"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [bootstrapError, setBootstrapError] = useState<'unreachable' | null>(null)
  const [signedOut, setSignedOut] = useState(false)

  // The access token lives only in module memory, so a page load starts without
  // one and the durable session is the HttpOnly refresh cookie. Asking /auth/me
  // first therefore spent a round trip on a guaranteed 401 before the response
  // interceptor could refresh and retry -- on every cold load, on the slowest
  // moment of the visit, and leaving a red 401 in the console each time.
  // Exchanging the cookie first is one request fewer when the reload has a live
  // session, and exactly the same count when it does not.
  useEffect(() => {
    let active = true
    const restoreSession = async () => {
      try {
        if (!getAccessToken()) {
          try {
            await refreshAccessToken()
          } catch (error) {
            // On a cold load nothing is on screen yet: a changed cafe is adopted (the token and tab cafe are already set).
            if (!(error instanceof CafeContextChangedError)) throw error
          }
        }
        const response = await api.get<User>('/auth/me')
        if (active && response?.data) {
          setUser(response.data)
          setBootstrapError(null)
        }
      } catch (error) {
        if (isSessionRejection(error)) {
          // No cookie, an expired one, or a revoked session: there is nothing to
          // restore. Staying quiet here is correct -- an unauthenticated visitor
          // landing on /login must not be shown an error.
          clearAccessToken()
          if (active) { setUser(null); setBootstrapError(null) }
        } else if (active) {
          // The request never got an answer. Falling through to the login screen
          // here told a signed-in owner on a bad connection that they were signed
          // out, so they retyped a password that was never the problem -- and
          // burned attempts against the login rate limit doing it.
          setUser(null)
          setBootstrapError('unreachable')
        }
      } finally {
        if (active) setIsLoading(false)
      }
    }
    void restoreSession()
    return () => {
      active = false
    }
  }, [])

  const login = async (email: string, password: string) => {
    const { data } = await api.post<{ accessToken: string; user: User }>('/auth/login', {
      email,
      password,
    })
    clearInsightChatStorage()
    setAccessToken(data.accessToken)
    setTabCafeId(data.user.activeCafeId ?? null)
    setSignedOut(false)
    setUser(data.user)
  }

  const logout = async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      clearAccessToken()
      clearTabCafeId()
      clearInsightChatStorage()
      setSignedOut(true)
      setUser(null)
    }
  }

  const register = async (
    email: string,
    password: string,
    name: string,
    cafeName: string,
    orgName?: string
  ) => {
    const { data } = await api.post<{
      verificationRequired: boolean
      email: string
      message: string
      deliveryMode?: 'email' | 'console' | 'none'
    }>('/auth/register', {
      email,
      password,
      name,
      cafeName,
      ...(orgName ? { orgName } : {}),
    })
    clearInsightChatStorage()
    clearAccessToken()
    clearTabCafeId()
    setUser(null)
    return { email: data.email, message: data.message, deliveryMode: data.deliveryMode }
  }

  const switchCafe = async (cafeId: string) => {
    const { data } = await api.post<{ accessToken: string; activeCafeId: string }>(
      '/team/switch-cafe',
      { cafeId }
    )
    setAccessToken(data.accessToken)
    // This tab now shows the new cafe; other tabs keep theirs (BE-02-T04).
    setTabCafeId(data.activeCafeId)
    window.location.reload()
  }

  const isOwner = user?.role === 'owner'
  const updateCurrentUser = (nextUser: User) => setUser(nextUser)

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isOwner, bootstrapError, signedOut, login, logout, register, switchCafe, updateCurrentUser }}
    >
      {/* A misconfigured build cannot talk to anything, so it is the one case
          that replaces the whole app. A failed bootstrap is NOT — an anonymous
          visitor on /login must still get the login form, so that decision
          belongs to the protected-route guard, which knows whether the page
          being asked for actually needs a session. */}
      {API_CONFIG_ERROR ? (
        <StartupNotice title="Your Guava is not configured" detail={API_CONFIG_ERROR} />
      ) : (
        children
      )}
    </AuthContext.Provider>
  )
}
