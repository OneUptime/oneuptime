<!-- markdownlint-disable MD033 -->
<h1 align="center"><img alt="oneuptime logo" width=50% src="https://oneuptime.com/img/OneUptimePNG/7.png"/></h1>
<!-- markdownlint-enable MD033 -->

# OneUptime Kubernetes Agent

Collects cluster metrics, events, pod logs, **application traces (HTTP/gRPC via eBPF)**, and **OS-level node metrics** from your Kubernetes cluster and ships them to OneUptime via OpenTelemetry. Install with one `helm install` command — no code changes or per-app SDK setup needed to see service traffic. **Continuous CPU profiles (eBPF flame graphs)** are also available — opt in with `--set profiling.enabled=true`.

Full docs: [Install the Kubernetes Agent](https://oneuptime.com/docs/monitor/kubernetes-agent).

## Quick start

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update

helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<A_UNIQUE_NAME_FOR_THIS_CLUSTER>
```

Your cluster appears in OneUptime within a few minutes.

## Pick a preset

The `preset` option picks compatible defaults for your Kubernetes distribution — so you don't have to think about hostPath, Pod Security Standards, or which log collection mode to use.

| `preset` | Use for | Log collection |
| --- | --- | --- |
| `standard` *(default)* | Self-managed, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet reading `/var/log/pods` via hostPath (lowest overhead) |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API log tailer Deployment (no hostPath) |
| `eks-fargate` | **EKS Fargate** | Kubernetes API log tailer Deployment (no hostPath) |

**GKE Autopilot:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod \
  --set preset=gke-autopilot
```

**EKS Fargate:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod \
  --set preset=eks-fargate
```

If you try the default `standard` preset on a cluster that blocks hostPath, the install fails with a Pod Security error. Re-install with `--set preset=gke-autopilot` (or `eks-fargate`) and it works.

## Kubernetes AI agent (AI investigations and fixes)

When an incident or alert is raised on this cluster, OneUptime AI investigates it. The **Kubernetes AI agent** gives it a terminal: it runs read-only `kubectl` the way an on-call engineer would (describe the failing pod, read its events, tail the crashing container's logs, check node capacity) and shows every command it ran on the incident page.

**It is on by default, and read-only.** It is one small pod (image `oneuptime/kubernetes-ai-agent`) that connects with the same `oneuptime.apiKey` and `clusterName` as the rest of the chart, so there is nothing to set up in the dashboard: the cluster's **AI → Agent** page shows it as Connected within a minute. To turn it off, pass `--set aiAgent.enabled=false`.

To add it to an existing install, refresh the chart index first and then upgrade:

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set aiAgent.enabled=true
```

`kubernetes-agent` in `oneuptime-agent` is the release name and namespace the OneUptime dashboard's install instructions use. If you installed with other names — the [Quick start](#quick-start) above uses `oneuptime-agent` in `oneuptime-kubernetes-agent` — use yours; `helm list -A | grep kubernetes-agent` shows them. Skip `helm repo update` and Helm may resolve an older chart, which does not know `aiAgent` and fails with `Additional property aiAgent is not allowed`.

Good to know:

- **Self-hosted OneUptime: upgrade the server first.** The agent needs a OneUptime server of this chart's version or newer. On an older server it logs that the server has no Kubernetes AI agent API and keeps retrying every few minutes. (The chart's eBPF tracer also wants a current server — see [Upgrading](#upgrading).)
- **Not connecting?** The agent's log says why — whether a refusal clears on its own (while a previous agent pod, or the in-cluster Runner it replaces, is still shutting down) or what you need to change: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`. An API key with a **Pinned Service Name** cannot register the agent; give the chart a key without one.
- **It is not a OneUptime Runner.** It never appears on the Runners page, never gets a Kubernetes credential, and never runs runbooks or Bash/SSH steps: it uses its own ServiceAccount only. It is also not related to the "AI Agent" retired in OneUptime 12.
- **Egress proxy?** Set `HTTPS_PROXY` and `NO_PROXY` with `aiAgent.extraEnv`.
- **Private registry or mirror?** Set `aiAgent.image.repository` (and `aiAgent.imagePullSecrets`).

### Let OneUptime AI fix what it finds (optional)

Write access is a separate step. Recommended — only in the namespaces AI may change:

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set aiAgent.enabled=true \
  --set aiAgent.remediation.enabled=true \
  --set "aiAgent.remediation.namespaces={web,api}" \
  --set aiAgent.remediation.nodeOperations=false
```

Or cluster-wide:

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set aiAgent.enabled=true \
  --set aiAgent.remediation.enabled=true \
  --set-json 'aiAgent.remediation.namespaces=[]'
```

Then pick how fixes run on the cluster's **AI → Agent** page. A cluster whose agent connects for the first time with write access starts in **ask for approval**, unless AI settings were already picked on that page before the install — those are kept as chosen.

Every namespace you list must already exist. The chart creates one RoleBinding in each and never creates a namespace, so a missing one fails the whole install or upgrade — the collector's workloads included — with `namespaces "api" not found`: create it first, or take it off the list. Take a namespace off the list before you delete it; if it is already gone, drop it from the list on the next upgrade. With `--reuse-values`, leaving the flag out keeps the list stored on the release. To go back to the cluster-wide binding, pass `--set-json 'aiAgent.remediation.namespaces=[]'` (Helm 3.10+) — not `={}`, which Helm reads as one empty name and the chart's schema rejects. The scoped command above also turns node operations off; set `aiAgent.remediation.nodeOperations=true` to let AI cordon, drain or taint nodes (always with a human approving).

How fixes run is picked on the **AI → Agent** page:

- **Off**: AI investigates but proposes no fixes.
- **ask for approval**: OneUptime AI composes the exact `kubectl` plan (for example `kubectl rollout restart deployment/web -n web`) and a human approves it with one click on the incident.
- **automatic**: safe changes run on their own; a riskier change never does. When the round could only find riskier fixes, it ends by proposing exactly those for one-click approval. When it also ran a safe fix, the riskier one stays in the analysis and is proposed only if verification shows the safe fix did not recover the signal — by the follow-up round, which asks. Allowlist a riskier command's exact shape on the AI → Agent page and it runs on its own too. A round proposes its plan for approval instead of running it when the hourly circuit breaker trips, or while another unattended OneUptime AI round is still changing or verifying a fix on the same cluster.
- **bypass approval**: AI does not ask. Every change the policy allows, riskier ones included, runs on its own, follow-up rounds included — except what needs a human in every mode (below). A round also asks for approval instead of running when the hourly circuit breaker trips (or cannot be checked), when another unattended OneUptime AI round is still changing or verifying a fix on the same cluster (an alert and an incident of one monitor are the usual case), and when it follows a fix whose rollback did not complete. The incident says why.

A **safe** change touches exactly one named object: `rollout restart/undo/pause/resume`, `scale` (to anything but 0), deleting a named pod, `cordon`/`uncordon`, and `label`/`annotate` on one named pod, Deployment, StatefulSet, DaemonSet, ReplicaSet, Job or CronJob with an ordinary key (not a reserved one such as `*.kubernetes.io/…` or `*.k8s.io/…`). Everything else the policy allows is **riskier**: the same verbs on a bare kind, several objects, a selector or `--all`; `scale` to 0; deleting a job; `taint`; `drain`; `patch`; `set image/env/resources`; `create`; deleting with `--force`; and labels or annotations on any other kind or with a reserved key.

In every mode, bypass approval included, a write in **kube-system**, **kube-public** or **kube-node-lease** always needs a human; so do a `drain`, a `taint` and a `patch` of a node, because draining a node evicts pods in every namespace — those three and the agent's own included — and a `NoExecute` taint evicts them too, whether `kubectl taint` or a node `patch` sets it; and the agent never changes anything in its own namespace, outside `aiAgent.remediation.namespaces`, or on a node with `aiAgent.remediation.nodeOperations=false` — OneUptime reads that scope from what the agent reports and refuses such a fix when it is proposed or approved, so it never reaches the agent as a failed fix. A custom resource is judged by the namespace it is written in, even one named like a built-in kind (`nodes.example.com`). No allowlist entry makes any of these run on its own. An allowlist entry is matched word by word: `*` stands for exactly one word (an image, a name), never for extra objects, flags or a second `-n`, and every flag the command uses must be written out in the entry. An entry must spell out its verb (and the subcommand of `rollout`, `set` or `create`) and be more than one word after the optional leading `kubectl`; one that is not, such as `scale` or `kubectl *`, is refused when you save it. Only a Project Owner, a Project Admin or someone with **Edit Auto Remediation Rule** may turn fixes on, switch a cluster to automatic or bypass approval, or write its allowlist; anyone who can edit the cluster may turn AI access down.

Two layers bound what the agent can do, and they do different jobs:

- **The command policy** — evaluated by the server and re-checked by the agent before it spawns `kubectl` — refuses some commands outright, in every mode and even with a human approving them: `exec`, `attach`, `cp`, `port-forward`, `proxy`, `debug`, `run`, `edit`, `apply`, `replace`, `diff`, kubectl plugins and any verb not on its list, any file input or file-reading output format (`-f`, `-k`, `-o jsonpath-file=…`, `-o go-template-file=…`, `-o custom-columns-file=…`, `--template`, or a bare `-o jsonpath` with no inline template), credential, impersonation (`--as`, `--as-group`, `--as-uid`, `--as-user-extra`), cluster-selection, `--kuberc`, raw-API and verbose-logging flags, Secret objects in any verb (OneUptime AI never reads, changes, deletes or creates a Secret — `create secret`, `create token` and `set env --resolve` included), anything that grants RBAC (`create role`, `clusterrole`, `rolebinding` or `clusterrolebinding`, `set subject`), `certificate approve`, `set serviceaccount`, `create deployment`, `create cronjob` or `create job` with `--image` (`create job --from=cronjob/…` stays a riskier change), `expose --overrides` or `--override-type` (the override can make kubectl create a Job, a ClusterRoleBinding or any other kind of object instead of a Service), a `patch` body that is not JSON (kubectl would read it as YAML, whose tags can spell a field no check sees), patches that change a pod template's ServiceAccount, volumes or security settings (host ports, the user-namespace opt-out `hostUsers` and the runtime class `runtimeClassName` included), patches that replace a whole part of a pod template instead of setting fields in it (a strategic-merge `$patch: replace`, a merge patch that sets a whole `containers` list, or a JSON patch that replaces or removes the pod spec), a label or annotation on Namespace objects picked by `--all` or a selector instead of by name, any write — `patch`, `label`, `annotate`, `set` — to RBAC objects, CustomResourceDefinitions, APIServices, admission webhook configurations or admission policies, writes across `--all-namespaces`, `delete --all`, and deleting namespaces, nodes, volumes, CRDs or cluster roles. Flags are parsed the way kubectl parses them — combined short flags are split so `-As` is caught, `--cascade`/`--dry-run`/`--validate` never swallow the next word, and only `-n`/`--namespace`, `--request-timeout` and `--match-server-version` may precede the verb (or the subcommand of `rollout`/`set`/`create`/`auth`/`cluster-info`/`top`) — so a denied flag or kind cannot hide behind another. The agent ships its own pinned kubectl (v1.36.4) and turns kuberc off, so a kuberc file cannot rewrite a command after the policy has checked it.
- **The RBAC in this chart.** Read-only mode grants only get/list/watch (plus pod logs and the access reviews `kubectl auth can-i` needs), cluster-wide. `aiAgent.remediation.enabled` adds a separate role with patch/update on Deployments, StatefulSets, DaemonSets, ReplicaSets and their scale subresource, Jobs, CronJobs, Pods and HPAs; create on Jobs (`create job --from=cronjob/…`) and HPAs; and delete on **Pods and Jobs only**. With `aiAgent.remediation.nodeOperations` (on unless you turn it off) a third role adds patch on nodes and create on `pods/eviction` for cordon, uncordon, taint and drain; with it off, that role is not rendered and the chart tells the agent (`ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS=false`), which refuses cordon, uncordon, drain, taint and label/annotate/patch on a node before it spawns `kubectl` — and OneUptime, which the agent tells, refuses such a fix already when it is proposed or approved. No role grants secrets, `pods/exec`, `pods/attach`, `pods/portforward`, `nodes/proxy`, ServiceAccount tokens, impersonation, CRDs, RBAC writes or wildcards, so a plan that deletes any other kind (a Deployment, say), or labels a Service, is refused by the API server with `Forbidden` even after a human approves it. The layers are not copies of each other: to RBAC, `kubectl apply` on an existing Deployment, `edit`, `replace`, `--all-namespaces` writes and `delete --all` are ordinary patch, update and delete calls, and only the policy stops them.

### What the write access amounts to

Be clear-eyed about the remediation role: **patch/update on workloads, pods and CronJobs, and create on Jobs, in a namespace is equivalent to running any image as any ServiceAccount in that namespace and reading its Secrets.** A pod template can name any image, any ServiceAccount and any Secret volume, and RBAC has no "patch, but not the pod template" verb — that no rule names `pods/exec` or secrets does not change it. That is why the policy refuses changing which ServiceAccount, security settings, volumes, command or Secret wiring a pod runs with (pod-template security patches, patches that replace the pod spec or a whole `containers` list, `set serviceaccount`, `create … --image`, `expose --overrides`, non-JSON patch bodies), why protected namespaces always need a human, and why `aiAgent.remediation.namespaces` exists. The policy does **not** refuse changing an image: `set image`, or a patch of an image field, is a riskier change. The new image runs as the workload's own ServiceAccount, with its Secrets, and a human approves it — unless the cluster bypasses approvals or its allowlist names the command, in which case it runs on its own.

With `aiAgent.remediation.namespaces` empty, the remediation role is bound with a ClusterRoleBinding, so RBAC allows those writes in **every** namespace, including kube-system, kube-public, kube-node-lease and the agent's own. RBAC cannot leave namespaces out of a ClusterRoleBinding: there, the policy (never without a human in the three system namespaces) and the agent (never its own namespace) hold the line, not RBAC. List namespaces and the chart binds the role with one RoleBinding in each and nowhere else, and tells the agent the list (`ONEUPTIME_KUBECTL_WRITE_NAMESPACES`) so it refuses a write elsewhere before spawning `kubectl`; the agent reports the list, and OneUptime refuses such a write already when it is proposed or approved. The release's own namespace cannot be listed, and every listed namespace must already exist (see above). Node operations are cluster-wide by nature — a drain evicts pods in every namespace — so they stay in their own role, and a drain, a taint or a patch of a node always needs a human.

### `aiAgent.*` values

`remediation.*` and `extraEnv` are not set in `values.yaml` on purpose: the defaults below apply only when neither they nor the older `aiAccess` values are set, so a release that stored `aiAccess` keeps its settings until you set the matching `aiAgent` key (see [Upgrading](#upgrading)).

| `aiAgent.*` | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Run the Kubernetes AI agent with read-only RBAC and connect it to this cluster. `false` removes it. |
| `remediation.enabled` | `false` | Also grant the write verbs OneUptime AI's fixes use; the agent refuses writes locally when this is off. |
| `remediation.namespaces` | `[]` | Bind the write role only in these namespaces (one RoleBinding each); a write elsewhere is refused when it is proposed or approved, and by the agent. Each must already exist, or the install or upgrade fails. Empty binds it cluster-wide; `--set-json 'aiAgent.remediation.namespaces=[]'` resets a stored list. |
| `remediation.nodeOperations` | `true` | With `remediation.enabled`, also grant cordon/uncordon/taint/drain, cluster-wide. `false` grants no node RBAC and tells the agent to refuse node operations; they are then refused when proposed or approved too. |
| `image.repository` / `image.tag` | `oneuptime/kubernetes-ai-agent` / `release` | The agent image. `release` is the moving tag every OneUptime release re-points, like this chart's other OneUptime images; pin a version to hold it, or point `repository` at a mirror. |
| `image.pullPolicy` | `Always` for `release`, `IfNotPresent` for a pinned tag | Leave empty for that default. `Always` keeps a node's cached agent — and its policy re-check — from outliving an upgrade. |
| `imagePullSecrets` | `[]` | Pull secrets (`[{name: …}]`) for a private registry or mirror. |
| `resources` | `50m` / `64Mi` → `500m` / `256Mi` | The agent idles between commands. |
| `extraEnv` | `[]` | Extra `EnvVar` objects for the agent container — e.g. `HTTPS_PROXY` / `NO_PROXY` when the cluster reaches OneUptime through an egress proxy. Names the chart sets itself (`ONEUPTIME_URL`, `ONEUPTIME_API_KEY`, `ONEUPTIME_KUBERNETES_CLUSTER_NAME`, `ONEUPTIME_KUBECTL_ALLOW_WRITES`, `ONEUPTIME_KUBECTL_WRITE_NAMESPACES`, `ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS`, `ONEUPTIME_AI_AGENT_POD_NAMESPACE`, …) fail the render instead of silently replacing the chart's value. `--set-json 'aiAgent.extraEnv=[]'` clears a list carried over from `aiAccess.extraEnv` (`--set` passes `[]` as a string, which the schema rejects). |

## Tuning resources (CPU & memory)

Every component the agent ships has its own `resources` block in [`values.yaml`](./values.yaml) with conservative defaults — small enough to fit on a modest node, large enough to handle a few hundred pods. Tune them up for larger clusters or heavier workloads.

### Defaults

| Component | values key | Requests (cpu / mem) | Limits (cpu / mem) | Enabled |
| --- | --- | --- | --- | --- |
| Metrics & events collector (Deployment) | `deployment.resources` | `200m` / `1Gi` | `1000m` / `4Gi` | always on |
| Pod log collector — DaemonSet | `logs.resources` | `50m` / `256Mi` | `200m` / `512Mi` | when `logs.mode: daemonset` |
| Pod log tailer — API mode | `logs.api.resources` | `100m` / `256Mi` | `1000m` / `1Gi` | when `logs.mode: api` |
| eBPF auto-instrumentation (DaemonSet) | `ebpf.resources` | `100m` / `256Mi` | `1000m` / `1Gi` | on by default |
| Continuous profiler (DaemonSet) | `profiling.resources` | `200m` / `512Mi` | `2000m` / `2Gi` | opt-in (`profiling.enabled=true`) |
| Bundled kube-state-metrics (Deployment) | `kubeStateMetrics.resources` | `50m` / `128Mi` | `200m` / `256Mi` | opt-in (`kubeStateMetrics.enabled=true`) |
| Cost allocation poller (Deployment) | `cost.agent.resources` | `50m` / `64Mi` | `200m` / `256Mi` | opt-in (`cost.enabled=true`) |
| Bundled OpenCost engine (Deployment) | `cost.opencost.resources` | `50m` / `128Mi` | `500m` / `1Gi` | with `cost.enabled=true` unless `cost.engine.url` is set |
| Bundled cost Prometheus (Deployment) | `cost.prometheus.resources` | `50m` / `256Mi` | `500m` / `1Gi` | with `cost.enabled=true` unless `cost.engine.url` is set |
| Kubernetes AI agent (Deployment) | `aiAgent.resources` | `50m` / `64Mi` | `500m` / `256Mi` | on by default (`aiAgent.enabled=false` turns it off) |

CPU is in cores (`500m` = half a core). Memory is in bytes (`Mi` = mebibytes, `Gi` = gibibytes). These map straight to the standard Kubernetes [resource requests and limits](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) on the underlying pods.

### Override with `--set`

For one or two changes at install or upgrade time:

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<NAME> \
  --set deployment.resources.requests.cpu=500m \
  --set deployment.resources.requests.memory=2Gi \
  --set deployment.resources.limits.cpu=2000m \
  --set deployment.resources.limits.memory=8Gi \
  --set ebpf.resources.limits.memory=2Gi
```

### Override with a values file (recommended for many overrides)

Create a `my-values.yaml` containing only the keys you want to change:

```yaml
# my-values.yaml
deployment:
  resources:
    requests:
      cpu: 500m
      memory: 2Gi
    limits:
      cpu: 2000m
      memory: 8Gi

ebpf:
  resources:
    requests:
      cpu: 200m
      memory: 512Mi
    limits:
      cpu: 1500m
      memory: 2Gi

logs:
  resources:
    limits:
      cpu: 500m
      memory: 512Mi
```

Apply it with `-f`:

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<NAME> \
  -f my-values.yaml
```

> **Already installed?** Use `helm upgrade oneuptime-agent oneuptime/kubernetes-agent --namespace oneuptime-kubernetes-agent --reset-then-reuse-values -f my-values.yaml` to apply new resource values without losing your existing settings. Don't use plain `--reuse-values` — see [Upgrading](#upgrading) for why.

### Recommended sizing

Pick the tier closest to your cluster as a starting point, then watch `kubectl top pod -n oneuptime-kubernetes-agent` and adjust.

| Tier | Cluster size | Notes |
| --- | --- | --- |
| **Small** | ≤ 10 nodes, ≤ 200 pods | Dev, staging, homelab. Tighten defaults to free node capacity. |
| **Medium** | 10–50 nodes, 200–1 000 pods | Chart defaults already target this tier — no override file needed. |
| **Large** | 50–200 nodes, 1 000–5 000 pods | Add headroom for the metrics collector and per-node DaemonSets. |
| **Extra-large** | 200+ nodes, 5 000+ pods | Scale the metrics collector and shard the API-mode log tailer. |

#### Small (≤ 10 nodes)

```yaml
# small.yaml
deployment:
  resources:
    requests:
      cpu: 100m
      memory: 512Mi
    limits:
      cpu: 500m
      memory: 2Gi

ebpf:
  resources:
    requests:
      cpu: 50m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi

logs:
  resources:
    requests:
      cpu: 25m
      memory: 64Mi
    limits:
      cpu: 100m
      memory: 128Mi
```

#### Medium (10–50 nodes)

Chart defaults are sized for this tier — no override file needed. See the [defaults table](#defaults).

#### Large (50–200 nodes)

```yaml
# large.yaml
deployment:
  resources:
    requests:
      cpu: 500m
      memory: 2Gi
    limits:
      cpu: 2000m
      memory: 8Gi

ebpf:
  resources:
    requests:
      cpu: 200m
      memory: 512Mi
    limits:
      cpu: 1500m
      memory: 2Gi

logs:
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi

# Only if you've enabled kube-state-metrics
kubeStateMetrics:
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi

# Only if you've enabled continuous profiling
profiling:
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: 3000m
      memory: 3Gi
```

#### Extra-large (200+ nodes)

```yaml
# xl.yaml
deployment:
  resources:
    requests:
      cpu: 1000m
      memory: 4Gi
    limits:
      cpu: 4000m
      memory: 16Gi

ebpf:
  resources:
    requests:
      cpu: 300m
      memory: 1Gi
    limits:
      cpu: 2000m
      memory: 3Gi

logs:
  resources:
    requests:
      cpu: 200m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 1Gi
  # Only relevant in API mode — shard the tailer across replicas
  api:
    replicas: 4

# Only if you've enabled kube-state-metrics
kubeStateMetrics:
  resources:
    requests:
      cpu: 200m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 1Gi

# Only if you've enabled continuous profiling
profiling:
  resources:
    requests:
      cpu: 1000m
      memory: 2Gi
    limits:
      cpu: 4000m
      memory: 4Gi
```

Apply any of these with `-f`:

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<NAME> \
  -f large.yaml
```

> These are conservative starting points. Real usage depends on pod density per node, request volume (for eBPF), and how many distinct process types are running. After install, watch `kubectl top pod -n oneuptime-kubernetes-agent` for ~24 hours and set limits to roughly 1.5× observed peak.

### When to tune

- **Large clusters (1000+ pods):** raise `deployment.resources.limits.memory` first — the metrics collector batches every series in memory, and an OOM there leaves gaps in your dashboards. `2–8Gi` is typical for production.
- **eBPF DaemonSet restarting or throttled:** raise `ebpf.resources.limits`. Confirm with `kubectl top pod -n oneuptime-kubernetes-agent` and check the OBI pod's restart count.
- **API-mode log tailer falling behind:** shard first with `--set logs.api.replicas=2` (or more) — one replica handles a few thousand containers. Only raise per-pod limits if a single replica is still saturated after sharding.
- **Profiling on dense nodes:** raise `profiling.resources.limits`. Flame-graph stack unwinding is the heaviest workload the agent runs.
- **Bundled kube-state-metrics on large clusters:** scale `kubeStateMetrics.resources` with object count — KSM holds the whole cluster state in memory.

After installing or upgrading, run `kubectl top pod -n oneuptime-kubernetes-agent` to see actual CPU/memory usage versus your limits and adjust from there.

## Configuration reference

### Required

| Key | Description |
| --- | --- |
| `oneuptime.url` | URL of your OneUptime instance (e.g. `https://oneuptime.com`). |
| `oneuptime.apiKey` | Telemetry ingestion key, sent as the `x-oneuptime-token` header. Create one at **Project Settings → Telemetry & APM → Ingestion Keys** — a project API key does not work here. |
| `clusterName` | Unique name for this cluster. Stamped as `k8s.cluster.name` on every record. |

### Common

| Key | Default | Description |
| --- | --- | --- |
| `preset` | `""` *(→ `standard`)* | `standard`, `gke-autopilot`, or `eks-fargate`. See table above. |
| `namespaceFilters.rules` | Exclude `kube-system` from `podLogs` and `ebpfDiscovery` | Scoped namespace rules. Patterns match the full namespace name and support `*`; any include rule creates an allowlist for its scope, and exclude rules always win. |
| `namespaceFilters.rules[].action` | — | `include` or `exclude`. |
| `namespaceFilters.rules[].namespaces` | — | Namespace names or patterns such as `team-*`. |
| `namespaceFilters.rules[].scopes` | — | One or more of `podLogs`, `ebpfDiscovery`, `metrics`, or `traces`. `podLogs` and `ebpfDiscovery` filter at source; the other scopes filter after metadata enrichment. |
| `filters.logs.minSeverity` | `""` | Drop **pod log** records below this severity: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. Empty keeps everything. Applies in both log modes. Does **not** filter Kubernetes events or resource specs — they carry no severity, so a threshold would delete the whole feed. In `api` mode, lines with no recognisable level are kept (the Kubernetes API cannot tell stdout from stderr). |
| `filters.metrics.exclude` | `[]` | Metric names to drop, across every receiver. Applied on top of `include`, so exclude wins. |
| `filters.metrics.include` | `[]` | When non-empty, **only** these metric names are sent. A forgotten name silently removes the monitors built on it — prefer `exclude`. |
| `filters.metrics.matchType` | `strict` | How `filters.metrics.*` entries match: `strict` (exact name) or `regexp` (RE2, **unanchored**, no lookahead). An invalid pattern makes the collector fail to start — a CrashLoopBackOff that stops logs too, not just metrics. Helm cannot validate it; test before rollout. |
| `sampling.traces.percentage` | `100` | Percentage of traces to **keep**, 0-100. Hash-based on the trace ID, so whole traces are kept or dropped together — you get fewer traces, not broken ones. Does **not** touch eBPF RED metrics (they ride the metrics pipeline), so rate/error/latency stay exact. **Does** scale down span-derived monitors — Traces (Span Count) and Exceptions (Exception Count) see proportionally less, so retune their thresholds. `0` keeps **none** — it is a rate, not an off switch; use `ebpf.enabled=false` to stop collecting traces. Only applies when `ebpf.enabled`. Fractions need `--set-json` or a values file (`--set` reads `0.5` as a string) and floor out at `0.01` — smaller values quantise to zero and drop everything. |
| `sampling.traces.hashSeed` | `22` | Seed for the trace-ID hash. Collectors that must agree on which traces to keep need a matching `hashSeed` **and** `percentage` — the defaults already match, so multi-cluster traces survive whole. Change only to deliberately decorrelate two sampling tiers. |
| `logs.enabled` | `true` | Turn pod log collection on or off. Metrics are unaffected — the node collector keeps running for kubelet / cAdvisor / host metrics and just stops reading pod logs. |
| `logs.mode` | `""` *(derived from `preset`)* | Advanced override — `daemonset`, `api`, or `disabled`. Explicit value always wins over the preset. |
| `logs.windowsPods.enabled` | `false` | Hybrid mode for mixed-OS clusters: run the API log tailer alongside the DaemonSet, restricted to pods on Windows nodes (which the Linux-only DaemonSet cannot reach). Linux pods keep node-local file tailing; no log line ships twice. Only meaningful in `daemonset` log mode. |
| `ebpf.enabled` | `true` | Auto-capture HTTP/gRPC traces from every pod via OpenTelemetry eBPF Instrumentation. See section below. |
| `profiling.enabled` | `false` | Continuous CPU flame graphs via OpenTelemetry eBPF Profiler — separate DaemonSet, samples stacks at 19Hz, no SDK needed. Off by default; opt in for more telemetry. |
| `hostMetrics.enabled` | `true` | Per-node OS metrics (disk I/O, filesystem inodes, NIC errors, paging, load average) via the OTel `hostmetrics` receiver. Each series carries the collecting node's `k8s.node.name`, so it breaks down per node. |
| `auditLogs.enabled` | `false` | Tail `/var/log/kubernetes/audit.log` from the host. Self-managed clusters only — managed K8s routes audit logs to a cloud sink. |
| `csi.enabled` | `false` | Scrape Prometheus metrics from CSI (storage) driver pods. |
| `coreDns.enabled` | `false` | Scrape Prometheus metrics from CoreDNS (`kube-dns` Service by default). |
| `resourceSpecs.enabled` | `true` | Pull full K8s object specs (labels, env vars, status) for the dashboard. |
| `controlPlane.enabled` | `false` | Scrape etcd / api-server / scheduler / controller-manager. Self-managed clusters only — managed offerings typically don't expose these endpoints. |
| `kubeletstats.utilizationMetrics.enabled` | `true` | Saturation metrics — container & pod CPU/memory as a percentage of request and limit. No extra scrape; derived from data the kubelet already returns. Always 0 when pods have no request/limit set. |
| `kubeletstats.volumeMetrics.enabled` | `true` | Per-PVC disk usage (`k8s.volume.available`, `k8s.volume.capacity`). One series per PVC per pod — bounded for most clusters, heavier on stateful workloads with thousands of PVCs. |
| `cadvisor.enabled` | `true` | Scrape this node's kubelet `/metrics/cadvisor` endpoint for CFS throttling and OOM kill counters that `kubeletstats` doesn't translate. An allowlist drops everything except 3 metrics at the receiver. |
| `kubeStateMetrics.enabled` | `false` | Pull cluster-state metrics (pod phases, scheduling status, container waiting reasons, resource quotas) from kube-state-metrics. `mode: bundled` (default) deploys a small KSM Deployment for you; `mode: external` scrapes an existing KSM via `endpoint`. |
| `cost.enabled` | `false` | Kubernetes cost observability — a complete install on its own: bundles the OpenCost engine plus a minimal dedicated Prometheus, polls per-workload cost allocations, and scrapes cost metrics. Cloud list prices need no credentials; on-prem clusters set `cost.opencost.customPricing`. Already run Kubecost/OpenCost? Set `cost.engine.url` (e.g. `http://opencost.opencost.svc.cluster.local:9003`) and nothing is bundled. Powers the Kubernetes Costs pages and the Kubernetes Cost dashboard template in OneUptime. |
| `cost.engine.prometheusUrl` | `""` | Prometheus the cost agent reads per-container memory **peaks** from, which right-sizing recommendations need and the Allocation API cannot supply — engines report averages, and an hourly mean hides the burst that OOMKills a container. Empty resolves to the bundled Prometheus when the engine is bundled, and to nothing when `cost.engine.url` is set, so **external-engine installs must set this** to get memory recommendations. Without it CPU recommendations still work (they come from stored hourly averages) and memory ones are simply unavailable. A Prometheus outage never blocks spend collection. |
| `cost.engine.prometheusCadvisorJob` | `""` | Prometheus job label of the cAdvisor scrape. Empty uses `kubernetes-nodes-cadvisor`, which is what the bundled Prometheus names it; override when pointing at your own Prometheus. |
| `cost.prometheus.retention` | `7d` | History the bundled cost TSDB keeps. Spend alone needs only a couple of days, but right-sizing reads memory peaks back over a multi-day lookback and a window older than retention yields no peak at all. Note `cost.prometheus.persistence.enabled` is `false` by default, so a pod restart still discards this history. |
| `aiAgent.enabled` | `true` | The Kubernetes AI agent: lets OneUptime AI run read-only `kubectl` on this cluster while it investigates incidents and alerts. See [Kubernetes AI agent](#kubernetes-ai-agent-ai-investigations-and-fixes) for write access and every `aiAgent.*` value. |

To stop duplicate pod logs from application teams that ship logs directly,
while retaining their traces, service map, and metrics:

```yaml
namespaceFilters:
  rules:
    - action: exclude
      namespaces: [kube-system]
      scopes: [podLogs, ebpfDiscovery]
    - action: exclude
      namespaces: [team-a, "team-b-*"]
      scopes: [podLogs]
```

### Continuous profiling (`profiling.*`) — off by default

A separate DaemonSet runs the [`otelcol-ebpf-profiler`](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) distribution — the same OTel project that produces the OBI auto-instrumentation, with a different build of the collector that bundles the [OpenTelemetry eBPF Profiler receiver](https://github.com/open-telemetry/opentelemetry-ebpf-profiler). It samples stacks at 19Hz across every supported runtime (Go, Java, .NET, Python, Ruby, Node, PHP, Perl, C/C++, Rust) and ships OTLP profiles directly to OneUptime (the existing in-cluster collector is on v0.96.0 which predates the OTLP profiles signal — that's why this is a separate DaemonSet).

Profiling is **off by default** — it's heavier than the OBI auto-instrumentation (more CPU per node, larger memory footprint) and not every cluster wants always-on flame graphs. Enable it when you want richer telemetry:

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<NAME> \
  --set profiling.enabled=true
```

When `ebpf.enabled` is also true (the default), the profiler correlates samples with OBI's trace context via the shared bpffs map, so each span gets its own flame graph linkable from the trace view. Since v0.14 OBI only keeps that map filled when asked, so the chart sets `OTEL_EBPF_BPF_POPULATE_TRACE_CONTEXT=true` on the eBPF DaemonSet whenever `profiling.enabled` and `profiling.obiProcessContext` are both on. Filling it costs instrumented apps a little on every async context switch (on Node.js, a hook on every callback); set `profiling.obiProcessContext=false` if you want flame graphs without the per-span link.

| Key | Default | Description |
| --- | --- | --- |
| `profiling.enabled` | `false` | Master switch. Off by default — opt in for continuous CPU flame graphs. Same kernel and privileged-pod requirements as `ebpf.*` — cannot run on GKE Autopilot / EKS Fargate. |
| `profiling.image.tag` | `0.152.0` | `otel/opentelemetry-collector-ebpf-profiler` image tag. |
| `profiling.samplesPerSecond` | `19` | Sampling frequency. Higher = more detail + more CPU. |
| `profiling.offCpuThreshold` | `0` | (0–1] enables off-CPU profiling at the given sampling probability — diagnoses lock contention and blocking I/O. Off by default. |
| `profiling.tracers` | `""` *(all)* | Comma-separated list of language tracers to load. Narrow to e.g. `"go,python"` if you don't care about the others. |
| `profiling.obiProcessContext` | `true` | Correlate samples with OBI's trace context. With `profiling.enabled`, also asks OBI to keep that context filled (`OTEL_EBPF_BPF_POPULATE_TRACE_CONTEXT=true`), which OBI v0.14+ otherwise skips. Has no effect when `ebpf.enabled` is false. |

### Other data collection knobs

- **`hostMetrics.*`** — host-level OS metrics from the OTel `hostmetrics` receiver, scraped inside the log-collector DaemonSet (no extra pods). Fills the gaps that `kubeletstats` doesn't cover. Every `system.*` series is stamped with the collecting node's `k8s.node.name`, so it groups per node like the `kubeletstats` node metrics; `hostMetrics.collectionInterval` (default `30s`) is the lever if the row volume is more than you need.
- **`kubeletstats.utilizationMetrics.*`** / **`kubeletstats.volumeMetrics.*`** — opt-in metric groups in the existing `kubeletstats` receiver. The first enables 8 derived saturation series (CPU/memory as % of request & limit) for containers and pods; the second adds per-PVC disk usage. Both run inside the existing DaemonSet — no extra pods, no extra scrapes. Separately, and with no flag, the chart always enables `k8s.node.cpu.usage` and `k8s.pod.cpu.usage` (CPU in use, in cores), which `kubeletstats` also leaves off by default. The High Node CPU Utilization monitor divides `k8s.node.cpu.usage` by the node's allocatable CPU and never fires without it. They add one series per node and one per pod, with no extra scrape. Drop them with `filters.metrics.exclude` if you really don't want them.
- **`cadvisor.*`** — scrapes the kubelet's `/metrics/cadvisor` endpoint from each node's DaemonSet pod for the container metrics `kubeletstats` doesn't translate: CFS throttling counters (`container_cpu_cfs_throttled_seconds_total`, `container_cpu_cfs_periods_total`) and OOM kill events (`container_oom_events_total`). A relabel allowlist keeps only those three series so cardinality stays bounded.
- **`kubeStateMetrics.*`** — pulls cluster-state metrics from kube-state-metrics: pod phases (Pending / Terminating), pod scheduling status (`kube_pod_status_scheduled`, for pods that fail to schedule), container waiting reasons (CrashLoopBackOff, ImagePullBackOff), and resource quota usage. Off by default because the `bundled` mode adds a small KSM Deployment to the chart's footprint. If you already run KSM in the cluster, set `kubeStateMetrics.mode: external` and `kubeStateMetrics.endpoint: <url>` to scrape that instead. The URL is scraped where it points: `https://` over TLS, and a path other than `/metrics` at that path. A URL with credentials, a query string or a fragment is refused when the chart renders, since a scrape job cannot carry them. An https endpoint needs a certificate from a public CA; there is no setting yet to trust a private CA, skip verification or send credentials. A relabel allowlist forwards only the metric families that power monitors (KSM exports ~100 by default).
- **`auditLogs.*`** — Kubernetes API audit logs. Off by default because most managed K8s platforms don't expose them as files. Enable on self-managed clusters where you set `--audit-log-path`.
- **`csi.*`** — auto-discovers pods labeled `app=csi-driver` (or `app.kubernetes.io/component=csi-driver`) and scrapes their `metrics` port. Most cloud-provider CSI drivers fit this convention.
- **`coreDns.*`** — scrapes the cluster's CoreDNS service on `:9153/metrics`. Surfaces DNS query rate, latency, cache hit rate, and error counts — a common P99 latency culprit.

### eBPF auto-instrumentation (`ebpf.*`) — on by default

The agent ships a DaemonSet running [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. OBI loads eBPF programs into the kernel to capture HTTP/HTTPS, gRPC, and SQL/Redis calls from any process — Go, .NET, Java, Node.js, Python, Ruby, or Rust — with no code changes, no SDK, and no sidecar. Captured traffic is exported as OTLP traces (and request/latency metrics) directly to OneUptime, where it appears under **Telemetry → Traces** and the service map.

Requirements:

- **Linux kernel 5.8+** with BTF. This is the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, and RHEL/Stream 9+. Kernel 4.18+ works on RHEL-family distros with vendor backports. The opt-in `ebpf.contextPropagation` feature has **no** additional kernel floor — do not assume an older kernel makes it inert. See **Cross-service trace linking** below.
- The eBPF DaemonSet runs **privileged** (it has to, to load eBPF programs). Clusters that block privileged pods — GKE Autopilot and EKS Fargate — can't run it, so disable it on those: `--set ebpf.enabled=false`.

Turn it off if you don't want it:

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<NAME> \
  --set ebpf.enabled=false
```

Useful knobs:

| Key | Default | Description |
| --- | --- | --- |
| `ebpf.enabled` | `true` | Master switch. |
| `ebpf.image.tag` | `v0.13.0` | OBI image tag. Pin to a known-good version; OBI is pre-1.0 so minor bumps may introduce changes (since v0.12 it refuses to start on an unknown metrics feature name). OBI before v0.14 cannot link Node.js 26+ requests to their calls — set `v0.14.0` once it is published; see [Every trace is a single span](#every-trace-is-a-single-span). |
| `ebpf.autoTargetExe` | `*` | Comma-separated globs of executable paths to auto-instrument. Narrow this (e.g. `*/python,*/java`) if you only want to track specific runtimes. |
| `ebpf.excludeExePaths` | (shells, kubelet, runc, containerd, otelcol, OBI itself, browsers, ClickHouse — see `values.yaml`) | Comma-separated globs to skip, so you don't see noise from cluster plumbing. |
| `ebpf.dropDatabaseServerSpans` | `true` | Drop the span OBI records inside a database server, which duplicates the caller's own span — see [What eBPF traces look like](#what-ebpf-traces-look-like). |
| `ebpf.dropUnlinkedDatabaseCalls` | `true` | Drop an app's database calls that belong to no trace (background work). A database only background work talks to is then not discovered from traces — see [What eBPF traces look like](#what-ebpf-traces-look-like). |
| `ebpf.nodejs.enabled` | `true` | OBI's Node.js agent, which links a Node.js request's outgoing HTTP/SQL/Redis calls to it. It is injected through the Node inspector (SIGUSR1; loopback-only `127.0.0.1:9229`, open for about a second), so each Node.js app logs `Debugger listening on ws://127.0.0.1:9229/…` and `Debugger attached.` once when OBI finds it. Turn off if policy forbids that; Node.js spans then stay unlinked. Route templates do not depend on it: OBI reads them from the app's files either way. |
| `ebpf.excludeOtelInstrumentedServices` | `true` | OBI's default: stop exporting eBPF telemetry for a process once it sees that process export OTLP itself, so an SDK-instrumented app is not traced twice. Set `false` if those SDKs report to a different project or backend and you want eBPF traces for them here too. |
| `ebpf.routes.patterns` | `[]` | Route templates (e.g. `/api/items/{id}`) that name HTTP spans for frameworks OBI cannot harvest routes from. |
| `ebpf.routes.unmatched` | `""` (OBI's `heuristic`) | Route for a path no pattern matches: `heuristic`, `low-cardinality`, `wildcard`, `path` (unbounded cardinality) or `unset`. |
| `ebpf.extraSpanAttributes` | `[]` | Span attributes to add to the ones the chart always exports — see [What eBPF traces look like](#what-ebpf-traces-look-like). E.g. `http.request.body.size` and `http.response.body.size` (sent by default before OBI v0.14), `obi.http.response.observed`, or `db.query.text` (the raw query, which can carry personal data). `*` is ignored. |
| `ebpf.logLevel` | `info` | `debug`, `info`, `warn`, `error`. |
| `ebpf.printTraces` | `false` | Print spans to the OBI pod's stdout. Useful for confirming OBI is seeing traffic before checking the dashboard. |
| `ebpf.resources.*` | `100m / 512Mi` requests, `2000m / 2Gi` limits | Tune for cluster size. |

**Signal families** — all on by default, disable individually with `--set ebpf.features.<key>=false`:

| Key | Default | What it adds |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | `true` | HTTP/gRPC RED metrics (request rate, latency, errors) per service. |
| `ebpf.features.spanMetrics` | `true` | Per-span request/response size and duration histograms. |
| `ebpf.features.serviceGraph` | `true` | Caller → callee request edges; drives the service map view. |
| `ebpf.features.networkMetrics` | `true` | Pod-to-pod TCP/UDP byte and packet counters. |
| `ebpf.features.networkInterZoneMetrics` | `false` | Inter-zone variant of `networkMetrics` (doubles cardinality). |
| `ebpf.features.tcpStats` | `true` | Node-level TCP RTT, failed-connection, and retransmit counters. |

#### What eBPF traces look like

eBPF sees network calls, not your code, so an eBPF trace is built from the requests a process serves and the calls it makes while serving them:

- **A request and its calls are one trace.** A request into a service is the root span, named `<METHOD> <route>`; the HTTP, gRPC, SQL and Redis calls the service makes while handling it are its children. For Node.js that needs OBI's Node.js agent (`ebpf.nodejs.enabled`), because Node runs every request on one thread and the kernel alone cannot tell which request a call belongs to. Even then, calls that concurrent requests send down one shared connection — a Redis client usually pipelines everything over one — cannot always be told apart, so some of those are not placed in their request's trace.
- **Hops between services on different nodes are separate traces** unless something carries the trace context across: an OpenTelemetry SDK, or the opt-in `ebpf.contextPropagation` below. When the caller and the callee run on the same node, OBI sees both ends of the connection and links them itself.
- **Work no request triggered has no request to belong to.** A queue worker polling Redis, a connection pool pinging, a cron job — each call is its own trace.
- **Database servers usually stand alone.** OBI records a span inside the database server for every command it receives, but database wire protocols carry no trace context: unless the caller runs on the same node (see above), that span is a trace of one, duplicating the client span the caller already recorded.

Those last two produce one-span traces named after a bare command — `set`, `evalsha`, `SELECT` — and on a busy cluster they are most of what OBI sends. The agent's collector drops them: the database server's own span, linked or not, since it always duplicates the caller's span — on the same node OBI links it under the call and every database call shows up twice (`ebpf.dropDatabaseServerSpans`) — and an app's call outside any trace, including calls OBI could not place in their request's trace (`ebpf.dropUnlinkedDatabaseCalls`). Both are on by default. An app's database calls inside a request trace are kept, spans your apps push from their own SDKs are never touched, and OBI's database metrics still count every command.

The second switch has a cost. OneUptime discovers databases, and draws them on the service map, from database client spans, so a database that only background work talks to (a worker's queue, a cron job's warehouse) is then no longer discovered from traces — an existing entry stops being seen and is eventually archived — and shows on the service map as a remote endpoint. Its metrics are unaffected. Set `ebpf.dropUnlinkedDatabaseCalls=false` to keep those spans, one-span traces included.

Span names come from the wire: HTTP spans are `<METHOD> <route>`, where the route is the app's own template when OBI can harvest it and otherwise derived from the path, with id-like segments replaced by `*` (add `ebpf.routes.patterns` to name them yourself); SQL spans are `<OPERATION> <table>`; Redis spans are the command. OBI v0.14 harvests the route templates of Go (net/http, Gorilla mux, Gin), Java (Spring, JAX-RS), Node.js (Express, Fastify, Koa, NestJS, Next.js), Python (Django, FastAPI, Flask), Ruby (Rails), .NET (ASP.NET Core attribute routes) and PHP (Symfony, Laravel, Slim) apps. Names like `worker.job ProcessTelemetry` or `OrderService.charge` exist only in code, and need an OpenTelemetry SDK.

Span attributes are OBI's defaults (`error.type`, `network.peer.address`, `db.query.summary`, `url.query`, `user_agent.original` and a few more) plus `service.peer.name`, which names the service a call went to and feeds the service map; OBI v0.14 made it opt-in, so the chart asks for it. OBI v0.14 also stopped sending `http.request.body.size` and `http.response.body.size` by default. Add those, or other opt-in attributes, with `ebpf.extraSpanAttributes`. `db.query.text` carries the raw SQL or Redis command, literal values included, so think before turning it on. The chart never asks for every attribute (`*`), which would also export AI prompt and completion payloads.

**Cross-service trace linking** — **off by default, opt in:**

| Key | Default | Description |
| --- | --- | --- |
| `ebpf.contextPropagation` | `false` | OBI injects a W3C `traceparent` into outbound traffic so requests crossing service boundaries link into a single trace, no SDK required. **Off by default** — see the warning below before enabling. Works on the same kernels as the rest of the agent; there is no version at which enabling it is safely inert. |
| `ebpf.contextPropagationMode` | `headers` | How OBI injects the `traceparent`; only read when `contextPropagation` is true. `headers` — HTTP/1.1 request headers; narrowest blast radius, but *not* packet-free (see below). `tcp` — a TCP option injected via Linux Traffic Control; covers non-HTTP and encrypted traffic, but is often stripped by middleboxes and must chain with other TC programs (Cilium, Calico). `all` — both; most coverage and most rewriting, and the TCP-option half can break service-mesh proxies (linkerd2-proxy, envoy) by corrupting bytes they validate. The legacy `ip` value was removed upstream and is rejected by this chart. |
| `ebpf.trackRequestHeaders` | `true` | Kernel-side header tracking so propagation works for plain HTTP servers (non-Go, non-TLS). Only effective when `contextPropagation` is true. |
| `ebpf.logToTraceCorrelation` | `false` | **Off by default — opt in.** OBI injects `trace_id` / `span_id` into **JSON-formatted** log lines from instrumented processes (existing fields preserved); the filelog DaemonSet lifts them onto the LogRecord so clicking a span in the trace view jumps to its logs. Plain-text logs pass through unchanged. **Do NOT enable** in clusters running LD_PRELOAD-based APM agents (Dynatrace OneAgent, New Relic, AppDynamics, Datadog, Instana) — the log enricher's in-process buffer rewrite races with those agents' `write()` wrappers and crashes the application (typically SIGSEGV / exit 139 in .NET). See [APM agent compatibility](#application-pods-crash-with-sigsegv-after-enabling-log-trace-correlation) below. |
| `ebpf.logEnricher.services` | `[{service: [{exe_path: "*"}]}]` | OBI GlobAttributes selector for which processes get the log enricher (only consulted when `logToTraceCorrelation: true`). Each entry can match by `exe_path`, `languages`, `k8s_pod_labels`, `k8s_pod_annotations`, `open_ports`, or `cmd_args`. Narrow this when enabling log enrichment alongside an APM agent — list only the workloads you want enriched (OBI's log_enricher does not support `exclude_services`). |

> **⚠️ Why context propagation is off by default.** Every mode rewrites traffic that is already in flight. For plaintext HTTP, OBI widens the outbound request buffer in place (`bpf_probe_write_user`) to fit the extra header; for TLS and raw TCP it appends a TCP option from a Traffic Control hook, rewriting the packet and its checksum. The kernel's byte accounting for that connection then has to be fixed up, and when that goes wrong the connection **desynchronizes** rather than merely losing a span. The reported symptom is transfers through an L7 proxy (nginx) hanging mid-body once the response grows past the point where the rewrite spans segments (~64KB), holding the connection open until it times out. Because the failure is per-connection and size-dependent it presents as an application or proxy bug, which makes it very expensive to trace back to the agent. Enable it deliberately, on a non-production cluster first.
>
> **There is no kernel version at which this is safely inert — do not use kernel age to rule the agent out.** Kernel 5.17 buys `bpf_loop` for network-level header parsing, but below it OBI falls back to bounded-scan program variants and keeps rewriting traffic exactly the same way, logging an *info* line rather than an error. What actually decides whether injection happens is `CAP_SYS_ADMIN` plus the absence of kernel lockdown, and this DaemonSet runs privileged, so that gate is always open. (`tcp` and `all` additionally load Traffic Control programs, which is where `CAP_NET_ADMIN` comes in; `headers` loads none.) If propagation is enabled, assume traffic is being rewritten on every node regardless of kernel. Traces, RED metrics, and the service map all work without it — what you lose is only automatic span stitching across a service boundary for apps that don't propagate `traceparent` themselves.
>
> This previously defaulted to `true`. Don't go by version number — check your release's effective value directly, which is authoritative whether you installed before or after the change:
>
> ```bash
> helm get values <release> -n oneuptime-kubernetes-agent -a | grep -A2 contextPropagation
> ```
>
> and turn it off explicitly if so:
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent --reset-then-reuse-values \
>   --set ebpf.contextPropagation=false
> ```

### API-mode log tailer (only when `logs.mode: api`)

| Key | Default | Description |
| --- | --- | --- |
| `logs.api.image.repository` | `oneuptime/kubernetes-log-tailer` | Image for the log tailer Deployment. |
| `logs.api.image.tag` | `""` (tracks chart `appVersion` — the OneUptime product version at release time) | Override to pin to a specific tag. |
| `logs.api.replicas` | `1` | Number of log-tailer replicas. One replica handles a few thousand containers; shard by namespace for larger clusters. |
| `logs.api.batchMaxRecords` | `500` | Flush after this many log records. |
| `logs.api.batchMaxMs` | `5000` | Flush after this many milliseconds. |
| `logs.api.exportMaxRetries` | `5` | Max OTLP export retries before dropping a batch. |
| `logs.api.sinceSecondsOnStart` | `10` | When a stream first connects, fetch the last N seconds of log buffer. |
| `logs.api.logLevel` | `info` | `debug`, `info`, `warn`, `error`. |

See [`values.yaml`](./values.yaml) for the exhaustive list, including service mesh (Istio / Linkerd) scraping, control plane endpoints, and resource request/limit tuning.

## Upgrading

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --reuse-values
```

> ⚠️ **Self-hosted OneUptime: upgrade the server first, or install the chart version that matches it.** The eBPF tracer this chart runs (OBI v0.14) names a called service in `service.peer.name` and reports a message broker's own Kafka/MQTT/NATS spans as producer/consumer spans; OneUptime servers older than this chart read neither, so the service map loses named peers and Queues count each broker as a producer and consumer of its topics.

> ⚠️ **`--reuse-values` skips defaults for newly added settings.** When the chart adds a new top-level field (e.g. `profiling.*` in v0.4.x, `ebpf.features.*` in v0.4.x), Helm's `--reuse-values` keeps your old value file as-is and does **not** merge the new defaults — so the new feature stays unset and renders as disabled in the templates.
>
> To pick up new defaults:
>
> - **Helm 3.14+**: use `--reset-then-reuse-values` instead of `--reuse-values`. This re-reads the chart's `values.yaml` for any keys you haven't overridden, while still keeping your `--set` values.
>
>   ```bash
>   helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>     --namespace oneuptime-kubernetes-agent --reset-then-reuse-values
>   ```
>
> - **Helm 3.13 and earlier**: pass your original `--set` flags (or `-f values.yaml`) without `--reuse-values`. The new defaults apply automatically and your overrides override them.
>
>   ```bash
>   helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>     --namespace oneuptime-kubernetes-agent \
>     --set oneuptime.url=<URL> \
>     --set oneuptime.apiKey=<KEY> \
>     --set clusterName=<NAME>
>   ```
>
> If you don't see the new feature's pods (e.g. `kubernetes-agent-profiling-*`) after upgrading, it's almost certainly this. Run `helm get values <release>` to see what Helm actually has — fields missing from the output mean Helm didn't merge defaults for them.

### Upgrading to the Kubernetes AI agent

This chart runs the [Kubernetes AI agent](#kubernetes-ai-agent-ai-investigations-and-fixes) by default — one new, read-only pod — and it is on after the upgrade even with `--reuse-values`. Before you upgrade:

- **Self-hosted OneUptime: upgrade the OneUptime server first.** The agent needs a server of this chart's version or newer. Against an older server it only logs that the server has no Kubernetes AI agent API and keeps retrying; the AI agent itself does not affect telemetry (but see [Upgrading](#upgrading) for the eBPF tracer).
- **The new pod pulls `docker.io/oneuptime/kubernetes-ai-agent:release`.** If the cluster cannot pull from Docker Hub, or you upgrade with `--wait` / `--atomic`, Terraform or Flux behind an image allowlist, mirror the image (`--set aiAgent.image.repository=<your-registry>/oneuptime/kubernetes-ai-agent`, plus `aiAgent.imagePullSecrets` if the mirror needs a login) or pass `--set aiAgent.enabled=false`. Otherwise the upgrade can wait on a pod that never starts.
- **To go back to an older chart, use `helm rollback <release> <revision>`**, not `helm upgrade --version <older> --reuse-values`: the stored values now include `aiAgent`, which an older chart's schema rejects.
- **This is not the "AI Agent" retired in OneUptime 12.** That was part of the OneUptime server chart (it became the Runner); this is a new pod in the Kubernetes agent chart.

If you used `aiAccess` (charts 14.0.2 to 14.0.8), the in-cluster Runner it deployed (`<release>-ai-runner`) is replaced by the agent (`<release>-ai-agent`) on this upgrade, and your settings carry over by one rule — **an `aiAgent` key you set wins; otherwise the stored `aiAccess` value; otherwise the default**:

| Setting | Comes from |
| --- | --- |
| On / off | `aiAgent.enabled` (default on). A stored `aiAccess.enabled=false` does not turn the agent off — it was every 14.0.x release's default, chosen or not — so use `--set aiAgent.enabled=false`. |
| Write access | `aiAgent.remediation.enabled`, else `aiAccess.enabled` **and** `aiAccess.remediation.enabled`, else off. `--set aiAgent.remediation.enabled=false` revokes write access carried over from `aiAccess`. |
| Write namespaces | `aiAgent.remediation.namespaces` (an empty list means cluster-wide), else `aiAccess.remediation.namespaces` when write access was on. |
| Node operations | `aiAgent.remediation.nodeOperations`, else `aiAccess.remediation.nodeOperations`, else on. |
| Extra environment | `aiAgent.extraEnv` (`--set-json 'aiAgent.extraEnv=[]'` clears it), else `aiAccess.extraEnv`, so proxy settings keep working. |
| Image and resources | `aiAgent.image` and `aiAgent.resources` only. `aiAccess.image` (the Runner image) and `aiAccess.resources` are ignored. |

> **An upgrade fails with `namespaces "<name>" not found`?** `aiAgent.remediation.namespaces` (or a carried-over `aiAccess.remediation.namespaces`) lists a namespace that does not exist (or no longer does): the chart puts a RoleBinding in each listed namespace and never creates one. Create the namespace, or upgrade with the list minus that namespace — `--set "aiAgent.remediation.namespaces={web}"`, or `--set-json 'aiAgent.remediation.namespaces=[]'` to go back to the cluster-wide binding. `--set aiAgent.remediation.namespaces=null` does not reset a stored list under `--reuse-values`, so that upgrade fails with the same error. Take a namespace off the list before you delete it.

## Uninstalling

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Troubleshooting

See the [Install the Kubernetes Agent](https://oneuptime.com/docs/monitor/kubernetes-agent) guide — it covers the "hostPath blocked" error, missing logs, and horizontal sharding for large clusters.

### The cluster shows "Disconnected" and/or no data appears — run the diagnostic script

This is usually one problem, not two: telemetry isn't being accepted, so the cluster never connects and nothing ingests. The most common cause — especially after a reinstall — is a **wrong or revoked ingestion key**. The OTLP endpoints refuse it with `401` (`422` for a disabled key or a browser key), and since neither is retried the collector drops every batch, logging one `Exporting failed. Dropping data.` error per batch. The pods stay Running and Ready, so that line is easy to miss.

The bundled script checks pod health, decodes/validates the key, tests cluster egress, and asks OneUptime whether the token is actually accepted — then prints a single root-cause verdict:

```bash
curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
  | bash -s -- -n oneuptime-agent
```

It only reads cluster state and runs a couple of probes — it changes nothing. For the most accurate egress test, install with `--set debug.enabled=true` first (see below), then re-run.

To validate a key by hand (`200` = valid, `401` = unknown/revoked):

```bash
curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" "$ONEUPTIME_URL/otlp/v1/validate"
```

### Mixed-OS clusters (Windows node pools)

All agent images are Linux-only, so every workload in the chart pins itself to Linux nodes with a `kubernetes.io/os: linux` nodeSelector. On clusters with Windows node pools (e.g. AKS), the DaemonSets skip Windows nodes instead of sitting in `ImagePullBackOff` there. If you're upgrading from a chart version without the pin and see agent pods stuck in `ImagePullBackOff` on Windows nodes, `helm upgrade` to the current version; the stuck pods are removed automatically once the pin applies.

Cluster-level telemetry about Windows nodes and their pods (node conditions, pod phases, Kubernetes events, kube-state-metrics) still flows — it comes from the Kubernetes API, not from an agent on the node. What Windows nodes don't get is node-local collection: host OS metrics, kubelet/cAdvisor scrapes, eBPF traces, profiling — and, in the default `daemonset` log mode, pod logs.

**To collect logs from pods on Windows nodes**, enable hybrid mode:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set logs.windowsPods.enabled=true
```

This runs the API log tailer alongside the DaemonSet, restricted to pods on Windows nodes — Linux pods keep the cheaper node-local file tailing, and the two collectors partition pods by node OS so no line ships twice.

Two things to know when enabling hybrid mode:

- **Tailer image version**: the Windows-only restriction lives in the tailer image (`NODE_OS_INCLUDE`), which ships with the same OneUptime release as this chart. An **older tailer image ignores it and tails every pod** — silently shipping every Linux pod's logs twice. If you pin `logs.api.image.tag`, use a version no older than this chart's release; if a node may have cached a stale `release` tag (the default `pullPolicy` is `IfNotPresent`), add `--set logs.api.image.pullPolicy=Always` for the upgrade.
- **Severity filtering**: with `filters.logs.minSeverity` set, lines with no recognizable severity keyword are dropped on the DaemonSet path (it sees the stdout/stderr marker on disk and assigns INFO/ERROR fallbacks before filtering) but kept on the API path (the log API strips the marker, so the tailer errs toward keeping). Windows pods can therefore ship more keyword-less lines than Linux pods under a severity filter.

### Application pods crash with SIGSEGV after enabling log ↔ trace correlation

If you enabled `ebpf.logToTraceCorrelation` (off by default) and **.NET application pods start crashing with `Exit Code: 139`** (SIGSEGV) within seconds of the eBPF DaemonSet starting, the cause is almost always a conflict with an `LD_PRELOAD`-based APM agent in the same pods.

Affected APM agents:

- **Dynatrace OneAgent** (`liboneagentproc.so`)
- **New Relic** (`libnewrelic*.so`)
- **AppDynamics** (`libappdynamics*.so`)
- **Datadog** (`libdd*.so`)
- **Instana** (`libinstana*.so`)

These agents wrap libc `write()` and hold pointers into the caller's stdout buffer. OBI's log enricher zeroes the original buffer with NULs before re-emitting the enriched line — that buffer rewrite races with the APM agent's write wrapper and crashes the host process. On Dynatrace specifically, the OneAgent's watchdog `write()` to its PID file also stalls past the 10s liveness threshold, sending Dynatrace itself into a restart loop on every node.

**Immediate mitigation** — disable the log enricher (keeps the rest of eBPF working):

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --reuse-values \
  --set ebpf.logToTraceCorrelation=false
```

Then `kubectl rollout restart` the affected deployments (stagger one at a time — a simultaneous cluster-wide restart concentrates the failure).

**If you need log ↔ trace correlation alongside an APM agent**, scope `ebpf.logEnricher.services` so the enricher skips the pods running the APM. OBI's `log_enricher` only accepts positive selectors (no `exclude_services`) — list only the workloads you want enriched. Two common recipes:

```yaml
# Enrich only pods you've explicitly opted in (label them apm-agent=none).
ebpf:
  logToTraceCorrelation: true
  logEnricher:
    services:
      - service:
          - k8s_pod_labels:
              apm-agent: "none"
```

```yaml
# Enrich only runtimes where LD_PRELOAD-based APMs typically aren't injected.
# Dynatrace's .NET agent uses LD_PRELOAD; the Python/Go/Node/Ruby paths don't.
ebpf:
  logToTraceCorrelation: true
  logEnricher:
    services:
      - service:
          - languages: "python,go,nodejs,ruby"
```

### Application pods fail or restart after enabling the agent (service mesh)

If you run a service mesh (Linkerd, Istio, Consul Connect) or an eBPF-based CNI (Cilium, Calico-eBPF) and application pods start failing, timing out, or restarting after the agent installs, there are two interactions to be aware of:

1. **OBI's trace propagation rewrites in-flight traffic.** Service-mesh proxies and eBPF CNIs validate the bytes they receive, and *every* propagation mode alters them — `tcp` and `all` append a TCP option via Traffic Control, and even `headers` widens the request buffer in place for plaintext HTTP (and falls back to the TCP-option path for HTTPS, which OBI cannot read). That can fail mTLS, get dropped by the CNI, or confuse the proxy. The chart now ships `ebpf.contextPropagation: false` for exactly this reason, but an install predating that change — or any upgrade carried forward with `--reuse-values` — is still on `true`. Confirm with `helm get values <release> -n oneuptime-kubernetes-agent -a | grep -A2 contextPropagation`, then turn it off:

    ```bash
    helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
      --namespace oneuptime-kubernetes-agent --reset-then-reuse-values \
      --set ebpf.contextPropagation=false
    ```

2. **OBI attaches uprobes to executables — including sidecars.** Attaching to `linkerd2-proxy`, `envoy`, or a CNI agent can stall the binary. The default `ebpf.excludeExePaths` already lists the common ones (`linkerd2-proxy`, `envoy`, `istio-pilot-agent`, `pilot-agent`, `cilium-*`, `calico-node`, `kube-router`). If you maintain your own exclude list, make sure these basenames are present.

**Do NOT add broad globs like `*/proxy` to `excludeExePaths`** — `*/proxy` will also match *your* binaries (`auth-proxy`, `oauth2-proxy`, ...) and silently drop their traces. List the specific sidecar basename instead.

### Large HTTP responses hang mid-transfer after installing the agent

Symptoms: small requests are fine, but responses over roughly 64KB through an L7 proxy (nginx, an ingress controller) stall part-way through the body and never complete — the client sits on a half-received payload until it times out. Downloads, large JSON API responses, and image/artifact pulls are the usual casualties. Nothing in the application or the proxy logs an error, because from their side the write succeeded; the bytes just stop arriving.

This is `ebpf.contextPropagation`. To fit the `traceparent` in, OBI rewrites the outbound stream in the kernel — widening the request buffer in place for plaintext HTTP, or appending a TCP option from a Traffic Control hook for TLS and raw TCP. Both require the connection's byte accounting to be fixed up afterwards, and when that fixup is wrong the stream desynchronizes. The break only shows up once a transfer is large enough for the rewrite to span segments, which is why small requests look healthy and it reads as an application bug.

Confirm by turning propagation off and retrying the transfer:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --reset-then-reuse-values \
  --set ebpf.contextPropagation=false
kubectl rollout restart daemonset -n oneuptime-kubernetes-agent -l component=ebpf-instrument
```

Existing stuck connections do not recover on their own — they were already desynchronized — so restart the clients holding them. `false` is now the shipped default, but an install predating that change, or any upgrade carried forward with `--reuse-values`, is still on `true` — so verify with `helm get values` rather than assuming from your chart version.

If you need cross-service trace linking back, prefer instrumenting the services with an OpenTelemetry SDK (which propagates `traceparent` in userspace, with no kernel rewriting) over re-enabling this. If you do re-enable it, do so on a non-production cluster first and verify large transfers through your proxy before rolling it further.

### ClickHouse crash-loops with `CORRUPTED_DATA` after enabling the agent

If a ClickHouse pod refuses to start and its logs show:

```
<Error> Application: Code: 246. DB::Exception: Calculated checksum of the executable
(...) does not correspond to the reference checksum stored in the executable (...).
(CORRUPTED_DATA)
```

the binary is fine — this is OBI attaching a **uprobe** to `/usr/bin/clickhouse` and patching its in-memory text. ClickHouse hashes its own executable at startup and aborts when the hash changes. Because OneUptime's own telemetry store is ClickHouse, an un-excluded agent will crash-loop the platform's database.

The default `ebpf.excludeExePaths` ships `*/clickhouse`. **Older releases of this chart listed it too, but passed the list to OBI as `OTEL_EBPF_EXCLUDE_AUTO_TARGET_EXE`, which is not an OBI setting — no exclusion was ever applied.** The list now reaches OBI through its config file (`discovery.exclude_instrument`), so upgrade the agent first. If you maintain a custom exclude list, make sure `*/clickhouse` is on it and roll the agent:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --reset-then-reuse-values \
  --set 'ebpf.excludeExePaths=...existing list...\,*/clickhouse'
```

(`--set` splits on commas, so each comma inside the list is escaped as `\,`; a values file needs no escaping.) Then restart the affected ClickHouse pod(s) — `kubectl delete pod -l app.kubernetes.io/name=clickhouse -n <ns>` — so it boots without the uprobe attached. Instrumenting a database server via uprobes has little value anyway; observe it through native metrics and client-side traces instead.

### No traces appear even though OBI pods are running

Three things to check, in order:

1. **`ebpf.autoTargetExe`** — defaults to `*` (everything OBI can recognize). If you've narrowed it, your services may not match.
2. **`ebpf.excludeExePaths`** — make sure your service's binary basename isn't in here, and that you haven't added a broad glob like `*/proxy` or `*/app` that matches it accidentally. Run `helm get values <release>` to see the effective list.
3. **Service mesh** — if all your traffic flows through `linkerd2-proxy` or `envoy` and those are excluded (correctly — see above), OBI still sees the application's local connection to the sidecar on `127.0.0.1`. If you see no traces at all, also check that `ebpf.printTraces=true` shows spans in the OBI pod's stdout:

    ```bash
    helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
      --namespace oneuptime-kubernetes-agent --reset-then-reuse-values \
      --set ebpf.printTraces=true
    kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
    ```

    No spans there means OBI isn't capturing traffic on that node. Spans there but nothing in OneUptime means the OTLP export path is broken — check the metrics-collector Deployment logs.
4. **The service exports OTLP itself** — with `ebpf.excludeOtelInstrumentedServices: true` (OBI's default), OBI stops exporting eBPF traces for a process as soon as it sees it send OTLP. If that app's SDK reports to a different project or backend, set it to `false`.

### Every trace is a single span

Check what kind of span it is before anything else:

- **A bare database command (`set`, `evalsha`, `SELECT`)** — a database server's own span or a call made outside any request. These cannot be linked; `ebpf.dropDatabaseServerSpans` and `ebpf.dropUnlinkedDatabaseCalls` (both on by default) drop them. Only an explicit `false` turns either off — a key missing from `helm get values` (a release upgraded with `--reuse-values`) counts as on. To see what is actually running: `kubectl get configmap -n oneuptime-kubernetes-agent <release>-kubernetes-agent-deployment -o yaml | grep -A4 'filter/ebpf-unlinked-db:'`.
- **A request (`GET /api/...`) with none of its downstream calls under it, from a Node.js service** — OBI's Node.js agent is not running in that process. Check that OBI identified the process as Node.js (`type=nodejs` on its `instrumenting process` line), then what OBI's Node.js injector (`component=nodejs.Injector`) logged:

    ```bash
    kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=-1 \
      | grep -E 'instrumenting process.*cmd=[^ ]*node|component=nodejs\.Injector|skipping agent injection'
    ```

    - `type=rust` on a `node` executable means that OBI cannot identify the Node.js build: Node.js 26 and later contain Rust code, and OBI before v0.14 checked for Rust before checking for Node.js. OBI v0.14 fixes this: run the agent with `--set ebpf.image.tag=v0.14.0` (or later) once that release is published. The chart already renders what v0.14 needs.
    - `Script successfully injected` means the agent is in. OBI v0.13 logs a `loading NodeJS instrumentation pid=…` line before each attempt; v0.14 logs it at debug only (`--set ebpf.logLevel=debug`).
    - On OBI v0.13, `Node.js process has a custom SIGUSR1 handler, skipping agent injection` means the app uses SIGUSR1 itself, and OBI will not interfere.
    - On OBI v0.14, `skipping Node.js agent injection` comes with a `reason=`: `process has a custom SIGUSR1 handler` or `process source files reference SIGUSR1` (the app uses the signal itself, and OBI will not interfere), `SIGUSR1 is neither caught nor ignored, so it would terminate the process` or `SIGUSR1 handling is unknown`, `the Node.js version could not be read from the executable`, or `Node.js … does not provide AsyncLocalStorage` (older than 12.17, or a 13.x before 13.10).
    - `couldn't attach NodeJS injector` (an error) means the injection was tried and failed; its `error=` says why.
    - `injection queue is full, skipping agent injection runtime=node` means OBI found more than 100 Node.js processes at once (at OBI start on a busy node, for example). Restart the affected app pod to have it injected; restarting OBI rediscovers everything at once and can overflow again.
    - No injector line at all for a `type=nodejs` process: check that `ebpf.nodejs.enabled` is not `false`, which turns the agent off entirely.
- **A request whose caller is in another service** — expected when the two run on different nodes: cross-node links need trace context on the wire. See *Cross-service trace linking* above.

### `kubectl exec` into an agent pod fails — no shell, curl, or bash

```
$ kubectl exec -it <agent-pod> -- bash
error: exec: "bash": executable file not found in $PATH
```

This is expected, not a bug. The metrics-collector Deployment and the
log-collector DaemonSet run the upstream OpenTelemetry Collector image, which is
**distroless** (built `FROM scratch`): it contains only the collector binary and
CA certs — no `/bin/sh`, no `bash`, no `curl`. There's nothing to exec into.

You usually hit this when verifying connectivity from inside the cluster to your
OneUptime instance (DNS, NetworkPolicy, egress proxy, TLS). Two ways to get a
shell that shares the agent pod's network:

**Option A — ephemeral debug container (recommended, no install change).**
Requires Kubernetes ≥ 1.23. Leaves no permanent footprint:

```bash
# Pick a pod (metrics collector shown; use component=log-collector for logs)
POD=$(kubectl get pod -n oneuptime-kubernetes-agent \
  -l component=metrics-collector -o name | head -1)

kubectl debug -it "$POD" -n oneuptime-kubernetes-agent \
  --image=nicolaka/netshoot --target=otel-collector -- bash
# then, from the shell:
curl -v https://oneuptime.example.com/otlp/v1/metrics
```

The ephemeral container shares the pod's network namespace, so this tests the
**exact** egress path the collector uses. `--target=otel-collector` also shares
the PID namespace so you can inspect the collector process and its filesystem
via `/proc/<pid>/root`.

**Option B — built-in debug sidecar (`debug.enabled`).** If you need a shell
resident in every agent pod (e.g. recurring debugging, or a cluster that blocks
ephemeral containers), enable the debug sidecar. It injects a `debug` container
(default `nicolaka/netshoot`) into the metrics Deployment and the logs DaemonSet
and turns on `shareProcessNamespace`:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --reset-then-reuse-values \
  --set debug.enabled=true

kubectl exec -it "$POD" -n oneuptime-kubernetes-agent -c debug -- bash
# $ONEUPTIME_URL is preset in the sidecar:
curl -v "$ONEUPTIME_URL/otlp/v1/metrics"
```

This adds an always-running container to every agent pod (extra resources +
attack surface), so **turn it back off** once you're done:
`--set debug.enabled=false`. `curl`, `dig`, and `nslookup` work out of the box;
`ping`/`traceroute`/`tcpdump` need raw sockets — grant them with
`--set 'debug.securityContext.capabilities.add[0]=NET_RAW'`. See the `debug.*`
keys in [`values.yaml`](values.yaml) for all options.

> The `api`-mode log tailer (`logs.mode: api`) runs a Node.js image that already
> has `bash`, so you can `kubectl exec` into it directly — though it ships no
> `curl`; use `node -e "fetch('https://…').then(r=>console.log(r.status))"`.

## Source

- Chart: [`HelmChart/Public/kubernetes-agent/`](https://github.com/OneUptime/oneuptime/tree/master/HelmChart/Public/kubernetes-agent)
- Log-tailer image: [`agents/KubernetesLogTailer/`](https://github.com/OneUptime/oneuptime/tree/master/agents/KubernetesLogTailer)
