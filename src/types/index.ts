export type BillingCycle = 'monthly' | 'annual'
export type BillingProvider = 'paystack' | 'onegate' | 'mock'
export type PlanChangeType = 'new' | 'renewal' | 'upgrade' | 'downgrade' | 'cycle_switch'
export interface PendingPlanChange {
  plan: BillingPlan['id']
  billingCycle: BillingCycle
  effectiveAt: string
  periodEnd: string
}
export interface PlanChangePreview extends PendingPlanChange {
  type: PlanChangeType
  creditDays: number
  blocked: 'PLAN_CHANGE_ALREADY_SCHEDULED' | null
}

export interface User {
  id: string
  email: string
  name: string
  role: 'owner' | 'manager'
  orgId: string
  cafeIds: string[]
  activeCafeId: string
  emailVerified?: boolean
  permissions?: {
    canSpendCredits: boolean
  }
}

export interface BillingAccess {
  allowed: boolean
  status: 'trialing' | 'active' | 'grace' | 'past_due' | 'canceled' | 'missing'
  reason: string | null
  periodEnd: string | null
  readOnly?: boolean
  graceEndsAt?: string | null
}

export interface Organization {
  _id: string
  name: string
  ownerId: string
  plan: 'starter' | 'growth' | 'pro'
  billingStatus?: 'trialing' | 'active' | 'past_due' | 'canceled'
  billingCycle?: 'monthly' | 'annual'
  currentPeriodEnd?: string | null
  trialEndsAt?: string | null
  billingAccess?: BillingAccess
  pendingPlanChange?: PendingPlanChange | null
  billingEmail?: string
  paymentMethod?: { brand: string; last4: string; expiresAt: string; provider?: 'mock' | 'onegate' | string }
}

export interface TeamMember {
  _id: string
  name: string
  email: string
  role: 'owner' | 'manager'
  cafeIds: { _id: string; name: string }[]
  createdAt: string
  permissions?: {
    canSpendCredits: boolean
  }
}

export interface BillingPlan {
  id: 'starter' | 'growth' | 'pro'
  name: string
  priceMonthly: number
  priceAnnual: number
  includedSeats: number
  includedAiCredits: number
  includedGuavaCredits?: number
  includedLocations: number
  overagePerSeat: number
  aiCreditPackPrice: number
  guavaCreditPackPrice?: number
  creditPackOptions?: { credits: number; price: number }[]
  features: string[]
}

export interface CreditLedgerSummary {
  byFeature: { featureKey: string; label: string; credits: number; count: number }[]
  recent: {
    id: string
    featureKey: string
    label: string
    credits: number
    status: 'committed'
    provider?: string
    createdAt: string
  }[]
}

export interface AccountUsage {
  seats: { used: number; active?: number; pending?: number; included: number; remaining: number }
  locations: { used: number; included: number; remaining: number }
  aiCredits: { included: number; bonus: number; used: number; available: number; resetAt: string | null }
  guavaCredits?: { included: number; bonus: number; used: number; available: number; resetAt: string | null }
  creditLedger?: CreditLedgerSummary
}

export interface Account {
  billing?: { provider: BillingProvider | null }
  user: User
  organization: Organization
  usage: AccountUsage
  planChanges?: PlanChangePreview[]
  plans: BillingPlan[]
}

export interface CafeBasic {
  _id: string
  name: string
  // Set when the owner archived the location (BE-02-T08); active locations carry null or nothing.
  archivedAt?: string | null
}

export interface TradingHoursEntry {
  dayOfWeek: number
  isOpen: boolean
  openTime: string
  closeTime: string
}

export interface CafeLocation {
  address?: string
  addressLine2?: string
  suburb?: string
  city?: string
  postalCode?: string
  province?: string
  country?: string
  lat?: number
  lng?: number
}

export interface Cafe {
  _id: string
  name: string
  location: CafeLocation
  yocoConnected: boolean
  dataUploaded: boolean
  lastSyncAt?: string
  tradingHours?: TradingHoursEntry[]
  tradingHoursSaved?: boolean
  timezone?: string
  timezoneEditable?: boolean
}

export interface ForecastItem {
  expectedQty?: number
  itemName: string
  baseQty?: number
  predictedQty: number
  actualQty?: number | null
  suggestedStock?: number
  /** How much weight this item's number can bear, driven by sales volume. */
  confidence?: 'high' | 'medium' | 'low'
  factors?: ForecastFactor[]
}

export interface ForecastFactor {
  key: string
  label: string
  active: boolean
  adjustmentPct?: number | null
  multiplier?: number | null
  effect?: string
  reason?: string
}

export interface ForecastWeatherSignal {
  maxTemp?: number | null
  available?: boolean
  temp?: number | null
  condition: string
  humidity?: number | null
  isRain?: boolean
  precipMm?: number
  chanceOfRain?: number
  unavailableReason?: string
}

export interface Forecast {
  _id: string
  date: string
  dateKey?: string
  origin?: 'live' | 'backfill' | 'manual'
  modelVersion?: string
  trainingCutoff?: string
  availability?: {
    status: 'ready' | 'insufficient_data' | 'closed'
    scheduleSource?: 'saved' | 'default' | 'inferred_from_sales'
    reason?: string
    // True only when a *scheduled* closure is contradicted by sales on that
    // weekday. An operator's deliberate closure event is not a contradiction.
    contradictsHistory?: boolean
  }
  items: ForecastItem[]
  signals: {
    weather: ForecastWeatherSignal
    loadSheddingStage: number | null
    loadSheddingAvailable?: boolean | null
    loadSheddingUnavailableReason?: string | null
    isPublicHoliday: boolean
    isSchoolHoliday: boolean
    isPayday: boolean
    dayOfWeek: number
    events?: { name: string; impact: string; impactPct?: number }[]
  }
  factors?: ForecastFactor[]
  factorSettings?: ForecastFactorSettings
  factorEntitlements?: ForecastFactorEntitlements
  calibration?: ForecastCalibration
  totalPredictedRevenue: number
  forecastCoverage?: {
    itemCount: number
    storedItemCount: number
    totalPredictedQty: number
    includesAllRevenue: boolean
    accuracyMethod?: string
  }
  actualRevenue?: number | null
  actualTransactionCount?: number | null
  actualsUpdatedAt?: string | null
  accuracy?: number
  trainingData?: {
    transactionCount: number
    firstTransactionDate?: string
    lastTransactionDate?: string
    weeksWithSales: number
    staleDays?: number
    latestSaleDate?: string
  }
}

export interface ForecastCalibrationEntry {
  key?: string
  label?: string
  itemName?: string
  multiplier: number
  sampleSize: number
  averageRatio: number
}

export interface ForecastCalibration {
  lookbackDays: number
  sampleSize: number
  overallMultiplier: number
  factorMultipliers: ForecastCalibrationEntry[]
  itemMultipliers: ForecastCalibrationEntry[]
  generatedAt: string
}

export interface ForecastHistoryRow {
  forecastId: string
  date: string
  dateKey?: string
  origin?: 'live' | 'backfill' | 'manual'
  modelVersion?: string
  trainingCutoff?: string
  predictedRevenue: number
  actualRevenue: number
  variance: number
  variancePct: number | null
  revenueAccuracy: number | null
  availabilityStatus?: 'ready' | 'insufficient_data' | 'closed'
  countsTowardAccuracy?: boolean
  volumeAccuracy?: number | null
  /** Item-level accuracy, 100 minus WAPE. */
  itemAccuracy: number | null
  transactionCount: number
  weather: Forecast['signals']['weather'] | null
  signals: {
    isPublicHoliday: boolean
    isSchoolHoliday: boolean
    isPayday: boolean
    loadSheddingStage: number | null
    loadSheddingAvailable?: boolean | null
    loadSheddingUnavailableReason?: string | null
    events: { name: string; impact: string; impactPct?: number }[]
  }
  activeFactors: ForecastFactor[]
  factorSummary: {
    key: string
    label: string
    effect?: string
    adjustmentPct?: number | null
  }[]
  calibration?: ForecastCalibration
  trainingData?: Forecast['trainingData']
  generatedAt?: string
  actualsUpdatedAt?: string
}

export interface ForecastHistoryAccuracySummary {
  rowCount: number
  excludedRowCount?: number
  avgItemAccuracy?: number | null
  note?: string | null
  overallRevenueAccuracy: number | null
  avgDailyRevenueAccuracy: number | null
  totalPredictedRevenue: number
  totalActualRevenue: number
  variance: number
  variancePct: number | null
}

export interface ForecastHistoryMeta {
  rangeClamped?: boolean
  days: number
  startDate: string
  endDate: string
  totalTradingDays: number
  totalRows: number
  generated: number
  pendingDays: number
  isPartial: boolean
  backfill?: {
    status: 'complete' | 'pending'
    pendingDays: number
    batchSize: number
    resumable?: boolean
    creditsPerDay?: number
    creditsUsed?: number
    nextRequest?: string | null
  }
  overallRevenueAccuracy: number | null
  avgDailyRevenueAccuracy: number | null
  avgRevenueAccuracy: number | null
  liveAccuracy?: ForecastHistoryAccuracySummary
  backtestAccuracy?: ForecastHistoryAccuracySummary
  combinedAccuracy?: ForecastHistoryAccuracySummary
  totalPredictedRevenue: number
  totalActualRevenue: number
  variance: number
  variancePct: number | null
}

export interface ForecastHistoryResponse {
  success: boolean
  history: ForecastHistoryRow[]
  rows?: ForecastHistoryRow[]
  meta: ForecastHistoryMeta
  pagination?: {
    total: number
    page: number
    limit: number
    pages: number
  }
}

export interface LocalEvent {
  _id: string
  name: string
  date: string
  dateKey?: string
  type?: 'event' | 'closure' | 'partial_closure'
  impact: 'low' | 'medium' | 'high'
  impactPct?: number
  notes?: string
  recurring: boolean
}

export interface EventSalesEffect {
  eventId: string
  name: string
  date: string
  dateKey?: string
  impact: 'low' | 'medium' | 'high'
  expectedImpactPct: number
  expectedApplied?: boolean
  expectedNote?: string | null
  actualRevenue: number
  actualTransactions: number
  baselineRevenue: number
  baselineTransactions: number
  baselineDayCount: number
  revenueImpactPct: number | null
  transactionImpactPct: number | null
  vsExpectedPct: number | null
  confidence: 'none' | 'low' | 'medium' | 'high'
}

export interface ForecastFactorSettings {
  history: {
    maxWeeks: number
    recentWeights: number[]
    twoWeekWeights: number[]
  }
  weather: {
    enabled: boolean
    hotTemp: number
    coldTemp: number
    hotColdDrinkPct: number
    hotCoffeePct: number
    coldCoffeePct: number
    coldColdDrinkPct: number
    rainPct: number
    minimumMultiplier: number
  }
  loadShedding: {
    enabled: boolean
    stage1To2Pct: number
    stage3To4Pct: number
    stage5PlusPct: number
  }
  holiday: {
    enabled: boolean
    publicPct: number
    schoolPct: number
    combinedPct: number
  }
  payday: {
    enabled: boolean
    pct: number
  }
  events: {
    enabled: boolean
    lowPct: number
    mediumPct: number
    highPct: number
  }
  stock: {
    safetyMarginPct: number
    maxBiasPct: number
  }
  learning: {
    enabled: boolean
  }
}

export interface ForecastFactorEntitlement {
  key: string
  label: string
  section: keyof ForecastFactorSettings
  requiredPlan: 'starter' | 'growth' | 'pro'
  summary: string
  unlocked: boolean
}

export interface ForecastFactorEntitlements {
  plan: 'free' | 'starter' | 'growth' | 'pro'
  factors: ForecastFactorEntitlement[]
  unlockedKeys: string[]
  lockedKeys: string[]
}

export interface YocoStatus {
  connected: boolean
  lastSyncAt: string | null
  tokenExpiresAt: string | null
}

export interface TransactionStats {
  totalTransactions: number
  totalRevenue: number
  avgDailyRevenue: number
  topItems: { name: string; qty: number }[]
  firstDate: string
  lastDate: string
}

export type SalesItemCategory = 'coffee' | 'food' | 'cold_drink' | 'water' | 'retail' | 'other'
export type SalesItemReviewStatus = 'matched' | 'needs_review' | 'ignored' | 'merged'

export interface SalesItem {
  _id: string
  cafeId: string
  name: string
  normalizedName?: string
  aliases?: string[]
  category: SalesItemCategory
  expectedPrice?: number
  priceTolerancePct?: number
  reviewStatus: SalesItemReviewStatus
  source?: 'manual' | 'pos' | 'imported' | 'system'
  avgPrice?: number
  observedPriceMin?: number
  observedPriceMax?: number
  lastObservedPrice?: number
  totalSold: number
  isActive: boolean
  lastSeenAt?: string
  firstSeenAt?: string
  lastPriceMismatchAt?: string
  priceMismatchCount?: number
  notes?: string
  candidates?: { item: SalesItem; score: number }[]
  aiSuggestion?: {
    action: 'map_to' | 'confirm' | 'ignore'
    targetItemId?: string
    targetName?: string
    category?: SalesItemCategory
    expectedPrice?: number
    aliases?: string[]
    confidence: number
    reason: string
    source: 'ai' | 'rules'
    needsApproval: boolean
    aiCreditsCharged?: number
    replayed?: boolean
    aiUnavailableReason?: 'insufficient_credits' | 'permission_required' | 'provider_unavailable'
  }
}

export interface DayForecast {
  date: string
  label: string
  dayName: string
  dataQuality: 'BASIC' | 'PRO'
  forecast?: Forecast
}

export interface HourlyBreakdown {
  hour: number
  label: string
  items: { name: string; qty: number }[]
  temp?: number
}

export interface TimePeriod {
  id: string
  label: string
  timeRange: string
  hours: number[]
  hourlyData: HourlyBreakdown[]
  totalQty: number
  topItems: { name: string; qty: number }[]
}

// ── Analytics types ──────────────────────────────────────────────────────────

export interface RevenueData {
  date: string
  revenue: number
  transactions: number
}

export interface RevenueAnalytics {
  openDays?: number
  data: RevenueData[]
  totalRevenue: number
  avgDailyRevenue: number
  bestDay: { date: string; revenue: number }
  worstDay: { date: string; revenue: number }
  trend: number | null
}

export interface ItemPerformance {
  name: string
  totalQty: number
  totalRevenue: number
  avgPerDay: number
  trend: number | null
  isNew?: boolean
}

/** GET /analytics/heatmap meta: how many sales in the window had a time of day (BE-03-T06). */
export interface HeatmapMeta {
  timeOfDay?: { transactionsWithTime: number; transactionsWithoutTime: number }
}

export interface HeatmapCell {
  isOpen?: boolean
  dayOfWeek: number
  hour: number
  revenue: number
  transactions: number
  totalRevenue?: number
  totalTransactions?: number
  observedDays?: number
}

export interface CustomerInsights {
  avgTransactionValue: number
  avgItemsPerTransaction: number
  cashVsCardRatio: { cash: number; card: number; other?: number } | null
  transactions?: number
  refunds?: { count: number; value: number }
  paymentMethodCoverage?: { known: number; unknown: number }
  tippingRate: number
  avgTip: number
}

// ── Workforce types ──────────────────────────────────────────────────────────

export interface StaffMember {
  _id: string
  name: string
  email?: string
  phone?: string
  role: 'barista' | 'kitchen' | 'front' | 'manager' | 'other'
  hourlyRate: number
  startDate: string
  isActive: boolean
}

export interface Shift {
  _id: string
  staffId: string | { _id: string; name: string }
  cafeId: string
  date: string
  startTime: string
  endTime: string
  hoursWorked: number
  type: 'regular' | 'overtime'
  status: 'scheduled' | 'completed' | 'cancelled'
  notes?: string
}

export interface ShiftSummary {
  staffId: string
  staffName: string
  totalHours: number
  regularHours: number
  overtimeHours: number
  estimatedPay: number
}

export interface LeaveRequest {
  _id: string
  staffId: string | { _id: string; name: string }
  cafeId: string
  type: 'annual' | 'sick' | 'family' | 'unpaid'
  startDate: string
  endDate: string
  days: number
  reason?: string
  status: 'pending' | 'approved' | 'rejected'
  approvedBy?: string
  approvedAt?: string
}

export interface LeaveBalanceData {
  staffId: string | { _id: string; name?: string; role?: StaffMember['role'] }
  staffName?: string
  annual: { total: number; used: number }
  sick: { total: number; used: number }
  family: { total: number; used: number }
}

export interface LeaveCalendarDay {
  date: string
  staff: { name: string; type: string }[]
}

// ── Improvements (partner feedback / ticketing) ────────────────────────────────

export type ImprovementType = 'fix' | 'improvement'
export type ImprovementArea =
  | 'dashboard'
  | 'planning'
  | 'analytics'
  | 'history'
  | 'ask_guava'
  | 'data_uploads'
  | 'menu_items'
  | 'integrations'
  | 'team'
  | 'settings'
  | 'billing'
  | 'other'
export type ImprovementPriority = 'low' | 'medium' | 'high'
export type ImprovementStatus = 'open' | 'planned' | 'in_progress' | 'done' | 'declined'

export interface Improvement {
  _id: string
  ticketNumber: number
  type: ImprovementType
  title: string
  area: ImprovementArea
  priority: ImprovementPriority
  description: string
  desiredOutcome?: string
  pageUrl?: string
  status: ImprovementStatus
  resolutionNotes?: string
  createdBy?: { userId?: string; name?: string; email?: string }
  orgId: string
  cafeId?: string
  createdAt: string
  updatedAt: string
}

// Counts per status plus an 'all' total. Mapped from the status union so a new
// status can never be added without this staying in sync.
export type ImprovementStatusCounts = Record<'all' | ImprovementStatus, number>
