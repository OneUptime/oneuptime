# OneUptime Kubernetes Cost Agent

Polls an in-cluster cost engine's Allocation API — [OpenCost](https://opencost.io) or Kubecost (both are built on the same open-source [cost-model](https://github.com/kubecost/cost-model)) — and ships pre-priced, per-workload cost allocations to OneUptime.

OneUptime stores the allocations in ClickHouse (`KubernetesCostAllocation`) and renders them on the Kubernetes cluster **Costs** pages and dashboards: spend by namespace / workload / pod / label over time, idle cost, and request-vs-usage efficiency.

## How it works

1. Every `POLL_INTERVAL_SECONDS` the agent checks whether a new `WINDOW_SECONDS` window (default: 1 hour) has closed and settled.
2. For each closed window it queries the engine's Allocation API at container granularity (`accumulate=true`, `includeIdle=true`). The API path is auto-detected: `/model/allocation` (Kubecost), `/allocation/compute` (OpenCost), `/allocation` (older OpenCost).
3. The allocations are mapped to OneUptime's ingest rows (cost components include the engine's reconciliation adjustments) and POSTed to `{ONEUPTIME_URL}/kubernetes-cost/ingest`, chunked at `SHIP_BATCH_SIZE` rows, authenticated with the `x-oneuptime-token` header.
4. Windows ship strictly in order; the checkpoint only advances when a window fully lands, so a failed ship is retried on the next tick. On restart the agent re-ships the last `LOOKBACK_WINDOWS` closed windows — the server skips windows that already have rows, so this cannot double-count.

## Health

Two endpoints on `HEALTH_PORT`, and the split matters:

- **`/healthz`** (also `/`) — readiness. `200 {"status":"ok"}` while the pipeline is working, `503 {"status":"degraded", "reasons": [...]}` once it demonstrably is not, so the pod reads `0/1 Ready` instead of staying green while nothing ships. Degraded means any of: the poll has thrown `HEALTH_MAX_POLL_FAILURES` ticks in a row; no window has completed in `HEALTH_STALE_WINDOWS` windows; or nothing has ever shipped well past the point something should have.
- **`/livez`** — liveness. `200` for as long as the process is up. Restarting cannot fix a cost engine that is down, and a restart loop would throw away both the poller's in-memory checkpoint and the diagnostic `/healthz` is carrying.

Silence alone never fails the agent. A healthy cost agent is idle most of the time, and on a fresh install the `LOOKBACK_WINDOWS` windows it re-ships predate the engine and legitimately come back empty — so the "nothing shipped yet" signal only counts once that grace has passed, and the fast signal needs real, repeated errors.

## Configuration

| Env var | Required | Default | Description |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | yes | — | Base URL of your OneUptime host, e.g. `https://oneuptime.com` |
| `ONEUPTIME_API_KEY` | yes | — | Telemetry ingestion key (Project Settings > Telemetry Ingestion Keys) |
| `CLUSTER_NAME` | yes | — | Cluster identifier; must match the `k8s.cluster.name` the metrics agent stamps |
| `COST_ENGINE_URL` | yes | — | Cost engine base URL, e.g. `http://opencost.opencost.svc.cluster.local:9003` |
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

The agent ships as part of the `oneuptime/kubernetes-agent` Helm chart — `--set cost.enabled=true` is a complete install: the chart bundles OpenCost (plus the minimal Prometheus it needs) and wires this poller to it automatically. Already running Kubecost or OpenCost? Set `cost.engine.url` to its Service instead and nothing is bundled. See the chart's `values.yaml` and the OneUptime docs page "Kubernetes Cost Observability".

## Development

```
npm install
ONEUPTIME_URL=... ONEUPTIME_API_KEY=... CLUSTER_NAME=dev COST_ENGINE_URL=http://localhost:9003 npm start
```
