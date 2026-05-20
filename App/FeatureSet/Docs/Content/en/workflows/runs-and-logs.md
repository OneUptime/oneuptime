# Runs & Logs

Every time a workflow's trigger fires, OneUptime creates a **run** — a record of one execution with timing, status, and per-node output. Runs are how you confirm a workflow worked, how you debug one that didn't, and how you write a postmortem when an automation misbehaves.

## Where to find them

| Page | Scope |
| --- | --- |
| **Workflows → Runs & Logs** | Project-wide. Every run of every workflow. Filter by workflow, status, and time range. |
| **A workflow's Logs tab** | Just the runs of this workflow. |
| **A run's detail page** | One execution, expanded with per-node output and any error messages. |

## Run statuses

| Status | Meaning |
| --- | --- |
| **Scheduled** | The trigger fired and the run is queued, but the worker has not picked it up yet. Usually a fraction of a second. |
| **Running** | The worker is currently walking the graph. Long-running components (slow HTTP calls, intentional delays) keep a run in this state. |
| **Success** | Every node that ran finished without error. (A workflow that took an `error` branch deliberately is still `Success` overall — the workflow itself didn't fail.) |
| **Error** | A node failed and there was no `error` port wired to handle it. The run stopped at that node. |
| **Timeout** | The run exceeded the per-run timeout. See [Configuration & Safety](/docs/workflows/configuration). |

## Reading a run

Click a run from the list to open its detail page. You see:

- **Header** — the trigger that fired, the start and end timestamp, total duration, status.
- **Node list** — every node that executed in order, each with its captured arguments, its return value, and its chosen output port.
- **Errors** — if a node failed, the error message and (when available) the stack trace.

The captured arguments show *post-interpolation* values — i.e., the exact strings the node saw after variables were resolved. This is the single most useful debugging view: if a Slack message has the literal text `{{Incident.title}}` in it, you know the variable reference didn't resolve.

## Common debugging patterns

### "My workflow didn't fire."

1. Confirm the workflow is **enabled** in **Settings**. New workflows ship disabled.
2. For a model-event trigger: confirm the event actually happened. Open the entity (the incident, alert, monitor) and look at its history.
3. For a webhook trigger: confirm the external system is hitting the right URL. Many tools log outbound webhook delivery — check there.
4. For a schedule trigger: confirm the cron expression evaluates to the time you expect. Use a cron parser if in doubt.

If the trigger fired but no run shows up, check the project's run quota under **Project Settings → Billing**.

### "It runs but a downstream node never executes."

A node that doesn't run is usually a wiring issue. Open the canvas and check:

- Is the upstream node's output port actually connected to this node's input port?
- Did the upstream node take a different port (e.g., `error` instead of `success`, or `no` instead of `yes`)? Look at the run detail to see which port it chose.

### "A variable comes through empty."

Open the run detail and look at the failing node's captured arguments. If you see the literal `{{NodeId.field}}` text, the reference didn't resolve — likely a typo in `NodeId` or `field`. If you see an empty string, the upstream node ran but didn't produce that field.

### "It works manually but not from the trigger."

Use **Run Manually** with a JSON payload that mirrors what the real trigger publishes. Then compare the captured arguments in the manual run vs. the production run side by side — the difference is usually in a single field name or type.

## Re-running a workflow

There's no "retry this run" button — by design, OneUptime never re-executes an old run, because the outbound side effects (Slack messages, API calls) might not be idempotent. If you want to redo the work, fix the workflow and let the next real trigger fire it.

For manual workflows, just click **Run Manually** with the same payload.

## Log retention

Runs are kept indefinitely on the project. If you need to clean up high-volume noisy workflows (e.g., a debug workflow that fires every minute), disable or delete them — there is no per-workflow retention toggle.

## Where to read next

- [Configuration & Safety](/docs/workflows/configuration) — timeouts, recursion limits, secret redaction.
- [Variables](/docs/workflows/variables) — the syntax that interpolated arguments use.
- [Components](/docs/workflows/components) — the return-value fields each component publishes.
