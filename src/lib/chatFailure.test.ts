import { describe, expect, it } from 'vitest'
import { chatFailureCopy, chatFailureFrom, chatRequestErrorFrom, chatFailureFromStreamEvent, ChatRequestError, savedChatFailureNotice } from './chatFailure'

describe('provider failure boundary', () => {
  it('maps a non-retryable HTTP 502 and renders the server explanation', async () => {
    const error = await chatRequestErrorFrom(new Response(JSON.stringify({
      message: 'The provider credentials need fixing.', details: { retryable: false },
    }), { status: 502 }))
    const failure = chatFailureFrom(error, false)
    expect(failure.kind).toBe('provider-rejected')
    expect(chatFailureCopy(failure)).toMatchObject({ detail: 'The provider credentials need fixing.', action: null })
  })
  it.each([true, false])('maps a non-retryable axios 502 with delivered=%s', (delivered) => {
    const failure = chatFailureFrom({ response: { status: 502, data: {
      message: 'Provider rejected the request.', details: { retryable: false },
    } } }, false, delivered)
    expect(failure).toMatchObject({ kind: 'provider-rejected', charged: delivered, serverMessage: 'Provider rejected the request.' })
    expect(chatFailureCopy(failure).action?.label ?? null).toBe(delivered ? 'Load the full answer (no extra charge)' : null)
  })
  it('keeps an unknown charge on a non-retryable stream failure with no paid retry', () => {
    const failure = chatFailureFromStreamEvent({ retryable: false, charged: null, message: 'Check credentials.' })
    expect(failure).toMatchObject({ kind: 'provider-rejected', charged: null })
    expect(chatFailureFrom(new ChatRequestError(failure, 'failed'), false, true).charged).toBeNull()
    expect(chatFailureCopy(failure)).toMatchObject({ title: 'Charge not confirmed', action: null })
  })
  it.each(['', '   ', null, 17])('ignores an invalid server message: %s', (message) => {
    const failure = chatFailureFromStreamEvent({ retryable: false, charged: false, message })
    expect(failure.serverMessage).toBeUndefined()
    expect(chatFailureCopy(failure).detail).toBe('The AI service could not accept this request.')
  })
  it.each(['AI_PROVIDER_TIMEOUT', 'AI_PROVIDER_BUSY', 'AI_PROVIDER_UNAVAILABLE'])('explains the confirmed refund for %s', (code) => {
    const failure = chatFailureFromStreamEvent({ code, retryable: true, charged: false })
    expect(chatFailureCopy(failure).detail).toContain('Nothing was charged')
  })
})

describe('charge recovery copy', () => {
  it.each([
    Object.assign(new Error('aborted'), { name: 'AbortError' }),
    { response: { status: 503 } },
  ])('does not call an inferred undelivered failure refunded: %j', (error) => {
    const failure = chatFailureFrom(error, false, false)
    expect(chatFailureCopy(failure).detail).not.toMatch(/nothing was charged|no credits were charged/i)
    expect(chatFailureCopy(failure).detail).toContain('Anything above this line')
  })
  it('keeps the provider rejection reason under an unknown charge', () => {
    const failure = chatFailureFromStreamEvent({ retryable: false, charged: null, message: 'The provider credentials need fixing.' })
    expect(chatFailureCopy(failure)).toMatchObject({ title: 'Charge not confirmed', detail: expect.stringContaining('The provider credentials need fixing.'), action: null })
  })
  it.each(['cafe-access', 'invalid-request'])('maps the axios %s refusal', (kind) => {
    const status = kind === 'cafe-access' ? 403 : 400
    const code = kind === 'cafe-access' ? 'CAFE_ACCESS_REVOKED' : 'AI_CHAT_INVALID_INPUT'
    expect(chatFailureFrom({ response: { status, data: { details: { code } } } }, false).kind).toBe(kind)
  })
  it('names a saved-chat throttle and uses the response wait', () => {
    expect(savedChatFailureNotice({ response: { status: 429, data: { code: 'CHAT_RATE_LIMITED' }, headers: { 'retry-after': '17' } } }))
      .toMatch(/17 seconds/)
  })
  it('carries the saved-chat Retry-After into the failure used by the bubble and composer', () => {
    const failure = chatFailureFrom({ response: {
      status: 429, data: { code: 'CHAT_RATE_LIMITED' }, headers: { 'retry-after': '17' },
    } }, false)
    expect(failure).toMatchObject({ kind: 'rate-limited', retryAfterSeconds: 17, charged: false })
    expect(chatFailureCopy(failure).detail).toMatch(/wait 17 seconds/i)
  })
  it.each([401, 402, 403, 429, 503])('preserves delivered charge on status %s', (status) => {
    const failure = chatFailureFrom({ response: { status } }, false, true)
    expect(failure.charged).toBe(true)
    expect(chatFailureCopy(failure).action?.label).toBe('Load the full answer (no extra charge)')
  })
  it.each([null, undefined])('never calls an unconfirmed server charge free: %s', (charged) => {
    const failure = chatFailureFrom(new ChatRequestError({ kind: 'transient', charged }, 'stopped'), false)
    expect(chatFailureCopy(failure).detail).toMatch(/could not be confirmed/)
    expect(chatFailureCopy(failure).detail).not.toMatch(/nothing was charged/i)
  })
  it('uses the server amount and softens an undelivered Stop', () => {
    expect(chatFailureCopy({ kind: 'interrupted', charged: true, credits: 7 }).detail).toContain('7 credits')
    expect(chatFailureCopy({ kind: 'cancelled', charged: false }).detail).toContain('No answer text had arrived')
  })
})

describe('oversized chat requests', () => {
  const detail = 'That message is too long to send. Shorten it and try again. Nothing was charged.'
  it.each([
    [413, {}],
    [400, { details: { code: 'PAYLOAD_TOO_LARGE' } }],
  ])('refuses a stream HTTP %s without offering a paid retry', async (status, body) => {
    const error = await chatRequestErrorFrom(new Response(JSON.stringify(body), { status }))
    const failure = chatFailureFrom(error, false)
    expect(failure).toMatchObject({ kind: 'payload-too-large', charged: false })
    expect(chatFailureCopy(failure)).toMatchObject({ detail, action: null })
  })
  it.each([
    { status: 413 },
    { status: 400, data: { details: { code: 'PAYLOAD_TOO_LARGE' } } },
  ])('maps the saved-chat length failure into the shared notice: %j', (response) => {
    expect(savedChatFailureNotice({ response })).toContain('too long to save to your account')
    expect(chatFailureCopy(chatFailureFrom({ response }, false))).toMatchObject({ detail, action: null })
  })
})


describe('read-only billing refusals', () => {
  const billing = { readOnly: true, status: 'grace', graceEndsAt: '2026-10-04T22:30:00Z' }
  it('explains a streaming grace 402 before considering credit balance', async () => {
    const error = await chatRequestErrorFrom(new Response(JSON.stringify({ code: 'BILLING_REQUIRED', billing }), { status: 402 }))
    const failure = chatFailureFrom(error, false)
    expect(failure).toMatchObject({ kind: 'billing-read-only', charged: false })
    expect(chatFailureCopy(failure)).toMatchObject({
      detail: 'Read-only until 05 Oct 2026. Renew in Billing.',
      action: { kind: 'link', to: '/settings?section=billing' },
    })
  })
  it('explains an Axios usage-envelope grace 402', () => {
    const failure = chatFailureFrom({ response: { status: 402, data: { details: {
      ...billing, billingStatus: 'grace', code: 'BILLING_REQUIRED',
    } } } }, false)
    expect(failure.kind).toBe('billing-read-only')
    expect(chatFailureCopy(failure).title).toBe('Guava is read-only')
    expect(chatFailureCopy(failure).detail).not.toMatch(/out of|balance|credits/i)
  })
})
