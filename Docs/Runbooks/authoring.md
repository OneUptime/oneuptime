# Authoring a runbook

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

A bash script run via `child_process.spawn`. **Disabled by default** for safety — see [Configuration](./configuration.md) to enable.

When enabled, the script runs as the Worker process user with the inherited `PATH`. Output (stdout + stderr) is captured; the process is killed on timeout.

Long-term, bash steps should run through a Probe/Infrastructure agent rather than the API host. For trusted, single-tenant deployments, server-side bash is acceptable.

## Saving and editing

Hit **Save Steps** to persist. In-flight executions of older versions of the runbook are unaffected — they keep using their snapshot.

## Multiple steps and failure handling

By default, a failing step halts the run and marks the execution `Failed`. If you set **Continue on failure** on a step, a failure is recorded but the next step runs. This is useful for "try these three things, then notify" patterns.
