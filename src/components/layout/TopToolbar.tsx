import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Bell,
  ChevronDown,
  Loader2,
  LogOut,
  Lock,
  WalletCards,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import api from '@/lib/api'
import { GUAVA_BILLING_READ_ONLY_EVENT, type BillingReadOnlyDetail } from '@/lib/billingEvents'
import type { BillingAccess } from '@/types'
import {
  GUAVA_CREDITS_UPDATED_EVENT,
  type GuavaCreditSnapshot,
} from '@/lib/creditEvents'
import { cn } from '@/lib/utils'

interface CreditBalance {
  credits: {
    included: number
    bonus: number
    used: number
    available: number
    resetAt: string | null
  }
  organization: {
    billingAccess?: BillingAccess
    plan: 'starter' | 'growth' | 'pro'
    billingStatus?: 'trialing' | 'active' | 'past_due' | 'canceled'
    billingCycle?: 'monthly' | 'annual'
  }
  plan: {
    id: 'starter' | 'growth' | 'pro'
    name: string
    includedGuavaCredits: number
  }
}

type OpenMenu = 'notifications' | 'user' | null
const CREDIT_CACHE_TTL_MS = 30000
const USE_CREDIT_CACHE = import.meta.env.MODE !== 'test'
let creditBalanceCache: { orgId: string | null; data: CreditBalance; fetchedAt: number } | null = null

const formatCompactNumber = (value?: number) => {
  if (typeof value !== 'number') return '...'
  return value.toLocaleString('en-ZA')
}

const initialsFor = (name?: string | null, email?: string | null) => {
  const source = (name || email || 'User').trim()
  const words = source.includes('@') ? [source[0]] : source.split(/\s+/)
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('')
}

export function TopToolbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const latestCreditSnapshotRef = useRef<GuavaCreditSnapshot | null>(null)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [credits, setCredits] = useState<CreditBalance | null>(null)
  const [readOnlyOverride, setReadOnlyOverride] = useState<BillingReadOnlyDetail | null>(null)

  useEffect(() => {
    const update = (event: Event) => setReadOnlyOverride((event as CustomEvent<BillingReadOnlyDetail>).detail)
    window.addEventListener(GUAVA_BILLING_READ_ONLY_EVENT, update)
    return () => window.removeEventListener(GUAVA_BILLING_READ_ONLY_EVENT, update)
  }, [])
  const [creditSnapshotOverride, setCreditSnapshotOverride] = useState<GuavaCreditSnapshot | null>(null)
  const [creditsLoading, setCreditsLoading] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    latestCreditSnapshotRef.current = null
    setReadOnlyOverride(null)
    setCreditSnapshotOverride(null)
    if (!user) {
      setCredits(null)
      return
    }
    let cancelled = false
    const orgId = user.orgId || null

    if (
      USE_CREDIT_CACHE &&
      creditBalanceCache &&
      creditBalanceCache.orgId === orgId &&
      Date.now() - creditBalanceCache.fetchedAt < CREDIT_CACHE_TTL_MS
    ) {
      setCredits(creditBalanceCache.data)
      setCreditsLoading(false)
      return
    }

    setCreditsLoading(true)
    api
      .get<CreditBalance>('/account/credits')
      .then(({ data }) => {
        const latestSnapshot = latestCreditSnapshotRef.current
        const resolvedData = latestSnapshot
          ? {
              ...data,
              credits: {
                ...data.credits,
                ...latestSnapshot,
              },
            }
          : data
        if (USE_CREDIT_CACHE) {
          creditBalanceCache = { orgId, data: resolvedData, fetchedAt: Date.now() }
        }
        if (!cancelled) setCredits(resolvedData)
      })
      .catch(() => {
        if (!cancelled) setCredits(null)
      })
      .finally(() => {
        if (!cancelled) setCreditsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [user?.orgId])

  useEffect(() => {
    const updateCredits = (event: Event) => {
      const snapshot = (event as CustomEvent<GuavaCreditSnapshot>).detail
      if (!snapshot) return
      creditBalanceCache = null
      latestCreditSnapshotRef.current = snapshot
      setCreditSnapshotOverride(snapshot)
      setCredits((current) => {
        if (!current) return current
        return {
          ...current,
          credits: {
            ...current.credits,
            ...snapshot,
          },
        }
      })
    }

    window.addEventListener(GUAVA_CREDITS_UPDATED_EVENT, updateCredits)
    return () => window.removeEventListener(GUAVA_CREDITS_UPDATED_EVENT, updateCredits)
  }, [])

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) {
        setOpenMenu(null)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null)
    }

    document.addEventListener('mousedown', closeMenus)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeMenus)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const goTo = (path: string) => {
    setOpenMenu(null)
    navigate(path)
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await logout()
      navigate('/login')
    } finally {
      setLoggingOut(false)
      setOpenMenu(null)
    }
  }

  const availableCredits = creditSnapshotOverride?.available ?? credits?.credits?.available
  const access = credits?.organization?.billingAccess
  const readOnlyUntil = readOnlyOverride ? readOnlyOverride.graceEndsAt : access?.status === 'grace' ? access.graceEndsAt : null
  const shortDate = (value: string) => new Date(value).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
  const lowCredits = typeof availableCredits === 'number' && availableCredits <= 100
  const notificationCount = lowCredits ? 1 : 0
  const initials = initialsFor(user?.name, user?.email)

  return (
    <div ref={toolbarRef} className="flex min-w-0 items-center justify-end gap-2">
      {readOnlyUntil && (
        <button type="button" onClick={() => goTo('/settings?section=billing')}
          className="flex h-8 items-center gap-2 rounded-lg border border-guava-red/40 bg-guava-red/10 px-2 text-xs font-semibold text-guava-red-text sm:px-3"
          aria-label={`Read-only until ${shortDate(readOnlyUntil)}. Open billing to renew`}>
          <Lock className="h-4 w-4" /><span className="hidden sm:inline">Read-only until</span><span>{shortDate(readOnlyUntil)}</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => goTo('/settings?section=billing')}
        className={cn(
          'flex h-8 items-center gap-2 rounded-lg border px-2 text-xs font-semibold transition-colors sm:px-3',
          lowCredits
            ? 'border-guava-red/40 bg-guava-red/10 text-guava-red-text hover:bg-guava-red/15'
            : 'border-border bg-[#111111] text-text hover:border-[#3A3A3A] hover:bg-white/5'
        )}
        aria-label="Guava credits balance"
        title="Guava credits balance"
      >
        <WalletCards className="h-4 w-4 text-guava-green" />
        <span className="hidden text-muted md:inline">Credits</span>
        <span>{creditsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : formatCompactNumber(availableCredits)}</span>
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpenMenu(openMenu === 'notifications' ? null : 'notifications')}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-[#111111] text-muted transition-colors hover:border-[#3A3A3A] hover:bg-white/5 hover:text-text"
          aria-label="Notifications"
          aria-expanded={openMenu === 'notifications'}
        >
          <Bell className="h-4 w-4" />
          {notificationCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-guava-red px-1 text-[10px] font-bold text-white">
              {notificationCount}
            </span>
          )}
        </button>

        {openMenu === 'notifications' && (
          <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-text">Notifications</p>
              <p className="text-xs text-muted">Account, usage, and data health alerts</p>
            </div>
            <div className="p-2">
              {lowCredits ? (
                <button
                  type="button"
                  onClick={() => goTo('/settings?section=billing')}
                  className="w-full rounded-lg border border-guava-red/30 bg-guava-red/10 p-3 text-left transition-colors hover:bg-guava-red/15"
                >
                  <p className="text-sm font-semibold text-guava-red-text">Credits running low</p>
                  <p className="mt-1 text-xs text-muted">
                    {formatCompactNumber(availableCredits)} Guava Credits available. Add credits before AI checks pause.
                  </p>
                </button>
              ) : (
                <div className="rounded-lg border border-border bg-[#111111] p-3">
                  <p className="text-sm font-semibold text-text">No unread notifications</p>
                  <p className="mt-1 text-xs text-muted">Usage, payment, and data health alerts will appear here.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpenMenu(openMenu === 'user' ? null : 'user')}
          className="flex h-8 items-center gap-2 rounded-lg border border-border bg-[#111111] py-1 pl-1 pr-2 text-sm text-text transition-colors hover:border-[#3A3A3A] hover:bg-white/5"
          aria-label="Open user menu"
          aria-expanded={openMenu === 'user'}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-guava-red/15 text-xs font-bold text-guava-red-text">
            {initials}
          </span>
          <ChevronDown className="hidden h-3.5 w-3.5 text-muted sm:block" />
        </button>

        {openMenu === 'user' && (
          <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
            <div className="border-b border-border px-4 py-3">
              <p className="truncate text-sm font-semibold text-text">{user?.name || 'Your Guava user'}</p>
              <p className="truncate text-xs text-muted">{user?.email}</p>
            </div>

            <div className="p-2">
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-white/5 hover:text-text disabled:opacity-60"
              >
                {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
