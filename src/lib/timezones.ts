// Intl.supportedValuesOf is ES2022; the app's lib is ES2020, so type the optional call explicitly.
const intlWithZones = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }

/** Canonical IANA zones for the timezone select, with the cafe's stored zone first if the list lacks it. */
export function timezoneOptions(current: string): string[] {
  const zones = intlWithZones.supportedValuesOf?.('timeZone') ?? []
  const list = zones.length > 0 ? [...zones] : ['Africa/Johannesburg']
  if (!list.includes('UTC')) list.push('UTC')
  return current && !list.includes(current) ? [current, ...list] : list
}
