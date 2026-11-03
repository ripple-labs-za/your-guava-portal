import { Sparkles, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type {
  Forecast,
  ForecastFactorEntitlement,
  ForecastFactorEntitlements,
  ForecastFactorSettings,
  ForecastHistoryRow,
} from '@/types'

type ForecastLearningSource = Pick<Forecast, 'date' | 'calibration' | 'factors'>
type HistoryLearningSource = Pick<ForecastHistoryRow, 'date' | 'calibration' | 'activeFactors'>
type LearningSource = ForecastLearningSource | HistoryLearningSource

interface ModelLearningPanelProps {
  sources: LearningSource[]
  entitlements?: ForecastFactorEntitlements | null
  settings?: ForecastFactorSettings | null
  compact?: boolean
  /**
   * The source request failed rather than returning nothing.
   *
   * An empty `sources` array previously fell through to "Waiting for history —
   * at least 3 matched item outcomes are needed", which is a factual claim
   * about the cafe's model. When /forecasts/week 5xx'd, that claim was simply
   * false, and it sat directly under the page's own banner saying empty values
   * below do not mean the data is empty.
   */
  unavailable?: boolean
}

const formatPct = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(Number(value))) return '-'
  const number = Number(value)
  return `${number > 0 ? '+' : ''}${number.toFixed(1)}%`
}

const correctionFromMultiplier = (multiplier?: number | null) =>
  multiplier == null ? null : (Number(multiplier) - 1) * 100

const isForecastSource = (source: LearningSource): source is ForecastLearningSource => 'factors' in source

const sourceFactors = (source: LearningSource) =>
  isForecastSource(source) ? source.factors || [] : source.activeFactors || []

const sourceDate = (source: LearningSource) => new Date(source.date).getTime()

const latestLearningSource = (sources: LearningSource[]) =>
  [...sources]
    .filter((source) => source.calibration)
    .sort((a, b) => sourceDate(b) - sourceDate(a))[0] || sources[0]

const topCorrections = <T extends { multiplier: number; sampleSize: number }>(
  entries: T[] | undefined,
  labelFor: (entry: T) => string
) =>
  [...(entries || [])]
    .sort((a, b) => Math.abs(correctionFromMultiplier(b.multiplier) || 0) - Math.abs(correctionFromMultiplier(a.multiplier) || 0))
    .slice(0, 3)
    .map((entry) => ({
      label: labelFor(entry),
      correction: correctionFromMultiplier(entry.multiplier),
      sampleSize: entry.sampleSize,
    }))

export function ModelLearningPanel({
  sources,
  entitlements,
  settings,
  compact = false,
  unavailable = false,
}: ModelLearningPanelProps) {
  const learningEntitlement = entitlements?.factors.find((factor: ForecastFactorEntitlement) => factor.key === 'learning')
  // Fails closed (#116): item and factor corrections are shown as applying only when the plan explicitly unlocks them.
  // A missing or unloaded entitlement is locked, never unlocked by default.
  const detailedUnlocked = learningEntitlement?.unlocked === true
  const learningEnabled = settings?.learning.enabled ?? true
  const snapshot = latestLearningSource(sources)
  const calibration = snapshot?.calibration
  const learningFactor = snapshot ? sourceFactors(snapshot).find((factor) => factor.key === 'learning') : undefined
  const sampleSize = calibration?.sampleSize ?? 0
  const overallCorrection = correctionFromMultiplier(calibration?.overallMultiplier)
  // The overall correction runs on every plan (L-5); whether it is applying is read from the forecast itself.
  const active = Boolean(learningEnabled && learningFactor?.active)

  const itemCorrections = detailedUnlocked ? topCorrections(calibration?.itemMultipliers, (entry) => entry.itemName || 'Item') : []
  const factorCorrections = detailedUnlocked
    ? topCorrections(calibration?.factorMultipliers, (entry) => entry.label || entry.key || 'Factor')
    : []

  const status = unavailable
    ? { label: 'Status unavailable', variant: 'secondary' as const }
    : !learningEnabled
      ? { label: 'Off', variant: 'secondary' as const }
      : active
        ? { label: 'Applying correction', variant: 'success' as const }
        : sampleSize >= 3
          ? { label: 'Ready', variant: 'success' as const }
          : { label: 'Waiting for history', variant: 'warning' as const }

  const planNote = detailedUnlocked ? '' : ' Item and factor corrections are on the Pro plan.'
  const description = unavailable
    ? 'The forecast service could not be reached, so this is not a reading on your model.'
    : !learningEnabled
      ? 'Learning is disabled in factor rules.'
      : sampleSize < 3
        ? `At least 3 matched item outcomes are needed before the overall correction is applied.${planNote}`
        : `Future forecasts use recent prediction misses to correct overall demand.${planNote}`
  const lockedEmpty = 'On the Pro plan.'

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-guava-red/10 p-2 text-guava-red-text">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-text">Model Learning</p>
              <Badge variant={status.variant}>{status.label}</Badge>
              {!unavailable && !detailedUnlocked && <Badge variant="pro">Item and factor corrections: Pro</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted">{description}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:min-w-72">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#9E9E9E]">Overall correction</p>
            <p className={cn('mt-1 text-xl font-semibold', unavailable ? 'text-muted' : (overallCorrection || 0) >= 0 ? 'text-guava-green' : 'text-guava-red-text')}>
              {unavailable ? '-' : formatPct(overallCorrection)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-[#9E9E9E]">Learning samples</p>
            <p className={cn('mt-1 text-xl font-semibold', unavailable ? 'text-muted' : 'text-text')}>
              {unavailable ? '-' : sampleSize}
            </p>
          </div>
        </div>
      </div>

      {!compact && (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <CorrectionList
            title="Item corrections"
            corrections={unavailable ? [] : itemCorrections}
            empty={unavailable ? 'Could not be loaded.' : detailedUnlocked ? 'No item-specific corrections yet.' : lockedEmpty}
          />
          <CorrectionList
            title="Factor corrections"
            corrections={unavailable ? [] : factorCorrections}
            empty={unavailable ? 'Could not be loaded.' : detailedUnlocked ? 'No factor-specific corrections yet.' : lockedEmpty}
          />
        </div>
      )}
    </div>
  )
}

function CorrectionList({
  title,
  corrections,
  empty,
}: {
  title: string
  corrections: { label: string; correction: number | null; sampleSize: number }[]
  empty: string
}) {
  return (
    <div className="rounded-lg border border-border bg-[#111111] p-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-3.5 w-3.5 text-[#9E9E9E]" />
        <p className="text-sm font-medium text-text">{title}</p>
      </div>
      <div className="mt-3 space-y-2">
        {corrections.length === 0 ? (
          <p className="text-xs text-muted">{empty}</p>
        ) : (
          corrections.map((entry) => (
            <div key={entry.label} className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-muted">{entry.label}</span>
              <span className={cn('font-semibold', (entry.correction || 0) >= 0 ? 'text-guava-green' : 'text-guava-red-text')}>
                {formatPct(entry.correction)}
                <span className="ml-1 font-normal text-muted">({entry.sampleSize})</span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
