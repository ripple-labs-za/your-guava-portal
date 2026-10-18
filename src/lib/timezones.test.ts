import { describe, it, expect } from 'vitest'
import { timezoneOptions } from './timezones'

describe('timezoneOptions', () => {
  it('offers the IANA zones the browser knows, including UTC', () => {
    const options = timezoneOptions('Africa/Johannesburg')
    expect(options).toContain('Africa/Johannesburg')
    expect(options).toContain('Europe/London')
    expect(options).toContain('UTC')
  })

  it('keeps a stored zone the list does not know at the top, so the select never shows the wrong value', () => {
    expect(timezoneOptions('Mars/Olympus_Mons')[0]).toBe('Mars/Olympus_Mons')
  })
})
