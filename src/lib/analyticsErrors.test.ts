import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { analyticsErrorMessage, comboSampleCaption, analyticsRetryDelay, useAnalyticsRetryDelay } from './analyticsErrors'

describe('analytics error and sample copy', () => {
  it('recognizes details.code and retains approved server copy', () => {
    expect(analyticsErrorMessage({ response: { status: 400, data: { details: { code: 'ANALYTICS_RANGE_TOO_LONG' }, message: 'At most 400 days.' } } }, 'Fallback', '30d')).toBe('At most 400 days.')
  })
  it('keeps unlisted codes and empty server messages behind the fallback', () => {
    expect(analyticsErrorMessage({ response: { data: { code: 'UNKNOWN', message: 'Raw error' } } }, 'Fallback', '30d')).toBe('Fallback')
    expect(analyticsErrorMessage({ response: { data: { code: 'ANALYTICS_RATE_LIMITED', message: ' ' } } }, 'Fallback', '30d')).toBe('Fallback')
  })
  it('explains a codeless 429 from the IP limiter', () => {
    expect(analyticsErrorMessage({ response: { status: 429, data: 'Too many requests' } }, 'Fallback', '30d')).toBe('Too many requests right now. Wait a minute, then press Retry.')
    expect(analyticsRetryDelay({ response: { status: 429 } })).toBe(10000)
    expect(analyticsRetryDelay({ response: { status: 503 } })).toBe(0)
    expect(analyticsErrorMessage({ response: { status: 429, data: { code: 'IP_LIMIT' } } }, 'Fallback')).toBe('Too many requests right now. Wait a minute, then press Retry.')
  })
  it('does not recommend a shorter range when seven days is already selected', () => {
    const error = { response: { status: 503, data: { details: { code: 'ANALYTICS_QUERY_TIMEOUT' }, message: 'Choose a shorter range and try again.' } } }
    expect(analyticsErrorMessage(error, 'Fallback', '7d')).toBe('This range took too long to analyse. Wait a minute, then press Retry.')
    expect(analyticsErrorMessage(error, 'Fallback', '30d')).toBe('Choose a shorter range and try again.')
  })
  it('omits an unsampled caption and discloses sampled eligible and clipped baskets', () => {
    expect(comboSampleCaption({ truncated: false, basketsConsidered: 10 })).toBeNull()
    expect(comboSampleCaption({ truncated: true, basketsConsidered: 10, basketsClipped: 2 })).toBe('Based on the most recent 10 baskets with two or more items in this range. 2 baskets were cut to 20 items.')
    expect(comboSampleCaption({ truncated: true, basketsConsidered: 1, basketsClipped: 1 })).toContain('1 basket was cut to 20 items.')
  })
  it('keeps Retry disabled for ten seconds and clears the timer on unmount', () => {
    vi.useFakeTimers()
    try {
      const hook = renderHook(() => useAnalyticsRetryDelay(10000))
      expect(hook.result.current).toBe(true)
      act(() => vi.advanceTimersByTime(9999))
      expect(hook.result.current).toBe(true)
      act(() => vi.advanceTimersByTime(1))
      expect(hook.result.current).toBe(false)
      hook.unmount()
      const pending = renderHook(() => useAnalyticsRetryDelay(10000))
      pending.unmount()
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
