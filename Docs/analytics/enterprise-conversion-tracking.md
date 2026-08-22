# Enterprise conversion tracking

This document defines the boundary between browser analytics, the
server-confirmed conversion ledger, Cal.com, native Revenue, and the ad
platforms.

## Architecture and sources of truth

| Concern                                                   | Source of truth                                    | Notes                                                                                                                                      |
| --------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A meeting was booked                                      | `MarketingConversion` ledger                       | Written only after a signature-verified Cal `BOOKING_CREATED` webhook. Browser events are supporting diagnostics, not proof of conversion. |
| An enterprise licence was requested                       | `MarketingConversion` ledger                       | Written by `POST /api/enterprise-license-request`. The lead itself (name, company, message) is emailed to sales and is not stored.          |
| Booking details                                           | Cal.com                                            | The webhook supplies the booking identifier and time. Copied browser payloads are not authoritative.                                       |
| Contact, account, deal, qualification, and pipeline stage | Native Revenue                                     | A meeting conversion does not create, qualify, or advance Revenue records.                                                                 |
| Campaign attribution for a conversion                     | `MarketingConversion` utm\* columns + `clickIds`   | Copied from the User/Project, or read from Cal booking metadata. Reportable without asking an ad platform.                                  |
| First-touch acquisition                                   | `MarketingConversion.firstTouchAttribution`        | The visitor's first attributed visit, carried through the same doors as last touch.                                                        |
| Which conversions belong to one person                    | `MarketingConversion.emailHash`                    | SHA-256 of the normalized email. `attributedToConversionId` points every conversion at the first one that person made.                      |
| Web analytics                                             | GA4 / PostHog / GTM                                | Useful for aggregate funnel analysis and client-side diagnostics. Never the authoritative conversion ledger.                               |
| Ad-platform conversion state                              | `MarketingConversion.uploadState` and the provider | Only conversion types with an explicit provider mapping may be uploaded.                                                                   |

`POST /api/cal-webhook` is the trust boundary for a booking. Cal signs the exact
request bytes, the App verifies them, and only then does the App write the
ledger. Analytics and ad-platform delivery are best-effort consumers downstream
of that; neither may block booking or Revenue workflows.

`POST /api/enterprise-license-request` is the trust boundary for a licence
request, and it is a weaker one on purpose: the caller is a browser, so there is
no signature to verify — any secret it held would be public. What stands in for
one is that nothing structural is trusted (fields are whitelisted and
length-bounded), the row's primary key is derived from the email so
resubmitting cannot inflate the ledger, and a fail-open throttle bounds volume.

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

## Attribution into and out of a booking

The demo embeds (`/enterprise/demo` and `/support`) put the visitor's
attribution into Cal booking metadata, and the webhook reads it back out. This
is the join that used to be missing: the webhook has always parsed click IDs
out of booking metadata, but the embeds sent no metadata at all, so every
booked demo landed in the ledger with an empty `clickIds` object and no
campaign — measurable as a count and attributable to nothing.

`window.oneUptimeCalAttributionMetadata()` (Home/Views/head-basic.ejs) produces
the bag. Cal metadata values are scalars, so the keys are flat and the nested
first touch travels as one JSON string:

| Key                                                   | Meaning                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | Last-touch campaign parameters.               |
| `utm_url`                                             | Landing URL of the attributed visit.                          |
| `gclid`, `wbraid`, `gbraid`, `fbclid`, `msclkid`, `li_fat_id`, `twclid`, `rdt_cid` | Ad-platform click identifiers. |
| `ou_first_touch`                                      | The visitor's first attributed visit, JSON-encoded.           |

The key lists live in `Common/Types/Marketing/Attribution.ts` and are shared by
every reader and writer, so a key added for the browser cannot be silently
dropped on arrival.

## Privacy

The webhook parser retains only the allowlisted keys above, read from
`payload.metadata`, `payload.booking.metadata` and `payload.responses`
(a `{ label, value }` answer is unwrapped).

This is an allowlist, not a denylist. Cal metadata and booking answers are
free-form customer content — names, notes, phone numbers, answers to booking
questions — and nothing outside the list is copied into the ledger. Retained
values are length bounded, and `ou_first_touch` is parsed and then passed
through the same whitelisting sanitiser the signup path uses, so a malformed or
oversized blob costs the attribution and never the booking.

The attendee email is stored internally for controlled matching, alongside its
SHA-256 in `emailHash`. It is PII: the address itself must not be sent to GA4,
GTM's `dataLayer`, PostHog event properties, URLs, or logs, and no ad platform
ever receives it in the clear — every provider sends the digest. The browser `meeting_booked` event carries only
`event_schema_version`, `booking_source`, `booking_kind`, `page_path`,
`cal_event_type` and `cal_namespace` for exactly this reason — Cal's `bookingSuccessful` detail
holds the attendee's name and email, and none of it is forwarded.

## Ad-platform uploads

Every conversion type the ledger records is uploadable, and every provider maps
every type explicitly.

That used to be impossible to guarantee. Providers chose a platform conversion
action with a two-way branch — `isSignUp(conversion) ? signUp : paidSubscription`
— which has no third arm, so a type nobody had written a mapping for would have
been uploaded to all five platforms as a _purchase_ carrying whatever value the
row held. The defence was to keep such types out of the allowlist entirely,
which is why sales-led conversions never reached the ad platforms at all.

The defence is now structural. Providers resolve their action through a
`Record<MarketingConversionType, T>`, which the compiler refuses unless every
member of the enum is named — so adding a conversion type is a build error in
every provider until that provider says what the new type means on its platform.

| Type                         | Google Ads / Microsoft / LinkedIn | Meta                   | Reddit     | Value    |
| ---------------------------- | --------------------------------- | ---------------------- | ---------- | -------- |
| `SignUp`                     | Its own conversion action         | `CompleteRegistration` | `SignUp`   | none     |
| `MeetingBooked`              | Its own conversion action         | `Schedule`             | `Lead`     | **none** |
| `EnterpriseLicenseRequested` | Its own conversion action         | `Lead`                 | `Lead`     | **none** |
| `PaidSubscription`           | Its own conversion action         | `Purchase`             | `Purchase` | MRR      |

The two sales-led types never carry revenue, whatever the row holds
(`ConversionUploadProvider.getValueInUSD` suppresses it), or a bid model would
optimise towards demos that buy nothing.

`ConversionUploadProvider.getSkipReason` still screens the conversion type
before any provider hook runs, because `conversionType` is a plain varchar and a
value the enum does not name can still reach the worker. A type with no
configured conversion action is a **config gap**, not a modelling gap: those
rows stay pending and upload once the id is set, rather than being discarded.

### Identifiers

A conversion is matched to an ad click two ways, and every provider accepts
either:

- **the click id** the visitor carried, which is exact but only survives as far
  as the browser storage that held it; and
- **the SHA-256 of the email** — what every platform calls enhanced
  conversions / enhanced matching — which survives a change of device, a
  cleared browser, and the months between a demo and the deal it led to.

Requiring the click id, which every provider used to do, discarded exactly the
sales-led conversions enhanced matching exists for. A conversion is now
uploadable when EITHER is present.

Google is the one exception worth stating. A hashed email is attached to every
upload that has one — that needs no configuration and only improves matching.
Uploading a conversion identified ONLY by a hashed email is *enhanced
conversions for leads*, which additionally requires the Google Ads account to be
set up for it, so it is gated on
`GOOGLE_ADS_ENHANCED_CONVERSIONS_FOR_LEADS_ENABLED` and off by default.

### Windows

Every platform bounds how late a conversion may be uploaded — 90 days for
Google, Microsoft and LinkedIn, 7 for Meta and Reddit. An enterprise cycle
routinely outruns all of them. That is a platform limit, not a bug, and it is
the reason `MeetingBooked` matters as a bid signal: the booking lands inside
every window even when the deal it produces does not.

## Conversion chains

Four conversion types are written by four unrelated code paths that each see one
moment: a booked meeting has no user, a signup has no booking, a paid
subscription knows only a project. Nothing in the ledger said that a demo in
June, a signup in July and a subscription in October were one customer — so
"revenue this demo campaign produced" could not be computed at all.

The `linkConversionChains` pass in the MarketingConversions worker joins them on
`emailHash` and writes `attributedToConversionId`. Three properties worth
knowing:

- it points at the **earliest** conversion that person made, not the immediately
  preceding one, so attributing a whole journey is a `GROUP BY` rather than a
  recursive walk;
- a row that already has a link is never revised, which keeps the pass
  idempotent and stops a late-arriving row re-parenting history that has already
  been reported;
- ordering uses `min(conversionAt, createdAt)`, because a Cal booking is stamped
  with the *meeting's* start time. Someone who books on Monday and signs up on
  Tuesday for a meeting on Friday would otherwise look like they signed up
  first.

The chain root has no link — that is what makes "the roots" a query.

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

### Verify attribution actually survives the round trip

**Do this before trusting any demo attribution, and again after any Cal
version upgrade.** Everything downstream — the campaign on a booked demo, the
chain that joins it to the signup it produced, the conversion uploaded to an ad
platform — rests on one assumption: that the metadata the embed hands Cal comes
back on the webhook. If Cal drops it, nothing errors. Bookings keep being
recorded, the ledger keeps filling, and every row silently carries no campaign —
which is exactly the failure this endpoint already had for its whole life, and
the reason it went unnoticed.

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

   It must return `utm_source`, `utm_campaign`, `gclid` and `ou_first_touch`.
   An empty object means the capture or the consent gate is the problem, and
   there is no point looking at Cal yet.

3. Book a test slot through the embed.

4. In the database, read the `MeetingBooked` row and check that `utmSource`,
   `utmCampaign`, `clickIds` and `firstTouchAttribution` are all populated.

If the row is there but those columns are empty, the metadata did not survive
Cal. Check the raw `BOOKING_CREATED` body in Cal's webhook delivery log to see
which of `payload.metadata`, `payload.booking.metadata` or `payload.responses`
the keys landed in, if any. If Cal is filtering unknown metadata keys on that
event type, the fallback is to add hidden booking questions named for each key —
answers arrive in `payload.responses`, which the parser already reads.

## The enterprise licence request

```text
POST /api/enterprise-license-request
```

Anonymous, JSON, and the only writer of `EnterpriseLicenseRequested` rows. It
replaced a `mailto:enterprise@oneuptime.com` link on `/enterprise/self-hosted`,
which sent no request to OneUptime and so produced no click ID, no campaign and
no row — the one step of the funnel where the money is was the one step with no
measurement at all.

Body: `email` (required), `name`, `company`, `message`, plus attribution as
either `{ utm, clickIds, firstTouchAttribution }` or flat alongside the contact
fields.

Responses:

- `200 {"accepted":true,"duplicate":false}` for a new request.
- `200 {"accepted":true,"duplicate":true}` when that address is already in the
  ledger.
- `400` when there is no valid email.
- `429` when the throttle rejects it.

What it does and does not do:

- **One row per address.** The primary key is derived from the normalized email
  (`oneuptime/enterprise-license-request:<email>`, same construction as the Cal
  booking id), so resubmitting cannot inflate what ad platforms are told.
- **The email is sent every time**, including for a duplicate. The ledger row is
  the conversion and must not be counted twice; the message is how a human hears
  about it, and someone resubmitting usually means the first was missed. Mail is
  best-effort — an SMTP outage must not lose a lead the ledger has accepted.
- **Nothing free-text is stored.** Name, company and message are emailed and
  never written to the ledger, because every column of that table is a candidate
  for forwarding to an ad platform.
- **It creates no Revenue record.** A form submission is not qualification.
- **`ENTERPRISE_SALES_EMAIL`** configures the destination.

The throttle (`Common/Server/Middleware/MarketingFormRateLimit.ts`) counts per
email hash and per trusted client address, and **fails open**: with Redis
unreachable, leads are accepted. Refusing real leads for the duration of a Redis
incident costs more than the spam a short unthrottled window admits — the
opposite of the call `IdentityRateLimit` makes, and correctly so, since there the
counter is the only thing between an attacker and an account.

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
   bookings are not joined to Revenue records and the ledger does not claim
   otherwise. (First-touch attribution IS now carried through — see *Attribution
   into and out of a booking* above.)
2. **Auto-qualification and Deal creation.** `MeetingBooked` records a meeting
   and `EnterpriseLicenseRequested` records a request; neither is enterprise
   qualification, technical evaluation, or opportunity acceptance. Native
   Revenue remains authoritative and must make those calls explicitly.
3. **`QualifiedEnterpriseLead`, `TechnicalEvaluationStarted`,
   `OpportunityCreated`, `ClosedWon`.** Add them only once native Revenue emits
   durable domain events with documented semantics, identifiers, idempotency
   and ownership. Adding one is now a build error in every provider until each
   states what it means on its platform, which is the intended friction.
4. **Multi-touch attribution.** The browser keeps first touch and last touch and
   nothing in between, so a journey that crossed three campaigns is reportable
   as two of them. A bounded touch list would fix it.
5. **Cross-device attribution before an email is known.** `emailHash` joins
   conversions once a person has identified themselves; an anonymous visitor
   who clicks an ad on a phone and signs up on a laptop is still two visitors
   until then.
6. **A value for enterprise deals.** `getMonthlyRevenueInUSDCents` returns
   nothing for custom pricing, so the largest deals upload with no value and bid
   models see only self-serve revenue. Feeding real contract value in needs a
   source that does not exist here yet.
7. **Reconciling the legacy browser events.** Dashboards and GTM still mix the
   canonical `meeting_booked` with the older `bookingSuccessful`-derived
   events. Separating them, and documenting the historical discontinuity, is
   follow-up work.
