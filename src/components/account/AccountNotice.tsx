import { AlertCircle, CheckCircle, Clock, X } from 'lucide-react'
import { Link } from 'react-router'
import type { NoticeState, NoticeTone } from '@/lib/paymentOutcome'

const STYLES: Record<NoticeTone, string> = {
  success: 'bg-guava-green/10 border-guava-green/20 text-guava-green',
  error: 'bg-red-900/10 border-red-900/30 text-red-400',
  info: 'bg-surface border-border text-text',
}

export function AccountNotice({ notice, onDismiss }: { notice: NoticeState; onDismiss: () => void }) {
  if (!notice) return null
  const Icon = notice.type === 'error' ? AlertCircle : notice.type === 'success' ? CheckCircle : Clock
  return (
    <div role={notice.type === 'error' ? 'alert' : 'status'}
      className={`flex flex-wrap items-center gap-2 border rounded-lg px-3.5 py-2.5 text-sm ${STYLES[notice.type]}`}>
      <Icon className="w-4 h-4 shrink-0" />
      <span className="min-w-0 flex-1">{notice.message}</span>
      {notice.reference && (
        <span className="min-w-0 basis-full break-all">Reference: <code aria-label="Payment reference" className="select-all">{notice.reference}</code></span>
      )}
      {notice.action && <Link to={notice.action.to} className="ml-auto font-medium underline underline-offset-2">{notice.action.label}</Link>}
      {notice.reference && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss payment notice" className="rounded p-2 hover:bg-text/5">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
