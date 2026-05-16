# Install the Kubernetes Agent

The OneUptime Kubernetes agent collects cluster metrics, events, pod logs, **application traces (HTTP/gRPC via eBPF)**, **continuous CPU flame graphs (eBPF profiler)**, and **OS-level node metrics** from your Kubernetes cluster and ships them to OneUptime. It is distributed as a Helm chart and installed with one command — eBPF auto-instrumentation and profiling are both on by default, so you see service-level traces, RED metrics, and flame graphs with no code changes.

## Quick start

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update

helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<A_UNIQUE_NAME_FOR_THIS_CLUSTER>
```

Your cluster will appear in OneUptime within a few minutes.

## Pick the right preset for your cluster

Different Kubernetes distributions have different constraints — most notably, whether workloads can mount `hostPath` volumes. Rather than make you read security docs, the chart exposes a single top-level option: `preset`.

| Preset | Use for | Log collection | Notes |
| --- | --- | --- | --- |
| `standard` (default) | Self-managed, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet reading `/var/log/pods` via hostPath | Lowest overhead. hostPath is available on these platforms. |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API tailer (Deployment) | hostPath is blocked on Autopilot. Sets a hardened security context that passes Autopilot's Pod Security Standards. |
| `eks-fargate` | **EKS Fargate** | Kubernetes API tailer (Deployment) | Same as `gke-autopilot`. Fargate blocks hostPath and DaemonSets. |

If you aren't sure, leave `preset` unset — you get `standard` defaults. If your cluster rejects the install with a Pod Security policy error mentioning `hostPath`, switch to `gke-autopilot` (or `eks-fargate` on EKS Fargate) and re-install.

### Examples

**GKE Standard, EKS on EC2, self-managed, or AKS:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod
```

**GKE Autopilot:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## How the two log-collection modes differ

Under the hood, `preset` sets `logs.mode` — and you can also set that directly if you need to override the preset default.

### DaemonSet mode (`logs.mode: daemonset`)

A DaemonSet runs one OpenTelemetry Collector pod per node. It tails log files under `/var/log/pods/` via a hostPath volume and forwards them over OTLP.

- **Pros:** lowest overhead, scales linearly with nodes, no load on the Kubernetes API server, handles log rotation.
- **Cons:** requires hostPath, requires the ability to schedule DaemonSets — both unavailable on GKE Autopilot and EKS Fargate.

### API mode (`logs.mode: api`)

A single-replica Deployment (the `oneuptime/kubernetes-log-tailer` image) uses the Kubernetes API to stream container logs — the same endpoint `kubectl logs -f` uses. No hostPath, no host access, no DaemonSet.

- **Pros:** works on GKE Autopilot, EKS Fargate, and any cluster that blocks hostPath or enforces the `restricted` Pod Security Standard.
- **Cons:** every container stream is a long-lived connection to `kube-apiserver`. In practice one replica handles a few thousand containers comfortably. For very large clusters, shard by namespace using `logs.api.replicas` plus `namespaceFilters.include` on each replica.

### Which one should you use?

If hostPath works, use DaemonSet. Everywhere else, use API mode. The `preset` setting picks the right one for you.

You can also disable log collection entirely with `--set logs.enabled=false` and ship application logs via OpenTelemetry SDKs instead. See the [OpenTelemetry](/docs/telemetry/open-telemetry) docs.

## Application traces & HTTP requests via eBPF (on by default)

The chart ships a DaemonSet running [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. OBI loads eBPF programs into the Linux kernel and watches socket-level traffic to reconstruct HTTP/HTTPS, gRPC, and SQL/Redis calls from every pod on the node — no code changes, no SDK, no sidecar. Captured traffic is exported as OTLP traces and request/latency metrics directly to OneUptime.

After installing, your services start appearing under **Telemetry → Traces** and the service map within a minute or two, with `k8s.cluster.name` set to your `clusterName` so you can filter by cluster.

### When to turn it off

eBPF is **enabled by default**. You should disable it (`--set ebpf.enabled=false`) if:

- You're installing on **GKE Autopilot** or **EKS Fargate**. Those platforms block privileged pods, and OBI needs privileged mode to load eBPF programs.
- Your nodes run a kernel older than **Linux 5.8** without BTF backports. (Modern distros — Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+ — are fine.)
- You're already shipping traces via the OpenTelemetry SDK from your apps and don't want duplicates.

### What gets emitted

OBI extracts several signal families from the captured traffic. All are on by default; each can be disabled independently with `--set ebpf.features.<key>=false`:

| Signal | Default | What it adds |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | on | HTTP/gRPC RED metrics — request rate, latency histograms, error counts — per service. |
| `ebpf.features.spanMetrics` | on | Span-attribute-keyed metrics: request size, response size, duration broken down per route/operation. |
| `ebpf.features.serviceGraph` | on | Service-to-service edge metrics (caller → callee request rate + latency). Powers the service map. |
| `ebpf.features.hostMetrics` | on | CPU and memory per instrumented process — saves running a separate profiler for basic capacity questions. |
| `ebpf.features.networkMetrics` | on | Pod-to-pod TCP/UDP flow byte and packet counters with k8s metadata. Surfaces every pair of pods that talk, including ones running protocols OBI can't parse. |
| `ebpf.features.networkInterZoneMetrics` | off | Inter-zone variant of network metrics. Doubles cardinality; only worth enabling if you actually use zone-based scheduling. |
| `ebpf.features.tcpStats` | on | Node-level TCP statistics: RTT histograms, failed-connection counts, retransmits. |

OBI also propagates trace context across service boundaries by default. When pod A makes an HTTP/gRPC request to pod B, OBI injects a W3C `traceparent` header into the outbound request — so the resulting span on pod B's side links into the same trace as pod A's outbound. No SDK changes needed in either app.

| Option | Default | Description |
| --- | --- | --- |
| `ebpf.contextPropagation` | on | Inject W3C `traceparent` into outbound traffic (HTTP headers + custom TCP option). Set to `false` to keep each service's spans local. |
| `ebpf.trackRequestHeaders` | on | Kernel-side request-header tracking so propagation also works on plain HTTP servers (non-Go, non-TLS). Only takes effect when `contextPropagation` is true. |

### Log ↔ trace correlation

Also on by default. OBI's log enricher intercepts pod stdout writes from instrumented processes and:

- For **JSON-format logs**: injects `trace_id` and `span_id` fields into the line (any existing values in the log are preserved). The filelog DaemonSet then lifts those fields onto the LogRecord's native trace_id/span_id slots, so clicking a span in the trace view jumps to its logs in OneUptime — and clicking a log line jumps to its parent trace.
- For **non-JSON logs**: the line is preserved unchanged — still collected, just not auto-linked.

| Option | Default | Description |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | on | Enable the OBI log enricher and the filelog pipeline's trace_id lift. Set to `false` to skip both. |

Caveats:

- **Logs must be JSON for trace_id to appear.** Switch your logger to a JSON formatter — `structlog`, `pino`, `winston`, `serilog`, `logback-json`, klog `--logging-format=json`, etc.
- **Buffered stdout breaks the correlation** because the `write()` syscall fires on a different thread than the one that handled the request. Common fixes:
  - **Python**: set `PYTHONUNBUFFERED=1` (the runtime block-buffers stdout when not a TTY).
  - **.NET**: at startup, `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`. Microsoft.Extensions.Logging `AddConsole()` and Serilog's async sinks won't work either — switch to a synchronous console writer (Serilog's default `WriteTo.Console()` is fine).
- Greenlet / gevent, Tornado, and other custom async runtimes aren't covered.

### Tuning

| Option | Default | Description |
| --- | --- | --- |
| `ebpf.enabled` | `true` | Master switch. Set to `false` to skip the eBPF DaemonSet entirely. |
| `ebpf.image.tag` | `v0.9.0` | OBI image tag. OBI is pre-1.0; pin to a known-good version and re-test on bumps. |
| `ebpf.autoTargetExe` | `*` | Glob of executables to instrument. Narrow this (e.g. `*/python,*/java`) if you want to scope auto-instrumentation. |
| `ebpf.excludeExePaths` | (shells, kubelet, runc, containerd, otelcol, OBI itself) | Comma-separated globs to skip. |
| `ebpf.logLevel` | `info` | `debug`, `info`, `warn`, or `error`. Set to `debug` while troubleshooting. |
| `ebpf.printTraces` | `false` | Print spans to OBI's stdout in addition to OTLP export — useful for verifying capture during install. |
| `ebpf.resources.*` | `100m / 256Mi` requests, `1000m / 1Gi` limits | Bump for high-traffic clusters. |

To check that OBI is running and seeing traffic:

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## Continuous CPU profiling (on by default)

A separate DaemonSet runs the [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) — packaged as the `otel/opentelemetry-collector-ebpf-profiler` image. It samples on-CPU stacks at 19Hz across every supported runtime (Go, Java, .NET, Python, Ruby, Node.js, PHP, Perl, C/C++, Rust) and ships OTLP profiles to OneUptime, where they appear under **Telemetry → Performance Profiles** and as flame graphs linked from individual trace spans.

When eBPF auto-instrumentation is also on (`ebpf.enabled: true`, the default), each CPU sample is correlated with OBI's trace context via a shared bpffs map — so flame graphs carry trace_id/span_id and the OneUptime UI can show you a per-span flame graph.

Requirements:

- **Linux kernel 5.10+** (slightly newer than the 5.8 OBI needs).
- Privileged pod with hostPID — same constraints as the eBPF auto-instrumentation DaemonSet. Disable on GKE Autopilot, EKS Fargate, and locked-down environments: `--set profiling.enabled=false`.

Tuning:

| Option | Default | Description |
| --- | --- | --- |
| `profiling.enabled` | `true` | Master switch. |
| `profiling.image.tag` | `0.152.0` | `otel/opentelemetry-collector-ebpf-profiler` image tag. The profiler is pre-1.0; pin to a known-good version. |
| `profiling.samplesPerSecond` | `19` | Sampling frequency in Hz. Upstream default; avoids accidentally aliasing with common timer frequencies. |
| `profiling.offCpuThreshold` | `0` | (0–1] enables off-CPU profiling — diagnoses lock contention and blocking I/O. Off by default because it adds tracepoint overhead. |
| `profiling.tracers` | `""` *(all runtimes)* | Comma-separated list of language tracers to load. |
| `profiling.obiProcessContext` | `true` | Correlate samples with OBI's trace context for trace ↔ profile linking. |

## Other data collection (host metrics, audit logs, CSI, CoreDNS)

The chart can also collect:

| `<key>.enabled` | Default | What it adds |
| --- | --- | --- |
| `hostMetrics` | on | Per-node OS metrics from `/proc` and `/sys` — disk I/O queue depth, filesystem inode usage, NIC error counters, paging stats, load average. Lives inside the log-collector DaemonSet (no extra pods). |
| `auditLogs` | off | Tail `/var/log/kubernetes/audit.log` from the host. Captures every Kubernetes API request — who did what to which resource. Self-managed clusters only — managed K8s (EKS, GKE, AKS, DOKS) route audit logs to the cloud provider's sink. |
| `csi` | off | Auto-discovers pods labeled `app=csi-driver` (or `app.kubernetes.io/component=csi-driver`) and scrapes their Prometheus `metrics` port — volume attach/detach latency, provisioning failures, IOPS. |
| `coreDns` | off | Scrapes the cluster CoreDNS service on `:9153/metrics`. Surfaces query rate, latency, cache hit rate, error counts — common P99 latency culprits. |

## Common options

| Option | Default | Description |
| --- | --- | --- |
| `preset` | (empty — treated as `standard`) | See the table above. |
| `oneuptime.url` | *(required)* | URL of your OneUptime instance. |
| `oneuptime.apiKey` | *(required)* | Project API key (Settings → API Keys). |
| `clusterName` | *(required)* | Unique name for this cluster. Stamped as `k8s.cluster.name` on every record. |
| `namespaceFilters.include` | `[]` | If set, only these namespaces are monitored. |
| `namespaceFilters.exclude` | `["kube-system"]` | Namespaces to skip. |
| `logs.enabled` | `true` | Turn log collection on or off. |
| `logs.mode` | (derived from `preset`) | `daemonset`, `api`, or `disabled`. Overrides the preset. |
| `logs.api.replicas` | `1` | Number of log-tailer Deployment replicas (only in API mode). |
| `ebpf.enabled` | `true` | Auto-capture HTTP/gRPC traces from every pod via OpenTelemetry eBPF Instrumentation. See section above. |
| `profiling.enabled` | `true` | Continuous CPU flame graphs via the OpenTelemetry eBPF Profiler. See section above. |
| `hostMetrics.enabled` | `true` | Per-node OS metrics. |
| `auditLogs.enabled` | `false` | Kubernetes audit log collection (self-managed clusters). |
| `csi.enabled` | `false` | CSI driver Prometheus metrics. |
| `coreDns.enabled` | `false` | CoreDNS Prometheus metrics. |
| `controlPlane.enabled` | `false` | Scrape etcd / api-server / scheduler / controller-manager. Self-managed clusters only — managed offerings (EKS/GKE/AKS) typically do not expose these endpoints. |

See the [chart's `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) for the full list.

## Upgrading

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` keeps your existing configuration; pass any new `--set` overrides on top of it.

## Uninstalling

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Troubleshooting

### The install fails with "hostPath volumes are not allowed"

Your cluster blocks hostPath. Switch to an API-mode preset:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### No logs show up in OneUptime

Check the agent pods:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

In API mode, the log-tailer pod exposes `/healthz` on port 13133 — hit it via `kubectl port-forward` for an export status snapshot.

### The eBPF DaemonSet pod is `CrashLoopBackOff` or fails to start

Check the OBI pod logs:

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

Common causes:

- **Kernel too old or missing BTF.** OBI needs Linux 5.8+ with BTF. Check with `uname -r` on a node. If you can't upgrade, disable eBPF: `--set ebpf.enabled=false`.
- **Privileged pods are blocked.** Some clusters reject privileged pods even outside Autopilot/Fargate. Disable eBPF.
- **No traces in the dashboard but OBI is running.** Set `--set ebpf.printTraces=true` and check OBI's stdout — if you see spans there, the issue is OTLP delivery (check the `OTEL_EXPORTER_OTLP_ENDPOINT` and your OneUptime URL/API key). If you don't see spans, the traffic OBI is watching may all be encrypted by a TLS library OBI can't intercept (e.g. a statically linked TLS implementation it doesn't recognize).

### My cluster has too many pods for one log-tailer replica (API mode only)

Scale horizontally by sharding namespaces. Deploy once per namespace group:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Alternatively, bump `logs.api.replicas` — but note that each replica processes all allowed namespaces, so for deduplication you still need namespace sharding.
