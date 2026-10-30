# Metrics Monitor

A Metrics monitor queries the metrics your applications and infrastructure send to OneUptime, combines them with formulas when you need a ratio or a total, and checks the result over a rolling time range against your criteria. Use it for request rates, error ratios, queue depths, CPU, memory and disk — any numeric series — with one alert per host or container when you group it.

:::cards
- [Create the monitor](#create-a-metrics-monitor): Queries, formulas, a time range and criteria.
- [How it is evaluated](#how-it-is-evaluated): Data points, formulas and the criteria's aggregation.
- [Worked example](#worked-example-a-growing-queue): The same data under each aggregation.
- [Per-series alerting](#per-series-alerting-group-by): One alert per host, container or mountpoint.
:::

## How it works

```mermaid title="From metric queries to a status, every minute"
flowchart TB
    Src["Applications and hosts"] -->|OpenTelemetry| Store[("Metrics in OneUptime")]
    Store --> Query["Queries a, b<br/>one data point per bucket"]
    Query --> Formula["Formulas, such as a / b * 100"]
    Formula --> Reduce["Criteria aggregation<br/>Average, Maximum, Any Value"]
    Reduce --> Check{"Condition met?"}
    Check -->|Yes| Act["Change status,<br/>alert or incident"]
```

Every minute, OneUptime runs each of the monitor's metric queries over its time range. A query returns one data point per time bucket, and formulas combine the queries bucket by bucket. Each criteria then reduces the data points of the query or formula it checks — to their average, their maximum, or a test of every point — and compares the result with its threshold.

## Before you begin

- Your applications or infrastructure send metrics to OneUptime over OpenTelemetry. See [OpenTelemetry](/docs/telemetry/open-telemetry).
- Know the metric's name and the attributes you want to filter or group on. The **Metric** and **Group by** lists only offer names and attributes OneUptime has received.

## Create a metrics monitor

:::steps
### Start a new monitor

Go to **Monitors** and click **Create Monitor**. Or, in the metrics explorer, build the chart you want to watch and click **Create monitor from this view**: the new monitor starts out with its queries.

### Choose Metrics

Under **Monitor Type**, click **More monitor types** and pick **Metrics** under **Telemetry**, or type `metrics` in the search box. Enter a **Name**, then click **Next**.

### Add the metric queries

In **Metric to watch**, pick a **Metric** and how to **Aggregate by** it. Open **Filters & grouping** to filter by attributes or to **Group by** one. Click **Add Metric** for another query, or **Add Formula** to combine them. The chart under the queries shows the last hours, with the rule's value as a red line, so you can see the values the rule will check.

### Say when to alert

In **When to alert**, pick how the metric is **Measured as**, a **Time window**, a **Condition** and a **Value**. When the step has more than one query or formula, pick the **Metric** the rule reads too. The sentence under them says the rule back in plain words.

### Choose what happens

In **What happens**, pick **Create an alert**, **Declare an incident** or **Both**, and give it a title and a severity. While the rule matches, the monitor shows the status under **More fields**; when it stops matching, the monitor goes back to its default status and the alert or incident resolves itself.

### Create the monitor

Click **Create Monitor**. The monitor opens on its **Overview** page, and its first evaluation runs within a minute.
:::

## What it queries

### Metric queries

| Field | What it does | Default |
| --- | --- | --- |
| **Metric** | The metric to query. | Required |
| **Aggregate by** | How the values in each time bucket are combined into one data point: Avg, Sum, Min, Max, Count, or a percentile — P50, P75, P90, P95 or P99. | Avg |
| **Filter by attributes** (under **Filters & grouping**) | Only series whose attributes match these conditions. | No filter |
| **Group by** (under **Filters & grouping**) | One series per unique value of these attributes — see [Per-Series Alerting](#per-series-alerting-group-by). | One series |

Each query and formula gets a variable — `a`, `b`, `c` and so on — in the order you add them.

### Formulas

A formula combines query variables with `+`, `-`, `*`, `/`, `%`, `^` and parentheses, bucket by bucket. You can write the variables with or without a leading `$`:

- `a / b * 100` — the share of `b` that `a` is, as a percentage
- `a + b` — two metrics added together
- `a - b` — the difference between them

### Rolling Time Window

The **Time window** in **When to alert** sets how far back every evaluation looks: **Last 1 minute**, **Last 5 minutes**, **Last 10 minutes**, **Last 15 minutes**, **Last 30 minutes**, **Last 1 hour**, **Last 2 hours**, **Last 3 hours**, **Last 6 hours**, **Last 12 hours**, **Last 24 hours**, **Last 2 days**, **Last 3 days**, **Last 7 days**, **Last 14 days**, **Last 30 days**, **Last 60 days**, **Last 90 days**, **Last 180 days** or **Last 365 days**.

The longer the window, the wider each time bucket, so one data point stands for more time:

| Time window | One data point per |
| --- | --- |
| Last 1 minute to Last 3 hours | minute |
| Last 6 hours, Last 12 hours | 5 minutes |
| Last 24 hours | 15 minutes |
| Last 2 days, Last 3 days | 30 minutes |
| Last 7 days | hour |
| Last 14 days, Last 30 days | day |
| Last 60 days to Last 180 days | week |
| Last 365 days | month |

## How it is evaluated

- **Every minute.** A Metrics monitor is not checked by probes, so it has no interval to set and no **Probes & Interval** page.
- **Queries, then formulas.** Each query returns one data point per time bucket of the time range, using its **Aggregate by**. Formulas are worked out for each bucket from the queries' data points.
- **Then the rule's measure.** The rule reduces the data points of its metric to what it compares with its value, as **Measured as** says:

| Measured as | In the custom criteria | The condition is checked against… |
| --- | --- | --- |
| The average | Average | the average of the data points |
| The sum | Sum | the sum of the data points |
| The highest value | Maximum Value | the highest data point |
| The lowest value | Minimum Value | the lowest data point |
| Every value (the whole window) | All Values | every data point: all of them must meet the condition, and they must cover the whole time range |
| Any value (at any point) | Any Value | every data point: one of them meeting the condition is enough |

- **Criteria from top to bottom.** On a monitor without Group By, the first criteria that matches decides, so put the most severe one first. A grouped monitor checks every criteria for every series — see [Criteria evaluation differs](#criteria-evaluation-differs).
- **No data is not zero.** When the query returns no data points in the time range, the rule does what **If there is no data** says, under **More fields** in **When to alert**: **Nothing** (the default — the rule does not match), **Count it as zero**, or **Alert, as if it matched**.
- **Every value needs the whole time range.** A series meets a rule measured as **Every value (the whole window)** only once its data points cover the time range, from its start to now, with no gap of more than one missing data point. When all of the monitor's data arrives late, as CloudWatch's does, its newest data point takes the place of now. A host, container or deployment that only just started reporting, or that went quiet for a while, waits until it has a whole time range of data, and the evaluation log says how far it has got: `Waiting for 15 minutes of data: 2 of 15 minutes so far`. A series whose alert or incident is already open is judged on its data points alone, so a short gap in its data does not resolve it. When the metric reports less often than the time range is long, a lone data point counts for the whole range once it is a few minutes old; to judge how long a value lasts, make the time range at least two reporting intervals long.
- **OneUptime's own downtime is not silence.** While the time range holds time OneUptime itself was not receiving data — it was restarting, being upgraded or catching up — the check waits: the status does not change, and no incident or alert is opened or resolved, whatever **If there is no data** says. See [When OneUptime Is Not Receiving Data](/docs/monitor/when-oneuptime-is-not-receiving).

## Criteria

These monitors always evaluate the **Metric Value** — the aggregated value of the configured metric query or formula. **When to alert** sets up one criteria from **Measured as**, **Time window**, **Condition** and **Value**. When the metric has a unit, pick the value's unit next to it. Its **Condition** reads **Above**, **At or above**, **Below**, **At or below**, **Exactly**, **Unusually high**, **Unusually low** or **Unusually high or low**. For several criteria, such as severity bands, click **Edit as custom criteria** under **More fields** in **What happens**: each criteria there has a **Metric**, an **Aggregation**, a **Condition** and a **Threshold**.

| Condition | Matches when the value is… |
| --- | --- |
| **Greater Than** | above the threshold |
| **Greater Than Or Equal To** | the threshold or above |
| **Less Than** | below the threshold |
| **Less Than Or Equal To** | the threshold or below |
| **Equal To** | exactly the threshold |
| **Anomalously High** | above the range expected for this hour of the week |
| **Anomalously Low** | below that range |
| **Anomalous** | outside that range, either way |
| **Has No Data** | missing: the query sent nothing in the window |
| **Has Data** | present: the query sent something in the window |

The anomaly conditions have no threshold. **When to alert** shows **Sensitivity** — Low, Medium (the default) or High — instead, and the custom criteria a **Baseline Window** too — 14 days (the default), 28, 60 or 90 — and each data point is compared with the same-hour-of-week baseline built from that window. Until that hour of the week has enough history, the criteria is still learning and produces no alerts.

A Metrics monitor made in Create Monitor starts on one rule, on its first query: **The average** over **Last 5 minutes**, **Above** the **Value** you enter, and **Create an alert**.

A new Metrics monitor created through the API or Terraform without criteria starts with two criteria on its first query, both with the **Any Value** aggregation:

| Criteria | Condition | Effect |
| --- | --- | --- |
| Check if … is offline | **Equal To** `0` | Marks the monitor offline and declares an incident, resolved automatically |
| Check if … is online | **Greater Than** `0` | Marks the monitor online |

> [!NOTE]
> The offline criteria fires on a reported value of 0, not on silence. To alert when a metric stops arriving, set its **If No Data** to **Trigger**.

## Worked example: a growing queue

You want an incident when the checkout queue stays deep. Query `a` is the gauge `checkout.queue.depth`, with **Aggregate by** Max, and the **Time window** is **Last 5 minutes**. One evaluation sees these five one-minute data points:

| Minute | 10:01 | 10:02 | 10:03 | 10:04 | 10:05 |
| --- | --- | --- | --- | --- | --- |
| `a` | 640 | 980 | 1,500 | 1,620 | 1,100 |

A rule **Above** `1000` gives a different answer for each way it is **Measured as**:

| Measured as | Compared with 1,000 | Matches? |
| --- | --- | --- |
| The average | 1,168 | Yes |
| The sum | 5,840 | Yes |
| The highest value | 1,620 | Yes |
| The lowest value | 640 | No |
| Every value (the whole window) | 640, 980, 1,500, 1,620, 1,100 | No — two points are not above 1,000 |
| Any value (at any point) | 640, 980, 1,500, 1,620, 1,100 | Yes — 1,500 is |

**The average** pages on a sustained backlog and ignores one deep minute; **Every value (the whole window)** waits until every minute in the range is deep; **Any value (at any point)** pages on the first deep minute.

## Per-Series Alerting (Group By)

**Group by** on a metric query splits that query into one series per unique attribute value — one per host, one per container, one per mountpoint — and a monitor with Group By set evaluates every series independently. That single setting is the difference between "the fleet is unhealthy" and "`prod-db-01` is unhealthy".

### One alert per group

With Group By set to `host.name`, a disk-usage monitor watching fifty hosts raises **one alert (or incident) per breaching host**. Host A filling up opens its own alert; host B filling up ten minutes later opens a second, separate alert alongside it.

Without Group By, the same monitor is a single scalar: the query collapses every host into one number and the monitor raises **one alert for the whole monitor**. While that alert is open, a second host breaching produces nothing — the monitor is already alerting, so there is nothing new to raise, and the on-call engineer never learns about host B. **Setting Group By is how you get per-host alerts.** If you want to be paged per host, per container, or per mountpoint, set it.

### Independent resolution

Each per-group alert tracks its own group. When host A drops back under the threshold its alert resolves on its own, and host B's alert stays open until host B recovers. One group recovering never closes another group's alert.

### Criteria evaluation differs

- **Grouped monitors evaluate every criteria.** Severity bands can therefore fire on different groups at the same time: with "Critical — greater than 95" above "Warning — greater than 80", a host at 96% opens a critical alert while a host at 85% opens a warning alert on the same check. A host that breaches both bands still gets exactly one alert — from the first matching criteria, so **order the criteria most severe first**.
- **Ungrouped monitors stop at the first matching criteria.** Only that one criteria fires, which is another reason to put the alerting criteria above the healthy one: a broad healthy criteria placed first matches on nearly every check and prevents the alerting criteria below it from ever being evaluated.

| Host | Disk used | Critical (> 95) | Warning (> 80) | Alert raised |
| --- | --- | --- | --- | --- |
| `prod-db-01` | 96% | Yes | Yes | Critical |
| `prod-db-02` | 85% | No | Yes | Warning |
| `prod-db-03` | 40% | No | No | None |

### Choosing an attribute to group by

Group by an attribute that genuinely identifies a distinct thing you would page someone about: the host attribute for a fleet-wide host metric, the container or pod attribute for a container metric, the mountpoint or device attribute for a filesystem or disk-I/O metric, the interface attribute for a network metric. The **Group by** dropdown is populated from the attributes your collector actually sends, so pick from the list rather than typing a key by hand.

Do not group a metric that is already a single scalar for the whole system — a cluster-wide leader flag, a scheduler backlog, or a single host's CPU on a single-host monitor. Grouping those produces exactly one series and changes nothing except the alert titles.

The grouping attribute values are also available as [template variables](/docs/monitor/incident-alert-templating) in the alert or incident title, description, and remediation notes — grouping by `host.name` lets the title read `Disk almost full on {{host.name}}`.

## Troubleshooting

:::details The chart shows a breach, but the monitor did not alert
Check **Measured as** first: **Every value (the whole window)** only matches when every data point in the time range breaches, and **The average** smooths out a short spike. **Every value (the whole window)** also waits until a series has data for the whole time range, so a host or deployment that only just started reporting is not judged yet. Then check that the rule reads the query or formula you mean (`a` is not the formula `c`), and that the **Value** is in the unit you think.
:::

:::details The metric stopped arriving and nothing happened
A time range with no data points is not a value of 0. With **If there is no data** at its default, **Nothing**, the rule does not match. Set it to **Alert, as if it matched** under **More fields** in **When to alert** to alert on silence.
:::

:::details I get one alert for the whole fleet
The query has no **Group by**, so every host is collapsed into one number. Group the query by the host, container or mountpoint attribute — see [Per-Series Alerting](#per-series-alerting-group-by).
:::

:::details An anomaly criteria never fires
It is still learning: the hour of the week it compares against does not have enough history yet within the **Baseline Window**.
:::

## Next steps

:::cards
- [Incident & Alert Templating](/docs/monitor/incident-alert-templating): Put the host and the value in alert titles.
- [Logs Monitor](/docs/monitor/logs-monitor): Alert on log volume and content, per group.
- [Host Monitor](/docs/monitor/host-monitor): Ready-made CPU, memory and disk checks for your hosts.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Send metrics to OneUptime.
:::
