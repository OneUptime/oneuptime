# OneUptime Kubernetes AI Agent

A small Node.js service that runs inside your Kubernetes cluster and carries out the `kubectl` commands OneUptime AI asks for — to look at the cluster while it investigates an incident or alert, and (only if you allow it) to apply a fix.

It is installed by the Kubernetes agent Helm chart (`HelmChart/Public/kubernetes-agent`, `aiAgent.*` values), on by default and **read-only**. It shows up on the cluster's **AI → Agent** page in OneUptime, not on the Runners page.

## What it may do

- **Read (default).** The chart gives the agent's ServiceAccount a read-only ClusterRole: list and describe resources, read logs and events. OneUptime AI is never allowed to read Secrets.
- **Change things (opt-in).** Only when you install the chart with `--set aiAgent.remediation.enabled=true`. You can limit changes to some namespaces with `aiAgent.remediation.namespaces` and turn node operations (cordon, drain, taint) off with `aiAgent.remediation.nodeOperations=false`. Whether AI proposes fixes, and whether a person must approve them, is set on the cluster's AI → Agent page.

Before anything runs, the agent checks every command itself, whatever the server sent:

1. It is a `kubectl` job from an OneUptime AI investigation or fix, with no Kubernetes credential.
2. The argument list passes the agent's own guard (no `--kubeconfig`, `--token`, `--server`, `--as`, file-backed output formats, `-f`, …).
3. The shared kubectl policy allows it (`exec`, `proxy`, reading Secrets and similar are never allowed), and an investigation only ever reads.
4. A change is refused unless writes are on, the namespace is allowed, it is not the agent's own namespace, and — for nodes — node operations are on.
5. The job is for this cluster (`ONEUPTIME_KUBERNETES_CLUSTER_NAME`).
6. The pod really runs in the cluster with a mounted ServiceAccount token.

`kubectl` then runs as an argument list (never through a shell), with a private kubeconfig built from the pod's ServiceAccount (the token is referenced by path, never copied), an empty `HOME`, `kuberc` preferences off, and nothing else from the agent's environment. Each command has a time limit and its output is capped at 50 KB.

## How it talks to OneUptime

All calls are HTTPS `POST`s to `<ONEUPTIME_URL>/kubernetes-ai-agent-ingest/*`:

| Call | What for |
| --- | --- |
| `register` | Once at start (and again if OneUptime stops recognising the agent). Uses the chart's API key — the same telemetry ingestion key the collector uses. Returns the agent's own id and key. |
| `heartbeat` | Every 30 seconds. Keeps the agent "connected" and reports what it may do (read-only or not, which namespaces, kubectl version). |
| `claim-next-job` | Every 3 seconds. One job at a time. |
| `job/<id>/heartbeat`, `job/<id>/result` | While a command runs, and to report its output. |
| `disconnect` | On shutdown, so the next pod can take over at once. |

It needs the same OneUptime version as the chart, or newer. With an older server it logs `This OneUptime server does not have the Kubernetes AI agent API …` once and checks again every 5 minutes.

## Configuration

The chart sets all of these; you normally only touch `aiAgent.*` chart values.

| Variable | Default | Description |
| --- | --- | --- |
| `ONEUPTIME_URL` | — (required) | Your OneUptime address, e.g. `https://oneuptime.com`. |
| `ONEUPTIME_API_KEY` | — (required) | The chart's API key (a telemetry ingestion key of the project). |
| `ONEUPTIME_KUBERNETES_CLUSTER_NAME` | — (required) | The chart's `clusterName`. The agent only runs commands for this cluster. |
| `ONEUPTIME_KUBERNETES_AGENT_CHART_VERSION` | — | Shown on the AI → Agent page. |
| `ONEUPTIME_KUBECTL_ALLOW_WRITES` | off | `true` allows changes (`aiAgent.remediation.enabled`). Anything else means read-only. |
| `ONEUPTIME_KUBECTL_WRITE_NAMESPACES` | all | Comma-separated namespaces changes may land in (`aiAgent.remediation.namespaces`). Empty means the whole cluster. |
| `ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS` | off | `true` allows cordon, drain, taint and node changes (`aiAgent.remediation.nodeOperations`). |
| `ONEUPTIME_AI_AGENT_POD_NAMESPACE` | — | The pod's namespace (downward API). The agent never changes anything in it. |
| `ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS` | `3000` | How often to ask for work (minimum 1000). |
| `ONEUPTIME_AI_AGENT_HEARTBEAT_INTERVAL_MS` | `30000` | How often to heartbeat (minimum 5000). |
| `PORT` | `3876` | Health server port. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |

A missing required value does not crash the pod: it stays up and ready, logs what is missing, and does nothing else — so a `helm upgrade --wait` never fails because of it.

## RBAC

The chart creates everything the agent needs (names shown for the usual release name `kubernetes-agent`):

- ServiceAccount `kubernetes-agent-ai-agent`.
- ClusterRole / ClusterRoleBinding `kubernetes-agent-ai-agent` — read-only.
- With `aiAgent.remediation.enabled=true`: `kubernetes-agent-ai-agent-remediation` (bound per namespace when `aiAgent.remediation.namespaces` is set, cluster-wide otherwise).
- With node operations on: `kubernetes-agent-ai-agent-node-operations`.

RBAC is the hard limit. The agent's own checks refuse commands before they reach the API server, with a message that says which chart value to change.

## Behind a proxy

If the cluster reaches OneUptime through an egress proxy, pass it to the agent with the chart's `aiAgent.extraEnv`:

```yaml
aiAgent:
  extraEnv:
    - name: HTTPS_PROXY
      value: http://proxy.example.com:3128
    - name: NO_PROXY
      value: .svc,.cluster.local,10.0.0.0/8
```

The agent's calls to OneUptime use the proxy; hosts in `NO_PROXY` are reached directly. The value must start with `http://` or `https://`. If it is not valid, the agent logs `The proxy settings are not valid` and keeps running. `kubectl` never uses the proxy — it talks to the cluster's own API server.

## Troubleshooting

Start with the logs:

```
kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100
```

Then the agent's own status (registered or not, last heartbeat, last error, and whether your OneUptime is too old):

```
kubectl port-forward -n oneuptime-agent deploy/kubernetes-agent-ai-agent 3876:3876
curl http://localhost:3876/status
```

(Installed under another release name or namespace? Use yours.)

| What you see | What to do |
| --- | --- |
| `This OneUptime server does not have the Kubernetes AI agent API` | Upgrade OneUptime, or install the chart version that matches your server. |
| `OneUptime refused the agent's API key` | Check `oneuptime.apiKey`: an unpinned telemetry ingestion key of the project. |
| `Waiting for this cluster's previous AI agent to go offline` | Normal for a minute after a pod restart. If it stays, another install uses the same `clusterName`. |
| `Could not reach OneUptime` | Check `oneuptime.url`, network policies and, behind a proxy, `aiAgent.extraEnv`. |
| `The proxy settings are not valid` | Fix `HTTPS_PROXY` / `HTTP_PROXY` in `aiAgent.extraEnv`, e.g. `http://proxy.example.com:3128`. |
| A fix is `Refused by the Kubernetes AI agent: … installed read-only` | Upgrade the chart with `--set aiAgent.remediation.enabled=true`. |
| `Killed (timeout …): kubectl produced no output at all` | The pod cannot reach the Kubernetes API server — check network policies. |

Health endpoints on port `3876`: `/status/live` (liveness), `/status/ready` (readiness — never waits for OneUptime) and `/status`.

## Development

```
npm install
npm test            # compiles, then runs the node:test suites in Tests/
npm run check-common
```

`Common/` holds byte-identical copies of the kubectl policy files from `packages/Common` (and `KubectlArgvGuard.ts` is a copy of the Runner's). Never edit them here: change the source and run `npm run sync-common`. `packages/Common/Tests/Utils/AiRemediation/KubernetesAiAgentPolicyCopyParity.test.ts` fails when a copy drifts.

## Security context

The container runs as UID/GID 1000, with a read-only root filesystem, no Linux capabilities and the `RuntimeDefault` seccomp profile. It writes only under `/tmp` (an `emptyDir` in the chart): one private directory per command, removed when the command ends and swept at start-up.
