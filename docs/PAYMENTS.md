# Pawprint subscription payments

## Current interface: simulated checkout

The current Subscription page offers a **demo purchase to every account, including TEST and anonymous demo accounts**, for CNY 144/year. It opens the in-app address and payment-method form and ends at **Order Placed**. Nothing is charged, no recurring subscription is created, and a demo receipt does not grant a real paid entitlement. Payment and address fields stay in the temporary form and are discarded when checkout closes; only a minimal, explicitly simulated receipt may remain in memory.

After a completed demo purchase, **Plus is displayed as the current plan** and the purchase button is removed. Reopening Subscription in the same login retains that state; repeated checkout is blocked. Starting a new TEST login or reloading the app clears the memory-only demo subscription and shows Free again, so the complete purchase journey can be demonstrated again. Closing a checkout without purchasing leaves Free available to retry.

The production billing API below is retained for future work, but the current purchase button does **not** call it. Adding merchant credentials alone will not change this simulated interface into live billing.

## Retained live-payment backend

Implemented: Stripe-hosted subscription Checkout, customer billing portal,
verified webhooks and account-scoped subscription records in D1. Payment details
are entered on Stripe, never into Pawprint forms or its database. A success URL
does not activate Plus; only the current subscription and paid invoice fetched
from Stripe can do that.

**Current deployment is not connected to a merchant account.** Without the three
runtime values below, buying is unavailable and no payment is attempted. Unit
tests use mocked Stripe responses; they are not evidence of a live transaction.

## Configure the merchant account

1. Activate the business's own Stripe account and its payouts. Use a Stripe
   sandbox first. No keys should be pasted into chat or committed to source.
2. Create **Pawprint Plus**, a licensed recurring price of **CNY 144.00, annually**,
   quantity one. This preserves the price already displayed in the app. The
   backend rejects a different currency, amount, interval or test/live mode.
3. Add these values to this Site's **runtime environment variables**, as secrets:

   | Name | Value |
   | --- | --- |
   | `STRIPE_SECRET_KEY` | The merchant's sandbox/test secret key initially; the live secret key only after testing. |
   | `STRIPE_PRICE_PLUS_ANNUAL` | The annual `price_…` ID from the same Stripe mode. |
   | `STRIPE_WEBHOOK_SECRET` | The `whsec_…` signing secret belonging to the endpoint below in the same Stripe mode. |

4. Register the canonical webhook in Stripe Workbench:

   `https://pawprint-health.zipeiweng453524.chatgpt.site/api/billing/webhook`

   Use API version **2026-10-28.endive**. Subscribe to:

   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `customer.subscription.resumed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `invoice.payment_action_required`
   - `invoice.voided`
   - `invoice.marked_uncollectible`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.closed`

5. Configure Stripe's customer portal to let customers view invoices, update
   payment methods and cancel at the end of the current paid period. Keep plan
   switching and unsupported products disabled. Enable Stripe's setting to
   redirect customers who already have a subscription to the portal as a second
   protection against duplicate subscriptions.
6. Enable the payment methods the business accepts in Stripe. Hosted Checkout
   shows only methods eligible for the customer's country, currency, device and
   recurring payment. The app does not promise a particular wallet or payment
   method before Stripe determines eligibility.
7. Publish with migration `0003_pawprint_billing.sql`. Existing auth and health
   tables are preserved. Keep sandbox and live price IDs, keys and webhook
   signing secrets together; changing only one leaves payment setup invalid.

If a subscription price is changed later, update the explicit backend price
validation and design a migration for existing subscribers before changing the
configured price ID. Do not silently replace the product or amount.

## API contract

All account endpoints use the existing secure Pawprint session cookie. Browser
POST requests require matching Origin, JSON content type and a small allowlisted
body. TEST and anonymous demo accounts cannot purchase or open billing portals.

| Endpoint | Request | Response |
| --- | --- | --- |
| `GET /api/billing/status` | Signed-in account | `plan`, provider `status`, `canPurchase`, `canManage`, `mode`, `reason`, verified `price`, `cancelAtPeriodEnd`, `currentPeriodEnd` |
| `POST /api/billing/checkout` | `{ "plan": "plus", "locale": "en" }` | Owner-bound Stripe Checkout `url`, `mode` |
| `POST /api/billing/portal` | `{ "locale": "en" }` | Owner-bound Stripe portal `url`, `mode` |
| `POST /api/billing/webhook` | Stripe's original body and `Stripe-Signature` | `{ "received": true }` after verified processing |

`locale` may be `en` or `zh`. Checkout uses Stripe's automatic language detection.
The server derives price, amount, customer, subscription metadata and return URLs;
the browser cannot supply any of them. Redirects only allow HTTPS
`checkout.stripe.com` or `billing.stripe.com` as appropriate.

Errors are `{ "error": { "code": "…", "message": "…" } }`. Configuration and
provider errors never include secret keys or provider request details.

## Entitlement and retry behavior

- Active subscription + paid latest invoice + a future paid-period end grants
  Plus. Pending/unpaid checkout, failed renewal, expired paid time and canceled
  subscriptions do not. A scheduled end-of-period cancellation retains access
  until the paid period ends.
- `loadBillingEntitlement` is provided for future premium API gates and grants
  real access only from **live-mode** server records. Existing free features
  remain free; the list of paid-only product capabilities has not been defined.
- The Subscription page may display a sandbox subscription with an explicit
  test-mode label, but sandbox payments do not grant live entitlements.
- Full refunds and disputes concerning the latest invoice suspend its access;
  a won dispute, closed inquiry or prevented chargeback can restore it if the
  charge has not also been fully refunded.
  Provider state is fetched again under the account lease, so older events do
  not undo a newer resolution. Partial refunds do not revoke access.
- The account is locked while preparing checkout. A pending open session is
  reused. Unknown results retain the same idempotency key. Stripe's default
  24-hour session expiry is used; an expired cached response is recorded and a
  subsequent attempt creates a fresh checkout.
- Webhooks verify the original raw bytes with HMAC-SHA256 and a five-minute
  timestamp tolerance. Events are deduplicated only after successful processing.
  Failure returns a non-2xx response so Stripe can retry. Event order is not used
  to decide access: current Stripe subscription state is retrieved instead.
- Hardware orders may share this endpoint via `onVerifiedEvent`. This callback
  runs only after signature, time and Stripe mode validation, before subscription
  handling. Its own order ledger must provide its own deduplication. Hardware
  events are not allowed to grant subscription access.

## Complete before enabling live purchases

Using a regular Pawprint account and Stripe sandbox payment details, verify:

1. Checkout shows CNY 144/year, the business name and eligible payment methods.
2. Successful payment produces a paid invoice, a successful webhook delivery and
   Plus on a refreshed Subscription page; navigating to `?checkout=success`
   without payment stays Free.
3. Declining/canceling payment stays Free. Retry and double click do not create
   duplicate subscriptions. An abandoned checkout can be reopened.
4. The portal updates payment details and schedules cancellation correctly.
5. Renewal failure, full refund, dispute and cancellation events update access;
   duplicate and out-of-order delivery remain safe.
6. Another Pawprint account cannot read or manage the first account's billing.

Switch to the matching live values only after the merchant has checked pricing,
business details, cancellation policy and the live webhook destination. Actual
charges and customer billing are performed only by customers confirming payment
on Stripe Checkout; this implementation task does not make a purchase.

## Official references

- https://docs.stripe.com/api/checkout/sessions/create
- https://docs.stripe.com/api/customer_portal/sessions/create
- https://docs.stripe.com/billing/subscriptions/webhooks
- https://docs.stripe.com/events/manage-webhook-endpoints
- https://docs.stripe.com/api/idempotent_requests
- https://docs.stripe.com/payments/checkout/limit-subscriptions

Verified 15 November 2026.
