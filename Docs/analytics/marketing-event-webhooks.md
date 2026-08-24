# Marketing event webhooks

OneUptime does not store marketing conversions. The five moments worth
measuring are POSTed to one endpoint as they happen and kept nowhere
afterwards. This document is the payload contract.

There used to be a `MarketingConversion` table holding every conversion, its
attribution and its chain. It is gone, and with it the ability to ask OneUptime
"what converted last month" — that question is now answered by whatever
receives these webhooks. Everything below follows from that: deduplication,
ordering and joining are the receiver's job, because there is no second copy
anywhere to reconcile against.

## Configuration

| Variable | Meaning |
| --- | --- |
| `MARKETING_WEBHOOK_URL` | Endpoint that receives every event. Empty disables emission entirely. |
| `MARKETING_WEBHOOK_SECRET` | Shared secret used to sign each request. |

Both are required. A URL set without a secret is **refused, not sent
unsigned** — the payload carries email addresses and campaign data, and an
endpoint with no way to tell OneUptime's POST from anyone else's is not one
worth sending to. When that happens, nothing is queued and an error is logged
naming the event that was dropped.

Where the values are set:

| Deployment | Location |
| --- | --- |
| Docker Compose | `MARKETING_WEBHOOK_URL` / `MARKETING_WEBHOOK_SECRET` in `config.env` |
| Helm | `marketing.webhook.url` / `marketing.webhook.secret` |

Self-hosted installs generally leave these empty. Nothing accumulates waiting
for an endpoint to be configured: an unset URL means those moments are simply
not measured.

## Transport

`POST {MARKETING_WEBHOOK_URL}`, `content-type: application/json`.

| Header | Value |
| --- | --- |
| `x-oneuptime-signature-256` | HMAC-SHA256 over the exact request body bytes, hex encoded |
| `x-oneuptime-event-id` | Same as `eventId` in the body — lets you dedupe before parsing |
| `x-oneuptime-event-type` | Same as `eventType` in the body — lets you route before parsing |

**Verify over the raw bytes.** JSON parsed and re-serialised is not equivalent:
whitespace, key order and escaping all change the digest. OneUptime serialises
the body once and signs that exact string, so your receiver must compute its
digest over the bytes it received, before any parsing. This is the same scheme
OneUptime verifies on the way in from Cal.com, deliberately — one thing to
understand rather than two.

Node example:

```js
const expected = crypto
  .createHmac("sha256", process.env.MARKETING_WEBHOOK_SECRET)
  .update(rawBodyBuffer)          // NOT JSON.stringify(req.body)
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
  "eventId": "meeting_booked:cal-booking-abc123",
  "eventType": "meeting_booked",
  "occurredAt": "2026-08-24T09:14:22.187Z",
  "email": "buyer@acme.com",
  "emailHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "attribution": {
    "utmSource": "google",
    "utmMedium": "cpc",
    "utmCampaign": "enterprise-observability",
    "utmTerm": "datadog alternative",
    "utmContent": "demo-cta-b",
    "utmUrl": "https://oneuptime.com/enterprise/demo?gclid=abc",
    "clickIds": { "gclid": "abc" },
    "firstTouch": {
      "utmSource": "linkedin",
      "landingUrl": "https://oneuptime.com/enterprise"
    }
  },
  "data": { }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | number | Currently `1`. Additive property changes keep the version; a change to what an existing field *means* raises it. |
| `eventId` | string | Stable per real-world occurrence. **This is your deduplication key.** |
| `eventType` | string | One of the five below. |
| `occurredAt` | string | ISO 8601 UTC. When the conversion happened, not when it was sent. |
| `email` | string? | Plaintext address. Absent when OneUptime has none. |
| `emailHash` | string? | SHA-256 hex of the trimmed, lowercased address. |
| `attribution` | object | Campaign the converting visitor carried. All fields optional; `clickIds` and `firstTouch` are always objects, possibly empty. |
| `data` | object | Event-specific detail — see each event below. |

### Two things the envelope does not give you

**Ordering.** Events carry no sequence number and are delivered per
occurrence. A signup and a plan change seconds apart may arrive in either
order. Order by `occurredAt`, never by arrival time.

**Chains.** OneUptime no longer joins a booked meeting to the signup it
produced — that was the ledger's job. Join on `emailHash` (or `email`)
yourself. The normalisation is trim + lowercase before SHA-256, with no
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
reported rather than filtered so you decide which you care about.

### `meeting_booked`

A Cal.com booking was created and its signature verified.

- **eventId**: `meeting_booked:{calBookingUid}`.
- **occurredAt**: when the booking was **made**.
- **attribution**: read out of the Cal booking metadata the demo embed carried.

```json
"data": {
  "calBookingId": "cal-booking-abc123",
  "meetingStartsAt": "2026-09-02T15:00:00.000Z"
}
```

Note the two timestamps are different things. `occurredAt` is when the person
booked; `meetingStartsAt` is when the meeting happens and is normally in the
future. The old ledger conflated them, which meant someone who booked on Monday
for a Friday meeting and signed up on Tuesday looked like they signed up first.

Only `BOOKING_CREATED` produces this event. Reschedules and cancellations do
not.

### `subscription_upgraded` / `subscription_downgraded`

A project moved between plan tiers.

- **eventId**: `subscription_upgraded:{projectId}:{occurredAt}` — a project can legitimately upgrade, downgrade and upgrade again, so unlike the others there is no naturally unique key and the instant is what separates one change from the next.
- **occurredAt**: when the change was applied.
- **attribution**: copied from the Project row, which inherits it from the creating user.

Direction is decided by **plan order, not price**. A monthly-to-yearly switch at
the same tier is an interval change and emits nothing. A project's first paid
plan has no previous tier to compare against and emits nothing either.

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
event joinable: it shares an `emailHash` with the `meeting_booked` that preceded
it, often by months, and the campaign on that booking is the campaign that won
the deal. If the field is left blank the event still fires — a licence issued is
worth knowing about either way — but it will attribute to nothing.

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

**No conversion values on `sign_up` or `meeting_booked`.** A signup is not
money and a booked meeting is not money. Attaching a number to either would
make revenue reporting wrong in the direction that flatters it.

**No revision of a value already sent.** `subscription_upgraded` reports MRR at
the moment of the change. A customer who later expands from one seat to ten
produces no new event, because seat changes are not tier changes — that
expansion revenue is invisible here, exactly as it was in the old ledger. If
you need it, the seat-count change would have to become its own event.

**No `enterprise_license_renewed` or `_expired`.** Only issuance is emitted.

**No delivery to ad platforms.** OneUptime sends conversions to your endpoint
and nowhere else. Note that Google Tag Manager and GA4 are still present on the
marketing site (`Home/Views/head-basic.ejs`, consent-gated), and a GA4 property
linked to a Google Ads account still imports its key events — that is a
separate, browser-side pipeline which was never fed by this one.
