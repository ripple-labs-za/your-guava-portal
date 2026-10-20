import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, AlertCircle, RefreshCw, Unplug, Plug } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import api from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

type SyncStatus = 'success' | 'failed' | null

interface ProviderState {
  connected: boolean
  connectedAt: string | null
  lastSyncAt: string | null
  lastSyncStatus: SyncStatus
  lastSyncError: string | null
}

interface IntegrationsData {
  xero: ProviderState
  quickbooks: ProviderState
  sage: ProviderState
}

type Provider = 'xero' | 'quickbooks' | 'sage'

interface SyncResult {
  success: boolean
  providerRef?: string
  summary?: { totalRevenue?: number; transactionCount?: number }
  message?: string
}

// ── Provider config ────────────────────────────────────────────────────────────

const PROVIDER_CONFIG: Record<
  Provider,
  {
    name: string
    description: string
    accentColor: string
    accentBg: string
    accentHoverBg: string
    accentBorder: string
    comingSoon: boolean
    bullets: string[]
  }
> = {
  xero: {
    name: 'Xero',
    description: 'Push daily sales summaries directly into your Xero accounting books.',
    accentColor: 'text-[#13B5EA]',
    accentBg: 'bg-[#13B5EA]/10',
    accentHoverBg: 'hover:bg-[#13B5EA]/15',
    accentBorder: 'border-[#13B5EA]/25',
    comingSoon: true,
    bullets: [
      'Automatic bank transaction entries per sales period',
      'Reconcile coffee-shop revenue without manual exports',
      'Supports multi-organisation Xero accounts',
    ],
  },
  quickbooks: {
    name: 'QuickBooks',
    description: 'Sync sales totals and tax breakdowns with your QuickBooks Online company.',
    accentColor: 'text-[#2CA01C]',
    accentBg: 'bg-[#2CA01C]/10',
    accentHoverBg: 'hover:bg-[#2CA01C]/15',
    accentBorder: 'border-[#2CA01C]/25',
    comingSoon: true,
    bullets: [
      'Map sales to QuickBooks income accounts automatically',
      'Daily or weekly summary entries with tax lines',
      'Supports multiple QuickBooks realms',
    ],
  },
  sage: {
    name: 'Sage Accounting',
    description: 'Post sales summaries to Sage Accounting for seamless bookkeeping.',
    accentColor: 'text-[#00C853]',
    accentBg: 'bg-[#00C853]/10',
    accentHoverBg: 'hover:bg-[#00C853]/15',
    accentBorder: 'border-[#00C853]/25',
    comingSoon: true,
    bullets: [
      'Create journal entries from your daily revenue totals',
      'Keep your Sage ledger up to date without manual entry',
      'Supports Sage Business Cloud Accounting',
    ],
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function extractError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message
    if (msg) return msg
  }
  return fallback
}

// ── StatusPill ────────────────────────────────────────────────────────────────

function StatusPill({
  connected,
  syncStatus,
  comingSoon = false,
}: {
  connected: boolean
  syncStatus: SyncStatus
  comingSoon?: boolean
}) {
  if (comingSoon) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-300" />
        Coming soon
      </span>
    )
  }

  if (!connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#3A3A3A] bg-border px-2.5 py-0.5 text-xs font-medium text-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-[#555555]" />
        Not connected
      </span>
    )
  }
  if (syncStatus === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        Sync failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-guava-green/30 bg-guava-green/10 px-2.5 py-0.5 text-xs font-medium text-guava-green">
      <CheckCircle className="w-3 h-3" />
      Connected
    </span>
  )
}

// ── ConfirmDialog ─────────────────────────────────────────────────────────────

function ConfirmDialog({
  provider,
  onConfirm,
  onCancel,
}: {
  provider: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-xl bg-surface border border-border p-6 shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
            <Unplug className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <p className="text-text font-semibold text-sm">Disconnect {provider}?</p>
            <p className="text-[#9E9E9E] text-sm mt-1">
              You'll need to reconnect to sync sales data.
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white rounded-lg"
            onClick={onConfirm}
          >
            Disconnect
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── ProviderCard ──────────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  state,
  onRefresh,
}: {
  provider: Provider
  state: ProviderState
  onRefresh: () => void
}) {
  const cfg = PROVIDER_CONFIG[provider]

  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    setSyncError(null)
    try {
      const { data } = await api.post<SyncResult>(`/integrations/${provider}/sync`)
      setSyncResult(data)
      onRefresh()
    } catch (err) {
      setSyncError(extractError(err, 'Sync failed.'))
    } finally {
      setSyncing(false)
    }
  }

  const handleDisconnect = async () => {
    setShowConfirm(false)
    setDisconnecting(true)
    setSyncResult(null)
    setSyncError(null)
    try {
      await api.post(`/integrations/${provider}/disconnect`)
      onRefresh()
    } catch (err) {
      setSyncError(extractError(err, 'Disconnect failed.'))
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <>
      {showConfirm && (
        <ConfirmDialog
          provider={cfg.name}
          onConfirm={handleDisconnect}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      <div
        className={cn(
          'flex flex-col rounded-xl border bg-[#111111] p-5 gap-4',
          state.connected ? cfg.accentBorder : 'border-border'
        )}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div
                className={cn(
                  'w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                  cfg.accentBg
                )}
              >
                <Plug className={cn('w-3.5 h-3.5', cfg.accentColor)} />
              </div>
              <h3 className={cn('text-base font-semibold', cfg.accentColor)}>{cfg.name}</h3>
            </div>
            <p className="text-[#9E9E9E] text-sm leading-relaxed">{cfg.description}</p>
          </div>
          <StatusPill connected={state.connected} syncStatus={state.lastSyncStatus} comingSoon={cfg.comingSoon} />
        </div>

        {/* Connected state */}
        {cfg.comingSoon ? (
          <div className="space-y-3">
            <ul className="space-y-1.5">
              {cfg.bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2 text-sm text-[#949494]">
                  <span className={cn('mt-0.5 text-base leading-none', cfg.accentColor)}>•</span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg gap-1.5 bg-transparent text-muted"
              disabled
            >
              <Plug className="w-3.5 h-3.5" />
              Coming soon
            </Button>
          </div>
        ) : state.connected ? (
          <div className="space-y-3">
            {/* Meta info */}
            <div className="rounded-lg bg-[#0F0F0F] border border-[#1E1E1E] px-3 py-2.5 text-xs space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Connected since</span>
                <span className="text-muted">{formatDate(state.connectedAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Last sync</span>
                <span className="text-muted">{formatDateTime(state.lastSyncAt)}</span>
              </div>
              {state.lastSyncStatus && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">Sync status</span>
                  {state.lastSyncStatus === 'success' ? (
                    <span className="text-guava-green flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Success
                    </span>
                  ) : (
                    <span className="text-red-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Failed
                    </span>
                  )}
                </div>
              )}
              {state.lastSyncStatus === 'failed' && state.lastSyncError && (
                <p className="text-red-400 text-[11px] pt-0.5 border-t border-border">
                  {state.lastSyncError}
                </p>
              )}
            </div>

            {/* Inline sync feedback */}
            {syncResult?.success && syncResult.summary && (
              <div className="flex items-center gap-2 rounded-lg bg-guava-green/10 border border-guava-green/20 px-3 py-2 text-xs text-guava-green">
                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Sent{' '}
                  {syncResult.summary.totalRevenue != null
                    ? `R${syncResult.summary.totalRevenue.toLocaleString('en-ZA')}`
                    : '—'}
                  {syncResult.summary.transactionCount != null
                    ? ` (${syncResult.summary.transactionCount} txns)`
                    : ''}{' '}
                  to {cfg.name}
                </span>
              </div>
            )}
            {syncResult && !syncResult.success && (
              <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{syncResult.message || 'Sync did not complete.'}</span>
              </div>
            )}
            {syncError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{syncError}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                className="bg-guava-green-strong hover:bg-[#35722A] text-white rounded-lg gap-1.5"
                onClick={handleSync}
                disabled={syncing || disconnecting}
              >
                <RefreshCw className={cn('w-3.5 h-3.5', syncing && 'animate-spin')} />
                {syncing ? 'Syncing…' : 'Sync now'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg text-muted hover:text-red-400 hover:border-red-500/40"
                onClick={() => setShowConfirm(true)}
                disabled={syncing || disconnecting}
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            </div>
          </div>
        ) : (
          /* Not-connected state */
          <div className="space-y-3">
            {/* What this enables */}
            <ul className="space-y-1.5">
              {cfg.bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2 text-sm text-[#949494]">
                  <span className={cn('mt-0.5 text-base leading-none', cfg.accentColor)}>•</span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>

            {/* Connect button */}
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'rounded-lg gap-1.5 bg-transparent transition-colors',
                cfg.accentBg,
                cfg.accentColor,
                cfg.accentBorder,
                cfg.accentHoverBg,
                'hover:text-current hover:border-current'
              )}
            >
              <Plug className="w-3.5 h-3.5" />
              Connect {cfg.name}
            </Button>
          </div>
        )}
      </div>
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const EMPTY_STATE: IntegrationsData = {
  xero: { connected: false, connectedAt: null, lastSyncAt: null, lastSyncStatus: null, lastSyncError: null },
  quickbooks: { connected: false, connectedAt: null, lastSyncAt: null, lastSyncStatus: null, lastSyncError: null },
  sage: { connected: false, connectedAt: null, lastSyncAt: null, lastSyncStatus: null, lastSyncError: null },
}

export default function Integrations() {
  const [integrations, setIntegrations] = useState<IntegrationsData>(EMPTY_STATE)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const fetchIntegrations = useCallback(async () => {
    setLoadError(null)
    try {
      const { data } = await api.get<{ data: IntegrationsData }>('/integrations')
      setIntegrations({ ...EMPTY_STATE, ...data.data })
    } catch (err) {
      setLoadError(extractError(err, 'Could not load integration status.'))
      setIntegrations(EMPTY_STATE)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchIntegrations()
  }, [fetchIntegrations])

  return (
    <AppLayout title="Integrations">
      <div className="space-y-6">
        {/* Page intro */}
        <div className="space-y-3">
          <p className="text-[#9E9E9E] text-sm mt-1">
            Connect your accounting software to push sales summaries automatically.
          </p>
          {/* Stated once for the page rather than repeated identically inside
              every provider card, which read as three separate warnings. */}
          <div className="rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-100/90">
            Accounting integrations are planned after the MVP — none of these connections are live yet.
            Your sales data continues to import through Data Health in the meantime.
          </div>
        </div>

        {loadError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {/* Provider cards grid */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {(['xero', 'quickbooks', 'sage'] as Provider[]).map((p) => (
              <div
                key={p}
                className="rounded-xl border border-border bg-[#111111] p-5 h-48 animate-[skeleton-shimmer_1.5s_ease-in-out_infinite]"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {(['xero', 'quickbooks', 'sage'] as Provider[]).map((p) => (
              <ProviderCard
                key={p}
                provider={p}
                state={integrations[p]}
                onRefresh={fetchIntegrations}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
