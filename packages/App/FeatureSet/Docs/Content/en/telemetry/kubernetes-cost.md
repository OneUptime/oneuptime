# Kubernetes Cost Observability

## Overview

OneUptime can show you what every Kubernetes workload actually costs — spend per namespace, per controller, and per pod, with idle capacity and request-vs-usage efficiency — right next to the metrics, logs, and traces you already collect with the [Kubernetes Agent](/docs/telemetry/kubernetes-agent).

Enabling it is one command:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

That's a complete install. The chart bundles the open-source [OpenCost](https://opencost.io) engine (Apache-2.0, CNCF — the [cost-model](https://github.com/kubecost/cost-model) that also powers Kubecost) plus a minimal, dedicated Prometheus it needs for usage history — two small pods of invisible plumbing. OpenCost prices your nodes, volumes, and load balancers from your cloud provider's **public list prices automatically, with no credentials** (AWS, GCP, Azure); on-prem clusters set a rate card instead (below).

Within about an hour (the first closed hourly window), you get:

- A **Costs page per cluster** (_Kubernetes → your cluster → Costs_): spend trend, spend by namespace with cpu/memory/storage split, spend by workload, idle spend, and efficiency.
- A **project-level Costs page** (_Kubernetes → Costs_): spend across every cluster in the project.
- A **Kubernetes Cost dashboard template** (_Dashboards → Create → Kubernetes Cost Dashboard_): node hourly cost trends, CPU/RAM unit costs, persistent volume and load balancer spend.
- Raw cost metrics (`node_total_hourly_cost`, `pv_hourly_cost`, ...) in **Metric Explorer**, usable in custom dashboards and metric alerts.

## How It Works

With `cost.enabled=true` the chart runs four things:

1. **OpenCost** (bundled) — watches the cluster, discovers cloud list prices, and computes pre-priced cost allocations per workload.
2. **A minimal Prometheus** (bundled) — OpenCost requires a PromQL endpoint for usage/price history. This one exists solely for that: single replica, 3-day retention, and exactly two scrape targets (cAdvisor via the API-server node proxy, and OpenCost itself — OpenCost emits its own KSM-style resource-request metrics, so kube-state-metrics is not involved). It is never exposed outside the cluster and its data never leaves it.
3. **The cost allocation poller** (`cost.agent`) — polls OpenCost's Allocation API once per closed hourly window and POSTs per-workload cost rows (cpu / ram / gpu / pv / network / load balancer / idle, plus efficiency) to OneUptime. Windows ship exactly once — the server skips windows it has already ingested, so restarts cannot double-count spend.
4. **A cost metrics scrape** (`cost.metrics`) — the agent's OpenTelemetry collector scrapes OpenCost's Prometheus metrics (allowlisted to the cost series) through the same OTLP pipeline as the rest of your cluster metrics.

## Already Running Kubecost or OpenCost?

Point the chart at your existing engine instead — nothing is bundled then:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090
```

| Engine   | Typical service URL                                              |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

The Allocation API path is auto-detected (`/model/allocation` for Kubecost, `/allocation/compute` or `/allocation` for OpenCost). Set `cost.engine.allocationPath` only for non-standard installs.

## On-Prem / Bare-Metal Pricing

Clusters whose nodes have no public cloud list price can set a rate card — OpenCost then prices every resource from these figures. All values are **USD per resource-hour**:

```yaml
cost:
  enabled: true
  opencost:
    customPricing:
      enabled: true
      cpuPerCoreHour: "0.031611"       # ~$23 per core-month
      ramPerGiBHour: "0.004237"        # ~$3 per GiB-month
      storagePerGBHour: "0.00005479452" # ~$0.04 per GB-month
      gpuPerHour: "0.95"
```

## Useful Knobs

All optional — see the chart's `values.yaml` for the full list:

```yaml
cost:
  agent:
    windowSeconds: 3600   # allocation window length (hourly = native)
    includeIdle: true     # ship the engine's __idle__ allocation
    currency: USD         # currency code shown in the UI (informational)
  prometheus:
    retention: 7d         # bundled TSDB history; right-sizing reads peaks back over days
    persistence:
      enabled: false      # set true for a small PVC; emptyDir otherwise
  metrics:
    enabled: true         # cost metrics for dashboards / Metric Explorer
    scrapeInterval: 60s
```

## Right-Sizing

The **Right-Sizing** card on a cluster's Costs page recommends a CPU and memory request for every container it has enough history for, ranked by how much each change saves per month.

A recommendation is observed demand plus 25% headroom, rounded to a value you can paste into a manifest (10m for CPU, 16Mi for memory):

- **CPU** is sized from the **95th percentile** of hourly average usage. High enough to cover real load, low enough that one spike does not re-inflate the request for a month.
- **Memory** is sized from the **peak** working set — never an average. See below.

Requests are recommended; limits are not. A request is what the scheduler reserves and what the bill is calculated from, so it is the number that moves cost. Limits are a blast-radius decision that depends on whether you would rather a misbehaving container be throttled or killed, and that is not a call usage data can make for you.

Each container is scored against its current request:

- **Over-provisioned** — reserving materially more than it uses. This is where the savings estimate comes from.
- **Under-provisioned** — reserving less than it uses, so it is being throttled or is at risk of an OOMKill. Fixing this *costs* money, and the card shows that as an increase rather than burying it.
- **No request set** — nothing to shrink, but the scheduler cannot place the container safely and it is first to be evicted under pressure.
- Anything within 15% of its recommendation is treated as already right-sized and is left out. Nobody should edit a manifest to shave 3% off a request.

Two guards keep the advice honest. A workload needs at least **24 hours** of cost windows before it is sized at all — a four-hour window catches a nightly batch job at rest and would happily advise shrinking it to nothing. And savings are projected from the length of the window you are looking at, not from the row count, so a Deployment's saving is not multiplied by its replica count.

The estimate assumes spend scales with what the engine allocated, which is `max(request, usage)`. In the over-provisioned case that reduces to the request, so the savings figure is exact rather than approximate.

### The Data Behind It

Alongside spend, the poller collects what a right-sizing recommendation needs: per-container CPU and memory **requests**, **limits**, and **usage**.

Memory needs one extra source. The Allocation API reports only an average over each window, and an hourly mean hides the burst that OOMKills a container — so sizing a memory request from it is actively dangerous. The agent therefore reads the per-container memory **peak** from Prometheus, joining on `(namespace, pod, container)`.

This is optional and degrades cleanly:

- **Bundled engine (default):** the chart's own Prometheus is used automatically. Nothing to configure.
- **External engine (`cost.engine.url` set):** there is no bundled Prometheus, so point `cost.engine.prometheusUrl` at one that scrapes cAdvisor. Set `cost.engine.prometheusCadvisorJob` too if its scrape job is not named `kubernetes-nodes-cadvisor`.
- **No Prometheus at all:** CPU recommendations still work — they are derived from the stored hourly averages — and memory recommendations are unavailable rather than wrong.

A Prometheus outage never blocks spend collection: peaks are an enrichment, and a window ships without them.

CPU deliberately does *not* use Prometheus. Overshooting a CPU request throttles a container while overshooting memory kills it, so CPU is safely sized from the hourly averages already in ClickHouse — and querying per-container CPU rates across a whole cluster is expensive enough to destabilise a small Prometheus.

## Alerting on Cost

The scraped cost metrics are ordinary OneUptime metrics, so you can put metric alerts on them like anything else — e.g. alert when the average `node_total_hourly_cost` rises above a budget threshold, or when `pv_hourly_cost` appears for a volume class that shouldn't exist in a cluster.

## Data Model & Retention

Allocation rows are stored in ClickHouse (one row per cluster, window, namespace, controller, pod, and container) and follow the cluster's telemetry retention: the `retainTelemetryDataForDays` setting on the Kubernetes cluster resource, falling back to the project's data retention. Idle and unallocated capacity are stored as regular rows under the `__idle__` / `__unallocated__` namespaces so they are queryable with the same group-bys as workload spend.

## Troubleshooting

- **Costs pages are empty** — check the cost agent's logs: `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`. A `401` means the ingestion key is invalid; `cost engine did not answer any known allocation path` means the engine isn't up yet (the bundled OpenCost needs a few minutes after install to price its first windows) or `cost.engine.url` is wrong.
- **Bundled OpenCost not ready** — `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`. It logs which cloud provider it detected and whether pricing data loaded.
- **`mkdir /var/configs: permission denied` in the OpenCost log** — a chart bug fixed in chart 0.6.1. OpenCost ran as non-root with no writable config directory, so `Error downloading default pricing data` left its Allocation API unable to answer and the poller stalled — while the pod stayed `Running`, `/healthz` stayed green, and the node cost metrics kept publishing. Upgrade the chart (`helm repo update && helm upgrade ... --reuse-values`); cost rows appear on the next poll.
- **Dashboard template shows no data** — the template reads the scraped cost metrics; confirm `cost.metrics.enabled` is `true`.
- **Right-Sizing card is empty** — either the window is shorter than the 24 hours a recommendation needs (widen the time range), or every container is already within 15% of its recommended request, which the card says explicitly.
- **Memory recommendations show `-` but CPU ones work** — no memory peak reached the server, so memory was deliberately left unsized rather than guessed from an average. On an external-engine install, set `cost.engine.prometheusUrl`. The card reports how many containers this affects.
- **Numbers differ from the engine's own UI** — OneUptime includes the engine's reconciliation adjustments in each cost component and ships whole closed windows; partial current-hour spend appears after the window closes.
- **Prometheus pod restarted** — with the default `emptyDir` storage a restart loses a few hours of usage history, so allocations for those windows may be smaller. Set `cost.prometheus.persistence.enabled=true` if that matters to you.
