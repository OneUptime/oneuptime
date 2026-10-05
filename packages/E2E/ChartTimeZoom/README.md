# Chart time zoom fixture

Real-browser regressions for issue #4105: on every time-series chart, a drag
selects a time slice and that slice becomes the time range of the WHOLE page.
Every chart re-queries and redraws for it, the page's time picker shows the
custom range and a "Reset zoom" button appears beside it. A double-click on ANY
chart, or Reset zoom (mouse or keyboard), puts back the range the page had before
the zoom, and one reset climbs all the way out of nested zooms. Picking a range
in the time picker ends the zoom.

It also holds the regressions for issue #4116: right after a drag zooms the Traces
or Logs explorer, every double-click on its histogram puts the explorer back on
its range, whatever moment the zoom's data lands (see "Explorers: a double-click
right after a drag" below).

| Page | Route (from `RouteMap`) | Production components |
|---|---|---|
| Kubernetes cluster overview | `KUBERNETES_CLUSTER_VIEW` `/dashboard/:projectId/kubernetes/:id` | `Pages/Kubernetes/View/{Layout,Index}` (golden tiles and charts, activity cards, workloads, top consumers, warnings, cluster details) |
| Kubernetes cluster insights | `KUBERNETES_CLUSTER_VIEW_INSIGHTS` `/dashboard/:projectId/kubernetes/:id/insights` | `Pages/Kubernetes/View/{Layout,Insights}`: three `EmbeddedMetricCard`s (`MetricView` charts, `KubernetesNetworkThroughputChart`) |
| Host overview | `HOST_VIEW` `/dashboard/:projectId/host/:id` | `Pages/Host/View/{Layout,Overview}` |
| Traces explorer | `TRACES` `/dashboard/:projectId/traces` | `Pages/Traces/{Layout,Index}`: `TracesViewer` ("Traces over time" histogram, facets, span list, saved views) |
| Logs explorer | `LOGS` `/dashboard/:projectId/logs` | `Pages/Logs/{Layout,Index}`: the Dashboard's `LogsViewer` ("Log Volume" histogram, facets, log list, saved views) |

Each page renders inside its production layout: the View layout (`ModelPage`,
breadcrumbs, side menu with its count badges) for the cluster and host pages, the
Traces or Logs layout (`Page`, breadcrumbs, the Viewer / Insights / Setup Guide /
Settings tabs) for the explorers. `Fixture/server.js` bundles them with esbuild
(`Common/UI/esbuild-config.js`), serves them with the same browser Tailwind build,
`tailwind.config` and `Theme.css` production uses, and listens on `127.0.0.1:4233`
(`CHART_TIME_ZOOM_FIXTURE_PORT`). No Docker, no database, no sign-in. Only the
`ModelAPI` / `AnalyticsModelAPI` / `API` / `Realtime` data boundary and the signed-in
user are replaced.

The zoom itself comes from the page: each of the cluster and host pages wraps its
content in `<TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={...}>`
(`Common/UI/Components/Charts/TimeRangeZoom`), with `setTimeRange` on the two
overviews and `handleTimeRangeChange` (which also re-resolves the window the cards
share) on Insights. The explorers keep a zoom of their own
(`TelemetryViewer/useViewerTimeRangeZoom`) over the window their viewer owns. The
fixture adds nothing to the pages: take that wiring away and these regressions
fail.

## Dataset

Every record is fabricated for a generic "Acme Platform" workspace, and the fixture
header says so ("Preview workspace · Synthetic data"). The clock is pinned: the spec
fixes the browser clock to `2026-09-21T12:00:00Z`, so "Past 30 Minutes" is always
11:30 to 12:00 UTC.

- **Kubernetes cluster** `60000000-0000-4000-8000-000000000001`, "Production
  (eu-west-1)", identifier `prod-eu-west-1`, connected, healthy: three 4-core,
  16 GiB workers (`worker-1..3`, also `KubernetesResource` Node rows with their
  allocatable), seven pods across `shop`, `search`, `data`, `ingress-nginx` and
  `batch`, the inventory summary behind the counts (24 pods, 6 namespaces, ...),
  and two warning events (`Log`, k8sobjects shape).
- **Host** `62000000-0000-4000-8000-000000000001`, `api-gateway-01`, Ubuntu,
  4 cores, 16 GiB, two mounts (`/`, `/boot/efi`), two NICs.
- **Telemetry is generated, not stored.** Every `Metric` aggregate is answered from a
  catalogue of series (metric name, attributes, a smooth value function of time),
  sampled once a minute inside the request's time filter and bucketed the way the
  analytics server buckets it (`AggregationIntervalUtil`, `toStartOfInterval`),
  honouring the aggregation type, `groupBy.attributes` and `groupByAttributeKeys`.
  So a chart is never empty whatever window a zoom asks for, and an instant carries
  the same value zoomed or not. Values never read the clock. Something worth zooming
  into: worker-2's batch job and the host's gateway both peak at 11:43.
- Network counters are cumulative and monotonic (the pages turn them into rates);
  heartbeats are one a minute, so availability reads 100%.
- `MetricType` rows give the native units (CPU in cores, `{cpu}`, so the Insights
  CPU% transform sees cores).
- **The explorers' services, spans and logs.** Four `Service` rows (`checkout-api`,
  `payments-worker`, `search-api`, `storefront-web`). Spans and log lines are
  generated, not stored: each minute of each service holds a number of rows that
  follows a wave, and every row (its offset in the minute, operation or message,
  status or severity, trace and span ids, attributes) comes from a hash of the
  minute, the service and the row's index. The span list, the log list, the lists'
  totals, both histograms and the facet counts are read off those same rows, so they
  agree for any window. A list answers the way `BaseAnalyticsAPI` does: the page,
  `hasMore` (whether rows follow it) and, as `count`, only a lower bound (the rows
  up to the page's last, plus one while more follow). A page that ends the list so
  proves its own total; otherwise the explorer counts, as it does for both
  explorers' hour and zoom. A total ("2,120 spans", "1,101 logs") is the explorer's
  `exact` count (`CountBy.exact`), which the server answers with the rows a list
  with the same query pages through, and so does the fixture. The histograms are
  bucketed the way `TraceAggregationService` /
  `LogAggregationService` bucket them: the rows whose minute starts inside the
  window (the start rounded down to its minute, the end excluded), grouped on
  `toStartOfInterval(minute, bucket)`, one `{ time: "YYYY-MM-DD HH:MM:SS", series |
  severity, count }` per bucket and series that has rows, in time order; the logs
  answer also names its `bucketSizeInMinutes` (the server's default for the window
  when the request names none). checkout-api's calls to payments-worker time out in
  a burst at 11:43. The `Log` table's two Kubernetes warning events are listed and
  counted with the generated lines.
- Empty on purpose: incidents, alerts, scheduled maintenance, monitors, dismissals,
  change events, exemplars (raw `Metric` rows with a trace id), trace and log saved
  views, Docker and Podman hosts.

Any route not listed above renders a "Not modelled" stub (`data-testid="stub-page"`).

## What the fixture records

`window.__chartTimeZoomFixture` holds `dataset` (ids and identifiers), `requests`,
`unhandled` and two gates.

Every data request is appended to `requests` in order, as
`{ seq, kind, modelName, ... }`:

| `kind` | Recorded |
|---|---|
| `aggregate` | `metricName`, `attributes`, `aggregationType`, `groupBy`, `groupByAttributeKeys`, `aggregationInterval`, `window` (`startTimestamp` / `endTimestamp`, ISO), `queryTime` (the query's own `InBetween`), `interval` and `rows` (what came back) |
| `getList`, `count`, `analytics.getList`, `analytics.count` | `query`, `select`, `sort`, `limit`, `skip`, and `window` (`{ column, start, end }`) when the query filters a column by an `InBetween`; an `analytics.count` also records `exact` (whether it asked for the exact total) and `count` (what came back) |
| `getItem`, `updateById` | `id`, `select` or `body` |
| `api` | `method`, `url`, `body`, and `window` (`{ start, end }`, ISO) when the body names a `startTime` / `endTime`; a histogram also records `bucketSizeInMinutes` and `buckets` (how many came back) |
| `realtime` | `modelName`, `eventType`: the logs explorer's subscription to new rows. Nothing is ever sent on it |

A table, analytics model, metric name, API URL, explorer filter or facet the
fixture does not model is recorded on `unhandled` too, and the specs fail the test
on it. That includes an `analytics.count` of any table but the generated ones
(`SpanItemV3`, `LogItemV3`), and a list or count of those that does not filter
its time column by an `InBetween`.

The gates let a spec pick the moment data lands. Both answer at once by default,
so the other specs never see them:

| Gate | Holds |
|---|---|
| `histogramGate` | the explorers' `/telemetry/traces/histogram`, `/telemetry/traces/facets`, `/telemetry/traces/analytics`, `/telemetry/logs/histogram` and `/telemetry/logs/facets` answers (the Traces explorer awaits its histogram and facets together) |
| `aggregateGate` | every modelled `AnalyticsModelAPI.aggregate` answer |

With `gate.mode = "manual"` later answers wait in `gate.pending`, each described as
`{ seq, url` or `metricName, window, response }` (`response` only on the explorer
answers); `gate.deliver()` answers everything pending, in order, and returns how
many it answered. Setting `mode` back to `"immediate"` does not release what is
already held: `deliver()` does.

## What the spec covers

`ChartTimeZoom.spec.ts` runs nine scenarios on each of the three pages (27 tests).
Every gesture is a real pointer gesture (`page.mouse`) located from the chart's own
x-axis: the first and last x-axis labels give the spacing of the evenly spaced
buckets, so the pointer presses on exactly the bucket a scenario names.

1. **A drag zooms every chart, every chart query and the time picker.** Hovering a
   chart reveals its card's hint ("Drag to zoom"). While the button is down the
   selection band (`.recharts-reference-area`) spans the dragged buckets, nothing is
   queried yet and no page text is selected. After the release: every aggregate
   behind the page's charts asked for exactly the dragged window and no other; the
   picker reads the custom range; Reset zoom shows beside the picker (its title names
   the range it goes back to); every chart's x-axis starts at the window's start and
   stays inside it; every hint names the way back; the band is gone; nothing is
   selected; hovering reveals "Double-click to reset".
2. **A quick drag zooms exactly the buckets it pressed and released on**: the press
   comes in the same frame the pointer reaches the first bucket and the release in
   the same frame it reaches the last (see "Pointer timing" below).
3. **A drag released outside the chart still zooms**: the pointer leaves the chart
   downwards before the release.
4. **A double-click on another chart puts the page back on its range** (the initial
   range's queries, label, axes and hints), with no page text selected.
5. **A double-click on a line itself puts the page back on its range** (see "A
   double-click on a line" below).
6. **Nested zooms: one double-click climbs all the way out.** A second drag inside
   the first zoom narrows the page again; one double-click on the first chart
   returns to the initial range.
7. **Reset zoom puts the page back on its range** (a click).
8. **Reset zoom works from the keyboard**: Tab from the time picker lands on Reset
   zoom, Enter resets.
9. **Picking a range in the time picker ends the zoom**: Reset zoom goes away, every
   chart follows the new range, and a double-click then changes nothing.

The hints: a chart card's (or, on the host overview, a section's) `TimeRangeZoomHint`
reads "Drag to zoom", and "Double-click to reset" while the page is zoomed; it is
revealed while the pointer is over its card (the named Tailwind group
`group/zoomhint`) or while focus is inside it. A `MetricView` chart's ChartGroup line
reads "Drag to zoom", then "Drag to zoom · double-click to reset". Kubernetes
overview: five card hints; host overview: two section hints; Insights: the network
chart's hint and five ChartGroup lines.

Where a double-click lands: the reset scenarios wait for every chart to stop moving
(recharts animates a line from its old points to its new ones after a zoom), then
double-click a spot of the plot that no series covers, half-way between two
buckets.

| Page | Charts | Initial range | Zoom (scenario 1) | Released outside | Nested | Preset |
|---|---|---|---|---|---|---|
| Kubernetes cluster overview | Availability, CPU, Memory, Filesystem, Network | Past 30 Minutes | CPU 11:34 to 11:40, so [11:34, 11:41) | Memory, [11:42, 11:52) | Availability, [11:36:00, 11:39:00) | Past 1 Hour |
| Host overview | Availability, CPU, Memory, Disk space, Network | Past 30 Minutes | CPU, [11:34, 11:41) | Disk space, [11:42, 11:52) | Availability, [11:36:00, 11:39:00) | Past 1 Hour |
| Kubernetes cluster insights | Node CPU Utilization, Node Memory Usage, Node Filesystem Usage, Network, Pod CPU Utilization, Pod Memory Usage | Past 1 Hour | Node CPU Utilization, [11:14, 11:34) | Node Memory Usage, [11:40, 11:53) | Pod Memory Usage, [11:20, 11:26) | Past 3 Hours |

A zoom runs from the start of the first dragged bucket to the END of the last one,
never past the end of the range the page was on.

Page by page:

- The overviews have one time picker in the page header; on Insights every
  `EmbeddedMetricCard` has its own picker over the page's shared range, so each of
  the three pickers must show the zoom and each card header gets its own Reset zoom.
- The host's Processes tile reads the last five minutes of the page's range; the
  spec checks it follows the zoom's end.
- Insights also re-reads exemplars and incident, alert and change-event markers for
  every window; those must follow the zoom too. Going back to a window the page has
  already fetched, `MetricView` may serve its charts from `MetricUtil`'s short-lived
  result cache instead of asking again (with the browser clock pinned that cache
  never expires), so on a reset those charts may send no aggregate; if one is sent,
  it must be for the initial window. The network chart is not cached and must
  re-query.

`afterEach` fails a test on an uncaught page error, on any request the fixture does
not model and on any request the network fence had to abort. Auto-refresh stays at
the pages' default (every 30 seconds): a refresh re-queries the window the page is
on, which the assertions accept.

### A double-click on a line

Scenario 5 double-clicks a point of a ChartLibrary line chart's line (the overviews'
and Insights' Network charts). It used to leave the page zoomed: a press re-rendered
the chart (`useChartRangeSelection` set React state on `mousedown`), recharts 3 then
remounted the line's path and dots (they are keyed by an id that changes with the
line's points), the pressed node was gone by `mouseup`, and Chrome dispatched no
`click` and no `dblclick`. The line chart's transparent 12px click-target lines
cover every line, so that was any double-click on or near a line. A press now
renders nothing until it becomes a drag, and the click-target lines have no dots and
no animation.

### Pointer timing

By default recharts 3 works out the bucket under the pointer on the animation frame
after a `mousemove`, but hands a chart's `mousedown` and `mouseup` handlers whatever
bucket it last worked out, at once. So a release in the frame of the last move lost
the buckets that move crossed, and a press in the frame the pointer arrived started
a bucket early or was dropped. Charts that offer a drag now take `mousemove`
unthrottled (`RANGE_SELECTION_THROTTLED_EVENTS`). Scenario 2 presses and releases in
the frame the pointer arrives; the other scenarios let two frames pass before every
press and release (`settle()`), as a careful reader's pointer would.

### The Kubernetes Overview header

`KubernetesOverviewHeader.spec.ts` (6 tests, same fixture and command) measures the
cluster Overview's name at 1440, 1280, 1024, 900 and 768px, before and after a real
drag on the CPU chart. A zoom widens the header's controls (the picker reads a custom
range and Reset zoom joins it), and they used to take the width out of the name:
"Production (eu-west-1)" read "Production (eu-..." once zoomed. The spec checks the
name is not cut, every control stays inside the hero without covering it, the page
never scrolls sideways, and a name longer than the row still truncates.

### An outdated agent version

`AgentVersionSign.spec.ts` (same fixture and command) opens the cluster Overview with
`?appVersion=14.0.14`, the version the server says it runs (the fixture leaves
`APP_VERSION` unset otherwise, as on a dev build). The cluster's agent reports
`1.9.0`, so its Agent Version on Cluster Details carries the warning sign: the spec
hovers it for "A newer agent is available: 14.0.14", opens the upgrade dialog, reads
the chart's upgrade command, closes it with the keyboard and checks the focus comes
back. Without `?appVersion` the same version reads as plain text. At a phone's width
the dialog fits the screen. The Host Overview's collector reports `0.154.0`, older than
the `0.161.0` the host guide pins, so its Agent Version carries the sign without any
`?appVersion`: the spec opens the host upgrade, checks the four Linux tabs (the fixture
host reports `os.type` linux), the link to the host's setup guide for the config, and
the Docker and Debian commands.

## Explorers: a double-click right after a drag

`ExplorerHistogramDoubleClick.spec.ts` (23 tests, same fixture and command) pins
issue #4116. A drag on the Traces explorer's "Traces over time" or the Logs
explorer's "Log Volume" histogram zooms the explorer, and the histogram then offers
"Double-click to reset". The zoom refetches the histogram, and that answer can land
at any moment of the double-click that follows. When it lands, recharts redraws the
bars (and the band a first click paints over its bar goes, or moves), so the node a
press landed on can leave the page before the press ends, and Chrome then
dispatches no `click` and no `dblclick` for that press. Before the fix:

- data landing during the second press: no `dblclick` reached the chart, and the
  release read as a drag from the pressed bar of the old chart to a bar of the new
  one, so the explorer zoomed into a window nobody asked for (Traces: from the old
  11:26 bar to the zoom's last bar, 11:26 to 11:30) and stayed there;
- data landing during the first press: the same misread release zoomed once more
  before the `dblclick` reset, a third histogram request.

Each explorer opens on "Past 1 Hour" (Traces: 30 two-minute bars; Logs: 60 one-minute
bars). With `histogramGate` in manual mode, a drag across the bars (located from the
drawn bars, one column per bucket) zooms it: Traces from the 11:20 bar to the 11:28
bar, so [11:20, 11:30) in ten one-minute bars; Logs from 11:20 to 11:31, so
[11:20, 11:32) in twelve. The zoom's histogram and facets answers are held. Then a
double-click (the button down about 55 ms, about 90 ms to the second press, the
second press and release with click count 2) with the held answers delivered, and
drawn, at one moment:

| | The zoomed data lands |
|---|---|
| (a) | long before the double-click |
| (b) | after the whole double-click |
| (c) | between the two clicks |
| (d) | during the first press |
| (e) | during the second press |

each on a bar (3px above the plot's bottom) and on empty plot above the bars (3px
below the plot's top), and for (a) also in the chart box's top padding strip, outside
recharts' own area. The spot's column is chosen from the bars as drawn and the bars
about to land (read off the held answer), so it is the same kind of spot on both
charts; the test checks it with the pointer resting there, and again once the zoomed
bars are drawn.

The gesture is timed on the page's own clock: each wait runs in the page, from the
moment the page received the `mousedown` or `mouseup` it follows, so round trips to
the browser do not stretch it. The spec also records its traces without DOM
snapshots or screencast, which Playwright takes on the page's main thread around
every action, between the double-click's events. Still, a busy machine can hold an
event back: a first run of this spec once delivered the second press 422 ms after
the first release, past the histogram's 250 ms single-click wait, and the first
click zoomed into its bar before the `dblclick` came. So when the page receives the
second press 230 ms or more after the first release, that run is not the
double-click the test means, and nothing in it is judged, not even how the held data
landed: the answers to the first click's own zoom may be held too and land with the
drag's (the Logs explorer then drew that click's one bar instead of the zoom's
twelve). The scenario is run again on a fresh page, up to three times in all, and
only then fails, naming each run's timing.

After every double-click the explorer must be back on "Past 1 Hour": the toolbar
picker reads the preset, "Reset zoom" and "Double-click to reset" are gone, the
histogram draws the hour's bars again, and since the drag the histogram asked for
exactly the zoom and then the hour, with no third window then or later. The list's
total follows it: since the drag it was counted exactly for the zoom, then for the
hour, and not again, and the explorer shows the hour's total once more.

The last test does the same on a line chart: the Kubernetes cluster overview's
Availability chart (ChartLibrary's `LineChart`), zoomed by a drag from 11:34 to 11:40
with `aggregateGate` in manual mode, then double-clicked on the line's path while the
zoomed aggregates land during the second press. The pointer rests halfway between
two buckets, where the page reports a `path.recharts-curve`, not the dot recharts
draws at the hovered bucket. Availability is the overview's one full-width chart: the
four below it are 141px wide at the spec's viewport, their buckets under 5px apart,
and that dot covers every spot of their lines.

Every test records the pointer events Chrome delivers (capture-phase listeners that
only read) and, on each `mouseup`, whether the node its press landed on is still in
the page, and puts them in its failure messages:

```
+0ms mousedown(1) on path.recharts-rectangle · +62ms mouseup(1) on path.recharts-rectangle
[pressed node still there] · +77ms click(1) on path.recharts-rectangle · +158ms
mousedown(2) on path.recharts-rectangle · +269ms [data landed: 10 bar columns after 103ms,
pointer over bar] · +278ms mouseup(2) on path.recharts-rectangle [pressed node gone]
```

(the Traces explorer's (e) on a bar, before the fix: no `click(2)`, no `dblclick(2)`).

## Run it

```
cd packages/E2E
npm install
npm run test-chart-time-zoom-ui
```

One spec on its own, never reusing a fixture server from another checkout:

```
CI=1 npx playwright test --config playwright.chart-time-zoom-ui.config.ts ExplorerHistogramDoubleClick
```

Playwright reuses a server already listening on port 4233 outside CI. If one from
another checkout might be running, stop it first or run with `CI=1`. A machine whose
cached Chromium is not the revision this Playwright expects can point
`CHART_TIME_ZOOM_CHROMIUM_PATH` at another build (a local override only).

Screenshots land in `output/playwright/chart-time-zoom-ui/`, named `*-synthetic.png`
because every record in them is fabricated: `<page>-selecting` (the band mid-drag),
`<page>-zoomed` and `<page>-nested`.

## Poke at it by hand

```
cd packages/E2E
node ChartTimeZoom/Fixture/server.js --watch
```

then open
`http://127.0.0.1:4233/dashboard/10000000-0000-4000-8000-000000000001/kubernetes/60000000-0000-4000-8000-000000000001`
(append `/insights` for Insights),
`http://127.0.0.1:4233/dashboard/10000000-0000-4000-8000-000000000001/host/62000000-0000-4000-8000-000000000001`,
`http://127.0.0.1:4233/dashboard/10000000-0000-4000-8000-000000000001/traces` or
`http://127.0.0.1:4233/dashboard/10000000-0000-4000-8000-000000000001/logs`.
Add `?theme=dark` for dark mode, and `?appVersion=14.0.14` to have the server
report a version agents are compared with. `--watch` rebuilds the bundle when a source file
changes; refresh the browser. A browser outside Playwright runs on the real clock,
so its windows are today's; the generated telemetry, spans and logs fill any
window. To hold the explorers' next answers from the console:
`__chartTimeZoomFixture.histogramGate.mode = "manual"`, then
`__chartTimeZoomFixture.histogramGate.deliver()`.
