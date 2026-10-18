import { describe, expect, it } from 'vitest'
import { historyBackfillBatch, historyBackfillFailure, historyBackfillNote } from './historyBackfill'
import type { ForecastHistoryMeta } from '@/types'

const failure = (status: number, data = {}) => ({ response: { status, data } })

describe('history backfill guidance', () => {
  it('prioritises read-only billing, formats the server date and keeps manager next steps with the owner', () => {
    const error = failure(402, { details: { readOnly: true, graceEndsAt: '2026-10-31T23:30:00Z' } })
    expect(historyBackfillFailure(error, true)).toEqual({
      message: 'Read-only until 1 November 2026. Renew in Billing.', reload: true, billingLink: true,
    })
    expect(historyBackfillFailure(error, false)).toEqual({
      message: 'Read-only until 1 November 2026. Ask the account owner to renew.', reload: true, billingLink: false,
    })
  })

  it('reloads after mid-batch credit refusal and only offers owners the billing link', () => {
    expect(historyBackfillFailure(failure(402), true)).toMatchObject({ reload: true, billingLink: true })
    expect(historyBackfillFailure(failure(402), false)).toMatchObject({
      message: expect.stringContaining('Ask the account owner'), reload: true, billingLink: false,
    })
  })

  it('distinguishes permission, rate, session and transport errors', () => {
    expect(historyBackfillFailure(failure(403, { code: 'CREDIT_SPEND_FORBIDDEN' }), false)).toMatchObject({
      message: expect.stringMatching(/permission/), reload: false, billingLink: false,
    })
    expect(historyBackfillFailure(failure(429), true)).toMatchObject({
      message: expect.stringMatching(/Wait a few minutes/), reload: false,
    })
    expect(historyBackfillFailure(failure(401), true)).toMatchObject({
      message: expect.stringMatching(/sign-in has expired/), reload: false,
    })
    expect(historyBackfillFailure(new Error('timeout'), true)).toMatchObject({
      message: expect.stringMatching(/Days built before that point were kept/), reload: true,
    })
  })

  it.each([[3, 14, 2, 3, 6], [16, 14, 1, 14, 14], [1, 14, 5, 1, 5]])(
    'prices %i pending days with batch size %i at %i credits', (pendingDays, batchSize, creditsPerDay, days, price) => {
      const result = historyBackfillBatch({ pendingDays, backfill: { batchSize, creditsPerDay } } as ForecastHistoryMeta)
      expect(result).toEqual({ days, costDescription: `Uses up to ${price} Guava Credits (${creditsPerDay} per day built).` })
    }
  )

  it('states free pricing and a pending retry separately from completed work', () => {
    expect(historyBackfillBatch(null)).toEqual({ days: 0, costDescription: 'Free — building history uses no Guava Credits.' })
    expect(historyBackfillNote(0, 1)).toBe('Some days are still pending. Try building again later.')
    expect(historyBackfillNote(1, 0)).toBe('Built 1 retrospective day.')
    expect(historyBackfillNote(2, 0)).toBe('Built 2 retrospective days.')
    expect(historyBackfillNote(0, 0)).toMatch(/No further days/)
  })
})
