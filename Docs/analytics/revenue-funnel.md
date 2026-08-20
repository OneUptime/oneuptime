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
| Revenue       | `subscription_upgraded`   | A project moves to a higher plan. `is_paid_conversion` identifies free-to-paid. |
| Revenue       | `subscription_downgraded` | A project moves to a lower plan.                                                |

Sales-led bookings are tracked separately — see
[enterprise-conversion-tracking.md](./enterprise-conversion-tracking.md) for
`meeting_booked` and the server-confirmed conversion ledger behind it.

## GA4 setup

In Google Tag Manager, create GA4 Event tags for these exact event names and
forward the event properties. Mark `sign_up`, `workspace_created`,
`monitor_created`, `teammate_invited`, and `subscription_upgraded` as key events
as appropriate. Do not rename events in GTM: joins and historical comparisons
depend on stable names.

Recommended funnel:

`signup_started` → `sign_up` → `workspace_created` → `monitor_created` →
`teammate_invited` → `subscription_upgraded` (`is_paid_conversion = true`)

Use `project_id` to correlate post-signup product events. Acquisition parameters
are persisted on the User by registration (`utm*`, click IDs, and first-touch
attribution); the warehouse/CRM join should use the authenticated user and
project relationship rather than sending email addresses to GA4.

## Safety

Analytics is best-effort and must never block product workflows. Do not add
email, name, phone, monitor URL, telemetry payloads, or other customer content
to event properties.
