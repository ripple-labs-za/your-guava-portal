import { describe, expect, it } from 'vitest'
import type { PlanChangePreview } from '@/types'
import { formatPlanChangeDate, planChangeSentence, planChangeNotice, pendingChangeSentence, planNameFor, previewFor } from './planChange'

const preview = (fields: Partial<PlanChangePreview>): PlanChangePreview => ({
  plan: 'starter', billingCycle: 'monthly', type: 'new', effectiveAt: '2026-11-01T12:00:00Z',
  periodEnd: '2026-12-01T12:00:00Z', creditDays: 0, blocked: null, ...fields,
})
const current = { name: 'Growth', cycle: 'annual' as const }

describe('plan-change wording', () => {
  it('names an approximate preview and suppresses zero credited days', () => {
    expect(planChangeSentence(preview({ type: 'upgrade', creditDays: 9 }), 'Pro', current)).toContain('about 9 extra days')
    expect(planChangeSentence(preview({ type: 'upgrade', creditDays: 0 }), 'Pro', current)).not.toContain('0 extra')
  })
  it('uses singular confirmed credit days and omits zero credit days', () => {
    expect(planChangeNotice(preview({ type: 'upgrade', creditDays: 1 }), 'Pro')).toContain('1 extra day credited')
    expect(planChangeNotice(preview({ type: 'upgrade', creditDays: 0 }), 'Pro')).not.toContain('extra')
  })
  it('names the retained plan and paid next end without manager next-action copy', () => {
    const pending = preview({ effectiveAt: '2026-10-31T23:30:00Z', periodEnd: '2026-12-01T23:30:00Z' })
    expect(pendingChangeSentence(pending, 'Growth', 'Starter', false)).toEqual({
      title: 'Starter (monthly) takes effect on 1 November 2026',
      body: 'Your current Growth plan stays active until then. Starter is already paid for and runs until 2 December 2026.',
    })
    expect(pendingChangeSentence(pending, 'Growth', 'Starter', true).body).toContain('Plans can change again')
  })
  it('keeps older APIs and manager catalogues readable', () => {
    expect(planNameFor([], 'growth')).toBe('Growth')
    expect(previewFor(undefined, 'pro', 'monthly')).toBeUndefined()
  })
  it('keeps the neutral fallback for an older API', () => {
    expect(planChangeSentence(undefined, 'Starter', current)).toBe('What this does to your current period is confirmed at checkout.')
  })
  it.each(['downgrade', 'cycle_switch'] as const)('names the paid end and retained plan for %s', (type) => {
    expect(planChangeSentence(preview({ type }), 'Starter', current)).toBe(
      'Takes effect on 1 November 2026, when your current Growth (annual) period ends. You keep Growth until then; Starter then runs until 1 December 2026.'
    )
  })
  it.each([[1, 'day'], [9, 'days']])('names %s extra %s for an upgrade', (creditDays, word) => {
    expect(planChangeSentence(preview({ type: 'upgrade', creditDays: Number(creditDays) }), 'Pro', current)).toContain(`about ${creditDays} extra ${word}. Pro runs until 1 December 2026`)
  })
  it('names the renewal end and the start of a new term', () => {
    expect(planChangeSentence(preview({ type: 'renewal' }), 'Starter', current)).toBe('Extends your current plan: paid until 1 December 2026.')
    expect(planChangeSentence(preview({}), 'Starter', current)).toBe('Starts today and runs until 1 December 2026.')
  })
  it('formats the optional date field', () => {
    expect(formatPlanChangeDate(null)).toBe('-')
    expect(formatPlanChangeDate('2026-11-01T12:00:00Z')).toBe('1 November 2026')
  })
})
