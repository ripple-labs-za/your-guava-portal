import { parseDateOnly } from '@/lib/date'
import type { LeaveCycleType } from '@/types'

export const CYCLE_TYPES: LeaveCycleType[] = ['annual', 'sick', 'family']

export function formatDate(dateStr: string) {
  return parseDateOnly(dateStr).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

// The server's sentence when it sent one (the workforce routes always do), else the fallback.
export function requestErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}
