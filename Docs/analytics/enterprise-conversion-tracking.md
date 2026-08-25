# Enterprise conversion tracking

This document covers how a booked demo is measured and how the marketing site
captures the campaign that produced it. **The payload contract for everything
OneUptime emits to a receiver lives in
[marketing-event-webhooks.md](./marketing-event-webhooks.md)** — read that
first if you are building a receiver.

## Architecture and sources of truth

OneUptime stores no conversions and does not receive bookings from Cal.com.
There used to be a signature-verified `POST /api/cal-webhook` that turned a
`BOOKING_CREATED` into an outbound `meeting_booked` conversion; it was removed
because Cal.com delivers that webhook straight to the CRM instead — one
receiver, not two. What is left in OneUptime is the browser event the marketing
site fires alongside the booking, and the attribution the embed hands Cal so
the CRM can read it back.

| Concern                                               | Source of truth                         | Notes                                                                                             |
| ----------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A meeting was booked                                  | Cal.com                                 | The booking record, its attendee and its time all live there. Nothing is mirrored into OneUptime. |
| Contact, account, deal, qualification, pipeline stage | Native Revenue                          | A booked meeting does not create, qualify, or advance Revenue records.                            |
| Campaign attribution for an emitted conversion        | The event's `attribution` object        | Copied from the User/Project row the conversion happened on.                                      |
| Which conversions belong to one person                | `emailHash` on each event               | The receiver joins on it. Nothing in OneUptime joins them.                                        |
| Enterprise contract value                             | `EnterpriseLicense.annualContractValue` | Reported by `enterprise_license_issued`, attributed through `EnterpriseLicense.email`.            |
| Web analytics                                         | GA4 / PostHog / GTM                     | Aggregate funnel analysis and client-side diagnostics.                                            |

The enterprise licence conversation is not a separate conversion type: asking
about a licence and booking an architecture assessment are the same
conversation, so `/enterprise/self-hosted` books through the same Cal embed as
`/enterprise/demo`.

## Browser `meeting_booked`

`meeting_booked` is a **browser** event. It means: Cal's embed reported a
successful booking on a OneUptime marketing page, and the page fired the event.
It is emitted through `window.oneUptimeTrackMeetingBooked`, defined in
`Home/Views/head-basic.ejs`.

Read it for what it is. The browser can be blocked, can double-fire, and can be
forged, and a booking made through a Cal link that is not one of the
instrumented embeds produces no event at all. It is funnel coverage, not a
commercial count — for that, read Cal.com.

A page view, opening the Cal embed, or choosing a time is not `meeting_booked`.

Three pages book, and each tags the event with the conversation it books:

| Page                      | `booking_kind`            | Legacy PostHog event                  |
| ------------------------- | ------------------------- | ------------------------------------- |
| `/enterprise/demo`        | `enterprise_demo`         | `home/demo-booked`                    |
| `/support`                | `support_call`            | `home/support-call-booked`            |
| `/enterprise/self-hosted` | `architecture_assessment` | `home/architecture-assessment-booked` |

All three book the same Cal event type (`oneuptimehq/demo`), so without
`booking_kind` a free user's support call and a net-new enterprise demo are one
undifferentiated count. The legacy per-page events are still emitted so existing
dashboards keep their history; `Home/Tests/MeetingBookedAnalytics.test.ts`
asserts every page stays wired up, because one page instrumented and another not
is invisible until somebody reads the numbers months later.

Cal fires the booking under more than one action name — the older
`bookingSuccessful` and the newer `bookingSuccessfulV2` — and `embed.js` is
loaded unpinned from `app.cal.com`, so which one arrives is Cal's decision on
any given day. Every booking page therefore subscribes through
`window.oneUptimeOnCalBookingSuccess` (`Home/Views/head-basic.ejs`), which takes
both names and latches on the first to arrive, so one booking stays one
`meeting_booked`.

Subscribe a page with a bare `Cal('on', { action: 'bookingSuccessful' })` and it
takes the old name alone — bookings keep succeeding while that page's conversion
reports nothing, with no error anywhere. `/enterprise/self-hosted` was doing
exactly that until its coverage was restored; the parameterised test above now
fails any page that does.

## Privacy

**No attendee details leave the page.** Cal's `bookingSuccessful` detail carries
`data`, which holds the attendee's name and email. Nothing derived from it may
reach GA4, GTM's `dataLayer`, PostHog event properties, URLs, or logs. The
browser `meeting_booked` event carries only `event_schema_version`,
`booking_source`, `booking_kind`, `page_path`, `cal_event_type` and
`cal_namespace`, for exactly this reason.

What *does* leave the page is the visitor's own campaign — UTM values, ad click
IDs, the landing URL and the first touch — handed to Cal.com as booking
metadata so the CRM can attribute the booking. It is not gated on the cookie
banner; see [Consent](#consent). Cal.com joins it to the attendee details the
visitor types into the booking form, so a booked demo is identified campaign
*and* person on the CRM's side. That is the point of the path, and it is the
thing to weigh if the consent position is ever revisited.

## Attribution

The marketing site captures the visitor's campaign — UTM parameters, ad-platform
click IDs and the first attributed visit — and holds it in localStorage
(`Common/Server/Views/Partials/AnalyticsConsent.ejs`). The key lists are shared
in `Common/Types/Marketing/Attribution.ts` so a key added for the browser cannot
be silently dropped on arrival, and `AttributionCapture.test.ts` asserts the
browser's copy of those lists is identical to the contract's.

It leaves the browser through two doors:

1. **The signup form**, which posts it onto the User record
   (`App/FeatureSet/Accounts/src/Pages/Register.tsx`, iterating the contract
   rather than hand-listing keys).
2. **Cal.com booking metadata.** All three embeds call
   `window.oneUptimeCalAttributionMetadata(bookingKind)` and pass the result as
   the embed `config`. Cal returns it on `BOOKING_CREATED` to the CRM, which is
   what makes a booked demo attributable to the ad that produced it.

Because it is read out of localStorage rather than off the current URL, it
survives any number of internal navigations. Nothing rewrites link hrefs to
carry campaign parameters between pages: self-referential UTMs on internal links
would register as a fresh campaign touch on arrival, overwrite `utmUrl` with an
internal page, drop any click ID not repeated on the link, and double-count the
touch.

### The Cal metadata shape

Flat, **bracketed** config keys — `metadata[utm_source]` — which Cal returns as
`payload.metadata.utm_source`. A nested `metadata: { ... }` object does not
work: Cal serialises each config value into a query parameter, so the object
becomes the string `"[object Object]"` and every key inside it is lost, silently,
while bookings keep succeeding.

| Key                                     | Contents                                                     |
| --------------------------------------- | ------------------------------------------------------------ |
| `metadata[utm_*]`                       | Every key in `UtmWireKeyToPropertyKey`                        |
| `metadata[<click id>]`                  | Every key in `AdClickIdKeys` the visitor arrived with         |
| `metadata[utm_url]`                     | The landing URL of the attributed visit                       |
| `metadata[ou_first_touch]`              | The first attributed visit, one JSON string, bounded at 4000  |
| `metadata[ou_booking_kind]`             | `enterprise_demo`, `support_call` or `architecture_assessment`|

`ou_booking_kind` is not optional detail. All three embeds book the same Cal
event type (`oneuptimehq/demo`), so without it the CRM cannot tell a free
user's support call from a net-new enterprise demo — they arrive identical. It
is sent even when there is no campaign to report, because the embed always
knows what it is.

## Conversion chains

The conversion types OneUptime does emit come from unrelated code paths that
each see one moment: a signup has no booking, a paid subscription knows only a
project, an enterprise licence knows only what was typed into it. Nothing tells
you that a signup in July and a licence in October were one customer.

OneUptime used to join them itself, on `emailHash`, and write the result to a
ledger. With the ledger gone that join belongs to the receiver, and every event
carries `emailHash` for exactly that purpose. Two things worth knowing when you
build it:

- **Normalisation must match.** Trim and lowercase, then SHA-256, with no
  gmail dot/plus folding. Hash your own records the same way or nothing joins.
- **Order by `occurredAt`, not arrival.** Events carry no sequence number, and
  two conversions seconds apart can arrive either way round.

For an enterprise deal, the join runs through `EnterpriseLicense.email` — set it
to the address the customer booked with and the licence shares an identity with
everything else that address has done.

## Consent

**Measurement is not gated on the cookie banner.** Consent Mode v2 defaults to
granted, attribution is captured and stored on every visit, and PostHog loads on
every visit.

Before this, the cookie banner wrote `cookiesAccepted` to localStorage and
nothing read it: everything ran identically whether the visitor pressed Accept,
pressed Reject, or never saw the banner. "Reject all" rejected nothing, and
there was no Google Consent Mode signal at all.

Gating was then unwound, deliberately, so that every booking reaches the CRM
attributed. `window.oneUptimeConsent` still records the visitor's answer under
`cookiesAccepted`, and the banner and the footer's cookie-settings link still
read and write it — but nothing downstream branches on it.

Stated plainly, because it is not what the banner's own copy says:

- Consent Mode v2 defaults are pushed before the container loads with every
  signal **granted** and `wait_for_update: 500`. No update is pushed on either
  answer, so pressing "Reject all" does not push a denial.
- Every touch is written to localStorage on sight, whether or not the banner has
  been answered.
- Refusing does not clear what an earlier visit stored.
- PostHog loads on every visit, deferred to idle for LCP but not to an answer.

Two consequences worth naming. The Consent Mode default asserts to Google that
consent was collected, which is a claim about the visitor rather than a choice
about OneUptime's own storage. And the banner still renders Accept and Reject
while neither button changes anything, which is a choice presented but not
honoured — if the banner is meant to keep promising one, this is the section and
`AnalyticsConsent.ejs` is the file that has to change back.
`AttributionCapture.test.ts` pins each of the four behaviours above, so a change
in either direction has to be explicit.

## Deliberately not implemented

1. **A server-side record of a booking.** Bookings are not received, stored, or
   emitted by OneUptime at all — Cal.com delivers `BOOKING_CREATED` to the CRM,
   which owns authenticating and deduplicating it. If OneUptime ever needs a
   booking as its own measured conversion, that means a verified inbound webhook
   again — not trusting the browser event, which is neither authenticated nor
   reliable.
2. **Revenue joins.** Which stable native Revenue contact, account and deal
   reference fields a booking would carry is still not defined, so bookings are
   not joined to Revenue records and nothing emitted claims otherwise.
3. **Auto-qualification and Deal creation.** A booked meeting is not enterprise
   qualification, technical evaluation, or opportunity acceptance — and in
   particular not a signed licence. Native Revenue remains authoritative and
   must make those calls explicitly.
4. **`QualifiedEnterpriseLead`, `TechnicalEvaluationStarted`,
   `OpportunityCreated`, `ClosedWon`.** Add them only once native Revenue emits
   durable domain events with documented semantics, identifiers, idempotency
   and ownership.
5. **Multi-touch attribution.** The browser keeps first touch and last touch and
   nothing in between, so a journey that crossed three campaigns is reportable
   as two of them. A bounded touch list would fix it.
6. **Cross-device attribution before an email is known.** `emailHash` joins
   conversions once a person has identified themselves; an anonymous visitor
   who clicks an ad on a phone and signs up on a laptop is still two visitors
   until then.
7. **Seat and plan expansion revenue.** `subscription_upgraded` reports MRR at
   the moment of a TIER change. A customer who stays on one plan and grows from
   one seat to ten produces no event at all, because seat count is not a tier —
   so LTV and ROAS understate every account that expands without upgrading.
   Fixing it means a seat-change event of its own.

   (Enterprise contract value is no longer part of this gap: it is reported by
   `enterprise_license_issued` and attributed through `EnterpriseLicense.email`.)

8. **The remaining `mailto:` CTAs.** `/support` and `/enterprise/demo` still
   offer `mailto:sales@oneuptime.com`, and the pricing page prompts
   "contact sales@oneuptime.com" when a visitor self-qualifies as enterprise
   (>100 monitors, >1TB ingest, >6 months retention, >10M tokens). Those are
   the same unmeasurable shape the self-hosted page had, and the same fix
   applies: point them at a booking.
9. **Reconciling the legacy browser events.** Dashboards and GTM still mix the
    canonical `meeting_booked` with the older `bookingSuccessful`-derived
    events. Separating them, and documenting the historical discontinuity, is
    follow-up work.
