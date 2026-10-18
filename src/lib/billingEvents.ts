import type { BillingAccess } from '@/types'
import { clearCreditBalanceCache } from './creditBalanceCache'

export interface BillingReadOnlyDetail {
  periodEnd: string | null
  graceEndsAt: string | null
}
export const GUAVA_BILLING_READ_ONLY_EVENT = 'guava:billing-read-only'
export function publishBillingReadOnly(detail: BillingReadOnlyDetail): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(GUAVA_BILLING_READ_ONLY_EVENT, { detail }))
}
export function publishBillingAccess(access?: BillingAccess): void {
  if (access?.allowed) clearCreditBalanceCache()
  if (access?.allowed || access?.readOnly) publishBillingReadOnly({
    periodEnd: access.periodEnd,
    graceEndsAt: access.readOnly ? access.graceEndsAt ?? null : null,
  })
}
