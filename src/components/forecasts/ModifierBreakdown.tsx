import { Cloud, Zap, Calendar, Banknote, Megaphone, Sparkles, Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Forecast } from '@/types'
import { classifyForecastFactors, formatPlan } from './factorState'

const ICONS: Record<string, ReactNode> = {
  weather: <Cloud className="w-3.5 h-3.5" />,
  loadShedding: <Zap className="w-3.5 h-3.5" />,
  holiday: <Calendar className="w-3.5 h-3.5" />,
  payday: <Banknote className="w-3.5 h-3.5" />,
  events: <Megaphone className="w-3.5 h-3.5" />,
  tradingHours: <Clock className="w-3.5 h-3.5" />,
  learning: <Sparkles className="w-3.5 h-3.5" />,
}

interface Props {
  forecast: Pick<Forecast, 'factors' | 'factorEntitlements' | 'factorSettings'>
  /** One sentence naming what the number is actually built from. */
  basis?: string | null
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/**
 * Answers "why this number?" by leading with what produced it.
 *
 * The section used to list only what did *not* happen. Seven rows reading
 * "no effect" is the whole explanation an owner got before committing several
 * thousand rand of stock, and it said nothing about the weighted average that
 * actually produced the figure. Now the basis comes first, the factors that
 * moved the number follow, and everything inert collapses into one line that
 * distinguishes a plan-locked factor from one the owner switched off from one
 * that simply had nothing to do today.
 */
export function ModifierBreakdown({ forecast, basis }: Props) {
  const classified = classifyForecastFactors(forecast)
  const applied = classified.filter((factor) => factor.state === 'active')
  const locked = classified.filter((factor) => factor.state === 'locked')
  const off = classified.filter((factor) => factor.state === 'off')
  const neutral = classified.filter((factor) => factor.state === 'neutral')

  const lockedByPlan = new Map<string, string[]>()
  locked.forEach((factor) => {
    const plan = formatPlan(factor.requiredPlan) || 'a higher plan'
    lockedByPlan.set(plan, [...(lockedByPlan.get(plan) ?? []), factor.label])
  })

  return (
    <div className="space-y-2">
      {basis && (
        <div className="rounded-lg border border-border bg-[#111111] px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Built from</p>
          <p className="mt-1 text-xs text-text">{basis}</p>
        </div>
      )}

      {classified.length === 0 ? (
        <p className="text-xs text-muted">Factor detail is unavailable for this forecast.</p>
      ) : null}

      {applied.map((factor) => {
        const positive =
          factor.adjustmentPct == null
            ? null
            : factor.adjustmentPct > 0
              ? true
              : factor.adjustmentPct < 0
                ? false
                : null
        const tone = positive === false ? 'text-guava-red-text' : 'text-guava-green'
        return (
          <div key={factor.key} className="flex items-center gap-3 py-1.5">
            <span className={tone}>{ICONS[factor.key] ?? <Megaphone className="w-3.5 h-3.5" />}</span>
            <span className="text-xs font-medium w-24 shrink-0 text-text">{factor.label}</span>
            <span className={`text-xs ${tone}`}>
              {factor.effect ?? 'applied'}
              {factor.reason ? <span className="text-muted"> - {factor.reason}</span> : null}
            </span>
          </div>
        )
      })}

      {classified.length > 0 && applied.length === 0 && (
        <p className="text-xs text-muted">
          No factor moved this number today — it is the history above, unadjusted.
        </p>
      )}

      {neutral.length > 0 && (
        <p className="text-xs text-muted">
          Nothing else applied: {joinLabels(neutral.map((factor) => factor.label))}{' '}
          {neutral.length === 1 ? 'was' : 'were'} evaluated and had no effect today.
        </p>
      )}

      {off.length > 0 && (
        <p className="text-xs text-muted">
          Switched off in factor rules: {joinLabels(off.map((factor) => factor.label))}.
        </p>
      )}

      {[...lockedByPlan.entries()].map(([plan, labels]) => (
        <p key={plan} className="text-xs text-muted">
          Not on your plan — {joinLabels(labels)} {labels.length === 1 ? 'unlocks' : 'unlock'} on {plan},
          so {labels.length === 1 ? 'it was' : 'they were'} never evaluated for this day.
        </p>
      ))}
    </div>
  )
}
