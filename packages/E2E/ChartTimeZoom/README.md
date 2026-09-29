# Chart time zoom fixture

Real-browser regressions for issue #4105: on every time-series chart, a drag
selects a time slice and that slice becomes the time range of the WHOLE page.
Every chart re-queries and redraws for it, the page's time picker shows the
custom range and a "Reset zoom" button appears beside it. A double-click on ANY
chart, or Reset zoom (mouse or keyboard), puts back the range the page had before
the zoom, and one reset climbs all the way out of nested zooms. Picking a range
in the time picker ends the zoom.

| Page | Route (from `RouteMap`) | Production components |
|---|---|---|
| Kubernetes cluster overview | `KUBERNETES_CLUSTER_VIEW` `/dashboard/:projectId/kubernetes/:id` | `Pages/Kubernetes/View/{Layout,Index}` (golden tiles and charts, activity cards, workloads, top consumers, warnings, cluster details) |
| Kubernetes cluster insights | `KUBERNETES_CLUSTER_VIEW_INSIGHTS` `/dashboard/:projectId/kubernetes/:id/insights` | `Pages/Kubernetes/View/{Layout,Insights}`: three `EmbeddedMetricCard`s (`MetricView` charts, `KubernetesNetworkThroughputChart`) |
| Host overview | `HOST_VIEW` `/dashboard/:projectId/host/:id` | `Pages/Host/View/{Layout,Overview}` |

Each page renders inside its production View layout (`ModelPage`, breadcrumbs,
side menu with its count badges). `Fixture/server.js` bundles them with esbuild
(`Common/UI/esbuild-config.js`), serves them with the same browser Tailwind build,
`tailwind.config` and `Theme.css` production uses, and listens on `127.0.0.1:4233`
(`CHART_TIME_ZOOM_FIXTURE_PORT`). No Docker, no database, no sign-in. Only the
`ModelAPI` / `AnalyticsModelAPI` / `API` data boundary and the signed-in user are
replaced.

The zoom itself comes from the page: each of these pages wraps its content in
`<TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={...}>`
(`Common/UI/Components/Charts/TimeRangeZoom`), with `setTimeRange` on the two
overviews and `handleTimeRangeChange` (which also re-resolves the window the cards
share) on Insights. The fixture adds nothing to the pages: take that wiring away
and these regressions fail.

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
- Empty on purpose: incidents, alerts, scheduled maintenance, monitors, dismissals,
  change events and exemplars (raw `Metric` rows with a trace id).

Any route not listed above renders a "Not modelled" stub (`data-testid="stub-page"`).

## What the fixture records

`window.__chartTimeZoomFixture` holds `dataset` (ids and identifiers), `requests`
and `unhandled`.

Every data request is appended to `requests` in order, as
`{ seq, kind, modelName, ... }`:

| `kind` | Recorded |
|---|---|
| `aggregate` | `metricName`, `attributes`, `aggregationType`, `groupBy`, `groupByAttributeKeys`, `aggregationInterval`, `window` (`startTimestamp` / `endTimestamp`, ISO), `queryTime` (the query's own `InBetween`), `interval` and `rows` (what came back) |
| `getList`, `count`, `analytics.getList`, `analytics.count` | `query`, `select`, `sort`, `limit`, `skip`, and `window` (`{ column, start, end }`) when the query filters a column by an `InBetween` |
| `getItem`, `updateById` | `id`, `select` or `body` |
| `api` | `method`, `url`, `body` |

A table, analytics model, metric name or API URL the fixture does not model is
recorded on `unhandled` too, and the spec fails the test on it.

## What the spec covers

`ChartTimeZoom.spec.ts` runs eight scenarios on each of the three pages (24 tests).
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
2. **A drag released outside the chart still zooms**: the pointer leaves the chart
   downwards before the release.
3. **A double-click on another chart puts the page back on its range** (the initial
   range's queries, label, axes and hints), with no page text selected.
4. **A double-click on a line itself puts the page back on its range**, marked
   `test.fail()`: see "Known product bug" below.
5. **Nested zooms: one double-click climbs all the way out.** A second drag inside
   the first zoom narrows the page again; one double-click on the first chart
   returns to the initial range.
6. **Reset zoom puts the page back on its range** (a click).
7. **Reset zoom works from the keyboard**: Tab from the time picker lands on Reset
   zoom, Enter resets.
8. **Picking a range in the time picker ends the zoom**: Reset zoom goes away, every
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

### Known product bug: a double-click on a line never resets

Scenario 4 double-clicks a point of a ChartLibrary line chart's line (the overviews'
and Insights' Network charts) and is marked `test.fail()`, because today it leaves
the page zoomed. A press re-renders the chart (`useChartRangeSelection` sets React
state on `mousedown`), recharts 3 then remounts the line's path and dots (they are
keyed by an id that changes with the line's points), the pressed node is gone by
`mouseup`, and Chrome dispatches no `click` and no `dblclick`. The line chart's
transparent 12px click-target lines and their default dots cover every line and
data point, so this is any double-click on or near a line. Once a press no longer
re-renders the chart, this scenario passes and Playwright reports it as an
unexpected pass: remove the `test.fail()`.

### Pointer timing

recharts 3 hands a chart's `mousedown` and `mouseup` handlers the bucket its
`mousemove` handler last recorded, and it runs that handler on the next animation
frame. A person's pointer rests on a bucket for longer than a frame before pressing
or releasing, so the spec lets two frames pass before every press and release
(`settle()`). A press or release inside the same frame as the pointer's last move is
not covered here.

## Run it

```
cd packages/E2E
npm install
npm run test-chart-time-zoom-ui
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
(append `/insights` for Insights), or
`http://127.0.0.1:4233/dashboard/10000000-0000-4000-8000-000000000001/host/62000000-0000-4000-8000-000000000001`.
Add `?theme=dark` for dark mode. `--watch` rebuilds the bundle when a source file
changes; refresh the browser. A browser outside Playwright runs on the real clock,
so its windows are today's; the generated telemetry fills any window.
