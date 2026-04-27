<!-- markdownlint-disable MD033 -->
<h1 align="center"><img alt="oneuptime logo" width=50% src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/></h1>
<!-- markdownlint-enable MD033 -->

# OneUptime Kubernetes Agent

Collects cluster metrics, events, and pod logs from your Kubernetes cluster and ships them to OneUptime via OpenTelemetry. Install with one `helm install` command.

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
| `resourceSpecs.enabled` | `true` | Pull full K8s object specs (labels, env vars, status) for the dashboard. |
| `controlPlane.enabled` | `false` | Scrape etcd / api-server / scheduler / controller-manager. Self-managed clusters only — managed offerings typically don't expose these endpoints. |

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
