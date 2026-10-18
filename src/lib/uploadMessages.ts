import type { StageUploadResponse, DeleteUploadResponse, SavedMappingStatus, UploadOverlap, UploadOverlapStats } from '@/types/upload'

type MappingNoticeInput = Pick<StageUploadResponse, 'mappingAssistedByAi' | 'mappingCreditsUsed' | 'mappingAiUnavailableReason'>

/** Why the mapping wizard is or is not pre-filled by AI, in the owner's terms. */
export const mappingAssistNotice = (stage: MappingNoticeInput): string | null => {
  if (stage.mappingAssistedByAi) {
    return stage.mappingCreditsUsed
      ? `AI suggested the preselected column matches and used ${stage.mappingCreditsUsed} Guava Credits. Review every match before importing.`
      : 'AI suggested the preselected column matches without a new credit charge. Review every match before importing.'
  }
  switch (stage.mappingAiUnavailableReason) {
    case 'insufficient_credits':
      return 'AI column matching needs 10 Guava Credits and your balance cannot cover it, so match the columns below yourself. Nothing was charged.'
    case 'rate_limited':
      return 'AI column matching is paused for up to a minute because this login has made a lot of AI requests. Match the columns below yourself, or cancel and upload again shortly. Nothing was charged.'
    case 'usage_limit_reached':
      return 'AI column matching has reached an AI safety limit for your login or account. Wait for current AI work to finish; usage limits count the last 24 hours. Match the columns below yourself. Nothing was charged.'
    case 'permission_required':
      return 'Your login cannot spend Guava Credits, so AI column matching was skipped. Match the columns below yourself, or ask the owner to allow credit spending.'
    case 'provider_unavailable':
      return 'The AI service could not suggest matches this time. Match the columns below yourself. Nothing was charged.'
    case 'sensitive_headers':
      return 'The first row looks like customer data rather than column names, so it was not sent to the AI service. Match the columns below yourself.'
    default:
      return null
  }
}

// Copy shown when a chosen file is refused before it is sent. Kept in one place
// because the .xls message is load-bearing: production's backend cannot import
// .xlsx until the read-excel-file repair ships, and CSV imports on every build,
// so this must never send an owner towards .xlsx (D-002 in the-road-to-90).

export const XLS_GUIDANCE =
  '.xls files aren\'t supported. In Excel choose File → Save As → "CSV UTF-8 (Comma delimited)", keep only the sheet with your sales, then upload that .csv.'

export const INVALID_TYPE = 'Invalid file type. Please upload a .csv or .xlsx file.'

/**
 * What deleting an upload will actually do, in the owner's terms.
 *
 * Deleting an upload that contributed no rows no longer touches transactions,
 * forecasts or insights (the backend guards that on the rows actually linked to
 * it), so promising to "refresh the affected forecasts" for a stranded upload
 * would be describing work the product does not do.
 */
export const deleteUploadConsequence = (fileName: string, importedRows: number): string =>
  importedRows > 0
    ? `This removes the ${importedRows.toLocaleString('en-ZA')} transaction${importedRows === 1 ? '' : 's'} imported from ${fileName} and refreshes the forecasts built on them. This cannot be undone.`
    : `This removes ${fileName} from your history. Nothing was imported from it, so your transactions and forecasts are unaffected. This cannot be undone.`

const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })

/** Which other uploads share this one's days, so the owner knows those days stay covered after a delete. */
export const overlapNotice = (overlaps: UploadOverlap[], more = 0): string | null => {
  if (overlaps.length === 0) return null
  const names = overlaps.map((o) =>
    o.firstDateKey && o.lastDateKey ? `${o.fileName} (${dayLabel(o.firstDateKey)} – ${dayLabel(o.lastDateKey)})` : o.fileName)
  const listed = more > 0 ? `${names.join(', ')} and ${more} more` : names.join(', ')
  const one = overlaps.length === 1 && more === 0
  return `${listed} also cover${one ? 's' : ''} some of these days. Sales ${one ? 'it holds' : 'they hold'} for those days are ` +
    `re-imported from ${one ? 'it' : 'them'}, so those days stay covered.`
}

/** What the delete re-imported or queued, or null when nothing overlapped. */
export const readmissionOutcome = (response: Partial<DeleteUploadResponse> | undefined): string | null => {
  const rows = response?.readmitted?.rows ?? 0
  const queued = response?.readmissionQueued ?? []
  if (rows === 0 && queued.length === 0) return null
  const parts: string[] = []
  if (rows > 0) {
    const from = (response?.readmitted?.uploads ?? []).map((u) => u.fileName).join(', ')
    parts.push(`${rows.toLocaleString('en-ZA')} sale${rows === 1 ? ' was' : 's were'} re-imported from ${from}.`)
  }
  if (queued.length > 0) {
    parts.push(`${queued.map((u) => u.fileName).join(', ')} ${queued.length === 1 ? 'is' : 'are'} being re-read in the ` +
      'background, and those days fill in within the hour.')
  }
  return `Upload deleted. ${parts.join(' ')}`
}

/** Which earlier imports already held the sales this file skipped, or null when none did. */
export const overlapSkipMessage = (overlap?: UploadOverlapStats): string | null => {
  if (!overlap || overlap.rows <= 0) return null
  const files = overlap.uploads.map((u) => u.fileName).filter((name): name is string => Boolean(name))
  const from = files.length > 0 ? files.join(', ') : 'earlier imports'
  const count = overlap.rows.toLocaleString('en-ZA')
  return `${count} sale${overlap.rows === 1 ? ' was' : 's were'} already in Your Guava from ${from}, so ` +
    `${overlap.rows === 1 ? 'it was' : 'they were'} skipped rather than counted twice.`
}

const rowCount = (n: number) => `${n.toLocaleString('en-ZA')} ${n === 1 ? 'row' : 'rows'}`
const itWasOrTheyWere = (n: number) => (n === 1 ? 'it was' : 'they were')

// One sentence per key of stats.skippedByReason (BE-03-T09): skipped is always their sum, so each is explained.
const SKIP_REASON_COPY: Record<string, (n: number) => string> = {
  duplicate: (n) => `${rowCount(n)} ${n === 1 ? 'was' : 'were'} already imported earlier, so ${itWasOrTheyWere(n)} not counted twice.`,
  in_file_duplicate: (n) => `${rowCount(n)} repeated a sale that appears earlier in this file, so ${itWasOrTheyWere(n)} counted once.`,
  status_not_approved: (n) => `${rowCount(n)} ${n === 1 ? 'was' : 'were'} skipped because the Status column did not read as a completed sale.`,
  refund_netted: (n) => (n === 1
    ? '1 refund row was netted into the sale it refunded, so that sale counts what the customer kept.'
    : `${n.toLocaleString('en-ZA')} refund rows were netted into the sales they refunded, so those sales count what the customer kept.`),
}
const SKIP_REASON_ORDER = ['duplicate', 'in_file_duplicate', 'status_not_approved', 'refund_netted']

/**
 * Why each skipped row was skipped, one sentence per reason, including a reason this page has no copy for yet. The
 * overlap sentence names the uploads that held the duplicates, so it stands in for the plain duplicate sentence;
 * only duplicates it does not cover get that one, and no row is explained twice.
 */
export const skippedRowSentences = (
  skippedByReason: Record<string, number> = {},
  overlap?: UploadOverlapStats,
): string[] => {
  const overlapMessage = overlapSkipMessage(overlap)
  const counts: Record<string, number> = { ...skippedByReason }
  if (overlapMessage && overlap) counts.duplicate = Math.max((counts.duplicate ?? 0) - overlap.rows, 0)
  const unknown = Object.keys(counts).filter((key) => !SKIP_REASON_ORDER.includes(key)).sort()
  const sentences = [...SKIP_REASON_ORDER, ...unknown]
    .filter((key) => typeof counts[key] === 'number' && counts[key] > 0)
    .map((key) => SKIP_REASON_COPY[key]?.(counts[key])
      ?? `${rowCount(counts[key])} ${counts[key] === 1 ? 'was' : 'were'} skipped (${key.replace(/_/g, ' ')}).`)
  return overlapMessage ? [overlapMessage, ...sentences] : sentences
}

/** Why the wizard is asking although the cafe has a saved mapping; null when there is nothing to explain. */
export const savedMappingNotice = (saved?: SavedMappingStatus): string | null => {
  if (!saved || saved.status !== 'did_not_fit') return null
  const tail = 'Check each field before importing; the columns you confirm become the saved mapping.'
  if (saved.reason === 'missing_columns' && saved.missingColumns.length > 0) {
    const plural = saved.missingColumns.length === 1 ? 'column' : 'columns'
    return `Your saved column mapping doesn't fit this file: it has no ${saved.missingColumns.join(', ')} ${plural}. ${tail}`
  }
  if (saved.reason === 'incomplete') {
    return `Your saved column mapping does not say which columns hold every required field for this file. ${tail}`
  }
  return `This file's columns differ from the file your saved mapping came from. ${tail}`
}
