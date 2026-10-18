import { describe, it, expect } from 'vitest'
import { gatewayCopy } from './billingProvider'

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
