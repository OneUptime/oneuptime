# Self-serve revenue funnel

OneUptime emits stable funnel events to PostHog and the Google Tag Manager
`dataLayer`. Event names and properties are defined in
`Common/Types/Analytics/RevenueEvent.ts` and carry `event_schema_version`.

| Stage | Event | Meaning |
| --- | --- | --- |
| Signup | `signup_started` | A registration submission is attempted. |
| Signup | `sign_up` | An account is successfully created. |
| Activation | `workspace_created` | A project/workspace is successfully created. |
| Activation | `monitor_created` | A monitor is successfully created. |
| Collaboration | `teammate_invited` | A project invitation is successfully created. |
| Revenue | `subscription_upgraded` | A project moves to a higher plan. `is_paid_conversion` identifies free-to-paid. |
| Revenue | `subscription_downgraded` | A project moves to a lower plan. |

## Browser acquisition attribution

The public site stores a compatible acquisition object in the
`ou_acquisition` cookie and the `acquisitionAttribution` localStorage key. It
also reads and writes the legacy `firstTouch`, individual `utm*`, `utmUrl`, and
`clickIds` localStorage keys so visitors already in a funnel are not reset by a
deployment. The browser cookie lasts 90 days, uses `SameSite=Lax`, and is marked
`Secure` on HTTPS.

The object keeps three independent views:

- `firstTouch`: the visitor's first observed touch and is never overwritten.
- `latestTouch`: the most recent visit, including direct visits.
- `latestPaidTouch`: the most recent paid touch; a later direct visit does not
  erase it.

URLs are reduced to safe HTTP(S) URLs: credentials, fragments, UTM parameters,
and supported click IDs are stripped before persistence. Payloads are
allowlisted again on the server. Do not add opaque vendor responses, attendee
data, email addresses, or other PII.

Each visit and meaningful conversion is posted best-effort to the durable
`POST /api/acquisition/touchpoint` endpoint. Capture is consent-aware and must
be gated according to the site's consent state. Delivery is also offline-safe:
failed or unavailable network calls never block rendering, navigation, signup,
or booking.

## Durable joins and retention

Browser state is only a handoff mechanism; `MarketingTouchpoint` is the durable
server record. Signup associates the anonymous visitor with the User, project
creation carries attribution onto the Project, and demo touchpoints can be
joined by visitor and external reference. Funnel reporting should join signup,
User, Project, and demo records server-side rather than putting identity into
GA4.

Server retention is an operator decision and may outlive the 90-day browser
cookie. Self-hosted operators must deploy the attribution schema migration and
Home API together, configure retention to match their privacy policy, and run
the migration before relying on touchpoint joins. Existing legacy localStorage
values are migrated compatibly by the browser script; do not bulk-delete them
during rollout.

Cal.com exposes booking success only through its browser callback. OneUptime
records a durable `demo_booked` touchpoint from that callback, but cannot claim
server-to-server delivery or recover a booking when the callback is blocked,
the page closes early, consent forbids capture, or the browser is offline.
Never persist the opaque Cal event payload.

## GA4 setup

Create GA4 Event tags for the exact event names above and forward their
allowlisted properties. Mark `sign_up`, `workspace_created`, `monitor_created`,
`teammate_invited`, and `subscription_upgraded` as key events as appropriate.
Do not rename events: joins and historical comparisons depend on stable names.

Recommended funnel:

`signup_started` → `sign_up` → `workspace_created` → `monitor_created` →
`teammate_invited` → `subscription_upgraded` (`is_paid_conversion = true`)

Use `project_id` to correlate authenticated product events. Never send email,
name, phone, monitor URLs, telemetry payloads, or customer content to GA4.
Analytics is best-effort and must never block product workflows.
