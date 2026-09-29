# SLO Metrics and Dashboards

Every time OneUptime evaluates an SLO — every 5 minutes — it writes the results as metrics named `oneuptime.slo.*`. They sit in the same metric store as your monitor metrics, so you can chart an SLO on its **Metrics** page, open it in the metrics explorer, and put it on any dashboard, filtered and grouped like any other series.

If you have not read it yet, start with the [SLOs Overview](/docs/slo/introduction).

## The metrics

| Metric                                         | Unit      | Aggregation | What it holds                                                                                                        |
| ---------------------------------------------- | --------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `oneuptime.slo.sli.percent`                    | `%`       | Avg         | The SLI over the SLO's compliance window: the percentage of measured time that counted as good.                      |
| `oneuptime.slo.target.percent`                 | `%`       | Avg         | The SLO's target, posted with every evaluation so a chart can draw it over the SLI.                                  |
| `oneuptime.slo.error.budget.remaining.percent` | `%`       | Avg         | Share of the error budget still unspent in the compliance window. Negative once the budget is overspent.             |
| `oneuptime.slo.error.budget.remaining.seconds` | `seconds` | Avg         | Downtime the SLO can still absorb before it breaches. Negative once the budget is overspent.                         |
| `oneuptime.slo.burn.rate`                      | `x`       | Max         | How fast the budget is being spent, measured over the last 60 minutes. 1x spends the budget exactly over the window. |
| `oneuptime.slo.status`                         | —         | Max         | The SLO's status at each evaluation: `0` = Healthy, `1` = At Risk, `2` = Budget Exhausted.                           |

The aggregation is how the SLO's own charts and the SLO dashboard template roll up the points that fall into one chart bucket. The four percentages and durations are averaged. Burn rate and status use the maximum, so a short burn spike or a brief trip into Budget Exhausted is not averaged away.

For an SLO in **Monitor Seconds Average** mode, `oneuptime.slo.error.budget.remaining.seconds` counts monitor-seconds summed across its monitors, the same way its error budget does — see [Error Budgets](/docs/slo/error-budget).

### When no point is written

- A disabled or archived SLO is not evaluated, so it posts nothing.
- A **Paused** or **Misconfigured** evaluation measures nothing, so it posts only `oneuptime.slo.target.percent` — the target is configuration, not a measurement — and no SLI, budget, burn rate or status that would read as real. Those charts show a gap.
- A value that is not a real number (for example a burn rate over a window with no data) is skipped, never written as 0.

### Attributes

Every point carries these attributes:

| Attribute               | Value                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sloId`                 | ID of the SLO. The SLO's own pages filter on this, so renaming an SLO never splits its charts.                                                                                  |
| `sloName`               | Name of the SLO when the point was written.                                                                                                                                     |
| `projectId`             | ID of the project.                                                                                                                                                              |
| `oneuptime.label.<key>` | One attribute per SLO label. A label named `tier-1` becomes `oneuptime.label.tier-1` = `true`; a label named `product:checkout` becomes `oneuptime.label.product` = `checkout`. |

The series belong to the SLO itself, not to any of its monitors. They are not counted as telemetry usage.

Incident and alert metrics carry two matching attributes, `serviceLevelObjectiveIds` and `serviceLevelObjectiveNames`: comma-separated lists of the SLOs the incident or alert affects.

### Retention

`oneuptime.slo.*` metrics follow the same retention as monitor metrics: **30 days** by default. On a self-hosted installation, a master admin can change it with **Monitor Metric Retention (Days)** in the Admin Dashboard's **Data Retention** settings.

This does not limit the long-range history on the SLO's **Metrics** → **Error Budget History** tab. That history is stored separately and kept for 400 days.

## The Metrics page

An SLO's **Metrics** page has four tabs:

| Tab                      | What it shows                                                                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SLO Metrics**          | The `oneuptime.slo.*` series in three cards that share one time range (the past day by default): **Objective** (the SLI with the target drawn over it, and budget remaining), **Burn** (burn rate and budget remaining time) and **Status**. |
| **Error Budget History** | The SLI, budget remaining and burn rate over the long-range history, with reference lines at the target, the at-risk and exhausted budget boundaries, and each enabled burn rate rule's threshold.                                           |
| **Incident Metrics**     | The count, time to acknowledge, time to resolve and duration of the incidents that affect this SLO (the past week by default). Incidents declared by its burn rate rules are included automatically.                                         |
| **Alert Metrics**        | The same for alerts. Alerts raised by its burn rate rules are included automatically.                                                                                                                                                        |

A few things worth knowing:

- The **SLO Metrics**, **Incident Metrics** and **Alert Metrics** tabs read the metric store, which requires permission to read telemetry. A custom role that can only read SLOs sees those tabs empty, while **Error Budget History** still works.
- Incident and alert metrics are attributed to SLOs when they are next recalculated, so older incidents and alerts can take a while to appear on the SLO's tabs after upgrading.

## SLOs on dashboards

### Chart any SLO metric

In a chart or value widget, pick one of the `oneuptime.slo.*` metrics. Group by `sloName` and `sloId` for one line per SLO (`sloId` keeps two SLOs that share a name apart), or filter on `sloName` or on an `oneuptime.label.*` attribute to narrow it down. Use the aggregations from the table above: Avg for the percentages and durations, Max for burn rate and status.

### The SLO widget

The [SLO widget](/docs/dashboards/widgets#slo) shows one SLO's SLI, error budget remaining or burn rate as a tile or a chart. It can get its SLO in two ways:

| Setting                     | Behavior                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Service Level Objective** | Pins the widget to one SLO. The picker lists SLOs that are not archived.                                                                         |
| **Follow SLO Variable**     | Shows whichever SLO is picked in a dashboard variable — a **Telemetry Attribute** variable on the `sloName` key. Ignored while an SLO is pinned. |

On a [public dashboard](/docs/dashboards/sharing), a widget that follows a variable lets viewers pick any SLO in the project that is not archived, by name. A pinned widget only ever shows its own SLO. A widget already pinned to an SLO that was later archived keeps showing that SLO's last numbers.

### The SLO dashboard template

When you create a dashboard, choose the **SLO Dashboard** template for a ready-made board of every SLO in the project. It is laid out in three bands:

1. **Service Level Objectives** — an SLO list with every SLO that is not archived: its status, SLI against target, error budget bar and burn rate, with a count of SLOs by status. Enabled SLOs come first, least budget first. A disabled SLO is listed last as **Disabled**, with its last numbers greyed out, and is counted on its own.
2. **Error Budget & Burn Rate** — the **Lowest Error Budget Remaining**, **Least Error Budget Time Left** and **Peak Burn Rate** tiles, and **Error Budget Remaining by SLO** and **Burn Rate by SLO** charts with one line per SLO. The lines are grouped by `sloName` and `sloId`, so each legend entry shows both, and two SLOs that share a name stay two lines.
3. **Selected SLO** — **SLI**, **Error Budget Remaining** and **Burn Rate** tiles and **SLI History**, **Error Budget History** and **Burn Rate History** charts for one SLO.

One **SLO** variable in the toolbar scopes the whole board. It is a Telemetry Attribute variable on `sloName`, so its options are the SLO names found in the metrics. Picking an SLO narrows the list to that SLO, scopes the band charts and tiles to it, and fills in the **Selected SLO** widgets, which use **Follow SLO Variable**. Until you pick one, the Selected SLO widgets ask you to choose an SLO in the toolbar.

Archived SLOs do not appear in the list or the Selected SLO widgets. The toolbar's options are the SLO names posted in the last day, so a new SLO appears after its first evaluation, a **Paused** or **Misconfigured** SLO stays pickable because it still posts its target, and a disabled or archived SLO's name drops out of the picker about a day after its last point. Until then, picking an archived SLO shows that no active SLO has that name. If two SLOs share a name, picking it shows both in the list and the charts, and the Selected SLO widgets say the name is ambiguous, so give SLOs distinct names.

## Where to read next

- [SLOs Overview](/docs/slo/introduction) — what an SLO is and every page it has.
- [Error Budgets](/docs/slo/error-budget) — what the budget numbers mean.
- [Dashboard Widgets](/docs/dashboards/widgets) and [Dashboard Variables](/docs/dashboards/variables) — building your own boards.
