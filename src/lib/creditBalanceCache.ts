import type { BillingAccess } from '@/types'

export interface CreditBalance {
  credits: { included: number; bonus: number; used: number; available: number; resetAt: string | null }
  organization: {
    billingAccess?: BillingAccess
    plan: 'starter' | 'growth' | 'pro'
    billingStatus?: 'trialing' | 'active' | 'past_due' | 'canceled'
    billingCycle?: 'monthly' | 'annual'
  }
  plan: { id: 'starter' | 'growth' | 'pro'; name: string; includedGuavaCredits: number }
}

const CREDIT_CACHE_TTL_MS = 30000
let cache: { orgId: string | null; data: CreditBalance; fetchedAt: number } | null = null
export function cachedCreditBalance(orgId: string | null): CreditBalance | null {
  return cache?.orgId === orgId && Date.now() - cache.fetchedAt < CREDIT_CACHE_TTL_MS ? cache.data : null
}
export function cacheCreditBalance(orgId: string | null, data: CreditBalance): void {
  cache = { orgId, data, fetchedAt: Date.now() }
}
export function clearCreditBalanceCache(): void { cache = null }
