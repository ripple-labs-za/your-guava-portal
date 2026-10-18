import type { ForecastWeatherSignal } from '@/types'

export function weatherTempLabel(weather: ForecastWeatherSignal): string {
  if (typeof weather.maxTemp === 'number' && Number.isFinite(weather.maxTemp)) return `High ${Math.round(weather.maxTemp)}°C`
  return `${Math.round(Number(weather.temp))}°C`
}

export function isWeatherAvailable(
  weather: ForecastWeatherSignal | null | undefined,
): weather is ForecastWeatherSignal & { temp: number; condition: string } {
  return Boolean(
    weather &&
    weather.available !== false &&
    typeof weather.temp === 'number' &&
    Number.isFinite(weather.temp) &&
    typeof weather.condition === 'string' &&
    weather.condition.trim()
  )
}

export function weatherUnavailableReason(weather: ForecastWeatherSignal | null | undefined) {
  return weather?.unavailableReason || 'Weather data is unavailable for this forecast.'
}

/**
 * Some of the engine's "not configured" reasons are the owner's to fix and
 * some are ours. "Cafe coordinates are not configured" names a setting without
 * saying it is a setting, let alone where it lives; a missing weather API key
 * reads almost identically and has no control in Settings at all.
 *
 * Only reasons listed here get an action. Sending someone to Settings to hunt
 * for a control that is not there is worse than saying nothing.
 */
const OWNER_FIXABLE_SIGNALS: { match: RegExp; action: string; to: string }[] = [
  {
    match: /coordinates are not (configured|set)/i,
    action: 'Set cafe location',
    to: '/settings?section=general&edit=cafe',
  },
]

export function signalFix(reason: string | null | undefined) {
  if (!reason) return null
  return OWNER_FIXABLE_SIGNALS.find((fix) => fix.match.test(reason)) || null
}

interface LoadSheddingSignal {
  loadSheddingStage: number | null
  loadSheddingAvailable?: boolean | null
  loadSheddingUnavailableReason?: string | null
}

export function isLoadSheddingAvailable(
  signal: LoadSheddingSignal,
): signal is LoadSheddingSignal & { loadSheddingStage: number } {
  return signal.loadSheddingAvailable !== false && Number.isFinite(signal.loadSheddingStage)
}

export function loadSheddingUnavailableReason(signal: LoadSheddingSignal) {
  return signal.loadSheddingUnavailableReason || 'Load-shedding data is unavailable for this forecast.'
}
