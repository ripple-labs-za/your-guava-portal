import { describe, expect, it } from 'vitest'
import { billingBadge, billingPageState, billingReadOnlyMessage, billingToolbarCopy } from './billingAccess'
import type { BillingAccess, Organization } from '@/types'

const org = (fields: Partial<Organization>) => ({ id: 'org', name: 'Cafe', plan: 'growth', ...fields }) as Organization
const grace = { allowed: false, status: 'grace', readOnly: true, reason: 'trial_expired', periodEnd: '2026-10-01T22:30:00Z', graceEndsAt: '2026-10-04T22:30:00Z' } satisfies BillingAccess

describe('billing access wording and renewal window', () => {
  it('gives managers a next step that the account owner can perform', () => {
    const state = billingPageState(org({ billingStatus: 'past_due', billingAccess: grace }), false)
    expect(state.graceHeading).toContain('Your free trial ended on 2 October 2026')
    expect(state.graceDetail).toContain('Ask the account owner to renew')
    expect(state.graceDetail).not.toContain('Choose a plan')
    expect(state.statusLabel).toBe('Read-only')
    expect(state.periodSummary).toBeNull()
    expect(billingToolbarCopy(grace.graceEndsAt, false)).not.toContain('Open billing to renew')
  })
  it('lets owners renew at the seven-day boundary and uses the paid next term', () => {
    const now = new Date('2026-10-01T12:00:00Z').getTime()
    const currentPeriodEnd = new Date(now + 7 * 86400000).toISOString()
    expect(billingPageState(org({ currentPeriodEnd }), true, now).renewable).toBe(true)
    expect(billingPageState(org({ currentPeriodEnd: new Date(now + 7 * 86400000 + 1).toISOString() }), true, now).renewable).toBe(false)
    expect(billingPageState(org({ billingAccess: grace }), true, now).renewable).toBe(true)
    expect(billingPageState(org({ billingAccess: grace }), true).graceDetail).toContain('Choose a plan below')
  })
  it.each([
    { response: { data: { billing: grace } } },
    { response: { data: { details: { billingStatus: 'grace', graceEndsAt: grace.graceEndsAt } } } },
    { details: { readOnly: true, graceEndsAt: grace.graceEndsAt } },
  ])('explains grace from middleware and usage error envelopes', (error) => {
    expect(billingReadOnlyMessage(error)).toBe('Read-only until 5 October 2026. Renew in Billing.')
  })
  it.each([null, {}, { response: { status: 402, data: { details: { code: 'INSUFFICIENT_CREDITS' } } } }])('does not call other refusals grace', (error) => {
    expect(billingReadOnlyMessage(error)).toBeNull()
  })
})

// BE-13-T03: the Billing badge says what the organisation can do today (billingAccess), not what it last bought.
describe('billingBadge', () => {
  const access = (status: BillingAccess['status']) => ({ allowed: status === 'active' || status === 'trialing', status, readOnly: status === 'grace', reason: null, periodEnd: null, graceEndsAt: null }) as BillingAccess

  it.each([
    ['trialing', 'Free trial', 'secondary'],
    ['active', 'Active', 'success'],
    ['grace', 'Read-only', 'warning'],
    ['past_due', 'Payment required', 'destructive'],
    ['canceled', 'Cancelled', 'destructive'],
    ['missing', 'Unknown', 'secondary'],
  ] as const)('access %s reads %s (%s)', (status, label, tone) => {
    // The stored status says active throughout: access wins.
    expect(billingBadge(org({ billingStatus: 'active', billingAccess: access(status) }))).toEqual({ label, tone })
  })

  it.each([
    ['trialing', 'Free trial', 'secondary'],
    ['active', 'Active', 'success'],
    ['past_due', 'Payment required', 'destructive'],
    ['canceled', 'Cancelled', 'destructive'],
  ] as const)('an older server without billingAccess falls back to the stored %s', (billingStatus, label, tone) => {
    expect(billingBadge(org({ billingStatus }))).toEqual({ label, tone })
  })

  it('never shows a green badge for an organisation that cannot use Guava today', () => {
    for (const status of ['grace', 'past_due', 'canceled', 'missing'] as const) {
      expect(billingBadge(org({ billingStatus: 'active', billingAccess: access(status) })).tone).not.toBe('success')
    }
  })
})
