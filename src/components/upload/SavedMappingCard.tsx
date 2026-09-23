import { useEffect, useState } from 'react'
import { Columns3, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import api from '@/lib/api'
import type { ColumnMapping, SavedColumnMapping } from '@/types/upload'

// Field order and wording as the column wizard shows them, so an owner recognises the same fields here.
const FIELD_LABELS: { field: keyof ColumnMapping; label: string }[] = [
  { field: 'date', label: 'Date' },
  { field: 'items', label: 'Items' },
  { field: 'total', label: 'Total' },
  { field: 'time', label: 'Time' },
  { field: 'receiptId', label: 'Receipt' },
  { field: 'tip', label: 'Tip' },
  { field: 'discount', label: 'Discount' },
  { field: 'paymentMethod', label: 'Payment method' },
  { field: 'status', label: 'Status' },
  { field: 'quantity', label: 'Quantity' },
]

const savedOn = (savedAt: string | null) =>
  savedAt ? ` on ${new Date(savedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''

interface SavedMappingCardProps {
  /** Only the owner may forget the mapping (DELETE is owner-only). */
  canClear: boolean
  /** Bumped after each import: a confirm or a re-map can change the saved mapping. */
  refreshKey?: number
}

/**
 * The column mapping this cafe's non-Yoco files import with (BE-03-T05). It was saved by the first wizard import and
 * applied without asking, but nothing showed it or let the owner reset it, so a wrong mapping quietly repeated.
 */
export function SavedMappingCard({ canClear, refreshKey = 0 }: SavedMappingCardProps) {
  const [saved, setSaved] = useState<SavedColumnMapping | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const [forgetFailed, setForgetFailed] = useState(false)
  const [forgotten, setForgotten] = useState(false)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setLoadFailed(false)
    api.get<{ success: boolean; savedColumnMapping: SavedColumnMapping | null }>('/cafe/me/column-mapping', {
      signal: controller.signal,
    })
      .then(({ data }) => {
        if (!active) return
        setSaved(data.savedColumnMapping)
        if (data.savedColumnMapping) setForgotten(false)
      })
      .catch(() => { if (active && !controller.signal.aborted) setLoadFailed(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => {
      active = false
      controller.abort()
    }
  }, [refreshKey])

  const forget = async () => {
    setForgetting(true)
    setForgetFailed(false)
    try {
      await api.delete('/cafe/me/column-mapping')
      setSaved(null)
      setForgotten(true)
    } catch {
      setForgetFailed(true)
    } finally {
      setForgetting(false)
    }
  }

  const rows = saved ? FIELD_LABELS.filter(({ field }) => saved.mapping[field]) : []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Columns3 className="w-4 h-4 text-guava-red-text" aria-hidden="true" />
          <CardTitle>Saved column mapping</CardTitle>
        </div>
        <CardDescription>How Your Guava reads your till's export when it is not a Yoco file.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading...
          </div>
        )}
        {!loading && loadFailed && (
          <p role="alert" className="text-sm text-guava-red-text">The saved mapping could not be loaded.</p>
        )}
        {!loading && !loadFailed && saved && (
          <>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
              {rows.map(({ field, label }) => (
                <div key={field} className="contents">
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-foreground break-words">{saved.mapping[field]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-muted">
              {saved.sourceFileName ? `Saved from ${saved.sourceFileName}${savedOn(saved.savedAt)}. ` : ''}
              Files with exactly these columns import without asking.
            </p>
            {canClear && (
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={forget} disabled={forgetting}>
                {forgetting ? 'Forgetting…' : 'Forget this mapping'}
              </Button>
            )}
            {forgetFailed && (
              <p role="alert" className="mt-2 text-sm text-guava-red-text">Could not forget the saved mapping. Try again.</p>
            )}
          </>
        )}
        {!loading && !loadFailed && !saved && forgotten && (
          <p role="status" className="text-sm text-muted">
            Saved mapping forgotten. The next file that is not a Yoco export opens the column wizard.
          </p>
        )}
        {!loading && !loadFailed && !saved && !forgotten && (
          <p className="text-sm text-muted">
            No saved mapping. The next file that is not a Yoco export opens the column wizard, and the columns you confirm
            are remembered.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
