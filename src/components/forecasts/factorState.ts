import type { Forecast, ForecastFactorSettings } from '@/types'

/**
 * One classification of a forecast's factors, shared by Today's impact gauges
 * and the Planning drawer's "Why this prediction?".
 *
 * Three states look identical if you only read `factor.active`: a factor the
 * plan does not include, one the owner switched off in factor rules, and one
 * that ran and happened to move nothing today. The drawer used to render all
 * three as a muted "no effect", so a Starter customer concluded payday did not
 * matter this week when in truth it was never evaluated. Today's dashboard
 * already told them the opposite. Keeping the rule in one place is what stops
 * the two surfaces disagreeing about the same forecast.
 */
export type FactorState = 'active' | 'locked' | 'off' | 'neutral'

export const FORECAST_FACTOR_ORDER = ['weather', 'loadShedding', 'holiday', 'payday', 'events', 'tradingHours', 'learning']

const FACTOR_SECTIONS: Record<string, keyof ForecastFactorSettings> = {
  weather: 'weather',
  loadShedding: 'loadShedding',
  holiday: 'holiday',
  payday: 'payday',
  events: 'events',
  learning: 'learning',
}

export function formatPlan(plan?: string): string {
  if (!plan) return ''
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

export interface ClassifiedFactor {
  key: string
  label: string
  state: FactorState
  adjustmentPct?: number | null
  effect?: string
  reason?: string
  requiredPlan?: string
  /** The one sentence that explains this state to the owner. */
  detail: string
}

type FactorSource = Pick<Forecast, 'factors' | 'factorEntitlements' | 'factorSettings'>

export function classifyForecastFactors(forecast: FactorSource): ClassifiedFactor[] {
  const sourceFactors = forecast.factors ?? []
  const sourceByKey = new Map(sourceFactors.map((factor) => [factor.key, factor]))
  const ordered = FORECAST_FACTOR_ORDER
    .map((key) => sourceByKey.get(key))
    .filter(Boolean) as NonNullable<Forecast['factors']>
  const entitlementsByKey = new Map(
    (forecast.factorEntitlements?.factors ?? []).map((factor) => [factor.key, factor])
  )

  return (ordered.length > 0 ? ordered : sourceFactors).map((factor) => {
    const entitlement = entitlementsByKey.get(factor.key)
    const locked = entitlement ? !entitlement.unlocked : false
    const section = FACTOR_SECTIONS[factor.key]
    const sectionSettings = section ? forecast.factorSettings?.[section] : undefined
    const configuredOn = sectionSettings && 'enabled' in sectionSettings ? sectionSettings.enabled !== false : true
    const off = !locked && !configuredOn
    const active = Boolean(factor.active && !locked && !off)
    const state: FactorState = locked ? 'locked' : off ? 'off' : active ? 'active' : 'neutral'

    return {
      key: factor.key,
      label: factor.label,
      state,
      adjustmentPct: factor.adjustmentPct,
      effect: factor.effect,
      reason: factor.reason,
      requiredPlan: entitlement?.requiredPlan,
      detail:
        state === 'locked'
          ? `Unlock on ${formatPlan(entitlement?.requiredPlan)}`
          : state === 'off'
            ? 'Disabled in factor rules'
            : state === 'active'
              ? factor.effect || factor.reason || 'Applied to this forecast'
              : factor.reason || 'No effect on this forecast',
    }
  })
}
