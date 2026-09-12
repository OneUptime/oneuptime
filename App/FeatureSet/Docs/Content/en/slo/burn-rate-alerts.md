# Burn Rate Alerts and Incidents

Error budgets tell you where you stand; burn rate rules tell you when to get out of bed. When an SLO is consuming its error budget fast enough to matter, a burn rate rule raises a regular OneUptime **Alert**, declares a regular OneUptime **Incident**, or both — with severity, on-call escalation, and workspace notifications.

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

## When a rule starts working

A rule cannot fire until the SLO has at least a full long window of monitoring history behind it — otherwise a monitor's very first bad check, with only minutes of history to divide by, would compute an enormous burn rate and page someone. In practice that means a freshly created SLO cannot fire its **Fast burn** rule for its first hour, or its **Slow burn** rule for its first six.

The same rule works in reverse: if an SLO stops having enough history to evaluate a rule's long window, anything that rule has open is auto-resolved rather than left hanging.

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

## What a rule declares

Every rule declares at least one of two things, and you choose which:

|              | **Create Alert**                                  | **Declare Incident**                                                                |
| ------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Default      | On                                                | Off                                                                                 |
| Weight       | The lightweight signal — lands in the alert inbox | The heavyweight one — takes an incident number and opens the full response workflow |
| Severity     | Its own **alert severity**                        | Its own **incident severity**                                                       |
| Escalation   | Its own **alert on-call policies**                | Its own **incident on-call policies**                                               |
| Status pages | Not published                                     | Not published                                                                       |

A rule must do at least one of the two — OneUptime rejects a rule with both switched off, because it would consume an evaluation every minute and declare nothing.

The two severities and the two on-call lists are deliberately separate, so you can route the alert to the owning team's rotation and the incident to your major-incident rotation. Leave a severity blank and OneUptime uses the project's most severe one.

They also have separate lifecycles: each is deduplicated on its own, each resolves on its own, and each has its own quiet period after it resolves. Resolving the incident does not reset the alert's suppression, or the other way around.

### Burn rate incidents are not customer-facing

An error budget burning fast is an internal engineering signal, not a declared outage, so a burn rate incident is created **invisible on status pages** and **does not notify status page subscribers**. It also carries no monitors — attaching them would let resolving the incident rewrite the very monitor status history the SLO is measured from.

### If you resolve the incident by hand

Nothing re-declares it. The rule will not open another incident until the burn recovers and the rule genuinely fires again, so you are never fighting the worker while you work an incident.

## Burn rate alerts and incidents are regular OneUptime records

When a rule fires, OneUptime creates a standard **Alert** and/or a standard **Incident** — the same objects your monitors create — so everything you have built around them applies:

- **Severity** — each rule has its own severity, so a fast burn can page as critical while a slow burn opens a warning.
- **On-call policies** — attach on-call duty policies to the rule and the record executes them: escalation rules, rotations, call/SMS/push/email, the works.
- **Slack and Microsoft Teams** — workspace notification rules apply, so burn alerts and incidents land in the right channels automatically.
- **Acknowledge and resolve** — the normal state timeline; your team can ack from the dashboard or mobile app, add notes, and track to resolution.

The description includes the SLO's numbers at fire time — current SLI, burn rates over both windows, and budget remaining — so the person paged starts with context. Both records carry the same description, so the two are easy to correlate.

Only one alert and one incident per rule is open at a time: while either is unresolved, the rule will not stack duplicates on top of it.

The SLO's **Alerts** and **Incidents** tabs list everything its burn rate rules have declared.

## Resolution and re-fire suppression

- **Resolution follows the long window.** OneUptime auto-resolves a rule's alert and incident when the _long-window_ burn rate drops back below the threshold. Resolving on the short window would flap — a recurring outage would resolve after five quiet minutes and re-page all night.
- **Re-fire suppression.** After a record resolves, the rule will not declare that record again for a suppression period (by default, the length of the long window). This gives a recovering system room to actually recover without re-paging on residual noise. The alert and the incident are suppressed independently, each measured from its own resolve.
- **Turning an output off closes what it opened.** Switch off Create Alert, switch off Declare Incident, or disable the rule entirely, and anything that output has open is resolved immediately — nothing is left escalating for a rule that can no longer justify it. Deleting the rule, or disabling or deleting the SLO, does the same.

## Low traffic and minimum sample count

OneUptime measures SLIs from monitor uptime today, which is a time-based signal: every second in the window is a sample, so there is no low-traffic case to guard against and no minimum sample count to configure.

The setting becomes relevant with event-based (metric) SLIs, which are not available yet. There, burn rate is computed from good/total event counts, and at low traffic the math gets silly: one failed request out of two, against a 99.9% target, is a burn rate of 500. A minimum sample count will let a rule skip evaluations whose long window contains too few events to mean anything.

## Scheduled maintenance

While any monitor attached to the SLO is in an active scheduled maintenance window, the rule is suppressed entirely — neither an alert nor an incident is created, because planned work should not page anyone. Note that the underlying time still counts toward the error budget according to the SLO's downtime statuses.

## Configuring burn rate rules

1. Go to **SLOs** in the OneUptime Dashboard and open your SLO
2. Open the **Burn Rate Rules** tab
3. Click **Create Burn Rate Rule** (or edit one of the seeded defaults)
4. Configure:
   - **Name** — e.g., "Fast burn"
   - **Burn rate threshold** — e.g., `14.4`
   - **Long window** and **short window** (in minutes)
   - **Re-fire suppression** (in minutes) — quiet period after a resolve
   - **Create alert** — whether this rule raises an Alert (on by default), plus its **alert severity** and **alert on-call duty policies**
   - **Declare incident** — whether this rule declares an Incident (off by default), plus its **incident severity** and **incident on-call duty policies**

A good starting point is to keep the two seeded rules, route the fast-burn rule to your paging on-call policy at a high severity, and let the slow-burn rule create a lower-severity alert for working-hours follow-up. If your team runs everything through the incident workflow, turn on **Declare incident** for the fast-burn rule — and turn off **Create alert** on it if you would rather not get both.

Seeded rules create an alert and do not declare an incident, so upgrading OneUptime never starts declaring incidents on your behalf.
