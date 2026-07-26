# Error Budgets

The error budget is the amount of unreliability your SLO target allows. It is the practical, spendable side of an SLO: a 99.9% target does not mean "never go down" — it means "you may be down for up to 43 minutes in 30 days, spend it wisely."

If you have not read it yet, start with the [SLOs Overview](/docs/slo/introduction).

## How the budget is calculated

The total budget is the inverse of your target applied to the window:

```
total budget = (100% − target) × window length
```

Some common combinations:

| Target | 7-day window | 28-day window | 30-day window | 90-day window |
| ------ | ------------ | ------------- | ------------- | ------------- |
| 99%    | 1h 40m 48s   | 6h 43m 12s    | 7h 12m        | 21h 36m       |
| 99.5%  | 50m 24s      | 3h 21m 36s    | 3h 36m        | 10h 48m       |
| 99.9%  | 10m 5s       | 40m 19s       | 43m 12s       | 2h 9m 36s     |
| 99.95% | 5m 2s        | 20m 10s       | 21m 36s       | 1h 4m 48s     |
| 99.99% | 1m 0s        | 4m 2s         | 4m 19s        | 12m 58s       |

### Multi-monitor SLOs

In **Any Monitor Down** mode the budget is the plain `(100% − target) × window` above — the window is one timeline no matter how many monitors feed it.

In **Monitor Seconds Average** mode the denominator is the sum of monitored seconds *across all attached monitors*, so the total budget in minutes scales with the monitor count: a three-monitor 99.9% / 30-day SLO has roughly 129 minutes of budget rather than 43. The percentages — SLI, remaining budget, burn rate — are unaffected; only the absolute minutes change.

### Calendar-month windows

For calendar-month windows the budget is calculated over the **full month** from day one — a 99.9% SLO in a 31-day month has its whole 44m 38s available on the 1st. It is not prorated by how much of the month has elapsed, so a one-minute blip on the morning of the 1st consumes one minute of the month's budget, exactly as it should.

## Remaining budget

As downtime accumulates, OneUptime tracks:

- **Remaining time** — `total budget − downtime consumed`, shown alongside the total (e.g., "31m 4s left of 43m 12s").
- **Remaining percent** — remaining budget as a percentage of the total, which drives the budget bar and the [SLO status](/docs/slo/introduction).

The remaining budget is a **signed** value. If you blow through the budget, OneUptime keeps counting — an SLO can show "−40 minutes" to tell you exactly how far over you are, which is far more useful during a bad month than a bar pinned at zero. The budget bar itself clamps at empty; the signed number is shown next to it.

Which seconds count as "downtime consumed" is controlled per SLO by its downtime statuses and, for multi-monitor SLOs, its multi-monitor mode — see [How OneUptime models an SLO](/docs/slo/introduction).

## How budget recovers

### Rolling windows

A rolling window always looks back a fixed distance from now, so bad time **ages out**: an outage stops counting against you exactly one window-length after it happened. A 30-minute outage on June 1st is fully off a 30-day SLO's books on July 1st — and the budget recovers gradually as each bad second slides past the window's trailing edge, not all at once.

This also means recovery is earned, not scheduled. If you keep having small incidents, old bad time ages out while new bad time arrives, and the budget hovers instead of recovering.

### Calendar-month windows

A calendar-month SLO resets at midnight on the first of each month, in the SLO's configured timezone. The full budget comes back at once, and the previous month's performance is closed out. There is no carry-over in either direction — a terrible month does not dent the next one, and an excellent month does not pad it.

### Young SLOs

A rolling-window SLO younger than its window measures over the data that exists so far, and the total budget grows with it — a 30-day SLO created a week ago has a 7-day budget for now. The dashboard flags this as "window not yet full". Expect the numbers to steady as the window fills.

## Status changes and the at-risk threshold

The remaining budget drives the SLO's status:

| Status               | Condition                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Healthy**          | Remaining budget is above the at-risk threshold.                                                                |
| **At Risk**          | Remaining budget is at or below the at-risk threshold — **20% of the budget by default**, configurable per SLO. |
| **Budget Exhausted** | Remaining budget is at or below zero.                                                                           |

Because rolling windows recover continuously, an SLO sitting near a boundary could flap between statuses as individual seconds age in and out. OneUptime applies a little hysteresis — the SLO must recover comfortably past a boundary before it transitions back — so a status change always reflects a real trend.

## Owner notifications

When an SLO transitions to **At Risk** or **Budget Exhausted**, OneUptime notifies the SLO's owners:

- Owners are the **users and teams** you add on the SLO's **Owners** tab.
- If an SLO has no owners, the notification falls back to the **project owners**.
- Each owner is notified on the channels they have enabled in their own notification settings (email, SMS, push).

Status-change notifications are rate-limited so a boundary-hugging SLO cannot page its owners repeatedly for the same slow-motion problem.

Owner notifications are informational — they tell the people accountable for the SLO that the budget is in trouble. If you want budget burn to page your on-call team through escalation policies, use [Burn Rate Alerts](/docs/slo/burn-rate-alerts).
