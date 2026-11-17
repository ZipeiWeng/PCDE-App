# Pawprint hardware shop

## Current interface: catalogue and simulated checkout

The Shop now opens as a product catalogue. Its single compact card shows **Pawprint One at CNY 350**; opening the card reveals the larger product detail and purchase button. The catalogue layout can accept additional products later.

All account types, including TEST and anonymous demo accounts, can use the in-app demo address and payment form. Clicking Pay ends at **Order Placed**. It does not create a real payment, shipment or subscription. Form values are not transmitted or retained. Any demo order summary is held only in memory and explicitly separated from server-verified orders.

The live-payment API below is retained for future use. The current purchase button does not call it; merchant configuration alone does not enable live purchases in the present interface.

## Retained live-payment backend

The Shop sells a physical **Pawprint One** separately from the Plus subscription. Its header entry appears immediately left of Device. A hardware order does not activate Plus, connect a device or claim that a product has shipped.

The retained live implementation uses Stripe's HTTPS API directly. No merchant credentials, live price object, shipping coverage or shipping charge have been configured, so these backend endpoints still reject real purchases until configured. The prototype's user-requested CNY 350 price is independent of that backend. Redirect parameters never establish real paid status.

## Merchant configuration

Set these through the hosting service's server-side configuration; never put secret values in browser code, repository files or chat:

| Variable | Required value |
| --- | --- |
| `STRIPE_SECRET_KEY` | The merchant's server API secret, test or live mode |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the matching webhook endpoint/mode |
| `STRIPE_PRICE_PAWPRINT_ONE` | Active, fixed, one-time Stripe Price ID for Pawprint One |
| `STRIPE_SHIPPING_COUNTRIES` | Explicit comma-separated permitted delivery countries, ISO alpha-2 |
| `STRIPE_SHIPPING_RATE` | Active fixed Shipping Rate ID in the product's currency; an explicitly configured zero amount supports included delivery |

`AUTH_DB` and `AUTH_SECRET` are the existing account/database bindings. Migrations `0003_pawprint_billing` and `0004_pawprint_shop` must run before this Worker is served. The existing subscription Price variable is independent and is not required to sell hardware.

Accepted hardware currencies are CNY, GBP, USD, EUR, CAD, AUD, HKD and SGD. API amounts use their standard two-decimal minor unit, e.g. 10000 means 100.00. No production amount or delivery country is preset. Product and delivery amounts are fetched from Stripe, checked for mode/currency/type and cached for at most 60 seconds. Checkout uses the price and delivery configuration stored when its order was created, so retries do not silently change its terms.

The current integration charges exactly the configured product price plus the configured shipping rate. It does not enable automatic tax, discounts, optional quantities or currency conversion. The merchant must decide final prices, tax treatment, delivery coverage, stock availability, returns and fulfillment before enabling live sales. If variable taxes or regional shipping are required, extend and validate the server totals contract first. Configure the desired payment methods in the merchant's Stripe account; Checkout presents those eligible for that account, currency, customer and device. Do not promise a particular wallet before that configuration is verified.

## API contract

| Endpoint | Authentication | Result |
| --- | --- | --- |
| `GET /api/shop/catalog` | Public | `mode`, one `products` entry, configured `shipping` |
| `POST /api/shop/checkout` | Real signed-in account; same-origin JSON | Hosted checkout `url` and provider `mode` |
| `GET /api/shop/orders` | Real signed-in account | That account's latest 20 orders, scoped to provider mode |
| `POST /api/billing/webhook` | Stripe raw-body signature and timestamp | Shared subscription/hardware event receiver |

Checkout request:

```json
{"productId":"pawprint-one","quantity":1,"locale":"en"}
```

`locale` accepts `en` or `zh`; the hosted checkout uses Stripe's automatic locale. Quantity is fixed to one. Client-supplied price, account, shipping, success URLs or arbitrary products are rejected. Test/demo app sessions cannot purchase, even when Stripe itself is in test mode. A real app account can exercise Stripe test mode without a real charge.

Catalog product fields are `id`, `name`, `price: {amount,currency} | null`, `available`, and `reason`. Unconfigured reasons are `payment_setup_required`, `price_not_configured` or `shipping_not_configured`. Shipping is `{amount,currency,countries}` when valid. Provider failures return a retryable error rather than pretending that setup succeeded. Errors use `{error:{code,message}}`.

Order fields are `id`, `productId`, `quantity`, `amount` (including configured shipping), `currency`, `status`, `createdAt`, `paidAt`, `refundedAmount` and `mode`. Status is one of `pending`, `paid`, `failed`, `expired`, `partially_refunded`, `refunded` or `disputed`. These are **payment states**, not delivery tracking. Card numbers, payment credentials and delivery addresses are collected and retained by Stripe, not this app database.

## Verification and fulfillment

Register `https://pawprint-health.zipeiweng453524.chatgpt.site/api/billing/webhook` in the matching Stripe account/mode. Subscribe to the existing subscription events from `PAYMENTS.md` and these hardware-related events:

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
- `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`
- `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`
- `refund.created`, `refund.updated`, `refund.failed`

The shared billing endpoint verifies signature, age and mode before dispatching hardware events. Event payloads only locate an order. The handler retrieves the current Checkout Session, line item, PaymentIntent and charge, then verifies owner metadata, product price, quantity, currency, total, configured shipping rate and permitted delivery country. Paid status requires a completed Checkout Session, successful payment, matching received amount and paid charge. Delayed payment methods remain pending until confirmed. Refunds and disputes are read from the current provider state; a stale event cannot overwrite a later resolved state. Webhook retries are deduplicated only after a successful database update.

The browser return to `?order=success` only opens the Shop and polls verified orders. `?order=cancelled` does not cancel or pay an order. Until verified, orders remain pending; a customer can resume the same open Checkout Session. A per-account database lease plus a durable order idempotency key prevents repeated clicks and network retries from creating parallel checkouts. If a create-session response is lost, the next request reuses its key. Unresolved requests older than 23 hours are blocked from replay to avoid crossing Stripe's 24-hour idempotency retention boundary: resolve the matching order metadata in Stripe and retry its signed webhook before permitting another purchase.

Fulfill only after confirmed payment. The merchant can find the order by `pawprint_order_id` metadata in Stripe, retrieve its collected delivery address there and arrange shipment. This release does not include a warehouse integration, stock ledger, shipment notifications or delivery tracking. Refunds are initiated in Stripe and synchronized to the app. Do not fulfill pending, failed, disputed or refunded orders without resolving their state.

## Validation before live use

Run `node --test tests/shop.test.mjs tests/shop-client.test.mjs tests/billing.test.mjs` and the normal Worker build. Then configure the merchant's **test-mode** price, shipping and webhook endpoint and exercise a hosted checkout using Stripe test payment details. Confirm completed, cancelled, delayed/failed payment, duplicate webhook, refund and dispute paths. The automated suite mocks Stripe and does not prove the merchant account is configured. Live checkout cannot be verified until the real merchant supplies configuration and completes its activation requirements.

Primary implementation references: [Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create), [fulfillment](https://docs.stripe.com/checkout/fulfillment), [shipping collection and rates](https://docs.stripe.com/payments/collect-addresses), [webhook signatures](https://docs.stripe.com/webhooks/signature), [idempotent requests](https://docs.stripe.com/api/idempotent_requests), and [dispute states](https://docs.stripe.com/api/disputes/object).
