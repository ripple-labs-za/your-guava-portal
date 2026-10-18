import { describe, expect, it } from 'vitest'
import { chatFailureCopy, chatFailureFrom, ChatRequestError, savedChatFailureNotice } from './chatFailure'

describe('charge recovery copy', () => {
  it.each(['cafe-access', 'invalid-request'])('maps the axios %s refusal', (kind) => {
    const status = kind === 'cafe-access' ? 403 : 400
    const code = kind === 'cafe-access' ? 'CAFE_ACCESS_REVOKED' : 'AI_CHAT_INVALID_INPUT'
    expect(chatFailureFrom({ response: { status, data: { details: { code } } } }, false).kind).toBe(kind)
  })
  it('names a saved-chat throttle and uses the response wait', () => {
    expect(savedChatFailureNotice({ response: { status: 429, data: { code: 'CHAT_RATE_LIMITED' }, headers: { 'retry-after': '17' } } }))
      .toMatch(/17 seconds/)
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
