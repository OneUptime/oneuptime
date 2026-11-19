# OneUptime Kubernetes Cost Agent

Polls an in-cluster cost engine's Allocation API — [OpenCost](https://opencost.io) or Kubecost (both are built on the same open-source [cost-model](https://github.com/kubecost/cost-model)) — and ships pre-priced, per-workload cost allocations to OneUptime.

OneUptime stores the allocations in ClickHouse (`KubernetesCostAllocation`) and renders them on the Kubernetes cluster **Costs** pages and dashboards: spend by namespace / workload / pod / label over time, idle cost, and request-vs-usage efficiency.

## How it works

0. It decides which engine to read (`CostEngineResolver`): the one `COST_ENGINE_URL` names, or, when that is `auto`, or the chart's bundled OpenCost with `COST_PREFER_EXISTING_ENGINE=true`, the OpenCost or Kubecost the cluster already runs. It finds that one through the Kubernetes API, by the labels the engines' own charts give their Services (`EngineDiscovery`): Kubecost's `cost-analyzer` or `frontend` Service, OpenCost's chart, or the Service named `opencost` that OpenCost's manifest creates, in any namespace, Kubecost first. A found engine is read only once it answers the Allocation API for the last closed window, and never one that answers for several clusters. It looks when it starts, then hourly, and again after the engine in use fails three ticks in a row; with the bundled engine it falls back to that one.
1. Every `POLL_INTERVAL_SECONDS` the agent checks whether a new `WINDOW_SECONDS` window (default: 1 hour) has closed and settled.
2. For each closed window it queries the engine's Allocation API at container granularity (`accumulate=true`, `includeIdle=true`). The API path is auto-detected: `/model/allocation` (Kubecost), `/allocation/compute` (OpenCost), `/allocation` (older OpenCost).
3. The allocations are mapped to OneUptime's ingest rows (cost components include the engine's reconciliation adjustments) and POSTed to `{ONEUPTIME_URL}/kubernetes-cost/ingest`, chunked at `SHIP_BATCH_SIZE` rows, authenticated with the `x-oneuptime-token` header.
4. Every shipment says which engine priced its rows and where that engine's prices come from (`EnginePricing`): a cloud's public list prices (`/clusterInfo` names the provider), OpenCost's default rates, or a rate card (`/allNodePricing` gives the rates in force when no cloud is recognised). The cluster's Costs page and overview show it.
5. Windows ship strictly in order; the checkpoint only advances when a window fully lands, so a failed ship is retried on the next tick. On restart the agent re-ships the last `LOOKBACK_WINDOWS` closed windows — the server skips windows that already have rows, so this cannot double-count.

## Health

Two endpoints on `HEALTH_PORT`, and the split matters:

- **`/healthz`** (also `/`) — readiness. `200 {"status":"ok"}` while the pipeline is working, `503 {"status":"degraded", "reasons": [...]}` once it demonstrably is not, so the pod reads `0/1 Ready` instead of staying green while nothing ships. Degraded means any of: the poll has thrown `HEALTH_MAX_POLL_FAILURES` ticks in a row; no window has completed in `HEALTH_STALE_WINDOWS` windows; or nothing has ever shipped well past the point something should have.
- **`/livez`** — liveness. `200` for as long as the process is up. Restarting cannot fix a cost engine that is down, and a restart loop would throw away both the poller's in-memory checkpoint and the diagnostic `/healthz` is carrying.

Silence alone never fails the agent. A healthy cost agent is idle most of the time, and on a fresh install the `LOOKBACK_WINDOWS` windows it re-ships predate the engine and legitimately come back empty — so the "nothing shipped yet" signal only counts once that grace has passed, and the fast signal needs real, repeated errors.

## Configuration

| Env var | Required | Default | Description |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | yes | — | Base URL of your OneUptime host, e.g. `https://oneuptime.com` |
| `ONEUPTIME_API_KEY` | yes | — | Ingestion key (Project Settings > Telemetry & APM > Ingestion Keys) |
| `CLUSTER_NAME` | yes | — | Cluster identifier; must match the `k8s.cluster.name` the metrics agent stamps |
| `COST_ENGINE_URL` | yes | — | Cost engine base URL, e.g. `http://opencost.opencost.svc.cluster.local:9003`, or `auto` to find the OpenCost or Kubecost the cluster runs |
| `COST_PREFER_EXISTING_ENGINE` | no | `false` | `true` when `COST_ENGINE_URL` is the chart's bundled engine: read the cluster's own engine instead when it runs one that answers |
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
| `HEALTH_PORT` | no | `13134` | Port serving `/healthz` and `/livez` |
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
