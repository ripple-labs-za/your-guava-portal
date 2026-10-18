// Intl.supportedValuesOf is ES2022; the app's lib is ES2020, so type the optional call explicitly.
const intlWithZones = Intl as typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[]
}

export const timezoneEditabilityHint = (editable: boolean) =>
  editable
    ? 'Can be changed until sales are imported.'
    : 'Fixed once sales are imported. Contact support to change it.'

export const canListTimezones = () =>
  typeof intlWithZones.supportedValuesOf === 'function'

export function timezoneSaveFailure(error: unknown) {
  const data = (
    error as { response?: { data?: { code?: string; message?: string } } }
  )?.response?.data
  return {
    locked: data?.code === 'TIMEZONE_LOCKED',
    message:
      data?.code === 'INVALID_TIMEZONE'
        ? 'This timezone is not available yet. Choose another timezone or contact support.'
        : data?.message,
  }
}

/** Canonical IANA zones for the timezone select, with the cafe's stored zone first if the list lacks it. */
export function timezoneOptions(current: string): string[] {
  const zones = intlWithZones.supportedValuesOf?.('timeZone') ?? []
  const list = zones.length > 0 ? [...zones] : ['Africa/Johannesburg']
  if (!list.includes('UTC')) list.push('UTC')
  return current && !list.includes(current) ? [current, ...list] : list
}
