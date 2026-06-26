<!-- markdownlint-disable MD033 -->
<h1 align="center"><img alt="oneuptime logo" width=50% src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/></h1>
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
| `oneuptime.apiKey` | Project API key. Create one at **Project Settings → API Keys**. |
| `clusterName` | Unique name for this cluster. Stamped as `k8s.cluster.name` on every record. |

### Common

| Key | Default | Description |
| --- | --- | --- |
| `preset` | `""` *(→ `standard`)* | `standard`, `gke-autopilot`, or `eks-fargate`. See table above. |
| `namespaceFilters.include` | `[]` | If set, only these namespaces are monitored. Empty means all. |
| `namespaceFilters.exclude` | `["kube-system"]` | Namespaces to skip. |
| `logs.enabled` | `true` | Turn pod log collection on or off. |
| `logs.mode` | `""` *(derived from `preset`)* | Advanced override — `daemonset`, `api`, or `disabled`. Explicit value always wins over the preset. |
| `ebpf.enabled` | `true` | Auto-capture HTTP/gRPC traces from every pod via OpenTelemetry eBPF Instrumentation. See section below. |
| `profiling.enabled` | `false` | Continuous CPU flame graphs via OpenTelemetry eBPF Profiler — separate DaemonSet, samples stacks at 19Hz, no SDK needed. Off by default; opt in for more telemetry. |
| `hostMetrics.enabled` | `true` | Per-node OS metrics (disk I/O, filesystem inodes, NIC errors, paging, load average) via the OTel `hostmetrics` receiver. |
| `auditLogs.enabled` | `false` | Tail `/var/log/kubernetes/audit.log` from the host. Self-managed clusters only — managed K8s routes audit logs to a cloud sink. |
| `csi.enabled` | `false` | Scrape Prometheus metrics from CSI (storage) driver pods. |
| `coreDns.enabled` | `false` | Scrape Prometheus metrics from CoreDNS (`kube-dns` Service by default). |
| `resourceSpecs.enabled` | `true` | Pull full K8s object specs (labels, env vars, status) for the dashboard. |
| `controlPlane.enabled` | `false` | Scrape etcd / api-server / scheduler / controller-manager. Self-managed clusters only — managed offerings typically don't expose these endpoints. |
| `kubeletstats.utilizationMetrics.enabled` | `true` | Saturation metrics — container & pod CPU/memory as a percentage of request and limit. No extra scrape; derived from data the kubelet already returns. Always 0 when pods have no request/limit set. |
| `kubeletstats.volumeMetrics.enabled` | `true` | Per-PVC disk usage (`k8s.volume.available`, `k8s.volume.capacity`). One series per PVC per pod — bounded for most clusters, heavier on stateful workloads with thousands of PVCs. |
| `cadvisor.enabled` | `true` | Scrape this node's kubelet `/metrics/cadvisor` endpoint for CFS throttling and OOM kill counters that `kubeletstats` doesn't translate. An allowlist drops everything except 3 metrics at the receiver. |
| `kubeStateMetrics.enabled` | `false` | Pull cluster-state metrics (pod phases, scheduling status, container waiting reasons, resource quotas) from kube-state-metrics. `mode: bundled` (default) deploys a small KSM Deployment for you; `mode: external` scrapes an existing KSM via `endpoint`. |

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

When `ebpf.enabled` is also true (the default), the profiler correlates samples with OBI's trace context via the shared bpffs map, so each span gets its own flame graph linkable from the trace view.

| Key | Default | Description |
| --- | --- | --- |
| `profiling.enabled` | `false` | Master switch. Off by default — opt in for continuous CPU flame graphs. Same kernel and privileged-pod requirements as `ebpf.*` — cannot run on GKE Autopilot / EKS Fargate. |
| `profiling.image.tag` | `0.152.0` | `otel/opentelemetry-collector-ebpf-profiler` image tag. |
| `profiling.samplesPerSecond` | `19` | Sampling frequency. Higher = more detail + more CPU. |
| `profiling.offCpuThreshold` | `0` | (0–1] enables off-CPU profiling at the given sampling probability — diagnoses lock contention and blocking I/O. Off by default. |
| `profiling.tracers` | `""` *(all)* | Comma-separated list of language tracers to load. Narrow to e.g. `"go,python"` if you don't care about the others. |
| `profiling.obiProcessContext` | `true` | Correlate samples with OBI's trace context. Has no effect when `ebpf.enabled` is false. |

### Other data collection knobs

- **`hostMetrics.*`** — host-level OS metrics from the OTel `hostmetrics` receiver, scraped inside the log-collector DaemonSet (no extra pods). Fills the gaps that `kubeletstats` doesn't cover.
- **`kubeletstats.utilizationMetrics.*`** / **`kubeletstats.volumeMetrics.*`** — opt-in metric groups in the existing `kubeletstats` receiver. The first enables 8 derived saturation series (CPU/memory as % of request & limit) for containers and pods; the second adds per-PVC disk usage. Both run inside the existing DaemonSet — no extra pods, no extra scrapes.
- **`cadvisor.*`** — scrapes the kubelet's `/metrics/cadvisor` endpoint from each node's DaemonSet pod for the container metrics `kubeletstats` doesn't translate: CFS throttling counters (`container_cpu_cfs_throttled_seconds_total`, `container_cpu_cfs_periods_total`) and OOM kill events (`container_oom_events_total`). A relabel allowlist keeps only those three series so cardinality stays bounded.
- **`kubeStateMetrics.*`** — pulls cluster-state metrics from kube-state-metrics: pod phases (Pending / Terminating), pod scheduling status (`kube_pod_status_scheduled`, for pods that fail to schedule), container waiting reasons (CrashLoopBackOff, ImagePullBackOff), and resource quota usage. Off by default because the `bundled` mode adds a small KSM Deployment to the chart's footprint. If you already run KSM in the cluster, set `kubeStateMetrics.mode: external` and `kubeStateMetrics.endpoint: <url>` to scrape that instead. A relabel allowlist forwards only the metric families that power monitors (KSM exports ~100 by default).
- **`auditLogs.*`** — Kubernetes API audit logs. Off by default because most managed K8s platforms don't expose them as files. Enable on self-managed clusters where you set `--audit-log-path`.
- **`csi.*`** — auto-discovers pods labeled `app=csi-driver` (or `app.kubernetes.io/component=csi-driver`) and scrapes their `metrics` port. Most cloud-provider CSI drivers fit this convention.
- **`coreDns.*`** — scrapes the cluster's CoreDNS service on `:9153/metrics`. Surfaces DNS query rate, latency, cache hit rate, and error counts — a common P99 latency culprit.

### eBPF auto-instrumentation (`ebpf.*`) — on by default

The agent ships a DaemonSet running [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. OBI loads eBPF programs into the kernel to capture HTTP/HTTPS, gRPC, and SQL/Redis calls from any process — Go, .NET, Java, Node.js, Python, Ruby, or Rust — with no code changes, no SDK, and no sidecar. Captured traffic is exported as OTLP traces (and request/latency metrics) directly to OneUptime, where it appears under **Telemetry → Traces** and the service map.

Requirements:

- **Linux kernel 5.8+** with BTF. This is the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, and RHEL/Stream 9+. Kernel 4.18+ works on RHEL-family distros with vendor backports.
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
| `ebpf.image.tag` | `v0.9.0` | OBI image tag. Pin to a known-good version; OBI is pre-1.0 so minor bumps may introduce changes. |
| `ebpf.autoTargetExe` | `*` | Glob of executable paths to auto-instrument. Narrow this (e.g. `*/python,*/java`) if you only want to track specific runtimes. |
| `ebpf.excludeExePaths` | (shells, kubelet, runc, containerd, otelcol, OBI itself — see `values.yaml`) | Comma-separated globs to skip, so you don't see noise from cluster plumbing. |
| `ebpf.logLevel` | `info` | `debug`, `info`, `warn`, `error`. |
| `ebpf.printTraces` | `false` | Print spans to the OBI pod's stdout. Useful for confirming OBI is seeing traffic before checking the dashboard. |
| `ebpf.resources.*` | `100m / 256Mi` requests, `1000m / 1Gi` limits | Tune for cluster size. |

**Signal families** — all on by default, disable individually with `--set ebpf.features.<key>=false`:

| Key | Default | What it adds |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | `true` | HTTP/gRPC RED metrics (request rate, latency, errors) per service. |
| `ebpf.features.spanMetrics` | `true` | Per-span request/response size and duration histograms. |
| `ebpf.features.serviceGraph` | `true` | Caller → callee request edges; drives the service map view. |
| `ebpf.features.hostMetrics` | `true` | CPU and memory per instrumented process. |
| `ebpf.features.networkMetrics` | `true` | Pod-to-pod TCP/UDP byte and packet counters. |
| `ebpf.features.networkInterZoneMetrics` | `false` | Inter-zone variant of `networkMetrics` (doubles cardinality). |
| `ebpf.features.tcpStats` | `true` | Node-level TCP RTT, failed-connection, and retransmit counters. |

**Cross-service trace linking** — also on by default:

| Key | Default | Description |
| --- | --- | --- |
| `ebpf.contextPropagation` | `true` | OBI injects W3C `traceparent` into outbound traffic so requests crossing service boundaries link into a single trace, no SDK required. |
| `ebpf.contextPropagationMode` | `headers` | How OBI injects the `traceparent`. `headers` (default) only modifies HTTP/1.1 request headers — safe alongside service meshes (Linkerd, Istio), mTLS, and eBPF CNIs (Cilium, Calico). `ip` injects an IPv4/IPv6 option for propagation over raw TCP; can be dropped by middleboxes. `all` does both — most coverage but the IP-option half can break service-mesh proxies (linkerd2-proxy, envoy) by corrupting bytes those proxies validate. |
| `ebpf.trackRequestHeaders` | `true` | Kernel-side header tracking so propagation works for plain HTTP servers (non-Go, non-TLS). Only effective when `contextPropagation` is true. |
| `ebpf.logToTraceCorrelation` | `false` | **Off by default — opt in.** OBI injects `trace_id` / `span_id` into **JSON-formatted** log lines from instrumented processes (existing fields preserved); the filelog DaemonSet lifts them onto the LogRecord so clicking a span in the trace view jumps to its logs. Plain-text logs pass through unchanged. **Do NOT enable** in clusters running LD_PRELOAD-based APM agents (Dynatrace OneAgent, New Relic, AppDynamics, Datadog, Instana) — the log enricher's in-process buffer rewrite races with those agents' `write()` wrappers and crashes the application (typically SIGSEGV / exit 139 in .NET). See [APM agent compatibility](#application-pods-crash-with-sigsegv-after-enabling-log-trace-correlation) below. |
| `ebpf.logEnricher.services` | `[{service: [{exe_path: "*"}]}]` | OBI GlobAttributes selector for which processes get the log enricher (only consulted when `logToTraceCorrelation: true`). Each entry can match by `exe_path`, `languages`, `k8s_pod_labels`, `k8s_pod_annotations`, `open_ports`, or `cmd_args`. Narrow this when enabling log enrichment alongside an APM agent — list only the workloads you want enriched (OBI's log_enricher does not support `exclude_services`). |

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

## Uninstalling

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Troubleshooting

See the [Install the Kubernetes Agent](https://oneuptime.com/docs/monitor/kubernetes-agent) guide — it covers the "hostPath blocked" error, missing logs, and horizontal sharding for large clusters.

### The cluster shows "Disconnected" and/or no data appears — run the diagnostic script

This is usually one problem, not two: telemetry isn't being accepted, so the cluster never connects and nothing ingests. The most common cause — especially after a reinstall — is a **wrong or revoked ingestion key**, which is hard to spot because the OTLP endpoints answer `200` even for a bad token (to avoid making a misconfigured collector retry-storm the server). The collector therefore logs no errors while every byte is dropped.

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

1. **OBI's IP-option trace propagation modifies packet headers.** Service-mesh proxies and eBPF CNIs validate the bytes they receive — an extra IP option from OBI can fail mTLS, get dropped by the CNI, or confuse the proxy. The chart defaults to `ebpf.contextPropagationMode: headers` (HTTP/1.1 headers only, no packet modification) for exactly this reason. If you upgraded from an older release with `--reuse-values`, you may still be on the old `all` behavior — re-apply explicitly:

    ```bash
    helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
      --namespace oneuptime-kubernetes-agent --reset-then-reuse-values \
      --set ebpf.contextPropagationMode=headers
    ```

2. **OBI attaches uprobes to executables — including sidecars.** Attaching to `linkerd2-proxy`, `envoy`, or a CNI agent can stall the binary. The default `ebpf.excludeExePaths` already lists the common ones (`linkerd2-proxy`, `envoy`, `istio-pilot-agent`, `pilot-agent`, `cilium-*`, `calico-node`, `kube-router`). If you maintain your own exclude list, make sure these basenames are present.

**Do NOT add broad globs like `*/proxy` to `excludeExePaths`** — `*/proxy` will also match *your* binaries (`auth-proxy`, `oauth2-proxy`, ...) and silently drop their traces. List the specific sidecar basename instead.

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
- Log-tailer image: [`KubernetesLogTailer/`](https://github.com/OneUptime/oneuptime/tree/master/KubernetesLogTailer)
