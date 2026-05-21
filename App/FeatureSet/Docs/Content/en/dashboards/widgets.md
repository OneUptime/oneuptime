# Widgets

A widget is one tile on a dashboard. This page lists every widget you can add, what it shows, and when to reach for it.

For how to drag widgets around the canvas, see [Authoring a Dashboard](/docs/dashboards/authoring).

## Charts and numbers

### Chart

A line, bar, or area chart of one or more metric series over the dashboard's time range.

**Settings**:

- One or more metric queries.
- An optional formula that combines two queries (for example, `errors / total * 100` to get an error rate).
- A "show as rate" option for cumulative counters that grow without resetting.
- Display options: stacked or overlaid, Y-axis unit, legend position, chart type.

Use it when: trends matter. Latency over time, error count, queue depth, anything where the shape of the line tells the story.

### Value

A single big number with optional colored thresholds.

**Settings**:

- A metric query that gives back one number (last value, average, or max over the time range).
- An optional **warning** threshold (yellow above).
- An optional **critical** threshold (red above).
- Number format and unit.

Use it when: one number answers the question. Current error rate, P95 latency right now, count of open incidents.

### Gauge

A circular gauge with a minimum, maximum, warning band, and critical band.

**Settings**: a metric query and the four boundaries.

Use it when: the value fits inside a known range. CPU percentage (0–100%), disk usage, queue capacity.

### Table

A table of metric results, one row per group.

**Settings**: a metric query (typically grouped by a label like host or service), the columns to show, and a row limit.

Use it when: you want a breakdown instead of a trend. Top 10 noisiest hosts, error count per service, requests per endpoint.

## Text

A static block of Markdown.

**Settings**: the Markdown body. Headings, lists, links, emphasis, and code blocks all render.

Use it when: you want a section heading, a paragraph of context, a list of links to runbooks, or a temporary banner during an incident.

## Logs and traces

### Log Stream

A live tail of log lines matching a filter.

**Settings**: log filters (service, severity, attributes) and the columns to show.

Use it when: you want to see what the application is saying right now, without leaving the dashboard.

### Trace List

A list of recent traces matching a filter, with duration, status, and service.

**Settings**: trace filters (service, status, attributes).

Use it when: you want a list of recent activity rather than a chart. A common pattern is a latency chart at the top with a list of slow traces below.

## Live lists

### Incident List

A live list of incidents matching a filter.

**Settings**: filters by state, severity, labels, monitor, or team.

Use it when: the dashboard answers "what's broken right now?"

### Alert List

A live list of alerts matching a filter.

**Settings**: filters by state, severity, labels.

Use it when: a team dashboard tracks alerts on its services.

### Monitor List

A live list of monitors and their current status.

**Settings**: filters by monitor type, labels, or current state.

Use it when: you want a fleet view — "are all the sites up?"

## Kubernetes resource lists

For projects with a [Kubernetes Agent](/docs/monitor/kubernetes-agent) installed. Each one takes optional filters for cluster, namespace, and labels.

- **Kubernetes Pod List** — pods with their phase, restarts, and node.
- **Kubernetes Node List** — nodes with their conditions and capacity.
- **Kubernetes Namespace List** — namespaces and workload counts.
- **Kubernetes Deployment List** — deployments with desired vs. ready replicas.
- **Kubernetes StatefulSet List** — stateful sets with ready replicas.
- **Kubernetes DaemonSet List** — daemon sets with desired vs. ready.
- **Kubernetes Job List** — jobs and their completion status.
- **Kubernetes CronJob List** — cron jobs with schedule and last run.

Use these when: you want a single dashboard mixing Kubernetes state with telemetry from those workloads.

## Docker resource lists

For projects with Docker monitoring set up.

- **Docker Host List** — hosts running Docker, with container counts.
- **Docker Container List** — containers with state, image, host, uptime.
- **Docker Image List** — images and their sizes.
- **Docker Network List** — Docker networks and connected containers.
- **Docker Volume List** — Docker volumes and their usage.

## Infrastructure

### Host List

Hosts monitored by OneUptime's server monitor, with status, CPU, memory, and uptime.

**Settings**: filters by labels or current state.

## Which widget should I use?

A few quick rules:

- **Trend over time?** Chart.
- **One number that matters right now?** Value (or Gauge if it has a clear min/max).
- **Breakdown across many things?** Table.
- **What's happening in the system right now?** Log Stream, Trace List, Incident List.
- **The state of a specific group of resources?** The matching list widget.
- **A heading, a paragraph, or a link?** Text.

Most dashboards mix a few — a chart at the top, a value or two beside it, a text divider, and a list or two below.

## Where to read next

- [Variables & Filters](/docs/dashboards/variables) — making widgets reusable for many services or customers.
- [Authoring a Dashboard](/docs/dashboards/authoring) — the canvas mechanics.
- [Sharing & Public Dashboards](/docs/dashboards/sharing) — sharing outside your team.
