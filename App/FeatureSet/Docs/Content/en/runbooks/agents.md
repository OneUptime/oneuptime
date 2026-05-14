# Runbook Agents

A **Runbook Agent** is a small self-hosted process that executes the Bash *and* JavaScript steps of your runbooks **inside your own infrastructure**. The OneUptime Worker never runs your scripts — it queues them, and a Runbook Agent that you installed in your environment picks them up, runs them, and posts the result back.

JavaScript still runs in an `isolated-vm` sandbox; the difference is that the sandbox lives on your agent host instead of on ours.

This page explains how to install an agent, route Bash and JavaScript steps to it, and operate it day-to-day.

## Why agents exist

Earlier versions of OneUptime ran Bash and JavaScript steps on the Worker. JavaScript was sandboxed (via `isolated-vm`), Bash was not. Both had problems for anything beyond a single-tenant self-hosted setup:

- **Trust boundary.** Anyone who can author a runbook could execute code on the Worker, with access to whatever env vars and filesystem the Worker had. The JavaScript sandbox blocked obvious things but couldn't stop a determined user from probing what was reachable from our network.
- **Reach.** Most useful steps want to operate on the *customer's* infrastructure ("restart this service", "kubectl on our cluster", "look up a record in our internal DB") — not on OneUptime's.

Runbook Agents flip that around. Bash and JavaScript steps don't run on us. They run on a host you control, and you decide what that host can do.

## How it works

1. You create a Runbook Agent in OneUptime. OneUptime generates an ID and a secret key.
2. You run the agent container on a host inside your infrastructure with that ID/key plus your OneUptime URL.
3. The agent polls OneUptime every few seconds asking "any work for me?"
4. When a Bash or JavaScript step runs, the Worker inserts a job row tagged with the step's **Agent Tag** and a step type (Bash or JavaScript), and sets its status to `Pending`.
5. Any healthy agent in the same project carrying that tag claims the job (atomically — no two agents ever run the same job), runs it locally — `bash -c <script>` for Bash, an `isolated-vm` sandbox for JavaScript — captures the result, and posts it back.
6. The Worker resumes the runbook with the result.

The agent only needs **outbound HTTPS** to your OneUptime instance. It does not accept any inbound connections.

## Install an agent

### 1. Create the agent record

Go to **Runbooks → Agents → Create New**. Fill in:

| Field | Notes |
| --- | --- |
| **Name** | A friendly name — usually `where-it-runs-and-what-it-can-do`, e.g. `prod-eu-west-1`. |
| **Description** | Optional. A sentence on what this host can reach. Future-you will thank you. |
| **Tags** | Comma-separated. Bash and JavaScript steps target a tag; any agent in the project with that tag can run them. Common patterns: `prod`, `staging`, `eu-west-1`, `db-host`. |

### 2. Copy the install command

After creating the agent, click **Show setup instructions** on its row. You will see a `docker run` command preloaded with this agent's ID and key. **Save the key now** — you can reset it later, but you cannot view the same key value again after closing the modal.

### 3. Run it on a host inside your infrastructure

Run the Docker command on any host in your environment that can:

- reach your OneUptime instance over HTTPS, and
- do the things you want your Bash steps to do (e.g. SSH to other hosts, `kubectl`, talk to a database).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runbook-agent:release
```

### 4. Verify the agent is connected

Go back to **Runbooks → Agents**. Within ~60 seconds the agent's row should switch to `Connected` with a fresh **Last seen** timestamp. If it stays `Disconnected`:

- Check the container logs (`docker logs oneuptime-runbook-agent`) for auth errors or network failures.
- Verify the host can reach your OneUptime URL with `curl`.
- Verify the ID and key were copied without whitespace.

## Tagging and routing

Tags are how a Bash or JavaScript step finds an agent. A few patterns:

- **One tag per environment.** Tag the prod agent `prod`, the staging agent `staging`. Bash steps targeting `prod` only run on prod.
- **One tag per region.** Tag agents `eu-west-1`, `us-east-1`. Useful when a step has to run close to the resource it touches.
- **Multiple agents, same tag.** Run two agents both tagged `prod`. Either may claim a given job — gives you high availability and lets you do rolling restarts without downtime for runbooks.
- **Multiple tags per agent.** An agent in your prod EU cluster might carry `prod`, `eu-west-1`, and `kubernetes`. Bash steps can target any of those.

Bash and JavaScript steps each **must** specify exactly one agent tag. Multi-tag targeting (run on any agent that has all of `prod` AND `db`) is on the roadmap but not in this release.

## Pointing a step at an agent

In your runbook, add a Bash or JavaScript step. The form will ask for an **Agent Tag**:

- Type the tag matching the agent(s) you want to run it.
- Write your script in the editor below.

When the runbook runs and reaches the step, the Worker queues a job with that tag and step type. If at least one healthy agent carrying that tag is online, the job is claimed within a few seconds and runs. Bash is executed via `bash -c`; JavaScript runs inside an `isolated-vm` sandbox on the agent (no filesystem, no network, no `Function`/`eval`).

## Operational notes

### Timeouts

Two timeouts apply to every Bash or JavaScript step:

| Timeout | Default | What it controls |
| --- | --- | --- |
| **Claim timeout** | 2 minutes | How long the Worker waits for *some* agent to claim the job. If no agent picks it up in time, the step fails with `TimedOut` and the runbook moves on (or stops, depending on **Continue on failure**). |
| **Execution timeout** | 30 seconds | How long the agent will let the script run before terminating it. Configurable per step. (Bash gets `SIGKILL`; JavaScript's isolate is torn down.) |

The Worker's overall wait window is `claim timeout + execution timeout + a few seconds`. Pick numbers that match the step.

### Lease and heartbeat

When an agent claims a job, it gets a short lease (30 seconds by default). While the script runs, the agent renews the lease every 10 seconds. If the agent dies or loses network mid-script, the lease expires and the Worker marks the job `TimedOut` rather than waiting forever.

Bash child processes are **not** automatically cancelled when the lease expires (a JavaScript isolate is also left to finish if it ever does) — but the Worker stops waiting for them, and the agent will not be able to submit a result once another claim has taken over. Design scripts to be safe to re-run if you care about exactly-once.

### No agent online

If no healthy agent is carrying the step's tag at the moment it runs, the job sits `Pending` until the claim timeout elapses, then fails with a clear "no agent claimed the job" message. The agents page is where you confirm coverage before running a runbook in anger.

### Output cap

Combined stdout + stderr is capped at **50 KB** per step. Larger output is truncated with a marker. If you need a full log, write it to S3 or your log store inside the script and `echo` the URL.

### Cancellation

Cancelling a runbook execution (from the execution view or the API) immediately marks all of its `Pending`/`Claimed`/`Running` Bash jobs as `Cancelled`. An agent that's already mid-script will finish its work, but its result will not be accepted by the server.

### Concurrency

Each agent runs one job at a time by default. To allow more, set `RUNBOOK_AGENT_CONCURRENCY` on the agent container — but remember the agent shares the host with whatever else lives there.

## Environment variables

The agent reads these on startup:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | yes | — | Base URL of your OneUptime instance, e.g. `https://oneuptime.yourdomain.com`. |
| `RUNBOOK_AGENT_ID` | yes | — | The UUID shown in the agent's setup modal. |
| `RUNBOOK_AGENT_KEY` | yes | — | The secret shown in the agent's setup modal. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | no | `5000` | How often the agent polls for new jobs. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | no | `60000` | How often the agent reports liveness. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | no | `10000` | How often the agent renews a running job's lease. |
| `RUNBOOK_AGENT_CONCURRENCY` | no | `1` | Maximum simultaneous jobs on this agent. |

## Rotating an agent key

If a key leaks, open the agent in OneUptime and reset its key. The old key stops working immediately. Update the agent container with the new key and restart it.

## Permissions

Managing agents lives under the existing Runbooks permission group:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — manage agent records.
- `RunbookManager` (role) — bundles all of these.

Permissions to *trigger* a runbook (and therefore cause Bash steps to dispatch) are still `CreateRunbookExecution` / `EditRunbookExecution`.

## Agent-facing API

For the curious — the agent uses these endpoints, mounted under `/runbook-agent-ingest`. They are authenticated by the agent's ID + key in the JSON body (or `x-agent-id` / `x-agent-key` headers).

| Endpoint | Purpose |
| --- | --- |
| `POST /heartbeat` | Liveness; updates `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`. |
| `POST /claim-next-job` | Atomically claim the oldest `Pending` job whose tag matches one of this agent's tags. Returns `{ job: null }` when there is nothing to do. |
| `POST /job/:jobId/heartbeat` | Refresh the job's lease. Returns 404 once the lease has lapsed or the job is terminal. |
| `POST /job/:jobId/result` | Submit the final outcome. Ignored if the lease has already moved on. |

You should not need to call these by hand — the bundled agent does. They're documented here so you can build your own agent if you have a constraint that ours doesn't fit.
