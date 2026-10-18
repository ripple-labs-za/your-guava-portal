import { describe, expect, it } from 'vitest'
import type { PlanChangePreview } from '@/types'
import { formatPlanChangeDate, planChangeSentence } from './planChange'

const preview = (fields: Partial<PlanChangePreview>): PlanChangePreview => ({
  plan: 'starter', billingCycle: 'monthly', type: 'new', effectiveAt: '2026-11-01T12:00:00Z',
  periodEnd: '2026-12-01T12:00:00Z', creditDays: 0, blocked: null, ...fields,
})
const current = { name: 'Growth', cycle: 'annual' as const }

describe('plan-change wording', () => {
  it('keeps the neutral fallback for an older API', () => {
    expect(planChangeSentence(undefined, 'Starter', current)).toBe('What this does to your current period is confirmed at checkout.')
  })
  it.each(['downgrade', 'cycle_switch'] as const)('names the paid end and retained plan for %s', (type) => {
    expect(planChangeSentence(preview({ type }), 'Starter', current)).toBe(
      'Takes effect on 01 Nov 2026, when your current Growth (annual) period ends. You keep Growth until then; Starter then runs until 01 Dec 2026.'
    )
  })
  it.each([[1, 'day'], [9, 'days']])('names %s extra %s for an upgrade', (creditDays, word) => {
    expect(planChangeSentence(preview({ type: 'upgrade', creditDays: Number(creditDays) }), 'Pro', current)).toContain(`${creditDays} extra ${word}, so Pro runs until 01 Dec 2026`)
  })
  it('names the renewal end and the start of a new term', () => {
    expect(planChangeSentence(preview({ type: 'renewal' }), 'Starter', current)).toBe('Extends your current plan: paid until 01 Dec 2026.')
    expect(planChangeSentence(preview({}), 'Starter', current)).toBe('Starts today and runs until 01 Dec 2026.')
  })
  it('formats the optional date field', () => {
    expect(formatPlanChangeDate(null)).toBe('-')
    expect(formatPlanChangeDate('2026-11-01T12:00:00Z')).toBe('01 Nov 2026')
  })
})
