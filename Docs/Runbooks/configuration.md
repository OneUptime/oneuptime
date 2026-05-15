# Configuration & safety

## How Bash and JavaScript actually run

Bash and JavaScript steps **never execute on the OneUptime Worker**. They are dispatched as jobs to a specific [Runbook Agent](./agents.md) — a small process you install on a host inside your own infrastructure.

The dispatch model:

1. The runbook step author picks a Runbook Agent from the dropdown when writing the step.
2. When the step runs, the Worker inserts a row in `RunbookAgentJob` with `targetAgentId` set to that agent's ID and status `Pending`.
3. That specific agent (and only that agent) atomically claims the job, runs the script locally — Bash via `bash -c <script>`, JavaScript inside an `isolated-vm` sandbox — and posts the result back.
4. The Worker resumes the runbook with the result.

There is no `RUNBOOK_BASH_ENABLED` environment flag any more. Whether Bash works in a deployment depends entirely on whether there is at least one connected Runbook Agent in the project.

## Output caps and timeouts

- Per-step output: **50&nbsp;KB** (`MAX_OUTPUT_BYTES` in `App/FeatureSet/Runbook/Services/StepExecutors.ts`). Larger output is truncated with a marker.
- Per-step execution timeout default: **30 seconds** for JavaScript and Bash, **30 seconds** for HTTP. Configurable per step.
- Per-step **claim timeout** for Bash and JavaScript steps: **2 minutes** — how long the Worker waits for the selected agent to pick up the job before failing it.

## Permissions

Runbook permissions live in the `Runbook` permission group:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — manage runbook templates.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — read/tick-off executions.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — manage auto-trigger rules.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — manage Runbook Agents.
- `RunbookManager` (role) — bundles all of the above; assign to a team to give it full runbook capabilities.

## Queue & worker

Runbook executions run on the `Runbook` BullMQ queue. The worker concurrency is 25 — adjust in `App/FeatureSet/Runbook/Index.ts` if you have a deployment that fires many large runs.

When a manual step is ticked off via the API, the execution is re-enqueued to continue from the next step. This keeps the worker hot for the rest of the runbook.

## Hardening notes

- **JavaScript and Bash** run on a Runbook Agent host you control, not on the OneUptime Worker. JavaScript is wrapped in an `isolated-vm` sandbox with the usual prelude (severs prototype chains, removes `Function`/`eval`, freezes built-in prototypes) — see `Common/Server/Utils/VM/VMRunner.ts`. Bash runs via `bash -c` with timeout enforcement on the agent.
- **HTTP steps** use axios with `validateStatus: () => true`, so a 4xx/5xx response is recorded as a failed step (not thrown). This makes the captured output reflect what the upstream actually returned.
- **Agent auth** is by ID + secret key, set on the agent container as env vars. Server-side, the authoritative agent identity comes from the DB row keyed by the presented ID/key — clients cannot impersonate a different agent even with a compromised key.

## Database tables

- `Runbook` — template (name, slug, description, isEnabled, steps JSON).
- `RunbookExecution` — one row per run, with nullable `incidentId` / `alertId` / `scheduledMaintenanceId` FKs and a JSON `stepExecutions` array snapshotting the steps + per-step state.
- `RunbookRule` — auto-trigger rules with `triggerEntityType` discriminator (Incident, Alert, ScheduledMaintenance) and many-to-many `RunbookRuleRunbook` for the runbooks to start.
- `RunbookAgent` — one row per installed agent (name, description, secret key, `lastAlive`, `connectionStatus`, host info).
- `RunbookAgentJob` — one row per dispatched Bash/JavaScript step: `targetAgentId` (the agent the step author picked), `stepType`, `script`, status (`Pending` → `Claimed` → `Running` → `Succeeded` / `Failed` / `TimedOut` / `Cancelled`), claim deadline, lease, output, exit code.
