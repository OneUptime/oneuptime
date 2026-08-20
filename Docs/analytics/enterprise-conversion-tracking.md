# Enterprise conversion tracking

This document defines the boundary between browser analytics, the
server-confirmed conversion ledger, Cal.com, native Revenue, and the ad
platforms.

## Architecture and sources of truth

| Concern                                                   | Source of truth                                    | Notes                                                                                                                                      |
| --------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A meeting was booked                                      | `MarketingConversion` ledger                       | Written only after a signature-verified Cal `BOOKING_CREATED` webhook. Browser events are supporting diagnostics, not proof of conversion. |
| Booking details                                           | Cal.com                                            | The webhook supplies the booking identifier and time. Copied browser payloads are not authoritative.                                       |
| Contact, account, deal, qualification, and pipeline stage | Native Revenue                                     | A meeting conversion does not create, qualify, or advance Revenue records.                                                                 |
| First-touch acquisition                                   | OneUptime's persisted first-touch attribution      | Joining it to a booking is blocked until the Cal metadata contract is confirmed.                                                           |
| Web analytics                                             | GA4 / PostHog / GTM                                | Useful for aggregate funnel analysis and client-side diagnostics. Never the authoritative conversion ledger.                               |
| Ad-platform conversion state                              | `MarketingConversion.uploadState` and the provider | Only conversion types with an explicit provider mapping may be uploaded.                                                                   |

`POST /api/cal-webhook` is the trust boundary. Cal signs the exact request
bytes, the App verifies them, and only then does the App write the ledger.
Analytics and ad-platform delivery are best-effort consumers downstream of
that; neither may block booking or Revenue workflows.

## Canonical `meeting_booked` semantics

`meeting_booked` means: **Cal.com emitted a signature-verified
`BOOKING_CREATED` event with a stable booking identifier, and the App recorded
that booking once in the server-side conversion ledger.** The internal enum
value is `MarketingConversionType.MeetingBooked`.

A page view, opening the Cal embed, choosing a time, or a client-side callback
alone is not `meeting_booked`. Reschedules and cancellations are not new
bookings: only `BOOKING_CREATED` is accepted.

The Home Cal embeds (`/enterprise/demo` and `/support`) also emit a browser
`meeting_booked` through `window.oneUptimeTrackMeetingBooked`, defined in
`Home/Views/head-basic.ejs`. That event is a mirror of the same moment for
funnel analysis, not the commercial record — the browser can be blocked, can
double-fire, and can be forged. The per-page legacy events
(`home/demo-booked`, `home/support-call-booked`, `demo_request`,
`demo_booked`) are still emitted so existing dashboards keep their history.
When reconciling the two, treat the ledger as the count and the browser event
as coverage.

## Cal webhook

The endpoint is:

```text
POST /api/cal-webhook
```

Configure the App with `CAL_WEBHOOK_SECRET`, then create a Cal.com webhook
pointed at the production URL ending in `/api/cal-webhook`, subscribed to
`BOOKING_CREATED` only, with the same secret. Never put the secret in source
control, client JavaScript, documentation examples, logs, or analytics
properties. It is deliberately absent from `FRONTEND_ENV_ALLOW_LIST`.

Where the value is set:

| Deployment     | Location                                                        |
| -------------- | --------------------------------------------------------------- |
| Docker Compose | `CAL_WEBHOOK_SECRET` in `config.env` (see `config.example.env`) |
| Helm           | `marketing.cal.webhookSecret` in the chart values               |

Cal sends the signature in `x-cal-signature-256`. The App computes HMAC-SHA256
over the **exact raw HTTP request body bytes** using `CAL_WEBHOOK_SECRET` and
compares the hexadecimal digest in constant time. A `sha256=` prefix and
uppercase hex are both tolerated. JSON parsed and serialised again is not
equivalent — whitespace, escaping, and key order all change the digest — so
proxies and middleware must pass the body through unchanged, and the App reads
the raw body express captured before parsing.

Expected responses:

- `200 {"accepted":true}` for a valid new `BOOKING_CREATED` event.
- `200 {"accepted":true,"duplicate":true}` when the booking is already in the
  ledger, whether that was found by the pre-insert read or by absorbing the
  unique violation from a concurrent delivery.
- `200 {"accepted":false}` for a validly signed but unsupported event type.
- `400` for a `BOOKING_CREATED` payload with no usable booking identifier or an
  unparseable date.
- `401` for a missing, malformed, or invalid signature.
- `503` when `CAL_WEBHOOK_SECRET` is not configured.

The booking identifier is read from `payload.uid`, `payload.booking.uid`,
`payload.bookingUid`, `payload.booking.id` or `payload.id`, in that order.
Cal's `uid` is a string and its row `id` is a number; both are accepted.

## Idempotency

Cal retries on any non-2xx, so a booking arriving more than once is the normal
path rather than an edge case. Every delivery of one booking resolves to one
deterministic ledger UUID: the App hashes the namespace `cal.com/booking` plus
the Cal booking identifier, takes the first 16 digest bytes as a UUIDv5-shaped
value, and uses that as the `MarketingConversion` primary key. It reads that id
before inserting, and treats a unique violation on insert as a success — the
row exists, which is the whole point of deriving the key.

Consequences:

- The booking identifier must be stable and non-empty.
- Retrying the exact event cannot create a second conversion.
- Do not generate a random UUID per webhook delivery.
- Do not key on attendee email, time, or any other mutable booking field.
- Do not change `cal.com/booking`. Re-keying would make every booking already
  in the ledger insertable a second time.

## Privacy and attribution

The webhook parser retains only allowlisted click-ID keys, read from
`payload.metadata`, `payload.booking.metadata` and `payload.responses`
(a `{ label, value }` answer is unwrapped):

- `gclid`
- `wbraid`
- `gbraid`
- `fbclid`
- `msclkid`
- `li_fat_id`
- `twclid`
- `rdt_cid`

This is an allowlist, not a denylist. Cal metadata and booking answers are
free-form customer content — names, notes, phone numbers, answers to booking
questions — and nothing outside the list above is copied into the ledger.
Retained values are length bounded.

The attendee email is stored internally for controlled matching, and it is
PII: it must not be sent to GA4, GTM's `dataLayer`, PostHog event properties,
URLs, or logs. The browser `meeting_booked` event carries only
`event_schema_version`, `booking_source`, `booking_kind`, `page_path`,
`cal_event_type` and `cal_namespace` for exactly this reason — Cal's `bookingSuccessful` detail
holds the attendee's name and email, and none of it is forwarded.

## Ad-platform uploads

`MeetingBooked` is a ledger-only conversion type. Every provider maps a
conversion to a platform conversion action with a two-way branch on
`isSignUp()`, so a type with no mapping would be uploaded as a _purchase_
carrying whatever value the row holds. `ConversionUploadProvider.getSkipReason`
screens conversion types against `AdUploadableMarketingConversionTypes` before
any provider hook runs, and the worker records the result as `Skipped`.

Adding a conversion type to that allowlist requires an explicit mapping in
every provider: conversion action, eligibility rules, timestamp and value
semantics, identifier policy, consent requirements, retry behaviour, and a
reconciliation source. Mapping by similar event name is not allowed. The
presence of a click ID in the ledger does not by itself authorise an upload.

## End-to-end local/staging test

Use a non-production environment and placeholder values. The procedure below
does not contain or print a real secret.

1. Set a disposable secret in the App environment and restart the App:

   ```sh
   export CAL_WEBHOOK_SECRET='local-test-secret-not-for-production'
   ```

2. Build the body once. Do not reformat it between signing and sending:

   ```sh
   BODY='{"triggerEvent":"BOOKING_CREATED","payload":{"uid":"docs-test-booking-001","startTime":"2030-01-02T15:04:05.000Z","attendees":[{"email":"test@example.invalid"}],"metadata":{"gclid":"test-click-id","unapproved_key":"must-not-be-retained"}}}'
   SIGNATURE="$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac 'local-test-secret-not-for-production' -hex | awk '{print $NF}')"
   ```

3. Send those exact bytes (adjust the host only):

   ```sh
   curl --fail-with-body -i -X POST 'http://localhost:3002/api/cal-webhook' -H 'content-type: application/json' -H "x-cal-signature-256: $SIGNATURE" --data-binary "$BODY"
   ```

4. Verify a `200` response with `accepted: true`. In the database, verify there
   is one `MeetingBooked` row, its `conversionAt` matches the payload, `gclid`
   is retained, and `unapproved_key` is absent. Verify no PII appeared in
   GA4/GTM payloads or application logs.

5. Repeat the identical `curl`. Verify it is still `200`, that the response
   carries `duplicate: true`, and that the row count is still one.

6. Negative-test the signature without changing the stored environment secret:

   ```sh
   curl -i -X POST 'http://localhost:3002/api/cal-webhook' -H 'content-type: application/json' -H 'x-cal-signature-256: 0000000000000000000000000000000000000000000000000000000000000000' --data-binary "$BODY"
   ```

   Verify `401` and no additional row.

7. In Cal's staging configuration, create a webhook to the externally reachable
   staging `/api/cal-webhook` URL, select only `BOOKING_CREATED`, set the
   staging secret, make one test booking, and repeat the ledger, idempotency,
   allowlist and analytics-privacy checks. Remove the disposable booking and
   rotate the staging test secret afterwards.

The example email uses the reserved `.invalid` domain and must not be replaced
with a real person's data.

## Deliberately not implemented

1. **First-touch UTM and Revenue joins.** How first-touch UTMs and click IDs
   are transferred into Cal, and which stable native Revenue contact, account
   and deal reference fields come back on `BOOKING_CREATED`, is not defined.
   Until that contract is confirmed, bookings cannot be reliably joined to
   first-touch attribution or Revenue records, and the ledger does not claim
   otherwise.
2. **Auto-qualification and Deal creation.** `MeetingBooked` records a meeting,
   not enterprise qualification, technical evaluation, or opportunity
   acceptance. Native Revenue remains authoritative and must make those calls
   explicitly.
3. **`QualifiedEnterpriseLead`, `TechnicalEvaluationStarted`,
   `OpportunityCreated`, `ClosedWon`.** Add them only once native Revenue emits
   durable domain events with documented semantics, identifiers, idempotency
   and ownership.
4. **Reconciling the legacy browser events.** Dashboards and GTM still mix the
   canonical `meeting_booked` with the older `bookingSuccessful`-derived
   events. Separating them, and documenting the historical discontinuity, is
   follow-up work.
