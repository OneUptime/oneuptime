# Kubernetes Cost Observability

## Overview

OneUptime can show you what every Kubernetes workload actually costs — spend per namespace, per controller, and per pod, with idle capacity and request-vs-usage efficiency — right next to the metrics, logs, and traces you already collect with the [Kubernetes Agent](/docs/telemetry/kubernetes-agent).

Cost data comes from an in-cluster **cost engine**: [OpenCost](https://opencost.io) or Kubecost. Both are built on the same open-source [cost-model](https://github.com/kubecost/cost-model) — the engine watches your cluster, discovers your cloud provider's pricing (AWS, GCP, Azure, or custom on-prem rates), and computes pre-priced cost allocations per workload. The OneUptime Kubernetes Agent reads those allocations from the engine and ships them to OneUptime, which stores them and gives you:

- A **Costs page per cluster** (_Kubernetes → your cluster → Costs_): spend trend, spend by namespace with cpu/memory/storage split, spend by workload, idle spend, and efficiency.
- A **project-level Costs page** (_Kubernetes → Costs_): spend across every cluster in the project.
- A **Kubernetes Cost dashboard template** (_Dashboards → Create → Kubernetes Cost Dashboard_): node hourly cost trends, CPU/RAM unit costs, persistent volume and load balancer spend.
- Raw cost metrics (`node_total_hourly_cost`, `pv_hourly_cost`, ...) in **Metric Explorer**, usable in custom dashboards and metric alerts.

Already running Kubecost? Point the agent at your existing install — no changes needed on the Kubecost side. Starting fresh? Install OpenCost (Apache-2.0, CNCF) and point the agent at it.

## How It Works

The `oneuptime/kubernetes-agent` Helm chart gains a `cost` section with two collection paths, both driven by the same engine:

1. **Allocation poller** (`cost.agent`) — a small Deployment that queries the engine's Allocation API once per closed hourly window and POSTs per-workload cost rows (cpu / ram / gpu / pv / network / load balancer / idle, plus efficiency) to OneUptime. This is the source of record for the Costs pages. Windows ship exactly once — the server skips windows it has already ingested, so agent restarts cannot double-count spend.
2. **Cost metrics scrape** (`cost.metrics`) — the agent's OpenTelemetry collector scrapes the engine's Prometheus `/metrics` endpoint (allowlisted to the cost series) and ships them through the same OTLP pipeline as the rest of your cluster metrics. This powers the dashboard template and Metric Explorer.

## Prerequisites

- The [OneUptime Kubernetes Agent](/docs/telemetry/kubernetes-agent) installed in the cluster.
- A cost engine running in the cluster:
  - **OpenCost** — see the [OpenCost install guide](https://opencost.io/docs/installation/helm) (requires a Prometheus instance for usage data), or
  - **Kubecost** — any existing install works.

## Step 1 — Find Your Cost Engine's Service URL

The agent needs the in-cluster URL of the engine's API:

| Engine   | Typical service URL                                              |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

The allocation API path is auto-detected (`/model/allocation` for Kubecost, `/allocation/compute` or `/allocation` for OpenCost). Set `cost.engine.allocationPath` only if your install uses a non-standard path.

## Step 2 — Enable Cost Collection

Upgrade your existing agent release with the `cost` values:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003
```

Or in a values file:

```yaml
cost:
  enabled: true
  engine:
    url: http://opencost.opencost.svc.cluster.local:9003
```

That enables both the allocation poller and the metrics scrape. Useful knobs (all optional — see the chart's `values.yaml` for the full list):

```yaml
cost:
  agent:
    # Allocation window length. Hourly is the engines' native resolution.
    windowSeconds: 3600
    # Ship the engine's __idle__ allocation so idle spend is visible.
    includeIdle: true
    # Currency code shown in the UI (informational).
    currency: USD
  metrics:
    # Scrape the engine's cost metrics for dashboards / Metric Explorer.
    enabled: true
    scrapeInterval: 60s
```

## Step 3 — See Your Costs

Within an hour of install (the first closed hourly window plus a small settle delay):

1. **Per-cluster**: _Kubernetes → your cluster → Costs_ — spend trend, idle %, spend by namespace and by workload.
2. **Across clusters**: _Kubernetes → Costs_ — every cluster ranked by spend, with idle share and efficiency.
3. **Dashboards**: _Dashboards → Create Dashboard → Kubernetes Cost Dashboard_ — node hourly cost, CPU/RAM unit costs, PV and load balancer spend, scoped by the `cluster` toolbar variable.

## Alerting on Cost

The scraped cost metrics are ordinary OneUptime metrics, so you can put metric alerts on them like anything else — e.g. alert when the average `node_total_hourly_cost` rises above a budget threshold, or when `pv_hourly_cost` appears for a volume class that shouldn't exist in a cluster.

## Data Model & Retention

Allocation rows are stored in ClickHouse (one row per cluster, window, namespace, controller, pod, and container) and follow the cluster's telemetry retention: the `retainTelemetryDataForDays` setting on the Kubernetes cluster resource, falling back to the project's data retention. Idle and unallocated capacity are stored as regular rows under the `__idle__` / `__unallocated__` namespaces so they are queryable with the same group-bys as workload spend.

## Troubleshooting

- **Costs pages are empty** — check the cost agent's logs: `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`. A `401` means the ingestion key is invalid; `cost engine did not answer any known allocation path` means `cost.engine.url` is wrong or the engine is not reachable from the agent's namespace.
- **Dashboard template shows no data** — the template reads the scraped cost metrics; confirm `cost.metrics.enabled` is `true` and the engine's `/metrics` endpoint is reachable (`kubectl port-forward` and curl it).
- **Numbers differ from the engine's own UI** — OneUptime includes the engine's reconciliation adjustments in each cost component and ships whole closed windows; partial current-hour spend appears after the window closes.
