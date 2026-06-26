# Sizing & Capacity Planning

This guide helps you size a self-hosted OneUptime deployment on Kubernetes (Helm). It covers the three datastores OneUptime depends on — **PostgreSQL**, **Redis**, and **ClickHouse** — plus the application compute, and gives starting tiers you can adjust once you have real numbers.

> **Read this first:** the Helm chart ships with **no CPU/memory requests or limits set** and small **25 Gi** default volumes for PostgreSQL and ClickHouse. Those defaults exist so the chart installs and runs on any cluster — they are **not** production sizing. For anything beyond a quick trial, set resources and storage explicitly using the numbers below.

If you are running the single-server Docker Compose install instead, sizing is simpler — see [Docker Compose](/docs/installation/docker-compose) (recommended: 16 GB RAM, 8 cores, 400 GB disk).

## What drives each datastore

OneUptime requires three datastores in production. They scale on completely different inputs, so size them independently.

| Datastore      | What it stores                                                                                                     | What drives its size                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| **ClickHouse** | All telemetry — logs, metrics, traces, exceptions, profiles                                                        | Telemetry **ingest rate × retention**. This is ~95% of your storage and the dominant cost. |
| **PostgreSQL** | Configuration and state — monitors, incidents, alerts, users, teams, projects, workflows, status pages, dashboards | **Entity count and history**, not telemetry volume. Grows slowly.                          |
| **Redis**      | Cache, work queues, and sessions                                                                                   | **Queue depth and active sessions**. Memory-bound and modest. Not a source of truth.       |

Object storage (S3/MinIO) is **not** required for OneUptime to run. It is only used optionally for database **backups** (via the CloudNativePG Barman plugin for PostgreSQL, or `clickhouse-backup` for ClickHouse). OneUptime does not tier telemetry to object storage — see the "Retention and how it affects storage" section below.

## ClickHouse — the dominant driver

Almost all of your storage and a large share of your RAM will go to ClickHouse, because every log line, metric point, trace span, and exception lives there.

### Storage formula

```
ClickHouse disk ≈ (daily raw telemetry GB ÷ compression) × retention days × replicas × 1.3 (headroom)
```

Compression depends on the signal:

- **Logs** compress well — roughly **5:1**.
- **Metrics** compress less — roughly **2:1** — and high label **cardinality** inflates both disk and RAM faster than raw volume does. Keep labels low-cardinality.
- **Traces** sit in between, depending on span attributes.

### Worked example

A fleet of **10 clusters**, each ~10 nodes / ~100 pods at INFO-level verbosity, produces roughly **50–150 GB of raw logs per cluster over 30 days** (≈ 1.7–5 GB/day per cluster). Across the fleet, with metrics and traces added and after compression, budget roughly **5–15 GB/day of compressed telemetry**.

| Retention | Single replica | 2 replicas + 30% headroom |
| --------- | -------------- | ------------------------- |
| 30 days   | ~150–450 GB    | **~0.4–1.2 TB**           |
| 90 days   | ~0.45–1.35 TB  | **~1.2–3.5 TB**           |

Storage scales **linearly with retention** — a 90-day window costs ~3× a 30-day window.

### RAM and disk type

- **Use NVMe/SSD.** Telemetry is write-heavy with bursty aggregation reads; ClickHouse on spinning disk will struggle.
- **Give ClickHouse generous RAM.** Aggregation queries are memory-intensive. As a rule of thumb, size RAM to a meaningful fraction (25–50%) of your _hot_ (recently queried) compressed dataset, with a practical floor of 16 GB for any real production fleet.
- **Police metric cardinality.** It is the single biggest lever on both ClickHouse RAM and disk. Enforce low-cardinality label conventions at the collection layer and watch active series counts.

## PostgreSQL — configuration and state

PostgreSQL stores your configuration and operational state, not telemetry, so it grows slowly and stays small relative to ClickHouse. Even large deployments are typically in the tens of GB. The default **25 Gi** volume is fine for small installs; plan 50–100 GB for larger ones with headroom for incident/alert history.

If you run many application, worker, and probe replicas, the number of database connections can become the bottleneck before storage does. OneUptime's Helm chart includes an optional **PgBouncer** connection pooler (`pgbouncer.enabled`) for exactly this — enable it for high-replica deployments.

## Redis — cache, queues, and sessions

Redis is used as a cache, a work queue, and a session store. It is **memory-bound** and persistence is **disabled by default** (Redis here is not a source of truth — it can be rebuilt). Size it by expected queue depth and concurrent sessions; 2–8 GB of memory covers most deployments. Note the default eviction policy is `noeviction`, so if queues back up under sustained overload, monitor Redis memory.

## Application compute

Beyond the datastores, size the stateless workloads (ingress, web/API, workers, and probes). All default to **1 replica** with no resource limits — set them explicitly. The chart bundles **KEDA** so workers and probes can autoscale on queue depth; enable it for variable load. Workers scale with telemetry/ingest processing volume, and probes scale with the number of active monitors.

## Starting tiers

Pick the tier closest to your environment as a starting point, then watch actual usage (`kubectl top pods`, ClickHouse/Postgres disk growth) and adjust.

- **Small / PoC** — 1–3 clusters, ≤30 nodes, ≤5 GB/day raw telemetry, 30-day retention.
- **Medium / Production fleet** — ~10 clusters, ~100 nodes, 10–30 GB/day raw telemetry, 30–90-day retention.
- **Large / Multi-fleet** — 50+ clusters, 500+ nodes, 100+ GB/day raw telemetry, 90-day retention.

|                       | Small / PoC                  | Medium / Production fleet    | Large / Multi-fleet                              |
| --------------------- | ---------------------------- | ---------------------------- | ------------------------------------------------ |
| **ClickHouse**        | 4 vCPU / 16 GB / 200 GB NVMe | 8 vCPU / 32 GB / 1–3 TB NVMe | 16+ vCPU / 64–128 GB / 5–15 TB NVMe, **sharded** |
| **PostgreSQL**        | 2 vCPU / 4 GB / 50 GB SSD    | 4 vCPU / 8 GB / 100 GB SSD   | 8 vCPU / 16–32 GB / 250 GB SSD (+ PgBouncer)     |
| **Redis**             | 1 vCPU / 2 GB                | 2 vCPU / 4 GB                | 4 vCPU / 8–16 GB                                 |
| **Retention assumed** | 30 days                      | 30–90 days                   | 90 days                                          |

These size the OneUptime **backend**. The OneUptime collectors that run on each monitored cluster are sized separately — see the [Kubernetes Agent](/docs/telemetry/kubernetes-agent) sizing tiers.

## High availability

The chart's built-in datastores run as **single instances** by default. For production HA:

- **PostgreSQL** — enable the bundled [CloudNativePG](https://cloudnative-pg.io) operator (`postgresOperator.cnpg.enabled`) with **3 instances** (1 primary + 2 hot standbys) for automatic failover.
- **ClickHouse** — enable the bundled [Altinity](https://github.com/Altinity/clickhouse-operator) operator (`clickhouseOperator.altinity.enabled`) with **≥2 replicas per shard** and **3 ClickHouse Keeper** nodes for quorum. Add shards once a single node's disk or RAM becomes the limit.
- **Redis** — the chart has no in-chart replication. For HA, point OneUptime at an **external managed Redis** (or a Sentinel/cluster deployment).

## Retention and how it affects storage

Telemetry retention is enforced as a **ClickHouse TTL configured in days**, set **per project** and refinable **per signal** (logs, metrics, traces, profiles) and per bucket (for example by log severity). The hardcoded default is 15 days.

Because retention directly multiplies ClickHouse storage, decide it before you size disk. OneUptime does **not** automatically archive or tier old telemetry to object storage — for multi-year compliance retention, extend the retention window and size ClickHouse storage to match (or export to an external archive of your choosing).

## Measure before you commit

Telemetry volume varies enormously with application log verbosity, namespace count, scrape interval, and whether DEBUG logging is enabled anywhere. Treat the tiers above as starting points: **instrument your environment for at least four weeks**, measure actual GB/day per signal, then size retention and storage from real data.

## Related

- [Docker Compose](/docs/installation/docker-compose) — single-server sizing
- [Self-Hosted Architecture](/docs/self-hosted/architecture) — how the components fit together
- [Kubernetes Agent](/docs/telemetry/kubernetes-agent) — collector (data-plane) sizing
- [Helm chart on Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)
