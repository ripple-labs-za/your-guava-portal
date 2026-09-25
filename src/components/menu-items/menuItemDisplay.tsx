// Pieces of the Menu Items page shared by its Fix Imports cards and its Menu Prices table (split out by BE-03-T14).
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { SalesItem, SalesItemCategory } from '@/types'

export type ItemDraft = { category: SalesItemCategory; expectedPrice: string; priceTolerancePct: string; aliases: string }

export const CATEGORIES: { value: SalesItemCategory; label: string }[] = [
  { value: 'coffee', label: 'Coffee' },
  { value: 'cold_drink', label: 'Cold drink' },
  { value: 'food', label: 'Food' },
  { value: 'water', label: 'Water' },
  { value: 'retail', label: 'Retail' },
  { value: 'other', label: 'Other' },
]

export function formatZar(value?: number) {
  if (value == null || Number.isNaN(Number(value))) return '-'
  return `R${Number(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function StatusPill({ item }: { item: SalesItem }) {
  const mismatch = (item.priceMismatchCount ?? 0) > 0 || Boolean(item.lastPriceMismatchAt)
  if (mismatch) return <Badge className="border-amber-500/25 bg-amber-500/10 text-amber-300">Price differs</Badge>
  if (item.reviewStatus === 'needs_review') return <Badge className="border-red-500/25 bg-red-500/10 text-red-300">Needs a match</Badge>
  if (item.reviewStatus === 'ignored') return <Badge variant="secondary">Ignored</Badge>
  return <Badge variant="success">Ready</Badge>
}

export function hasPriceIssue(item: SalesItem) {
  return (item.priceMismatchCount ?? 0) > 0 || Boolean(item.lastPriceMismatchAt)
}

export function suggestedPrice(item: SalesItem) {
  return item.lastObservedPrice ?? item.avgPrice ?? item.observedPriceMax ?? item.observedPriceMin
}

export function suggestionLabel(item: SalesItem) {
  const suggestion = item.aiSuggestion
  if (!suggestion) return ''
  if (suggestion.action === 'map_to') return `Link to ${suggestion.targetName || 'existing menu item'}`
  if (suggestion.action === 'ignore') return 'Ignore POS item'
  // "Use menu price X" collided with the "Menu price" field shown above it,
  // which holds the CURRENT price. This value is the proposed replacement.
  if (hasPriceIssue(item)) return `Change menu price to ${formatZar(suggestion.expectedPrice)}`
  return 'Keep as new menu item'
}

export function ConflictNotice({ itemName, onTakeServer }: { itemName: string; onTakeServer: () => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5">
      <p className="text-xs text-amber-200">
        Changed on the server since you started editing. Saving replaces the stored value with yours.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Use the stored value for ${itemName} and discard this edit`}
        onClick={onTakeServer}
      >
        Use theirs
      </Button>
    </div>
  )
}
