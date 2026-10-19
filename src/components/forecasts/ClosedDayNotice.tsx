import { Link } from 'react-router'
import { AlertTriangle } from 'lucide-react'
import type { Forecast } from '@/types'

/**
 * A day the engine forecasts at zero because the trading hours say the cafe is
 * shut, on a weekday the sales record says it trades.
 *
 * The engine has always known this - `availability.contradictsHistory` is set
 * the moment the forecast is generated - but nothing rendered it, so a
 * mis-set weekday looked like a quiet day rather than a broken setting. On the
 * seeded cafe that was eight Sundays scoring 0%, which is most of the gap
 * between the 77% the product reports and the 90% it is capable of.
 *
 * Renders nothing when the closure agrees with history: a cafe that genuinely
 * shuts on Mondays must not be nagged about Mondays. The backend's own reason
 * is the message, because it is the side that counted the sales.
 */
export function ClosedDayNotice({
  availability,
  compact = false,
}: {
  availability?: Forecast['availability']
  compact?: boolean
}) {
  if (availability?.status !== 'closed' || !availability.contradictsHistory) return null

  return (
    <div
      role="alert"
      className={
        compact
          ? 'flex items-start gap-2 text-xs'
          : 'flex items-start gap-2 rounded-lg border border-guava-yellow/40 bg-guava-yellow/10 px-3 py-2.5 text-sm'
      }
    >
      <AlertTriangle
        className={
          compact
            ? 'mt-0.5 h-3.5 w-3.5 shrink-0 text-guava-yellow'
            : 'mt-0.5 h-4 w-4 shrink-0 text-guava-yellow'
        }
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="text-text">{availability.reason}</p>
        <Link
          to="/settings?section=general"
          // Yellow, underlined: the red text measured 4.14:1 on this amber tint
          // over Planning's day card (FB-012); yellow is 9.6:1 there, and the
          // underline marks it as a link beside the reason without colour alone.
          className="inline-block font-medium text-guava-yellow underline underline-offset-4 hover:no-underline"
          onClick={(e) => e.stopPropagation()}
        >
          Open trading hours
        </Link>
      </div>
    </div>
  )
}
