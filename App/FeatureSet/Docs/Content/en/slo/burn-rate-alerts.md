# Burn Rate Alerts

Error budgets tell you where you stand; burn rate alerts tell you when to get out of bed. A burn rate alert fires a regular OneUptime Alert — with severity, on-call escalation, and workspace notifications — when an SLO is consuming its error budget fast enough to matter.

If you have not read them yet, start with the [SLOs Overview](/docs/slo/introduction) and [Error Budgets](/docs/slo/error-budget).

## What burn rate means

Burn rate is how fast you are spending error budget **relative to plan**:

```
burn rate = (observed bad fraction) ÷ (allowed bad fraction)
```

A burn rate of **1** means you are spending budget at exactly the sustainable pace — you would land at your target with zero budget left at the end of the window. Higher numbers mean faster exhaustion. For a 99.9% SLO over 30 days:

| Sustained burn rate | Budget exhausted in |
| ------------------- | ------------------- |
| 1                   | 30 days             |
| 2                   | 15 days             |
| 6                   | 5 days              |
| 14.4                | ~2 days (50 hours)  |

The key property: burn rate is independent of how much budget you have left. It answers "how bad is _right now_?", which is exactly what paging decisions need.

## Why two windows per rule

Each burn rate rule measures the burn over two lookback windows and fires only when **both** exceed the threshold:

- The **long window** (e.g., 1 hour) provides evidence that the burn is sustained and significant — not a single failed check.
- The **short window** (e.g., 5 minutes) confirms the problem is _still happening_. Without it, a spike an hour ago would keep paging long after recovery.

This is the multi-window, multi-burn-rate pattern from the Google SRE Workbook, and it is the default OneUptime sets up for you.

## Default rules

Every SLO gets two burn rate rules seeded automatically. For a 30-day window:

| Rule          | Threshold | Long window | Short window | Fires when…                                                        |
| ------------- | --------- | ----------- | ------------ | ------------------------------------------------------------------ |
| **Fast burn** | 14.4x     | 1 hour      | 5 minutes    | ~2% of the budget burns in one hour — exhaustion in about 2 days.  |
| **Slow burn** | 6x        | 6 hours     | 30 minutes   | ~5% of the budget burns in six hours — exhaustion in about 5 days. |

The canonical 14.4x and 6x constants are derived from a 30-day budget, so OneUptime **scales the seeded thresholds to your SLO's window** — each rule always means the same thing: "2% of the budget in 1 hour" (fast) and "5% of the budget in 6 hours" (slow).

| SLO window | Fast burn threshold | Slow burn threshold |
| ---------- | ------------------- | ------------------- |
| 7 days     | 3.36x               | 1.4x                |
| 28 days    | 13.44x              | 5.6x                |
| 30 days    | 14.4x               | 6x                  |
| 90 days    | 43.2x               | 18x                 |

Calendar-month SLOs are seeded with the 30-day values. You can edit or delete the seeded rules and add your own.

## Burn rate alerts are regular OneUptime Alerts

When a rule fires, OneUptime creates a standard **Alert** — the same object your monitors create — so everything you have built around alerts applies:

- **Severity** — each rule has its own alert severity, so a fast burn can page as critical while a slow burn opens a warning.
- **On-call policies** — attach on-call duty policies to the rule and the alert executes them: escalation rules, rotations, call/SMS/push/email, the works.
- **Slack and Microsoft Teams** — workspace notification rules for alerts apply, so burn alerts land in the right channels automatically.
- **Acknowledge and resolve** — the alert has the normal state timeline; your team can ack it from the dashboard or mobile app, add notes, and track it to resolution.

The alert's description includes the SLO's numbers at fire time — current SLI, burn rates over both windows, and budget remaining — so the person paged starts with context.

Only one alert per rule is open at a time: while a burn alert is unresolved, the rule will not stack duplicates on top of it.

## Resolution and re-fire suppression

- **Alerts resolve on the long window.** OneUptime auto-resolves a burn alert when the _long-window_ burn rate drops back below the threshold. Resolving on the short window would flap — a recurring outage would resolve after five quiet minutes and re-page all night.
- **Re-fire suppression.** After an alert resolves, the rule will not fire again for a suppression period (by default, the length of the long window). This gives a recovering system room to actually recover without re-paging on residual noise.

## Low traffic and minimum sample count

For event-based (metric) SLIs, burn rate is computed from good/total event counts — and at low traffic the math gets silly: one failed request out of two, against a 99.9% target, is a burn rate of 500.

Each rule therefore has a **minimum sample count**: if the long window contains fewer total events than the minimum, the rule is skipped for that evaluation. Set it to roughly the traffic level below which a failure rate stops being statistically meaningful for you.

Time-based SLOs (monitor uptime) always have a full signal — every second is a sample — so the minimum sample count does not apply to them.

## Scheduled maintenance

While any monitor attached to the SLO is in an active scheduled maintenance window, burn rate alert creation is suppressed — planned work should not page anyone. Note that the underlying time still counts toward the error budget according to the SLO's downtime statuses.

## Configuring burn rate rules

1. Go to **SLOs** in the OneUptime Dashboard and open your SLO
2. Open the **Burn Rate Rules** tab
3. Click **Create Burn Rate Rule** (or edit one of the seeded defaults)
4. Configure:
   - **Name** — e.g., "Fast burn"
   - **Burn rate threshold** — e.g., `14.4`
   - **Long window** and **short window** (in minutes)
   - **Alert severity** — the severity of the alert this rule creates
   - **On-call duty policies** — who gets paged
   - **Minimum sample count** — for event-based SLIs on low traffic
   - **Re-fire suppression** (in minutes) — quiet period after a resolve

A good starting point is to keep the two seeded rules, route the fast-burn rule to your paging on-call policy at a high severity, and let the slow-burn rule create a lower-severity alert for working-hours follow-up.
