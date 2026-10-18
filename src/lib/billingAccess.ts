import type { Organization } from '@/types'
import { formatBillingDate } from './date'

const RENEWAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function billingPageState(organization: Organization | undefined, isOwner: boolean, now = Date.now()) {
  const access = organization?.billingAccess
  const paidThrough = organization?.pendingPlanChange?.periodEnd ?? organization?.currentPeriodEnd ?? null
  const trialing = organization?.billingStatus === 'trialing'
  const renewable = access?.allowed === false || (paidThrough !== null && new Date(paidThrough).getTime() - now <= RENEWAL_WINDOW_MS)
  const periodSummary = !organization || access?.status === 'grace' ? null
    : trialing && organization.trialEndsAt ? `Trial ends ${formatBillingDate(organization.trialEndsAt)}`
      : organization.billingStatus === 'active' && paidThrough
        ? `Paid until ${formatBillingDate(paidThrough)}. Nothing renews automatically; Guava emails the owner 7 days and 1 day before.` : null
  const graceHeading = access?.status === 'grace'
    ? `Your ${access.reason === 'trial_expired' ? 'free trial' : 'plan'} ended on ${formatBillingDate(access.periodEnd)}. Guava is read-only until ${formatBillingDate(access.graceEndsAt)}.`
    : null
  const graceDetail = `You can still view forecasts, analytics and history. Imports, edits and AI tools are paused. ${isOwner ? 'Choose a plan below to restore everything.' : 'Ask the account owner to renew.'}`
  const statusLabel = access?.status === 'grace' ? 'Read-only'
    : ({ trialing: 'Free trial', active: 'Active', past_due: 'Payment required', canceled: 'Cancelled' }[organization?.billingStatus || 'trialing'])
  return { access, renewable, trialing, periodSummary, graceHeading, graceDetail, statusLabel }
}

export function billingToolbarCopy(until: string, isOwner: boolean) {
  return `Read-only until ${formatBillingDate(until)}. ${isOwner ? 'Open billing to renew' : 'Ask the account owner to renew'}`
}

/** Accept both middleware billing bodies and metering's details envelope. */
export function billingReadOnlyMessage(error: unknown): string | null {
  const outer = error as { response?: { data?: unknown }; billing?: unknown; details?: unknown } | null
  const body = (outer?.response?.data ?? outer) as {
    billing?: { readOnly?: boolean; status?: string; billingStatus?: string; graceEndsAt?: string | null }
    details?: { readOnly?: boolean; status?: string; billingStatus?: string; graceEndsAt?: string | null }
    readOnly?: boolean; status?: string; billingStatus?: string; graceEndsAt?: string | null
  } | null
  const billing = body?.billing ?? body?.details ?? body
  if (!billing || !(billing.readOnly || billing.status === 'grace' || billing.billingStatus === 'grace')) return null
  const date = formatBillingDate(billing.graceEndsAt)
  return date === '-' ? 'Guava is read-only. Renew in Billing.' : `Read-only until ${date}. Renew in Billing.`
}
