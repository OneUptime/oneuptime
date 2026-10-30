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
`/enterprise/demo`. Planning an air-gapped install is that conversation too, so
`/enterprise/air-gapped` books an architecture assessment as well;
`meeting_booked`'s `page_path` tells the two pages apart.

## Browser `meeting_booked`

`meeting_booked` is a **browser** event. It means: Cal's embed reported a
successful booking on a OneUptime marketing page, and the page fired the event.
It is emitted through `window.oneUptimeTrackMeetingBooked`, defined in
`packages/Home/Views/head-basic.ejs`.

Read it for what it is. The browser can be blocked, can double-fire, and can be
forged, and a booking made through a Cal link that is not one of the
instrumented embeds produces no event at all. It is funnel coverage, not a
commercial count — for that, read Cal.com.

A page view, opening the Cal embed, or choosing a time is not `meeting_booked`.

Four pages book, and each tags the event with the conversation it books:

| Page                      | `booking_kind`            | Legacy PostHog event                  |
| ------------------------- | ------------------------- | ------------------------------------- |
| `/enterprise/demo`        | `enterprise_demo`         | `home/demo-booked`                    |
| `/support`                | `support_call`            | `home/support-call-booked`            |
| `/enterprise/self-hosted` | `architecture_assessment` | `home/architecture-assessment-booked` |
| `/enterprise/air-gapped`  | `architecture_assessment` | `home/architecture-assessment-booked` |

All four book the same Cal event type (`oneuptimehq/demo`), so without
`booking_kind` a free user's support call and a net-new enterprise demo are one
undifferentiated count. The legacy per-page events are still emitted so existing
dashboards keep their history; `packages/Home/Tests/MeetingBookedAnalytics.test.ts`
asserts every page stays wired up, because one page instrumented and another not
is invisible until somebody reads the numbers months later.

Cal fires the booking under more than one action name — the older
`bookingSuccessful` and the newer `bookingSuccessfulV2` — and `embed.js` is
loaded unpinned from `app.cal.com`, so which one arrives is Cal's decision on
any given day. Every booking page therefore subscribes through
`window.oneUptimeOnCalBookingSuccess` (`packages/Home/Views/head-basic.ejs`), which takes
both names and latches on the first to arrive, so one booking stays one
`meeting_booked`.

Subscribe a page with a bare `Cal('on', { action: 'bookingSuccessful' })` and it
takes the old name alone — bookings keep succeeding while that page's conversion
reports nothing, with no error anywhere. `/enterprise/self-hosted` was doing
exactly that until its coverage was restored; the parameterised test above now
fails any page that does.

## Browser `reseller_inquiry_sent`

`reseller_inquiry_sent` is a **browser** event too. It means: the "Become a
reseller" form on `/resellers` sent an inquiry, and the server answered that
it was sent (`packages/Home/API/ResellerInquiryAPI.ts`). A press of the button,
a refusal, a field to fix or a network failure is not one; one sent inquiry
is one event. The inquiry itself reaches the partner inbox by email, and that
inbox is the source of truth for how many there were.

The form's script (`packages/Home/Views/resellers.ejs`) sends it to PostHog,
and to the `dataLayer`, where the GTM container's key event trigger
(`gtm-key-events.json`) forwards it to GA4: import the container again after
a change to that trigger, or GTM drops the event while PostHog still counts
it. It carries `event_schema_version` and `page_path`, and nothing the visitor
typed - no name, company, email, website, regions or message.
`packages/Home/Tests/ResellersPage.test.ts` holds all of that.

## Privacy

**No attendee details leave the page.** Cal's `bookingSuccessful` detail carries
`data`, which holds the attendee's name and email. Nothing derived from it may
reach GA4, GTM's `dataLayer`, PostHog event properties, URLs, or logs. The
browser `meeting_booked` event carries only `event_schema_version`,
`booking_source`, `booking_kind`, `page_path`, `cal_event_type` and
`cal_namespace`, for exactly this reason.

What _does_ leave the page is the visitor's own campaign — UTM values, ad click
IDs, the landing URL and the first touch — handed to Cal.com as booking
metadata so the CRM can attribute the booking, but only while measurement is
allowed; see [Consent](#consent). Cal.com joins it to the attendee details the
visitor types into the booking form, so a booked demo is identified campaign
_and_ person on the CRM's side. A visitor who has not allowed measurement books
with `ou_booking_kind` alone.

## Attribution

The marketing site captures the visitor's campaign — UTM parameters, ad-platform
click IDs and the first attributed visit — and holds it in localStorage
(`packages/Common/Server/Views/Partials/AnalyticsConsent.ejs`). The key lists are shared
in `packages/Common/Types/Marketing/Attribution.ts` so a key added for the browser cannot
be silently dropped on arrival, and `AttributionCapture.test.ts` asserts the
browser's copy of those lists is identical to the contract's.

It leaves the browser through two doors:

1. **The signup form**, which posts it onto the User record
   (`packages/App/FeatureSet/Accounts/src/Pages/Register.tsx`, iterating the contract
   rather than hand-listing keys).
2. **Cal.com booking metadata.** All four embeds call
   `window.oneUptimeCalAttributionMetadata(bookingKind)` and pass the result as
   the embed `config`. Cal returns it on `BOOKING_CREATED` to the CRM, which is
   what makes a booked demo attributable to the ad that produced it.

Because it is read out of localStorage rather than off the current URL, it
survives any number of internal navigations. It is written only while
measurement is allowed: a visitor who has not been asked yet keeps the page's
touch in memory until they answer, and a refusal clears what is stored. Nothing rewrites link hrefs to
carry campaign parameters between pages: self-referential UTMs on internal links
would register as a fresh campaign touch on arrival, overwrite `utmUrl` with an
internal page, drop any click ID not repeated on the link, and double-count the
touch.

An ad, an email or a slide can name a short address instead of the page that
books: `oneuptime.com/demo` and the demo page's other short addresses
(`packages/Home/Utils/DemoPage.ts`), `/self-hosted` and `/air-gapped` each
answer a permanent 301 that keeps the query string byte for byte
(`packages/Home/Utils/Redirect.ts`), so the campaign arrives with the visitor.
Links on the site itself name the page, `/enterprise/demo`, never a short
address: the CTA click listener matches that exact `href`, and
`packages/Home/Tests/DemoPage.test.ts` checks every link to the demo page the
repository writes.

### The Cal metadata shape

Flat, **bracketed** config keys — `metadata[utm_source]` — which Cal returns as
`payload.metadata.utm_source`. A nested `metadata: { ... }` object does not
work: Cal serialises each config value into a query parameter, so the object
becomes the string `"[object Object]"` and every key inside it is lost, silently,
while bookings keep succeeding.

| Key                         | Contents                                                       |
| --------------------------- | -------------------------------------------------------------- |
| `metadata[utm_*]`           | Every key in `UtmWireKeyToPropertyKey`                         |
| `metadata[<click id>]`      | Every key in `AdClickIdKeys` the visitor arrived with          |
| `metadata[utm_url]`         | The landing URL of the attributed visit                        |
| `metadata[ou_first_touch]`  | The first attributed visit, one JSON string, bounded at 4000   |
| `metadata[ou_booking_kind]` | `enterprise_demo`, `support_call` or `architecture_assessment` |

`ou_booking_kind` is not optional detail. All four embeds book the same Cal
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

**Measurement waits for consent where the law asks for it, and stops when it is
refused.** One rule, `window.oneUptimeConsent.isAllowed()` in
`packages/Common/Server/Views/Partials/AnalyticsConsent.ejs`, decides for
every tag on every OneUptime-owned origin:

- An answer on the cookie banner always wins: "Accept all" allows, "Reject all"
  refuses. It is stored under `cookiesAccepted`, and the origins share one
  hostname, so the marketing site, the docs, sign-up and the dashboard honour
  the same answer.
- With no answer, a browser sending Global Privacy Control has refused.
- With no answer and no signal, it depends on where the visitor is: in the EEA
  (including the EU's outermost regions), the UK and Switzerland nothing runs
  until they accept; elsewhere measurement runs until they refuse. Where is
  read from the browser's time zone. Every `Europe/` zone counts, which is
  deliberately wider than the EEA, and a missing or hidden zone (`UTC`,
  `Etc/...`, as privacy-hardened browsers report) asks first.

What follows from the rule:

- Consent Mode v2 defaults are pushed before any tag loads, granted only when
  measurement is allowed, with `wait_for_update: 500`. Every answer is sent as
  an update, so a refusal reaches Google tags already on the page.
- The Google tag loads only once measurement is allowed — at page load, or the
  moment the visitor accepts. On the marketing site, the docs and the API
  reference that is the Google Tag Manager container; on sign-up and the
  dashboard it is Google Analytics alone (`googleTagMode: 'analytics-only'`),
  so no advertising pixel or visitor identification tool runs in the product.
- The marketing site's PostHog loads through the same gate, and a refusal opts
  it out on the page it was given.
- Attribution is written to localStorage only while measurement is allowed; a
  visitor who has not been asked keeps the page's touch in memory until they
  answer. Nothing is read back, sent with a signup or handed to Cal.com while
  measurement is not allowed.
- A refusal expires the measurement cookies the tags set (`_ga`, `_gcl_*`,
  `_fbp`, `_uet*`, `_rdt_*` and the like), PostHog's `ph_*` storage and the
  stored attribution. A visitor for whom measurement is not allowed has
  leftovers from earlier visits removed on every page.
- The product's own PostHog (`ANALYTICS_KEY`) does not start for a visitor who
  pressed "Reject all", or who has not answered and whose browser sends Global
  Privacy Control.

Status pages and public dashboards load none of this: they belong to
OneUptime's customers, and their visitors are not OneUptime's to measure.

`packages/Home/Tests/AttributionCapture.test.ts` and
`packages/Common/Tests/Server/Views/AnalyticsConsentPartial.test.ts` pin each
of these behaviours, so a change in either direction has to be explicit.

## Google Analytics in the product

Sign-up and the dashboard load Google Analytics alone, so
`packages/Common/Utils/Analytics.ts` talks to it directly:

- **Key events.** The revenue funnel's events (`RevenueEventName`) are sent
  with the parameters the Tag Manager key-event tag forwards
  (`GoogleAnalyticsEventParameters`), and nothing else.
- **`purchase`.** Each paid conversion is also sent as GA4's `purchase`, so
  Google Analytics' revenue reports and Google Ads' return on ad spend have
  something to count: a project created on a paid plan, and a free project
  moving to a paid plan. A move between paid tiers is expansion and is not a
  purchase; custom pricing has no amount and sends none. `transaction_id` is
  the server's marketing event ID for the same conversion
  (`subscription_started:{projectId}`, `subscription_upgraded:{projectId}:{time}`;
  see `marketing-event-webhooks.md`), `value` the monthly recurring revenue
  after the change, and the plan is the one item.
- **`user_id`.** Every signed-in dashboard page sets `user_id` to the internal
  user ID, never an email address, so one person's sessions join up across
  devices.

All three wait for consent like everything else: gtag holds the calls until
Google Analytics loads, and on a self-hosted install there is no Google tag to
send them to.

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
