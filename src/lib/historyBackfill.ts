import { isSessionRejection } from '@/lib/api'
import { billingReadOnlyMessage } from '@/lib/billingAccess'
import type { ForecastHistoryMeta } from '@/types'

export const HISTORY_SPEND_PERMISSION = 'Ask the account owner for permission to spend Guava Credits before building history.'

export interface HistoryBackfillFailure {
  message: string
  reload: boolean
  billingLink: boolean
}

export function historyBackfillFailure(error: unknown, isOwner: boolean): HistoryBackfillFailure {
  const status = (error as { response?: { status?: number } })?.response?.status
  const readOnly = billingReadOnlyMessage(error)
  if (status === 402) {
    const message = readOnly
      ? isOwner ? readOnly : readOnly.replace('Renew in Billing.', 'Ask the account owner to renew.')
      : `Not enough Guava Credits to build this batch. ${isOwner
        ? 'Top up in Settings > Billing & usage, then carry on.'
        : 'Ask the account owner to add credits, then carry on.'}`
    // A batch can save earlier days before a later reservation is refused.
    return { message, reload: true, billingLink: isOwner }
  }
  if (status === 403) return { message: HISTORY_SPEND_PERMISSION, reload: false, billingLink: false }
  if (status === 429) return {
    message: 'History is being built too quickly. Wait a few minutes, then carry on.', reload: false, billingLink: false,
  }
  if (isSessionRejection(error)) return {
    message: 'Your sign-in has expired. Sign in again to carry on building history.', reload: false, billingLink: false,
  }
  return {
    message: 'We lost contact before this batch finished. Days built before that point were kept — this page has been reloaded to show exactly what landed.',
    reload: true, billingLink: false,
  }
}

export function historyBackfillBatch(meta: ForecastHistoryMeta | null) {
  const batchSize = meta?.backfill?.batchSize || 14
  const days = Math.min(meta?.pendingDays ?? 0, batchSize)
  const creditsPerDay = meta?.backfill?.creditsPerDay ?? 0
  const costDescription = creditsPerDay > 0
    ? `Uses up to ${days * creditsPerDay} Guava Credits (${creditsPerDay} per day built).`
    : 'Free — building history uses no Guava Credits.'
  return { days, costDescription }
}

export function historyBackfillNote(generated: number, pending: number) {
  return generated > 0 ? `Built ${generated} retrospective day${generated === 1 ? '' : 's'}.`
    : pending > 0 ? 'Some days are still pending. Try building again later.'
      : 'No further days could be built from the sales data available.'
}
