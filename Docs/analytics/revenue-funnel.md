# Self-serve revenue funnel

OneUptime emits the following stable events to both PostHog and the Google Tag
Manager `dataLayer`. Event names and properties are defined in
`Common/Types/Analytics/RevenueEvent.ts` and carry `event_schema_version`.

| Stage         | Event                     | Meaning                                                                         |
| ------------- | ------------------------- | ------------------------------------------------------------------------------- |
| Signup        | `signup_started`          | A registration submission is attempted.                                         |
| Signup        | `sign_up`                 | An account is successfully created.                                             |
| Activation    | `workspace_created`       | A project/workspace is successfully created.                                    |
| Activation    | `monitor_created`         | A monitor is successfully created.                                              |
| Collaboration | `teammate_invited`        | A project invitation is successfully created.                                   |
| Revenue       | `subscription_started`    | A project is created directly on a paid plan. New business: no previous tier.   |
| Revenue       | `subscription_upgraded`   | A project moves to a higher plan. `is_paid_conversion` identifies free-to-paid. |
| Revenue       | `subscription_downgraded` | A project moves to a lower plan.                                                |

Sales-led conversions are tracked separately — see
[enterprise-conversion-tracking.md](./enterprise-conversion-tracking.md) for
`meeting_booked` and the server-confirmed conversion ledger behind it. Every
sales-led step is a booked meeting, including the enterprise licence
conversation: `/enterprise/demo`, `/support` and `/enterprise/self-hosted` all
book through the same Cal embed, distinguished by `booking_kind`.

## GA4 setup

**This is not automatic.** Emitting an event to the `dataLayer` does not put it
in GA4. GTM discards every `dataLayer` push that no trigger matches, so until
the container has a tag bound to a Custom Event trigger, GA4 records only its
own auto-collected events (`page_view`, `session_start`, `first_visit`,
`user_engagement`, `scroll`, `click`) and the Key events report reads zero.

Container `GTM-PKQD5WH`, property `OneUptime`, measurement ID `G-76XZF1WF3Z`.

### Prerequisite

The GTM snippet is wrapped in `enableGoogleTagManager`, which every render sets
to `IsBillingEnabled` — i.e. `BILLING_ENABLED === "true"`
(`Common/Server/BillingConfig.ts`). On a self-hosted install the flag is false,
`window.dataLayer` is never created, and every browser event silently no-ops.
Only the hosted product sends anything to Google.

### 1. Import the container config

`Docs/analytics/gtm-key-events.json` creates the variables, trigger and tag
described below. In GTM: **Admin → Import Container → choose the file → pick an
existing workspace → Merge → Rename conflicting tags/triggers/variables**, then
review the change preview before confirming. Never choose **Overwrite** — that
replaces the whole container and would delete the ad-platform pixels.

To build it by hand instead:

- **Variables** — one Data Layer Variable per event parameter, named
  `DLV - <param>`: `value`, `currency`, `plan`, `funnel_stage`,
  `is_paid_conversion`, `project_id`, `booking_kind`, `event_schema_version`.
- **Trigger** — `Custom Event - OneUptime Key Events`, Custom Event, event name
  **matches RegEx**:

  ```
  ^(signup_started|sign_up|workspace_created|monitor_created|teammate_invited|subscription_started|subscription_upgraded|subscription_downgraded|meeting_booked|cta_get_started|cta_request_demo|page_view_pricing|page_view_demo)$
  ```

- **Tag** — `GA4 - OneUptime Key Events`, type Google Analytics: GA4 Event,
  measurement ID `G-76XZF1WF3Z`, Event Name `{{Event}}`, and one event
  parameter row per variable above. Fire it on the trigger.

Use `{{Event}}` rather than 12 separate tags: the event keeps its own name, and
adding an event later is a one-word edit to the regex.

### Use an allow-list, not "All Custom Events"

The regex is deliberate. `Analytics.capture()` forwards _any_ string to the
`dataLayer`, and much of what the product sends is not a legal GA4 event name —
GA4 requires letters, digits and underscores, starting with a letter, at most
40 characters. Today the same `dataLayer` also receives
`Page View: Project > Home`, `FORM SUBMIT: Register`, `accounts/login` and
`dashboard/billing/plan-changed`. A catch-all trigger would forward all of it
and pollute the property with names GA4 cannot use.

### 2. Mark the key events

Nothing becomes a key event on its own, and GA4 only lets you star an event it
has already received — there is no "create key event by name" in the current
UI. So the order matters: the event has to fire once, wait for the daily
processing cycle, and only then can it be starred.

The property had eight events starred before any of them could possibly fire,
which is why the list looked configured while the container dropped everything.
Current state:

| Event                     | Key event | Why                                                                                              |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `sign_up`                 | yes       | The primary self-serve conversion.                                                               |
| `workspace_created`       | yes       | Activation.                                                                                      |
| `monitor_created`         | yes       | Activation.                                                                                      |
| `teammate_invited`        | yes       | Collaboration.                                                                                   |
| `cta_get_started`         | yes       | Micro-conversion, useful early signal while volume is low.                                       |
| `cta_request_demo`        | yes       | Same.                                                                                            |
| `purchase`                | forced    | A GA4 default that cannot be unmarked. Nothing emits it, so it stays at zero.                    |
| `signup_started`          | no        | A funnel step, not a conversion — starring it would inflate conversions against real signups.    |
| `page_view_pricing`       | no        | Fires on every pricing page load — as a key event it reported browsing as a conversion.          |
| `page_view_demo`          | no        | Same.                                                                                            |
| `demo_request`            | no        | Never had a working delivery path and is no longer emitted at all.                               |
| `generate_lead`           | no        | Nothing emits it.                                                                                |
| `subscription_started`    | not yet   | Carries `value`/`currency`. Cannot be starred until it fires once.                               |
| `subscription_upgraded`   | not yet   | Carries `value`/`currency`. Cannot be starred until it fires once — nobody has changed plan yet. |
| `subscription_downgraded` | not yet   | Same.                                                                                            |
| `meeting_booked`          | not yet   | Same — no booking since the deploy.                                                              |

`subscription_started`, `subscription_upgraded`, `subscription_downgraded` and
`meeting_booked` are the four left. Star each one the first time it appears in the list; until
then GA4 has nothing to star.

`subscription_upgraded` is worth a closer look when it does arrive — it is the
only event carrying `value` and `currency`, and that mapping has never been
exercised against real data. Check the first one in DebugView rather than
assuming the revenue lands.

If you point Google Ads at this property, choose which key events count as
conversion actions there rather than assuming all of them should. `sign_up` and
`subscription_upgraded` are the ones worth bidding on; the `cta_*` pair is
early signal, not revenue.

### 3. One event, one path

`subscription_upgraded` carries `value` and `currency`, so GA4 attributes
revenue to it and Google Ads can bid on it. That only holds if each conversion
is counted once.

Send everything through the `dataLayer`. Do **not** also call
`gtag('event', ...)`: once the Google tag is on the page, gtag interop is live
and that call reaches GA4 directly, bypassing the container — so an event
mirrored to both is counted twice under one name. `head-basic.ejs` used to
mirror `meeting_booked` this way and `demo.ejs` sent a single booking under
three names (`meeting_booked`, `demo_request`, `demo_booked`); both now emit
once, through the `dataLayer` only.

### 4. Verify before relying on it

Use GTM **Preview** on oneuptime.com, trigger a CTA click, and confirm the tag
fires. Then check **GA4 → Reports → Engagement → Events** the next day: any
name from the regex appearing there means the path works end to end.

## Consent

None of this reaches Google or PostHog without consent. `window.oneUptimeConsent`
(Home/Views/head-basic.ejs) gates PostHog loading and pushes Google Consent Mode
v2 signals before the container loads; the cookie banner's buttons are what move
it. Until this existed the banner wrote a localStorage key nobody read, so
"Reject all" rejected nothing. Expect measured volume to reflect acceptance
rate — see the Consent section of
[enterprise-conversion-tracking.md](./enterprise-conversion-tracking.md).

## Safety

Analytics is best-effort and must never block product workflows. Do not add
email, name, phone, monitor URL, telemetry payloads, or other customer content
to event properties.
