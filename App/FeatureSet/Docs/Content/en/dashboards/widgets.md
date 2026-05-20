# Widgets

A widget is one tile on a dashboard. Each widget has a type (chart, value, list, …), a position, a size, and a configuration. This page is the catalog — what each widget shows, what it takes as input, when to reach for it.

For canvas mechanics, see [Authoring a Dashboard](/docs/dashboards/authoring).

## Time-series widgets

### Chart

A line / bar / area chart of one or more metric series over the dashboard's time range.

**Configure**:

- One or more metric queries (`metricQueryConfig` for a single series, `metricQueryConfigs` for multiple).
- Optional **formula** combining multiple queries (e.g., `errors / total * 100`).
- Optional **transformAsRate** for OpenTelemetry cumulative counters (e.g., `system.disk.io`) — the widget computes `(value - previousValue) / Δt` per bucket.
- Display: stacked vs. overlaid series, Y-axis unit, legend on/off, chart type.

Reach for it when: trends matter. Request latency, error count over time, queue depth, anything where the shape of the curve tells you something.

### Value

A single big number with optional thresholds and an optional sparkline.

**Configure**:

- A metric query (single value — usually `last`, `avg`, or `max` over the time range).
- Optional **warning threshold** (yellow above).
- Optional **critical threshold** (red above).
- Display: number format, unit suffix.

Reach for it when: a single number answers the question. Current error rate, P95 latency right now, open incident count.

### Gauge

A circular gauge with a min, max, warning band, and critical band.

**Configure**: the metric query and the four bounds (min, max, warning, critical).

Reach for it when: the value sits inside a known range. CPU utilization (0–100%), disk fill, queue capacity.

### Table

A tabular display of metric query results, one row per group.

**Configure**: the metric query (typically grouped by a label such as `host.name` or `service.name`), the columns to show, and a row limit.

Reach for it when: you want the breakdown rather than the trend. Top 10 noisiest hosts, error count per service, request rate per endpoint.

## Annotation widget

### Text

A static block of Markdown.

**Configure**: the Markdown body. Headings, lists, links, emphasis, code spans, fenced code blocks all render.

Reach for it when: you want a section header, a paragraph of context ("this dashboard covers the checkout service"), a list of links to runbooks or related dashboards, or a temporary banner during an incident.

## Logs & traces

### LogStream

A live tail of log lines matching a filter.

**Configure**: log filters (service, severity, attribute matches), the columns to show.

Reach for it when: you want to see what the application is saying *right now* on a dashboard, without leaving the page to open the logs explorer.

### TraceList

A list of recent traces matching a filter, with duration, status, and the service name.

**Configure**: trace filters (service, status, attribute matches).

Reach for it when: you want a paginated view of recent activity rather than a chart. Common pairing: a latency Chart at the top, a TraceList of slow traces below.

## Operational lists

### IncidentList

A live list of incidents matching a filter.

**Configure**: filters by state, severity, labels, monitor, or assigned team.

Reach for it when: a dashboard is meant to answer "what's currently broken?"

### AlertList

A live list of alerts matching a filter.

**Configure**: filters by state, severity, labels.

Reach for it when: dashboards for alert-driven workflows (e.g., dev-team dashboards that watch their service's alerts).

### MonitorList

A live list of monitors matching a filter, showing each monitor's current status.

**Configure**: filters by monitor type, labels, or current state.

Reach for it when: you want a fleet-level "are all the websites up?" view, or a per-team list of monitored endpoints.

## Kubernetes resource lists

For projects with a [Kubernetes Agent](/docs/monitor/kubernetes-agent) installed, the following live-resource widgets are available. Each one takes optional filters for `cluster`, `namespace`, and labels.

- **KubernetesPodList** — pods with phase, restarts, and node assignment.
- **KubernetesNodeList** — nodes with conditions, capacity, and allocations.
- **KubernetesNamespaceList** — namespaces and their workload counts.
- **KubernetesDeploymentList** — deployments with desired vs. ready replicas.
- **KubernetesStatefulSetList** — stateful sets with ready replicas.
- **KubernetesDaemonSetList** — daemon sets with desired vs. ready.
- **KubernetesJobList** — jobs with completion status.
- **KubernetesCronJobList** — cron jobs with schedule and last run.

Reach for these when: you want a single dashboard that mixes Kubernetes resource state with telemetry from those workloads.

## Docker resource lists

For projects with a Docker monitor installed:

- **DockerHostList** — hosts running Docker, with container counts.
- **DockerContainerList** — containers with state, image, host, uptime.
- **DockerImageList** — images and their sizes.
- **DockerNetworkList** — Docker networks and connected container counts.
- **DockerVolumeList** — Docker volumes and their usage.

## Infrastructure

### HostList

Hosts monitored by OneUptime's server monitor — with current status, CPU, memory, and uptime.

**Configure**: filters by labels or current health state.

## Picking the right widget

Some quick rules of thumb:

- **Trend over time?** Chart.
- **One number that matters right now?** Value (or Gauge if it has a natural range).
- **Breakdown across many things?** Table.
- **What's happening in the system right now?** LogStream, TraceList, IncidentList.
- **State of a specific resource fleet?** The matching resource-list widget.
- **A heading, a paragraph, or a link?** Text.

Most dashboards use a mix — a Chart at the top, a Value or two beside it, a Text divider, then one or two lists below.

## Where to read next

- [Variables & Filters](/docs/dashboards/variables) — making widgets reusable across services / customers / clusters.
- [Authoring a Dashboard](/docs/dashboards/authoring) — the canvas, grid, and edit mode.
- [Sharing & Public Dashboards](/docs/dashboards/sharing) — exposing a dashboard outside the team.
