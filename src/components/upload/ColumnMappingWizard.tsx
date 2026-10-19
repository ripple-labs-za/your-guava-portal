import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ColumnMapping, ItemsMode } from '@/types/upload'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const CANONICAL_FIELDS: { key: keyof ColumnMapping; label: string; required: boolean }[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'items', label: 'Items / Description', required: true },
  { key: 'total', label: 'Total amount', required: true },
  { key: 'time', label: 'Time', required: false },
  { key: 'receiptId', label: 'Receipt ID', required: false },
  { key: 'tip', label: 'Tip', required: false },
  { key: 'discount', label: 'Discount', required: false },
  { key: 'paymentMethod', label: 'Payment method', required: false },
  { key: 'status', label: 'Status', required: false },
  { key: 'quantity', label: 'Quantity (line-per-row mode)', required: false },
]

const FOCUSABLE =
  'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const DEFAULT_TITLE = 'Map your CSV columns'
const DEFAULT_DESCRIPTION =
  "We couldn't auto-detect your file format. Match each canonical field on the left to the column from your CSV on the right. Required fields are marked with *."

interface Props {
  open: boolean
  headers: string[]
  preview: Record<string, string>[]
  /** May be absent: an upload staged from an unknown format has no mapping yet. */
  initialMapping?: ColumnMapping
  initialItemsMode: ItemsMode
  errorMessage?: string | null
  assistiveNotice?: string | null
  title?: string
  description?: string
  confirmLabel?: string
  onConfirm: (mapping: ColumnMapping, itemsMode: ItemsMode) => void | Promise<void>
  onCancel: () => void
}

export function ColumnMappingWizard({
  open,
  headers,
  preview,
  initialMapping,
  initialItemsMode,
  errorMessage,
  assistiveNotice,
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  confirmLabel = 'Confirm and import',
  onConfirm,
  onCancel,
}: Props) {
  // Default at the boundary rather than trusting the caller. This component is
  // handed data straight off the API, and Object.entries(undefined) threw the
  // whole wizard into the error boundary when an unmapped upload was resumed.
  const [mapping, setMapping] = useState<ColumnMapping>(initialMapping ?? {})
  const [itemsMode, setItemsMode] = useState<ItemsMode>(initialItemsMode)
  const [isConfirming, setIsConfirming] = useState(false)
  const mountedRef = useRef(true)
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const receiptRequired = itemsMode === 'line-per-row'
  const headersMissing = headers.length === 0

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!open) return
    // Captured once. The effect used to re-run on every parent render (onCancel
    // is a fresh arrow each time), and each re-run re-recorded the *dialog* as
    // the element to restore to, losing the real trigger and yanking focus back
    // out of whichever select the user was operating.
    if (!restoreFocusRef.current && document.activeElement instanceof HTMLElement) {
      restoreFocusRef.current = document.activeElement
    }
    dialogRef.current?.focus()
    return () => {
      restoreFocusRef.current?.focus()
      restoreFocusRef.current = null
    }
  }, [open])

  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  const confirmingRef = useRef(isConfirming)
  confirmingRef.current = isConfirming

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !confirmingRef.current) cancelRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Tab used to walk straight out of the modal onto the Data Health drop zone
  // behind the overlay -- which could stage a second file while this dialog
  // still held the first file's mapping.
  const trapTab = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (!focusables || focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  const knownHeaders = useMemo(() => new Set(headers), [headers])

  // A column name that is not in this file's headers is not a mapping, it is a
  // leftover from a different file. Treating it as set let Confirm stay enabled
  // over a form whose every select rendered blank.
  const effectiveMapping = useMemo(() => {
    const next: ColumnMapping = {}
    for (const [key, value] of Object.entries(mapping)) {
      if (typeof value === 'string' && knownHeaders.has(value)) {
        next[key as keyof ColumnMapping] = value
      }
    }
    return next
  }, [mapping, knownHeaders])

  const duplicateColumns = useMemo(() => {
    const fieldsByColumn = new Map<string, (keyof ColumnMapping)[]>()
    for (const [key, value] of Object.entries(effectiveMapping)) {
      if (!value) continue
      fieldsByColumn.set(value, [...(fieldsByColumn.get(value) || []), key as keyof ColumnMapping])
    }
    const reused: string[] = []
    for (const [column, fields] of fieldsByColumn) {
      if (fields.length < 2) continue
      // A single combined "Date/Time" column legitimately serves both fields,
      // and a large share of POS exports have no other shape. Blocking it read
      // as "your file is unsupported".
      const combinedTimestamp = fields.length === 2 && fields.includes('date') && fields.includes('time')
      if (combinedTimestamp) continue
      reused.push(column)
    }
    return reused
  }, [effectiveMapping])

  const duplicateFields = useMemo(() => {
    const flagged = new Set<keyof ColumnMapping>()
    for (const [key, value] of Object.entries(effectiveMapping)) {
      if (value && duplicateColumns.includes(value)) flagged.add(key as keyof ColumnMapping)
    }
    return flagged
  }, [duplicateColumns, effectiveMapping])

  const requiredOk = useMemo(
    () => Boolean(
      !headersMissing &&
      effectiveMapping.date &&
      effectiveMapping.items &&
      effectiveMapping.total &&
      (!receiptRequired || effectiveMapping.receiptId) &&
      duplicateColumns.length === 0
    ),
    [duplicateColumns.length, effectiveMapping, headersMissing, receiptRequired]
  )
  const receiptRequirementMessage = receiptRequired && !effectiveMapping.receiptId
    ? 'Receipt ID is required for line-per-row imports.'
    : null
  const duplicateMappingMessage = duplicateColumns.length > 0
    ? `Each field needs its own source column. Reused: ${duplicateColumns.join(', ')}.`
    : null

  if (!open) return null

  const setField = (key: keyof ColumnMapping, value: string | undefined) =>
    setMapping((m) => ({ ...m, [key]: value || undefined }))

  const handleConfirm = async () => {
    if (!requiredOk || isConfirming) return
    setIsConfirming(true)
    try {
      await onConfirm(effectiveMapping, itemsMode)
    } finally {
      if (mountedRef.current) setIsConfirming(false)
    }
  }

  // The owner picks a column by name, and two columns can share one ("Total" gross and "Total (2)" net).
  // Showing the first value the chosen column holds is what lets them see which money they are importing.
  const firstValue = (column?: string): string | undefined => {
    if (!column) return undefined
    for (const row of preview) {
      const value = row[column]
      if (value != null && String(value).trim() !== '') return String(value)
    }
    return undefined
  }

  const describedBy = (key: keyof ColumnMapping) => {
    const ids: string[] = []
    if (key === 'receiptId' && receiptRequirementMessage) ids.push('mapping-receipt-required')
    if (duplicateFields.has(key)) ids.push('mapping-duplicate-columns')
    if (firstValue(effectiveMapping[key]) !== undefined) ids.push(`mapping-${key}-sample`)
    return ids.length > 0 ? ids.join(' ') : undefined
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-auto">
      <Card
        ref={dialogRef}
        className="max-w-3xl w-full my-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="column-mapping-title"
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <CardHeader>
          <CardTitle id="column-mapping-title">{title}</CardTitle>
          <p className="text-sm text-muted">{description}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {assistiveNotice && (
            <div className="rounded-lg border border-guava-red/25 bg-guava-red/10 px-3 py-2 text-sm text-text" role="status">
              {assistiveNotice}
            </div>
          )}
          {headersMissing && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-200" role="alert">
              The original column headers for this file are no longer stored, so there is nothing to
              map. Upload the file again to change how its columns are read.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {CANONICAL_FIELDS.map(({ key, label, required }) => {
              const fieldRequired = required || (key === 'receiptId' && receiptRequired)
              const invalid = duplicateFields.has(key) || (key === 'receiptId' && Boolean(receiptRequirementMessage))
              return (
                <div key={key} className="contents">
                  <label htmlFor={`mapping-${key}`} className="text-sm text-text self-center">
                    {label}{fieldRequired && <span className="text-guava-red-text"> *</span>}
                  </label>
                  <div className="flex flex-col gap-1 min-w-0">
                    <select
                      id={`mapping-${key}`}
                      className="bg-[#111111] border border-border rounded-lg px-2 py-1 text-sm"
                      value={effectiveMapping[key] || ''}
                      aria-required={fieldRequired || undefined}
                      aria-invalid={invalid || undefined}
                      aria-describedby={describedBy(key)}
                      onChange={(e) => setField(key, e.target.value)}
                    >
                    <option value="">— none —</option>
                      {headers.map((h, index) => (
                        <option key={`${h}-${index}`} value={h}>{h}</option>
                      ))}
                    </select>
                    {firstValue(effectiveMapping[key]) !== undefined && (
                      <span id={`mapping-${key}-sample`} className="text-xs text-muted break-words">
                        Reads {firstValue(effectiveMapping[key])}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div>
            <label htmlFor="items-mode" className="text-sm text-text mr-3">Items mode:</label>
            <select
              id="items-mode"
              className="bg-[#111111] border border-border rounded-lg px-2 py-1 text-sm"
              value={itemsMode}
              onChange={(e) => setItemsMode(e.target.value as ItemsMode)}
            >
              <option value="packed">Packed (one row per receipt)</option>
              <option value="line-per-row">Line-per-row (one row per item)</option>
            </select>
          </div>

          {preview.length > 0 && (
            <div className="text-xs text-[#9E9E9E]">
              <p className="mb-2">Preview (first {preview.length} rows):</p>
              <div className="overflow-auto max-h-48 border border-border rounded-lg">
                <table className="text-xs w-full">
                  <thead className="bg-[#111111]">
                    <tr>{headers.map((h, index) => <th key={`${h}-${index}`} className="px-2 py-1 text-left">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        {headers.map((h, index) => <td key={`${h}-${index}`} className="px-2 py-1">{row[h]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {receiptRequirementMessage && (
            <div
              id="mapping-receipt-required"
              className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
              role="alert"
            >
              {receiptRequirementMessage}
            </div>
          )}

          {duplicateMappingMessage && (
            <div
              id="mapping-duplicate-columns"
              className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
              role="alert"
            >
              {duplicateMappingMessage}
            </div>
          )}

          {errorMessage && (
            <div className="rounded-lg border border-red-900/30 bg-red-900/10 px-3 py-2 text-sm text-red-400" role="alert">
              {errorMessage}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button
              variant="success"
              disabled={!requiredOk || isConfirming}
              onClick={handleConfirm}
            >
              {isConfirming ? 'Importing...' : confirmLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
