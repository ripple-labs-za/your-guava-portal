import { describe, it, expect } from 'vitest'
import { cardOnFileLabel, gatewayCopy } from './billingProvider'

describe('cardOnFileLabel', () => {
  it('names the brand, the last four digits and the provider', () => {
    expect(cardOnFileLabel({ brand: 'visa', last4: '4242', provider: 'paystack' })).toBe('Visa ending 4242 · Paystack')
    expect(cardOnFileLabel({ brand: 'mastercard', last4: '0005' })).toBe('Mastercard ending 0005')
  })

  it('never prints "ending undefined" when the last four digits are missing', () => {
    expect(cardOnFileLabel({ brand: '', last4: '' })).toBe('Card on file')
    expect(cardOnFileLabel({ brand: 'visa', last4: '', provider: 'onegate' })).toBe('Visa on file · OneGate')
  })
})

describe('billing provider copy', () => {
  it.each(['stripe', 'constructor', '__proto__', undefined])('uses neutral copy for unknown or absent provider %s', (provider) => {
    expect(gatewayCopy(provider)).toMatch(/payment provider handles card details/i)
    expect(gatewayCopy(provider)).not.toMatch(/not configured|OneGate|Paystack|Loading/)
  })
  it('reserves unconfigured copy for explicit null', () => {
    expect(gatewayCopy(null)).toMatch(/not configured/)
    expect(gatewayCopy('paystack')).toMatch(/Paystack/)
    expect(gatewayCopy('onegate')).toMatch(/OneGate/)
    expect(gatewayCopy('mock')).toMatch(/Mock billing is on/)
  })
})
