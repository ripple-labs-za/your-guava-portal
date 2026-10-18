export type InsightCacheStatus = 'fresh' | 'stale' | 'empty' | 'unconfigured' | 'insufficient_data'
export const INSIGHT_WINDOW_COPY = 'Covers the 14 completed days before today'
const NO_DATA_COPY = 'There are no approved sales in the 14 completed days before today. Upload or sync your sales and refresh again.'
const EMPTY_COPY = 'Generate an analysis from your imported sales data, or upload transactions if this cafe has none yet.'
const UNCONFIGURED_COPY = 'Insight generation is unavailable in this environment. Contact support for configuration help.'

export function resolveRefreshOutcome(data: {
  insights?: unknown; generatedAt?: unknown; cacheStatus?: string; insufficientData?: boolean;
  requiresRefresh?: boolean; meta?: { replayed?: boolean; coalesced?: boolean }
}) {
  const status: InsightCacheStatus = data.insufficientData ? 'insufficient_data'
    : ['fresh', 'stale', 'empty', 'unconfigured', 'insufficient_data'].includes(data.cacheStatus ?? '')
      ? data.cacheStatus as InsightCacheStatus : 'fresh'
  const texts = Array.isArray(data.insights)
    ? data.insights.filter((text): text is string => typeof text === 'string' && Boolean(text.trim())) : []
  const generatedAt = status !== 'insufficient_data' && typeof data.generatedAt === 'string' ? data.generatedAt : null
  const body = status === 'insufficient_data' ? texts[0] || NO_DATA_COPY : status === 'unconfigured' ? UNCONFIGURED_COPY : EMPTY_COPY
  const notice = status === 'insufficient_data' ? 'No credits were used.'
    : data.meta?.coalesced ? 'Joined a refresh already running.'
      : status === 'stale' && data.meta?.replayed ? 'Showing the result of your earlier refresh; it predates your last import.'
        : status === 'stale' ? 'This saved analysis may be out of date. Refreshing is an explicit 10-credit action.'
          : status === 'unconfigured' ? UNCONFIGURED_COPY : 'Analysis refreshed.'
  return {
    status, notice, body, generatedAt,
    heading: status === 'insufficient_data' ? 'Nothing to analyse yet' : status === 'unconfigured' ? 'AI insights are not configured' : 'No generated insights yet',
    insights: status === 'insufficient_data' ? [] : texts.map((text, index) => ({ id: String(index + 1), text, generatedAt })),
    requiresRefresh: status === 'insufficient_data' || Boolean(data.requiresRefresh),
  }
}

export function insightRefreshErrorNotice(error: unknown) {
  const response = (error as { response?: { data?: { code?: string; details?: { code?: string } } } })?.response
  const code = response?.data?.code ?? response?.data?.details?.code
  if (code === 'INSIGHT_REFRESH_IN_PROGRESS') return 'Another refresh is running. Wait for it to finish, then try again.'
  return 'Could not refresh insights. If this refresh completed, retrying will not charge twice.'
}
