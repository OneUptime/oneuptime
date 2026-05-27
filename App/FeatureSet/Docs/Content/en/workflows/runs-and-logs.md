# Runs & Logs

Every time a workflow runs, OneUptime saves a record of what happened — when it ran, whether it worked, and what each block did. That record is called a **run**. Runs are how you confirm a workflow worked, debug one that didn't, and look back at past activity.

## Where to find them

| Page | What you see |
| --- | --- |
| **Workflows → Runs & Logs** | Every run from every workflow in the project. Filter by workflow, status, and time. |
| **Workflow → Logs tab** | Just the runs of this one workflow. |
| **A single run** | One execution, with the output of every block. |

## Run statuses

| Status | What it means |
| --- | --- |
| **Scheduled** | The trigger fired and the run is about to start. Usually only takes a fraction of a second. |
| **Running** | The workflow is in progress. Long-running blocks keep a run in this state. |
| **Success** | Every block that ran finished without error. (Taking an **error** branch on purpose still counts as success — the workflow itself didn't fail.) |
| **Error** | A block failed and there was no **error** path connected to handle it. The run stopped there. |
| **Timeout** | The run ran longer than allowed. See [Configuration & Safety](/docs/workflows/configuration). |

## Reading a run

Click any run to open the details. You'll see:

- **Header** — the trigger, start and end time, total duration, and status.
- **Block list** — every block that ran, in order. Each one shows the values it was given, its output, and which path it took.
- **Errors** — if a block failed, the error message and (when available) more details.

The values shown are exactly what the block saw — after all variables were filled in. This is the single most useful debugging view: if a Slack message shows the literal text `{{Incident.title}}` instead of the actual title, you know the variable didn't resolve.

## Common debugging

### "My workflow didn't run."

1. Make sure the workflow is **enabled** in Settings. New workflows start disabled.
2. For a OneUptime event trigger: confirm the event actually happened. Open the record and check its history.
3. For a webhook trigger: confirm the other system is sending to the right URL. Most tools log when they send a webhook — check there.
4. For a schedule trigger: confirm the cron expression matches the time you expect.

If the trigger fired but no run shows up, check your run quota under **Project Settings → Billing**.

### "A later block never ran."

A block that doesn't run is usually a wiring problem. Open the canvas and check:

- Is the earlier block's output connected to this block's input?
- Did the earlier block take a different output than you expected (for example, **error** instead of **success**, or **No** instead of **Yes**)? The run detail shows which path was taken.

### "A variable came through empty."

Open the run and look at the failing block's values.

- If you see the literal `{{BlockName.field}}` text, the reference didn't resolve — probably a typo in the block name or field name.
- If you see an empty string, the earlier block ran but didn't produce that field.

### "It works when I run it manually but not from the trigger."

Use **Run Manually** with a JSON payload that looks like what the real trigger sends. Then compare the values in the manual run to the real run side by side. The difference is usually a single field name or type.

## Re-running a workflow

There's no "retry this run" button. We don't re-run old executions automatically because the side effects (Slack messages, API calls, tickets) might not be safe to repeat. To redo the work, fix the workflow and let the next real trigger fire it.

For manual workflows, just click **Run Manually** with the same payload.

## How long are runs kept?

Runs are kept indefinitely for the project. If a workflow runs very often and clutters your history (like a debug workflow that fires every minute), disable or delete it to stop adding to the noise.

## Where to read next

- [Configuration & Safety](/docs/workflows/configuration) — timeouts, recursion limits, hidden secrets.
- [Variables](/docs/workflows/variables) — the variable syntax used in your blocks.
- [Components](/docs/workflows/components) — what each block produces.
