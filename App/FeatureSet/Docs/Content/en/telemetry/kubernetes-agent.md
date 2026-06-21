# OneUptime Kubernetes Agent (Helm)

## Overview

The OneUptime Kubernetes Agent is a pre-packaged Helm chart that installs an OpenTelemetry-based collector pipeline on your cluster. It ships node, pod, container, and cluster metrics; Kubernetes events; pod logs; and — with eBPF turned on by default — application traces, HTTP RED metrics, service-graph data, and pod-to-pod network flow metrics. No code changes, no SDKs, one `helm install`.

This page is the **installation guide**. For configuring Kubernetes monitors and alerts on top of the data the agent collects, see [Kubernetes Agent (monitors)](/docs/monitor/kubernetes-agent).

## Prerequisites

- A running Kubernetes cluster (v1.23+)
- `kubectl` configured to access your cluster
- `helm` v3 installed
- A **OneUptime API key** — create one from *Project Settings → API Keys*

## Step 1 — Add the OneUptime Helm Repository

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Step 2 — Pick a Preset for Your Cluster

The chart exposes a single top-level option — `preset` — that picks compatible defaults for your Kubernetes distribution. It controls things you would otherwise need to tune by hand: whether to ship logs via a hostPath DaemonSet or via the Kubernetes API, and which security context to apply.

| `preset` | Use for | Log collection |
|---|---|---|
| `standard` *(default)* | Self-managed clusters, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet reading `/var/log/pods` via hostPath (lowest overhead) |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API log tailer Deployment (no hostPath, no host access) |
| `eks-fargate` | **EKS Fargate** | Kubernetes API log tailer Deployment (no hostPath, no host access) |

If you are not sure, start with `standard`. If the install fails with a Pod Security error mentioning `hostPath`, re-run with `preset=gke-autopilot` (or `eks-fargate` on Fargate) and it will work.

## Step 3 — Install the Kubernetes Agent

Replace `YOUR_ONEUPTIME_URL`, `YOUR_ONEUPTIME_API_KEY`, and the cluster name with values for your environment. The cluster name is how the cluster will appear in OneUptime — pick something stable like `prod-us-east-1`.

### Standard clusters (self-managed, EKS on EC2, GKE Standard, AKS)

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster"
```

### GKE Autopilot

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=gke-autopilot
```

### EKS Fargate

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=eks-fargate
```

## Step 4 — Verify the Installation

Check that the agent pods are running:

```bash
kubectl get pods -n oneuptime-agent
```

On a **standard** cluster you will see a metrics-collector Deployment plus one log-collector DaemonSet pod per node:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

On **GKE Autopilot** or **EKS Fargate** you will see two Deployments instead (no DaemonSet):

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

Once the agent connects, your cluster will appear automatically in the **Kubernetes** section of the OneUptime dashboard.

## Configuration Options

### Namespace Filtering

By default, `kube-system` is excluded. To monitor only specific namespaces:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

### Disable Log Collection

If you only need metrics and events (no pod logs):

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### Force a Specific Log Collection Mode

Advanced users can override the preset's choice with `logs.mode`:

- `logs.mode=daemonset` — hostPath DaemonSet (lowest overhead, requires hostPath)
- `logs.mode=api` — Kubernetes API log tailer Deployment (works on any cluster)
- `logs.mode=disabled` — no log collection

The explicit `logs.mode` always wins over the preset default. Use this if you know your cluster better than the preset does.

### Enable Control Plane Monitoring

For self-managed clusters (not EKS / GKE / AKS), you can enable control plane metrics:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> Managed Kubernetes services (EKS, GKE, AKS) typically do not expose control plane metrics. Only enable this for self-managed clusters.

### Auto-tag with project labels

Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the cluster, services, and hosts emitted from this agent. Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.

Pass labels at install time with `--set oneuptime.labels.<key>=<value>`:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="prod" \
  --set oneuptime.labels.team=payments \
  --set oneuptime.labels.env=production \
  --set oneuptime.labels.region=us-east-1
```

Or keep them in a values file:

```yaml
# values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
  labels:
    team: payments
    env: production
    region: us-east-1
clusterName: prod
```

Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the agent.

## Upgrading the Agent

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` keeps your existing configuration (preset, cluster name, filters); pass any new `--set` overrides on top of it.

## Uninstalling the Agent

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## What Gets Collected

| Category | Data |
|----------|------|
| **Node Metrics** | CPU utilization, memory usage, filesystem usage, network I/O |
| **Pod Metrics** | CPU usage, memory usage, network I/O, restarts |
| **Container Metrics** | CPU usage, memory usage per container |
| **Cluster Metrics** | Node conditions, allocatable resources, pod counts |
| **Kubernetes Events** | Warnings, errors, scheduling events |
| **Pod Logs** | stdout/stderr logs from all containers (via hostPath DaemonSet on standard clusters, or via the Kubernetes API on Autopilot / Fargate) |
| **Application Traces** *(via eBPF, on by default)* | HTTP, gRPC, SQL/Redis spans from every pod — no SDK or code changes |
| **HTTP RED Metrics** *(via eBPF)* | `http.server.request.duration`, request and response body sizes, per service |
| **Service Graph** *(via eBPF)* | Caller → callee request rate, latency, and error edges — drives the service map view |
| **Network Flow Metrics** *(via eBPF)* | Pod-to-pod TCP/UDP byte and packet counters with k8s metadata |
| **TCP Stats** *(via eBPF)* | Node-level RTT, failed-connection, and retransmit counters |

## Application Traces & HTTP Metrics via eBPF (on by default)

The chart runs a DaemonSet with [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It loads eBPF programs into the kernel and auto-captures HTTP/HTTPS, gRPC, and SQL/Redis traffic from every supported runtime (Go, .NET, Java, Node.js, Python, Ruby, Rust) — no SDK and no sidecar required. Traces and request metrics then flow through the in-cluster collector to OneUptime.

**Requirements:** Linux kernel **5.8+** with BTF (default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+). The eBPF DaemonSet runs in **privileged mode** because it has to, to load eBPF programs.

### Disable eBPF auto-instrumentation

You should disable it when:

- Installing on **GKE Autopilot** or **EKS Fargate** — those platforms block privileged pods (use `preset=gke-autopilot` / `preset=eks-fargate` and pair with `ebpf.enabled=false`).
- Nodes run a kernel older than 5.8 without BTF backports.
- You already ship traces via OpenTelemetry SDKs from your apps and do not want duplicates.

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### Toggle individual signal families

All on by default. Turn any off with `--set ebpf.features.<name>=false`:

| `ebpf.features.*` | Default | What it adds |
|---|---|---|
| `httpMetrics` | on | HTTP/gRPC RED metrics (request rate, latency, errors) per service |
| `spanMetrics` | on | Per-span request/response size and duration |
| `serviceGraph` | on | Caller → callee edge metrics; drives the service map |
| `hostMetrics` | on | CPU and memory per instrumented process |
| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |
| `networkInterZoneMetrics` | off | Inter-zone variant of network metrics (doubles cardinality) |
| `tcpStats` | on | Node-level TCP RTT, failed-connection, retransmit counters |

Cross-service trace context propagation is also on by default — OBI injects W3C `traceparent` into outbound HTTP/TCP so a request crossing pod A → pod B shows up as a single trace, no SDK changes anywhere. Turn off with `--set ebpf.contextPropagation=false`.

## Troubleshooting

> **Fastest path — run the diagnostic script.** It inspects pod health, decodes and validates the ingestion key, checks that your cluster can reach OneUptime, and asks OneUptime whether your token is actually accepted — then prints a single root-cause verdict:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> It only reads cluster state and runs a couple of probes; it changes nothing. For the most accurate egress test, install with `--set debug.enabled=true` first (this adds a small network-tools sidecar to the agent pods so the script tests the collector's exact egress path), then re-run.

### Install fails with "hostPath volumes are not allowed" or a Pod Security admission error

Your cluster blocks `hostPath` — common on **GKE Autopilot** and **EKS Fargate**. Switch to the API-mode preset:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Agent shows "Disconnected"

A cluster's connected status is driven purely by telemetry arriving — if no data lands, the cluster is marked disconnected after ~15 minutes. So "disconnected" and "no metrics" almost always have the **same** cause: the agent's telemetry is not being accepted.

The most common reason — especially after a reinstall — is a **wrong or revoked ingestion key**. This is easy to miss because the OTLP ingest endpoints deliberately return HTTP `200` even for a bad token (so a misconfigured collector can't retry-storm the server). The result: the collector reports success, its logs show no errors, and the data is silently dropped.

1. Check that the agent pods are running: `kubectl get pods -n oneuptime-agent`
2. Check the metrics-collector logs: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (no errors here does **not** mean data is landing — see above)
3. **Validate the ingestion key.** Ask OneUptime directly whether your token is accepted (`200` = valid, `401` = unknown/revoked):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   If it returns `401`, the key in your release is wrong or was revoked. Copy a live key from *Project Settings → Telemetry Ingestion Keys* and re-deploy:

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. Verify your OneUptime URL is correct and your cluster can reach it over the network.
5. If you changed `clusterName` on reinstall, the agent appears as a **new** cluster — the old entry stays "Disconnected" (that's expected; it's stale).

### No logs appearing (API mode only)

1. Confirm the log tailer pod is Ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`
2. Check its `/healthz` — it reports active stream count and the last export error
3. Check logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. For very large clusters, a single replica may be a bottleneck — shard by namespace using `namespaceFilters.include` on separate releases

### No metrics appearing

1. First rule out a rejected ingestion key — it's the most common cause and is invisible from the agent side. See [Agent shows "Disconnected"](#agent-shows-disconnected) above (or just run the diagnostic script).
2. Check that the cluster identifier matches the value you passed as `clusterName`
3. Verify the RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`
4. Check the OTel collector logs for export errors

### eBPF pods are CrashLoopBackOff or fail to start

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

Common causes:

- **Kernel too old or BTF missing.** OBI needs Linux 5.8+ with BTF. Run `uname -r` on a node. If you cannot upgrade, disable eBPF: `--set ebpf.enabled=false`.
- **Privileged pods blocked.** Some clusters reject privileged pods (GKE Autopilot, EKS Fargate, and locked-down environments). Disable eBPF.
- **`debugfs` / `tracefs` not mounted on the host.** The `tcpStats` feature attaches to kernel tracepoints that need them. The chart mounts both via `hostPath` — but if your host does not expose them, disable just that family: `--set ebpf.features.tcpStats=false`.

### No application traces showing up

1. Confirm the eBPF DaemonSet is healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. Turn on the debug trace printer to confirm OBI is capturing traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then check `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`
3. If you see spans in OBI's stdout but not in the dashboard, the issue is the collector → OneUptime export — check the metrics-collector pod's logs.

## Next steps

- Configure **Kubernetes Monitors** on top of the metrics this agent collects — see [Kubernetes Agent (monitors)](/docs/monitor/kubernetes-agent).
- Add **Logs Monitors** to alert on specific log patterns (e.g. error counts above a threshold per pod or per namespace).
- For non-Kubernetes hosts (Linux / macOS / Windows VMs and bare metal), use the [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector) page.
