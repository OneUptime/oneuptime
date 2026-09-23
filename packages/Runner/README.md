# OneUptime Runner

One self-hosted agent that does the work OneUptime cannot do from the outside.

A Runner runs **inside your infrastructure**, holds **your** credentials, and
talks to OneUptime over a single outbound HTTPS connection. It accepts no
inbound connections and never exposes a port to OneUptime.

It serves three kinds of work, each independently switchable:

| Capability | Default | What it does |
| --- | --- | --- |
| Runs Runbooks | on | Claims Bash and JavaScript runbook steps and executes them here, so the systems being operated on never need to be reachable from OneUptime. |
| Runs AI Code Fixes | off | Claims AI code-fix runs, works in your connected code repositories and opens pull requests **ready for review**. Never writes to the default or protected branches, and never merges. |
| Runs AI Remediation Commands | off | AI auto-remediation may execute policy-checked Bash and SSH commands on this host (or over its assigned SSH credentials). Suggest-mode commands run only after one-click human approval; FullAuto runs only commands matching the rule's operator allowlist. A built-in denylist refuses destructive commands regardless. |

Capabilities are set **in the dashboard**, on the Runner itself. The Runner
adopts a change on its next heartbeat — within a minute by default — so turning
one on or off takes effect without restarting or redeploying the container.

The Runner the Kubernetes agent chart installs (`kubernetes-agent/<cluster>`,
see [AI kubectl access](#ai-kubectl-access)) is the exception. It only runs
kubectl for its own cluster, so its row cannot be renamed, **Runs Runbooks**
and **Runs AI Code Fixes** cannot be turned on for it (its page in the
dashboard leaves the name and those two switches out), and it is never
accepted as an auto-remediation rule's command Runner.

## Install

Create a Runner in the dashboard (**Settings → Runners → Create**), copy the id
and key it shows you once, then run:

```bash
docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<runner-id> \
  -e ONEUPTIME_RUNNER_KEY=<runner-key> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/runner:release
```

To let this Runner open AI fix pull requests as well, turn on **Runs AI Code
Fixes** on the Runner in the dashboard. It starts claiming that work on its next
heartbeat.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `ONEUPTIME_URL` | — | Required. Your OneUptime server. |
| `ONEUPTIME_RUNNER_ID` | — | Required for project-scoped Runners (the normal case). |
| `ONEUPTIME_RUNNER_KEY` | — | Required. Shown once at creation; rotate by resetting it in the dashboard. |
| `ONEUPTIME_RUNNER_NAME` | — | Optional friendly name. |
| `ONEUPTIME_RUNNER_ENABLE_RUNBOOKS` | unset | Local override. Only `false` has an effect: it refuses runbook work on this host even when the dashboard grants it. |
| `ONEUPTIME_RUNNER_ENABLE_CODE_FIXES` | unset | Local override, same rule. Required (`true`) only for the in-cluster Runner, which has no dashboard row. |
| `ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS` | unset | Local override. Only `false` has an effect: it refuses AI remediation command work on this host even when the dashboard grants it. |
| `ONEUPTIME_KUBECTL_ALLOW_WRITES` | unset | Whether OneUptime AI may run kubectl **writes** (remediations) from this host. When set it fails closed: only `true` (any case) allows them; `false` and any other value refuse every non-read kubectl before it starts. Unset allows writes on an ordinary Runner (the Kubernetes credential's RBAC bounds them) and refuses them on the Kubernetes agent's Runner, whose chart always sets it from `aiAccess.remediation.enabled`. Reads are unaffected. |
| `ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS` | unset | Whether OneUptime AI may run kubectl **node operations** from this host: cordon, uncordon, drain, taint, and label, annotate or patch on a Node. Parsed like `ONEUPTIME_KUBECTL_ALLOW_WRITES`: when set, only `true` (any case) allows them and any other value refuses them before kubectl starts; unset allows them on an ordinary Runner and refuses them on the Kubernetes agent's Runner, whose chart sets it from `aiAccess.remediation.nodeOperations`. Nodes are cluster-scoped, so this switch — not the namespace list below — is what bounds them. Needs writes allowed; reads are unaffected. |
| `ONEUPTIME_KUBECTL_WRITE_NAMESPACES` | unset (cluster-wide) | Comma-separated namespaces kubectl writes may change; reads are never restricted. A write is judged by what it changes, the way kubectl reads it: a namespaced object by its namespace (`-n`, or the default namespace when `-n` is missing), and a write across all namespaces is refused; a Namespace object by its **name** (`label namespace X` changes `X`, whatever `-n` says), so only a listed namespace can be changed; any other cluster-scoped object (a PersistentVolume, StorageClass, IngressClass, ClusterRole, CRD, …) is outside every namespace and refused while this list is set (left to RBAC when it is empty). Node operations are not namespace-scoped: `ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS` governs them. A custom resource is judged by `-n` (the Runner cannot look up its scope), even one whose name looks like a built-in cluster-scoped kind (`nodes.example.com`). |
| `ONEUPTIME_RUNNER_POD_NAMESPACE` | unset | The namespace this Runner's own pod runs in (the Kubernetes agent chart sets it). kubectl writes into it are always refused, and so are writes to the Namespace object of that name; in-cluster a namespaced write with no `-n` counts as one. |
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

### AI remediation commands

Three separate switches must all be on before an AI-composed command can run,
and every one of them defaults to off: the project-level setting, the **Runs
AI Remediation Commands** toggle on this Runner, and the opt-in on each
individual auto-remediation rule. Turning any one of them off stops the work.

SSH credentials work the same way as runbook credentials: the server resolves
them at claim time and delivers them only inside the claimed job. The AI that
composes a command never sees a credential — it can only name which one the
Runner should use.

The Runner does not take the control plane's word for any of this. Before
executing, it re-checks its own capability grant and the built-in denylist of
destructive commands, so a compromised or misconfigured server still cannot
push forbidden work onto this host.

Revoking the capability in the dashboard takes effect on the next heartbeat —
within a minute by default — like every other capability.

### AI kubectl access

OneUptime AI runs kubectl through a Runner: read-only during investigations,
policy-tiered changes during remediations. The Runner re-checks every
command itself before it starts: its own argv guard (no credential,
cluster, file or verbose-logging flags, in any spelling kubectl accepts),
the shared kubectl policy, the write switch, the node switch and the
namespace scope above. The Kubernetes agent's Runner reports that scope
(`writeNamespaces`, `podNamespace`, `allowNodeOperations`) on its
heartbeats, and OneUptime applies the same scope before a fix is proposed or
approved, so a write that Runner would refuse is refused there first rather
than reaching it as a failed fix.
The Kubernetes agent chart's in-cluster Runner uses its pod's own
ServiceAccount; any other Runner uses the Kubernetes credential bound to it
on the cluster's AI page, written to a private temporary kubeconfig for the
life of one command.

kubectl runs with a closed environment: nothing from this host's environment
reaches it except `PATH`, plus the in-cluster API server address
(`KUBERNETES_SERVICE_*`) for the in-cluster Runner, or the proxy settings
(`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` and their lower-case forms) for a
command that uses a Kubernetes credential. Its `HOME` is a private empty
directory and kuberc preferences are switched off, so no `~/.kube/config` or
preferences file on this host can change what a command does.

On a Runner that is not the Kubernetes agent's, kubectl writes (and node
operations) are allowed unless you set `ONEUPTIME_KUBECTL_ALLOW_WRITES` (or
`ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS`) to something other than `true` —
the Kubernetes credential you assign is what bounds them. The server cannot
see these switches on such a Runner, so a refused write shows up in the
command's result on the cluster's AI page rather than as a missing setup
step.

## Upgrading from the Runbook Agent

Your agent keeps working — the server still accepts the old
`/runbook-agent-ingest` endpoint, so an un-redeployed container does not break
when the server upgrades. It logs a notice naming the agent so you can see who
still needs moving.

To move one, redeploy it with the new image and variable names. **The id and
key do not change**: the dashboard row, its ownership, its assigned secrets and
its runbook history are all the same record, so this is purely a container
swap.

| Before | Now |
| --- | --- |
| `oneuptime/runbook-agent:release` | `oneuptime/runner:release` |
| `RUNBOOK_AGENT_ID` | `ONEUPTIME_RUNNER_ID` |
| `RUNBOOK_AGENT_KEY` | `ONEUPTIME_RUNNER_KEY` |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | `ONEUPTIME_RUNNER_POLL_INTERVAL_MS` |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS` |
| `RUNBOOK_AGENT_CONCURRENCY` | `ONEUPTIME_RUNNER_CONCURRENCY` |

The old image is no longer built, so it will not receive fixes — and only the
new one can execute the SSH and Kubernetes step types.

## What happened to the Runbook Agent and the AI Agent?

They merged into this one Runner: one image, one credential, one install, one
status page. The environment variables changed with the merge —
`RUNBOOK_AGENT_ID`/`RUNBOOK_AGENT_KEY` and `AI_AGENT_ID`/`AI_AGENT_KEY` are
replaced by `ONEUPTIME_RUNNER_ID`/`ONEUPTIME_RUNNER_KEY`. Existing agents keep
their rows and their runbook history; re-run the install command above with
the new variable names to upgrade a host.
