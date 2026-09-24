# Database Observability (the Databases resource type)

Roadmap for the **Databases** product: the dashboard section
(_Resources → Databases_) that gives every database server a project runs or
talks to its own page — queries from applications, where it runs, the
engine's own metrics, logs and traces, incidents, alerts and scheduled
maintenance — with labels, owners, label / owner rules, archive and
per-resource retention like every other resource.

Related: [CloudObservability.md](./CloudObservability.md) and
[NetworkObservability.md](./NetworkObservability.md) for the same shape of
document on other pillars; the user docs at `/docs/telemetry/databases`
(`packages/App/FeatureSet/Docs/Content/en/telemetry/databases.md`); the
probe-based [Database Health Monitor](../../../packages/App/FeatureSet/Docs/Content/en/monitor/database-health-monitor.md).

## Recommendation

### Why a Database resource type

Before this change a database existed in four disconnected places, none of
which answered "how is my Postgres doing, who calls it, who owns it":

- the Service Map's inferred `EntityType.Database` items (from CLIENT spans),
  whose Inventory page has Logs / Traces / Metrics tabs that are always
  empty, pruned after 7 days;
- the Database Health **monitor** (PostgreSQL, MySQL, SQL Server) — a probe
  with 41 series, but a monitor, not a resource: no owners, labels, feed or
  page of its own;
- whatever a collector's database-receiver batch happened to land on — the
  collector machine's **Host** (when `resourcedetection` added `host.name`)
  or "Unknown Service";
- a Postgres StatefulSet on Kubernetes or a `postgres` Docker container,
  which showed up as a **Service** named after the workload.

A resource type (like Ceph, VMware or Cloud Environments) gets the platform
for free — page, labels, owners, rules, archive, retention, feed, incident /
alert / maintenance attachment, the telemetry facet — and gives the four
sources above one place to meet. It is named `DatabaseServer` in code and
schema (`Database*` is taken: `DatabaseService` is the base class of every
service, and `MonitorType.Database`, `EntityType.Database` and
`Common/Types/Database/` exist) and "Databases" in the product.

### Detect automatically, from what already arrives

Most teams will never install anything for their databases, so a row must
appear from telemetry OneUptime already receives. Each source contributes a
different part of the page, and the first one to see a database creates it
(`discoverySource`, never overwritten):

| Source | Signal it adds | Create policy |
| --- | --- | --- |
| Collector / Database Agent (`collector`) | Engine metrics, query samples / top queries, the engine's log file | At ingest, from the endpoint the batch names (`server.address` / `server.port`, then `service.instance.id`, `mysql.instance.endpoint`, `mongodb_atlas.*`), or by id (`oneuptime.database.server.id`). Global names only (DNS name or public IP); no budget — an agent is an explicit request |
| Application traces (`client-spans`) | RED metrics of the calls, calling services | 10-minute cron over CLIENT spans. DNS name only (no IP literals, no local names), a server engine (not DynamoDB / Cosmos DB / Spanner / SQLite / H2), ≥ 10 calls in the window, under the project's auto-create budget (500) |
| Kubernetes (`kubernetes`) | Pods, CPU / memory, pod logs | 5-minute cron over each connected cluster's inventory; budgeted |
| Docker / Podman (`docker`, `podman`) | Containers, CPU / memory, container logs | 5-minute cron over each connected host; budgeted; no aliases (container names are network-local) |
| Manual (`manual`) | Whatever of the above later matches its endpoints | Always |

Telemetry selection is one mechanism: **entity keys**. Every DB CLIENT span,
every `db.client.*` datapoint that names a server and every receiver batch
carries `keyForDatabaseEndpoint(host[:port][@cluster])` — derived from the
endpoint only, not the engine, so wire-compatible engines (CockroachDB over
the Postgres driver, OpenSearch reported as Elasticsearch) still join. A
row's key set is the keys of its endpoints (each owned by at most one row
per project, DB-enforced) plus member keys (pod / deployment / container,
kept 30 days so pre-restart logs stay visible). Loopback and host-relative
names never identify a database; private IPs, single-label and cluster-local
names are keyed but never create a row.

### The Kubernetes answer

Yes — detect Kubernetes-hosted databases automatically, and only from the
inventory the Kubernetes agent already ships (pod metadata, labels, images,
owner references, StatefulSet `spec.serviceName`); never from environment
values or secrets.

- **Recognition.** Operator and chart labels first (CloudNativePG, Zalando /
  Spilo, Crunchy PGO, Bitnami charts, ECK, Altinity, cass-operator, Percona,
  the Oracle MySQL operator) — one operator cluster is one database. Exact
  image names otherwise. Exporters, operators, admin UIs, poolers, backup
  tools and infrastructure sidecars are never databases, and a pod that also
  runs an unrecognised (application) container is rejected, so an app with a
  Redis sidecar stays an app.
- **Identity.** `system|kubernetes:<cluster>/<namespace>/<kind>/<name>`,
  independent of names applications use. Aliases are the workload's Service
  FQDNs qualified by the cluster (`pg.prod.svc.cluster.local:5432@prod`), plus
  the unqualified twin only while the project has exactly one cluster, plus
  per-member headless names for StatefulSet / operator members. Applications
  exporting through the Kubernetes agent carry `k8s.cluster.name`, so their
  calls produce the same qualified key.
- **Engine metrics in Kubernetes.** The Database Agent runs as a Deployment
  in the database's namespace, linked to the detected row by
  `DATABASE_SERVER_ID` (the row's Documentation tab renders the manifest
  prefilled). The agent deliberately does **not** stamp `k8s.cluster.name`:
  ingest reads that attribute as the Kubernetes agent's heartbeat
  (`autoDiscoverKubernetesCluster` → `updateLastSeen`), so the Database Agent
  would keep a dead cluster "connected", overwrite its agent version and
  register a phantom cluster on a typo. A chart-native path is E5.

## Shipped baseline

What the v1 change set delivers.

### Identity and discovery

- Isomorphic, never-throwing helpers under `packages/Common/Types/DatabaseServer/`:
  the engine registry (`DatabaseSystem.ts`: engines, aliases, default
  ports, receiver types, images, chart names), endpoint canonicalization and
  scope (`DatabaseEndpoint.ts`), the span / resource resolvers
  (`DatabaseTelemetryResolver.ts`), the pod / container classifier
  (`DatabaseContainerClassifier.ts`) and the curated per-engine metric catalog
  (`DatabaseServerMetricCatalog.ts`). Keys live in
  `Common/Utils/Telemetry/EntityKey.ts` and `DatabaseServerEntityKeys.ts`.
- Ingest: `autoDiscoverDatabaseServer` for metrics and logs (receiver scope
  names give the engine hint), the database as primary entity for receiver
  batches without `service.name`, per-span and per-`db.client.*`-datapoint
  endpoint keys, `oneuptime.database.server.id` / `.name` stamped on receiver
  rows and honoured as an input link.
- Workers: `DatabaseServer:DiscoverContainerDatabases` (Kubernetes, Docker,
  Podman), `DatabaseServer:CleanupStaleResources` (collector disconnect after
  15 minutes; auto-archive of untouched discovered rows unseen for 7 days,
  undone on the next sighting), and an isolated client-span step inside
  `TelemetryEntity:ComputeServiceDependencies`.

### Product

- Seven models (`DatabaseServer`, `DatabaseServerEndpoint`, feed, owner team
  / user, label / owner rule), 23 permissions, `databaseServers` on
  Incident / Alert / Scheduled Maintenance, the `databaseServerId` facet, and
  monitor linking through `oneuptime.database.server.id`.
- Dashboard: list (engine, runs on, discovery source, engine-metrics status,
  last seen, labels; bulk archive / labels / owners; summary strip), Archived,
  product Documentation, label and owner rules; per database an Overview in
  three sections (queries from applications, runtime, engine metrics),
  entity-key-scoped Metrics / Logs / Traces, Incidents, Alerts, Scheduled
  Maintenance, Feed, Owners, Endpoints (the one-owner rule), Settings
  (retention, archive), a prefilled Documentation tab and Delete. The
  Service Map's database node links to "Open database".

### Agent and docs

- `agents/DatabaseAgent/`: a config-only agent — the stock
  `otel/opentelemetry-collector-contrib:0.161.0` image, one config per engine
  (PostgreSQL, MySQL / MariaDB, Redis / Valkey, MongoDB), `install.sh`,
  `troubleshoot.sh`, a systemd unit. One agent per database instance; the
  configs upsert the identity, set the optional id blank-safely, delete
  `service.name`, run no `resourcedetection`, and enable the useful
  off-by-default metrics and the query-sample / top-query events. Least-
  privilege grants per engine are in the README and the docs.
- `/docs/telemetry/databases` is the hub: sources and create policy, the
  agent, Kubernetes, your own collector, endpoints and the one-owner rule,
  archive-to-dismiss, retention scope, troubleshooting.
- Tests: `packages/App/Tests/FeatureSet/Docs/DatabasesDocs.test.ts` pins the
  page to the compose file, the configs, the engine registry and the metric
  catalog; `Tests/Ops/DatabaseAgentConfigs.test.js` pins the configs'
  structure; `Tests/Ops/validate-collector-configs.sh` runs `otelcol validate`
  over every config (and every optional metric their comments list) on each
  PR.

## Remaining epics

Ordered by how often the gap is expected to come up. Sizes are rough
engineer-weeks.

### E1 — Per-engine alert templates and monitor recommendations (size 2)

VMware and Ceph ship alert templates; databases do not. Candidates per
engine: connection saturation (`postgresql.backends` / `postgresql.connection.max`,
`mysql.threads` vs `max_connections`), replication lag, cache hit ratio,
deadlocks, Redis memory against `maxmemory` and evictions, MongoDB member
health. Add a "Create alert" entry on the Overview that deep-links into the
metric monitor form with the row's scope pre-filled.

Open question: scope templates by the stamped `oneuptime.database.server.id`
attribute (receiver data only) or by entity keys (which also covers the
span-derived error rate, but metric monitors do not filter by keys today)?

### E2 — Database Health monitor ↔ DatabaseServer (size 1–2)

Link the probe monitor to the row whose endpoint its connection host:port
canonicalizes to, show its `oneuptime.monitor.database.*` series on the
page, and offer "create a Database Health monitor" prefilled from the row
(PostgreSQL, MySQL, SQL Server).

Open question: implicit linking by endpoint, or an explicit database picker
on the monitor form (endpoints can be ambiguous across networks)?

### E3 — Aliasing from Kubernetes Services and Endpoints; merge (size 3)

v1 aliases come from naming conventions only. Shipping Services and
EndpointSlices in the Kubernetes inventory would let ClusterIPs and pod IPs
become aliases (so OBI's IP-only spans join), turn pooler Services (CNPG
Pooler, Crunchy pgBouncer, Bitnami pgpool) into aliases of the database they
front instead of separate rows, and catch a Deployment `redis` behind a
Service `cache`. Add a "Merge databases" action (move endpoints, labels,
owners; archive the source).

Open questions: pod IPs are reused — do IP aliases need a TTL? Should a
batch linked by `oneuptime.database.server.id` also carry the row's primary
endpoint key, so its data shows on the row's tabs even when the stamped
address is a local-scope name the row does not own?

### E4 — Logical databases, schemas and top queries (size 3)

Receivers already report per-database resources (`postgresql.database.name`)
and, with `DATABASE_QUERY_EVENTS=true`, query samples and top queries as
logs. A Queries tab (top statements by time / calls, samples, explain plans)
and per-database sizes would turn those logs into a view.

Open question: query text can carry PII — redact at ingest, store digests
only, or rely on the per-database retention setting?

### E5 — Kubernetes agent chart integration (size 3)

`container.image.name` on the container inventory, Services in `k8sobjects`,
an exporter-sidecar scrape job, and a `receiver_creator` in the chart that
starts the right receiver for each detected database — so engine metrics in
Kubernetes need no separate Deployment.

Open question: credentials — per-database Secret references in the chart
values, and how the chart's discovery rules stay in step with
`DatabaseContainerClassifier`.

### E6 — Per-project discovery toggles (size 1)

_Databases → Settings → Discovery_ with switches for application traces,
Kubernetes and Docker / Podman (the collector is always on — it is
explicit). Off means find-only (`allowCreate: false`), so existing rows keep
their keys. Surface refused receiver batches ("N batches named no server")
with a link to the docs.

Open question: is archive-to-dismiss enough, or do deleted discovered rows
need tombstones?

### E7 — Prometheus exporters as a source (size 2)

`postgres_exporter`, `mysqld_exporter`, `redis_exporter` and
`mongodb_exporter` scrapes carry `pg_*` / `mysql_*` names and a job-derived
`service.name`. Recognise them, derive the endpoint from the exporter's
target, and map their series onto the catalog.

Open question: map exporter names onto the receiver catalog, or keep a
second catalog per source?

### E8 — Managed cloud databases through cloud APIs, with cost (size 3+)

RDS / Aurora, Cloud SQL, Azure Database: metrics from CloudWatch / Cloud
Monitoring / Azure Monitor keyed by the instance's DNS endpoint (which is
already an endpoint the app spans name), plus cost. Blocked on the
cloud-credential model (CloudObservability E3).

### E9 — Service Map database nodes with incident overlays (size 1)

Back the Service Map's database nodes by `DatabaseServer` rows and overlay
open incidents / alerts.

Open question: retire the inferred `EntityType.Database` items in favour of
`DatabaseServer`, or keep both (the inferred item is per logical database,
the row per server)?

### E10 — Ask-AI resource context for databases (size 1)

An `AIResourceType` for `DatabaseServer` (engine, endpoints, runtime,
calling services, recent engine metrics) so Ask AI can reason about a
database the way it does about a cluster.

### E11 — Rule criteria by engine and namespace (size 1)

Label / owner rules match labels, name and description; v1 relies on the
display name embedding the engine (`^PostgreSQL`). Add
`databaseServerSystems` (engine multi-select) and a Kubernetes namespace
pattern.

### E12 — SQL Server named instances and Oracle services in the endpoint (size 1)

`host\instance` drops the instance and Oracle service names are not part of
the endpoint, so two named instances (or services) on one host share an
endpoint and a row.

Open question: extend the endpoint grammar (and every stored endpoint) or add
a qualifier column next to it?

### E13 — Home marketing page (size 0.5)

A product page on the website like the other infrastructure products.

### E14 — Persian (fa) translation of the docs (size 0.5)

`fa` is the only translated docs corpus; the Databases hub ships in English
only in v1 (other languages fall back per page).

## Update cadence

When an epic starts (spin its section into a design doc), when an engine
gains an agent config or a receiver, or when the shipped baseline changes
shape.
