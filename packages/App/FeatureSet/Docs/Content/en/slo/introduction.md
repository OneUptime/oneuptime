# SLOs Overview

Service Level Objectives (SLOs) let you set a reliability target for the things you monitor — for example "99.9% availability over a rolling 30 days" — and track how you are doing against that target in real time. Instead of asking "is it up right now?", an SLO answers "have we been reliable enough over a window our users actually care about?"

## Key concepts

| Term                              | Meaning                                                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **SLI** (Service Level Indicator) | The measurement itself — the percentage of time your attached monitors were healthy over the compliance window.                                 |
| **SLO** (Service Level Objective) | A target applied to the SLI: "the SLI should be at least 99.9% over the last 30 days."                                                          |
| **Error budget**                  | The unreliability your target allows: `(100% − target) × window`. At 99.9% over 30 days you are allowed 43 minutes and 12 seconds of downtime.  |
| **Burn rate**                     | How fast you are consuming the error budget relative to plan. A burn rate of 1 means you will use exactly your budget by the end of the window. |

The value of the error budget framing is that it turns reliability into a spendable resource. Plenty of budget left? Ship faster, take risks, run experiments. Budget nearly gone? Slow down and invest in stability. SLOs give you the number that makes that conversation objective.

## How OneUptime models an SLO

An SLO in OneUptime is made of:

- **One or more monitors** — the SLI source. OneUptime computes good and bad time from each monitor's status timeline, the same data that powers your status pages. Attach monitors by hand on the SLO's **Monitors** page, or let **monitor rules** attach every monitor that matches — see [Monitors and Monitor Rules](/docs/slo/monitor-rules).
- **A target percentage** — for example `99.9`. The target must be greater than 0 and at most 99.999 (a 100% target has no error budget, so there is nothing to track).
- **A compliance window** — either a **rolling window** of any length from 1 to 366 days (7, 28, 30 and 90 are the usual choices), or a **calendar month**.
- **An at-risk threshold** — the share of the error budget left at which the SLO turns **At Risk**. 20% by default.
- **Downtime statuses** — which monitor statuses count as downtime for this SLO.
- **A multi-monitor mode** — how downtime on several monitors combines.

### Which statuses count as downtime

Each SLO has its own list of monitor statuses that count as downtime. A new SLO starts with every status in the project that is not marked operational (for example **Degraded** and **Offline**) — the same default your status pages use.

You can change the list on the SLO's **Settings** page, under **Downtime Calculation**. Leave it empty to always count every non-operational status, including statuses added to the project later.

A common pattern is two SLOs over the same monitors:

- A strict **availability** SLO where both Degraded and Offline count as downtime.
- A looser **hard-down** SLO where only Offline counts.

### Compliance windows

| Window type        | Behavior                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rolling**        | Always looks back a fixed number of days from now (1 to 366). Bad time gradually ages out of the window, so the budget recovers continuously. |
| **Calendar month** | Measures from the first of the month in the SLO's timezone. The budget resets in full at the start of each month.                             |

Calendar-month SLOs have a **timezone** setting (defaulting to UTC) that determines exactly when the month rolls over.

### Multiple monitors

When an SLO has more than one monitor attached, its **Multi Monitor Mode** decides how their downtime combines. A new SLO uses **Any Monitor Down**; change it on the SLO's **Settings** page, under **Downtime Calculation**.

| Mode                           | Semantics                                                                                                                                                                                                                                                  | Use when…                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Any Monitor Down** (default) | Any moment where _at least one_ attached monitor is in a downtime status counts as downtime for the whole SLO. Overlapping outages are not double-counted — the union of down time is taken.                                                               | The monitors together represent one user-facing service: if any of them is down, users are affected. |
| **Monitor Seconds Average**    | Each monitor's downtime is counted separately and averaged: SLI = 1 − (total down seconds across monitors ÷ total monitored seconds across monitors). This changes the denominator as well as the numerator — see [Error Budgets](/docs/slo/error-budget). | The monitors are a fleet of similar resources and partial impact should count partially.             |

An example: Monitor A is down from 10:00 to 11:00 while Monitor B stays up.

- **Any Monitor Down** — the SLO records 60 minutes of downtime (the service was impaired for that hour).
- **Monitor Seconds Average** — the SLO records the equivalent of 30 minutes (one of two monitors was down for an hour, so half the fleet-seconds were bad).

## SLO status

Every SLO carries a status computed from its remaining error budget:

| Status               | Meaning                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Healthy**          | Plenty of budget left.                                                                                                                                                                   |
| **At Risk**          | Remaining budget has dropped to or below the at-risk threshold — **20% of the budget by default** (configurable per SLO).                                                                |
| **Budget Exhausted** | The budget is fully spent (or overspent).                                                                                                                                                |
| **Misconfigured**    | The SLO cannot be evaluated — no monitors attached, its monitors no longer exist or have not reported a status yet, or a target outside 0–100%. The SLO's pages explain which.            |
| **Paused**           | Every attached monitor has active monitoring disabled — by hand, by a manual incident or by a scheduled maintenance event — so there is no signal to evaluate. It resumes automatically. |

Disabled and archived SLOs are not evaluated at all, so their status does not change. The SLO list shows them with a **Disabled** or **Archived** pill instead.

SLO owners are notified when the status changes to **At Risk** or **Budget Exhausted** — see [Error Budgets](/docs/slo/error-budget) for details.

## Creating an SLO

1. Go to **SLOs** in the OneUptime Dashboard
2. Click **Create SLO**
3. Work through the four steps:

| Step           | What you set                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Basic Info** | The **name** and an optional **description**.                                                                                                                 |
| **Objective**  | The **target percentage** (e.g., `99.9`) and the **at-risk threshold** (20 by default).                                                                       |
| **Period**     | The **window type** — **Rolling** (then the window length in days, 1 to 366, 30 by default) or **Calendar Month** (then the **timezone** the month rolls over in). |
| **Labels**     | Optional **labels** to organize and filter SLOs.                                                                                                              |

The create form asks only what the SLO is. Everything about how it measures starts from a default you can change later:

| Setting               | A new SLO starts with                                                   | Change it on                                                                  |
| --------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Monitors              | None                                                                    | The **Monitors** page, or automatically with **Monitor Rules**                |
| Downtime statuses     | Every non-operational status in the project                             | **Settings** → **Downtime Calculation**                                       |
| Multi-monitor mode    | **Any Monitor Down**                                                    | **Settings** → **Downtime Calculation**                                       |
| Evaluation            | Enabled                                                                 | **Settings** → **Evaluation**                                                 |
| Burn rate rules       | A **Fast burn** and a **Slow burn** rule, scaled to the window          | The **Burn Rate Rules** page — see [Burn Rate Alerts and Incidents](/docs/slo/burn-rate-alerts) |

After you save, OneUptime opens the new SLO. Until it measures at least one monitor, its **Overview** shows a **Choose what this SLO measures** card with the two ways to attach monitors: create a monitor rule, or pick monitors by hand.

OneUptime evaluates enabled SLOs every 5 minutes. The first numbers appear after the first evaluation that has monitors to measure.

## Choosing what an SLO measures

An SLO measures the monitors attached to it, and there are two ways to attach them:

- **By hand** — on the SLO's **Monitors** page, click **Add Monitors** and pick them. Best for a small, fixed set.
- **With monitor rules** — on the SLO's **Monitor Rules** page, describe the monitors once ("every monitor labelled Production", "every monitor whose name matches `api-*`") and every matching monitor is attached, now and as monitors are created or change.

The SLO measures the union of both: the monitors you attached by hand plus every monitor any enabled rule matches. Rules never take over or detach a monitor you attached by hand, and while any rule is enabled, the rules manage the SLO's monitors, so new monitors cannot be added by hand. [Monitors and Monitor Rules](/docs/slo/monitor-rules) covers the details.

## The SLO's pages

Open an SLO from the SLO list to see its pages in the side menu:

| Page                | What it shows                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**        | The SLO's status and headline numbers, the error budget burn-down, its monitors, open alerts and incidents, its burn rate rules, a configuration summary and recent activity.         |
| **Monitors**        | Every monitor the SLO measures, with its current status and whether a rule or a person attached it. Add and remove hand-picked monitors here.                                        |
| **Monitor Rules**   | The rules that attach matching monitors automatically.                                                                                                                              |
| **Burn Rate Rules** | The rules that raise alerts and declare incidents when the budget burns too fast: what each one declares, its severities, on-call policies, owners and labels, and whether it is firing. |
| **Metrics**         | The SLO's `oneuptime.slo.*` metrics, its long-range error budget history, and metrics for the incidents and alerts that affect it — see [SLO Metrics and Dashboards](/docs/slo/metrics). |
| **Alerts**          | Every alert linked to this SLO by its burn rate rules. The badge counts the ones still open.                                                                                        |
| **Incidents**       | Every incident linked to this SLO by its burn rate rules. The badge counts the ones still open.                                                                                     |
| **Feed**            | A timeline of what happened: status changes, burn rate alerts and incidents, and changes to the SLO, its rules, monitors and owners — see [SLO Feed and Audit Logs](/docs/slo/feed-and-audit-logs). |
| **Owners**          | The users and teams notified when the status changes.                                                                                                                               |
| **Settings**        | The objective, compliance period, downtime calculation and evaluation switch, and the archive card.                                                                                 |
| **Audit Logs**      | Who changed the SLO, its burn rate rules, monitor rules and owners, and when.                                                                                                       |
| **Delete SLO**      | Deletes the SLO permanently. Its open burn rate alerts and incidents are resolved first. To stop measuring an SLO but keep it, archive it instead.                                  |

Links to the old **Charts** page still work and show the same history charts as **Metrics** → **Error Budget History**.

When something stops an SLO from measuring — it is archived or disabled, has no monitors, cannot be evaluated, or every monitor is paused — a banner at the top of its pages says what is wrong and links to the page that fixes it.

### Overview

The **Overview** answers "are we within budget?", top to bottom:

- **Summary** — the status with a sentence saying what it means, the target, the window, how many monitors the SLO measures and, while a rolling window is still filling, how full it is (see [Young SLOs](#young-slos-and-the-window-fill-indicator)). The time of the last evaluation and the SLO's owners sit on the right.
- **Headline numbers**:
  - **SLI** — the measured percentage over the window, and how far above or below the target it is.
  - **Error budget left** — as a percentage, as a duration ("12m 30s left of 43m 12s") and as a bar with a tick at the at-risk threshold. If you are over budget, the overage is shown as a negative number.
  - **Burn rate** — how fast budget is being consumed, measured over the last 60 minutes. That is the same lookback the default fast-burn rule uses. The tile turns amber above 1× and red once it reaches the lowest threshold of the SLO's enabled burn rate rules.
  - **Budget runway** — how long the remaining budget lasts at that burn rate — see [Error Budgets](/docs/slo/error-budget#budget-runway).
- **Error budget burn-down** — the budget remaining over the current window, with the at-risk and exhausted lines — see [Error Budgets](/docs/slo/error-budget#error-budget-burn-down).
- **Monitors** — the monitors the SLO measures, most urgent first, and how many monitor rules keep the list in sync.
- **Recent activity** — the SLO's feed.
- **Open alerts & incidents** — what the burn rate rules have open right now.
- **Burn rate rules** — each enabled rule's threshold next to the current burn rate, and what it declares.
- **Configuration** — how the SLO measures, in plain words, with a link to **Settings**.
- **SLO Details** — the name, description and labels. These are the only settings edited on the Overview.

A new SLO with no monitors and no monitor rules shows the **Choose what this SLO measures** card in place of the numbers.

### Settings

The **Settings** page is where you change how an SLO measures:

| Card                     | What you can change                                                                           | Worth knowing                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Objective**            | **Target** and **At-Risk Threshold**.                                                         | The card also shows the error budget the objective allows, for example "43m 12s of downtime per 30-day window".                                          |
| **Compliance Period**    | **Window Type**, **Window (Days)** for rolling windows, **Timezone** for calendar months.      | Burn rate rules keep the thresholds they were created with, so review them after changing the window.                                                   |
| **Downtime Calculation** | **Multi Monitor Mode** and **Downtime Monitor Statuses**.                                     | Leave the statuses empty to count every non-operational status, including ones added later.                                                             |
| **Evaluation**           | **Enabled**. The card also shows when the SLO was last evaluated.                             | A disabled SLO keeps its history and settings but is not evaluated, and its burn rate rules do not fire. Disabling resolves the burn rate alerts and incidents it has open. |
| **Archive**              | **Archive** or **Unarchive** the SLO.                                                         | See [Archiving an SLO](#archiving-an-slo).                                                                                                               |

OneUptime re-evaluates the SLO on its next run after you change its objective, period or downtime calculation.

## Archiving an SLO

Archive an SLO you no longer measure but want to keep — a retired service, last year's objective. Archive one from its **Settings** page, or select SLOs in the SLO list and choose **Archive**.

When an SLO is archived:

- It is hidden from the SLO list, from the status tiles above the list, and from the SLO pickers and lists on dashboards.
- It is **not evaluated**. Its numbers stay frozen as of its last evaluation, its burn rate rules do not fire, and it posts no new metrics.
- Its open burn rate alerts and incidents are **resolved**.
- Its settings, history, burn rate rules, monitor rules and owners are kept. Monitor rules keep the monitor list current while it is archived, so it resumes with the right monitors.

Archived SLOs are listed on the **Archived** page in the SLO list's side menu, with their target, window, last evaluation, labels, when they were archived and by whom. Select SLOs there and choose **Unarchive** to bring them back.

An unarchived SLO reappears in the SLO list and is evaluated again on the next run, with its SLI and error budget recomputed from its monitors' history.

Archiving and disabling are separate switches: an SLO that was disabled before it was archived **stays disabled** when you unarchive it. Turn it back on in **Settings** → **Evaluation**.

| You want to…                                   | Do this     |
| ---------------------------------------------- | ----------- |
| Stop measuring for a while, and keep it listed | Disable it  |
| Retire it but keep its history and settings    | Archive it  |
| Remove it for good                             | Delete it   |

## The SLO list

The **SLOs** page lists every SLO that is not archived, with its status, SLI, error budget, burn rate, target and window.

The tiles above the list count SLOs by status — **Healthy**, **At Risk**, **Budget Exhausted**, **Misconfigured**, **Paused** and **Disabled**. Click a tile to filter the list to those SLOs, and click it again to clear the filter. Archived SLOs are never counted.

Select SLOs in the list to change their labels or owners, archive them, or delete them in bulk.

To label SLOs and assign their owners automatically, use the **Label Rules** and **Owner Rules** pages under **Settings** in the SLO list's side menu — see [Label and Owner Rules](/docs/slo/label-and-owner-rules).

## SLOs on alerts and incidents

Every alert and incident a burn rate rule creates is linked to its SLO, so you can always get from the page to the objective behind it:

- The alert or incident page lists the SLO under **Affected Resources**, with a link to the SLO.
- Alert and incident lists show the SLO in the affected resources column, and the **Affected Resources** filter can narrow a list to one SLO.
- The alert or incident's "created" feed item lists the SLO under **Resources Affected**.
- The SLO's **Alerts** and **Incidents** pages list them, and their side menu badges count the open ones.

OneUptime sets this link when a rule creates the alert or incident. It is not offered when you create or edit an alert or incident by hand, and editing one never removes it. Alerts and incidents that burn rate rules created before this link existed were linked when you upgraded.

## Young SLOs and the window-fill indicator

For a brand-new SLO with a rolling window, the window is not full yet — a 30-day SLO created yesterday only has one day of data. OneUptime measures over the data that exists, so the error budget starts small and grows as the window fills, and early numbers move around more than they will later.

While that is the case, the Overview says so where it matters:

- the summary at the top shows a **Window 23% full** chip (or **Window under 1% full** on day one), with a tooltip explaining why the numbers are still settling;
- the **Error budget left** tile adds the same "window 23% full" note under the number that moves most.

Both disappear once the window is full. Calendar-month SLOs never show them, because their budget covers the whole month from day one. SLOs in **Monitor Seconds Average** mode do not show them either, because their budget is summed across monitors and cannot be compared with a single window.

## Where to read next

- [Monitors and Monitor Rules](/docs/slo/monitor-rules) — attaching monitors by hand and with rules.
- [Error Budgets](/docs/slo/error-budget) — the budget math, how budget recovers, the budget runway, and owner notifications.
- [Burn Rate Alerts and Incidents](/docs/slo/burn-rate-alerts) — paging your on-call team when the budget is burning too fast.
- [SLO Metrics and Dashboards](/docs/slo/metrics) — the `oneuptime.slo.*` metrics, the Metrics page and the SLO dashboard template.
- [SLO Feed and Audit Logs](/docs/slo/feed-and-audit-logs) — what the feed records, and who changed what.
- [Label and Owner Rules](/docs/slo/label-and-owner-rules) — labelling SLOs and assigning their owners automatically.
