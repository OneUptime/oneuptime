<!-- markdownlint-disable MD033 -->
<h1 align="center"><img alt="oneuptime logo" width=50% src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/></h1>
<!-- markdownlint-enable MD033 -->

# OneUptime Kubernetes Agent

Collects cluster metrics, events, pod logs, and **application traces (HTTP/gRPC requests via eBPF)** from your Kubernetes cluster and ships them to OneUptime via OpenTelemetry. Install with one `helm install` command — no code changes or per-app SDK setup needed to see service traffic.

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
| `resourceSpecs.enabled` | `true` | Pull full K8s object specs (labels, env vars, status) for the dashboard. |
| `controlPlane.enabled` | `false` | Scrape etcd / api-server / scheduler / controller-manager. Self-managed clusters only — managed offerings typically don't expose these endpoints. |

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

## Uninstalling

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Troubleshooting

See the [Install the Kubernetes Agent](https://oneuptime.com/docs/monitor/kubernetes-agent) guide — it covers the "hostPath blocked" error, missing logs, and horizontal sharding for large clusters.

## Source

- Chart: [`HelmChart/Public/kubernetes-agent/`](https://github.com/OneUptime/oneuptime/tree/master/HelmChart/Public/kubernetes-agent)
- Log-tailer image: [`KubernetesLogTailer/`](https://github.com/OneUptime/oneuptime/tree/master/KubernetesLogTailer)
