# Monitor overview fixture

An offline harness for the real monitor overview page, its Monitoring Logs page, and Create
Monitor:

| Page | Route (from `RouteMap`) | Production components |
|---|---|---|
| Monitor overview | `MONITOR_VIEW` `/dashboard/:projectId/monitors/:id` | `Pages/Monitor/View/{Layout,Index}` and every card they mount (`Components/Monitor/Overview/*`, `SummaryView/Summary`, `MonitorFeed`, `EmbeddedMetricCard`, `OverviewCustomFields`, `DependencySuppressionWarning`) |
| Monitoring Logs | `MONITOR_VIEW_LOGS` `/dashboard/:projectId/monitors/:id/logs` | `Pages/Monitor/View/{Layout,Logs}`: the real `AnalyticsModelTable` over `MonitorLog`, and the View Summary modal (`SummaryView/SummaryInfo`) |
| Create Monitor | `MONITOR_CREATE` `/dashboard/:projectId/monitors/create` | `Pages/Monitor/Create`: the real `ModelForm`, the monitor type picker (`CardSelect`'s catalog layout), the criteria step (`Form/Monitor/MonitorSteps`) and Probes & Interval |

`Fixture/server.js` bundles the production layout (ModelPage, side menu) and page with
esbuild, serves them with the same Tailwind build, `tailwind.config` and `Theme.css`
production uses, and listens on `127.0.0.1:4223` (`MONITOR_OVERVIEW_FIXTURE_PORT`). No
Docker, no database, no sign-in. Only the `ModelAPI` / `AnalyticsModelAPI` / `API` data
boundary and the signed-in user are replaced.

That Tailwind build is the browser one production loads from `views/index.ejs`: there is no
ahead-of-time CSS, and a class gets its CSS only after it first appears in the DOM, which is
after React's layout effects have run. The fixture declares no classes up front, so a
component that measures itself on its first render (the uptime strip) is tested against the
same ordering a real first page load has.

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
  other families, with `logBody.probeId` and `evaluationSummary`. The incoming email monitor
  has three, shaped as the server writes them: its last email (2 hours ago), the day before's,
  and a scheduled missing-email check 40 seconds ago that carries a copy of the last email
  (`onlyCheckForIncomingEmailReceivedAt`).
- **Response time** (`Metric` aggregate): one series per probe every five minutes, and
  `MetricType` rows for the unit. While the monitor was Offline, Frankfurt and Singapore
  record their fast error responses and N. Virginia, whose checks time out, records nothing,
  as the server does: it writes the metric whenever a check has a response time.
- **Open work**: while the subject is Offline, incident `20000000-…-000000001042` (SEV-1,
  Created) and alert `30000000-…-000000000311` (Critical, Acknowledged) are open on it.
- **Owners**: Maya Chen, Sam Rivera and the Checkout SRE team (not on the network device).
- **Feed**: created, owner added and the last four status changes.

Navigation targets that are not modelled (every monitor sub-page but Monitoring Logs,
incidents, alerts, network devices, list pages) render a small stub page with
`data-testid="stub-page"` and `data-page="<PageMap key>"`.

The signed-in user's permissions are answered through `getAllPermissions` and through the two
reads it is built from, `getGlobalPermissions` and `getProjectPermissions`: a model table checks
every column against the latter, and drops the columns it cannot read.

## Scenarios

Query parameters, parsed once per page load. `?state=`, `?history=` and `?fail=` shape the
monitor chosen with `?type=`; every other monitor keeps the defaults, so following a link to
another monitor lands on a plain, healthy one.

| Parameter | Values |
|---|---|
| `?type=` | `api` (default), `website`, `ssl`, `incoming-request`, `incoming-email`, `server`, `kubernetes`, `network-device`, `manual` |
| `?state=` | comma separated. The status: `operational` (default), `offline` (for 12 minutes), `degraded` (for 25 minutes). Plus any of: `disabled`, `maintenance`, `no-probes`, `probes-off`, `disconnected` (every probe), `one-disconnected` (Singapore went offline 3 days ago, and its last result and next check stayed there; the other two probes report on time), `stale` (last results 38 minutes old; for `kubernetes`, the worker still stamps the monitor every minute but the newest evaluation in `MonitorLog` is 14 minutes old), `awaiting` (created 2 minutes ago, nothing received). `disabled,probes-off` is a disabled monitor whose probes are all switched off. |
| `?history=` | `full` (default, created in March), `new` (created 12 days ago), `flapping` (an outage every 6h40m for three months) |
| `?role=` | `owner` (default, ProjectOwner), `viewer`, `monitor-viewer`, `read-project-monitor`. Reads of a model the role cannot read are refused the way the API refuses them, and so is a select that names a column the role cannot read (the secret keys). |
| `?fail=` | comma separated: `uptime-summary` (the first request fails), `incidents` (every Incident list), `probes` (every MonitorProbe list), `monitor` (the first overview read of the Monitor row; the layout's and header's reads succeed), `refresh-status` (every request) |
| `?nav=1` | links to every fixture monitor in the header, to move between monitors on the same, still-mounted route |
| `?theme=` | `dark` adds `html.dark` |

## What the spec covers

`MonitorOverview.spec.ts`:

- **Probe checks**: the operational API monitor (headline, target, facts, pulse, the four
  stat cells and their numbers, exactly 90 bars and the 90-day figure, both columns' card
  order, the Linked Resources card's empty state and its Edit button, the probe picker, the
  status dot's colour, the Response time plot's height); Offline
  with an open incident and alert (danger tile, failure cause, Open now links, open-work rows
  with their severity, and links; the ongoing Offline row is the only one marked Currently
  Active, with its live duration); a new monitor (no-data bars before creation, "measured
  over", the creation footnote); probes off; disabled with no probe enabled; maintenance
  ("includes paused time", no probe Late, "Checks paused"); disabled (no probe Late); stale
  (Checks overdue, Overdue by, the tile is amber not emerald); degraded; every probe
  disconnected; one probe of three disconnected (not overdue, the next check from the
  probes still checking, the agreement rule over the connected probes); no probes; awaiting
  the first check; the SSL certificate expiry fact; a day bar opening its dialog with the
  incident; a flapping history.
- **Other families**: incoming request awaiting (owner: URL, copy, curl; viewer: the lock
  state and no secret anywhere in the page) and after data (Connection card); incoming email
  awaiting (owner: the address, "Copy email address", the "How to verify the address" link;
  viewer: the lock state, no secret) and after data; server awaiting and after data; Kubernetes, and Kubernetes whose evaluations stopped
  landing (overdue by the evaluation log, not the worker's stamp); network device (device
  link, no owners); manual (guide card, no Summary, no MonitorLog read).
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
- **Monitoring Logs**: the incoming email monitor's Email column (subject over sender, "Scheduled
  check"), View Summary on an email row and on a scheduled check, the table inside the card at
  1280px and 1440px (View Summary never pushed off it), no sideways scroll at 390px, and the
  API monitor's Probe column.
- **Responsive and theme**: 390px (no sideways scroll for every type, the strip starts at
  today and its date labels scroll with the bars, facts and stat bar in one column, and the
  email address, heartbeat URL and server install commands of a monitor waiting for its first
  signal visible and inside the screen: Card hides its description below md, so they belong
  in the card's body), 768px
  (2 x 2 stat bar, one column, card titles not squeezed), 1280px (two thirds and one third),
  the Response time plot at least 150px tall at 390, 768 and 1440px, and dark mode.

`AdvancedMenuSection.spec.ts`, the monitor's side menu, where only a real browser can show
it: the Advanced section starts folded on the overview with its rows hidden (visibility:
hidden, not just a zero height); the keyboard skips folded rows and walks them once Advanced
is open; it stays folded on Monitoring Logs, and stays open there once the user opened it;
and on a phone it starts folded, a tap on its header opens it without closing the menu, and
picking a page still closes the menu.

`CreateMonitor.spec.ts` covers Create Monitor in a real browser: it opens on the six common
monitor types as compact rows, two to a line on a desktop and one on a phone with nothing
wider than the screen, with no category heading or count and the whole first step (Next
included) on screen; More monitor types shows every other type under a plain heading and
moves focus to the first new one; the keyboard searches, picks with Enter or Space (one tab
stop for the rows, arrows between them), and Change then Escape keeps the type picked; a
picked type shrinks to one line and the name moves up to meet it; a link's `?monitorType=`
opens on that type; dark mode keeps the rows and summary on dark surfaces. Start to finish,
a Website monitor's default criteria are folded, hidden from sight and from the keyboard,
and stretch nothing below the form; no error shows until Next is pressed, and then right by
Next; Probes & Interval opens on Every 5 Minutes; Create Monitor sends the type, name,
interval, address and picked probe. A Manual monitor is created from its one step, with no
interval.

`afterEach` fails a test on an uncaught page error, on any request the fixture does not
model, and on any request the network fence had to abort.

## What the fixture records

`window.__monitorOverviewFixture` holds `getItemRequests`, `listRequests` (analytics lists
carry `analytics: true`), `countRequests`, `aggregateRequests`, `apiRequests` (with
`headers`), `updates`, `creates` (Create Monitor's create: the monitor's JSON and its misc
data, such as the probes picked) and `unhandled`, plus `monitors` (id, name and secret key
per type). A create is answered with the id `70000000-0000-4000-8000-000000000100`, whose
page is a stub (`data-page="created-monitor"`). The workspace runs its own three probes and
no global ones (`/probe/global-probes` answers an empty list), and has no on-call policies,
incident roles, team members or telemetry services.

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
- Linked resources: no monitor links a host, cluster, database or service, so the Linked
  Resources card shows its empty state.
- Dependencies: no monitor depends on another, so the suppression notice stays hidden.
