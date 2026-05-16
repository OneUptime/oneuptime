# Running a runbook

There are three ways a runbook execution gets created:

1. **Automatically via a rule** — see [Runbook rules](./rules.md).
2. **Manually from the runbook page** — click **Run Now** on a runbook's overview page. Not attached to any incident/alert/SM.
3. **Manually from an entity feed** — click **Run Runbook** on an incident, alert, or scheduled maintenance event. The execution is attached to that entity.

## The execution view

Open any execution to see its checklist UI. Each step shows:

- **Status pill** — Pending, Running, Waiting for you, Done, Skipped, Failed.
- **Title and description** — copied from the runbook at execution time.
- **Output** (collapsible) — stdout, return values, HTTP responses.
- **Error message** if the step failed.
- For Manual steps in `WaitingForUser`: **Mark Complete** and **Skip** buttons.

The page polls every 3 seconds while the execution isn't terminal, so you'll see automated steps complete in near-real-time.

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

Per-step output is capped at **50KB** to prevent runaway scripts from bloating the database. If you need bigger artifacts, write them to S3 / a logger from the script and store the URL in the return value.
