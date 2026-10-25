# Metrics Explorer

Metrics are the numbers your services and infrastructure report over time: request counts, latencies, CPU, queue depth. The Metrics explorer lists every metric your project receives, charts any of them, combines them with formulas, and turns a chart into a monitor or a dashboard widget.

:::cards
- [Find a metric](#find-a-metric): Search the list of metric names.
- [Chart a metric](#chart-a-metric): Aggregate, filter and group a query.
- [Combine queries with a formula](#combine-queries-with-a-formula): Error rates and other ratios.
- [Use what you charted](#use-what-you-charted): A monitor, a dashboard widget or a link.
- [Improve metrics and add missing ones with AI](#improve-metrics-and-add-missing-ones-with-ai): Pull requests that fix your metrics, and add the ones a service lacks.
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

The explorer has five tabs:

| Tab | What it is for |
| --- | --- |
| **Viewer** | The list of metrics, each with a small chart and its latest value. It opens on the past hour. |
| **Insights** | Which services report metrics, and how many. |
| **AI** | The problems OneUptime finds in your metrics (too many values, histogram buckets that do not fit, missing metrics), and what OneUptime AI did about them. See [Improve metrics and add missing ones with AI](#improve-metrics-and-add-missing-ones-with-ai). |
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

## Improve metrics and add missing ones with AI

Every hour OneUptime looks through the metrics your services sent in the last hour for ones that record too many values, histograms whose buckets do not fit, and busy services that send no metrics. It files what it finds as AI insights, with the evidence. OneUptime AI then looks into each one and opens a pull request to fix it. Nothing is ever merged: your team reviews each pull request.

OneUptime reads closely the 10 metrics your services sent the most data points for in the hour, each with at least 1,000 of them, and files three kinds of finding:

| Finding | When OneUptime files it | The pull request |
| --- | --- | --- |
| **High Cardinality** | An attribute the code sets on one of those metrics took 1,000 or more values in the hour, such as user IDs or full URLs, so every value is a series of its own. Or 50 or more of a service's metric names are one name with a different ID in it. | Stops recording the value on the metric, or takes the IDs out of its names. |
| **Wrong Histogram Buckets** | One of those metrics is a histogram that recorded 1,000 or more values, and 90% or more of them fell in its smallest bucket or above its largest one, or it has no buckets, so its percentiles cannot be told apart. | Gives the histogram buckets that fit its values, or fixes its unit. |
| **Missing Metrics** | A service sent 1,000 or more spans in the hour and has never sent a metric. | Adds the request count, errors and duration of its busiest operations as metrics. |

A finding never stores an attribute's values: only the attribute's name, how many values it took and what they look like.

### Turn it on

**Metrics → AI → Settings** holds the switch **Improve metrics and add missing ones**, on for new projects. With **Enable AI** off, problems in your metrics are still found, but OneUptime AI does nothing with them. To open pull requests, OneUptime AI needs a repository connected in [Code](/docs/ai/ai-agent): the page says what is missing first. Each repository's code is changed on the Runner the repository picks in Code.

OneUptime AI opens at most 5 pull requests on its own each day (UTC), one for each finding, and never more than a repository's limit on open AI pull requests.

### AI rules

With no rule, OneUptime AI looks into every problem it finds in your metrics right away, and opens a pull request for each one it can fix. The **AI rules** under **More settings** narrow that, in three steps:

| Step | What it decides |
| --- | --- |
| **Match** | Which services: the ones picked, the ones with certain labels, or the ones whose names match a pattern. |
| **Investigate** | **Right away**, or **Only if still found after a wait**: a problem that goes away during the wait is not looked into. |
| **Fix** | **Don't fix**, **Ask before fixing** or **Fix without asking**. Asking first leaves the pull request to a person: the finding offers **Fix with AI**. |

Under **More fields** a rule picks the code repositories, the MCP servers and the LLM provider OneUptime AI may use for it. With none picked, it may use any of them, and the project's default LLM provider.

### See what it did

- **Metrics → AI → Insights** lists what OneUptime found, each finding with its evidence and **Open in Metrics**, which opens its metric for its service, from the hour it was found in. A service with no metrics offers **Open in Traces** instead: the spans its metrics would measure.
- **Metrics → AI → Logs** lists every investigation and pull request, newest first, with how each one stands and what each investigation found.
- In Code, the task says OneUptime started it, with a link to its finding, and the pull request says why it was opened.

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
