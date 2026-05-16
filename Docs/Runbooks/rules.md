# Runbook rules

Runbook rules attach runbooks automatically when an **incident**, **alert**, or **scheduled maintenance event** is created. They're managed from each entity's Settings menu:

- Incidents → Settings → **Runbook Rules**
- Alerts → Settings → **Runbook Rules**
- Scheduled Maintenance → Settings → **Runbook Rules**

All three pages edit the same underlying `RunbookRule` model — they're just filtered to show only rules for that entity type.

## Anatomy of a rule

| Field | Purpose |
| --- | --- |
| **Name** | Short, human label. Shown in audit logs. |
| **Description** | Optional context for teammates. |
| **Enabled** | Toggle to suspend a rule without deleting it. |
| **Title Pattern** | Case-insensitive regex matched against the entity's title. Empty = match any title. |
| **Description Pattern** | Case-insensitive regex matched against the entity's description. Empty = match any description. |
| **Runbooks to Start** | One or more runbooks to launch when the rule fires. |

## Matching semantics

A rule matches when **all specified criteria pass**. Empty criteria are skipped, so:

- A rule with no patterns set runs on every event of its type (a global "always run" rule).
- A rule with only a title pattern fires on events whose title matches that regex.
- Multiple rules can match the same event — every match fires, and the union of their runbooks runs (each runbook gets its own execution).

## Example: DB failover for database incidents

```
Name:           Start DB failover for DB incidents
Trigger:        Incident
Title Pattern:  (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:       [DB failover playbook, Notify DBA team]
```

This will create two runbook executions every time an incident with "db", "database", "postgres", etc. in the title is created.

## Example: Always-run hygiene rule

```
Name:           Always-run pre-flight check
Trigger:        Incident
Title Pattern:  (empty)
Description Pattern: (empty)
Runbooks:       [Capture pre-incident state]
```

Fires on every incident — useful for capturing system state snapshots, page metrics, etc.

## What happens when a rule fires

1. The runbook is loaded.
2. Its steps are **snapshotted** onto a new `RunbookExecution` row.
3. The execution is enqueued to the Runbook queue worker.
4. The execution is linked to the source entity — it shows up on the incident/alert/SM event's page and on the Runbook's Executions list.

You can see all runbook-rule-triggered runs under **Runbooks → Executions**, filtered by status, runbook, or date.

## Disabled runbooks

If a rule references a runbook that has `isEnabled = false`, the rule still matches but the runbook execution is skipped. Re-enable the runbook to resume.
