import type { Forecast } from '@/types'
import { forecastDateKey, parseDateOnly } from '@/lib/date'

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function shortDay(dateStr: string): string {
  return SHORT_DAYS[parseDateOnly(dateStr).getDay()]
}

interface Props {
  forecasts: Forecast[]
}

export function ItemsHeatmap({ forecasts }: Props) {
  if (forecasts.length === 0) return null

  // Union of all items sorted by total qty, top 12
  const totals: Record<string, number> = {}
  for (const f of forecasts) {
    for (const item of f.items) {
      totals[item.itemName] = (totals[item.itemName] || 0) + item.predictedQty
    }
  }
  const topItems = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name]) => name)

  // A week with no forecast items — an all-closed week, say — has nothing to
  // plot. An empty grid of day headers is noise, not information.
  if (topItems.length === 0) return null

  // Build matrix: rows = items, cols = days
  const dayLabels = forecasts.map((f) => shortDay(forecastDateKey(f)))
  // A closed day is not "we predict none of anything". Every other closed-day
  // surface in the product says so explicitly; this one rendered a column of
  // em-dashes identical to "this item is not in the forecast", which on the
  // live demo made a shut Sunday read as a rendering failure.
  const closedDays = forecasts.map((f) => f.availability?.status === 'closed')
  const matrix: number[][] = topItems.map((itemName) =>
    forecasts.map((f) => {
      const found = f.items.find((i) => i.itemName === itemName)
      return found ? found.predictedQty : 0
    })
  )

  const maxVal = Math.max(
    1,
    ...matrix.flatMap((row) => row.filter((_, colIdx) => !closedDays[colIdx]))
  )

  function cellBg(value: number): string {
    if (value === 0) return 'transparent'
    // Capped at 0.9 so the busiest cell stays readable. At full opacity the cell
    // is exactly #D43D3D, and the count printed on it in --color-text lands at
    // 4.06:1 — under the 4.5:1 the rest of the product now meets. Backing off a
    // tenth costs nothing visually and takes the worst cell to 4.68:1.
    const opacity = Math.min(0.9, Math.max(0.08, value / maxVal))
    // Return inline style; we'll apply as style prop
    return `rgba(212, 61, 61, ${opacity})`
  }

  const hasClosedDay = closedDays.some(Boolean)

  // The card carries contain:paint alongside overflow-hidden. The inner div scrolls
  // the table correctly, but an auto-layout table whose min-content width (539px at
  // the top-12 item list) exceeds its container still propagates that width into the
  // document scroll extent in Chromium — the page itself scrolled sideways by 79px at
  // 390px wide. Containing paint stops that without changing column sizing the way
  // table-layout:fixed would.
  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden [contain:paint]">
      <div className="px-5 py-4 border-b border-border">
        <p className="text-text text-sm font-semibold">Items × days heatmap</p>
        <p className="text-muted text-xs mt-0.5">Top 12 items by weekly predicted quantity</p>
      </div>
      {/* Focusable so a keyboard-only user can reach the days that overflow the
          viewport. There is nothing else focusable inside, so without this the
          later columns were unreachable without a mouse. */}
      <div
        className="overflow-x-auto"
        role="region"
        aria-label="Predicted quantity by item and day, scrollable"
        tabIndex={0}
      >
        <table className="w-full text-xs border-collapse">
          <caption className="sr-only">
            Predicted quantity for the top 12 items across each day of the week
            {hasClosedDay ? ', with closed days marked' : ''}
          </caption>
          <thead>
            <tr>
              {/* Sticky first header cell */}
              <th
                scope="col"
                className="sticky left-0 bg-surface text-left px-4 py-2.5 text-muted font-medium w-36 min-w-36 border-b border-border border-r border-border"
              >
                Item
              </th>
              {dayLabels.map((day, i) => (
                <th
                  key={i}
                  scope="col"
                  className={`text-center px-3 py-2.5 text-muted font-medium min-w-14 border-b border-border ${
                    closedDays[i] ? 'bg-surface-2' : ''
                  }`}
                >
                  {day}
                  {closedDays[i] && (
                    <span className="block text-[10px] font-normal leading-tight text-muted">Closed</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topItems.map((itemName, rowIdx) => (
              <tr key={itemName} className="border-b border-[#1F1F1F] last:border-0">
                <th
                  scope="row"
                  title={itemName}
                  className="sticky left-0 bg-surface px-4 py-2 text-muted font-normal text-left truncate max-w-36 border-r border-border"
                >
                  {itemName}
                </th>
                {matrix[rowIdx].map((val, colIdx) =>
                  closedDays[colIdx] ? (
                    <td key={colIdx} className="text-center px-3 py-2 bg-surface-2">
                      <span className="sr-only">Closed</span>
                      <span aria-hidden="true" className="text-muted">
                        ·
                      </span>
                    </td>
                  ) : (
                    <td
                      key={colIdx}
                      className="text-center px-3 py-2"
                      style={{ backgroundColor: cellBg(val) }}
                    >
                      <span className={val === 0 ? 'text-[#8A8A8A]' : 'text-text'}>
                        {val === 0 ? '—' : val}
                      </span>
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
