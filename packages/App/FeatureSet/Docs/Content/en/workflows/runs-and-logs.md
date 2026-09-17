# Runs & Logs

Every time a workflow runs, OneUptime saves a record of what happened — when it ran, whether it worked, and what each block did. That record is called a **run**. Runs are how you confirm a workflow worked, debug one that didn't, and look back at past activity.

## Where to find them

| Page                        | What you see                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Workflows → Runs & Logs** | Every run from every workflow in the project. Filter by workflow name, status, and time.           |
| **Workflow → Runs & Logs**  | Just the runs of this one workflow. This one has a **Run ID** filter instead of a workflow filter.  |
| **A single run**            | Opened with the **View Logs** button on a run row — run rows themselves aren't clickable.           |

## Run statuses

| Status                             | What it means                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduled**                      | The trigger fired and the run is queued for a runner. Usually a fraction of a second. A run still scheduled after 5 minutes is failed — nothing picked it up. |
| **Running**                        | The workflow is in progress. Long-running blocks keep a run in this state.                                                                                |
| **Waiting**                        | The run is parked on a **Sleep** block and will resume on its own. It holds no worker while it waits.                                                      |
| **Executed**                       | The run reached the end without failing. (This is the success state — the pill reads **Executed**, not "Success".)                                        |
| **Error**                          | The run stopped because a block raised an error. Also used when a queued run is never picked up, when a sleeping run's resume is lost, when a schedule expression can't be resolved, or when the workflow is disabled mid-run. |
| **Timeout**                        | The run ran longer than allowed. See [Configuration & Safety](/docs/workflows/configuration).                                                              |
| **Execution Exceeded Current Plan** | The project has used up its workflow runs for the last 30 days, or the subscription is unpaid. The run is recorded but not executed. OneUptime Cloud only. |

A block that hands off to its **Error** output — an API block on a 4xx, say — doesn't fail the run. The error branch runs and the run still ends **Executed**. The step itself is still drawn in red so you can find it.

## Reading a run

Click **View Logs** on a run to open it. The **Workflow Run** view has two tabs.

**Steps** — one row per block that ran, in order. Each row shows the block's title, its component id, how long it took, and the output it left by (`→ success`, `→ error`, `→ yes`). Expand a row for two blocks of detail:

- **Received** — the settings the block was given, after all variables were resolved.
- **Returned** — what it produced.

Failed steps are red and start expanded, with the error message printed above **Received**.

**Full Log** — the raw line-by-line log the runner printed, including anything the blocks logged themselves. Use it when the Steps view doesn't explain the failure.

Two details worth knowing. The component id printed under each step title is exactly the string to paste into a `{{local.components.<id>.returnValues.…}}` reference, which makes this the fastest way to get a reference right. And a run keeps only its last 100 steps — a long or repeatedly-resumed run shows an amber note where the earlier ones were dropped.

The values shown are what the block saw after variables were filled in, with two exceptions: secrets and fields the block marks sensitive are redacted, and very long values are cut short with "… (truncated)".

Starting a run from the **Builder** opens this same view already following the run, so you can watch it happen rather than going looking for it afterwards.

## Common debugging

### "My workflow didn't run."

1. Make sure the workflow is **Enabled** on its **Overview** page. New workflows start disabled, and a disabled workflow rejects every run — including manual ones.
2. For a OneUptime event trigger: confirm the event actually happened. Open the record and check its history.
3. For a webhook trigger: confirm the other system is sending to the right URL. Most tools log when they send a webhook — check there.
4. For a schedule trigger: confirm the cron expression matches the time you expect.

If the run *does* appear with the status **Execution Exceeded Current Plan**, the project has used all its workflow runs for the last 30 days, or the subscription is unpaid. The run's log names the count and your plan's limit. This applies to OneUptime Cloud only.

### "A later block never ran."

A block that doesn't run is usually a wiring problem. Open the **Builder** and check:

- Is the earlier block's output connected to this block's input?
- Did the earlier block take a different output than you expected — **Error** instead of **Success**, or **No** instead of **Yes**? The Steps tab shows which one it took.

### "A variable came through empty."

Open the run and look at the failing step's **Received** block.

- If you see the literal `{{local.components.…}}` text, the reference didn't resolve. Usually that's a typo in the component id or the return-value id — remember it's the block's **Identifier**, not the name displayed on it. Check the spelling of `local.components` itself too: `{{local.componets.api-get-1.returnValues.response-body}}` is sent as literal text and the run still reports **Executed**.
- If you see an empty string, the earlier block ran but didn't produce that field.

The **Full Log** tab carries a warning line naming any reference that didn't resolve, which is usually the fastest way to find it.

### "It works when I run it by hand but not from the trigger."

Open the **Builder**, click **Run Workflow**, and fill the trigger's fields with values that look like what the real trigger sends. Then compare that run's **Received** values against the real run's, side by side. The difference is usually a single field name or type.

## Re-running a workflow

There's no "retry this run" button. We don't re-run old executions automatically because the side effects — Slack messages, API calls, tickets — might not be safe to repeat. To redo the work, fix the workflow and let the next real trigger fire it, or open the **Builder** and click **Run Workflow** with the same values.

## How long are runs kept?

On OneUptime Cloud, runs are kept for **30 days** and then deleted — that's why both run lists describe themselves as covering the last 30 days. Self-hosted installs keep runs until you delete them; if a workflow runs very often and clutters your history, disable or delete it to stop adding to the noise.

Runs recorded before step tracing was added have no **Steps** content and show only their **Full Log**.

## Where to read next

- [Configuration & Safety](/docs/workflows/configuration) — timeouts, recursion limits, hidden secrets.
- [Variables](/docs/workflows/variables) — the variable syntax used in your blocks.
- [Components](/docs/workflows/components) — what each block produces.
