import { useEffect, useState } from 'react'

const ANALYTICS_SERVER_MESSAGE_CODES = new Set([
  'ANALYTICS_RATE_LIMITED', 'ANALYTICS_REFRESH_RATE_LIMITED', 'ANALYTICS_QUERY_TIMEOUT',
  'ANALYTICS_RANGE_TOO_LONG', 'ANALYTICS_INVALID_DAYS',
])
type RequestFailure = { response?: { status?: number; data?: { code?: string; message?: unknown; details?: { code?: string } } } }
export type AnalyticsFailure = { message: string; retryDelayMs: number }
export type ComboSampleMeta = { truncated?: boolean; basketsConsidered?: number; basketsClipped?: number }

export function analyticsErrorMessage(error: unknown, fallback: string, period?: string): string {
  const response = (error as RequestFailure | null)?.response
  const data = response?.data
  const code = data?.code ?? data?.details?.code
  if (code === 'ANALYTICS_QUERY_TIMEOUT' && period === '7d') {
    return 'This range took too long to analyse. Wait a minute, then press Retry.'
  }
  if (code && ANALYTICS_SERVER_MESSAGE_CODES.has(code) && typeof data?.message === 'string' && data.message.trim()) return data.message
  if (response?.status === 429) return 'Too many requests right now. Wait a minute, then press Retry.'
  return fallback
}

export const analyticsRetryDelay = (error: unknown) => (error as RequestFailure | null)?.response?.status === 429 ? 10000 : 0
export const analyticsFailure = (error: unknown, fallback: string, period: string): AnalyticsFailure => ({
  message: analyticsErrorMessage(error, fallback, period), retryDelayMs: analyticsRetryDelay(error),
})

export function useAnalyticsRetryDelay(delay: number) {
  const [disabled, setDisabled] = useState(delay > 0)
  useEffect(() => {
    setDisabled(delay > 0)
    if (!delay) return
    const timer = setTimeout(() => setDisabled(false), delay)
    return () => clearTimeout(timer)
  }, [delay])
  return disabled
}

export function comboSampleCaption(meta?: ComboSampleMeta): string | null {
  if (!meta?.truncated) return null
  const count = meta.basketsConsidered ?? 0
  const clipped = meta.basketsClipped ?? 0
  return `Based on the most recent ${count.toLocaleString('en-ZA')} baskets with two or more items in this range.` +
    (clipped > 0 ? ` ${clipped.toLocaleString('en-ZA')} ${clipped === 1 ? 'basket was' : 'baskets were'} cut to 20 items.` : '')
}
