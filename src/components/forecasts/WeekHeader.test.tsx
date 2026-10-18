import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WeekHeader } from './WeekHeader'

describe('WeekHeader', () => {
  it('shows item-level accuracy beside the headline', () => {
    render(<WeekHeader weekTotal={1000} peakDay={null} accuracy={91} matchedDays={12} itemAccuracy={61.6} />)
    expect(screen.getByText('91%')).toBeInTheDocument()
    expect(screen.getByText('Per item: 62%')).toBeInTheDocument()
  })

  it('renders the server backtest caveat verbatim', () => {
    const note = "Backtests are scored with the weather that actually happened and today's menu prices, so they read better than live forecasts will."
    render(<WeekHeader weekTotal={1000} peakDay={null} accuracy={78} matchedDays={10} basis="backtest" basisNote={note} />)
    expect(screen.getByText(note)).toBeInTheDocument()
  })

  it('withholds the verdict until enough days have been matched', () => {
    render(<WeekHeader weekTotal={42100} peakDay={null} accuracy={88} matchedDays={1} />)

    expect(screen.getByText('88%')).toBeInTheDocument()
    // One lucky day is not a track record, and this is the number an owner uses
    // to decide whether to trust the whole product.
    expect(screen.queryByText('Strong')).not.toBeInTheDocument()
    expect(screen.getByText(/From 1 matched day — too few for a verdict yet/i)).toBeInTheDocument()
  })

  it('states the sample size once there is one worth stating', () => {
    render(<WeekHeader weekTotal={42100} peakDay={null} accuracy={88} matchedDays={12} />)

    expect(screen.getByText('88%')).toBeInTheDocument()
    expect(screen.getByText('Strong')).toBeInTheDocument()
    expect(screen.getByText('From 12 matched days')).toBeInTheDocument()
  })

  it('grades on the same band the day cards use', () => {
    // 82% is amber under DayCard's old >=85 rule and green under WeekHeader's
    // >=80 rule; one screenful used to show both readings of one number.
    render(<WeekHeader weekTotal={1000} peakDay={null} accuracy={82} matchedDays={10} />)
    expect(screen.getByText('Strong')).toBeInTheDocument()
  })

  it('says nothing about a sample it was not given', () => {
    render(<WeekHeader weekTotal={1000} peakDay={null} accuracy={88} />)
    expect(screen.getByText('Strong')).toBeInTheDocument()
    expect(screen.queryByText(/matched day/i)).not.toBeInTheDocument()
  })
  it('labels a backtest estimate rather than showing a blank screen', () => {
    // A new cafe that ran a backfill has real scored days. "Awaiting matched
    // sales data" for weeks afterwards is not honesty, it is a blank screen.
    render(
      <WeekHeader
        weekTotal={100000}
        peakDay={null}
        accuracy={78}
        matchedDays={10}
        basis="backtest"
      />
    )

    expect(screen.getByText('78%')).toBeInTheDocument()
    expect(screen.getByText(/estimated from 10 backtested days/i)).toBeInTheDocument()
    expect(screen.getByText(/not yet measured live/i)).toBeInTheDocument()
  })

  it('drops the label once the figure is measured live', () => {
    render(
      <WeekHeader
        weekTotal={100000}
        peakDay={null}
        accuracy={78}
        matchedDays={12}
        basis="live"
      />
    )

    expect(screen.getByText('78%')).toBeInTheDocument()
    expect(screen.getByText(/from 12 matched days/i)).toBeInTheDocument()
    expect(screen.queryByText(/backtest/i)).toBeNull()
  })

  it('still says nothing is matched when nothing is', () => {
    render(
      <WeekHeader weekTotal={100000} peakDay={null} accuracy={null} matchedDays={0} basis="none" />
    )

    expect(screen.getByText('Awaiting matched sales data')).toBeInTheDocument()
    expect(screen.queryByText(/backtest/i)).toBeNull()
  })
})
