import type { BillingCycle, PlanChangePreview } from '@/types'
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
    case 'upgrade':
      return `Starts today. The unused part of your current plan is credited as ${preview.creditDays} extra ${
        preview.creditDays === 1 ? 'day' : 'days'
      }, so ${planName} runs until ${formatPlanChangeDate(preview.periodEnd)}.`
    case 'downgrade':
    case 'cycle_switch':
      return `Takes effect on ${formatPlanChangeDate(preview.effectiveAt)}, when your current ${current.name} (${current.cycle}) period ends. You keep ${current.name} until then; ${planName} then runs until ${formatPlanChangeDate(preview.periodEnd)}.`
    case 'renewal':
      return `Extends your current plan: paid until ${formatPlanChangeDate(preview.periodEnd)}.`
    default:
      return `Starts today and runs until ${formatPlanChangeDate(preview.periodEnd)}.`
  }
}
