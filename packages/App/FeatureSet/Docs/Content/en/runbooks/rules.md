# Runbook Rules

Runbook rules attach runbooks automatically when an **incident**, **alert**, or **scheduled maintenance event** is created. They're managed from each entity's Rules menu:

- Incidents → Rules → **Runbook Rules**
- Alerts → Rules → **Runbook Rules**
- Scheduled Maintenance → Rules → **Runbook Rules**

All three pages edit the same underlying rule model — they're just filtered to show only rules for that entity type.

## Anatomy of a rule

| Field                 | Purpose                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| **Name**              | Short, human label. Shown in audit logs.                                                                |
| **Description**       | Optional context for teammates.                                                                         |
| **Enabled**           | Toggle to suspend a rule without deleting it.                                                           |
| **Conditions**        | What the rule matches, on the **Match Criteria** step. Leave it empty to match every event of its type. |
| **Runbooks to Start** | One or more runbooks to launch when the rule fires.                                                     |

## Conditions

Each condition compares one thing about the incident, alert or scheduled maintenance event with a value you give. A runbook rule offers the same criteria as the other rules of its product: an incident runbook rule matches on what an incident privacy or on-call rule matches on.

| Criterion                                                                | What it checks                                                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Monitors**                                                             | The monitors the incident or alert came from, or the monitors the scheduled maintenance event affects.                |
| **Incident Severities** / **Alert Severities**                           | The incident's or the alert's severity. Scheduled maintenance events have no severity, so their rules don't offer it. |
| **Incident Labels** / **Alert Labels** / **Event Labels**                | The labels on the incident, alert or event itself, including the ones label rules attached when it was created.       |
| **Monitor Labels**                                                       | The labels on its monitors. Label your monitors `production` or `staging` to run a runbook for one environment only.  |
| **Incident Title** / **Alert Title** / **Event Title**                   | Its title.                                                                                                            |
| **Incident Description** / **Alert Description** / **Event Description** | Its description.                                                                                                      |
| **Monitor Name** / **Monitor Description**                               | The name or description of its monitors.                                                                              |

Pick an operator for each condition:

- A list criterion — **Monitors**, the severities and the labels — uses **Has any of**, **Has all of** or **Has none of** the values you pick.
- A text criterion uses **Contains** (where a new condition starts), **Does not contain**, **Equals**, **Does not equal**, **Starts with**, **Ends with**, or **Matches pattern** / **Does not match pattern** for a case-insensitive regular expression or a `*` wildcard. Text comparisons ignore case.

With two or more conditions, choose **Match all** (every condition must be true) or **Match any** (at least one must be).

## Matching semantics

- A rule with no conditions runs on every event of its type (a global "always run" rule).
- Multiple rules can match the same event — every match fires, and the union of their runbooks runs (each runbook gets its own execution).
- Monitor conditions are checked one monitor at a time. With **Match all**, "**Monitor Name** contains `api`" and "**Monitor Labels** has any of _Production_" need one monitor that is both, not one monitor of each.
- Runbook rules run after label rules, so a label that a label rule attaches to a new incident, alert or event can start a runbook.
- A condition on another product's severity — **Alert Severities** on an incident rule, say — can never be true, so the API refuses to save it.

## Example: DB failover for database incidents

```
Name:        Start DB failover for DB incidents
Trigger:     Incident
Conditions:  Incident Title matches pattern (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:    [DB failover playbook, Notify DBA team]
```

This will create two runbook executions every time an incident with "db", "database", "postgres", etc. in the title is created.

## Example: Only for critical production incidents

```
Name:        Flush the CDN cache for critical production incidents
Trigger:     Incident
Conditions:  Match all
             Monitor Labels has any of Production
             Incident Severities has any of Critical
Runbooks:    [Flush CDN cache]
```

Runs for a critical incident on a monitor labelled _Production_, and for nothing on staging.

## Example: Always-run hygiene rule

```
Name:        Always-run pre-flight check
Trigger:     Incident
Conditions:  (none)
Runbooks:    [Capture pre-incident state]
```

Fires on every incident — useful for capturing system state snapshots, page metrics, etc.

## What happens when a rule fires

1. The runbook is loaded.
2. Its steps are **snapshotted** onto a new runbook execution.
3. The execution is enqueued to the Runbook queue worker.
4. The execution is linked to the source entity — it shows up on the incident, alert, or scheduled maintenance event's page and on the runbook's Executions list.

You can see all rule-triggered runs under **Runbooks → Executions**, filtered by status, runbook, or date.

## Disabled runbooks

If a rule references a runbook that has `isEnabled = false`, the rule still matches but the runbook execution is skipped. Re-enable the runbook to resume.

## Testing a rule

Before relying on a rule in production, create a test incident (or alert) that matches the rule's conditions and confirm the expected runbooks fire. Rules are evaluated at the moment of creation — editing an incident's title, severity or labels later does not re-trigger rules.
