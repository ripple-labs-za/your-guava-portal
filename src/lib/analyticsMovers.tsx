import { TrendingDown, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export interface MoverItem { name: string; trend: number }
export interface NewItem { name: string; currentQty: number }
export interface MoverFloor {
  minQty: number; eligibleCount: number; busiestQty?: number; belowFloorCount?: number
  minAvgPerDay?: number; windowDays?: number
}

export const MOVERS_CAPTION = 'Last 7 days against the 7 before. This panel ignores the range above — changing it will not change these percentages. These lists rank only lines selling 14+ in either week. Low-volume percentages may still appear in the table below; new lines have no measured percentage.'

export function moverThresholdNote(floor: MoverFloor | null) {
  if (!floor || floor.eligibleCount !== 0) return ''
  const busiest = typeof floor.busiestQty === 'number' ? ` Your busiest line sold ${floor.busiestQty.toLocaleString('en-ZA')} in a week.` : ''
  return `No line sold ${floor.minQty}+ in either of the last two weeks, so ranking movers would be noise.${busiest}`
}

export function belowFloorNote(floor: MoverFloor | null, rising: number) {
  if (rising || !floor?.belowFloorCount) return ''
  return `${floor.belowFloorCount} ${floor.belowFloorCount === 1 ? 'line is' : 'lines are'} below the weekly floor.`
}

export function ItemTrend({ trend, isNew }: { trend?: number | null; isNew?: boolean }) {
  if (isNew) return <Badge variant="secondary" className="text-[10px]" title="New in the last 7 days">New</Badge>
  if (trend == null) return <span className="text-muted"><span aria-hidden="true">—</span><span className="sr-only">No sales in the earlier week</span></span>
  return <Badge variant={trend >= 0 ? 'success' : 'destructive'} className="text-[10px]">
    {trend >= 0 ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
    {trend >= 0 ? '+' : ''}{trend.toFixed(1)}%
  </Badge>
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export function closedCellLabels({ day, hour, revenue, transactions, closed }: {
  day: number; hour: number; revenue: number; transactions: number; closed: boolean
}) {
  const time = `${String(hour).padStart(2, '0')}:00`
  const amount = `R${revenue.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const whole = `R${revenue.toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`
  const closedText = closed ? ', closed: outside your trading hours' : ''
  const recorded = closed && revenue > 0 ? '; sales recorded while closed' : ''
  return {
    title: `${DAYS[day].slice(0, 3)} ${time} - ${closed ? 'Closed: outside your trading hours' : `${whole} avg`}${recorded}`,
    label: `${DAYS[day]} ${time}${closedText}, ${amount} average revenue, ${transactions} average transactions${recorded}`,
  }
}

export const CLOSED_CELL_BORDER = { border: '1px dashed #999999' }
