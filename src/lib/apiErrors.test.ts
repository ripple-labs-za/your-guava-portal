import { describe, it, expect } from 'vitest'
import { API_ERROR_COPY, describeApiError, readApiError, readApiErrorResponse, waitSeconds } from './apiErrors'

// BE-13-T02: one reading of an API failure, and one entry of copy per backend client code.
const axiosError = (status: number, data: unknown, headers: Record<string, string> = {}) => ({ response: { status, data, headers } })

describe('API error copy', () => {
  it.each(Object.keys(API_ERROR_COPY))('%s has its own title, body and recovery', (code) => {
    const copy = describeApiError(readApiError(axiosError(400, { code })))
    expect(copy).toEqual(API_ERROR_COPY[code])
    expect(copy.title.trim().length).toBeGreaterThan(5)
    expect(copy.body.trim().length).toBeGreaterThan(10)
    expect(['link', 'retry', 'wait', 'page', 'none']).toContain(copy.action.kind)
  })

  it('never gives two codes the same words', () => {
    const seen = new Map<string, string>()
    for (const [code, copy] of Object.entries(API_ERROR_COPY)) {
      const key = `${copy.title}|${copy.body}`
      expect(seen.get(key)).toBeUndefined()
      seen.set(key, code)
    }
  })
})

describe('the codes the sprint names', () => {
  it('BILLING_REQUIRED sends the owner to billing whether the code is top level or in details', () => {
    for (const data of [{ code: 'BILLING_REQUIRED' }, { details: { code: 'BILLING_REQUIRED', reason: 'trial_expired' } }]) {
      const info = readApiError(axiosError(402, data))
      expect(info.code).toBe('BILLING_REQUIRED')
      expect(describeApiError(info).action).toEqual({ kind: 'link', label: 'Open billing', to: '/settings?section=billing' })
    }
  })

  it('INSUFFICIENT_CREDITS is not a lapsed subscription', () => {
    const credits = describeApiError(readApiError(axiosError(402, { code: 'INSUFFICIENT_CREDITS', details: { available: 1, required: 3 } })))
    const lapsed = describeApiError(readApiError(axiosError(402, { code: 'BILLING_REQUIRED' })))
    expect(credits.title).not.toBe(lapsed.title)
    expect(credits.action).toEqual({ kind: 'link', label: 'Buy Guava Credits', to: '/settings?section=billing' })
  })

  it('has no copy for the codes BE-02-T01 retired, so a stray one falls back to its status', () => {
    expect(API_ERROR_COPY.REGISTRATION_PENDING).toBeUndefined()
    expect(API_ERROR_COPY.TEAM_INVITATION_PENDING).toBeUndefined()
  })

  it('MAPPING_ALREADY_COMMITTED offers to reload the upload', () => {
    expect(describeApiError(readApiError(axiosError(409, { code: 'MAPPING_ALREADY_COMMITTED' }))).action)
      .toEqual({ kind: 'page', label: 'Reload this upload' })
  })

  it("SEVERE_PARTIAL_IMPORT keeps the server's row counts (D-009) and offers the partial import", () => {
    const message = '12 of 20 rows could not be parsed. Fix the mapping or explicitly allow a partial import.'
    const copy = describeApiError(readApiError(axiosError(422, { code: 'SEVERE_PARTIAL_IMPORT', message })))
    expect(copy.body).toBe(message)
    expect(copy.action).toEqual({ kind: 'page', label: 'Import only the valid rows' })
  })

  it('a 413 says what was too large, with or without a code', () => {
    const upload = describeApiError(readApiError(axiosError(413, { code: 'UPLOAD_TOO_LARGE', message: 'This file is larger than the 10 MB upload limit.' })))
    expect(upload.body).toMatch(/10 MB/)
    expect(describeApiError(readApiError(axiosError(413, { code: 'PAYLOAD_TOO_LARGE' }))).title).toMatch(/too much/i)
    expect(describeApiError(readApiError(axiosError(413, 'request entity too large'))).title).toMatch(/too large/i)
  })

  it('a 429 carries its Retry-After, as seconds or as a date, and falls back to 60 seconds', () => {
    expect(readApiError(axiosError(429, { code: 'UPLOAD_RATE_LIMITED' }, { 'retry-after': '45' })).retryAfterSeconds).toBe(45)
    const at = new Date(Date.now() + 30_000).toUTCString()
    const seconds = readApiError(axiosError(429, { code: 'AI_RATE_LIMITED' }, { 'retry-after': at })).retryAfterSeconds ?? 0
    expect(seconds).toBeGreaterThanOrEqual(29)
    expect(seconds).toBeLessThanOrEqual(31)
    const bare = readApiError(axiosError(429, { message: 'Too many requests' }))
    expect(bare.retryAfterSeconds).toBeNull()
    expect(waitSeconds(bare)).toBe(60)
    expect(describeApiError(bare).action.kind).toBe('wait')
  })

  it('the AI provider being down says nothing was charged and offers a retry', () => {
    const copy = describeApiError(readApiError(axiosError(503, {
      code: 'AI_PROVIDER_UNAVAILABLE',
      message: 'The AI service is temporarily unavailable. No credits were charged — please try again shortly.',
    })))
    expect(copy.title).toBe('The AI service is unavailable right now')
    expect(copy.body).toMatch(/no credits were charged/i)
    expect(copy.action.kind).toBe('retry')
  })

  it('never shows a redacted production message', () => {
    const copy = describeApiError(readApiError(axiosError(500, { message: 'Internal Server Error' })), { title: 'Could not save', body: 'Try again in a moment.' })
    expect(copy.body).toBe('Try again in a moment.')
  })

  it('treats a request with no response as offline', () => {
    const info = readApiError(new Error('Network Error'))
    expect(info.offline).toBe(true)
    expect(describeApiError(info).title).toMatch(/could not be reached/i)
  })

  it('reads a fetch Response the same way', async () => {
    const response = {
      status: 429,
      headers: new Headers({ 'Retry-After': '12', 'X-Request-Id': 'req-1' }),
      json: () => Promise.resolve({ code: 'AI_RATE_LIMITED', message: 'Too many AI requests.' }),
    } as unknown as Response
    expect(await readApiErrorResponse(response)).toMatchObject({ status: 429, code: 'AI_RATE_LIMITED', retryAfterSeconds: 12, requestId: 'req-1' })
  })
})
