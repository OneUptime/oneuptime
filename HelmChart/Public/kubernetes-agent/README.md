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
| `kubeStateMetrics.enabled` | `false` | Pull cluster-state metrics (pod phases, container waiting reasons, resource quotas) from kube-state-metrics. `mode: bundled` (default) deploys a small KSM Deployment for you; `mode: external` scrapes an existing KSM via `endpoint`. |

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
- **`kubeStateMetrics.*`** — pulls cluster-state metrics from kube-state-metrics: pod phases (Pending / Terminating), container waiting reasons (CrashLoopBackOff, ImagePullBackOff), and resource quota usage. Off by default because the `bundled` mode adds a small KSM Deployment to the chart's footprint. If you already run KSM in the cluster, set `kubeStateMetrics.mode: external` and `kubeStateMetrics.endpoint: <url>` to scrape that instead. A relabel allowlist forwards only the metric families that power monitors (KSM exports ~100 by default).
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
| `ebpf.logToTraceCorrelation` | `true` | OBI injects `trace_id` / `span_id` into **JSON-formatted** log lines from instrumented processes (existing fields preserved); the filelog DaemonSet lifts them onto the LogRecord so clicking a span in the trace view jumps to its logs. Plain-text logs pass through unchanged — to get trace_id, your app must log in JSON, and buffered runtimes need `PYTHONUNBUFFERED=1` (Python) or `Console.Out.AutoFlush = true` (.NET). |

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

## Source

- Chart: [`HelmChart/Public/kubernetes-agent/`](https://github.com/OneUptime/oneuptime/tree/master/HelmChart/Public/kubernetes-agent)
- Log-tailer image: [`KubernetesLogTailer/`](https://github.com/OneUptime/oneuptime/tree/master/KubernetesLogTailer)
