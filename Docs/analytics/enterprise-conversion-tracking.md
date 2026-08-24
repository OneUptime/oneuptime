# Enterprise conversion tracking

This document covers how a booked demo is captured and attributed. **The
payload contract for everything OneUptime emits lives in
[marketing-event-webhooks.md](./marketing-event-webhooks.md)** — read that
first if you are building a receiver.

## Architecture and sources of truth

OneUptime stores no conversions. There is no ledger table; a verified booking
becomes an outbound `meeting_booked` webhook and nothing else.

| Concern                                               | Source of truth                         | Notes                                                                                                                              |
| ----------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A meeting was booked                                  | The `meeting_booked` webhook            | Emitted only after a signature-verified Cal `BOOKING_CREATED`. Browser events are supporting diagnostics, not proof of conversion. |
| Booking details                                       | Cal.com                                 | The webhook supplies the booking identifier and time.                                                                              |
| Contact, account, deal, qualification, pipeline stage | Native Revenue                          | A meeting conversion does not create, qualify, or advance Revenue records.                                                         |
| Campaign attribution for a conversion                 | The event's `attribution` object        | Copied from the User/Project, or read from Cal booking metadata.                                                                   |
| Which conversions belong to one person                | `emailHash` on each event               | The receiver joins on it. Nothing in OneUptime joins them any more.                                                                |
| Enterprise contract value                             | `EnterpriseLicense.annualContractValue` | Reported by `enterprise_license_issued`, joined to its booking by `EnterpriseLicense.email`.                                       |
| Web analytics                                         | GA4 / PostHog / GTM                     | Aggregate funnel analysis and client-side diagnostics. Never the authoritative conversion record.                                  |

`POST /api/cal-webhook` is the trust boundary for a booking. Cal signs the exact
request bytes, the App verifies them, and only then does the App emit. Analytics
and webhook delivery are best-effort consumers downstream of that; neither may
block booking or Revenue workflows.

There is exactly one door into a sales-led conversion, and it is that webhook.
The enterprise licence conversation is not a separate conversion type: asking
about a licence and booking an architecture assessment are the same
conversation, so `/enterprise/self-hosted` books through the same Cal embed and
the same verified webhook as `/enterprise/demo`.

## Canonical `meeting_booked` semantics

`meeting_booked` means: **Cal.com emitted a signature-verified
`BOOKING_CREATED` event with a stable booking identifier, and the App emitted
that booking as an outbound conversion.** The internal enum value is
`MarketingEventType.MeetingBooked`.

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
When reconciling the two, treat the emitted webhook as the count and the
browser event as coverage.

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

- `200 {"accepted":true}` for a valid `BOOKING_CREATED` event. There is no
  `duplicate` flag: nothing is stored, so the endpoint cannot tell a retry from
  a first delivery — the stable `eventId` is what lets the receiver tell.
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
path rather than an edge case. Nothing is stored, so the endpoint itself cannot
tell a retry from a first delivery — it always answers `200 {"accepted":true}`
and always emits.

What stops a retry becoming a second conversion is the event id:
`meeting_booked:{calBookingUid}` is derived from the booking, so every delivery
of one booking carries the same id, and **the receiver deduplicates on it**.

Consequences:

- The booking identifier must be stable and non-empty.
- A receiver that keys on anything other than `eventId` will double-count.
- Do not key on attendee email, time, or any other mutable booking field.

## Attribution into and out of a booking

The demo embeds (`/enterprise/demo` and `/support`) put the visitor's
attribution into Cal booking metadata, and the webhook reads it back out. This
is the join that used to be missing: the webhook has always parsed click IDs
out of booking metadata, but the embeds sent no metadata at all, so every
booked demo was reported with an empty `clickIds` object and no campaign —
measurable as a count and attributable to nothing.

`window.oneUptimeCalAttributionMetadata()` (Home/Views/head-basic.ejs) produces
the embed `config`. **Cal takes booking metadata as flat, bracketed config
keys** — `metadata[utm_source]` — and returns them as `payload.metadata.utm_source`
on the webhook. A nested `metadata: { ... }` object does not work: Cal
serialises each config value into a query parameter, so the object becomes the
string `[object Object]` and every key inside it is lost, silently. See
[Cal's prefill documentation](https://cal.com/help/embedding/prefill-booking-form-embed).

Values are scalars, so the nested first touch travels as one JSON string. The
inner names below are what the webhook parses:

| Key                                                                                | Meaning                                                                                                                                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`              | Last-touch campaign parameters.                                                                                                                                |
| `utm_url`                                                                          | Landing URL of the attributed visit.                                                                                                                           |
| `gclid`, `wbraid`, `gbraid`, `fbclid`, `msclkid`, `li_fat_id`, `twclid`, `rdt_cid` | Ad-platform click identifiers, recorded for OneUptime's own campaign reporting.                                                                                |
| `ou_first_touch`                                                                   | The visitor's first attributed visit, JSON-encoded.                                                                                                            |
| `ou_booking_kind`                                                                  | Which conversation this embed books — `enterprise_demo`, `support_call` or `architecture_assessment`. Allowlisted on arrival; anything else becomes `unknown`. |

The key lists live in `Common/Types/Marketing/Attribution.ts` and are shared by
every reader and writer, so a key added for the browser cannot be silently
dropped on arrival.

Every page that books goes through the same helper: `/enterprise/demo`,
`/support` and `/enterprise/self-hosted`. `Home/Tests/AttributionCapture.test.ts`
asserts all three do, because one page wired up and another not is invisible
until somebody reads the numbers months later.

## Privacy

The webhook parser retains only the allowlisted keys above, read from
`payload.metadata`, `payload.booking.metadata` and `payload.responses`
(a `{ label, value }` answer is unwrapped).

This is an allowlist, not a denylist. Cal metadata and booking answers are
free-form customer content — names, notes, phone numbers, answers to booking
questions — and nothing outside the list is copied onto the event. Retained
values are length bounded, and `ou_first_touch` is parsed and then passed
through the same whitelisting sanitiser the signup path uses, so a malformed or
oversized blob costs the attribution and never the booking.

The attendee email is stored internally for controlled matching, alongside its
SHA-256 in `emailHash`. It is PII: the address itself must not be sent to GA4,
GTM's `dataLayer`, PostHog event properties, URLs, or logs. It never leaves
OneUptime at all. The browser `meeting_booked` event carries only
`event_schema_version`, `booking_source`, `booking_kind`, `page_path`,
`cal_event_type` and `cal_namespace` for exactly this reason — Cal's `bookingSuccessful` detail
holds the attendee's name and email, and none of it is forwarded.

## Conversion chains

The conversion types are emitted by unrelated code paths that each see one
moment: a booked meeting has no user, a signup has no booking, a paid
subscription knows only a project, an enterprise licence knows only what was
typed into it. Nothing tells you that a demo in June, a signup in July and a
licence in October were one customer.

OneUptime used to join them itself, on `emailHash`, and write the result back to
the ledger. With the ledger gone that join belongs to the receiver, and every
event carries `emailHash` for exactly that purpose. Three things worth knowing
when you build it:

- **Normalisation must match.** Trim and lowercase, then SHA-256, with no
  gmail dot/plus folding. Hash your own records the same way or nothing joins.
- **Order by `occurredAt`, not arrival.** Events carry no sequence number, and a
  booking and a signup seconds apart can arrive either way round.
- **A booking's `occurredAt` is when it was made**, not when the meeting is. The
  meeting's own time is `data.meetingStartsAt`, separately, so the ordering
  problem the old ledger had to clamp around no longer exists.

For an enterprise deal, the join runs through `EnterpriseLicense.email` — set it
to the address the customer booked with and the licence shares an identity with
the booking that produced it.

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

4. Verify a `200` response with `accepted: true`. At the receiver (or by
   pointing `MARKETING_WEBHOOK_URL` at a request bin), verify one
   `meeting_booked` event arrived, its `eventId` is
   `meeting_booked:docs-test-booking-001`, `data.meetingStartsAt` matches the
   payload, `attribution.clickIds.gclid` is retained, and `unapproved_key` is
   absent. Verify the signature in `x-oneuptime-signature-256` validates
   against the raw bytes. Verify no PII appeared in GA4/GTM payloads or
   application logs.

5. Repeat the identical `curl`. Verify it is still `200` and that the second
   event carries the SAME `eventId` — that identity is the only thing stopping
   a retry becoming a second conversion, since nothing is deduplicated here.

6. Negative-test the signature without changing the stored environment secret:

   ```sh
   curl -i -X POST 'http://localhost:3002/api/cal-webhook' -H 'content-type: application/json' -H 'x-cal-signature-256: 0000000000000000000000000000000000000000000000000000000000000000' --data-binary "$BODY"
   ```

   Verify `401` and that no event was emitted.

7. In Cal's staging configuration, create a webhook to the externally reachable
   staging `/api/cal-webhook` URL, select only `BOOKING_CREATED`, set the
   staging secret, make one test booking, and repeat the delivery, idempotency,
   allowlist and analytics-privacy checks. Remove the disposable booking and
   rotate the staging test secret afterwards.

The example email uses the reserved `.invalid` domain and must not be replaced
with a real person's data.

### Verify attribution actually survives the round trip

**Do this before trusting any demo attribution, and again after any Cal
version upgrade.** Everything downstream — the campaign on a booked demo, the
chain that joins it to the signup it produced — rests on one assumption: that the metadata the embed hands Cal comes
back on the webhook. If Cal drops it, nothing errors. Bookings keep being
accepted, events keep being emitted, and every one silently carries no campaign
— which is exactly the failure this endpoint already had for its whole life,
and the reason it went unnoticed.

The steps below are cheap and they are the only thing that closes the loop.

1. On staging, load `/enterprise/demo` with attribution in the URL and accept
   the cookie banner (attribution is not stored until you do):

   ```text
   https://<staging-host>/enterprise/demo?utm_source=verify&utm_campaign=metadata-round-trip&gclid=verify-click
   ```

2. In the browser console, confirm the embed is being handed something:

   ```js
   window.oneUptimeCalAttributionMetadata();
   ```

   It must return **bracketed** keys — `metadata[utm_source]`,
   `metadata[utm_campaign]`, `metadata[gclid]`, `metadata[ou_first_touch]`. An
   empty object means the capture or the consent gate is the problem, and there
   is no point looking at Cal yet. Unbracketed keys mean the helper regressed
   and Cal will drop them.

3. Book a test slot through the embed.

4. At the receiver, read the `meeting_booked` event and check that
   `attribution.utmSource`, `attribution.utmCampaign`, `attribution.clickIds`
   and `attribution.firstTouch` are all populated.

If the event arrived but those fields are empty, the metadata did not survive
Cal. Check the raw `BOOKING_CREATED` body in Cal's webhook delivery log to see
which of `payload.metadata`, `payload.booking.metadata` or `payload.responses`
the keys landed in, if any. If Cal is filtering unknown metadata keys on that
event type, the fallback is to add hidden booking questions named for each key —
answers arrive in `payload.responses`, which the parser already reads.

## Consent

Attribution capture, Google Tag Manager and PostHog are all gated on consent
(Home/Views/head-basic.ejs, `window.oneUptimeConsent`).

Before this, the cookie banner wrote `cookiesAccepted` to localStorage and
nothing read it: everything ran identically whether the visitor pressed Accept,
pressed Reject, or never saw the banner. "Reject all" rejected nothing, and
there was no Google Consent Mode signal at all.

Three states, and `unset` is treated as denied for storage rather than as
permission-by-silence. Consent Mode v2 defaults are pushed before the container
loads (`ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`,
`functionality_storage` and `personalization_storage` denied,
`security_storage` granted, `wait_for_update: 500`) and updated on either
answer.

**This has a measurement cost, and it is deliberate.** A visitor who never
touches the banner is not measured and their attribution is not stored. What
keeps that from losing ad clicks outright is the pending-attribution buffer:
attribution seen on the current page is held in memory and written the moment
consent is granted, so the ordinary path — land on an ad, accept, sign up —
keeps everything the click carried. Refusing clears anything an earlier visit
stored.

## Deliberately not implemented

1. **Revenue joins.** Which stable native Revenue contact, account and deal
   reference fields come back on `BOOKING_CREATED` is still not defined, so
   bookings are not joined to Revenue records and nothing emitted claims
   otherwise. (First-touch attribution IS now carried through — see _Attribution
   into and out of a booking_ above.)
2. **Auto-qualification and Deal creation.** `MeetingBooked` records a meeting,
   not enterprise qualification, technical evaluation, or opportunity
   acceptance — and in particular not a signed licence. Native Revenue remains
   authoritative and must make those calls explicitly.
3. **`QualifiedEnterpriseLead`, `TechnicalEvaluationStarted`,
   `OpportunityCreated`, `ClosedWon`.** Add them only once native Revenue emits
   durable domain events with documented semantics, identifiers, idempotency
   and ownership.
4. **Multi-touch attribution.** The browser keeps first touch and last touch and
   nothing in between, so a journey that crossed three campaigns is reportable
   as two of them. A bounded touch list would fix it.
5. **Cross-device attribution before an email is known.** `emailHash` joins
   conversions once a person has identified themselves; an anonymous visitor
   who clicks an ad on a phone and signs up on a laptop is still two visitors
   until then.
6. **Seat and plan expansion revenue.** `subscription_upgraded` reports MRR at
   the moment of a TIER change. A customer who stays on one plan and grows from
   one seat to ten produces no event at all, because seat count is not a tier —
   so LTV and ROAS understate every account that expands without upgrading.
   Fixing it means a seat-change event of its own.

   (Enterprise contract value is no longer part of this gap: it is reported by
   `enterprise_license_issued` and joined to its booking through
   `EnterpriseLicense.email`.)

7. **The remaining `mailto:` CTAs.** `/support` and `/enterprise/demo` still
   offer `mailto:sales@oneuptime.com`, and the pricing page prompts
   "contact sales@oneuptime.com" when a visitor self-qualifies as enterprise
   (>100 monitors, >1TB ingest, >6 months retention, >10M tokens). Those are
   the same unmeasurable shape the self-hosted page had, and the same fix
   applies: point them at a booking.
8. **Reconciling the legacy browser events.** Dashboards and GTM still mix the
   canonical `meeting_booked` with the older `bookingSuccessful`-derived
   events. Separating them, and documenting the historical discontinuity, is
   follow-up work.
