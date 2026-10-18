import type { PlanChangePreview } from '@/types'

export type NoticeTone = 'success' | 'error' | 'info'
export type NoticeAction = { label: string; to: string }
export type NoticeOptions = { persist?: boolean; action?: NoticeAction; reference?: string }
export type NoticeState = { type: NoticeTone; message: string; action?: NoticeAction; reference?: string } | null
export type PaymentSessionStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'cancelled' | 'needs_attention' | 'reversed'
export type PaymentIntent = {
  planChange?: Omit<PlanChangePreview, 'blocked'> | null
  provider: 'mock' | 'onegate' | 'paystack'
  kind?: 'plan' | 'credits'
  planChangeConflict?: boolean
  reference?: string
  redirectUrl?: string
  amount?: number
  currency?: string
  status?: PaymentSessionStatus | 'initializing'
  initializationStatus?: 'initializing' | 'ready' | 'failed'
}

type PaymentOutcome = { tone: NoticeTone; message: string; terminal: boolean }

const OUTCOMES: Record<PaymentSessionStatus, PaymentOutcome> = {
  needs_attention: {
    tone: 'info', terminal: true,
    message: 'Your payment reached us but needs a manual check before billing updates. Do not pay again. Email support@yourguava.co.za with this reference.',
  },
  reversed: {
    tone: 'info', terminal: true,
    message: 'This payment was refunded or reversed. No further charge was made.',
  },
  paid: { tone: 'success', terminal: true, message: 'Card payment confirmed. Billing has been updated.' },
  processing: {
    tone: 'info', terminal: false,
    message: 'Payment received. Guava is finalising your billing — this can take a moment. Do not pay again; this page updates as soon as it lands.',
  },
  pending: {
    tone: 'info', terminal: false,
    message: 'Card payment has not been confirmed by your bank yet. Guava will update billing as soon as it is. If you did not finish checkout, you can start it again.',
  },
  failed: {
    tone: 'error', terminal: true,
    message: 'Card payment failed. No billing changes were made, and you have not been charged.',
  },
  cancelled: { tone: 'error', terminal: true, message: 'Card payment was cancelled. No billing changes were made.' },
}

/** Unknown provider states cannot establish failure or justify a second charge. */
export function paymentOutcome(status: PaymentIntent['status'], kind?: PaymentIntent['kind'], planChangeConflict = false): PaymentOutcome {
  if (status === 'needs_attention' && kind === 'plan' && planChangeConflict) return {
    tone: 'info', terminal: true,
    message: 'A plan change was already scheduled. Your payment is held for a manual decision; it has not been lost. Email support@yourguava.co.za with this reference so support can decide what happens next. Do not pay again.',
  }
  if (!status || !(status in OUTCOMES)) return {
    tone: 'info', terminal: false,
    message: "We're still confirming this payment with the gateway. Nothing else is needed from you — please check billing again shortly rather than paying a second time.",
  }
  const outcome = OUTCOMES[status as PaymentSessionStatus]
  if (status !== 'reversed') return outcome
  const consequence = kind === 'credits' ? 'Unspent pack credits are withdrawn.'
    : kind === 'plan' ? 'Plan access is reviewed manually.' : 'Email support@yourguava.co.za if you need help with this payment.'
  return { ...outcome, message: `This payment was refunded or reversed. ${consequence} No further charge was made.` }
}

export function withoutPaymentParams(params: URLSearchParams, billingResolved = false): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete('payment')
  next.delete('reference')
  if (billingResolved) next.delete('billing')
  return next
}
