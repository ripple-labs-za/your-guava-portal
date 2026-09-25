// One Fix Imports card: a POS name that needs a match or a price decision (split out of MenuItems by BE-03-T14).
import type { ReactNode } from 'react'
import { CheckCircle, EyeOff, Link2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { SalesItem, SalesItemCategory } from '@/types'
import {
  CATEGORIES, ConflictNotice, StatusPill, formatZar, hasPriceIssue, suggestedPrice, suggestionLabel, type ItemDraft,
} from './menuItemDisplay'

export type ResolveAction = 'confirm' | 'ignore' | 'map_to'

interface ReviewItemCardProps {
  item: SalesItem
  draft: ItemDraft
  conflict?: ItemDraft
  saving: boolean
  aiReviewing: boolean
  canSpendCredits: boolean
  mapTarget: string
  targetOptions: ReactNode
  onEdit: (patch: Partial<ItemDraft>) => void
  onResolve: (action: ResolveAction, priceOverride?: number) => void
  onTakeServer: () => void
  onAiReview: () => void
  onApprove: () => void
  onMapTarget: (id: string) => void
}

export function ReviewItemCard({
  item, draft, conflict, saving, aiReviewing, canSpendCredits, mapTarget, targetOptions,
  onEdit, onResolve, onTakeServer, onAiReview, onApprove, onMapTarget,
}: ReviewItemCardProps) {
  const priceIssue = hasPriceIssue(item)
  const posPrice = suggestedPrice(item)
  const suggestedMatch = item.reviewStatus === 'needs_review' ? item.candidates?.[0] : undefined
  const aiSuggestion = item.aiSuggestion
  return (
    <div className="rounded-lg border border-border bg-[#111111] p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted">POS item</p>
          <div className="flex items-center gap-2 mb-2">
            <p className="truncate text-sm font-semibold text-text">{item.name}</p>
            <StatusPill item={item} />
          </div>
          {suggestedMatch && (
            <p className="mb-2 text-xs text-muted">
              Suggested match <span className="text-text">{suggestedMatch.item.name}</span>
            </p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-muted">
            <span>Sold {item.totalSold ?? 0}</span>
            <span>POS average {formatZar(item.avgPrice)}</span>
            <span>POS range {formatZar(item.observedPriceMin)} - {formatZar(item.observedPriceMax)}</span>
            <span>Menu price {formatZar(item.expectedPrice)}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:w-[640px] gap-2">
          <select
            aria-label={`Category for ${item.name}`}
            className="rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text"
            value={draft.category}
            onChange={(event) => onEdit({ category: event.target.value as SalesItemCategory })}
          >
            {CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
          </select>
          <Input
            aria-label={`Menu price for ${item.name}`}
            type="number"
            min={0}
            step="0.01"
            value={draft.expectedPrice}
            onChange={(event) => onEdit({ expectedPrice: event.target.value })}
            placeholder="Menu price"
          />
          <Button
            aria-label={item.reviewStatus === 'needs_review'
              ? `Keep ${item.name} as a new menu item`
              : `Keep the menu price for ${item.name}`}
            onClick={() => onResolve('confirm')}
            disabled={saving}
          >
            <CheckCircle className="w-3.5 h-3.5" />
            {item.reviewStatus === 'needs_review' ? 'Keep as new item' : 'Keep menu price'}
          </Button>
          {priceIssue && posPrice != null && (
            <Button
              aria-label={`Use the POS price for ${item.name}`}
              variant="outline"
              onClick={() => onResolve('confirm', posPrice)}
              disabled={saving}
            >
              Use POS price
            </Button>
          )}
        </div>
      </div>

      {conflict && (
        <ConflictNotice itemName={item.name} onTakeServer={onTakeServer} />
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface/50 px-3 py-2">
        <p className="text-xs text-muted">
          Smart checks are free. An AI review uses 1 Guava credit for this item.
        </p>
        <Button
          aria-label={`Run AI review for ${item.name} (1 credit)`}
          variant="outline"
          size="sm"
          onClick={onAiReview}
          disabled={!canSpendCredits || aiReviewing}
          title={!canSpendCredits ? 'Your role cannot spend Guava credits' : undefined}
        >
          <Sparkles className={cn('h-3.5 w-3.5', aiReviewing && 'animate-pulse')} />
          {aiReviewing ? 'Reviewing...' : 'Run AI review (1 credit)'}
        </Button>
      </div>

      {aiSuggestion && (
        <div className="mt-3 rounded-lg border border-guava-green/20 bg-guava-green/10 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-guava-green" />
                <p className="text-sm font-semibold text-text">
                  {aiSuggestion.source === 'ai' ? 'AI recommendation' : 'Smart recommendation'}
                </p>
                <Badge variant="secondary">{Math.round((aiSuggestion.confidence || 0) * 100)}% confidence</Badge>
                <Badge variant={aiSuggestion.source === 'ai' ? 'success' : 'secondary'}>
                  {aiSuggestion.source === 'ai' ? 'AI' : 'Smart check'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-text">{suggestionLabel(item)}</p>
              <p className="mt-1 text-xs text-muted">{aiSuggestion.reason}</p>
            </div>
            <Button
              aria-label={`Approve the recommendation for ${item.name}`}
              onClick={onApprove}
              disabled={saving}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Approve
            </Button>
          </div>
        </div>
      )}

      {item.reviewStatus === 'needs_review' && (
        <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
          <select
            aria-label={`Link ${item.name} to an existing menu item`}
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text"
            value={mapTarget}
            onChange={(event) => onMapTarget(event.target.value)}
          >
            <option value="">Link to existing menu item...</option>
            {targetOptions}
          </select>
          <Button
            aria-label={`Link ${item.name} to the selected menu item`}
            variant="outline"
            onClick={() => onResolve('map_to')}
            disabled={saving}
          >
            <Link2 className="w-3.5 h-3.5" />
            Link
          </Button>
          <Button
            aria-label={`Ignore the POS item ${item.name}`}
            variant="ghost"
            onClick={() => onResolve('ignore')}
            disabled={saving}
          >
            <EyeOff className="w-3.5 h-3.5" />
            Ignore POS item
          </Button>
        </div>
      )}
    </div>
  )
}
