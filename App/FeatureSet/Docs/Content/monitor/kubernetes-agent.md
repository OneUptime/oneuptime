# Install the Kubernetes Agent

The OneUptime Kubernetes agent collects cluster metrics, events, and pod logs from your Kubernetes cluster and ships them to OneUptime. It is distributed as a Helm chart.

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

### My cluster has too many pods for one log-tailer replica (API mode only)

Scale horizontally by sharding namespaces. Deploy once per namespace group:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Alternatively, bump `logs.api.replicas` — but note that each replica processes all allowed namespaces, so for deduplication you still need namespace sharding.
