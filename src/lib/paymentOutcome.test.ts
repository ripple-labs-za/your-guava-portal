import { describe, expect, it } from 'vitest'
import { paymentOutcome, withoutPaymentParams } from './paymentOutcome'

describe('payment outcomes', () => {
  it.each(['pending', 'processing', 'initializing', undefined] as const)('keeps %s open for reconciliation', (status) => {
    expect(paymentOutcome(status)).toMatchObject({ tone: 'info', terminal: false })
  })

  it.each(['paid', 'failed', 'cancelled', 'needs_attention', 'reversed'] as const)('settles %s without further polling', (status) => {
    expect(paymentOutcome(status).terminal).toBe(true)
  })

  it('gives a reference-based support next step for a held payment', () => {
    expect(paymentOutcome('needs_attention').message).toContain('Email support@yourguava.co.za with this reference')
  })

  it('removes payment parameters without mutating unrelated navigation or billing state', () => {
    const original = new URLSearchParams('section=billing&payment=pending&reference=ref&billing=required&keep=yes')
    expect(withoutPaymentParams(original).toString()).toBe('section=billing&billing=required&keep=yes')
    expect(withoutPaymentParams(original, true).toString()).toBe('section=billing&keep=yes')
    expect(original.get('reference')).toBe('ref')
  })
})
