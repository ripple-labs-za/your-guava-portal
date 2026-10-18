import { cn } from '@/lib/utils'

export function HistoryStatPanel({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: string
  detail?: string
  tone?: 'neutral' | 'good' | 'bad'
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[#9E9E9E]">{label}</p>
      <p
        className={cn(
          'mt-2 text-2xl font-semibold text-text',
          tone === 'good' && 'text-guava-green',
          tone === 'bad' && 'text-guava-red-text'
        )}
      >
        {value}
      </p>
      {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
    </div>
  )
}
