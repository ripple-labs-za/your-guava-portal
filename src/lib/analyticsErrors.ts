import { useEffect, useState } from 'react'

export type AnalyticsFailure = { message: string; retryDelayMs: number }
export type ComboSampleMeta = { truncated?: boolean; basketsConsidered?: number; basketsClipped?: number }

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
