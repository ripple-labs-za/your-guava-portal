import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ModelLearningPanel } from './ModelLearningPanel'
import type { ForecastFactorEntitlements, ForecastFactorSettings } from '@/types'

const settings: ForecastFactorSettings = {
  history: { maxWeeks: 8, recentWeights: [], twoWeekWeights: [] },
  weather: {
    enabled: true, hotTemp: 27, coldTemp: 18, hotColdDrinkPct: 30, hotCoffeePct: -10,
    coldCoffeePct: 15, coldColdDrinkPct: -20, rainPct: -10, minimumMultiplier: 0.1,
  },
  loadShedding: { enabled: true, stage1To2Pct: -8, stage3To4Pct: -22, stage5PlusPct: -40 },
  holiday: { enabled: true, publicPct: 15, schoolPct: 8, combinedPct: 20 },
  payday: { enabled: true, pct: 20 },
  events: { enabled: true, lowPct: 10, mediumPct: 20, highPct: 35 },
  stock: { safetyMarginPct: 10, maxBiasPct: 50 },
  learning: { enabled: true },
}

const lockedEntitlements: ForecastFactorEntitlements = {
  plan: 'starter',
  factors: [
    { key: 'learning', label: 'Learning correction', section: 'learning', requiredPlan: 'pro', summary: '', unlocked: false },
  ],
  unlockedKeys: [],
  lockedKeys: ['learning'],
}

describe('ModelLearningPanel', () => {
  it('does not report a failed request as a verdict on the cafe', () => {
    render(<ModelLearningPanel sources={[]} settings={settings} unavailable />)

    expect(screen.getByText('Status unavailable')).toBeInTheDocument()
    expect(screen.getByText(/forecast service could not be reached/i)).toBeInTheDocument()
    expect(screen.queryByText('Waiting for history')).not.toBeInTheDocument()
    expect(screen.queryByText(/at least 3 matched item outcomes/i)).not.toBeInTheDocument()
  })

  it('still says the cafe is waiting when the request genuinely returned nothing', () => {
    render(<ModelLearningPanel sources={[]} settings={settings} />)

    expect(screen.getByText('Waiting for history')).toBeInTheDocument()
    expect(screen.getByText(/at least 3 matched item outcomes/i)).toBeInTheDocument()
  })

  // L-5: the overall correction runs on every plan, so a Starter cafe sees its own history verdict, with only the item and
  // factor corrections marked as Pro.
  it('runs the overall correction on every plan and marks only item and factor corrections as Pro', () => {
    render(<ModelLearningPanel sources={[]} settings={settings} entitlements={lockedEntitlements} />)

    expect(screen.getByText('Waiting for history')).toBeInTheDocument()
    expect(screen.getByText('Item and factor corrections: Pro')).toBeInTheDocument()
    expect(screen.getByText(/Overall correction on; per-factor and per-item learning on Pro\./)).toBeInTheDocument()
    expect(screen.getAllByText('On the Pro plan.')).toHaveLength(2)
  })

  // W-04: below Pro the stored learning switch is a plan default the engine ignores, so it never reads as Off.
  it('shows the overall correction as on below Pro even when the stored switch is off', () => {
    render(<ModelLearningPanel sources={[]} settings={{ ...settings, learning: { enabled: false } }} entitlements={lockedEntitlements} />)

    expect(screen.queryByText('Off')).not.toBeInTheDocument()
    expect(screen.queryByText(/disabled in factor rules/i)).not.toBeInTheDocument()
    expect(screen.getByText('Waiting for history')).toBeInTheDocument()
  })

  // #116: a missing entitlement is locked, never unlocked by default.
  it('fails closed when the entitlements are absent', () => {
    const sources = [{
      date: '2026-11-02',
      factors: [],
      calibration: {
        sampleSize: 12, overallMultiplier: 1.05,
        itemMultipliers: [{ itemName: 'Flat White', multiplier: 1.2, sampleSize: 6 }],
        factorMultipliers: [{ key: 'payday', label: 'Payday', multiplier: 0.9, sampleSize: 4 }],
      },
    }] as unknown as Parameters<typeof ModelLearningPanel>[0]['sources']
    render(<ModelLearningPanel sources={sources} settings={settings} />)

    expect(screen.getByText('Item and factor corrections: Pro')).toBeInTheDocument()
    expect(screen.queryByText('Flat White')).not.toBeInTheDocument()
    expect(screen.queryByText('Payday')).not.toBeInTheDocument()
  })

  // On Pro the stored switch is the owner's choice (W-04), so switching it off reads as Off.
  it('reports learning switched off in factor rules on Pro', () => {
    const proEntitlements: ForecastFactorEntitlements = {
      ...lockedEntitlements,
      plan: 'pro',
      factors: [{ ...lockedEntitlements.factors[0], unlocked: true }],
      unlockedKeys: ['learning'],
      lockedKeys: [],
    }
    render(
      <ModelLearningPanel
        sources={[]}
        settings={{ ...settings, learning: { enabled: false } }}
        entitlements={proEntitlements}
      />
    )

    expect(screen.getByText('Off')).toBeInTheDocument()
    expect(screen.getByText(/disabled in factor rules/i)).toBeInTheDocument()
  })
})
