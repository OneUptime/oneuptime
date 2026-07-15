# OneUptime Kubernetes Agent (Helm)

## Overview

The OneUptime Kubernetes Agent is a pre-packaged Helm chart that installs an OpenTelemetry-based collector pipeline on your cluster. It ships node, pod, container, and cluster metrics; Kubernetes events; pod logs; and — with eBPF turned on by default — application traces, HTTP RED metrics, service-graph data, and pod-to-pod network flow metrics. No code changes, no SDKs, one `helm install`.

This page is the **installation guide**. For configuring Kubernetes monitors and alerts on top of the data the agent collects, see [Kubernetes Agent (monitors)](/docs/monitor/kubernetes-agent).

## Prerequisites

- A running Kubernetes cluster (v1.23+)
- `kubectl` configured to access your cluster
- `helm` v3 installed
- A **OneUptime API key** — create one from _Project Settings → API Keys_

## Step 1 — Add the OneUptime Helm Repository

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Step 2 — Pick a Preset for Your Cluster

The chart exposes a single top-level option — `preset` — that picks compatible defaults for your Kubernetes distribution. It controls things you would otherwise need to tune by hand: whether to ship logs via a hostPath DaemonSet or via the Kubernetes API, and which security context to apply.

| `preset`               | Use for                                                                               | Log collection                                                     |
| ---------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `standard` _(default)_ | Self-managed clusters, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet reading `/var/log/pods` via hostPath (lowest overhead)   |
| `gke-autopilot`        | **GKE Autopilot**                                                                     | Kubernetes API log tailer Deployment (no hostPath, no host access) |
| `eks-fargate`          | **EKS Fargate**                                                                       | Kubernetes API log tailer Deployment (no hostPath, no host access) |

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

`namespaceFilters` scopes **pod logs** (both the hostPath DaemonSet and the API log-tailer) and **eBPF traces** to the namespaces you choose. `kube-system` is excluded by default. To restrict those signals to specific namespaces:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

To ignore one noisy namespace while keeping every other one, use `exclude` instead. `exclude` always wins over `include`, and the shipped default is `[kube-system]` — so list it again if you still want it excluded:

```bash
  --set "namespaceFilters.exclude={kube-system,noisy-namespace}"
```

For **pod logs and eBPF traces this costs nothing**: the namespace is part of the pod-log path and of OBI's process discovery, so a filtered namespace is never read in the first place — no CPU, no egress.

#### Applying namespace filters to metrics and traces

By default the lists above cover pod logs and eBPF traces only. `applyTo` extends them to other signals:

```bash
  --set namespaceFilters.applyTo.metrics=true \
  --set namespaceFilters.applyTo.traces=true
```

| Setting | What it covers |
| ------- | -------------- |
| `applyTo.metrics` | Per-pod / per-container metrics from kubeletstats, cAdvisor and kube-state-metrics |
| `applyTo.traces` | Spans your applications push to the agent's OTLP endpoint (eBPF spans are already scoped) |

Both are **off by default** on purpose. `exclude: [kube-system]` ships as a default, so switching these on automatically would silently delete kube-system metrics from every existing install on upgrade.

> **Node- and cluster-level metrics are always kept.** A namespace is a property of a pod, not of a node, so series like node CPU, node memory and filesystem usage have nothing to match on and are never dropped. `applyTo.metrics` trims per-pod cardinality without ever blinding you to a node going bad.

Kubernetes **events** are not namespace-filterable at the agent. They arrive from the `k8sobjects` receiver without a `k8s.namespace.name` attribute — the namespace is inside the event body — so there is nothing for a filter to match. Drop those server-side instead (see below).

### Filtering by Log Severity

`filters.logs.minSeverity` drops log records below a severity, at the agent, before anything is sent:

```bash
  --set filters.logs.minSeverity=WARN
```

Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. `WARN` keeps WARN, ERROR and FATAL and drops INFO, DEBUG and TRACE. The default (`""`) keeps everything.

This works even though container runtimes do not record a severity on the log line: the agent parses one out of the log text (`[ERROR]`, `WARN:`, `level=info`, …) and falls back to `stderr → ERROR` / `stdout → INFO`. It applies in **both** log modes — in `daemonset` mode via the collector, in `api` mode inside the log tailer itself — so the presets cannot change the behaviour out from under you.

> Records whose severity still could not be determined are **kept**, never dropped. The safe failure for a filter is to send too much, not to silently delete a log nobody knew was unclassified.

### Including or Excluding Metrics by Name

`filters.metrics` gates which metrics leave the cluster, across every receiver in the pipeline.

**Drop a few noisy metrics** (a denylist — usually what you want):

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**Send only a fixed set** (an allowlist — everything else is dropped):

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.usage","k8s.pod.memory.usage"]'
```

**Match by pattern** instead of exact name:

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| Key | Meaning |
| --- | ------- |
| `filters.metrics.exclude` | Metric names to drop. Applied on top of `include`, so exclude always wins. |
| `filters.metrics.include` | When non-empty, **only** these are sent. |
| `filters.metrics.matchType` | `strict` (exact name, the default) or `regexp` (RE2, **unanchored**). |

Notes that will save you an incident:

- `regexp` is **unanchored** — `system.cpu` also matches `system.cpu.time`. Anchor it (`^system\.cpu$`) when you mean exactly one metric.
- RE2 has **no lookahead**, so `^(?!container_)` will not compile. Express "everything except" with `include`, not a negative regex.
- `include` spans every receiver at once. An allowlist that forgets a metric silently removes the monitors built on it. Prefer `exclude` unless you genuinely want a closed set.
- Use `--set-json` (or a values file) for lists. Plain `--set` replaces a list rather than merging it.

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

| Category                                           | Data                                                                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Node Metrics**                                   | CPU utilization, memory usage, filesystem usage, network I/O                                                                           |
| **Pod Metrics**                                    | CPU usage, memory usage, network I/O, restarts                                                                                         |
| **Container Metrics**                              | CPU usage, memory usage per container                                                                                                  |
| **Cluster Metrics**                                | Node conditions, allocatable resources, pod counts                                                                                     |
| **Kubernetes Events**                              | Warnings, errors, scheduling events                                                                                                    |
| **Pod Logs**                                       | stdout/stderr logs from all containers (via hostPath DaemonSet on standard clusters, or via the Kubernetes API on Autopilot / Fargate) |
| **Application Traces** _(via eBPF, on by default)_ | HTTP, gRPC, SQL/Redis spans from every pod — no SDK or code changes                                                                    |
| **HTTP RED Metrics** _(via eBPF)_                  | `http.server.request.duration`, request and response body sizes, per service                                                           |
| **Service Graph** _(via eBPF)_                     | Caller → callee request rate, latency, and error edges — drives the service map view                                                   |
| **Network Flow Metrics** _(via eBPF)_              | Pod-to-pod TCP/UDP byte and packet counters with k8s metadata                                                                          |
| **TCP Stats** _(via eBPF)_                         | Node-level RTT, failed-connection, and retransmit counters                                                                             |

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

| `ebpf.features.*`         | Default | What it adds                                                      |
| ------------------------- | ------- | ----------------------------------------------------------------- |
| `httpMetrics`             | on      | HTTP/gRPC RED metrics (request rate, latency, errors) per service |
| `spanMetrics`             | on      | Per-span request/response size and duration                       |
| `serviceGraph`            | on      | Caller → callee edge metrics; drives the service map              |
| `hostMetrics`             | on      | CPU and memory per instrumented process                           |
| `networkMetrics`          | on      | Pod-to-pod TCP/UDP flow counters                                  |
| `networkInterZoneMetrics` | off     | Inter-zone variant of network metrics (doubles cardinality)       |
| `tcpStats`                | on      | Node-level TCP RTT, failed-connection, retransmit counters        |

Cross-service trace context propagation is also on by default — OBI injects W3C `traceparent` into outbound HTTP/TCP so a request crossing pod A → pod B shows up as a single trace, no SDK changes anywhere. Turn off with `--set ebpf.contextPropagation=false`.

## Reducing the Volume of Data Collected

Out of the box the agent is tuned for **coverage** — it ships metrics, pod logs, and eBPF traces from the whole cluster so every dashboard and monitor works on day one. On large or busy clusters that can be more telemetry than you need, which shows up as higher ingest volume (and, on OneUptime Cloud, higher cost). Nothing here is required, but if a cluster is sending more than you want, these are the knobs to turn — roughly in order of impact.

The trick is to **stop collecting what you will not look at**, rather than to collect everything and pay to store it. Every lever below is a Helm value, so you can apply it with `--set` on `helm upgrade --reuse-values` and roll it back the same way.

### Where the volume comes from

| Signal                         | Biggest driver                                           | Turn it down with                                                                            |
| ------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Pod logs**                   | Every line from every container, cluster-wide            | `namespaceFilters`, `filters.logs.minSeverity`, `logs.enabled`, `logs.mode`                  |
| **eBPF traces & span metrics** | One trace per request from every instrumented process    | `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths`              |
| **Metric data points**         | Scrape frequency × number of pods/containers             | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Metric cardinality**         | Number of distinct series (per-container, per-PVC, …)    | `filters.metrics.exclude`, `namespaceFilters.applyTo.metrics`, `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics` |
| **Opt-in extras**              | Profiling, audit logs, control plane, inter-zone metrics | Leave them off (they already are by default)                                                 |

Two ways to cut volume, and it is worth knowing which one you are using:

- **At the receiver** — the data is never collected. `namespaceFilters` on pod logs, `cadvisor.metricsAllowlist`, a longer `collectionInterval`. Costs nothing to run and saves CPU, egress and ingest together. Always prefer these where they cover your case.
- **At the filter processor** — the data is collected, then dropped before export. `filters.logs.minSeverity`, `filters.metrics.*`, `namespaceFilters.applyTo.*`. Slightly more collector CPU, but it works across receivers and can express things a receiver cannot.

Both are **irreversible**: what you drop here never reaches OneUptime, and any monitor built on it goes quiet. If you would rather decide later, OneUptime can drop data server-side instead (**Logs → Settings → Drop Filters**, **Metrics → Settings → Pipeline Rules**) — that still costs egress, but it is a setting you can change without a redeploy.

### Lever 1 — Pod logs are usually the single biggest source

Container logs are almost always the largest slice of ingest, because it is one record per log line from every container in the cluster.

- **Only want logs from certain namespaces?** `namespaceFilters` scopes pod logs in both log modes (and eBPF traces along with them). Matching happens on the pod-log path, so filtered namespaces are never even read — this is the cheapest lever in this document:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` is already excluded by default.) To keep every namespace but one, use `--set "namespaceFilters.exclude={kube-system,noisy-namespace}"`.

- **Only care about warnings and errors?** `filters.logs.minSeverity` drops the rest at the agent. On a chatty cluster this is often the single biggest reduction available, because INFO and DEBUG are the bulk of most application output:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  See [Filtering by Log Severity](#filtering-by-log-severity) for how severity is determined and what happens to logs it cannot classify.

- **Don't need pod logs from OneUptime at all?** Turn them off:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > **This also disables node, pod, container and host metrics.** The kubelet, cAdvisor and hostmetrics receivers all live in the same log-collector DaemonSet, so turning pod logs off removes them too — along with the OOM-kill, CPU-throttling and PVC-low-disk monitors. The same applies to `logs.mode: api` and `logs.mode: disabled`.
  >
  > If you want fewer logs but want to keep your metrics, stay on `logs.mode: daemonset` and reach for `namespaceFilters` or `filters.logs.minSeverity` above instead.

### Lever 2 — Trim eBPF auto-instrumentation

eBPF gives you traces, RED metrics, the service map, and network-flow metrics with no code changes — but it is also the second-largest source of data because it emits a span per request and several metric families per service. You have three levels of control:

- **Already shipping traces from OTel SDKs, or don't want auto-traces?** Turn eBPF off entirely:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Keep the traces, drop the heavy metric families.** The [signal-family table above](#toggle-individual-signal-families) lists each `ebpf.features.*` flag. The highest-volume families are network and span metrics — turning them off leaves traces, HTTP RED metrics, and the service map intact:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  Leave `ebpf.features.networkInterZoneMetrics` off (its default) — it doubles network-flow cardinality.

- **Instrument only the runtimes you care about.** By default OBI attaches to every process it recognizes (`ebpf.autoTargetExe: "*"`). Narrow it to specific runtimes, or add binaries to the skip list, to cut the number of "services" and traces the agent produces:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  See [Toggle individual signal families](#toggle-individual-signal-families) and the `excludeExePaths` note in the chart values for the full defaults.

### Lever 3 — Slow down the scrape intervals

Metric volume is directly proportional to how often the agent scrapes. Doubling an interval roughly halves the number of data points that metric produces, with no loss of coverage — just coarser resolution. If you don't need 30-second granularity, 60s or 120s is a big, safe reduction:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval` (default `30s`) drives the node / pod / container metrics (`kubeletstats`) and the cluster-state metrics (`k8s_cluster`) — the bulk of the metric volume.
- `hostMetrics.collectionInterval` and `cadvisor.scrapeInterval` cover the per-node OS metrics and the throttling / OOM counters.
- `resourceSpecs.interval` (default `300s`) controls how often full resource specs (labels, annotations, status) are pulled — raise it if you don't need spec changes reflected quickly.
- If you enabled any of the optional scrapers, they have their own knobs too: `kubeStateMetrics.scrapeInterval`, `serviceMesh.*.scrapeInterval`, `coreDns.scrapeInterval`, `csi.scrapeInterval`.

### Lever 4 — Keep metric cardinality bounded

Cardinality (the number of distinct time series) matters as much as frequency, because each series is stored and billed separately.

- **cAdvisor is allowlisted on purpose.** The cAdvisor receiver (on by default) can emit hundreds of metrics; the chart forwards only the handful that power monitors (`cadvisor.metricsAllowlist`). Keep the list tight — **each entry is kept per-container, so one extra metric multiplies by the cluster's container count.** kube-state-metrics is off by default, but if you enable it (`kubeStateMetrics.enabled=true`) its `kubeStateMetrics.metricsAllowlist` gates cardinality the same way.
- **Per-PVC volume metrics** (`kubeletstats.volumeMetrics.enabled`, on by default) emit one series per PVC per pod. That's fine for most clusters but can be substantial on stateful workloads (Kafka, databases) with thousands of PVCs — turn it off there if you don't watch PVC disk space:

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **Saturation metrics** (`kubeletstats.utilizationMetrics.enabled`, on by default) add 8 derived "% of request/limit" families. They're cheap (no extra scrape) but if you don't use the CPU/Memory-vs-limit monitors you can drop them with `--set kubeletstats.utilizationMetrics.enabled=false`.

- **Drop specific metrics by name.** The allowlists above are per-receiver; `filters.metrics.exclude` spans all of them, so use it for anything the receiver-level knobs cannot express:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  See [Including or Excluding Metrics by Name](#including-or-excluding-metrics-by-name) for exact-vs-regex matching and the allowlist form.

- **Drop a whole namespace's metrics.** If a namespace is noisy but you still want its nodes watched, `namespaceFilters.applyTo.metrics=true` applies your existing namespace lists to per-pod and per-container series. Node- and cluster-level series are always kept:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set namespaceFilters.applyTo.metrics=true
  ```

### Lever 5 — Leave the heavy opt-in features off

These are **off by default** precisely because they add load — only enable one when you actively use what it powers, and turn it back off if you were just trying it out:

| Value                                                     | Adds                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `profiling.enabled`                                       | Continuous CPU profiling DaemonSet — heavier than eBPF traces                      |
| `auditLogs.enabled`                                       | Every Kubernetes API request as a log record (high volume)                         |
| `controlPlane.enabled`                                    | etcd / API-server / scheduler / controller-manager metrics                         |
| `kubeStateMetrics.enabled`                                | CrashLoop / ImagePull / scheduling-reason metrics (adds a KSM Deployment + scrape) |
| `ebpf.features.networkInterZoneMetrics`                   | Doubles network-flow metric cardinality                                            |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | Extra Prometheus scrape jobs                                                       |

### A lean starting point

If you want a smaller footprint but still want the monitors to work, this profile keeps **full metric coverage** and cuts the two things that actually drive volume — log lines and eBPF spans:

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

# Halve the metric data points. Coarser resolution, same coverage.
collectionInterval: 60s
hostMetrics:
  collectionInterval: 60s
cadvisor:
  scrapeInterval: 60s

# Keep the DaemonSet — it is what collects kubelet, cAdvisor and host
# metrics as well as logs — but only ship logs worth alerting on.
logs:
  enabled: true
  mode: daemonset

filters:
  logs:
    minSeverity: WARN # drop INFO / DEBUG / TRACE at the agent

namespaceFilters:
  exclude:
    - kube-system
    - noisy-namespace

ebpf:
  enabled: true
  features:
    networkMetrics: false # the heaviest eBPF families
    tcpStats: false
    spanMetrics: false
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

Tighten further as needed: raise `minSeverity` to `ERROR`, add `namespaceFilters.applyTo.metrics=true`, or set `ebpf.enabled=false` if you already ship traces from OTel SDKs.

> **Watch what you cut.** Some monitors depend on specific signals: disabling `cadvisor` removes the OOM-kill and CPU-throttling monitors; disabling `kubeletstats.volumeMetrics` removes the PVC low-disk monitor; disabling logs (or switching off the DaemonSet) removes log-based alerts *and* your node metrics. Trim the signals you don't act on, not the ones a monitor is watching.

### Measure the effect

Telemetry usage is aggregated per day, so check the trend over a day or two under **Project Settings → Usage History** to confirm the drop — it won't move the instant you apply a change. Change one lever at a time so you can attribute the difference — logs off, then interval up, then eBPF trimmed — rather than turning everything down at once and losing a monitor you actually relied on.

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

   If it returns `401`, the key in your release is wrong or was revoked. Copy a live key from _Project Settings → Telemetry Ingestion Keys_ and re-deploy:

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
