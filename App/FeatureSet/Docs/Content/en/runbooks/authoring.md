# Authoring a Runbook

Create a runbook under **Runbooks → Create Runbook**, then open it and go to the **Steps** tab.

## Anatomy of a step

Every step has:

| Field | Purpose |
| --- | --- |
| **Title** | Short label shown in the checklist UI. Required. |
| **Description** | Optional context for the responder. Markdown-safe text. |
| **Continue on failure** | If on, a failing step doesn't stop the run — the next step still executes. |
| **Require approval** | If on, the runbook pauses after this step and waits for a user to approve before running the next step. |
| **Type-specific config** | Script, URL, agent, etc. — see below. |

Steps run **in order**. Reorder them with the up/down arrows on the Steps editor.

## Step types

### Manual

A checkbox the responder ticks off. The runbook execution pauses when it reaches a Manual step and stays in `WaitingForManualStep` until someone marks it complete (or skips it).

Use this for things only a human can verify: "Confirmed traffic has moved to the secondary region in the load balancer dashboard."

### JavaScript

A snippet of JavaScript run in a sandboxed `isolated-vm`. The sandbox lives on a [Runbook Agent](/docs/runbooks/agents) inside your own infrastructure — not on the OneUptime Worker.

Configure two things on a JavaScript step:

- **Runbook Agent** — pick the agent that should run this step from the dropdown. Only the selected agent may claim the job.
- **Script** — the JavaScript to run.

```js
const start = Date.now();
// ... your logic ...
return { durationMs: Date.now() - start };
```

The returned value is captured on the step execution. `console.log` output is captured as log lines. Default execution timeout: 30 seconds. Default claim timeout (how long the Worker waits for the agent to pick the job up): 2 minutes.

### HTTP request

Make an outbound HTTP call. Configure method (GET/POST/PUT/PATCH/DELETE/HEAD), URL, optional JSON headers, and optional body. Response status, headers, and body are captured (capped at 50KB total).

Useful for: kicking off a PagerDuty incident, posting to Slack, calling your own admin API, etc. HTTP steps run on the OneUptime Worker directly; no agent required.

### Bash

A bash script (`bash -c <script>`) run on a [Runbook Agent](/docs/runbooks/agents) in your own infrastructure. Bash never executes on the OneUptime Worker.

Configure two things on a Bash step:

- **Runbook Agent** — pick the agent that should run this step from the dropdown. Only the selected agent may claim the job.
- **Script** — the bash to run. Output (stdout + stderr) is captured up to 50 KB; the process is killed on timeout.

If the selected agent is offline when the runbook reaches this step, the step waits up to the **claim timeout** (default 2 minutes) and then fails with `TimedOut`. Add an agent under **Runbooks → Settings → Agents** before relying on a Bash step.

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
