import type { DeleteUploadResponse, UploadOverlap, UploadOverlapStats } from '@/types/upload'

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
