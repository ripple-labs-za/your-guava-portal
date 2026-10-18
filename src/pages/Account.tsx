import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import {
  AlertCircle,
  CheckCircle,
  CreditCard,
  KeyRound,
  Pencil,
  Sparkles,
  User as UserIcon,
  WalletCards,
} from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/hooks/useAuth'
import api from '@/lib/api'
import { publishGuavaCredits } from '@/lib/creditEvents'
import { publishBillingAccess } from '@/lib/billingEvents'
import { AccountNotice } from '@/components/account/AccountNotice'
import { paymentOutcome, withoutPaymentParams, type NoticeOptions, type NoticeState, type NoticeTone, type PaymentIntent } from '@/lib/paymentOutcome'
import { billingPageState, billingReadOnlyMessage } from '@/lib/billingAccess'
import { formatPlanChangeDate as formatDate, planChangeSentence, planChangeNotice, pendingChangeSentence, planNameFor, previewFor } from '@/lib/planChange'
import { secureRandomId } from '@/lib/idempotency'
import { gatewayCopy } from '@/lib/billingProvider'
import type { Account, BillingPlan, BillingCycle } from '@/types'

type SaveState = 'idle' | 'saving' | 'success' | 'error'
type CheckoutResponse = { success: boolean; account?: Account; checkout: PaymentIntent }
type CreditPurchaseResponse = { success: boolean; account?: Account; purchase: PaymentIntent & { credits: number } }
type PaymentStatusResponse = { success: boolean; payment: PaymentIntent }

const PAYMENT_POLL_ATTEMPTS = 4
const PAYMENT_POLL_INTERVAL_MS = 4000

const PREPARING_CHECKOUT_MESSAGE =
  'Secure checkout is still being prepared. Nothing has been charged. Try again in a moment — retrying resumes this same payment rather than starting a second one.'

/**
 * HTTP 202 PAYMENT_SESSION_INITIALIZING. The response is a 2xx, so axios
 * resolves it, and it carries an `account` object — which is why the portal
 * mistook it for a completed purchase.
 */
const isStillInitializing = (httpStatus: number | undefined, intent: PaymentIntent) =>
  httpStatus === 202 ||
  intent.status === 'initializing' ||
  intent.initializationStatus === 'initializing'

const NOT_CONFIRMED_MESSAGE =
  'Checkout has not confirmed this payment yet, so nothing has changed. Retrying resumes the same payment; it will not charge twice.'

const formatRand = (value: number) => `R${value.toLocaleString('en-ZA')}`

const CYCLE_UNIT: Record<BillingCycle, string> = { monthly: 'month', annual: 'year' }

const newPaymentIdempotencyKey = (kind: 'plan' | 'credits') => {
  const entropy = secureRandomId()
  return `${kind}:${Date.now().toString(36)}:${entropy}`.slice(0, 160)
}

function StatusBanner({
  state,
  successMessage = 'Account details saved.',
  errorMessage = 'Failed to save account details.',
  messageId,
}: {
  state: SaveState
  successMessage?: string
  errorMessage?: string
  messageId?: string
}) {
  // Settings.tsx's StatusBanner has always carried these roles; this copy had
  // dropped them, so a screen-reader user changing their password submitted and
  // heard nothing at all.
  if (state === 'success') {
    return (
      <div
        role="status"
        id={messageId}
        className="flex items-center gap-2 bg-guava-green/10 border border-guava-green/20 rounded-lg px-3.5 py-2.5 text-sm text-guava-green"
      >
        <CheckCircle className="w-4 h-4 shrink-0" />
        <span>{successMessage}</span>
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div
        role="alert"
        id={messageId}
        className="flex items-center gap-2 bg-red-900/10 border border-red-900/30 rounded-lg px-3.5 py-2.5 text-sm text-red-400"
      >
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>{errorMessage}</span>
      </div>
    )
  }
  return null
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted text-[11px] uppercase tracking-wider font-medium">{label}</p>
      <p className="text-text text-sm font-medium">{value || '—'}</p>
    </div>
  )
}

function UsageMeter({ label, used, total }: { label: string; used: number; total: number }) {
  const hasAllowance = total > 0
  const pct = hasAllowance ? Math.min(100, Math.round((used / total) * 100)) : 0
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">{label}</span>
        {/* A divide-by-zero guard used to leak into this label as a fabricated
            denominator: an account with no allowance read "0 / 1". */}
        <span className="text-text font-medium">
          {hasAllowance ? `${used} / ${total}` : 'No credit allowance on this plan'}
        </span>
      </div>
      <div className="h-2 rounded-full bg-[#111111] border border-border overflow-hidden">
        <div className="h-full bg-guava-red" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function PlanCard({
  plan,
  isCurrentPlan,
  isCurrentCycle,
  cycle,
  onSelect,
  disabled,
  renewable,
  trialing,
}: {
  plan: BillingPlan
  /** The organisation is on this plan tier, whatever the cycle. */
  isCurrentPlan: boolean
  /** The displayed cycle matches the one the organisation is billed on. */
  isCurrentCycle: boolean
  cycle: BillingCycle
  onSelect: () => void
  disabled: boolean
  renewable: boolean
  trialing: boolean
}) {
  const price = cycle === 'annual' ? plan.priceAnnual : plan.priceMonthly
  const includedCredits = plan.includedGuavaCredits ?? plan.includedAiCredits
  // "Active" means this exact plan *and* cycle. Deriving it from the plan id
  // alone disabled the only control that could move a Growth-monthly customer
  // to Growth-annual — the cheaper option the cycle toggle is advertising.
  const active = isCurrentPlan && isCurrentCycle
  const label = active
    ? trialing ? `Choose ${plan.name}` : renewable ? `Renew ${plan.name}` : 'Active plan'
    : isCurrentPlan
      ? `Switch to ${cycle === 'annual' ? 'annual' : 'monthly'}`
      : `Move to ${plan.name}`
  return (
    <div
      className={
        active
          ? 'rounded-lg border border-guava-red bg-guava-red/10 p-4 space-y-4'
          : 'rounded-lg border border-border bg-[#111111] p-4 space-y-4'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-text font-semibold">{plan.name}</h4>
            {isCurrentPlan && <Badge variant="success">Current</Badge>}
          </div>
          <p className="text-muted text-sm mt-1">
            {plan.includedSeats} seats, {plan.includedLocations} locations, {includedCredits} Guava Credits
          </p>
        </div>
        <div className="text-right">
          <p className="text-text font-semibold">{formatRand(price)}</p>
          <p className="text-muted text-xs">{cycle === 'annual' ? 'per year' : 'per month'}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        {plan.features.slice(0, 4).map((feature) => (
          <div key={feature} className="flex items-center gap-2 text-xs text-muted">
            <CheckCircle className="w-3.5 h-3.5 text-guava-green" />
            <span>{feature}</span>
          </div>
        ))}
      </div>
      <Button type="button" variant={active && !renewable ? 'secondary' : 'default'} className="w-full" onClick={onSelect} disabled={disabled || (active && !renewable && !trialing)}>
        {label}
      </Button>
    </div>
  )
}

/**
 * Confirmation for the two money actions on this page. The dialog states the
 * amount and, for a plan, what D-019 does with the current period.
 *
 * The shared Dialog in Team.tsx implements none of the modal behaviour it
 * claims, so this one carries its own: Escape closes it, focus moves in on open
 * and returns to the trigger on close, and Tab is trapped between the two
 * buttons.
 */
function ConfirmDialog({
  open,
  title,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean
  title: string
  confirmLabel: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleId = 'confirm-purchase-title'

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    panel?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.stopPropagation()
        onCancel()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [open, busy, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-6">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-2xl focus-visible:outline-none"
      >
        <h2 id={titleId} className="text-base font-semibold text-text">
          {title}
        </h2>
        <div className="mt-3 space-y-2 text-sm leading-6 text-muted">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={busy}>
            {busy ? 'Opening checkout...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

type PasswordField = 'current' | 'new' | 'confirm'
const PASSWORD_MESSAGE_ID = 'password-change-message'

type PendingPurchase =
  | { kind: 'plan'; plan: BillingPlan; cycle: BillingCycle }
  | { kind: 'credits'; credits: number; price: number }
  | null

export type AccountSettingsSection = 'all' | 'account' | 'billing'

export function AccountSettingsContent({ section = 'all' }: { section?: AccountSettingsSection }) {
  const { user, isOwner, logout, updateCurrentUser } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [account, setAccount] = useState<Account | null>(null)
  const [accountError, setAccountError] = useState(false)
  const [notice, setNotice] = useState<NoticeState>(null)
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly')
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null)
  const [isBuyingCredits, setIsBuyingCredits] = useState(false)
  const [profileName, setProfileName] = useState(user?.name ?? '')
  const [organizationName, setOrganizationName] = useState('')
  const [billingEmail, setBillingEmail] = useState(user?.email ?? '')
  const [profileState, setProfileState] = useState<SaveState>('idle')
  const [profileError, setProfileError] = useState<string | undefined>()
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [pendingPurchase, setPendingPurchase] = useState<PendingPurchase>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordState, setPasswordState] = useState<SaveState>('idle')
  const [passwordError, setPasswordError] = useState<string | undefined>()
  const [invalidPasswordFields, setInvalidPasswordFields] = useState<Set<PasswordField>>(new Set())
  const planCheckoutRef = useRef<{ intent: string; key: string } | null>(null)
  const creditCheckoutRef = useRef<{ intent: string; key: string } | null>(null)
  const paymentQuery = searchParams.toString()

  const noticeTimerRef = useRef<number | null>(null)
  // `persist` keeps a notice on screen. A payment that has not resolved yet is
  // exactly the case where a four-second toast leaves the owner with no record
  // that anything happened — which is what drives a second attempt to pay.
  const showNotice = useCallback((type: NoticeTone, message: string, options?: NoticeOptions) => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current)
      noticeTimerRef.current = null
    }
    setNotice({ type, message, action: options?.action, reference: options?.reference })
    if (!options?.persist) {
      noticeTimerRef.current = window.setTimeout(() => {
        setNotice(null)
        noticeTimerRef.current = null
      }, 4000)
    }
  }, [])

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    },
    []
  )

  const hydrateAccount = useCallback(
    () => api
      .get<{ success: boolean; account: Account }>('/account')
      .then(({ data }) => {
        setAccountError(false)
        setAccount(data.account)
        publishBillingAccess(data.account.organization.billingAccess)
        setBillingCycle(data.account.organization.billingCycle || 'monthly')
        setProfileName(data.account.user.name)
        setOrganizationName(data.account.organization.name)
        setBillingEmail(data.account.organization.billingEmail || data.account.user.email)
      }),
    []
  )

  useEffect(() => {
    hydrateAccount()
      .catch(() => {
        setAccountError(true)
        setProfileName(user?.name ?? '')
        setBillingEmail(user?.email ?? '')
      })
  }, [hydrateAccount, user?.email, user?.name])

  useEffect(() => {
    const paymentHint = searchParams.get('payment')
    const reference = searchParams.get('reference')
    if (!paymentHint || (section !== 'all' && section !== 'billing')) return

    let cancelled = false
    let pollTimer: number | undefined
    let releaseWait: (() => void) | undefined
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        releaseWait = resolve
        pollTimer = window.setTimeout(resolve, ms)
      })

    // Only a settled outcome may erase the reference. Stripping it while the
    // gateway is still working leaves the owner on a page showing their old
    // plan, with no way to re-check what their money did.
    const clearPaymentParams = ({ billingResolved }: { billingResolved: boolean }) => {
      setSearchParams(withoutPaymentParams(searchParams, billingResolved), { replace: true })
    }

    const verifyPayment = async () => {
      if (!reference) {
        showNotice('error', 'Payment could not be verified because its reference is missing.')
        if (!cancelled) clearPaymentParams({ billingResolved: false })
        return
      }

      for (let attempt = 0; attempt < PAYMENT_POLL_ATTEMPTS; attempt += 1) {
        let payment: PaymentIntent | undefined
        try {
          const { data } = await api.get<PaymentStatusResponse>(`/account/payments/${encodeURIComponent(reference)}`)
          if (cancelled) return
          payment = data.payment
        } catch {
          if (cancelled) return
          showNotice(
            'error',
            'Payment status could not be verified. Nothing has been charged twice — refresh and check billing again before retrying.',
            { persist: true }
          )
          return
        }

        const status = payment?.status
        const outcome = paymentOutcome(status, payment?.kind, payment?.planChangeConflict)

        if (outcome.terminal) {
          if (status === 'paid') {
            await hydrateAccount().catch(() => undefined)
            if (cancelled) return
          }
          const keepReference = status === 'needs_attention' || status === 'reversed'
          showNotice(outcome.tone, outcome.message, { persist: keepReference, reference: keepReference ? reference : undefined })
          if (!keepReference) clearPaymentParams({ billingResolved: status === 'paid' })
          return
        }

        // Still settling: say so now, keep the reference, and re-check.
        showNotice(outcome.tone, outcome.message, { persist: true })
        if (attempt === PAYMENT_POLL_ATTEMPTS - 1) return
        await wait(PAYMENT_POLL_INTERVAL_MS)
        if (cancelled) return
      }
    }

    void verifyPayment()
    return () => {
      cancelled = true
      if (pollTimer !== undefined) window.clearTimeout(pollTimer)
      releaseWait?.()
    }
  }, [hydrateAccount, paymentQuery, section, searchParams, setSearchParams, showNotice])

  const handleProfileSave = async (e: FormEvent) => {
    e.preventDefault()
    setProfileState('saving')
    setProfileError(undefined)
    try {
      const profilePayload = isOwner
        ? { name: profileName, organizationName, billingEmail }
        : { name: profileName }
      const { data } = await api.patch<{ success: boolean; account: Account }>('/account/profile', profilePayload)
      setAccount(data.account)
      updateCurrentUser?.(data.account.user)
      setProfileState('success')
      setIsEditingProfile(false)
      setTimeout(() => setProfileState('idle'), 3000)
    } catch (err: unknown) {
      // The owner-only fields here (organisation name, billing email) are the
      // ones the backend has rules about. Swallowing its message left "Failed to
      // save account details." as the only clue across four inputs.
      setProfileError(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message || undefined
      )
      setProfileState('error')
    }
  }

  const handleProfileCancel = () => {
    if (account) {
      setProfileName(account.user.name)
      setOrganizationName(account.organization.name)
      setBillingEmail(account.organization.billingEmail || account.user.email)
    } else {
      setProfileName(user?.name ?? '')
      setOrganizationName('')
      setBillingEmail(user?.email ?? '')
    }
    setProfileState('idle')
    setProfileError(undefined)
    setIsEditingProfile(false)
  }

  const handlePasswordSave = async (e: FormEvent) => {
    e.preventDefault()
    setPasswordError(undefined)

    // Each rule names the fields it is about, so the message in the alert and
    // the aria-invalid marking on the inputs agree with each other.
    const failPassword = (message: string, fields: PasswordField[]) => {
      setPasswordError(message)
      setInvalidPasswordFields(new Set(fields))
      setPasswordState('error')
    }

    const missing: PasswordField[] = [
      ...(currentPassword ? [] : (['current'] as PasswordField[])),
      ...(newPassword ? [] : (['new'] as PasswordField[])),
      ...(confirmPassword ? [] : (['confirm'] as PasswordField[])),
    ]
    if (missing.length > 0) {
      failPassword('Current password, new password, and confirmation are required.', missing)
      return
    }

    if (newPassword.length < 8) {
      failPassword('New password must be at least 8 characters.', ['new'])
      return
    }

    if (newPassword !== confirmPassword) {
      failPassword('New password and confirmation do not match.', ['new', 'confirm'])
      return
    }

    setPasswordState('saving')
    setInvalidPasswordFields(new Set())
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordState('success')
      showNotice('success', 'Password changed. Please sign in again.')
      await logout()
    } catch (err: any) {
      // Only the current password can be rejected server-side here.
      failPassword(err?.response?.data?.message || 'Failed to change password.', ['current'])
    }
  }

  const displayName = account?.user.name || user?.name || ''
  const displayEmail = account?.user.email || user?.email || ''
  const displayOrgName = account?.organization.name || ''
  const displayBillingEmail = account?.organization.billingEmail || displayEmail

  const handlePlanCheckout = async (plan: BillingPlan) => {
    setCheckoutPlan(plan.id)
    const intent = `${plan.id}:${billingCycle}`
    if (planCheckoutRef.current?.intent !== intent) {
      planCheckoutRef.current = { intent, key: newPaymentIdempotencyKey('plan') }
    }
    const idempotencyKey = planCheckoutRef.current.key
    try {
      const response = await api.post<CheckoutResponse>('/account/checkout', {
        plan: plan.id,
        billingCycle,
      }, {
        headers: { 'Idempotency-Key': idempotencyKey },
      })
      const { data } = response

      if (data.checkout.redirectUrl) {
        showNotice('success', 'Opening secure card checkout...')
        window.location.assign(data.checkout.redirectUrl)
        return
      }

      if (isStillInitializing(response.status, data.checkout)) {
        // Deliberately before the `data.account` branch: a 202 carries the
        // account payload too, and it is the account *as it was*. Reading it as
        // proof of success told the owner "Growth plan activated" while the
        // gateway session did not yet exist. Keep the idempotency key so a
        // retry resumes this session rather than opening a second one.
        showNotice('info', PREPARING_CHECKOUT_MESSAGE, { persist: true })
        return
      }

      if (data.account && data.checkout.status === 'paid') {
        setAccount(data.account)
        publishBillingAccess(data.account.organization.billingAccess)
        planCheckoutRef.current = null
        showNotice('success', data.checkout.planChange
          ? planChangeNotice(data.checkout.planChange, plan.name)
          : `${plan.name} payment confirmed.`)
      } else if (data.account) {
        setAccount(data.account)
        showNotice('info', NOT_CONFIRMED_MESSAGE, { persist: true })
      } else {
        showNotice('error', 'Secure checkout is still being prepared. Try again in a moment.')
      }
    } catch (err: any) {
      if (err?.response && err.response.status < 500 && err.response.status !== 408 && err.response.status !== 429) {
        planCheckoutRef.current = null
      }
      // checkout answers 409 { code: 'PLAN_LIMIT_EXCEEDED', message, capacity } at the top level of the body; the fix lives on Team.
      if (err?.response?.data?.code === 'PLAN_CHANGE_ALREADY_SCHEDULED') {
        const pending = err.response.data.pendingPlanChange
        if (pending) setAccount((current) => current ? { ...current, organization: { ...current.organization, pendingPlanChange: pending } } : current)
        else await hydrateAccount().catch(() => undefined)
        showNotice('info', 'A paid plan change is already scheduled. Its details are shown below.', { persist: true })
        return
      }
      if (err?.response?.data?.code === 'PLAN_LIMIT_EXCEEDED') {
        showNotice('error', err.response.data.message, { persist: true, action: { label: 'Open Team', to: '/team' } })
        return
      }
      showNotice('error', billingReadOnlyMessage(err) || err?.response?.data?.message || 'Could not start card checkout.')
    } finally {
      setCheckoutPlan(null)
    }
  }

  const handleBuyCredits = async (packCredits: number) => {
    setIsBuyingCredits(true)
    const intent = `credits:${packCredits}`
    if (creditCheckoutRef.current?.intent !== intent) {
      creditCheckoutRef.current = { intent, key: newPaymentIdempotencyKey('credits') }
    }
    const idempotencyKey = creditCheckoutRef.current.key
    try {
      const response = await api.post<CreditPurchaseResponse>(
        '/account/ai-credits',
        { credits: packCredits },
        { headers: { 'Idempotency-Key': idempotencyKey } }
      )
      const { data } = response

      if (data.purchase.redirectUrl) {
        showNotice('success', 'Opening secure card checkout...')
        window.location.assign(data.purchase.redirectUrl)
        return
      }

      if (isStillInitializing(response.status, data.purchase)) {
        showNotice('info', PREPARING_CHECKOUT_MESSAGE, { persist: true })
        return
      }

      if (data.account && data.purchase.status === 'paid') {
        setAccount(data.account)
        // The toolbar caches the credit balance for 30s, so without this the
        // header still shows the pre-purchase figure while this page shows the
        // new one — the same number disagreeing with itself on one screen.
        publishGuavaCredits(data.account.usage?.guavaCredits ?? data.account.usage?.aiCredits)
        creditCheckoutRef.current = null
        showNotice('success', `Added ${packCredits.toLocaleString('en-ZA')} Guava Credits to this billing period.`)
      } else if (data.account) {
        setAccount(data.account)
        showNotice('info', NOT_CONFIRMED_MESSAGE, { persist: true })
      } else {
        showNotice('error', 'Secure checkout is still being prepared. Try again in a moment.')
      }
    } catch (err: any) {
      if (err?.response && err.response.status < 500 && err.response.status !== 408 && err.response.status !== 429) {
        creditCheckoutRef.current = null
      }
      showNotice('error', billingReadOnlyMessage(err) || err?.response?.data?.message || 'Could not start card checkout.')
    } finally {
      setIsBuyingCredits(false)
    }
  }

  const selectedPlan = account?.organization.plan || 'starter'
  const currentCycle: BillingCycle = account?.organization.billingCycle || 'monthly'
  const planChanges = account?.planChanges ?? []
  const pendingPlanChange = account?.organization.pendingPlanChange ?? null
  const currentPlanName = planNameFor(account?.plans, selectedPlan)
  const pendingNotice = pendingPlanChange
    ? pendingChangeSentence(pendingPlanChange, currentPlanName, planNameFor(account?.plans, pendingPlanChange.plan), isOwner)
    : null
  const { access, renewable, trialing, periodSummary, graceHeading, graceDetail, statusLabel } = billingPageState(account?.organization, isOwner)

  // Read through the router hook so it reacts when the flag is cleared after a
  // successful payment; the raw window.location read never did.
  const billingRequired = searchParams.get('billing') === 'required'
  const credits = account?.usage.guavaCredits ?? account?.usage.aiCredits
  const creditTotal = credits ? credits.included + credits.bonus : 0
  // Pack sizes offered by the organisation's current plan.
  const currentPlanPacks =
    (account?.plans || []).find((plan) => plan.id === account?.organization?.plan)?.creditPackOptions ?? []
  const creditLedger = account?.usage.creditLedger
  const showAccountSection = section === 'all' || section === 'account'
  const showBillingSection = section === 'all' || section === 'billing'

  const confirmPurchaseLabel = (() => {
    if (!pendingPurchase) return 'Confirm'
    const amount =
      pendingPurchase.kind === 'plan'
        ? pendingPurchase.cycle === 'annual'
          ? pendingPurchase.plan.priceAnnual
          : pendingPurchase.plan.priceMonthly
        : pendingPurchase.price
    return amount > 0 ? `Confirm and pay ${formatRand(amount)}` : 'Confirm and pay at checkout'
  })()

  // The cafe switcher in the sidebar calls window.location.reload(), so an
  // owner half-way through retyping their organisation details can lose the lot
  // to one click. Only beforeunload can intercept that.
  const isProfileDirty =
    isEditingProfile &&
    Boolean(
      account &&
        (profileName !== account.user.name ||
          (isOwner &&
            (organizationName !== account.organization.name ||
              billingEmail !== (account.organization.billingEmail || account.user.email))))
    )

  useEffect(() => {
    if (!isProfileDirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isProfileDirty])

  return (
      <div className="space-y-6">
        <AccountNotice notice={notice} onDismiss={() => {
          setNotice(null)
          setSearchParams(withoutPaymentParams(searchParams), { replace: true })
        }} />
        {accountError && (
          <div className="flex flex-col gap-3 rounded-lg border border-red-900/30 bg-red-900/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <p className="text-sm text-red-300">Account and billing details could not be loaded.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => hydrateAccount().catch(() => setAccountError(true))}>
              Try again
            </Button>
          </div>
        )}

        {showAccountSection && <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <UserIcon className="w-4 h-4 text-guava-red-text" />
                  <CardTitle>Account Details</CardTitle>
                </div>
                <CardDescription className="mt-1">
                  {isOwner
                    ? 'Manage your profile, organisation name, and billing contact.'
                    : 'Manage your profile. Organisation billing is managed by the account owner.'}
                </CardDescription>
              </div>
              {!isEditingProfile && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditingProfile(true)}
                  disabled={!account}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isEditingProfile ? (
              <form onSubmit={handleProfileSave} className="space-y-4 max-w-3xl">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-name">Full Name</Label>
                    <Input id="profile-name" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-email">Email Address</Label>
                    <Input id="profile-email" value={displayEmail} readOnly className="opacity-60 cursor-default" />
                  </div>
                </div>
                {isOwner && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="organization-name">Organisation Name</Label>
                      <Input id="organization-name" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="billing-email">Billing Email</Label>
                      <Input id="billing-email" type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} />
                      <p className="text-xs text-muted-foreground">Checkout and receipts go to this address.</p>
                    </div>
                  </div>
                )}
                <StatusBanner state={profileState} errorMessage={profileError || 'Failed to save account details.'} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={profileState === 'saving'}>
                    <CheckCircle className="w-3.5 h-3.5" />
                    {profileState === 'saving' ? 'Saving...' : 'Save Account'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleProfileCancel}
                    disabled={profileState === 'saving'}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-5 max-w-3xl">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                  <ReadOnlyField label="Full Name" value={displayName} />
                  <ReadOnlyField label="Email Address" value={displayEmail} />
                  <ReadOnlyField label="Organisation Name" value={displayOrgName} />
                  {isOwner && <ReadOnlyField label="Billing Email" value={displayBillingEmail} />}
                </div>
                <StatusBanner state={profileState} errorMessage={profileError || 'Failed to save account details.'} />
              </div>
            )}
          </CardContent>
        </Card>}

        {showAccountSection && <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-guava-red-text" />
              <CardTitle>Password</CardTitle>
            </div>
            <CardDescription className="mt-1">
              Change your password and sign in again with the new one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSave} className="space-y-4 max-w-3xl">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="current-password">Current Password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    aria-invalid={invalidPasswordFields.has('current') || undefined}
                    aria-describedby={passwordState === 'error' ? PASSWORD_MESSAGE_ID : undefined}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    aria-invalid={invalidPasswordFields.has('new') || undefined}
                    aria-describedby={passwordState === 'error' ? PASSWORD_MESSAGE_ID : undefined}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    aria-invalid={invalidPasswordFields.has('confirm') || undefined}
                    aria-describedby={passwordState === 'error' ? PASSWORD_MESSAGE_ID : undefined}
                  />
                </div>
              </div>
              <StatusBanner
                state={passwordState}
                messageId={PASSWORD_MESSAGE_ID}
                successMessage="Password changed."
                errorMessage={passwordError || 'Failed to change password.'}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={passwordState === 'saving'}>
                  <KeyRound className="w-3.5 h-3.5" />
                  {passwordState === 'saving' ? 'Changing...' : 'Change Password'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>}

        {/* Arrived here from a 402 on some other page: say why, so landing on
            Billing without warning does not read as a random redirect. */}
        {showBillingSection && billingRequired && access?.status !== 'grace' && (
          <div
            role="alert"
            className="rounded-lg border border-guava-red/30 bg-guava-red/10 px-4 py-3"
          >
            <p className="text-sm font-medium text-text">Your billing period has ended</p>
            <p className="mt-1 text-sm text-muted">
              Forecasts, analytics and imports are paused until payment is up to date.
              Your data is safe and returns as soon as billing resumes.
            </p>
          </div>
        )}

        {showBillingSection && access?.status === 'grace' && (
          <div role="alert" className="rounded-lg border border-guava-red/30 bg-guava-red/10 px-4 py-3">
            <p className="text-sm font-medium text-text">{graceHeading}</p>
            <p className="mt-1 text-sm text-muted">{graceDetail}</p>
          </div>
        )}
        {showBillingSection && <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <WalletCards className="w-4 h-4 text-guava-red-text" />
                  <CardTitle>Billing and Usage</CardTitle>
                </div>
                <CardDescription className="mt-1">
                  Plans are priced around organisation seats, cafe locations, and Guava Credits.
                </CardDescription>
                {periodSummary && <p className="text-muted text-xs mt-1">{periodSummary}</p>}
              </div>
              {account && (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="success">{statusLabel}</Badge>
                  <Badge variant="secondary">{account.organization.plan} plan</Badge>
                  {isOwner && account.organization.paymentMethod && (
                    <Badge variant="outline">
                      {account.organization.paymentMethod.brand} ending {account.organization.paymentMethod.last4}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-lg border border-border bg-[#111111] p-4">
                <p className="text-muted text-sm">Seats</p>
                <p className="text-text text-2xl font-semibold mt-2">
                  {account ? `${account.usage.seats.used}/${account.usage.seats.included}` : '—'}
                </p>
                <p className="text-muted text-xs mt-1">
                  {account?.usage.seats.pending
                    ? `${account.usage.seats.active ?? 0} active, ${account.usage.seats.pending} invited`
                    : 'Active organisation users'}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-[#111111] p-4">
                <p className="text-muted text-sm">Locations</p>
                <p className="text-text text-2xl font-semibold mt-2">
                  {account ? `${account.usage.locations.used}/${account.usage.locations.included}` : '—'}
                </p>
                <p className="text-muted text-xs mt-1">Cafe branches</p>
              </div>
              <div className="rounded-lg border border-border bg-[#111111] p-4">
                <p className="text-muted text-sm">Guava Credits</p>
                <p className="text-text text-2xl font-semibold mt-2">{account ? credits?.available ?? 0 : '—'}</p>
                <p className="text-muted text-xs mt-1">Power AI and data checks</p>
              </div>
            </div>

            <UsageMeter label="Guava Credit usage this period" used={credits?.used ?? 0} total={creditTotal} />
            <div className="flex flex-wrap gap-2">
              {/* The plan offers several pack sizes at different rates; the UI
                  previously hard-coded the smallest, so larger, better-value
                  packs were unreachable. */}
              {(currentPlanPacks.length > 0
                ? currentPlanPacks
                : [{ credits: 500, price: 0 }]
              ).map((pack) => (
                <Button
                  key={pack.credits}
                  type="button"
                  variant="secondary"
                  onClick={() => setPendingPurchase({ kind: 'credits', credits: pack.credits, price: pack.price })}
                  disabled={!isOwner || isBuyingCredits || Boolean(access?.readOnly)}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isBuyingCredits
                    ? 'Opening checkout...'
                    : `${pack.credits.toLocaleString('en-ZA')} credits${pack.price ? ` · ${formatRand(pack.price)}` : ''}`}
                </Button>
              ))}
              <p className="text-muted text-xs flex items-center">
                Included credits reset on {formatDate(credits?.resetAt)}. Bonus credits stay until used.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-[#111111] p-4">
                <h3 className="text-sm font-semibold text-text">Credit usage by feature</h3>
                <div className="mt-3 space-y-2">
                  {(creditLedger?.byFeature || []).length === 0 ? (
                    <p className="text-sm text-muted">No metered usage yet this period.</p>
                  ) : (
                    creditLedger?.byFeature.map((row) => (
                      <div key={row.featureKey} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-muted">{row.label}</span>
                        <span className="font-semibold text-text">{row.credits}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-[#111111] p-4">
                <h3 className="text-sm font-semibold text-text">Recent credit activity</h3>
                <div className="mt-3 space-y-2">
                  {(creditLedger?.recent || []).length === 0 ? (
                    <p className="text-sm text-muted">Credit activity will appear here as AI tools run.</p>
                  ) : (
                    creditLedger?.recent.slice(0, 5).map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate text-muted">{entry.label}</span>
                          <span className="block text-xs text-muted">{formatDate(entry.createdAt)}</span>
                        </span>
                        <span className="font-semibold text-text">{entry.credits}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-text font-semibold">Plans and card checkout</h3>
                <p className="text-muted text-sm">Pay securely by card through hosted checkout.</p>
              </div>
              <div className="inline-flex rounded-lg border border-border bg-[#111111] p-1 w-fit">
                {(['monthly', 'annual'] as const).map((cycle) => (
                  <button
                    key={cycle}
                    type="button"
                    onClick={() => setBillingCycle(cycle)}
                    className={
                      billingCycle === cycle
                        ? 'px-3 py-1.5 rounded-md bg-guava-red text-white text-xs font-medium'
                        : 'px-3 py-1.5 rounded-md text-muted text-xs font-medium hover:text-text'
                    }
                  >
                    {cycle === 'annual' ? 'Annual' : 'Monthly'}
                  </button>
                ))}
              </div>
            </div>

            {pendingNotice && (
              <div role="status" className="rounded-lg border border-border bg-[#111111] px-4 py-3 text-sm">
                <p className="font-medium text-text">
                  {pendingNotice.title}
                </p>
                <p className="mt-1 text-muted">
                  {pendingNotice.body}
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              {(isOwner ? account?.plans || [] : []).map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  isCurrentPlan={selectedPlan === plan.id}
                  isCurrentCycle={currentCycle === billingCycle}
                  cycle={billingCycle}
                  renewable={renewable}
                  trialing={trialing}
                  onSelect={() => setPendingPurchase({ kind: 'plan', plan, cycle: billingCycle })}
                  // Every card, not just the one in flight. Disabling only the
                  // clicked card let a second click on a different plan mint a
                  // fresh idempotency key and open a second live PaymentSession.
                  disabled={!isOwner || checkoutPlan !== null || pendingPlanChange !== null}
                />
              ))}
            </div>
            {!isOwner && <p className="text-muted text-xs">Only the account owner can change billing.</p>}
          </CardContent>
        </Card>}

        <ConfirmDialog
          open={pendingPurchase !== null}
          title={pendingPurchase?.kind === 'credits' ? 'Confirm credit purchase' : 'Confirm plan change'}
          confirmLabel={confirmPurchaseLabel}
          busy={checkoutPlan !== null || isBuyingCredits}
          onCancel={() => setPendingPurchase(null)}
          onConfirm={() => {
            const purchase = pendingPurchase
            setPendingPurchase(null)
            if (!purchase) return
            if (purchase.kind === 'plan') void handlePlanCheckout(purchase.plan)
            else void handleBuyCredits(purchase.credits)
          }}
        >
          {pendingPurchase?.kind === 'plan' && (
            <>
              <p>
                Move to <span className="font-medium text-text">{pendingPurchase.plan.name}</span>, billed{' '}
                {pendingPurchase.cycle === 'annual' ? 'annually' : 'monthly'}.
              </p>
              <p>
                You will be charged{' '}
                <span className="font-medium text-text">
                  {formatRand(pendingPurchase.cycle === 'annual' ? pendingPurchase.plan.priceAnnual : pendingPurchase.plan.priceMonthly)}
                </span>{' '}
                now for one {CYCLE_UNIT[pendingPurchase.cycle]}. Nothing renews automatically; renew here before the period ends.
              </p>
              <p>
                {planChangeSentence(previewFor(planChanges, pendingPurchase.plan.id, pendingPurchase.cycle), pendingPurchase.plan.name, {
                  name: currentPlanName,
                  cycle: currentCycle,
                })}
              </p>
              <p>
                {pendingPurchase.plan.name} includes {pendingPurchase.plan.includedSeats} seats,{' '}
                {pendingPurchase.plan.includedLocations} locations and{' '}
                {pendingPurchase.plan.includedGuavaCredits ?? pendingPurchase.plan.includedAiCredits} Guava Credits.
              </p>
            </>
          )}
          {pendingPurchase?.kind === 'credits' && (
            <>
              <p>
                Add{' '}
                <span className="font-medium text-text">
                  {pendingPurchase.credits.toLocaleString('en-ZA')} Guava Credits
                </span>{' '}
                to this billing period.
              </p>
              <p>
                {pendingPurchase.price > 0 ? (
                  <>
                    You will be charged{' '}
                    <span className="font-medium text-text">{formatRand(pendingPurchase.price)}</span> now. This is a
                    one-off purchase, not a change to your plan.
                  </>
                ) : (
                  <>This pack has no price configured. You will be charged the amount shown at checkout.</>
                )}
              </p>
              <p>Purchased credits are non-refundable, and stay on the account until they are used.</p>
            </>
          )}
        </ConfirmDialog>

        {showBillingSection && <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-guava-green" />
              <CardTitle>Payment Gateway</CardTitle>
            </div>
            <CardDescription>
              {gatewayCopy(account?.billing?.provider)}
            </CardDescription>
          </CardHeader>
        </Card>}
      </div>
  )
}

export default function AccountPage() {
  return (
    <AppLayout title="Account">
      <AccountSettingsContent />
    </AppLayout>
  )
}
