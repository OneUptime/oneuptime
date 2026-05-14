# Runbook Configuration & Safety

## Output caps

- Per-step output: **50KB**. Larger output is truncated with a marker.
- Per-step timeout default: **30 seconds** for JavaScript, Bash, and HTTP. Configurable per step.
- Bash and JavaScript step **claim timeout** default: **2 minutes** — the Worker waits up to this long for a Runbook Agent to pick up the job before failing it.

## Permissions

Runbook permissions live in the `Runbook` permission group:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — manage runbook templates.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — start, tick off, and read executions.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — manage auto-trigger rules.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — manage Runbook Agents that execute Bash steps in your own infrastructure.
- `RunbookManager` (role) — bundles all of the above; assign to a team to give it full runbook capabilities.

## Queue & worker

Runbook executions run on the `Runbook` BullMQ queue. The worker concurrency is 25 — adjust in your deployment if you have many simultaneous runs.

When a manual step is ticked off via the API, the execution is re-enqueued to continue from the next step. This keeps the worker hot for the rest of the runbook.

## Hardening notes

- **Bash and JavaScript steps** never run on the OneUptime Worker. They are dispatched as jobs to a [Runbook Agent](/docs/runbooks/agents) that you installed inside your own infrastructure. The Worker enqueues the job tagged with the step's **Agent Tag** and step type, an agent claims it atomically, runs it locally — Bash via `bash -c <script>`, JavaScript inside an `isolated-vm` sandbox with the usual prelude (severs prototype chains, removes `Function` and `eval`, freezes built-in prototypes) — and posts the result back. The Worker process itself does not run customer scripts.
- **HTTP steps** use a permissive status validator, so a 4xx or 5xx response is recorded as a failed step rather than thrown. This makes the captured output reflect what the upstream actually returned.

## Database tables

- `Runbook` — template (name, slug, description, isEnabled, steps JSON).
- `RunbookExecution` — one row per run, with nullable `incidentId`, `alertId`, and `scheduledMaintenanceId` foreign keys and a JSON `stepExecutions` array snapshotting the steps and per-step state.
- `RunbookRule` — auto-trigger rules with a `triggerEntityType` discriminator (Incident, Alert, ScheduledMaintenance) and a many-to-many relationship to runbooks to start.
- `RunbookAgent` — one row per installed agent: name, tags, secret key, `lastAlive`, `connectionStatus`, host info.
- `RunbookAgentJob` — one row per dispatched Bash or JavaScript step: required tag, step type, script, status (Pending → Claimed → Running → Succeeded/Failed/TimedOut/Cancelled), claim deadline, lease, output, exit code.

## Operational tips

- **Run at least one agent per tag you target**, and ideally two for high availability. With two agents carrying the same tag, either may claim a job — you can roll restarts without breaking runbooks.
- **Capture URLs, not blobs.** If a step generates more than a few KB of output, write it to S3 or your logging stack and return the URL.
- **Idempotency matters.** Automated steps (HTTP, JavaScript, Bash) may run more than once if the worker restarts mid-step or if an agent's lease expires while a script is still running; design them to be safe to retry.
