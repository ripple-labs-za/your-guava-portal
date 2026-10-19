const HOSTED_CHECKOUT_NOTE =
  'Guava stores only the billing status, payment reference, and masked card metadata after confirmation.'
const GATEWAY_COPY = {
  paystack: `Card details are captured by Paystack's hosted checkout. ${HOSTED_CHECKOUT_NOTE}`,
  onegate: `Card details are captured by OneGate's hosted checkout. ${HOSTED_CHECKOUT_NOTE}`,
  mock: 'Mock billing is on: no card is charged and nothing leaves this environment. It exists only on test environments.',
}
const NEUTRAL_COPY = `Your payment provider handles card details through secure checkout. ${HOSTED_CHECKOUT_NOTE}`

/** Only an explicit null reports missing configuration; absent or newer providers stay neutral. */
export function gatewayCopy(provider: unknown): string {
  if (provider === null) return 'Card payments are not configured on this environment, so plans and credit packs cannot be bought here.'
  return typeof provider === 'string' && Object.prototype.hasOwnProperty.call(GATEWAY_COPY, provider)
    ? GATEWAY_COPY[provider as keyof typeof GATEWAY_COPY]
    : NEUTRAL_COPY
}

const PROVIDER_LABEL = { paystack: 'Paystack', onegate: 'OneGate', mock: 'mock billing' }

/** "Visa ending 4242 · Paystack": the card on file, capitalised, with the provider that took it when the API names one (BE-13-T03). */
export function cardOnFileLabel(method: { brand?: string; last4?: string; provider?: string }): string {
  const brand = method.brand ? method.brand.charAt(0).toUpperCase() + method.brand.slice(1) : 'Card'
  const provider = typeof method.provider === 'string' && Object.prototype.hasOwnProperty.call(PROVIDER_LABEL, method.provider)
    ? PROVIDER_LABEL[method.provider as keyof typeof PROVIDER_LABEL]
    : null
  return `${brand} ${method.last4 ? `ending ${method.last4}` : 'on file'}${provider ? ` · ${provider}` : ''}`
}
