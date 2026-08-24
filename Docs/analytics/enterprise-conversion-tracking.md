# Enterprise conversion tracking

This document covers how a booked demo is measured and how the marketing site
captures the campaign that produced it. **The payload contract for everything
OneUptime emits to a receiver lives in
[marketing-event-webhooks.md](./marketing-event-webhooks.md)** — read that
first if you are building a receiver.

## Architecture and sources of truth

OneUptime stores no conversions and no longer receives bookings from Cal.com.
There used to be a signature-verified `POST /api/cal-webhook` that turned a
`BOOKING_CREATED` into an outbound `meeting_booked` conversion; it has been
removed. What is left is the booking itself, in Cal.com, and the browser event
the marketing site fires alongside it.

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
any given day. Both are subscribed to and the first to arrive latches, so one
booking stays one `meeting_booked`.

## Privacy

**No attendee details leave the page.** Cal's `bookingSuccessful` detail carries
`data`, which holds the attendee's name and email. Nothing derived from it may
reach GA4, GTM's `dataLayer`, PostHog event properties, URLs, or logs. The
browser `meeting_booked` event carries only `event_schema_version`,
`booking_source`, `booking_kind`, `page_path`, `cal_event_type` and
`cal_namespace`, for exactly this reason.

## Attribution

The marketing site captures the visitor's campaign — UTM parameters, ad-platform
click IDs and the first attributed visit — and holds it in localStorage
(`Common/Server/Views/Partials/AnalyticsConsent.ejs`, gated on consent). It
reaches the server through one door: the signup form, which posts it onto the
User record. The key lists are shared in
`Common/Types/Marketing/Attribution.ts` so a key added for the browser cannot be
silently dropped on arrival.

A booking carries no attribution into OneUptime. The embeds used to put the
visitor's campaign into Cal booking metadata for the webhook to read back; with
the webhook gone, they no longer do. A booked demo is therefore attributable
only through what the same person does later under the same address — a signup,
or an enterprise licence issued to it.

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

Attribution capture, Google Tag Manager and PostHog are all gated on consent
(`Home/Views/head-basic.ejs`, `window.oneUptimeConsent`).

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

1. **A server-side record of a booking.** Bookings are not received, stored, or
   emitted by OneUptime at all. If a booking needs to be a measured conversion
   again, that means re-introducing a verified inbound webhook — not trusting
   the browser event, which is neither authenticated nor reliable.
2. **Attribution on a booking.** Follows from the above: with nothing reading
   Cal booking metadata, the embeds send none.
3. **Revenue joins.** Which stable native Revenue contact, account and deal
   reference fields a booking would carry is still not defined, so bookings are
   not joined to Revenue records and nothing emitted claims otherwise.
4. **Auto-qualification and Deal creation.** A booked meeting is not enterprise
   qualification, technical evaluation, or opportunity acceptance — and in
   particular not a signed licence. Native Revenue remains authoritative and
   must make those calls explicitly.
5. **`QualifiedEnterpriseLead`, `TechnicalEvaluationStarted`,
   `OpportunityCreated`, `ClosedWon`.** Add them only once native Revenue emits
   durable domain events with documented semantics, identifiers, idempotency
   and ownership.
6. **Multi-touch attribution.** The browser keeps first touch and last touch and
   nothing in between, so a journey that crossed three campaigns is reportable
   as two of them. A bounded touch list would fix it.
7. **Cross-device attribution before an email is known.** `emailHash` joins
   conversions once a person has identified themselves; an anonymous visitor
   who clicks an ad on a phone and signs up on a laptop is still two visitors
   until then.
8. **Seat and plan expansion revenue.** `subscription_upgraded` reports MRR at
   the moment of a TIER change. A customer who stays on one plan and grows from
   one seat to ten produces no event at all, because seat count is not a tier —
   so LTV and ROAS understate every account that expands without upgrading.
   Fixing it means a seat-change event of its own.

   (Enterprise contract value is no longer part of this gap: it is reported by
   `enterprise_license_issued` and attributed through `EnterpriseLicense.email`.)

9. **The remaining `mailto:` CTAs.** `/support` and `/enterprise/demo` still
   offer `mailto:sales@oneuptime.com`, and the pricing page prompts
   "contact sales@oneuptime.com" when a visitor self-qualifies as enterprise
   (>100 monitors, >1TB ingest, >6 months retention, >10M tokens). Those are
   the same unmeasurable shape the self-hosted page had, and the same fix
   applies: point them at a booking.
10. **Reconciling the legacy browser events.** Dashboards and GTM still mix the
    canonical `meeting_booked` with the older `bookingSuccessful`-derived
    events. Separating them, and documenting the historical discontinuity, is
    follow-up work.
