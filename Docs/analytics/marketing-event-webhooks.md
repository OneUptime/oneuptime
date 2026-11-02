# Marketing event webhooks

OneUptime does not store marketing conversions. The seven moments worth
measuring are POSTed to one endpoint as they happen and kept nowhere
afterwards. This document is the payload contract.

There used to be a `MarketingConversion` table holding every conversion, its
attribution and its chain. It is gone, and with it the ability to ask OneUptime
"what converted last month" — that question is now answered by whatever
receives these webhooks. Everything below follows from that: deduplication,
ordering and joining are the receiver's job, because there is no second copy
anywhere to reconcile against.

## Configuration

| Variable                   | Meaning                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `MARKETING_WEBHOOK_URL`    | Endpoint that receives every event. Empty disables emission entirely. |
| `MARKETING_WEBHOOK_SECRET` | Shared secret used to sign each request.                              |

Both are required. A URL set without a secret is **refused, not sent
unsigned** — the payload carries email addresses and campaign data, and an
endpoint with no way to tell OneUptime's POST from anyone else's is not one
worth sending to. When that happens, nothing is queued and an error is logged
naming the event that was dropped.

Where the values are set:

| Deployment     | Location                                                             |
| -------------- | -------------------------------------------------------------------- |
| Docker Compose | `MARKETING_WEBHOOK_URL` / `MARKETING_WEBHOOK_SECRET` in `config.env` |
| Helm           | `marketing.webhook.url` / `marketing.webhook.secret`                 |

Self-hosted installs generally leave these empty. Nothing accumulates waiting
for an endpoint to be configured: an unset URL means those moments are simply
not measured.

### Stripe webhook events (OneUptime Cloud)

`first_payment` and `subscription_ended` are read from Stripe's webhook, and
Stripe sends an endpoint only the event types ticked on it. A maintainer has to
tick them in the Stripe dashboard (Developers > Webhooks > the endpoint for
`https://oneuptime.com/api/billing/webhook` > Select events); nothing in this
repository can do it, and until it is done neither event is ever sent.

| Stripe event                    | What OneUptime does with it                                                     |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `invoice.finalized`             | Already enabled: emails the invoice to customers who asked for invoice emails.  |
| `invoice.paid`                  | `first_payment`, when the invoice is the first of a project that took money.    |
| `customer.subscription.deleted` | `subscription_ended`, when a paid plan's subscription is cancelled.             |
| `customer.subscription.updated` | `subscription_ended`, when Stripe marks it `unpaid` or `incomplete_expired`.   |

The list is `MARKETING_STRIPE_WEBHOOK_EVENTS` in
`ee/Server/Billing/BillingMarketingEvents.ts`, and a test fails if one named
there is missing from this table. Whatever happens to these events, the webhook
answers Stripe at once: they are reported in the background, and a failure costs
one marketing event, never the webhook.

### Google Analytics Measurement Protocol (OneUptime Cloud)

| Variable                                           | Helm                                                     |
| -------------------------------------------------- | -------------------------------------------------------- |
| `GOOGLE_ANALYTICS_MEASUREMENT_PROTOCOL_API_SECRET` | `analytics.googleAnalytics.measurementProtocolApiSecret` |

A free trial that converts into a payment is the one purchase no browser can
report, so the server sends it to Google Analytics itself. That needs an API
secret, which a maintainer creates in Google Analytics (Admin > Data streams >
the web stream > Measurement Protocol API secrets) and sets here. **It does not
exist until someone creates it**: while it is empty nothing is sent, and the
converted trial reaches only this webhook and PostHog. It is also never sent
where Google tags are off (`GOOGLE_TAG_MANAGER_ENABLED=false`, or billing off).
See [`first_payment`](#first_payment) for what is sent.

## Transport

`POST {MARKETING_WEBHOOK_URL}`, `content-type: application/json`.

| Header                      | Value                                                           |
| --------------------------- | --------------------------------------------------------------- |
| `x-oneuptime-signature-256` | HMAC-SHA256 over the exact request body bytes, hex encoded      |
| `x-oneuptime-event-id`      | Same as `eventId` in the body — lets you dedupe before parsing  |
| `x-oneuptime-event-type`    | Same as `eventType` in the body — lets you route before parsing |

**Verify over the raw bytes.** JSON parsed and re-serialised is not equivalent:
whitespace, key order and escaping all change the digest. OneUptime serialises
the body once and signs that exact string, so your receiver must compute its
digest over the bytes it received, before any parsing.

Node example:

```js
const expected = crypto
  .createHmac("sha256", process.env.MARKETING_WEBHOOK_SECRET)
  .update(rawBodyBuffer) // NOT JSON.stringify(req.body)
  .digest("hex");

const ok = crypto.timingSafeEqual(
  Buffer.from(expected),
  Buffer.from(req.get("x-oneuptime-signature-256") || ""),
);
```

Compare in constant time, and reject before doing anything else with the body.

### Retries and what a non-2xx means

Delivery is queued, not inline. Any non-2xx **or** a transport error is retried
up to 5 times with exponential backoff from 30s — roughly eight minutes in
total, which covers a rolling deploy of the receiver.

A 4xx is retried too. A receiver rejecting a payload it should have taken is
far more often a deploy in progress or a bad rule than a payload that will
never be acceptable, and the alternative — dropping it silently — has no
backstop now that nothing is stored.

**After the attempts are exhausted the event is gone.** There is no dead-letter
store, deliberately: the point of this design is that OneUptime does not hold
marketing data. Alert on the delivery-failure log line rather than expecting to
replay it.

Return `2xx` as soon as you have durably accepted the event. Do your own
processing afterwards.

## Envelope

Every event has the same shape:

```json
{
  "schemaVersion": 1,
  "eventId": "sign_up:0195f2c1-aaaa-bbbb-cccc-ddddeeeeffff",
  "eventType": "sign_up",
  "occurredAt": "2026-08-24T09:14:22.187Z",
  "email": "buyer@acme.com",
  "emailHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "attribution": {
    "utmSource": "google",
    "utmMedium": "cpc",
    "utmCampaign": "enterprise-observability",
    "utmTerm": "datadog alternative",
    "utmContent": "demo-cta-b",
    "utmId": "22334455",
    "utmSourcePlatform": "google_ads",
    "utmCreativeFormat": "video",
    "utmMarketingTactic": "prospecting",
    "utmUrl": "https://oneuptime.com/enterprise/demo?gclid=abc",
    "clickIds": { "gclid": "abc" },
    "firstTouch": {
      "utmSource": "linkedin",
      "landingUrl": "https://oneuptime.com/enterprise"
    }
  },
  "data": {}
}
```

| Field           | Type    | Notes                                                                                                                         |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | number  | Currently `1`. Additive property changes keep the version; a change to what an existing field _means_ raises it.              |
| `eventId`       | string  | Stable per real-world occurrence. **This is your deduplication key.**                                                         |
| `eventType`     | string  | One of the seven below.                                                                                                       |
| `occurredAt`    | string  | ISO 8601 UTC. When the conversion happened, not when it was sent.                                                             |
| `email`         | string? | Plaintext address. Absent when OneUptime has none.                                                                            |
| `emailHash`     | string? | SHA-256 hex of the trimmed, lowercased address.                                                                               |
| `attribution`   | object  | Campaign the converting visitor carried. All fields optional; `clickIds` and `firstTouch` are always objects, possibly empty. UTM keys are exactly `UtmWireKeyToPropertyKey` in `packages/Common/Types/Marketing/Attribution.ts`, in camelCase. |
| `data`          | object  | Event-specific detail — see each event below.                                                                                 |

### Two things the envelope does not give you

**Ordering.** Events carry no sequence number and are delivered per
occurrence. A signup and a plan change seconds apart may arrive in either
order. Order by `occurredAt`, never by arrival time.

**Chains.** OneUptime no longer joins one person's conversions to each other —
that was the ledger's job. Join on `emailHash` (or `email`) yourself. The normalisation is trim + lowercase before SHA-256, with no
gmail dot/plus folding, so hash your own records exactly that way.

## Events

### `sign_up`

A user account was created.

- **eventId**: `sign_up:{userId}` — naturally unique, so a retry cannot become a second conversion.
- **occurredAt**: the user's `createdAt`.
- **attribution**: copied from the User row, captured at registration.

```json
"data": {
  "userId": "0195f2c1-...",
  "hasPassword": true
}
```

`hasPassword` separates a direct signup (`true`) from a user created by a team
invite (`false`). Both are real users; only one is an acquisition. This is
reported rather than filtered so you decide which you care about. A signup with
Microsoft is a direct signup: it is `true`, and it carries the attribution the
visitor arrived with.

### `subscription_started`

A project was created directly on a paid plan.

- **eventId**: `subscription_started:{projectId}` — naturally unique, so a retry cannot become a second conversion. A project has exactly one first subscription.
- **occurredAt**: the project's `createdAt`.
- **attribution**: copied from the Project row, which inherits it from the creating user.

```json
"data": {
  "project_id": "0195f2c1-...",
  "new_plan": "Growth",
  "seats": 1,
  "is_paid_conversion": true,
  "has_custom_pricing": false,
  "is_trial": true,
  "trial_ends_at": "2026-09-07T09:14:22.187Z",
  "new_monthly_amount_in_usd": 49,
  "value": 49,
  "currency": "USD"
}
```

**`is_trial` says whether any money is behind `value`.** A plan with a free
trial starts it here, with no card, so on OneUptime Cloud, where every paid plan
has one, this event is a plan chosen rather than a payment: `value` is what the
plan will cost, and a trial that ends unpaid sends nothing to take it back.
`trial_ends_at` is present only on a trial. Treat `is_trial: true` as a lead,
not as revenue: [`first_payment`](#first_payment) reports the trial becoming a
payment, and [`subscription_ended`](#subscription_ended) one that ends unpaid.

This is **new business, not expansion**. It is deliberately a separate event
rather than a `subscription_upgraded` with an empty `old_plan`: an upgrade is a
movement between two tiers, this has no previous tier at all, and a receiver
that added them together could not separate net-new from expansion again.

Free-plan projects emit nothing here. Every project is subscribed at the
payment provider, including on the free plan, so the paid check is what makes
this a revenue event. `is_paid_conversion` is therefore always `true` when the
event is sent.

The amount fields are omitted entirely when the plan is custom-priced, rather
than being sent as zero.

### `subscription_upgraded` / `subscription_downgraded`

A project moved between plan tiers.

- **eventId**: `subscription_upgraded:{projectId}:{occurredAt}` — a project can legitimately upgrade, downgrade and upgrade again, so unlike the others there is no naturally unique key and the instant is what separates one change from the next.
- **occurredAt**: when the change was applied.
- **attribution**: copied from the Project row, which inherits it from the creating user.

Direction is decided by **plan order, not price**. A monthly-to-yearly switch at
the same tier is an interval change and emits nothing. A project's first paid
plan has no previous tier to compare against and is reported as
`subscription_started` instead.

```json
"data": {
  "project_id": "0195f2c1-...",
  "old_plan": "Growth",
  "new_plan": "Scale",
  "seats": 10,
  "is_upgrade": true,
  "is_downgrade": false,
  "is_interval_change": false,
  "is_paid_conversion": false,
  "has_custom_pricing": false,
  "old_monthly_amount_in_usd": 49,
  "new_monthly_amount_in_usd": 99,
  "value": 990,
  "currency": "USD"
}
```

`data` here is the same property bag the internal analytics event carries, so
the two cannot drift. Keys are snake_case for that reason, unlike the envelope.

`value` is monthly recurring revenue **after** the change — `new_monthly_amount_in_usd × seats`.
The amount fields are omitted entirely when the plan is custom-priced or
unknown, rather than being sent as zero.

### `first_payment`

The first money a project paid. On OneUptime Cloud that is most often the
invoice Stripe raises when a free trial ends and the card is charged — the
moment `subscription_started` could only promise.

- **eventId**: `first_payment:{projectId}` — naturally unique. A project has one first payment, so Stripe sending the webhook again, a second Stripe event about the same payment, or two invoices paid in the same second cannot become two conversions.
- **occurredAt**: when Stripe marked the invoice paid.
- **attribution**: copied from the Project row, which inherits it from the creating user.
- **Read from**: Stripe's `invoice.paid` ([enable it](#stripe-webhook-events-oneuptime-cloud)).

```json
"data": {
  "project_id": "0195f2c1-...",
  "invoice_id": "in_1PqRsTUvWxYz",
  "plan": "Growth",
  "amount_paid": 49,
  "currency": "USD",
  "value": 49,
  "is_trial_conversion": true,
  "has_custom_pricing": false,
  "trial_ends_at": "2026-09-07T09:14:22.187Z"
}
```

`data` also carries the campaign as `utm_*` keys and `click_ids`, as PostHog's
`server/first_payment` does.

**What counts as the first payment.** The first invoice on the project's Stripe
customer whose `amount_paid` is above zero, in the order the invoices were paid
(two paid in the same second are ordered by invoice id). Stripe is asked each
time; OneUptime keeps no record of it. A $0 invoice — the one a trial opens
with — is no payment.

`amount_paid` and `value` are the money that arrived: the invoice's
`amount_paid`, after discounts and any credit balance, in the currency's major
unit (dollars, not cents). They are not the plan's price: a first payment that
is a usage invoice reports that invoice.

`is_trial_conversion` is `true` when the payment is the invoice Stripe raised
as the subscription left its free trial — a trial converting. It is `false` for
a project that pays at once or moves from the free plan to a paid one: those are
conversions too, but their browser has already reported them
(`subscription_started` or `subscription_upgraded`, and GA4's `purchase`).

Free-plan projects emit nothing, even for usage they pay for: like
`subscription_started`, this reports a plan's revenue.

**The same conversion in Google Analytics.** When `is_trial_conversion` is
`true` and the [API secret](#google-analytics-measurement-protocol-oneuptime-cloud)
is set, the server also sends GA4 a `purchase` through the Measurement
Protocol: the one the browser sends for a project that pays at once, which
nobody is present to send when a trial converts.

- `transaction_id` is this event's `eventId`, which GA4 deduplicates purchases on. `value` and `currency` are as above, and the plan is the one item.
- It is sent only for a project whose row carries a campaign: a UTM value, a click ID or a first touch. The signup form and Sign in with Microsoft hand one over only while measurement is allowed, so it is the server's one evidence that whoever started the trial allowed Google Analytics — and a campaign is what the purchase is there to be credited to. A converted trial with no campaign on its project is not sent, so GA4's trial revenue counts campaign-attributed conversions only.
- The campaign travels with the purchase, as a `campaign_details` event ahead of it (source, medium, campaign, campaign_id, term and content from the row's last touch, or `google / cpc` for a Google Ads click that carried only a `gclid`). GA4 applies it to the events after it; there is no browser session left for the purchase to join.
- It is keyed on the creator's internal user ID — the `user_id` the Dashboard gives GA4 on every signed-in page — and a client ID derived from it. The server does not know the browser's own client ID. Consent is sent as granted, which is what the page signalled when that person allowed measurement.

For **Google Ads bidding**, do not count on this purchase reaching Google Ads
through a linked GA4 property: Google Analytics links a conversion to an ad
click through the browser that clicked, and this purchase carries the person
and the campaign, not that browser. Upload `first_payment` from the receiver as
an offline click conversion instead, keyed on `attribution.clickIds.gclid`, with
`occurredAt` as the conversion time and `value` and `currency` as its value —
and bid on one of the two, not both.

### `subscription_ended`

A paid plan's subscription stopped bringing in money: cancelled, its project
deleted, Stripe giving up on a card that kept failing, or a free trial that
ended without ever being paid for.

- **eventId**: `subscription_ended:{stripeSubscriptionId}` — naturally unique: a Stripe subscription ends once. A project that comes back gets a new subscription, and its next ending is a new event.
- **occurredAt**: when Stripe ended the subscription, or when it marked it `unpaid` or `incomplete_expired`.
- **attribution**: copied from the Project row. Empty for a deleted project (below).
- **Read from**: Stripe's `customer.subscription.deleted`, and `customer.subscription.updated` into `unpaid` or `incomplete_expired` ([enable them](#stripe-webhook-events-oneuptime-cloud)).

```json
"data": {
  "project_id": "0195f2c1-...",
  "subscription_id": "sub_1PqRsTUvWxYz",
  "plan": "Growth",
  "status": "unpaid",
  "reason": "trial_ended_unpaid",
  "ever_paid": false,
  "lifetime_amount_paid": 0,
  "currency": "USD",
  "has_custom_pricing": false,
  "trial_ends_at": "2026-09-07T09:14:22.187Z"
}
```

`data` also carries the campaign as `utm_*` keys and `click_ids`, as PostHog's
`server/subscription_ended` does.

| `reason`             | Meaning                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `trial_ended_unpaid` | The trial ran out and the project never paid anything. The other half of an `is_trial: true` `subscription_started`: its value is not coming. |
| `payment_failed`     | Stripe stopped the subscription because payment failed: a card that kept failing, or a first invoice never paid.                        |
| `project_deleted`    | The project was deleted, which cancels its subscriptions.                                                                               |
| `canceled`           | Cancelled any other way: on request, or by OneUptime staff in Stripe.                                                                   |

`lifetime_amount_paid` is everything the project paid, across all its invoices,
in the currency of its latest payment, and `ever_paid` says whether that is
above zero. `status` is Stripe's own.

When Stripe gives up on a failing card is set in the Stripe dashboard, under
Billing > Revenue recovery. The ending is reported when the subscription
becomes `unpaid` or is cancelled, never while it is `past_due` and Stripe is
still retrying. A subscription Stripe first marks `unpaid` and later cancels is
reported twice under one `eventId`; keep the first.

These cancellations are not endings, and send nothing:

- **A plan change.** One that cannot swap the price on the subscription creates a replacement, carrying the id of the subscription it replaces, and then cancels the old one. That is a move, not an ending.
- **A move to a cloud marketplace.** The card subscriptions are cancelled because AWS, Azure or Google Cloud bills the project from then on.
- **A free plan's subscription**, and the metered usage subscription every project has beside its plan.

**A deleted project** has no row left. Its ending is read from the snapshot
`DeletedProject` keeps, which holds the project ID and its creator's address but
no campaign: `attribution` is empty, and the receiver joins the event to the
project's earlier ones on `project_id` or `emailHash`.

### `enterprise_license_issued`

A sales-led licence was issued, carrying its annual contract value.

- **eventId**: `enterprise_license_issued:{enterpriseLicenseId}`.
- **occurredAt**: the licence row's `createdAt`.
- **attribution**: **always empty.** A licence is typed in by a human and carries no browser session.

```json
"data": {
  "enterpriseLicenseId": "0195f2c1-...",
  "companyName": "Acme, Inc.",
  "annualContractValueInUSD": 48000,
  "currency": "USD",
  "isEvaluationLicense": false,
  "userLimit": 250,
  "expiresAt": "2027-08-24T00:00:00.000Z"
}
```

This is the only event that reports enterprise revenue. Everything else is
self-serve and knows its own value from the plan table; an enterprise contract
is negotiated, so `annualContractValueInUSD` is the only place the number
exists at all.

**How this gets attributed.** `EnterpriseLicense.email` is set by whoever
issues the licence in the admin dashboard, and the instruction is to set it to
the address the customer booked their meeting with. That is what makes this
event joinable: it shares an `emailHash` with whatever else that address did,
often months earlier, and the campaign on that earlier conversion is the
campaign that won the deal. If the field is left blank the event still fires — a
licence issued is worth knowing about either way — but it will attribute to
nothing.

`annualContractValueInUSD` and `userLimit` are `null` when unset, never `0`.
Defaulting them to zero would quietly drag reported contract value down.

## Receiver checklist

1. Verify `x-oneuptime-signature-256` over the raw bytes, in constant time, before parsing.
2. Deduplicate on `eventId`. Retries are the normal path, not an edge case.
3. Return 2xx once durably accepted; do processing after.
4. Order by `occurredAt`, not arrival.
5. Join a person's events on `emailHash` — nothing upstream does it for you.
6. Alert on delivery failures. An exhausted event is not recoverable.

## What is deliberately not here

**No conversion value on `sign_up`.** A signup is not money. Attaching a number
to it would make revenue reporting wrong in the direction that flatters it.

**No `meeting_booked`.** A booked demo was once emitted here, sourced from a
signature-verified Cal.com `BOOKING_CREATED` webhook. That endpoint has been
removed, so no booking event is emitted at all — bookings are visible in Cal.com
itself, and on the marketing site's own browser analytics
(Docs/analytics/enterprise-conversion-tracking.md), neither of which feeds this
pipeline.

**No revision of a value already sent.** `subscription_upgraded` reports MRR at
the moment of the change. A customer who later expands from one seat to ten
produces no new event, because seat changes are not tier changes — that
expansion revenue is invisible here, exactly as it was in the old ledger. If
you need it, the seat-count change would have to become its own event.

**No `enterprise_license_renewed` or `_expired`.** Only issuance is emitted.

**Only the first payment.** Renewals, usage invoices and every later payment
are not events. `first_payment` says when a project's money starts and
`subscription_ended` when it stops, with what was paid in between
(`lifetime_amount_paid`); a running total for a customer who is still paying is
Stripe's to report.

**No delivery to ad platforms.** OneUptime sends conversions to your endpoint
and, with one exception, nowhere else: a free trial that converts is also sent
to GA4 as a `purchase`, once the Measurement Protocol API secret is set
([`first_payment`](#first_payment)), because no browser is there to send it.
Google Tag Manager and GA4 are otherwise browser-side, on the marketing site
(`packages/Home/Views/head-basic.ejs`, consent-gated), and a GA4 property
linked to a Google Ads account still imports its key events — that is a
separate pipeline which this one does not feed.
