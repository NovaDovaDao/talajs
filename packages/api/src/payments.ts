import type { PaymentMethod } from '@talajs/contracts'

/**
 * A payment processor (card, crypto, …). Cash is built in and needs no adapter.
 *
 * Tala calls an adapter outside any database transaction: the payment is first recorded as
 * `PENDING`, then `charge` runs, then the result is stored. Adapters must be idempotent on
 * `paymentId` / `refundId` (pass them to the processor as idempotency keys), because a retried
 * request can call them again.
 *
 * Only synchronous results are supported for now: `charge` and `refund` resolve to the final
 * outcome. Processors that settle later through webhooks need the provider-event pipeline
 * (docs/PLAN.md §2.3), which arrives with the first such adapter.
 */
export interface PaymentAdapter {
  /** Stored as `payment.provider`, e.g. `"acme-card"`. */
  readonly id: string
  readonly methods: readonly PaymentMethod[]
  charge(request: ChargeRequest): Promise<ChargeResult>
  refund(request: RefundRequest): Promise<RefundResult>
}

export interface ChargeRequest {
  tenantId: string
  storeId: string
  orderId: string
  paymentId: string
  method: PaymentMethod
  amountMinor: number
  tipMinor: number
  currency: string
}

export interface ChargeResult {
  status: 'SUCCESS' | 'FAILED'
  /** The processor's id for the payment, needed later for refunds. */
  externalId?: string
  failureReason?: string
  /** Crypto asset, e.g. `"USDC"`. */
  asset?: string
}

export interface RefundRequest {
  tenantId: string
  paymentId: string
  refundId: string
  /** The processor's payment id from `ChargeResult.externalId`. */
  externalId: string | null
  amountMinor: number
  currency: string
}

export interface RefundResult {
  status: 'SUCCESS' | 'FAILED'
  externalId?: string
}
