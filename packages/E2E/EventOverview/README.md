# Event overview fixture

An offline harness for the real overview pages of the dashboard's events:

| Page                  | Route (from `RouteMap`)                                                               | Production components                                  |
| --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Incident              | `INCIDENT_VIEW` `/dashboard/:projectId/incidents/:id`                                 | `Pages/Incidents/View/{Layout,Index}`                  |
| Alert                 | `ALERT_VIEW` `/dashboard/:projectId/alerts/:id`                                       | `Pages/Alerts/View/{Layout,Index}`                     |
| Scheduled maintenance | `SCHEDULED_MAINTENANCE_VIEW` `/dashboard/:projectId/scheduled-maintenance-events/:id` | `Pages/ScheduledMaintenanceEvents/View/{Layout,Index}` |
| Incident episode      | `INCIDENT_EPISODE_VIEW` `/dashboard/:projectId/incidents/episodes/:id`                | `Pages/Incidents/EpisodeView/{Layout,Index}`           |
| Alert episode         | `ALERT_EPISODE_VIEW` `/dashboard/:projectId/alerts/episodes/:id`                      | `Pages/Alerts/EpisodeView/{Layout,Index}`              |

`Fixture/server.js` bundles the production layouts (ModelPage, side menu) and pages with
esbuild, serves them with the same Tailwind build, `tailwind.config` and `Theme.css`
production uses, and listens on `127.0.0.1:4222` (`EVENT_OVERVIEW_FIXTURE_PORT`). No Docker,
no database, no sign-in. Only the `ModelAPI` / `AnalyticsModelAPI` / `API` data boundary and
the signed-in user are replaced.

Like the dashboard's `App`, the fixture's root component reads the location on every
navigation, so a page that stays mounted on the same route (incident #1042 → #1029 through a
link in the AI report) re-renders with the new id.

Every record is fabricated for a generic "Acme Commerce" workspace, and the fixture header
says so ("Preview workspace · Synthetic data"). The clock is pinned: all dates are relative to
`2026-09-14T18:20:00Z`, and the spec fixes the browser clock to the same instant.

## What is modelled

- **Incident #1042** "Checkout API p95 latency above 2s": Created → Acknowledged (18:04) →
  Resolved (18:12), SEV-2, two labels, two monitors and services, an on-call policy, declared by
  the eu-west-1 probe, two role members, a feed including the AI root-cause item, and membership
  of episode #12.
- **Prior incidents #1017, #1029, #1036**: resolved, same project, openable on the same
  incident route; the AI report links to them.
- **AI investigation** for #1042 and **Alert #311**: a completed run with 10 tool calls
  (citations C1–C10), about 48k tokens, a TL;DR and `analysisMarkdown` in the exact format of
  `AIInvestigationEngine.buildBrandedMarkdown`. The payload also carries `evidence`
  (`InvestigationEvidenceItem[]`) and `references` (`InvestigationEventReference[]`).
  `POST /ai-investigation/evidence` answers per citation the way the server does:
  - incident: an `IncidentList` (C1), `TimeSeriesChart` (C2, C6), `Table` (C3 logs, C9
    monitors, C10 timeline), `TraceWaterfall` (C7), plain `text` (C5), and `rowCount: 0` with
    the server's explanation as `text` (C8). C4 (`lookup_context`) cannot be re-run and
    answers 400.
  - alert: an `AlertList` (C1), charts, tables, a trace, and an `ExceptionList` (C8).
  - pinned (`isPinnedToInvestigationTime`) and current-data citations are both present.
    `verdict` and `create-fix-task` record and succeed.
- **Alert #311** "Payment webhook 5xx rate above 5%" with its monitor and alert episode #7. Its
  hero offers Declare Incident after the state actions, which opens the create-incident page
  with `?alertIds=<alert #311>`.
- **Scheduled maintenance #58** "Primary database failover drill" with two status pages,
  affected monitors and services, reminders and a feed.
- **Incident episode #12** "Checkout degradation — Sep 14" with four member incidents, a
  grouping rule and a role member; **alert episode #7** with five member alerts.
- **State changes** submitted from a hero action (incident, alert, both episodes, scheduled
  maintenance) are stamped like the server does: the new timeline entry starts now, the open
  one is closed and the event moves to the new state, so a background refresh reads the result.

Navigation targets that are not modelled (AI task, monitor, on-call policy, status page,
user, team, roles and member lists, list pages, side-menu sub-pages, and Create Incident -
`INCIDENT_CREATE` `/dashboard/:projectId/incidents/create`, where an alert's Declare Incident
leads) render a small stub page with `data-testid="stub-page"`, `data-page="<PageMap key>"`
and the page name as its `<h1>`.

## Scenarios

Query parameters, parsed once per page load:

| Parameter   | Values                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?state=`   | `resolved` (default), `ongoing` (incident #1042, alert #311 and both episodes stop at Acknowledged) or `created` (they stop before it)                                                                                                                                                                                                                                                                              |
| `?ai=`      | `report` (default), `none`, `queued`, `running`, `failed`, `pending`, `legacy` (a completed report from an API replica without `evidence` / `references`, so the panel falls back to the report's own "Evidence checked" block)                                                                                                                                                                                     |
| `?tldr=`    | `default` or `long` (incident #1042's TL;DR is 320 characters, the server's cap, so the header summary wraps and clamps)                                                                                                                                                                                                                                                                                            |
| `?title=`   | `default` or `long` (alert #311 is titled "Payment webhook 5xx rate above 5% on the eu-west-1 checkout cluster", 67 characters, wider than the room its header leaves beside the actions)                                                                                                                                                                                                                           |
| `?verdict=` | none (default), `confirmed` or `rejected` (a responder's verdict already saved on the runs of incident #1042 and alert #311)                                                                                                                                                                                                                                                                                        |
| `?sm=`      | `scheduled` (default, starts in 2 hours), `ongoing`, `ended`, `overdue` (still Scheduled 20 minutes after its start), `overrun` (still Ongoing 30 minutes after its end)                                                                                                                                                                                                                                            |
| `?fail=`    | comma separated: `evidence`, `verdict`, `create-fix-task`, `investigation`, `resend` (the subscriber notifications of #1042 and #58 are Failed and the retry is refused)                                                                                                                                                                                                                                            |
| `?theme=`   | `dark` adds `html.dark`                                                                                                                                                                                                                                                                                                                                                                                             |
| `?role=`    | who is signed in: `owner` (default; a master admin and Project Owner, so every permission gate is open), `alert-member` (not a master admin, only Alert Member: may acknowledge and resolve alerts but not create incidents, so Declare Incident shows disabled with the missing permissions in its tooltip) or `loading` (no permissions yet, the moment before the snapshot arrives, so gated actions are hidden) |

## What the spec covers

`EventOverview.spec.ts` (121 tests):

- **AI investigation report**: the summary section (TL;DR + summary) above the report; the
  report's sub-sections in order with the amber root-cause callout; no brand heading, server
  "Evidence checked" block or footer in the prose; Copy report copies the published markdown;
  incident and alert reference links (href, `title`, clicking loads the other incident on the
  same route, back returns); citation chips (title and spoken label, click opens the collapsed
  details on the Evidence tab and expands, highlights and focuses the row, exactly one
  `POST /ai-investigation/evidence` with the right body, cached on collapse and re-expand);
  header TL;DR with View full report beside the heading, focusing the panel; a 320-character
  TL;DR (`?tldr=long`) arriving whole, clamped on a phone with Show more / Show less and View
  full report in the bottom row; verdict and fix task request bodies and their failure
  messages; the verdict badge in the header (at once after rating, replaced by a changed
  rating, rolled back with a failed save, already there with `?verdict=`, beside the heading
  at 1440px, wrapped under it at 390px and at 768px with View full report moved to the bottom
  row, on the alert page too) and the muted summary of a rejected report; the feed's compact
  AI item and its More Information modal.
- **Investigation details**: evidence, activity and usage share one section below the report
  that starts collapsed. Its header names what the run did (queries, steps) and the read-only
  guarantee; tokens and the model sit inside. The Evidence checked and Activity tabs switch by
  click and arrow keys, a citation chip opens the collapsed section on the Evidence tab, and
  `?ai=pending` shows only the finished steps, with no tabs.
- **Evidence checked**: every row's label, tool description, time and row count; per citation
  the "What was queried" rows, the Open in link, the pinned or current-data notice and the rows
  (incident list, chart, logs table, `<pre>` text, trace waterfall, no rows with the server's
  explanation, timeline table); a query that cannot be re-run; alert and exception lists on the
  alert page; `?fail=evidence` with Try again sending a second request while focus stays in
  the row; `?ai=legacy`, where a chip focuses the report's own row.
- **Investigation states**: running, queued, failed, pending and none, including the header
  notice and how much of its usage each run shows (a failed run ends its steps with it).
- **Incident and alert**: hero (identifier, title, state, severity, duration, facts and their
  links), stat bar cells, the AI card leading the left column, the right column's stacked card
  headers, Edit buttons and details field order, Resolve / Acknowledge from the hero through
  the state modal with an in-place refresh that never shows the skeleton, and `?fail=resend`.
- **Declare an incident from the alert hero**: in every alert state Declare Incident follows the
  state actions as a neutral outline button (the state action stays the only primary one, no
  More actions menu, nothing fetched to offer it) and opens the create-incident stub with
  `?alertIds=<alert>` and no dialog or write on the way; Back returns to the alert; Tab / Enter
  and Space reach and press it; `?role=alert-member` disables it with the missing permissions
  in a tooltip the pointer and the keyboard both reach; `?role=loading` hides it; an incident's
  hero never offers it.
- **The hero's title row**: for a created and a resolved alert and a created incident at 390,
  768, 1024 and 1280px, the exact rows the actions wrap onto, every button inside the header,
  whole and right-aligned, and the title never squeezed: below xl (1280px) the title spans the
  header and the actions sit one gap under it at full width; from xl they sit beside it,
  top-aligned and ending at the header's right edge. The switch happens at exactly 1280px, and
  a long title (`?title=long`) below xl keeps its own row, truncated with its tooltip, while the
  actions keep theirs.
- **Scheduled maintenance**: every phase's state, duration prefix, actions, overdue notice and
  Starts / Ends / Duration cells with the timezone note; details, feed and resources; Mark as
  Ongoing refreshing in place; `?fail=resend`.
- **Episodes**: hero and four-cell stat bar, the members card (number chip, title link, state
  and severity pills, View all), details field order, roles, Resolve / Acknowledge from the hero.
- **Responsive**: no horizontal scroll at 390px on all five pages (and with evidence rows
  expanded); right-column card titles wider than 120px at 1280px.

Two tests are marked `test.fail` because they pin known layout bugs and pass (as expected
failures) until the bugs are fixed, when Playwright reports them so the mark can go: on a
390px phone an acknowledged alert's Declare Incident is cut off beside Resolve, and at xl a long
alert title squeezes the action group until Declare Incident wraps onto a second row.

`afterEach` fails a test on an uncaught page error or on any request the fixture does not
model, and a network fence aborts anything that leaves the fixture server.

## What the fixture records

`window.__eventOverviewFixture` holds `getItemRequests`, `listRequests`, `countRequests`,
`apiRequests`, `updates`, `creates`, `deletes` and `unhandled`. Anything a page reads that the
fixture does not model (a model table, an analytics query or an API URL) answers empty and
is listed in `unhandled`; the spec's `afterEach` fails when that list is not empty.
`window.__eventOverviewFixture.callApi(method, route, body)` calls the API stubs directly.

## Run it

```
cd packages/E2E
npm install
npm run test-event-overview-ui
```

Playwright reuses a server already listening on port 4222 outside CI. If one from another
checkout might be running, stop it first or run with `CI=1`.

Screenshots land in `output/playwright/event-overview-ui/`, named `*-synthetic.png` because
every record in them is fabricated. The hero title-row tests add
`{alert-hero-created,alert-hero-resolved,incident-hero-created}-{390,768,1024,1280}`.

## Poke at it by hand

```
cd packages/E2E
node EventOverview/Fixture/server.js --watch
```

then open
`http://127.0.0.1:4222/dashboard/10000000-0000-4000-8000-000000000001/incidents/20000000-0000-4000-8000-000000001042`.
`--watch` rebuilds the bundle when a source file changes; refresh the browser. The other pages
use ids `30000000-0000-4000-8000-000000000311` (alerts),
`40000000-0000-4000-8000-000000000058` (scheduled-maintenance-events),
`50000000-0000-4000-8000-000000000012` (incidents/episodes) and
`60000000-0000-4000-8000-000000000007` (alerts/episodes). A browser outside Playwright shows
relative times against the real clock, not the pinned one.

## Not modelled

- Telemetry snapshots: no event carries a `telemetryQuery`, so the Logs / Spans / Metrics /
  Exceptions preview tabs and their analytics queries are not rendered.
- The Monitor Summary card, the series-label "Affected Resource" card, runbook executions,
  auto-remediation suggestions and custom fields are empty, so those cards stay hidden.
- Stubs ignore `select`: every read returns the whole record, so a missing column in a page's
  select is not caught unless a test asserts on the recorded `select`.
