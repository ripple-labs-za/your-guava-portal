import { readApiError, type ApiErrorInfo } from './apiErrors'
import { billingReadOnlyMessage } from './billingAccess'

export const CHAT_CREDIT_COST = 3
export const DEFAULT_RATE_LIMIT_SECONDS = 60

const retryAfterSecondsValue = (raw: unknown): number | undefined => {
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined
}

export function savedChatFailureNotice(error: unknown): string | null {
  const response = (error as { response?: { status?: number; headers?: Record<string, unknown>; data?: { code?: string; details?: { code?: string } } } })?.response
  if (response?.status === 413 || response?.data?.details?.code === 'PAYLOAD_TOO_LARGE') {
    return 'This chat is too long to save to your account. Start a new chat to keep saving; this one stays on this device.'
  }
  if (response?.status !== 429 || response.data?.code !== 'CHAT_RATE_LIMITED') return null
  const seconds = retryAfterSecondsValue(response.headers?.['retry-after'])
  const wait = seconds !== undefined ? `${seconds} seconds` : 'up to a minute'
  return `Saved chats are being changed too quickly. Wait ${wait}, then try again.`
}
export type ChatFailureKind =
  | 'billing-read-only'
  | 'daily-limit'
  | 'busy'
  | 'ai-unavailable'
  | 'stalled'
  | 'out-of-credits'
  | 'not-permitted'
  | 'rate-limited'
  | 'session-ended'
  | 'cancelled'
  | 'offline'
  | 'transient'
  | 'interrupted'
  | 'cafe-access'
  | 'invalid-request'
  | 'provider-rejected'
  | 'payload-too-large'

export interface ChatFailure {
  kind: ChatFailureKind
  available?: number
  required?: number
  retryAfterSeconds?: number
  charged?: boolean | null
  chargeInferred?: boolean
  credits?: number
  serverMessage?: string
}

export class ChatRequestError extends Error {
  readonly failure: ChatFailure

  constructor(failure: ChatFailure, message: string) {
    super(message)
    this.name = 'ChatRequestError'
    this.failure = failure
  }
}

const serverMessageFrom = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

export function chatFailureFromStreamEvent(data: {
  message?: unknown; code?: string; charged?: boolean | null; retryable?: boolean; credits?: number
}): ChatFailure {
  return {
    kind: data.retryable === false ? 'provider-rejected' : data.charged === true ? 'interrupted'
      : data.charged === false && (data.code?.startsWith('AI_PROVIDER_') || data.code === 'AI_INVALID_RESPONSE' || data.code === 'AI_OUTPUT_TRUNCATED') ? 'ai-unavailable' : 'transient',
    charged: typeof data.charged === 'boolean' ? data.charged : null,
    credits: data.credits,
    serverMessage: serverMessageFrom(data.message),
  }
}

export function failureFromInfo(info: ApiErrorInfo): ChatFailure {
  const details = info.details ?? {}
  let kind: ChatFailureKind = 'transient'
  switch (info.code) {
    case 'BILLING_REQUIRED': kind = 'billing-read-only'; break
    case 'CAFE_ACCESS_REVOKED': kind = 'cafe-access'; break
    case 'AI_CHAT_INVALID_INPUT': kind = 'invalid-request'; break
    case 'PAYLOAD_TOO_LARGE': kind = 'payload-too-large'; break
    case 'AI_USER_DAILY_BUDGET_REACHED':
    case 'AI_ORG_DAILY_BUDGET_REACHED': kind = 'daily-limit'; break
    case 'AI_USER_CONCURRENCY_LIMIT':
    case 'AI_ORG_CONCURRENCY_LIMIT': kind = 'busy'; break
    default:
      if (details.retryable === false) kind = 'provider-rejected'
      else if (info.code?.startsWith('AI_PROVIDER_') || info.code === 'AI_INVALID_RESPONSE' || info.code === 'AI_OUTPUT_TRUNCATED') kind = 'ai-unavailable'
      else if (info.status === 401) kind = 'session-ended'
      else if (info.status === 402) kind = 'out-of-credits'
      else if (info.status === 403) kind = 'not-permitted'
      else if (info.status === 413) kind = 'payload-too-large'
      else if (info.status === 429) kind = 'rate-limited'
  }
  return {
    kind,
    available: typeof details.available === 'number' ? details.available : undefined,
    required: typeof details.required === 'number' ? details.required : undefined,
    retryAfterSeconds: info.retryAfterSeconds ?? (kind === 'busy' ? 5 : undefined),
    serverMessage: info.message ?? undefined,
  }
}

export async function chatRequestErrorFrom(response: Response) {
  // Keep the billing envelope's dated read-only explanation while reading the
  // public error code and Retry-After through the shared API boundary.
  const body = typeof response.json === 'function' ? await response.json().catch(() => null) : null
  const info = readApiError({ response: { status: response.status, data: body, headers: response.headers } })
  const failure = failureFromInfo(info)
  const billingMessage = billingReadOnlyMessage(body)
  if (billingMessage) {
    failure.kind = 'billing-read-only'
    failure.serverMessage = billingMessage
  }
  return new ChatRequestError(failure, info.message || `Streaming chat request failed (${info.status ?? 'no status'})`)
}

export function chatFailureFrom(error: unknown, cancelledByUser: boolean, delivered = false, stalled = false): ChatFailure {
  if (cancelledByUser) return { kind: 'cancelled', charged: delivered }
  if (stalled) return { kind: 'stalled', charged: delivered, chargeInferred: true }
  if (error instanceof ChatRequestError) {
    const { failure } = error
    const refusedBeforeDelivery = !['transient', 'offline', 'interrupted', 'stalled'].includes(failure.kind)
    return {
      ...failure,
      charged: failure.charged === undefined ? (delivered ? true : refusedBeforeDelivery ? false : null) : failure.charged,
      chargeInferred: failure.charged === undefined || failure.chargeInferred,
    }
  }
  const name = (error as Error | undefined)?.name
  if (name === 'AbortError' || name === 'CanceledError') return { kind: 'transient', charged: delivered, chargeInferred: true }
  const info = readApiError(error)
  if (info.offline) return { kind: 'offline', charged: delivered }
  const failure = failureFromInfo(info)
  const billingMessage = billingReadOnlyMessage(error)
  if (billingMessage) {
    failure.kind = 'billing-read-only'
    failure.serverMessage = billingMessage
  }
  return { ...failure, charged: delivered, chargeInferred: true }
}

export function chatFailureCopy(failure: ChatFailure) {
  if (failure.charged === true && !['cancelled', 'interrupted', 'stalled'].includes(failure.kind)) {
    return {
      title: 'Answer interrupted',
      detail: `The answer had started, so it was charged (${failure.credits ?? CHAT_CREDIT_COST} credits). Loading it again costs nothing.`,
      action: { kind: 'retry' as const, label: 'Load the full answer (no extra charge)' },
    }
  }
  if (failure.charged === null) {
    return {
      title: 'Charge not confirmed',
      detail: failure.kind === 'provider-rejected'
        ? `The charge could not be confirmed. ${failure.serverMessage || 'The AI service could not accept this request.'}`
        : 'The charge could not be confirmed. Loading this request again will not create a second charge.',
      action: failure.kind === 'provider-rejected' ? null : { kind: 'retry' as const, label: 'Load the full answer (no extra charge)' },
    }
  }
  switch (failure.kind) {
    case 'billing-read-only':
      return {
        title: 'Your billing period has ended',
        detail: failure.serverMessage ?? 'Guava is read-only. Renew in Billing.',
        action: { kind: 'link' as const, label: 'Open Billing', to: '/settings?section=billing' },
      }
    case 'daily-limit':
      return {
        title: "You have reached today's AI safety limit",
        detail: 'The limit counts the last 24 hours and frees up as earlier questions age out. Nothing was charged.',
        action: null,
      }
    case 'busy':
      return {
        title: 'Another answer is still being written',
        detail: `Wait ${failure.retryAfterSeconds ?? 5} seconds for it to finish, then ask again. Nothing was charged.`,
        action: null,
      }
    case 'ai-unavailable':
      return {
        title: 'The AI service is unavailable right now',
        detail: 'Nothing was charged. Try again in a few minutes.',
        action: { kind: 'retry' as const, label: `Try again (${CHAT_CREDIT_COST} credits)` },
      }
    case 'stalled':
      return {
        title: 'The answer stopped arriving',
        detail: failure.charged
          ? `It had started, so it was charged (${failure.credits ?? CHAT_CREDIT_COST} credits). What arrived is above. Loading it again costs nothing.`
          : 'Nothing arrived, so nothing was charged.',
        action: { kind: 'retry' as const, label: failure.charged ? 'Load the full answer (no extra charge)' : `Try again (${CHAT_CREDIT_COST} credits)` },
      }
    case 'payload-too-large':
      return {
        title: 'This message is too long',
        detail: 'That message is too long to send. Shorten it and try again. Nothing was charged.',
        action: null,
      }
    case 'provider-rejected':
      return {
        title: 'The AI service could not take this request',
        detail: failure.serverMessage ?? 'The AI service could not accept this request.',
        action: null,
      }
    case 'cafe-access':
      return {
        title: 'You no longer have access to this location',
        detail: 'Switch to a location you manage, or ask the account owner to restore your access. Nothing was charged.',
        action: null,
      }
    case 'invalid-request':
      return {
        title: 'This question could not be sent',
        detail: 'Start a new chat and ask it again. Nothing was charged.',
        action: null,
      }
    case 'out-of-credits': {
      const balance =
        typeof failure.available === 'number'
          ? `${failure.available} ${failure.available === 1 ? 'is' : 'are'} left`
          : 'your balance could not cover it'
      return {
        title: 'You are out of Guava Credits',
        detail: `This answer needs ${failure.required ?? CHAT_CREDIT_COST} credits and ${balance}. Nothing was charged for this question.`,
        action: { kind: 'link' as const, label: 'Buy Guava Credits', to: '/settings?section=billing' },
      }
    }
    case 'not-permitted':
      return {
        title: 'This login cannot spend Guava Credits',
        detail: `Ask Guava costs ${CHAT_CREDIT_COST} credits per answer and the account owner has not enabled credit spending for your login. Ask them to turn it on under Team. Nothing was charged.`,
        action: null,
      }
    case 'rate-limited': {
      const seconds = failure.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_SECONDS
      return {
        title: 'Too many AI requests',
        detail: `Ask Guava limits how fast questions can be asked. Wait ${seconds} seconds, then send this question again. Nothing was charged.`,
        action: null,
      }
    }
    case 'session-ended':
      return {
        title: 'Your session ended before the answer arrived',
        detail: 'Sign in again and ask the question once more. Nothing was charged.',
        action: null,
      }
    case 'cancelled':
      return failure.charged
        ? {
            title: 'Stopped',
            detail: `Stopped. The answer had already started, so it was charged (${failure.credits ?? CHAT_CREDIT_COST} credits). The rest is kept for you at no extra charge.`,
            action: { kind: 'retry' as const, label: 'Load the full answer (no extra charge)' },
          }
        : { title: 'Stopped', detail: 'Stopped. No answer text had arrived. Nothing was charged.', action: null }
    case 'interrupted':
      return {
        title: 'The AI service stopped this answer part-way',
        detail: `Because it had started, it was charged (${failure.credits ?? CHAT_CREDIT_COST} credits). What arrived is above.`,
        action: { kind: 'retry' as const, label: `Ask again (${CHAT_CREDIT_COST} credits)` },
      }
    case 'offline':
      return {
        title: 'I could not reach the AI analyst',
        detail: 'Nothing came back from the server. Check your connection, then ask again.',
        action: { kind: 'retry' as const, label: `Try again (${CHAT_CREDIT_COST} credits)` },
      }
    default:
      return {
        title: 'The AI analyst could not finish this answer',
        detail: failure.serverMessage ?? (failure.charged === false && !failure.chargeInferred
          ? 'The AI service could not finish this answer. Nothing was charged. Try again.'
          : 'Anything above this line is what arrived before the answer stopped.'),
        action: { kind: 'retry' as const, label: `Try again (${CHAT_CREDIT_COST} credits)` },
      }
  }
}

