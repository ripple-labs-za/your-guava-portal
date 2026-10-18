import { isSessionRejection } from './api'

export const CHAT_CREDIT_COST = 3
export const DEFAULT_RATE_LIMIT_SECONDS = 60
export type ChatFailureKind =
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

export interface ChatFailure {
  kind: ChatFailureKind
  available?: number
  required?: number
  retryAfterSeconds?: number
  charged?: boolean | null
  credits?: number
}

export class ChatRequestError extends Error {
  readonly failure: ChatFailure

  constructor(failure: ChatFailure, message: string) {
    super(message)
    this.name = 'ChatRequestError'
    this.failure = failure
  }
}

function failureKindForStatus(status: number, code?: string): ChatFailureKind | null {
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
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined
}

export async function chatRequestErrorFrom(response: Response) {
  const status = typeof response.status === 'number' ? response.status : 0
  let body: {
    code?: string
    message?: string
    details?: { code?: string; available?: number; required?: number }
  } | null = null
  if (typeof response.json === 'function') {
    body = await response.json().catch(() => null)
  }

  return new ChatRequestError(
    {
      kind: failureKindForStatus(status, body?.code ?? body?.details?.code) ?? 'transient',
      available: body?.details?.available,
      required: body?.details?.required,
      retryAfterSeconds: retryAfterSecondsFrom(response),
    },
    body?.message || `Streaming chat request failed (${status || 'no status'})`
  )
}

export function chatFailureFrom(error: unknown, cancelledByUser: boolean, delivered = false): ChatFailure {
  if (cancelledByUser) return { kind: 'cancelled', charged: delivered }
  if (error instanceof ChatRequestError) {
    const { failure } = error
    const refusedBeforeDelivery = ['out-of-credits', 'not-permitted', 'rate-limited', 'session-ended', 'cafe-access', 'invalid-request']
      .includes(failure.kind)
    return {
      ...failure,
      charged: failure.charged === undefined
        ? (delivered ? true : (refusedBeforeDelivery ? false : null))
        : failure.charged,
    }
  }

  const name = (error as Error | undefined)?.name
  // A torn-down or timed-out stream is recoverable in principle, but it is
  // never worth a second reservation the user did not ask for.
  if (name === 'AbortError' || name === 'CanceledError') return { kind: 'transient', charged: delivered }

  const response = (error as {
    response?: { status?: number; data?: { code?: string; details?: { code?: string; available?: number; required?: number } } }
  })?.response
  const status = response?.status
  const code = response?.data?.code ?? response?.data?.details?.code
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
      detail: 'The charge could not be confirmed. Loading this request again will not create a second charge.',
      action: { kind: 'retry' as const, label: 'Load the full answer (no extra charge)' },
    }
  }
  switch (failure.kind) {
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
        detail: 'Anything above this line is what arrived before the answer stopped.',
        action: { kind: 'retry' as const, label: `Try again (${CHAT_CREDIT_COST} credits)` },
      }
  }
}

