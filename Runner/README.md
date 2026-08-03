# OneUptime Runner

One self-hosted agent that does the work OneUptime cannot do from the outside.

A Runner runs **inside your infrastructure**, holds **your** credentials, and
talks to OneUptime over a single outbound HTTPS connection. It accepts no
inbound connections and never exposes a port to OneUptime.

It serves two kinds of work, each independently switchable:

| Capability | Default | What it does |
| --- | --- | --- |
| Runs Runbooks | on | Claims Bash and JavaScript runbook steps and executes them here, so the systems being operated on never need to be reachable from OneUptime. |
| Runs AI Code Fixes | off | Claims AI code-fix runs, works in your connected code repositories and opens **draft** pull requests. Never writes to the default or protected branches. |

Capabilities are set **in the dashboard**, on the Runner itself — the container
picks them up when it starts, and turning one off stops the Runner taking that
work right away. Nothing needs to be redeployed to revoke a capability.

## Install

Create a Runner in the dashboard (**Runbooks → Runners → Create**), copy the id
and key it shows you once, then run:

```bash
docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<runner-id> \
  -e ONEUPTIME_RUNNER_KEY=<runner-key> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/runner:release
```

To let this Runner open AI fix pull requests as well, turn on **Runs AI Code
Fixes** on the Runner in the dashboard and restart the container.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `ONEUPTIME_URL` | — | Required. Your OneUptime server. |
| `ONEUPTIME_RUNNER_ID` | — | Required for project-scoped Runners (the normal case). |
| `ONEUPTIME_RUNNER_KEY` | — | Required. Shown once at creation; rotate by resetting it in the dashboard. |
| `ONEUPTIME_RUNNER_NAME` | — | Optional friendly name. |
| `ONEUPTIME_RUNNER_ENABLE_RUNBOOKS` | unset | Local override. Only `false` has an effect: it refuses runbook work on this host even when the dashboard grants it. |
| `ONEUPTIME_RUNNER_ENABLE_CODE_FIXES` | unset | Local override, same rule. Required (`true`) only for the in-cluster Runner, which has no dashboard row. |
| `ONEUPTIME_RUNNER_CONCURRENCY` | `1` | Max runbook jobs executed at once. |
| `ONEUPTIME_RUNNER_POLL_INTERVAL_MS` | `5000` | How often it asks for work. |
| `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS` | `60000` | Liveness reporting cadence. |
| `PORT` | `3875` | Health and queue-depth metrics (used by KEDA when self-hosting). |

## Scoping and trust

A Runner's credential is **project-scoped**: it can only ever see and claim
work belonging to the project it was created in. Credentials for the systems
it operates on (kubeconfig, cloud CLI profiles, database passwords) live on
the Runner host and are never sent to OneUptime — runbook secrets are
injected into scripts at claim time and the stored script never holds
plaintext values.

OneUptime's own deployment runs one in-cluster Runner in *cluster scope* to
serve the AI code-fix capability for every project. That mode is for the
platform's own `runner` service and is not available to a customer install.

## What happened to the Runbook Agent and the AI Agent?

They merged into this one Runner: one image, one credential, one install, one
status page. The environment variables changed with the merge —
`RUNBOOK_AGENT_ID`/`RUNBOOK_AGENT_KEY` and `AI_AGENT_ID`/`AI_AGENT_KEY` are
replaced by `ONEUPTIME_RUNNER_ID`/`ONEUPTIME_RUNNER_KEY`. Existing agents keep
their rows and their runbook history; re-run the install command above with
the new variable names to upgrade a host.
