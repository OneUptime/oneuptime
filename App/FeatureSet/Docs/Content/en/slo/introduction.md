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

- **One or more monitors** — the SLI source. OneUptime computes good and bad time from each monitor's status timeline, the same data that powers your status pages.
- **A target percentage** — for example `99.9`. The target must be below 100% (a 100% target has no error budget, so there is nothing to track).
- **A compliance window** — either a **rolling window** of 7, 28, 30, or 90 days, or a **calendar month**.
- **Downtime statuses** — which monitor statuses count as downtime for this SLO.

### Which statuses count as downtime

Each SLO has its own list of monitor statuses that count as downtime. By default, every status that is not marked operational (for example **Degraded** and **Offline**) counts as downtime — the same default your status pages use.

You can tune this per SLO. A common pattern is two SLOs over the same monitors:

- A strict **availability** SLO where both Degraded and Offline count as downtime.
- A looser **hard-down** SLO where only Offline counts.

### Compliance windows

| Window type        | Behavior                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Rolling**        | Always looks back the last 7, 28, 30, or 90 days from now. Bad time gradually ages out of the window, so the budget recovers continuously. |
| **Calendar month** | Measures from the first of the month in the SLO's timezone. The budget resets in full at the start of each month.                          |

Calendar-month SLOs have a **timezone** setting (defaulting to UTC) that determines exactly when the month rolls over.

### Multiple monitors

When an SLO has more than one monitor attached, you choose how their downtime combines:

| Mode                           | Semantics                                                                                                                                                                                    | Use when…                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Any Monitor Down** (default) | Any moment where _at least one_ attached monitor is in a downtime status counts as downtime for the whole SLO. Overlapping outages are not double-counted — the union of down time is taken. | The monitors together represent one user-facing service: if any of them is down, users are affected. |
| **Monitor Seconds Average**    | Each monitor's downtime is counted separately and averaged: SLI = 1 − (total down seconds across monitors ÷ total monitored seconds across monitors).                                        | The monitors are a fleet of similar resources and partial impact should count partially.             |

An example: Monitor A is down from 10:00 to 11:00 while Monitor B stays up.

- **Any Monitor Down** — the SLO records 60 minutes of downtime (the service was impaired for that hour).
- **Monitor Seconds Average** — the SLO records the equivalent of 30 minutes (one of two monitors was down for an hour, so half the fleet-seconds were bad).

## SLO status

Every SLO carries a status computed from its remaining error budget:

| Status               | Meaning                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Healthy**          | Plenty of budget left.                                                                                                    |
| **At Risk**          | Remaining budget has dropped to or below the at-risk threshold — **20% of the budget by default** (configurable per SLO). |
| **Budget Exhausted** | The budget is fully spent (or overspent).                                                                                 |
| **Misconfigured**    | The SLO cannot be evaluated — for example, it has no monitors attached.                                                   |
| **Paused**           | All attached monitors are disabled, so there is no signal to evaluate.                                                    |

SLO owners are notified when the status changes to **At Risk** or **Budget Exhausted** — see [Error Budgets](/docs/slo/error-budget) for details.

## Creating an SLO

1. Go to **SLOs** in the OneUptime Dashboard
2. Click **Create SLO**
3. Give it a name and description
4. Attach one or more **monitors**
5. Set the **target percentage** (e.g., `99.9`)
6. Pick the **compliance window** (rolling 7 / 28 / 30 / 90 days, or calendar month)
7. Optionally adjust the **downtime statuses** and, for multiple monitors, the multi-monitor mode

OneUptime starts evaluating the SLO within a few minutes and re-evaluates it continuously from then on.

## What you'll see on an SLO

The SLO's overview page shows, live:

- **Current SLI** — the measured percentage over the window, next to your target.
- **Error budget remaining** — as a percentage and as minutes, with a budget bar. If you are over budget, the overage is shown as a negative number.
- **Burn rate** — how fast budget is being consumed right now.
- **Charts** — SLI, budget remaining, and burn rate over time, with a reference line at your target.

For a brand-new SLO with a rolling window, the window is not full yet — a 30-day SLO created yesterday only has one day of data. OneUptime measures over the data that exists and flags the SLO as "window not yet full", so early numbers move around more than they will once the window fills.

## Where to read next

- [Error Budgets](/docs/slo/error-budget) — the budget math, how budget recovers, and owner notifications.
- [Burn Rate Alerts](/docs/slo/burn-rate-alerts) — paging your on-call team when the budget is burning too fast.
