import { isSessionRejection } from './api'
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
    kind: data.retryable === false ? 'provider-rejected' : data.charged === true ? 'interrupted' : 'transient',
    charged: typeof data.charged === 'boolean' ? data.charged : null,
    credits: data.credits,
    serverMessage: serverMessageFrom(data.message),
  }
}

function failureKindForStatus(status: number, code?: string): ChatFailureKind | null {
  if (status === 413 || code === 'PAYLOAD_TOO_LARGE') return 'payload-too-large'
  if (status === 403 && code === 'CAFE_ACCESS_REVOKED') return 'cafe-access'
  if (status === 400 && code === 'AI_CHAT_INVALID_INPUT') return 'invalid-request'
  if (status === 402) return 'out-of-credits'
  if (status === 403) return 'not-permitted'
  if (status === 429) return 'rate-limited'
  if (status === 401) return 'session-ended'
  return null
}

function retryAfterSecondsFrom(response: Response) {
  const raw = typeof response.headers?.get === 'function' ? response.headers.get('retry-after') : null
  return retryAfterSecondsValue(raw)
}

export async function chatRequestErrorFrom(response: Response) {
  const status = typeof response.status === 'number' ? response.status : 0
  let body: {
    code?: string
    message?: string
    details?: { code?: string; available?: number; required?: number; retryable?: boolean }
  } | null = null
  if (typeof response.json === 'function') {
    body = await response.json().catch(() => null)
  }
  const billingMessage = billingReadOnlyMessage(body)

  return new ChatRequestError(
    {
      kind: billingMessage ? 'billing-read-only' : status === 413 || body?.details?.code === 'PAYLOAD_TOO_LARGE' ? 'payload-too-large'
        : body?.details?.retryable === false ? 'provider-rejected' : failureKindForStatus(status, body?.code ?? body?.details?.code) ?? 'transient',
      ...(billingMessage || status === 413 || body?.details?.code === 'PAYLOAD_TOO_LARGE' ? { charged: false } : {}),
      serverMessage: billingMessage ?? serverMessageFrom(body?.message),
      available: body?.details?.available,
      required: body?.details?.required,
      retryAfterSeconds: retryAfterSecondsFrom(response),
    },
    serverMessageFrom(body?.message) || `Streaming chat request failed (${status || 'no status'})`
  )
}

export function chatFailureFrom(error: unknown, cancelledByUser: boolean, delivered = false): ChatFailure {
  if (cancelledByUser) return { kind: 'cancelled', charged: delivered }
  if (error instanceof ChatRequestError) {
    const { failure } = error
    const refusedBeforeDelivery = ['billing-read-only', 'out-of-credits', 'not-permitted', 'rate-limited', 'session-ended', 'cafe-access', 'invalid-request', 'provider-rejected', 'payload-too-large']
      .includes(failure.kind)
    return {
      ...failure,
      charged: failure.charged === undefined
        ? (delivered ? true : (refusedBeforeDelivery ? false : null))
        : failure.charged,
      chargeInferred: failure.charged === undefined || failure.chargeInferred,
    }
  }

  const name = (error as Error | undefined)?.name
  // A torn-down or timed-out stream is recoverable in principle, but it is
  // never worth a second reservation the user did not ask for.
  if (name === 'AbortError' || name === 'CanceledError') return { kind: 'transient', charged: delivered, chargeInferred: true }

  const response = (error as {
    response?: { status?: number; headers?: Record<string, unknown>; data?: { code?: string; message?: string; details?: { code?: string; available?: number; required?: number; retryable?: boolean } } }
  })?.response
  const status = response?.status
  const code = response?.data?.code ?? response?.data?.details?.code
  if (status === 413 || code === 'PAYLOAD_TOO_LARGE') return { kind: 'payload-too-large', charged: false }
  const billingMessage = billingReadOnlyMessage(error)
  if (billingMessage) return { kind: 'billing-read-only', charged: delivered, serverMessage: billingMessage }
  if (response?.data?.details?.retryable === false) {
    return { kind: 'provider-rejected', charged: delivered, serverMessage: serverMessageFrom(response.data.message) }
  }
  if (typeof status === 'number') {
    const kind = failureKindForStatus(status, code)
    if (kind === 'cafe-access' || kind === 'invalid-request') return { kind, charged: delivered }
  }

  // api.ts now ends the session only for a refused credential, so 403 here is
  // the credit-spend permission rather than a dead login, and a request with no
  // response at all is a genuine transport failure instead of a logout.
  if (isSessionRejection(error)) {
    return status === 403 ? { kind: 'not-permitted', charged: delivered } : { kind: 'session-ended', charged: delivered }
  }
  if (typeof status === 'number') {
    return {
      kind: failureKindForStatus(status) ?? 'transient',
      charged: delivered,
      chargeInferred: true,
      serverMessage: serverMessageFrom(response?.data?.message),
      retryAfterSeconds: retryAfterSecondsValue(response?.headers?.['retry-after']),
      available: response?.data?.details?.available,
      required: response?.data?.details?.required,
    }
  }
  return { kind: 'offline', charged: delivered }
}

export function chatFailureCopy(failure: ChatFailure) {
  if (failure.charged === true && !['cancelled', 'interrupted'].includes(failure.kind)) {
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
        title: 'Guava is read-only',
        detail: failure.serverMessage ?? 'Guava is read-only. Renew in Billing.',
        action: { kind: 'link' as const, label: 'Open Billing', to: '/settings?section=billing' },
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
        : { title: 'Stopped', detail: 'Stopped. No answer text had arrived.', action: null }
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

