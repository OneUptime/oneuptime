# Metrics Explorer

Metrics are the numbers your services and infrastructure report over time: request counts, latencies, CPU, queue depth. The Metrics explorer lists every metric your project receives, charts any of them, combines them with formulas, and turns a chart into a monitor or a dashboard widget.

:::cards
- [Find a metric](#find-a-metric): Search the list of metric names.
- [Chart a metric](#chart-a-metric): Aggregate, filter and group a query.
- [Combine queries with a formula](#combine-queries-with-a-formula): Error rates and other ratios.
- [Use what you charted](#use-what-you-charted): A monitor, a dashboard widget or a link.
:::

## How the explorer works

The explorer has two levels. The **Viewer** tab lists the metrics your project receives. Click one, and the metric explorer opens with a query for it: a metric, how to aggregate it, and how to filter and group it. Each query is a variable, `a`, `b` and so on, that a formula can use.

```mermaid title="From metric queries to a chart, a monitor or a dashboard"
flowchart TB
    a["Query a: requests,<br/>aggregated by Sum"] --> f["Formula:<br/>$b / $a * 100"]
    b["Query b: errors,<br/>aggregated by Sum"] --> f
    f --> chart["Chart: error rate<br/>in percent"]
    chart --> monitor["A metrics monitor"]
    chart --> dash["A dashboard widget"]
```

The explorer has four tabs:

| Tab | What it is for |
| --- | --- |
| **Viewer** | The list of metrics, each with a small chart and its latest value. It opens on the past hour. |
| **Insights** | Which services report metrics, and how many. |
| **Setup Guide** | How to send metrics with OpenTelemetry, using one of your ingestion keys. |
| **Settings** | **Pipeline Rules** and **Recording Rules**: what happens to metrics as they arrive. |

## Before you begin

- **Metrics arriving.** Send them with [OpenTelemetry](/docs/telemetry/open-telemetry), or from an agent such as the [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector) or the [Kubernetes Agent](/docs/telemetry/kubernetes-agent).
- **A role that reads telemetry.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member or Telemetry Viewer, or a custom role with the Read Telemetry Service Metrics permission. See [Telemetry](/docs/permissions/index#telemetry) for which metrics it reads.

## Find a metric

Go to **Products → Observability → Metrics**. The **Viewer** lists every metric your project has received, by name, each with a small chart of the time range and its latest value.

- Search names with bare words or `name:`, for example `name:http.server` finds `http.server.request.duration`. See [Search Syntax](/docs/telemetry/search-syntax#metrics).
- Filter by **Service** in the sidebar to see only the metrics one service reports.
- Click a metric to chart it in the metric explorer.

## Chart a metric

:::steps
### Open the metric

Click the metric in the **Viewer**. The explorer opens with one query, `a`, for the list's time range and filters.

### Choose how to aggregate it

Under **Aggregate by**, pick how the values in each point of the chart are combined: Avg, which is the default, Sum, Min, Max, Count, or a percentile, P50, P75, P90, P95 or P99. A percentile of a histogram metric, such as a request duration, is worked out from its buckets.

### Filter and group it

Open **Filters & grouping**. **Filter by attributes** keeps the data points whose attributes match, such as one `http.route`, and **Group by** draws one line per value of the attributes you pick, such as one line per host.

### Adjust the chart

Open **Display Settings** to pick the **Chart type** (Line, Area or Bar), set a **Warning Threshold** and a **Critical Threshold** to draw on the chart, or turn on **Convert to per-second rate**.
:::

> [!TIP]
> A counter that only ever goes up, such as `system.disk.io`, reads best as a rate. Turn on **Convert to per-second rate** to plot how fast it changes instead of its running total; the explorer suggests it when it sees such a counter.

Each query draws its own chart. To draw a query on the same chart as the one before it, turn on **Overlay with previous query** in its **Display Settings**.

## Combine queries with a formula

:::steps
### Add the queries

Click **Add Metric** for each metric you need. The new queries are `b`, `c` and so on.

### Add a formula

Click **Add Formula** and write the **Formula** with the queries' variables, the operators `+`, `-`, `*`, `/`, `%` and `^`, and parentheses. For an error rate in percent, write `$b / $a * 100`.
:::

A variable can be written with or without its `$`, in any case. A formula that names a query you have not defined says so instead of drawing.

## Explore around a chart

The buttons above the charts work on the time range you are looking at:

| Button | What it does |
| --- | --- |
| **Logs** | Opens the [Logs Explorer](/docs/telemetry/logs-explorer) for this time range and your filters. |
| **Traces** | Opens the [Traces Explorer](/docs/telemetry/traces-explorer) for this time range and your filters. |
| **Investigate** | Opens a side panel with the logs, traces and exceptions of this time range. |
| **Events** | Marks the incidents and alerts of this time range on the charts. |
| **Compare** | Draws the previous period on each chart as a dashed line, so you can see what changed. |

Drag across a chart to zoom into a moment, and double-click to zoom back out: see [Zooming Into a Time Range](/docs/telemetry/charts-and-time-ranges).

## Use what you charted

- **Actions → Create monitor from this view** opens a new metrics monitor with these queries and formulas filled in. See [Metrics Monitor](/docs/monitor/metrics-monitor).
- **Actions → Add to dashboard** adds the chart to a dashboard you pick. You need permission to edit that dashboard.
- **Copy Link** copies a link to exactly this view: queries, formulas and time range.
- **Saved Views** keeps the view under a name for everyone in the project. The **Viewer** has saved views of its own, for its search and filters. Saved views work as they do in the [Logs Explorer](/docs/telemetry/logs-explorer#save-a-view).

## Metrics Insights

The **Insights** tab counts the metrics in a time range: **Active metrics**, **Reporting services** and the average per service. It groups the metrics into categories, and lists the services that report them.

## What happens to metrics as they arrive

**Metrics → Settings → Pipeline Rules** changes metrics as they arrive, before they are stored. Rules run in the order of the list, which you change by dragging; a rule for one service runs before the rules for every service.

| Rule type | What it does |
| --- | --- |
| Filter (allowlist) | Keeps only the data points that match, and drops the rest. |
| Drop | Drops the data points that match. |
| Rename Metric | Renames the metric. |
| Rename Attribute | Renames an attribute's key on matching data points. |
| Add Attribute | Adds an attribute to matching data points. |
| Remove Attribute | Removes an attribute, such as one with too many values to be useful. |
| Redact Attribute | Replaces an attribute's value with a placeholder. |
| Sample | Keeps a percentage of matching data points. |

**Metrics → Settings → Recording Rules** works out new metrics from other metrics, every minute. See [Log Recording Rules](/docs/telemetry/log-recording-rules) for how recording rules work.

## Troubleshooting

:::details A counter's chart only ever goes up
It is a cumulative counter. Turn on **Convert to per-second rate** in the query's **Display Settings**.
:::

:::details The list says no metrics were found
Clear your search and filter chips first. If the list is still empty, no metrics have reached OneUptime yet: compare your setup with the **Setup Guide**.
:::

:::details A service's metrics are missing
Filter the **Viewer** by that **Service** and widen the time range. If they are still missing, your role's scope may leave that service out: see [Telemetry](/docs/permissions/index#telemetry).
:::

## Next steps

:::cards
- [Metrics Monitor](/docs/monitor/metrics-monitor): Get alerted when a metric crosses a threshold.
- [Authoring a Dashboard](/docs/dashboards/authoring): Put your charts side by side.
- [Search Syntax](/docs/telemetry/search-syntax): Every filter the search box understands.
:::
