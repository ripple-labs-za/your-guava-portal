import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Describe the response without exposing the server's internal error message. */
export function loadFailureReason(error: unknown): string {
  const status = (error as { response?: { status?: unknown } } | null | undefined)?.response?.status
  return typeof status === 'number'
    ? `The server answered with an error (${status}).`
    : 'Your Guava could not be reached.'
}

interface LoadFailedProps {
  what: string
  reason: string
  reassurance: string
  onRetry: () => void
  compact?: boolean
}

/** A failed read must never look like a successfully loaded empty cafe. */
export function LoadFailed({ what, reason, reassurance, onRetry, compact = false }: LoadFailedProps) {
  return (
    <div role="alert" className={cn('flex flex-col items-center text-center', compact ? 'py-4' : 'min-h-75 justify-center py-12')}>
      {!compact && <AlertCircle aria-hidden="true" className="mb-3 h-8 w-8 text-guava-red-text" />}
      <p className="text-sm font-medium text-text">Could not load {what}</p>
      <p className="mt-1 max-w-xs text-xs text-muted">{reason} {reassurance}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
