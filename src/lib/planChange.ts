import type { BillingCycle, PendingPlanChange, PlanChangePreview } from '@/types'
import { formatBillingDate } from './date'

export const formatPlanChangeDate = formatBillingDate

/** D-019, in the words the owner reads before paying. The server decided; this only phrases it. */
export function planChangeSentence(
  preview: PlanChangePreview | undefined,
  planName: string,
  current: { name: string; cycle: BillingCycle }
): string {
  if (!preview) return 'What this does to your current period is confirmed at checkout.'
  switch (preview.type) {
    case 'upgrade': {
      const credited = preview.creditDays > 0
        ? ` The unused part of your current plan is credited as about ${preview.creditDays} extra ${preview.creditDays === 1 ? 'day' : 'days'}.`
        : ''
      return `Starts today.${credited} ${planName} runs until ${formatPlanChangeDate(preview.periodEnd)}.`
    }
    case 'downgrade':
    case 'cycle_switch':
      return `Takes effect on ${formatPlanChangeDate(preview.effectiveAt)}, when your current ${current.name} (${current.cycle}) period ends. You keep ${current.name} until then; ${planName} then runs until ${formatPlanChangeDate(preview.periodEnd)}.`
    case 'renewal':
      return `Extends your current plan: paid until ${formatPlanChangeDate(preview.periodEnd)}.`
    default:
      return `Starts today and runs until ${formatPlanChangeDate(preview.periodEnd)}.`
  }
}

export const planNameFor = (plans: Array<{ id: string; name: string }> | undefined, planId: string) =>
  plans?.find((plan) => plan.id === planId)?.name ?? (planId.charAt(0).toUpperCase() + planId.slice(1))

export const previewFor = (changes: PlanChangePreview[] | undefined, planId: string, cycle: BillingCycle) =>
  changes?.find((change) => change.plan === planId && change.billingCycle === cycle)

export function planChangeNotice(change: Omit<PlanChangePreview, 'blocked'> | null | undefined, planName: string): string {
  if (change && (change.type === 'downgrade' || change.type === 'cycle_switch')) {
    return `${planName} (${change.billingCycle}) is paid for and takes effect on ${formatBillingDate(change.effectiveAt)}.`
  }
  if (change?.type === 'upgrade' && change.creditDays > 0) {
    return `${planName} plan activated, with ${change.creditDays} extra ${change.creditDays === 1 ? 'day' : 'days'} credited from your previous plan.`
  }
  return `${planName} plan activated.`
}

export function pendingChangeSentence(
  pending: PendingPlanChange,
  currentName: string,
  targetName: string,
  isOwner: boolean
): { title: string; body: string } {
  return {
    title: `${targetName} (${pending.billingCycle}) takes effect on ${formatBillingDate(pending.effectiveAt)}`,
    body: `Your current ${currentName} plan stays active until then. ${targetName} is already paid for and runs until ${formatBillingDate(pending.periodEnd)}.${isOwner ? ' Plans can change again after it starts.' : ''}`,
  }
}
