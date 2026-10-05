# Running a Runbook

There are three ways a runbook execution gets created:

1. **Automatically via a rule** — see [Runbook Rules](/docs/runbooks/rules).
2. **Manually from the runbook page** — click **Run Now** on a runbook's overview page. Not attached to any incident, alert, or scheduled maintenance event.
3. **Manually from an entity feed** — click **Run Runbook** on an incident, alert, or scheduled maintenance event. The execution is attached to that entity.

## The execution view

Open any execution to see its checklist UI. Each step shows:

- **Status pill** — Pending, Running, Waiting for you, Done, Skipped, Failed.
- **Title and description** — copied from the runbook at execution time.
- **Output** (collapsible) — stdout, return values, HTTP responses.
- **Error message** if the step failed.
- On the step the run is waiting on: **Mark complete** (a Manual step) or **Approve & continue** (a step with **Require approval**), and **Skip**.
- While the run is paused, **Skip** on later automated steps that don't require approval.

The page polls every 3 seconds while the execution isn't terminal, so you'll see automated steps complete in near-real-time.

## Completing, approving and skipping steps

Only the step the run is waiting on can be marked complete, approved, or skipped to continue the run. A Manual step or a step with **Require approval** can't be ticked off or skipped before the run reaches it — its job is to stop the run, so it only takes a decision once the run is there (for an approval, once the step has run and you can see its output).

While the run is paused, you can also skip a later automated step that doesn't require approval, so it won't run when the run continues. The run stays paused on the step that is waiting for you. Skipping isn't available while steps are running — wait for the run to pause, or cancel it. Each step records who completed or skipped it.

## Interleaving manual and automated steps

The classic flow:

1. **Script step**: capture system state, write to S3.
2. **Manual step**: "Notify customers via the status page banner." Responder ticks it off.
3. **HTTP step**: page the DBA via PagerDuty.
4. **Manual step**: "Confirm secondary DB is now primary." Responder ticks it off.
5. **Script step**: send the all-clear Slack message.

Steps 2 and 4 pause execution until ticked. Steps 1, 3, 5 run automatically. The entire run is one execution, one timeline, one source of truth.

## Cancelling a run

Click **Cancel Execution** on the execution page. The current step (if any) finishes; subsequent steps don't start. Status becomes `Cancelled`.

## Output retention

Per-step output is capped at **50KB** to prevent runaway scripts from bloating the database. If you need bigger artifacts, write them to S3 or a logger from the script and store the URL in the return value.

## Re-running a runbook

A runbook execution is a one-shot, immutable record. To re-run, click **Run Now** again — that creates a fresh execution with a fresh snapshot of the runbook's current steps. The original execution stays intact for the audit trail.

## Finding past executions

Every runbook has an **Executions** tab listing all of its runs, with filters for status, date range, and source entity. From an incident, alert, or scheduled maintenance event, the **Runbooks** tab shows runs attached to that entity.
