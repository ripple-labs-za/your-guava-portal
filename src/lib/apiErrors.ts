/**
 * One reading of an API failure, and one table of what to tell the owner about it (BE-13-T02).
 *
 * Every backend code registered with client: true in src/utils/errorCodes.js has an entry in
 * API_ERROR_COPY (two-space indent, one per line: backend-90/tools/contract-map.mjs --check reads
 * this file as text and fails when the tables drift). D-009: where the server words the
 * explanation, preferServerMessage renders it verbatim and the portal adds only the control.
 */
export type ApiErrorAction =
  | { kind: 'link'; label: string; to: string }
  | { kind: 'retry'; label: string }
  | { kind: 'wait'; label: string }
  | { kind: 'page'; label: string }
  | { kind: 'none' }

export interface ApiErrorCopy {
  title: string
  body: string
  preferServerMessage: boolean
  action: ApiErrorAction
}

export interface ApiErrorInfo {
  status: number | null
  code: string | null
  message: string | null
  retryAfterSeconds: number | null
  requestId: string | null
  details: Record<string, unknown> | null
  offline: boolean
}

const BILLING: ApiErrorAction = { kind: 'link', label: 'Open billing', to: '/settings?section=billing' }
const BUY: ApiErrorAction = { kind: 'link', label: 'Buy Guava Credits', to: '/settings?section=billing' }
const RETRY: ApiErrorAction = { kind: 'retry', label: 'Try again' }
const WAIT: ApiErrorAction = { kind: 'wait', label: 'Try again when the timer ends' }
const NONE: ApiErrorAction = { kind: 'none' }

export const API_ERROR_COPY: Record<string, ApiErrorCopy> = {
  ACCOUNTING_INTEGRATIONS_NOT_AVAILABLE: { title: 'Accounting integrations are not available yet', body: 'This connection is coming soon. Nothing was changed.', preferServerMessage: true, action: NONE },
  AI_CHAT_FAILED: { title: 'The AI analyst could not finish this answer', body: 'Anything above is what arrived before it stopped.', preferServerMessage: true, action: RETRY },
  AI_CHAT_INVALID_INPUT: { title: 'That question could not be sent', body: 'Shorten it or remove unusual characters, then ask again. Nothing was charged.', preferServerMessage: false, action: NONE },
  AI_INVALID_RESPONSE: { title: 'The AI answer could not be read', body: 'Nothing was charged. Try again; if it repeats, report it from Improvements.', preferServerMessage: false, action: RETRY },
  AI_MAPPING_INCOMPLETE: { title: 'The AI could not match every required column', body: 'Choose the missing columns yourself below. Nothing was charged.', preferServerMessage: false, action: NONE },
  AI_ORG_CONCURRENCY_LIMIT: { title: 'Your team already has AI requests running', body: 'Wait for them to finish, then try again. Nothing was charged.', preferServerMessage: false, action: WAIT },
  AI_ORG_DAILY_BUDGET_REACHED: { title: "Your organisation reached today's AI safety limit", body: 'The limit counts the last 24 hours, so requests open up again as earlier ones age out. Nothing was charged.', preferServerMessage: false, action: NONE },
  AI_OUTPUT_TRUNCATED: { title: 'The AI answer was cut short', body: 'Ask a narrower question and try again.', preferServerMessage: true, action: RETRY },
  AI_PROVIDER_AUTH_FAILED: { title: 'The AI service refused this server', body: 'Nothing was charged. This needs Your Guava support; report it from Improvements.', preferServerMessage: false, action: { kind: 'link', label: 'Open Improvements', to: '/improvements' } },
  AI_PROVIDER_BUSY: { title: 'The AI service is busy', body: 'Nothing was charged. Try again in a minute.', preferServerMessage: true, action: RETRY },
  AI_PROVIDER_REJECTED: { title: 'The AI service rejected this request', body: 'Nothing was charged. Try a shorter question or a new chat.', preferServerMessage: true, action: NONE },
  AI_PROVIDER_TIMEOUT: { title: 'The AI service took too long', body: 'Nothing was charged. Try again.', preferServerMessage: true, action: RETRY },
  AI_PROVIDER_UNAVAILABLE: { title: 'The AI service is unavailable right now', body: 'Nothing was charged. Try again in a few minutes.', preferServerMessage: true, action: RETRY },
  AI_RATE_LIMITED: { title: 'Too many AI requests', body: 'Ask Guava limits how fast AI requests can be made. Nothing was charged.', preferServerMessage: false, action: WAIT },
  AI_STREAM_INTERRUPTED: { title: 'The AI service stopped this answer part-way', body: 'Because it had started, it was charged. What arrived is above.', preferServerMessage: false, action: RETRY },
  AI_USER_CONCURRENCY_LIMIT: { title: 'You already have AI requests running', body: 'Wait for the current answer to finish, then try again. Nothing was charged.', preferServerMessage: false, action: WAIT },
  AI_USER_DAILY_BUDGET_REACHED: { title: "You reached today's AI safety limit", body: 'The limit counts your last 24 hours of AI use, so it frees up as earlier requests age out. Nothing was charged.', preferServerMessage: false, action: NONE },
  ANALYTICS_INVALID_DAYS: { title: 'That range is not available', body: 'Choose 7, 30 or 90 days.', preferServerMessage: true, action: NONE },
  ANALYTICS_QUERY_TIMEOUT: { title: 'This view took too long to build', body: 'Try a shorter range.', preferServerMessage: true, action: RETRY },
  ANALYTICS_RANGE_TOO_LONG: { title: 'That range is too long', body: 'Choose a shorter range.', preferServerMessage: true, action: NONE },
  ANALYTICS_RATE_LIMITED: { title: 'Performance is refreshing too often', body: 'Wait a moment, then try again.', preferServerMessage: true, action: WAIT },
  ANALYTICS_REFRESH_RATE_LIMITED: { title: 'Performance was refreshed a moment ago', body: 'Wait for the timer before refreshing again.', preferServerMessage: true, action: WAIT },
  AUTH_RATE_LIMITED: { title: 'Too many attempts', body: 'For your security, wait for the timer before trying again.', preferServerMessage: false, action: WAIT },
  BILLING_PROVIDER_NOT_CONFIGURED: { title: 'Card payments are not set up on this server', body: 'Nothing was charged. Contact Your Guava support to pay.', preferServerMessage: false, action: NONE },
  BILLING_REQUIRED: { title: 'Your billing period has ended', body: 'Forecasts, analytics and imports are paused until billing is up to date. Your data is safe.', preferServerMessage: false, action: BILLING },
  CAFE_ACCESS_REVOKED: { title: 'You no longer have access to this location', body: 'Switch to a location you can use from the menu. Nothing was charged.', preferServerMessage: false, action: NONE },
  CAFE_CONTEXT_MISMATCH: { title: 'You switched location in another tab', body: 'Reload this page to work in the location you now have open. Nothing was changed.', preferServerMessage: false, action: { kind: 'page', label: 'Reload this page' } },
  CAFE_REQUIRED: { title: 'Choose a location first', body: 'Pick a location from the menu, then try again.', preferServerMessage: true, action: NONE },
  CHAT_RATE_LIMITED: { title: 'Chats are being saved too quickly', body: 'Wait for the timer, then try again.', preferServerMessage: false, action: WAIT },
  CREDIT_SPEND_FORBIDDEN: { title: 'This login cannot spend Guava Credits', body: 'The account owner has not enabled credit spending for you. Ask them to turn it on under Team. Nothing was charged.', preferServerMessage: false, action: NONE },
  CSV_ROW_TOO_LONG: { title: 'A row in this file is too long to read', body: 'Open the file in Excel, save it as CSV UTF-8 and upload it again.', preferServerMessage: true, action: NONE },
  DOWNLOAD_SIGNING_NOT_CONFIGURED: { title: 'Downloads are not set up on this server', body: 'The upload itself is safe. Your Guava support needs to finish the setup.', preferServerMessage: false, action: NONE },
  EMAIL_VERIFICATION_REQUIRED: { title: 'Confirm your email first', body: 'Open the link we emailed you, or send a new one.', preferServerMessage: false, action: { kind: 'page', label: 'Send a new link' } },
  FORECAST_DATE_OUT_OF_RANGE: { title: 'Forecasts cannot be made for that date', body: 'Choose a date inside the forecast horizon.', preferServerMessage: true, action: NONE },
  FORECAST_RATE_LIMITED: { title: 'Forecasts were regenerated a moment ago', body: 'Wait for the timer before regenerating again.', preferServerMessage: false, action: WAIT },
  IDEMPOTENCY_KEY_REUSED: { title: 'This import request was already used', body: 'Reload the page and choose the columns again.', preferServerMessage: false, action: NONE },
  INSIGHT_CHAT_LIMIT_REACHED: { title: 'You have reached the saved-chat limit', body: 'Delete an old chat to start a new one.', preferServerMessage: true, action: NONE },
  INSIGHT_REFRESH_IN_PROGRESS: { title: 'Insights are already being refreshed', body: 'They will appear here when the refresh finishes. Nothing extra was charged.', preferServerMessage: false, action: WAIT },
  INSUFFICIENT_CREDITS: { title: 'You are out of Guava Credits', body: 'This needs more credits than are left this period. Nothing was charged for it.', preferServerMessage: false, action: BUY },
  INTEGRATION_ACCOUNT_CHOICE_REQUIRED: { title: 'Choose which account to connect', body: 'The provider has more than one organisation for this login.', preferServerMessage: true, action: NONE },
  INTEGRATION_ACCOUNT_MISMATCH: { title: 'That account was not authorised for this connection', body: 'Connect again and choose the account on the provider screen. Nothing was synced.', preferServerMessage: true, action: { kind: 'link', label: 'Open Integrations', to: '/integrations' } },
  INTEGRATION_DISCONNECTED: { title: 'The connection was removed during the sync', body: 'Nothing more was synced. Connect again to keep syncing.', preferServerMessage: true, action: { kind: 'link', label: 'Open Integrations', to: '/integrations' } },
  INTEGRATION_NOT_CONFIGURED: { title: 'This accounting connection is not set up on the server', body: 'Nothing was connected. Your Guava support needs to finish the setup.', preferServerMessage: false, action: NONE },
  INTEGRATION_NO_ACCOUNT: { title: 'No account was authorised for this connection', body: 'Connect again and choose the account this location uses.', preferServerMessage: true, action: { kind: 'link', label: 'Open Integrations', to: '/integrations' } },
  INTEGRATION_REAUTH_REQUIRED: { title: 'This connection needs to be renewed', body: 'Connect the accounting provider again to keep syncing.', preferServerMessage: false, action: { kind: 'link', label: 'Open Integrations', to: '/integrations' } },
  INVALID_CONTEXT_STATS: { title: 'This chat could not be saved', body: 'Start a new chat and ask again.', preferServerMessage: false, action: NONE },
  INVALID_FORECAST_SETTINGS: { title: 'Those forecast settings are not valid', body: 'Check the values and save again.', preferServerMessage: true, action: NONE },
  INVALID_PROVIDER_ACCOUNT_ID: { title: 'That account is not one of the choices', body: 'Pick an account from the list.', preferServerMessage: true, action: NONE },
  INVALID_SHIFT_TIMES: { title: 'Those shift times do not work', body: 'Check the start and end times, then add the shift again.', preferServerMessage: true, action: NONE },
  INVALID_SYNC_RANGE: { title: 'That sync range is not valid', body: 'Choose a shorter date range.', preferServerMessage: true, action: NONE },
  INVALID_TIMEZONE: { title: 'That timezone is not recognised', body: 'Choose a timezone from the list.', preferServerMessage: true, action: NONE },
  INVALID_WORKFORCE_INPUT: { title: 'One of the values is not valid', body: 'Check the highlighted field and try again.', preferServerMessage: true, action: NONE },
  INVITE_NOT_POSSIBLE: { title: 'This person cannot be invited', body: 'Nothing was sent.', preferServerMessage: true, action: NONE },
  INVITE_RATE_LIMITED: { title: 'Too many invitation attempts', body: 'Wait for the timer, then open the invitation link again.', preferServerMessage: false, action: WAIT },
  ITEM_COUNT_CHANGED: { title: 'The list of items to review changed', body: 'Review the list again, then confirm.', preferServerMessage: true, action: NONE },
  ITEM_NAME_TAKEN: { title: 'Another menu item already has that name', body: 'Choose a different name, or link this item to the one that has it. Nothing was changed.', preferServerMessage: true, action: NONE },
  LAST_LOCATION: { title: 'This is your only location', body: 'An organisation needs at least one active location.', preferServerMessage: true, action: NONE },
  LEAVE_BALANCE_NOT_FOUND: { title: 'No leave balance for this person yet', body: 'Check their start date under Staff.', preferServerMessage: true, action: NONE },
  LEAVE_CROSSES_CYCLE: { title: 'That leave crosses into the next leave cycle', body: 'Split it into two requests, one for each cycle.', preferServerMessage: true, action: NONE },
  LEAVE_HAS_SHIFTS: { title: 'This person has shifts during that leave', body: 'Move or cancel those shifts first, then approve the leave.', preferServerMessage: true, action: NONE },
  LEAVE_INSUFFICIENT_BALANCE: { title: 'Not enough leave left', body: 'Shorten the request or choose another leave type.', preferServerMessage: true, action: NONE },
  LEAVE_NOT_CANCELLABLE: { title: 'That leave request cannot be cancelled', body: 'Only pending leave, or approved leave that has not started, can be cancelled.', preferServerMessage: true, action: NONE },
  LEAVE_NOT_FOUND: { title: 'That leave request no longer exists', body: 'Reload the page to see the current list.', preferServerMessage: false, action: { kind: 'page', label: 'Reload this page' } },
  LEAVE_NOT_PENDING: { title: 'That leave request cannot be approved', body: 'It has already been decided. Reload to see its status.', preferServerMessage: true, action: NONE },
  LEAVE_NO_WORKING_DAYS: { title: 'Those dates are not working days', body: 'Nothing would come off the balance. Choose dates this person works.', preferServerMessage: true, action: NONE },
  LEAVE_OVERLAP: { title: 'This overlaps leave already booked', body: 'Change the dates, or cancel the other request first.', preferServerMessage: true, action: NONE },
  LEGACY_XLS: { title: 'This is an old .xls file', body: 'Save it as CSV UTF-8 in Excel, then upload that file.', preferServerMessage: true, action: NONE },
  LOCATION_HAS_MEMBERS: { title: 'Team members still use this location', body: 'Move them to another location under Team first.', preferServerMessage: true, action: { kind: 'link', label: 'Open Team', to: '/team' } },
  LOGIN_THROTTLED: { title: 'Too many sign-in attempts', body: 'For your security, sign-in is paused for this account. Wait for the timer, or reset your password.', preferServerMessage: false, action: WAIT },
  MAPPING_ALREADY_COMMITTED: { title: 'This file was already imported with other columns', body: 'Someone finished this import first. Reload the upload to see it, then use Re-map columns to read it differently.', preferServerMessage: false, action: { kind: 'page', label: 'Reload this upload' } },
  MAP_TO_INACTIVE_TARGET: { title: 'That item is not on the active menu', body: 'Link this item to an active menu item instead. Nothing was changed.', preferServerMessage: true, action: NONE },
  MAP_TO_SELF: { title: 'A menu item cannot be linked to itself', body: 'Choose a different menu item to link it to. Nothing was changed.', preferServerMessage: false, action: NONE },
  OAUTH_CALLBACK_FAILED: { title: 'The accounting provider did not finish connecting', body: 'Nothing was connected. Start the connection again.', preferServerMessage: false, action: RETRY },
  PARSE_RATE_LIMITED: { title: 'Too many files read in a minute', body: 'Wait for the timer, then continue importing.', preferServerMessage: false, action: WAIT },
  PASSWORD_REQUIRED: { title: 'Enter your password to confirm this email', body: 'Type the password you chose when you signed up.', preferServerMessage: false, action: NONE },
  PAYLOAD_TOO_LARGE: { title: 'That is too much to send at once', body: 'Shorten it and try again.', preferServerMessage: true, action: NONE },
  PAYMENT_IDEMPOTENCY_CONFLICT: { title: 'This payment request clashes with an earlier one', body: 'Nothing was charged twice. Reload billing and start again.', preferServerMessage: false, action: BILLING },
  PAYMENT_IDEMPOTENCY_KEY_INVALID: { title: 'This payment request was malformed', body: 'Nothing was charged. Reload billing and start the payment again.', preferServerMessage: false, action: BILLING },
  PAYMENT_IDEMPOTENCY_KEY_REQUIRED: { title: 'This payment request was incomplete', body: 'Nothing was charged. Reload billing and try the payment once more.', preferServerMessage: false, action: BILLING },
  PAYMENT_SESSION_INITIALIZATION_FAILED: { title: 'Secure checkout could not be opened', body: 'Nothing was charged. Try again in a moment.', preferServerMessage: false, action: RETRY },
  PAYMENT_SESSION_INITIALIZING: { title: 'Secure checkout is still being prepared', body: 'Nothing has been charged. Try again in a moment; it resumes this same payment.', preferServerMessage: false, action: WAIT },
  PLAN_CHANGE_ALREADY_SCHEDULED: { title: 'A plan change is already scheduled', body: 'It takes effect when this period ends. Change plan again after that.', preferServerMessage: true, action: NONE },
  PLAN_LIMIT_EXCEEDED: { title: "You are using more than that plan allows", body: 'Remove seats or locations first, then change plan.', preferServerMessage: true, action: { kind: 'link', label: 'Open Team', to: '/team' } },
  PLAN_UPGRADE_REQUIRED: { title: 'That needs a higher plan', body: 'Upgrade to use this.', preferServerMessage: true, action: { kind: 'link', label: 'See plans', to: '/settings?section=billing' } },
  RATE_LIMITED: { title: 'Too many requests', body: 'Your Guava is limiting how fast pages can load. Wait a moment, then try again.', preferServerMessage: false, action: WAIT },
  REFRESH_RATE_LIMITED: { title: 'Your session is refreshing too often', body: 'You are still signed in. Wait a moment, then reload.', preferServerMessage: false, action: WAIT },
  SEVERE_PARTIAL_IMPORT: { title: 'Many rows could not be read', body: 'Check the column choices, or import only the rows that could be read.', preferServerMessage: true, action: { kind: 'page', label: 'Import only the valid rows' } },
  SHIFT_NOT_FOUND: { title: 'That shift no longer exists', body: 'Reload the roster to see the current week.', preferServerMessage: false, action: NONE },
  SHIFT_ON_LEAVE: { title: 'This person is on approved leave that day', body: 'Choose another day or person.', preferServerMessage: true, action: NONE },
  SHIFT_OVERLAP: { title: 'That shift overlaps another', body: 'Change the times or the person, then add it again.', preferServerMessage: true, action: NONE },
  STAFF_NOT_FOUND: { title: 'That staff member no longer exists', body: 'Reload the page to see the current team.', preferServerMessage: false, action: NONE },
  STAFF_START_DATE_LOCKED: { title: 'This start date can no longer change', body: 'Leave is already recorded against it.', preferServerMessage: true, action: NONE },
  TIMEZONE_LOCKED: { title: 'The timezone cannot change now', body: 'Sales are already recorded in the current timezone.', preferServerMessage: true, action: NONE },
  TOO_MANY_ITEMS: { title: 'Too many items to confirm at once', body: 'Confirm them in the list below instead.', preferServerMessage: true, action: NONE },
  UPLOAD_BUSY: { title: 'This file is still importing', body: 'Wait for the import to finish, then refresh this page.', preferServerMessage: false, action: WAIT },
  UPLOAD_CHANGED: { title: 'This upload changed while you were working', body: 'Reload the upload to see its current state, then try again.', preferServerMessage: false, action: { kind: 'page', label: 'Reload this upload' } },
  UPLOAD_EXPIRED: { title: 'This unfinished upload expired', body: 'Upload the file again from Data Health.', preferServerMessage: false, action: { kind: 'link', label: 'Open Data Health', to: '/data-health' } },
  UPLOAD_FORM_TOO_LARGE: { title: 'The upload form sent too much', body: 'Upload one file at a time from Data Health.', preferServerMessage: true, action: NONE },
  UPLOAD_NO_NEW_ROWS: { title: 'Already up to date', body: 'Every row in this file was imported before, so nothing changed.', preferServerMessage: false, action: NONE },
  UPLOAD_PARSE_BUSY: { title: 'Many files are being read right now', body: 'Nothing was lost. Wait a moment, then upload the file again.', preferServerMessage: true, action: WAIT },
  UPLOAD_PARSE_RESOURCE_LIMIT: { title: 'This file needs more memory than one upload may use', body: 'Nothing was imported. Export a shorter date range and upload each part.', preferServerMessage: false, action: NONE },
  UPLOAD_PARSE_TIMEOUT: { title: 'This file took too long to read', body: 'Nothing was imported. Export a shorter date range, then upload it again.', preferServerMessage: false, action: NONE },
  UPLOAD_RATE_LIMITED: { title: 'That is a lot of files at once', body: 'Wait for the timer, then continue importing.', preferServerMessage: true, action: WAIT },
  UPLOAD_TOO_LARGE: { title: 'This file is too large', body: 'Export a shorter date range and upload each part.', preferServerMessage: true, action: NONE },
  UPSTREAM_AUTH_FAILED: { title: 'The accounting provider refused the connection', body: 'Connect it again from Integrations.', preferServerMessage: false, action: { kind: 'link', label: 'Open Integrations', to: '/integrations' } },
  UPSTREAM_ERROR: { title: 'The connected service could not finish the request', body: 'Nothing was changed. Try again in a minute.', preferServerMessage: true, action: RETRY },
  UPSTREAM_TIMEOUT: { title: 'The accounting provider did not answer in time', body: 'Nothing was changed. Try the sync again in a few minutes.', preferServerMessage: false, action: RETRY },
  UPSTREAM_UNREACHABLE: { title: 'The connected service could not be reached', body: 'Nothing was changed. Check back in a minute and try again.', preferServerMessage: true, action: RETRY },
  USAGE_IDEMPOTENCY_CONFLICT: { title: 'This request was already processed', body: 'Reload the page to see the result. Nothing was charged twice.', preferServerMessage: false, action: NONE },
  USAGE_IDEMPOTENCY_FINGERPRINT_CONFLICT: { title: 'This request key belongs to a different question', body: 'Reload the page and ask again. Nothing was charged.', preferServerMessage: false, action: NONE },
  VERIFICATION_EMAIL_FAILED: { title: 'We could not send the confirmation email', body: 'Your account is waiting. Send a new link in a moment.', preferServerMessage: true, action: { kind: 'page', label: 'Send a new link' } },
  VERIFICATION_PASSWORD_MISMATCH: { title: 'That password does not match this signup', body: 'Use the password you chose when you signed up. The link still works.', preferServerMessage: true, action: NONE },
  WRITE_RATE_LIMITED: { title: 'You are doing that too quickly', body: 'Wait for the timer, then try again.', preferServerMessage: false, action: WAIT },
  XLSX_DIMENSION_LIMIT: { title: 'Spreadsheet dimensions are too large', body: 'Save it again from Excel, or export it as CSV UTF-8, and upload that.', preferServerMessage: true, action: NONE },
  XLSX_PART_TOO_LARGE: { title: 'Part of this spreadsheet is far too large', body: 'Save it again from Excel, or export it as CSV UTF-8, and upload that.', preferServerMessage: true, action: NONE },
  XLSX_UNREADABLE: { title: 'This spreadsheet could not be read', body: 'Save it again from Excel, or export it as CSV UTF-8, and upload that.', preferServerMessage: true, action: NONE },
}

const STATUS_COPY: Record<number, ApiErrorCopy> = {
  413: { title: 'That is too large to send', body: 'Send a smaller file or less text, then try again.', preferServerMessage: true, action: NONE },
  429: { title: 'Too many requests', body: 'Wait a moment, then try again.', preferServerMessage: false, action: WAIT },
  503: { title: 'This service is unavailable right now', body: 'Nothing was changed. Try again in a few minutes.', preferServerMessage: true, action: RETRY },
}

const OFFLINE: ApiErrorCopy = { title: 'Your Guava could not be reached', body: 'Nothing came back from the server. Check your connection, then try again.', preferServerMessage: false, action: RETRY }
const REDACTED = 'Internal Server Error'

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

function headerOf(headers: unknown, name: string): unknown {
  if (!headers) return null
  const withGet = headers as { get?: (header: string) => unknown }
  if (typeof withGet.get === 'function') return withGet.get(name)
  const record = headers as Record<string, unknown>
  return record[name] ?? record[name.toLowerCase()] ?? null
}

/** Retry-After as whole seconds: the delta-seconds form, or an HTTP date. Null when absent or already past. */
export function parseRetryAfter(raw: unknown, now = Date.now()): number | null {
  if (raw == null || raw === '') return null
  const text = String(raw).trim()
  if (/^\d+$/.test(text)) return Number(text) > 0 ? Number(text) : null
  const at = Date.parse(text)
  if (Number.isNaN(at)) return null
  const seconds = Math.ceil((at - now) / 1000)
  return seconds > 0 ? seconds : null
}

function fromBody(status: number | null, body: unknown, headers: unknown): ApiErrorInfo {
  const data = asRecord(body)
  const details = asRecord(data?.details)
  const code = typeof data?.code === 'string' ? data.code : typeof details?.code === 'string' ? details.code : null
  const message = typeof data?.message === 'string' && data.message.trim() ? data.message : null
  const headerId = headerOf(headers, 'x-request-id')
  const requestId = typeof data?.requestId === 'string' ? data.requestId : typeof headerId === 'string' ? headerId : null
  const bodyWait = typeof data?.retryAfterSeconds === 'number' ? data.retryAfterSeconds
    : typeof details?.retryAfterSeconds === 'number' ? details.retryAfterSeconds : null
  return { status, code, message, retryAfterSeconds: parseRetryAfter(headerOf(headers, 'retry-after')) ?? bodyWait, requestId, details, offline: false }
}

/** An axios error (or anything shaped like one). No response at all means the request never got an answer. */
export function readApiError(error: unknown): ApiErrorInfo {
  const response = (error as { response?: { status?: unknown; data?: unknown; headers?: unknown } } | null)?.response
  if (!response) return { status: null, code: null, message: null, retryAfterSeconds: null, requestId: null, details: null, offline: true }
  return fromBody(typeof response.status === 'number' ? response.status : null, response.data, response.headers)
}

/** A fetch Response that was not ok (authenticatedFetch callers). */
export async function readApiErrorResponse(response: Response): Promise<ApiErrorInfo> {
  const body = typeof response.json === 'function' ? await response.json().catch(() => null) : null
  return fromBody(typeof response.status === 'number' ? response.status : null, body, response.headers)
}

export function describeApiError(info: ApiErrorInfo, fallback: Partial<Pick<ApiErrorCopy, 'title' | 'body' | 'action'>> = {}): ApiErrorCopy {
  if (info.offline) return OFFLINE
  const base = (info.code ? API_ERROR_COPY[info.code] : undefined)
    ?? (info.status != null ? STATUS_COPY[info.status] : undefined)
    ?? {
      title: fallback.title ?? 'Something went wrong',
      body: fallback.body ?? 'Try again. If it keeps happening, report it from Improvements with the time it happened.',
      preferServerMessage: true,
      action: fallback.action ?? RETRY,
    }
  const usable = info.message && info.message !== REDACTED ? info.message : null
  return { ...base, body: base.preferServerMessage && usable ? usable : base.body }
}

/** Seconds to hold a control closed after a 429: the server's Retry-After, else the fallback. Null when not rate limited. */
export function waitSeconds(info: ApiErrorInfo, fallbackSeconds = 60): number | null {
  return info.status === 429 ? info.retryAfterSeconds ?? fallbackSeconds : null
}
