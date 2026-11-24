# OneUptime Kubernetes Cost Agent

Polls an in-cluster cost engine's Allocation API — [OpenCost](https://opencost.io) or Kubecost (both are built on the same open-source [cost-model](https://github.com/kubecost/cost-model)) — and ships pre-priced, per-workload cost allocations to OneUptime.

OneUptime stores the allocations in ClickHouse (`KubernetesCostAllocation`) and renders them on the Kubernetes cluster **Costs** pages and dashboards: spend by namespace / workload / pod / label over time, idle cost, and request-vs-usage efficiency.

## How it works

0. It decides which engine to read (`CostEngineResolver`): the one `COST_ENGINE_URL` names, or, when that is `auto`, or the chart's bundled OpenCost with `COST_PREFER_EXISTING_ENGINE=true`, the OpenCost or Kubecost the cluster already runs. It finds that one through the Kubernetes API, by the labels the engines' own charts give their Services (`EngineDiscovery`): Kubecost's `cost-analyzer` or `frontend` Service, OpenCost's chart, or the Service named `opencost` that OpenCost's manifest creates, in any namespace, Kubecost first. A found engine is read only once it answers the Allocation API for the last closed window, and never one that answers for several clusters. It looks when it starts, then hourly, and again after the engine in use fails three ticks in a row; with the bundled engine it falls back to that one.
1. Every `POLL_INTERVAL_SECONDS` the agent checks whether a new `WINDOW_SECONDS` window (default: 1 hour) has closed and settled.
2. For each closed window it queries the engine's Allocation API at container granularity (`accumulate=true`, `includeIdle=true`, and on `/model/allocation` `aggregate=cluster,node,namespace,controllerKind,controller,pod,container`, without which a Kubecost's aggregator answers per namespace). The API path is auto-detected: `/model/allocation` (Kubecost), `/allocation/compute` (OpenCost), `/allocation` (older OpenCost). A Kubecost answers from what its aggregator has collected, in batches behind the clock (on kind, two minutes after an hour closed, Kubecost 2.8.7 and 3.3.2 had its first 15 to 20 minutes), so a window ships once its rows reach the window's end (each row's own `end`), and is read again at a later tick until then; an empty one waits while `/model/clusters/status` says the cluster is not collected up to the window's end (`lastCollectedTime`). Three hours after a window closed, it ships as it is. Waiting is not a failure (`EngineCollection`).
3. The allocations are mapped to OneUptime's ingest rows (cost components include the engine's reconciliation adjustments) and POSTed to `{ONEUPTIME_URL}/kubernetes-cost/ingest`, chunked at `SHIP_BATCH_SIZE` rows, authenticated with the `x-oneuptime-token` header.
4. Every shipment says which engine priced its rows and where that engine's prices come from (`EnginePricing`): a cloud's public list prices (`/clusterInfo` names the provider), OpenCost's default rates, or a rate card (`/allNodePricing` gives the rates in force when no cloud is recognised). Kubecost 3 answers neither API, so its aggregator's own say instead: `/model/pricing/status` (its Enterprise custom pricing, a rate card), `/model/clusters/status` (the cluster's provider) and, with no cloud, what its node assets cost per core-hour and GiB-hour (`/model/assets`). A Kubecost on a cloud that reads that cloud's bill (`/model/cloudCost/status`) reconciles its prices with it about a day and a half later, after the agent shipped the hour, so those rows say both. An engine that cannot say yet is asked again at the next window. The cluster's Costs page and overview show it.
5. Windows ship strictly in order; the checkpoint only advances when a window fully lands, so a failed ship is retried on the next tick. On restart the agent re-ships the last `LOOKBACK_WINDOWS` closed windows — the server skips windows that already have rows, so this cannot double-count.
5a. A Kubecost that reads the cloud's bill (`billing-integration`) reconciles its prices with it about two days after each hour: savings plans, reserved instances, committed use and discounts reach its Allocation API as each cost's `*CostAdjustment`. So the agent reads each hour such a Kubecost priced again (`EngineCorrections`): 36 hours after it closed (where Kubecost's UI stops calling it unreconciled), 47 hours after (the last hour Kubecost keeps hourly figures by default: 49 hours), and 4 days after (past the 3 days each reconciliation run goes back; only a Kubecost that keeps hourly figures that long answers). A reading that differs from what was shipped goes out as a correction (`correction: true`): the server writes the difference from what it holds, per workload, pod and container, as rows of their own (`isCostAdjustment`), and the cost metrics' too, so nothing is counted twice and a reading sent twice changes nothing the second time. A reading the engine cannot give whole (nothing for the hour, another window's set, rows that stop short, another cluster) leaves the hour as it is, and a past hour the engine fails to give never sends the agent looking for another engine. The agent keeps only window starts and a fingerprint each; after a restart it reads the hours of the last 4 days once more, each at the age it last passed.
6. It reads per-container memory peaks for right-sizing from a Prometheus (`EnginePrometheus`, `PrometheusClient`), and each shipment says which (`memoryPeaksFrom`: `engine`, `bundled`, `configured` or empty), so the cluster's overview can say when stopping the bundled engine stops the peaks too: `COST_PROMETHEUS_URL` when someone named one; the chart's bundled Prometheus for the bundled engine (`COST_PROMETHEUS_BUNDLED`); and for the cluster's own engine, the Prometheus that engine reads. The pods its Service selects name that one in `PROMETHEUS_SERVER_ENDPOINT`, as a value (OpenCost) or from a ConfigMap (Kubecost 2); a Kubecost whose pods name none gets its chart's Prometheus Service beside it. A Secret is never read. An address is used once it answers for cAdvisor's memory series, which also says their scrape job, and a Prometheus that holds several clusters is read for this one alone, by the cluster ID the engine filters by, or not at all. Kubecost 3 reads no Prometheus: the bundled one stands in when the chart runs it, and otherwise `/healthz` says why there are no peaks.
7. It finds where the engine in use serves its price metrics (`EngineMetrics`), for the chart's collector, which scrapes them for the Kubernetes Cost dashboard: the engine's `/metrics` (OpenCost's API, Kubecost's cost model), then the `/model/metrics` a Kubecost 2 frontend or OpenCost's UI passes on to the engine (their own `/metrics` is their web page), then a Kubecost 3 finops agent's Service in the engine's namespace (Kubecost 3's frontend serves its prices at no path: its `/model/metrics` is the aggregator's own runtime series), and takes the first that answers with price series, not merely in Prometheus' format. It looks when it starts, every minute until it finds them, then hourly. When `COST_ENGINE_URL` names an in-cluster Service, it also reads that one Service once to say which engine it is: the API path alone takes Kubecost's cost model for OpenCost and OpenCost's UI for Kubecost.

## Health

Three endpoints on `HEALTH_PORT`; the split between the first two matters:

- **`/healthz`** (also `/`) — readiness. `200 {"status":"ok"}` while the pipeline is working, `503 {"status":"degraded", "reasons": [...]}` once it demonstrably is not, so the pod reads `0/1 Ready` instead of staying green while nothing ships. Degraded means any of: the poll has thrown `HEALTH_MAX_POLL_FAILURES` ticks in a row; no window has completed in `HEALTH_STALE_WINDOWS` windows; or nothing has ever shipped well past the point something should have.
- **`/livez`** — liveness. `200` for as long as the process is up. Restarting cannot fix a cost engine that is down, and a restart loop would throw away both the poller's in-memory checkpoint and the diagnostic `/healthz` is carrying.
- **`/scrape-targets`** — where the engine's price metrics are, as Prometheus `http_sd` JSON (`[{"targets":["host:port"],"labels":{"__scheme__":"http","__metrics_path__":"/model/metrics"}}]`), or `[]` until they are found. The chart's collector asks it whenever the agent may read an engine the chart did not put there: `cost.engine.url` `auto` or a URL, and the bundled engine while the agent prefers the cluster's own, so the dashboard's prices follow the engine the agent reads. Always `200`, whatever the readiness: the prices do not wait on the allocations. `/healthz` carries the same address as `costEngineMetricsUrl`, or what was tried as `costEngineMetricsError`, and the Prometheus the memory peaks are read from as `costPrometheusUrl` and `costPrometheus` (how it was found, its cAdvisor job), or why there is none as `costPrometheusError`. With a Kubecost that reads the cloud's bill, `costCorrections` says how many hours wait to be read again, how many later readings were corrections, and why the last one could not be made, if it could not.

Silence alone never fails the agent. A healthy cost agent is idle most of the time, and on a fresh install the `LOOKBACK_WINDOWS` windows it re-ships predate the engine and legitimately come back empty — so the "nothing shipped yet" signal only counts once that grace has passed, and the fast signal needs real, repeated errors.

## Configuration

| Env var | Required | Default | Description |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | yes | — | Base URL of your OneUptime host, e.g. `https://oneuptime.com` |
| `ONEUPTIME_API_KEY` | yes | — | Ingestion key (Project Settings > Telemetry & APM > Ingestion Keys) |
| `CLUSTER_NAME` | yes | — | Cluster identifier; must match the `k8s.cluster.name` the metrics agent stamps |
| `COST_ENGINE_URL` | yes | — | Cost engine base URL, any of the engine's Services, e.g. `http://opencost.opencost.svc.cluster.local:9003` or Kubecost's `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090` (2.x) or `http://kubecost-frontend.kubecost.svc.cluster.local:9090` (3.x), or `auto` to find the OpenCost or Kubecost the cluster runs |
| `COST_PREFER_EXISTING_ENGINE` | no | `false` | `true` when `COST_ENGINE_URL` is the chart's bundled engine: read the cluster's own engine instead when it runs one that answers |
| `COST_PROMETHEUS_URL` | no | — | Prometheus to read memory peaks from, whatever the engine (`cost.engine.prometheusUrl`). Empty: the Prometheus the cluster's own engine reads, found at run time |
| `COST_PROMETHEUS_BUNDLED` | no | `false` | `true` when `COST_PROMETHEUS_URL` is the chart's bundled Prometheus: read for the bundled engine, and for the cluster's own only when that engine's Prometheus is not found |
| `COST_PROMETHEUS_CADVISOR_JOB` | no | read off the Prometheus | Job label of the cAdvisor scrape; unset, `kubernetes-nodes-cadvisor` when the Prometheus has it, else the job its cAdvisor memory series carry |
| `COST_ENGINE_RATE_CARD` | no | — | `true` / `false`: whether the chart gave its bundled engine a rate card, for saying where its prices come from when the engine cannot |
| `COST_ENGINE_REDISCOVERY_SECONDS` | no | `3600` | How often to look for the cluster's own engine again |
| `COST_ENGINE_FAILURES_BEFORE_REDISCOVERY` | no | `3` | Failing ticks in a row before the engine in use is looked for again |
| `KUBERNETES_API_URL` | no | in-cluster | Kubernetes API to find the engine through; set it to `kubectl proxy`'s `http://127.0.0.1:8001` to run the agent outside a cluster |
| `COST_ALLOCATION_PATH` | no | auto | Explicit allocation API path (skips auto-detection) |
| `WINDOW_SECONDS` | no | `3600` | Allocation window length |
| `POLL_INTERVAL_SECONDS` | no | `300` | How often to look for a newly closed window |
| `ENGINE_SETTLE_SECONDS` | no | `120` | Wait after a window closes before querying it |
| `LOOKBACK_WINDOWS` | no | `2` | Closed windows to (re-)ship on startup |
| `INCLUDE_IDLE` | no | `true` | Ship the engine's `__idle__` allocation |
| `SHIP_BATCH_SIZE` | no | `1000` | Rows per ingest POST (server cap: 5000) |
| `EXPORT_MAX_RETRIES` | no | `5` | Retries per POST before the window is retried next tick |
| `COST_CURRENCY` | no | `USD` | Currency code forwarded with every payload |
| `HEALTH_PORT` | no | `13134` | Port serving `/healthz`, `/livez` and `/scrape-targets` |
| `HEALTH_MAX_POLL_FAILURES` | no | `3` | Consecutive failing ticks before `/healthz` reports degraded |
| `HEALTH_STALE_WINDOWS` | no | `3` | Windows without a completed window before `/healthz` reports degraded |
| `LOG_LEVEL` | no | `info` | `debug` / `info` / `warn` / `error` |

## Deployment

The agent ships as part of the `oneuptime/kubernetes-agent` Helm chart and runs by default (`cost.enabled: auto`), except with the `gke-autopilot` and `eks-fargate` presets: the chart bundles OpenCost (plus the minimal Prometheus it needs) and wires this poller to it automatically. Turn it on with those presets with `--set cost.enabled=true`, or off anywhere with `--set cost.enabled=false`. Already running Kubecost or OpenCost? The poller reads it instead of the bundled engine; set `cost.engine.url: auto` to stop bundling one, or `cost.engine.url` to the engine's Service to name it yourself. See the chart's `values.yaml` and the OneUptime docs page "Kubernetes Cost Observability".

Besides the allocation rows, the server derives four metrics from each hour this poller sends — `oneuptime.kubernetes.cost.total`, `.idle`, `.workload` and `.efficiency` — which the cluster's Metrics page shows and Kubernetes monitors alert on.

## Development

```
npm install
ONEUPTIME_URL=... ONEUPTIME_API_KEY=... CLUSTER_NAME=dev COST_ENGINE_URL=http://localhost:9003 npm start
```
