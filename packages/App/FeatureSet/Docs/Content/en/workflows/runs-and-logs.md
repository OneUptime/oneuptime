# Runs

Every time a workflow runs, OneUptime saves a record of what happened — when it ran, whether it worked, and what each block did. That record is called a **run**. Runs are how you confirm a workflow worked, debug one that didn't, and look back at past activity.

## Where to find them

| Page                        | What you see                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| **Workflows → Logs → Runs** | Every run from every workflow in the project. Filter by workflow name, status, and time.           |
| **Workflow → Logs → Runs**  | Just the runs of this one workflow. This one has a **Run ID** filter instead of a workflow filter. |
| **A single run**            | Opened with the **View Logs** button on a run row — run rows themselves aren't clickable.          |

## Run statuses

| Status                              | What it means                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Scheduled**                       | The trigger fired and the run is queued for a runner. Usually a fraction of a second. A run still scheduled after 5 minutes is failed — nothing picked it up.                                                                  |
| **Running**                         | The workflow is in progress. Long-running blocks keep a run in this state.                                                                                                                                                     |
| **Waiting**                         | The run is parked on a **Sleep** block and will resume on its own. It holds no worker while it waits.                                                                                                                          |
| **Executed**                        | The run reached the end without failing. (This is the success state — the pill reads **Executed**, not "Success".)                                                                                                             |
| **Error**                           | The run stopped because a block raised an error. Also used when a queued run is never picked up, when a sleeping run's resume is lost, when a schedule expression can't be resolved, or when the workflow is disabled mid-run. |
| **Timeout**                         | The run ran longer than allowed. See [Configuration & Safety](/docs/workflows/configuration).                                                                                                                                  |
| **Execution Exceeded Current Plan** | The project has used up its workflow runs for the last 30 days, or the subscription is unpaid. The run is recorded but not executed. OneUptime Cloud only.                                                                     |

A block that hands off to its **Error** output — an API block on a 4xx, say — doesn't fail the run. The error branch runs and the run still ends **Executed**. The step itself is still drawn in red so you can find it.

## Reading a run

Click **View Logs** on a run to open it. The **Workflow Run** view has two tabs.

**Steps** — the path the run took, one numbered card per block, in the order they ran. Without opening anything, each card shows:

- The block's title and component id, whether it **Succeeded** or **Failed**, and how long it took.
- Which output it took, named as the canvas names it — **Took No**, **Took Success**, **Took Error** — and where that led: **→ Step 3 Send Email**, or **Nothing is connected to it, so the run ended here**. A step it led to that never ran says **(did not run)**. The Error output is drawn in red; Yes and No are just the way the run went. Hover the output's name for what it means.
- The step's error, if it failed, and any warning about it — for example a `{{…}}` reference that resolved to nothing.

Open a card for two blocks of detail:

- **Received** — the settings the block was given, by name and in the order its settings list them, after all variables were resolved. A setting that refers to another step or a variable shows the reference it was configured with next to the value it became, and **Did not resolve** when it became nothing.
- **Returned** — what it produced, with each value's id (the last part of a `returnValues` reference). Lists and objects are shown indented.

Failed steps, steps with a warning, and a run's only step start open.

A run started with **Run just this step** in a block's settings says **Only this step ran** at the top. The steps before it did not run, so values it reads from them are missing (expect a **Did not resolve** warning for those), and the steps after it were not started — their names are shown with **(not run in this test)**. Use **Run Workflow** to try the whole path.

If the run stopped for a reason no step explains — it timed out between steps, or failed before its first step — the path ends with **The run stopped here** and the reason. A run sleeping on a **Sleep** block ends with **Sleeping** and the time it carries on by itself; the steps after the Sleep say **(not run yet)**. The **Steps** tab's count turns red when something failed and amber when a step has a warning.

**Full Log** — the raw line-by-line log the runner printed, including anything the blocks logged themselves. Use it when the Steps view doesn't explain the failure.

Two details worth knowing. The component id printed under each step title is exactly the string to paste into a `{{local.components.<id>.returnValues.…}}` reference, which makes this the fastest way to get a reference right. And a run keeps only its last 100 steps — a long or repeatedly-resumed run shows an amber note where the earlier ones were dropped.

The values shown are what the block received, after variables were filled in and before the block itself did anything with them, with two exceptions: secrets and fields the block marks sensitive are redacted, and very long values are cut short with "… (truncated)". Runs recorded before output names were kept show the output from its id, without where it led.

Starting a run from the **Builder** opens this same view already following the run, so you can watch it happen rather than going looking for it afterwards.

## Common debugging

### "My workflow didn't run."

1. Make sure the workflow is **Enabled** on its **Overview** page. New workflows start disabled, and a disabled workflow rejects every run — including manual ones.
2. For a OneUptime event trigger: confirm the event actually happened. Open the record and check its history.
3. For a webhook trigger: confirm the other system is sending to the right URL. Most tools log when they send a webhook — check there.
4. For a schedule trigger: confirm the cron expression matches the time you expect.

If the run _does_ appear with the status **Execution Exceeded Current Plan**, the project has used all its workflow runs for the last 30 days, or the subscription is unpaid. The run's log names the count and your plan's limit. This applies to OneUptime Cloud only.

### "A later block never ran."

A block that doesn't run is usually a wiring problem. Open the **Builder** and check:

- Is the earlier block's output connected to this block's input?
- Did the earlier block take a different output than you expected — **Error** instead of **Success**, or **No** instead of **Yes**? The Steps tab says which one it took (**Took No**) and where that led; **Nothing is connected to it** means the output it took isn't wired to anything.

### "A variable came through empty."

Open the run and look at the step. A reference that didn't resolve is called out on the step itself as a warning, and its setting in the **Received** block is marked **Did not resolve**.

- If you see the literal `{{local.components.…}}` text, the reference didn't resolve. Usually that's a typo in the component id or the return-value id — remember it's the block's **Identifier**, not the name displayed on it. Check the spelling of `local.components` itself too: `{{local.componets.api-get-1.returnValues.response-body}}` is sent as literal text and the run still reports **Executed**. If the run was a **Run just this step** test, the earlier block didn't run at all — run the whole workflow instead.
- If you see **Empty text**, the earlier block ran but didn't produce that field.

The same warning is in the **Full Log** tab as a line starting with `Warning:`.

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
