import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { comboSampleCaption, useAnalyticsRetryDelay } from './analyticsErrors'

describe('analytics error and sample copy', () => {
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
