import { describe, expect, it } from 'vitest'
import {
  weatherTempLabel,
  isLoadSheddingAvailable,
  isWeatherAvailable,
  loadSheddingUnavailableReason,
  weatherUnavailableReason,
} from './forecastSignals'

describe('forecast signal availability', () => {
  it('labels the daytime high when the engine sent one', () => {
    expect(weatherTempLabel({ temp: 20.4, maxTemp: 28.6, condition: 'Sunny' })).toBe('High 29°C')
    expect(weatherTempLabel({ temp: 20.4, condition: 'Sunny' })).toBe('20°C')
  })
  it('distinguishes verified weather from an unavailable signal', () => {
    expect(isWeatherAvailable({ available: true, temp: 24, condition: 'Sunny', humidity: 60 })).toBe(true)
    const unavailable = {
      available: false,
      condition: 'Unavailable',
      unavailableReason: 'Cafe coordinates are not configured',
    }
    expect(isWeatherAvailable(unavailable)).toBe(false)
    expect(weatherUnavailableReason(unavailable)).toBe('Cafe coordinates are not configured')
  })

  it('does not interpret a missing load-shedding stage as stage zero', () => {
    const unavailable = {
      loadSheddingStage: null,
      loadSheddingAvailable: false,
      loadSheddingUnavailableReason: 'Provider unavailable',
    }
    expect(isLoadSheddingAvailable(unavailable)).toBe(false)
    expect(loadSheddingUnavailableReason(unavailable)).toBe('Provider unavailable')
    expect(isLoadSheddingAvailable({ loadSheddingStage: 0, loadSheddingAvailable: true })).toBe(true)
  })
})
