# Authoring a Runbook

Create a runbook under **Runbooks → Create Runbook**, then open it and go to the **Steps** tab.

## Anatomy of a step

Every step has:

| Field | Purpose |
| --- | --- |
| **Title** | Short label shown in the checklist UI. Required. |
| **Description** | Optional context for the responder. Markdown-safe text. |
| **Continue on failure** | If on, a failing step doesn't stop the run — the next step still executes. |
| **Type-specific config** | Script, URL, etc. — see below. |

Steps run **in order**. Reorder them with the up/down arrows on the Steps editor.

## Step types

### Manual

A checkbox the responder ticks off. The runbook execution pauses when it reaches a Manual step and stays in `WaitingForManualStep` until someone marks it complete (or skips it).

Use this for things only a human can verify: "Confirmed traffic has moved to the secondary region in the load balancer dashboard."

### JavaScript

A snippet of JavaScript run in a sandboxed `isolated-vm` (no filesystem, no network unless you bring an API).

```js
const start = Date.now();
// ... your logic ...
return { durationMs: Date.now() - start };
```

The returned value is captured on the step execution. `console.log` output is captured as log lines. Default timeout: 30 seconds.

### HTTP request

Make an outbound HTTP call. Configure method (GET/POST/PUT/PATCH/DELETE/HEAD), URL, optional JSON headers, and optional body. Response status, headers, and body are captured (capped at 50KB total).

Useful for: kicking off a PagerDuty incident, posting to Slack, calling your own admin API, etc.

### Bash

A bash script that runs on a [Runbook Agent](/docs/runbooks/agents) — a small process you install on a host inside your own infrastructure. Bash steps never execute on the OneUptime Worker.

Configure two things on a Bash step:

- **Agent Tag** — the tag identifying which agent(s) should run this step. Any healthy agent in the project carrying that tag will claim and run the job.
- **Script** — the bash to run. Output (stdout + stderr) is captured up to 50 KB; the process is killed on timeout.

If no agent carrying the chosen tag is online when the runbook reaches this step, the step waits up to the **claim timeout** (default 2 minutes) and then fails. Add an agent under **Runbooks → Agents** before relying on a Bash step.

## Saving and editing

Hit **Save Steps** to persist. In-flight executions of older versions of the runbook are unaffected — they keep using their snapshot.

## Multiple steps and failure handling

By default, a failing step halts the run and marks the execution `Failed`. If you set **Continue on failure** on a step, a failure is recorded but the next step runs. This is useful for "try these three things, then notify" patterns.

## A worked example

A simple runbook for "DB primary unreachable":

1. **JavaScript** — fetch the current primary host from your config service and log it.
2. **Manual** — "Confirm replication lag in the secondary is under 5 seconds."
3. **HTTP request** — POST to your failover orchestrator's API.
4. **Manual** — "Verify writes are now going to the new primary."
5. **HTTP request** — POST to Slack with an "all clear" message.

The responder watches an automated step run, ticks off a manual one, watches the next automated step run, and so on. Each step's output is captured for the post-mortem.
