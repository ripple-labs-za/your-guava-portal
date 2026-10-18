import { describe, expect, it } from 'vitest'
import { resolveRefreshOutcome, insightRefreshErrorNotice, INSIGHT_WINDOW_COPY } from './insightRefresh'

describe('insight refresh outcomes', () => {
  it.each([
    [{ cacheStatus: 'stale', meta: { replayed: true } }, 'stale', /earlier refresh.*predates your last import/i],
    [{ cacheStatus: 'fresh', meta: { coalesced: true } }, 'fresh', /joined a refresh already running/i],
    [{ insufficientData: true, insights: [] }, 'insufficient_data', /no credits were used/i],
    [{ insights: ['Legacy result'] }, 'fresh', /analysis refreshed/i],
  ])('maps %j', (data, status, notice) => {
    expect(resolveRefreshOutcome(data)).toMatchObject({ status, notice: expect.stringMatching(notice) })
  })
  it('keeps a no-data explanation out of the insight list and timestamp', () => {
    expect(resolveRefreshOutcome({ cacheStatus: 'insufficient_data', insights: ['No completed sales.'], generatedAt: new Date().toISOString() }))
      .toMatchObject({ insights: [], generatedAt: null, requiresRefresh: true, body: 'No completed sales.', heading: 'Nothing to analyse yet' })
  })
  it('has a useful no-data fallback and explicitly names the completed-day window', () => {
    expect(resolveRefreshOutcome({ cacheStatus: 'insufficient_data', insights: [] }).body).toMatch(/no approved sales/i)
    expect(INSIGHT_WINDOW_COPY).toBe('Covers the 14 completed days before today')
  })
  it('names an active lease conflict and keeps a timeout charge uncertain', () => {
    expect(insightRefreshErrorNotice({ response: { status: 409, data: { code: 'INSIGHT_REFRESH_IN_PROGRESS' } } })).toMatch(/another refresh is running/i)
    expect(insightRefreshErrorNotice({ code: 'ECONNABORTED' })).toMatch(/if this refresh completed, retrying will not charge twice/i)
    expect(insightRefreshErrorNotice({ code: 'ECONNABORTED' })).not.toMatch(/no credits will be charged/i)
  })
})
