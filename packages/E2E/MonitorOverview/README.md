# Monitor overview fixture

An offline harness for the real monitor overview page:

| Page | Route (from `RouteMap`) | Production components |
|---|---|---|
| Monitor overview | `MONITOR_VIEW` `/dashboard/:projectId/monitors/:id` | `Pages/Monitor/View/{Layout,Index}` and every card they mount (`Components/Monitor/Overview/*`, `SummaryView/Summary`, `MonitorFeed`, `EmbeddedMetricCard`, `OverviewCustomFields`, `DependencySuppressionWarning`) |

`Fixture/server.js` bundles the production layout (ModelPage, side menu) and page with
esbuild, serves them with the same Tailwind build, `tailwind.config` and `Theme.css`
production uses, and listens on `127.0.0.1:4223` (`MONITOR_OVERVIEW_FIXTURE_PORT`). No
Docker, no database, no sign-in. Only the `ModelAPI` / `AnalyticsModelAPI` / `API` data
boundary and the signed-in user are replaced.

Every record is fabricated for a generic "Acme Commerce" workspace, and the fixture header
says so ("Preview workspace · Synthetic data"). The clock is pinned: all dates are relative
to `2026-09-21T12:00:00Z`, and the spec fixes the browser clock to the same instant.

## What is modelled

One monitor per supported type, each on its own id (`70000000-0000-4000-8000-00000000000N`):

| `?type=` | N | Monitor | Notes |
|---|---|---|---|
| `api` (default) | 1 | Checkout API | 3 probes, `*/5` cadence, minimum probe agreement 2 |
| `website` | 2 | Storefront | 3 probes |
| `ssl` | 3 | Storefront TLS certificate | certificate expires in 23 days |
| `incoming-request` | 4 | Nightly billing export | 30-minute missing-request criterion, last request 7 minutes ago |
| `incoming-email` | 5 | Payroll run confirmation | last email 2 hours ago |
| `server` | 6 | orders-db primary host | agent report 38 seconds ago, CPU 37%, memory 62% |
| `kubernetes` | 7 | Production cluster (eu-west-1) | two criteria steps, evaluated every minute |
| `network-device` | 8 | Core switch sw-core-01 | device `85000000-…-000000000001`, no owners |
| `manual` | 9 | Payment provider | no steps |

- **Status history** comes from one list of status changes per monitor. The same list feeds
  the `MonitorStatusTimeline` rows and `GET /monitor/uptime-summary/:id`, which the fixture
  builds the way `MonitorStatusTimelineService.getMonitorUptimeSummary` does: 90 day buckets
  from local midnight 89 days before now in the requested `?timezone=`, exact rolling
  24h / 7d / 30d windows, and a 90-day window summed from the buckets
  (`MonitorUptimeSummaryUtil.toJSON`). Past outages: Offline on Jul 12 (42 min) and Aug 29
  (75 min), Degraded on Aug 4 (3 h) and Sep 12 (18 min), and a 35-minute Degraded spell that
  ended 3 days, 4 hours and 12 minutes ago. Every Offline spell of 30 minutes or more raised
  an incident that has since resolved, so the uptime bars carry incident markers.
- **Probes**: Frankfurt, N. Virginia and Singapore, as `MonitorProbe` rows with
  `lastMonitoringLog` keyed by the step id. `lastPingAt` is two seconds before the result,
  so a poll finds nothing pending and reads the probes LIGHT.
- **Evaluation log** (`MonitorLog`, analytics): two per probe for probe checks, one for the
  other families, with `logBody.probeId` and `evaluationSummary`.
- **Response time** (`Metric` aggregate): one series per probe every five minutes, with no
  points while the monitor was Offline, and `MetricType` rows for the unit.
- **Open work**: while the subject is Offline, incident `20000000-…-000000001042` (SEV-1,
  Created) and alert `30000000-…-000000000311` (Critical, Acknowledged) are open on it.
- **Owners**: Maya Chen, Sam Rivera and the Checkout SRE team (not on the network device).
- **Feed**: created, owner added and the last four status changes.

Navigation targets that are not modelled (every monitor sub-page, incidents, alerts, network
devices, list pages) render a small stub page with `data-testid="stub-page"` and
`data-page="<PageMap key>"`.

## Scenarios

Query parameters, parsed once per page load. `?state=`, `?history=` and `?fail=` shape the
monitor chosen with `?type=`; every other monitor keeps the defaults, so following a link to
another monitor lands on a plain, healthy one.

| Parameter | Values |
|---|---|
| `?type=` | `api` (default), `website`, `ssl`, `incoming-request`, `incoming-email`, `server`, `kubernetes`, `network-device`, `manual` |
| `?state=` | comma separated. The status: `operational` (default), `offline` (for 12 minutes), `degraded` (for 25 minutes). Plus any of: `disabled`, `maintenance`, `no-probes`, `probes-off`, `disconnected`, `stale` (last results 38 minutes old), `awaiting` (created 2 minutes ago, nothing received). `disabled,probes-off` is a disabled monitor whose probes are all switched off. |
| `?history=` | `full` (default, created in March), `new` (created 12 days ago), `flapping` (an outage every 6h40m for three months) |
| `?role=` | `owner` (default, ProjectOwner), `viewer`, `monitor-viewer`, `read-project-monitor`. Reads of a model the role cannot read are refused the way the API refuses them, and so is a select that names a column the role cannot read (the secret keys). |
| `?fail=` | comma separated: `uptime-summary` (the first request fails), `incidents` (every Incident list), `probes` (every MonitorProbe list), `monitor` (the first overview read of the Monitor row; the layout's and header's reads succeed), `refresh-status` (every request) |
| `?nav=1` | links to every fixture monitor in the header, to move between monitors on the same, still-mounted route |
| `?theme=` | `dark` adds `html.dark` |

## What the spec covers

`MonitorOverview.spec.ts`:

- **Probe checks**: the operational API monitor (headline, target, facts, pulse, the four
  stat cells and their numbers, exactly 90 bars and the 90-day figure, both columns' card
  order, the probe picker, the status dot's colour); Offline with an open incident and alert
  (danger tile, failure cause, Open now links, open-work rows and links); a new monitor (no-data
  bars before creation, "measured over", the creation footnote); probes off; disabled with
  no probe enabled; maintenance ("includes paused time"); stale (Checks overdue, Overdue by,
  the tile is amber not emerald); degraded; disconnected; no probes; awaiting the first check;
  the SSL certificate expiry fact; a day bar opening its dialog with the incident; a flapping
  history.
- **Other families**: incoming request awaiting (owner: URL, copy, curl; viewer: the lock
  state and no secret anywhere in the page) and after data (Connection card); incoming email;
  server awaiting and after data; Kubernetes; network device (device link, no owners);
  manual (guide card, no Summary, no MonitorLog read).
- **Roles**: MonitorViewer (Open now "—", the response-time fallback, no Incident, Alert or
  Metric read), Viewer (no secret-key column in the select), ReadProjectMonitor (no
  duration, "—" tiles, hidden history and activity, no MonitorProbe, MonitorStatusTimeline,
  MonitorFeed or uptime-summary read).
- **Failures**: uptime summary then Try again, the first-load error then Refresh?,
  refresh-status, probes, incidents.
- **Refresh and polling**: Refresh in place (no skeleton, refresh-status once); the 60-second
  poll with a fake clock (Monitor, LIGHT probes and timeline every poll, the uptime summary
  on the fifth); the recorded requests (tenant header, `timezone=UTC`, the probe query, the
  timeline's limit and sort, the evaluation log limit, the open-work filters); moving to
  another monitor through a header link; a hero call to action.
- **Responsive and theme**: 390px (no sideways scroll for every type, the strip starts at
  today, facts and stat bar in one column), 768px (2 x 2 stat bar, one column, card titles
  not squeezed), 1280px (two thirds and one third), and dark mode.

`afterEach` fails a test on an uncaught page error, on any request the fixture does not
model, and on any request the network fence had to abort.

## What the fixture records

`window.__monitorOverviewFixture` holds `getItemRequests`, `listRequests` (analytics lists
carry `analytics: true`), `countRequests`, `aggregateRequests`, `apiRequests` (with
`headers`), `updates` and `unhandled`, plus `monitors` (id, name and secret key per type).

## Run it

```
cd packages/E2E
npm install
npm run test-monitor-overview-ui
```

Playwright reuses a server already listening on port 4223 outside CI. If one from another
checkout might be running, stop it first or run with `CI=1`.

Screenshots land in `output/playwright/monitor-overview-ui/`, named `*-synthetic.png`
because every record in them is fabricated.

## Poke at it by hand

```
cd packages/E2E
node MonitorOverview/Fixture/server.js --watch
```

then open
`http://127.0.0.1:4223/dashboard/10000000-0000-4000-8000-000000000001/monitors/70000000-0000-4000-8000-000000000001`
and add the query parameters above. `--watch` rebuilds the bundle when a source file
changes; refresh the browser. A browser outside Playwright shows relative times against the
real clock, not the pinned one.

## Not modelled

- Telemetry previews: no Logs, Metrics, Traces or Security Events monitor is modelled.
- Custom fields: the project defines none, so the card stays hidden.
- Dependencies: no monitor depends on another, so the suppression notice stays hidden.
- The Tailwind build is the CDN one, which compiles a class only once it appears in the DOM.
  `server.js` declares the uptime strip's classes up front (production CSS is compiled ahead
  of time), because the strip measures itself on its first render.
