# Configuration & safety

## Environment flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `RUNBOOK_BASH_ENABLED` | `false` | Set to `true` on the API/Worker container to enable Bash steps. Disabled by default since bash runs as the Worker process user. |

## Output caps

- Per-step output: **50KB** (`MAX_OUTPUT_BYTES` in `App/FeatureSet/Runbook/Services/StepExecutors.ts`). Larger output is truncated with a marker.
- Per-step timeout default: **30 seconds** for JS and Bash, **30 seconds** for HTTP. Configurable per step.

## Permissions

Runbook permissions live in the `Runbook` permission group:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — manage runbook templates.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — read/tick-off executions.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — manage auto-trigger rules.
- `RunbookManager` (role) — bundles all of the above; assign to a team to give it full runbook capabilities.

## Queue & worker

Runbook executions run on the `Runbook` BullMQ queue. The worker concurrency is 25 — adjust in `App/FeatureSet/Runbook/Index.ts` if you have a deployment that fires many large runs.

When a manual step is ticked off via the API, the execution is re-enqueued to continue from the next step. This keeps the worker hot for the rest of the runbook.

## Hardening notes

- **JavaScript steps** run in `isolated-vm` with a sandbox-hardening prelude (severs prototype chains, removes `Function`/`eval`, freezes built-in prototypes). See `Common/Server/Utils/VM/VMRunner.ts` for the full prelude.
- **Bash steps** run via `child_process.spawn` with timeout and SIGKILL on overrun. They inherit `PATH` from the Worker process. For multi-tenant deployments, run bash via the Probe/InfrastructureAgent on a customer-controlled host rather than on the API server.
- **HTTP steps** use axios with `validateStatus: () => true`, so a 4xx/5xx response is recorded as a failed step (not thrown). This makes the captured output reflect what the upstream actually returned.

## Database tables

- `Runbook` — template (name, slug, description, isEnabled, steps JSON).
- `RunbookExecution` — one row per run, with nullable `incidentId` / `alertId` / `scheduledMaintenanceId` FKs and a JSON `stepExecutions` array snapshotting the steps + per-step state.
- `RunbookRule` — auto-trigger rules with `triggerEntityType` discriminator (Incident, Alert, ScheduledMaintenance) and many-to-many `RunbookRuleRunbook` for the runbooks to start.
