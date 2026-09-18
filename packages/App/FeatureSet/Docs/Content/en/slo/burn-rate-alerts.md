# Burn Rate Alerts and Incidents

Error budgets tell you where you stand; burn rate rules tell you when to get out of bed. When an SLO is consuming its error budget fast enough to matter, a burn rate rule raises a regular OneUptime **Alert**, declares a regular OneUptime **Incident**, or both — with your own title and description, severity, owners, labels, on-call escalation, and workspace notifications.

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

The same rule works in reverse: if an SLO stops having enough history to evaluate a rule's long window, anything that rule has open is resolved rather than left hanging.

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

Seeded rules raise an alert with the built-in title and description, resolve it automatically, and add no owners or labels — exactly what burn rate rules did before these options existed.

## What a rule declares

Every rule declares at least one of two things, and you choose which:

|                       | **Create Alert**                                  | **Declare Incident**                                                                |
| --------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Default               | On                                                | Off                                                                                 |
| Weight                | The lightweight signal — lands in the alert inbox | The heavyweight one — takes an incident number and opens the full response workflow |
| Title and description | Its own, or the built-in text                     | Its own, or the built-in text                                                       |
| Severity              | Its own **alert severity**                        | Its own **incident severity**                                                       |
| Escalation            | Its own **alert on-call policies**                | Its own **incident on-call policies**                                               |
| Owners and labels     | Its own owner teams, owner users and labels       | Its own owner teams, owner users and labels                                         |
| Private               | Off by default                                    | Off by default                                                                      |
| Auto-resolve          | On by default                                     | On by default                                                                       |
| Remediation notes     | Its own                                           | Its own                                                                             |
| Status pages          | Not published                                     | Not published                                                                       |

A rule must do at least one of the two — OneUptime rejects a rule with both switched off, because it would consume an evaluation every minute and declare nothing.

Everything is configured separately for the two, so you can send a terse alert to the owning team's rotation and a detailed incident to your major-incident rotation. Leave a severity blank and OneUptime uses the project's most severe one.

They also have separate lifecycles: each is deduplicated on its own, each resolves on its own, and each has its own quiet period after it resolves. Resolving the incident does not reset the alert's suppression, or the other way around.

### The SLO is an affected resource

Every alert and incident a burn rate rule creates lists its SLO under **Affected Resources** and links back to it. The **Affected Resources** filter on alert and incident lists can narrow them to one SLO, and the SLO's **Alerts** and **Incidents** pages list them, with side menu badges counting the open ones.

OneUptime sets this link itself when the rule creates the record. It is not offered when you edit an alert or incident, and editing one never removes it. See [SLOs Overview](/docs/slo/introduction) for every place the link shows up.

### Burn rate incidents are not customer-facing

An error budget burning fast is an internal engineering signal, not a declared outage, so a burn rate incident is created **invisible on status pages** and **does not notify status page subscribers**. It also carries no monitors — attaching them would let resolving the incident rewrite the very monitor status history the SLO is measured from.

### If you resolve the incident by hand

Nothing re-declares it. The rule will not open another incident until the burn recovers and the rule genuinely fires again, so you are never fighting the worker while you work an incident.

## What each alert and incident says

Leave the **title** and **description** empty and the rule uses its built-in text. The title is:

```
SLO burn rate: {{sloName}} — {{ruleName}}
```

and the description names the rule, states the burn rate over both windows against the threshold, and gives the error budget remaining.

To write your own, use template variables in the title, the description and the remediation notes. They are filled in at the moment the rule fires:

| Variable                             | What it holds                                                                                  | Example                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `{{sloName}}`                        | Name of the SLO.                                                                               | Checkout availability                                  |
| `{{sloId}}`                          | ID of the SLO.                                                                                 | b7f4c2d8-1f3e-4a5b-9c6d-7e8f9a0b1c2d                   |
| `{{sloLink}}`                        | Link to the SLO in the OneUptime Dashboard.                                                    | https://oneuptime.com/dashboard/project-id/slos/slo-id |
| `{{sloStatus}}`                      | Status of the SLO after this evaluation.                                                       | At Risk                                                |
| `{{ruleName}}`                       | Name of the burn rate rule that fired.                                                         | Fast burn                                              |
| `{{burnRateThreshold}}`              | The rule's burn rate threshold (a multiple of the sustainable pace).                           | 14.4                                                   |
| `{{longWindowBurnRate}}`             | Burn rate measured over the rule's long window.                                                | 21.5                                                   |
| `{{shortWindowBurnRate}}`            | Burn rate measured over the rule's short window.                                               | 36                                                     |
| `{{longWindowInMinutes}}`            | Length of the rule's long window, in minutes.                                                  | 60                                                     |
| `{{shortWindowInMinutes}}`           | Length of the rule's short window, in minutes.                                                 | 5                                                      |
| `{{targetPercentage}}`               | The SLO's target, as a percentage.                                                             | 99.9                                                   |
| `{{currentSliPercentage}}`           | The SLI measured over the SLO's compliance window, as a percentage.                            | 99.87                                                  |
| `{{errorBudgetRemainingPercentage}}` | Share of the error budget still left, as a percentage. Negative once the budget is overspent.  | 42.5                                                   |
| `{{errorBudgetRemaining}}`           | Error budget still left, as a duration. Starts with a minus sign once the budget is overspent. | 18m 22s                                                |
| `{{errorBudgetRemainingMinutes}}`    | Error budget still left, in minutes.                                                           | 18.37                                                  |
| `{{windowDescription}}`              | The SLO's compliance window, in words.                                                         | rolling 30-day window                                  |

For example, an alert title of `{{ruleName}}: {{sloName}} is burning {{longWindowBurnRate}}x` becomes "Fast burn: Checkout availability is burning 21.5x".

A few details worth knowing:

- Numbers are rounded to two decimals.
- Spaces inside the braces are fine: `{{ sloName }}` works.
- A variable that is misspelled is left exactly as written, so a typo shows up in the alert instead of silently disappearing.
- Titles are limited to 500 characters and descriptions and remediation notes to 50,000. If a title grows past 500 characters once its variables are filled in, it is folded onto one line and shortened with an ellipsis rather than failing to create the alert or incident.
- If the link to the SLO cannot be built when the rule fires, `{{sloLink}}` is left empty and the alert or incident is still created.

## Owners, labels and privacy

- **Owner teams** and **owner users** are added to the alert or incident as soon as it is created, and are notified. Owner users must be members of the project.
- **Add SLO Owners as Owners** also adds the SLO's owners — its owner users and the members of its owner teams — to every alert and incident the rule creates. SLO owners already hear about the SLO's own status changes, so turning this on can notify them twice. It is off by default.
- Each owner is added once. A user who is already an owner of the alert or incident (for example, added by the project's owner rules), or who is a member of an owner team being added, is not added again as an owner user; the team covers them.
- **Labels** are added to the alert or incident, so filters, owner rules and workspace notification rules can match it.
- A **private** alert or incident is visible only to its owners, project admins and project owners.

Labels, owner teams and on-call policies must belong to the same project as the SLO.

## Resolution and re-fire suppression

- **Resolution follows the long window.** With **Auto Resolve** on (the default), OneUptime resolves a rule's alert and incident when the _long-window_ burn rate drops back below the threshold. Resolving on the short window would flap — a recurring outage would resolve after five quiet minutes and re-page all night.
- **Auto Resolve off.** Turn it off for the alert, the incident, or both, and that record stays open until someone resolves it, even after the burn recovers. The rule will not open another one on top of it. Once it has been resolved by hand and the long-window burn rate is back below the threshold, the rule's re-fire suppression starts, and the rule can fire again after it. Auto Resolve only decides what happens on recovery: the cases in the last bullet always resolve.
- **Re-fire suppression.** After a record resolves, the rule will not declare that record again for a suppression period (by default, the length of the long window). This gives a recovering system room to actually recover without re-paging on residual noise. The alert and the incident are suppressed independently, each measured from its own resolve.
- **Turning an output off closes what it opened.** Switch off Create Alert, switch off Declare Incident, or disable the rule entirely, and anything that output has open is resolved immediately — nothing is left escalating for a rule that can no longer justify it. Deleting the rule, or disabling, archiving or deleting the SLO, does the same, and so does a rule losing its threshold or windows. These always resolve, whatever the auto-resolve setting says. An SLO disabled or archived while an evaluation is running does not fire its rules either.

## The SLO feed

The SLO's **Feed** page records each alert a rule raises and each incident it declares — with a link to the record and the burn rates behind it — and when each one resolves, automatically or by hand. A record that was already open and simply picked up again by the rule is not posted twice.

Creating, changing and deleting a rule is posted too, and recorded in the SLO's **Audit Logs**. See [SLO Feed and Audit Logs](/docs/slo/feed-and-audit-logs).

## Low traffic and minimum sample count

OneUptime measures SLIs from monitor uptime today, which is a time-based signal: every second in the window is a sample, so there is no low-traffic case to guard against and no minimum sample count to configure.

The setting becomes relevant with event-based (metric) SLIs, which are not available yet. There, burn rate is computed from good/total event counts, and at low traffic the math gets silly: one failed request out of two, against a 99.9% target, is a burn rate of 500. A minimum sample count will let a rule skip evaluations whose long window contains too few events to mean anything.

## Scheduled maintenance

While any monitor attached to the SLO is in an active scheduled maintenance window, the rule is suppressed entirely — neither an alert nor an incident is created, because planned work should not page anyone. Records the rule already has open still resolve as usual. Note that the underlying time still counts toward the error budget according to the SLO's downtime statuses.

## Configuring burn rate rules

1. Go to **SLOs** in the OneUptime Dashboard and open your SLO
2. Open the **Burn Rate Rules** tab
3. Click **Create SLO Burn Rate Rule** (or edit one of the seeded defaults)
4. Work through the steps:

| Step                 | What you set                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rule**             | **Name** — e.g., "Fast burn" — and whether the rule is **enabled**.                                                                                 |
| **Burn Window**      | **Burn rate threshold** (e.g., `14.4`), the **long window** and **short window** in minutes, and **re-fire suppression** in minutes.                |
| **What It Declares** | **Create alert** (on by default) and **declare incident** (off by default) — at least one must be on — and **add SLO owners as owners**.            |
| **Alert**            | The alert’s **title** and **severity**, plus expandable sections for **Description**, **Ownership & Labels**, **On-Call** and **Advanced Options**. |
| **Incident**         | The incident’s own **title**, **severity** and optional settings, grouped in the same way.                                                          |

Optional sections open automatically when they contain saved settings. **Advanced Options** contains auto-resolve, privacy and remediation notes.

The alert and incident steps appear and disappear with the toggles on **What It Declares**, so a rule that only raises alerts is never asked about incidents.

The rules table shows, per rule, what it declares (and whether a record stays open until resolved by hand or is private), its severities, on-call policies, owners and labels.

A good starting point is to keep the two seeded rules, route the fast-burn rule to your paging on-call policy at a high severity, and let the slow-burn rule create a lower-severity alert for working-hours follow-up. If your team runs everything through the incident workflow, turn on **Declare incident** for the fast-burn rule — and turn off **Create alert** on it if you would rather not get both.

Seeded rules create an alert and do not declare an incident, so upgrading OneUptime never starts declaring incidents on your behalf.
