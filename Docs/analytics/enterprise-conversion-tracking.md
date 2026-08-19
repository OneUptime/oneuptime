# Enterprise conversion tracking

This document defines the current boundary between browser analytics, the
server-confirmed conversion ledger, Cal.com, native Revenue, and downstream
providers.

## Architecture and sources of truth

| Concern | Source of truth | Notes |
| --- | --- | --- |
| A meeting was booked | App `MarketingConversion` ledger | Written only after a verified Cal `BOOKING_CREATED` webhook. Browser events are supporting diagnostics, not proof of conversion. |
| Booking details | Cal.com | The webhook supplies the booking identifier and time. Do not treat copied browser payloads as authoritative. |
| Contact, account, deal, qualification, and pipeline stage | Native Revenue | A meeting conversion does not create, qualify, or advance Revenue records. |
| First-touch acquisition | OneUptime's persisted first-touch attribution | Joining it to a booking is blocked until the Cal metadata contract is confirmed. |
| Web analytics | GA4/PostHog/GTM | Useful for aggregate funnel analysis and client-side diagnostics. Never the authoritative conversion ledger. |
| Ad-platform conversion state | `MarketingConversion.uploadState` and the provider | Only explicitly eligible conversion types and explicitly defined provider mappings may be uploaded. |

The App endpoint is the trust boundary. Cal signs the exact request bytes, the
App verifies them, and only then may the App write the internal conversion
ledger. Analytics and provider delivery are best-effort consumers and must not
block booking or Revenue workflows.

## Canonical `meeting_booked` semantics

`meeting_booked` means: **Cal.com emitted a valid, signature-verified
`BOOKING_CREATED` event with a stable booking identifier, and the App recorded
that booking once in the server-side conversion ledger.** The corresponding
internal enum value is `MarketingConversionType.MeetingBooked`.

A page view, opening the Cal embed, choosing a time, or a client-side callback
alone is not `meeting_booked`. Reschedules and cancellations are also not new
bookings under the current contract. Only `BOOKING_CREATED` is accepted.

The Home Cal embeds still have a legacy `bookingSuccessful` browser listener.
That listener currently emits legacy client events such as `demo_request`,
`demo_booked`, and `home/demo-booked`. Keep it for continuity and diagnostics,
but do not count it as the canonical conversion or use it to write the ledger.
If GTM/GA4 exposes a canonical `meeting_booked` event, it must be derived from a
server-confirmed event or clearly reported as a modeled mirror; it must not
silently relabel the legacy browser callback as authoritative.

## Cal webhook

The public endpoint is:

```text
POST /api/cal-webhook
```

Configure the App with `CAL_WEBHOOK_SECRET`. Configure a Cal.com webhook for the
production URL ending in `/api/cal-webhook`, subscribe it to
`BOOKING_CREATED`, and configure the same secret in Cal. Do not put the secret
in source control, client JavaScript, documentation examples, logs, or analytics
properties.

Cal sends the signature in `x-cal-signature-256`. The App computes HMAC-SHA256
over the **exact raw HTTP request body bytes** using `CAL_WEBHOOK_SECRET` and
compares the hexadecimal digest in constant time. JSON parsed and serialized
again is not equivalent: whitespace, escaping, and key order can change the
signature. Proxies and middleware must preserve the body unchanged and the App
must retain the raw body before JSON parsing.

Expected responses:

- `200 {"accepted":true}` for a valid new `BOOKING_CREATED` event.
- `200 {"accepted":true,"duplicate":true}` when the booking is already in the
  ledger (a concurrent duplicate may return the first shape after its unique
  conflict is safely absorbed).
- `200 {"accepted":false}` for a validly signed but unsupported event type.
- `400` for an invalid supported-event payload.
- `401` for a missing or invalid signature.
- `503` when `CAL_WEBHOOK_SECRET` is not configured.

## Idempotency

Retries for one Cal booking resolve to one deterministic ledger UUID. The App
hashes the namespace `cal.com/booking` plus the stable Cal booking identifier,
uses the first 16 digest bytes as a UUIDv5-shaped value, and assigns that UUID as
the `MarketingConversion` primary key. It checks for that ID before insert and
also treats a database unique violation as a successful retry.

Consequences:

- The booking identifier must be stable and non-empty.
- Retrying the exact event cannot create another conversion.
- Do not generate a random UUID per webhook delivery.
- Do not use attendee email, time, or mutable booking fields as the idempotency
  key.

## Privacy and attribution

The webhook parser retains only allowlisted click-ID keys found in supported Cal
metadata/response locations:

- `gclid`
- `wbraid`
- `gbraid`
- `fbclid`
- `msclkid`
- `li_fat_id`
- `twclid`
- `rdt_cid`

Unknown metadata is not copied into `clickIds`; retained values are length
bounded. Attendee email may be stored internally for controlled matching, but
it is PII and must not be sent to GA4, GTM's `dataLayer`, PostHog event
properties intended for broad analytics, URLs, or logs. Never send names,
emails, phone numbers, free-form booking answers, or other customer content to
GA4. GA4 events should contain only non-PII fields needed for aggregate
measurement, such as the stable event name, schema version, and coarse page or
source classification.

Provider uploads require their own explicit mapping, consent/privacy review,
and supported identifier handling. The existence of a click ID in the ledger
does not authorize an upload.

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
   curl --fail-with-body -i \
     -X POST 'http://localhost:3002/api/cal-webhook' \
     -H 'content-type: application/json' \
     -H "x-cal-signature-256: $SIGNATURE" \
     --data-binary "$BODY"
   ```

4. Verify a `200` response with `accepted: true`. In the test database, verify
   there is one `MeetingBooked` ledger row, the conversion time matches the
   payload, `gclid` is retained, and `unapproved_key` is absent. Verify no PII
   appeared in GA4/GTM payloads or application logs.

5. Repeat the identical `curl`. Verify it remains `200` and that the ledger row
   count is still one. The response will normally include `duplicate: true`.

6. Negative test the signature without changing the stored environment secret:

   ```sh
   curl -i \
     -X POST 'http://localhost:3002/api/cal-webhook' \
     -H 'content-type: application/json' \
     -H 'x-cal-signature-256: 0000000000000000000000000000000000000000000000000000000000000000' \
     --data-binary "$BODY"
   ```

   Verify `401` and no additional ledger row.

7. In Cal's staging/test configuration, create a webhook to the externally
   reachable staging `/api/cal-webhook` URL, select only `BOOKING_CREATED`, set
   the staging secret, make one test booking, and repeat the ledger,
   idempotency, allowlist, and analytics-privacy checks. Remove the disposable
   booking and rotate the staging test secret after validation.

The example email uses the reserved `.invalid` domain and must not be replaced
with a real person's data.

## Blockers and follow-ups

1. **Confirm the Cal metadata schema.** Define exactly how first-touch UTMs and
   click IDs are transferred into Cal and returned by `BOOKING_CREATED`. Also
   define stable, validated native Revenue contact, account, and deal reference
   fields. Until that contract is confirmed, do not claim that bookings can be
   reliably joined to first-touch attribution or Revenue records.
2. **Do not auto-qualify or create a deal.** `meeting_booked` records a meeting,
   not enterprise qualification, technical evaluation, or opportunity
   acceptance. Native Revenue remains authoritative and its workflows must make
   those decisions explicitly.
3. **Do not add `QualifiedEnterpriseLead`, `TechnicalEvaluationStarted`,
   `OpportunityCreated`, or `ClosedWon` yet.** Add them only after native Revenue
   emits durable domain events with documented semantics, identifiers,
   idempotency, and ownership.
4. **Define provider mappings before upload.** For every future Revenue event,
   explicitly map the native event to each provider's conversion action,
   eligibility rules, timestamp/value semantics, identifier policy, consent
   requirements, retry behavior, and reconciliation source. No implicit mapping
   by similar event name is allowed.
5. **Reconcile the legacy listener.** Once the server-confirmed event can be
   mirrored safely to browser analytics, update dashboards/GTM to distinguish
   the canonical `meeting_booked` metric from legacy `bookingSuccessful`-based
   events and document any historical discontinuity.
