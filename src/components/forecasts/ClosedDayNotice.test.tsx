import { describe, it, expect } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { ClosedDayNotice } from './ClosedDayNotice'

// WCAG relative luminance and contrast, for the colours this notice is drawn in.
const channel = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// The notice's amber tint over Planning's day card computes to #312c22 (axe, UAT-05-S05). The link was
// --color-guava-red-text #E76161 there: 4.14:1, under AA (FB-012). --color-guava-yellow is #FFD166.
const TINTED_GROUND = '#312c22'

const contradicted = {
  status: 'closed' as const,
  contradictsHistory: true,
  reason: 'Cafe is closed in its trading hours, but 377 sales were recorded on this weekday in the last 8 weeks.',
}

describe('ClosedDayNotice', () => {
  it('links to the trading hours in a colour that reads at AA on its own tint', () => {
    render(<ClosedDayNotice availability={contradicted as never} />)

    const link = screen.getByRole('link', { name: 'Open trading hours' })
    expect(link).toHaveAttribute('href', '/settings?section=general')
    expect(link.className).toContain('text-guava-yellow')
    expect(link.className).not.toContain('text-guava-red-text')
    expect(contrast('#FFD166', TINTED_GROUND)).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#E76161', TINTED_GROUND)).toBeLessThan(4.5) // the colour it replaces, measured
  })

  it('keeps the link distinguishable from the reason without relying on colour alone', () => {
    render(<ClosedDayNotice availability={contradicted as never} />)

    expect(screen.getByRole('link', { name: 'Open trading hours' }).className).toMatch(/(^|\s)underline(\s|$)/)
  })

  it('renders nothing for a closure the sales record agrees with', () => {
    render(<ClosedDayNotice availability={{ ...contradicted, contradictsHistory: false } as never} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open trading hours' })).toBeNull()
  })
})
