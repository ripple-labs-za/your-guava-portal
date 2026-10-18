import { describe, expect, it } from 'vitest'
import { billingPageState, billingReadOnlyMessage, billingToolbarCopy } from './billingAccess'
import type { BillingAccess, Organization } from '@/types'

const org = (fields: Partial<Organization>) => ({ id: 'org', name: 'Cafe', plan: 'growth', ...fields }) as Organization
const grace = { allowed: false, status: 'grace', readOnly: true, reason: 'trial_expired', periodEnd: '2026-10-01T22:30:00Z', graceEndsAt: '2026-10-04T22:30:00Z' } satisfies BillingAccess

describe('billing access wording and renewal window', () => {
  it('gives managers a next step that the account owner can perform', () => {
    const state = billingPageState(org({ billingStatus: 'past_due', billingAccess: grace }), false)
    expect(state.graceHeading).toContain('Your free trial ended on 02 Oct 2026')
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
    expect(billingReadOnlyMessage(error)).toBe('Read-only until 05 Oct 2026. Renew in Billing.')
  })
  it.each([null, {}, { response: { status: 402, data: { details: { code: 'INSUFFICIENT_CREDITS' } } } }])('does not call other refusals grace', (error) => {
    expect(billingReadOnlyMessage(error)).toBeNull()
  })
})
