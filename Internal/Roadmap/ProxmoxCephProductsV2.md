# Proxmox & Ceph Products — V2 Enhancement Spec

Builds on `Internal/Roadmap/ProxmoxCephProducts.md` (v1 = Docker-template parity).
V2 raises both products toward the **Kubernetes/Host bar** by porting the proven
patterns from those two codebases. Every work item below names its pattern source
(file refs are from the K8s/Host engineering briefs and are accurate as of this
branch), the Proxmox analog, the Ceph analog, files to create/modify, and an
effort tag (S = <½ day, M = 1–2 days, L = 3+ days).

State of the worktree when this spec was written: `Common/Models/DatabaseModels/ProxmoxCluster.ts`
and `CephCluster.ts` exist (with `otelCollectorStatus`, `lastSeenAt`, `agentVersion`,
`pveVersion`/`cephVersion`/`fsid`, count columns `nodeCount/guestCount/storageCount`
and `monCount/osdCount/poolCount`, retention columns). `ProxmoxAgent/` and `CephAgent/`
exist (config-only). Dashboard pages not yet created. Where v1 work is still in
flight, v2 items state the contract the v1 code must satisfy.

Naming conventions used throughout:
- Proxmox identity attribute: `proxmox.cluster.name` (resource attr, stamped by agent).
- Ceph identity attribute: `ceph.cluster.name`.
- The Postgres join key is the cluster model's `name` column (v1 decision; analog
  of `clusterIdentifier`/`hostIdentifier` — `@UniqueColumnBy("projectId")`, byte-equal
  to the raw attribute, case preserved, case-insensitive lookup at ingest).

---

## P0 — Foundations (ship first; everything else builds on these)

### WI-1: Agent config enrichment — `pve.scope` / `pve.id` datapoint attributes (S)

**Pattern source:** none in K8s/Host — this is a Proxmox-specific enabler, but it is
what makes every downstream item (alert template filters, resource snapshot scan,
list pages) clean. pve-exporter encodes identity in a single datapoint label
`id` with values like `node/pve1`, `qemu/100`, `lxc/101`, `storage/local`.
OneUptime monitor criteria and ClickHouse attribute filters support equality only,
not prefix match (see `MonitorTelemetryMonitor.ts` resourceFilters L1106–1127 —
all equality).

**Proxmox:** add an OTTL `transform` processor to the collector config that splits
`id` into two new datapoint attributes:
- `pve.scope` ∈ `node|guest|storage|cluster` (`qemu` and `lxc` both map to `guest`)
- `pve.type` ∈ `node|qemu|lxc|storage`
- `pve.id` = the part after the slash (`pve1`, `100`, `local`)

Example OTTL (metrics context):
`set(attributes["pve.scope"], "node") where IsMatch(attributes["id"], "^node/")` etc.
Keep the original `id` label untouched (group-by pages and breakdowns still use it).

**Ceph:** no transform needed — `ceph_daemon`, `pool_id`/`name` labels are already
equality-filterable. Verify `honor_labels: true` is set (it is in the v1 config).
Add one optional enrichment: a commented-out `filelog` receiver block for
`/var/log/ceph/ceph.log` (powers WI-16).

**Files:** `ProxmoxAgent/otel-collector-config.yaml`, `ProxmoxAgent/README.md`,
`CephAgent/otel-collector-config.yaml`, `CephAgent/README.md`,
`App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown.ts` (the
in-app install guide must show the final config — K8s lesson: `DocumentationCard`
interpolates the real config, `Components/Kubernetes/DocumentationCard` 313 lines).

### WI-2: Connection-status lifecycle hardening (S per product)

**Pattern source:** `KubernetesClusterService.ts` — `findOrCreateByClusterIdentifier`
(case-insensitive `QueryHelper.findWithSameText` + create-race re-fetch, L57–139),
`updateLastSeen` (60-s SHA-1 fingerprint cache on extras, L148–191),
`markDisconnectedClusters` (connected && `lastSeenAt < now − 5min` → disconnected,
L270–305); the Redis 5-min maintenance fence in `OtelIngestBaseService.ts` L58–83;
the DB-level unique index `(projectId, identifier)` on `KubernetesCluster.ts` L80
that defuses the concurrent find-or-create race; `HostService.ts`
`findOrCreateByHostIdentifier` canonicalization commentary L77–84 ("case-sensitive
lookup would wedge ingest").

**Proxmox analog:** `ProxmoxClusterService.findOrCreateByName` must implement ALL
of: unique DB index `(projectId, name)` (confirm the v1 migration creates it — the
model decorator alone is not the race defense; the index is), case-insensitive
lookup, create with `otelCollectorStatus: "connected"` + `lastSeenAt: now`,
race re-fetch, fingerprint-throttled `updateLastSeen(extras)`, and
`markDisconnectedProxmoxClusters()` (5-min threshold).
**Ceph analog:** identical in `CephClusterService`.

**Cron:** one new worker per product, `EVERY_FIVE_MINUTE`, registered in
`App/FeatureSet/Workers/Index.ts` (K8s registers at L141–152):
- `App/FeatureSet/Workers/Jobs/Proxmox/CleanupStaleResources.ts` — step 1
  `markDisconnectedProxmoxClusters()`, step 2 inventory pruning (WI-6).
- `App/FeatureSet/Workers/Jobs/Ceph/CleanupStaleResources.ts` — same shape.

**Net SLA (document in code comments, copied from K8s):** lastSeenAt staleness
≤ ~5 min (fence) + 5-min disconnect threshold ⇒ pill flips ≤ ~10 min after the
agent dies. The list-page pill renders from the snapshot column exactly like
`Pages/Kubernetes/Clusters.tsx` L239–265 (green/red dot + Connected/Disconnected).

**Files:** `Common/Server/Services/ProxmoxClusterService.ts`,
`Common/Server/Services/CephClusterService.ts`, the two new worker files,
`App/FeatureSet/Workers/Index.ts`, v1 migration (verify unique indexes).

### WI-3: Snapshot count/status write-back — list pages never hit ClickHouse (M)

**Pattern source:** two patterns fused. (a) Host's cached hardware columns:
`scanHostInfraStatsFromMetrics` (`OtelIngestBaseService.ts` L1832–1903) derives
`cpuCores`/`totalMemoryBytes`/`processCount` from the metric batch and ships them
as `updateLastSeen` extras — fingerprint-throttled, so identical payloads skip the
Postgres write. (b) K8s's allow-list scan: `K8S_SNAPSHOT_METRIC_NAMES`
(`OtelMetricsIngestService.ts` L99–108) costs one `Set.has` per datapoint, gated
on the cluster id being present (L916), buffers fold per cluster, flush after the
ClickHouse flush, all failures logged + swallowed ("snapshots are best-effort and
must never affect ClickHouse ingest", L1033–1051).

**Contract — which metrics update which columns:**

Proxmox (`PVE_SNAPSHOT_METRIC_NAMES` = `pve_up`, `pve_node_info`, `pve_guest_info`,
`pve_storage_info`, `pve_version_info`, `pve_ha_state`), scan gated on
`proxmoxClusterId`:
- `nodeCount` ← distinct `id` with `pve.scope=node` across the batch (prefer
  `pve_node_info` series; fall back to `pve_up`).
- `onlineNodeCount` (NEW column, see migration below) ← distinct node ids where
  `pve_up == 1`.
- `guestCount` ← distinct `id` with `pve.scope=guest` (`pve_guest_info`).
- `storageCount` ← distinct `id` with `pve.scope=storage` (`pve_storage_info`).
- `pveVersion` ← `version` label of `pve_version_info`.

Ceph (`CEPH_SNAPSHOT_METRIC_NAMES` = `ceph_health_status`, `ceph_mon_quorum_status`,
`ceph_mon_metadata`, `ceph_osd_up`, `ceph_osd_in`, `ceph_osd_metadata`,
`ceph_pool_metadata`, `ceph_cluster_total_bytes`, `ceph_cluster_total_used_bytes`),
gated on `cephClusterId`:
- `monCount` ← distinct `ceph_daemon` on `ceph_mon_metadata`.
- `osdCount` ← distinct `ceph_daemon` on `ceph_osd_metadata`.
- `osdUpCount` / `osdInCount` (NEW columns) ← count of `ceph_osd_up == 1` /
  `ceph_osd_in == 1`.
- `poolCount` ← distinct `pool_id` on `ceph_pool_metadata`.
- `healthStatus` (NEW column, smallint 0/1/2 rendered OK/WARN/ERR) ← latest
  `ceph_health_status` value.
- `capacityUsedPercent` (NEW column, decimal) ← `total_used_bytes / total_bytes × 100`
  when both present in the batch.
- `cephVersion` ← modal `ceph_version` label across `ceph_mon_metadata`.

**Write semantics:** counts are only written when the batch contains the
corresponding `*_info`/`*_metadata` series — never zero a count on a partial batch
(COALESCE-per-column semantics, exactly like `bulkUpdateLatestMetrics`'s COALESCE
guard, `KubernetesResourceService.ts` L472–491). All values ride the existing
`updateLastSeen` extras path → the 60-s fingerprint cache is the throttle. A full
pve-exporter / ceph-mgr scrape contains every series, so one batch = one complete
snapshot; no cross-batch state needed (unlike K8s's 30-min allocatable caches —
not required here, skip them).

**List page columns this powers** (clone `Pages/Kubernetes/Clusters.tsx` shape):
Proxmox list: Name, Status pill, "Nodes 3/3 online" (onlineNodeCount/nodeCount),
Guests, Storage, Version, Last Seen, Labels, Owners. Ceph list: Name, Health pill
(OK/WARN/ERR from `healthStatus` — colored like the K8s status pill), OSDs
"12 up / 12 in / 12 total", Mons, Pools, Capacity bar (`capacityUsedPercent`),
Version, Last Seen, Labels, Owners. Plus the K8s cross-cutting hooks: status facet
via `buildEnumFacetQuery`, `useResourceOwners` facet bar with `persistKey`,
bulk label/owner actions, and the empty-state contract (count first → render
`DocumentationCard` when 0, `Clusters.tsx` L94–129).

**Files:** `App/FeatureSet/Telemetry/Services/OtelMetricsIngestService.ts`
(scan + buffer + flush), `Common/Server/Services/ProxmoxClusterService.ts` /
`CephClusterService.ts` (extras handling), models `ProxmoxCluster.ts` (add
`onlineNodeCount`), `CephCluster.ts` (add `healthStatus`, `osdUpCount`,
`osdInCount`, `capacityUsedPercent`), new migration
`Common/Server/Infrastructure/Postgres/SchemaMigrations/<ts>-AddProxmoxCephSnapshotColumns.ts`
(+ `SchemaMigrations/Index.ts`), `App/FeatureSet/Dashboard/src/Pages/Proxmox/Clusters.tsx`,
`Pages/Ceph/Clusters.tsx`.

### WI-4: Per-cluster retention + billing (S)

**Pattern source:** `OpenTelemetryIngestService.ts` —
`buildResourceMetadataForNonService` fetches `retainTelemetryDataForDays` +
`telemetryRetentionConfig` for `ServiceType.KubernetesCluster` (L674–689) and
`getResourceRetention` for Host (L643–656); row builder stamps `retentionDate`
(`OtelMetricsIngestService.ts` L2110–2120); read-side filter
`AnalyticsDatabaseService.ts` L971–986; billing map
`TelemetryUsageBillingService.buildTelemetryRetentionMap` (L354–426) — one
`resourceId → days` map covering Services/Hosts/DockerHosts/KubernetesClusters,
cost scaled per `primaryEntityId` (L323–343).

**Proxmox + Ceph analogs (identical work):**
1. Add `ServiceType.ProxmoxCluster` / `ServiceType.CephCluster` (wherever v1 put
   the primary-entity routing — `selectPrimaryEntity` ladder slots after
   KubernetesCluster, display names `proxmox/<name>`, `ceph/<name>`).
2. Branch both new ServiceTypes in `buildResourceMetadataForNonService` /
   `getResourceRetention` so cluster-owned rows get the cluster's retention days.
3. Add both models to `buildTelemetryRetentionMap` so billing scales by the
   cluster's retention. (Clusters are billed like any telemetry owner; only
   Monitor/Alert/Incident types are exempt — keep that.)
4. Settings page: `retainTelemetryDataForDays` field + per-pillar
   `TelemetryRetentionConfigForm`/`Summary` (clone `Pages/Kubernetes/View/Settings.tsx`
   two-card layout).
5. `PruneStaleEntities` TTLs (`App/FeatureSet/Workers/Jobs/TelemetryEntity/PruneStaleEntities.ts`
   L33–51): `proxmox.cluster` / `ceph.cluster` = 30 d (match k8s cluster);
   `proxmox.node` = 7 d (match k8s node); `proxmox.guest` = 24 h (match pod).

**Files:** `App/FeatureSet/Telemetry/Services/OpenTelemetryIngestService.ts`,
`Common/Server/Services/TelemetryUsageBillingService.ts`,
`App/FeatureSet/Workers/Jobs/TelemetryEntity/PruneStaleEntities.ts`,
`Pages/Proxmox/View/Settings.tsx`, `Pages/Ceph/View/Settings.tsx`.

---

## P1 — Product depth (the K8s-bar features)

### WI-5: entityScope tab scoping — DECISION: use it, not Docker's attribute-only (S)

**Pattern source:** the entityScope contract C4 — compile target
`Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts` L432–512:
`{entityKeys, attributeKey, attributeValue}` → `(hasAny(entityKeys,[…]) OR
attributes['k']='v')`. Usage: `Pages/Kubernetes/View/Metrics.tsx` L85–102,
`View/Logs.tsx` L104–120; key helpers `EntityKey.keyForKubernetesCluster`
(`Common/Utils/Telemetry/EntityKey.ts` L142–151), `keyForHost` (L98–104).

**Recommendation (binding):** Proxmox and Ceph telemetry tabs use entityScope from
day one. Docker's attribute-only scoping predates the entity layer; the attribute
fallback inside entityScope already covers rows ingested before the v1 resolvers
landed, and `hasAny(entityKeys)` rides the bloom-filter index. Requirements are
all v1 deliverables (agent A): `EntityType.ProxmoxCluster/CephCluster`, resolvers
keyed on `proxmox.cluster.name` / `ceph.cluster.name` **only** (name-based on
purpose, mirroring the K8s comment at `TelemetryEntity.ts` L456–534 — read-side
`keyForProxmoxCluster(projectId, name)` must reproduce the ingest key), and the
`keyFor*` helpers. V2 adds nothing server-side; it mandates the tab wiring:

- `Pages/Proxmox/View/Metrics.tsx` / `Logs.tsx`: `entityScope: {entityKeys:
  [keyForProxmoxCluster(projectId, cluster.name)], attributeKey:
  "resource.proxmox.cluster.name", attributeValue: cluster.name}`. Same for Ceph.
- Copy the K8s warning comment: do NOT also AND a separate attributes-equality
  filter (`View/Metrics.tsx` L85–102 documents why — it defeats the OR).
- No Traces/Profiles tabs (see Rejected list — these agents produce no traces or
  profiles; do not clone empty tabs).

**Files:** `Pages/Proxmox/View/{Metrics,Logs}.tsx`, `Pages/Ceph/View/{Metrics,Logs}.tsx`.

### WI-6: Child-resource Postgres inventory — ProxmoxResource + CephResource (L) — SHIP IN V2

**Pattern source:** `Common/Models/DatabaseModels/KubernetesResource.ts` (not
user-writable, unique index `(projectId, clusterId, kind, namespaceKey, name)` L70,
denormalized `latestCpuPercent`/`latestMemoryBytes`/`metricsUpdatedAt`/`lastSeenAt`);
`KubernetesResourceService.bulkUpsert` (raw SQL `ON CONFLICT … DO UPDATE … WHERE
EXCLUDED."lastSeenAt" >= existing."lastSeenAt"` in 500-row chunks, L332–414);
`bulkUpdateLatestMetrics` (single `UPDATE … FROM (VALUES …)` with COALESCE +
`metricsUpdatedAt` monotonic guard, L472–491); cleanup worker
`App/FeatureSet/Workers/Jobs/Kubernetes/CleanupStaleResources.ts` (connected-only
pruning, 15-min threshold = 3× snapshot interval, env override, disconnected
clusters skipped deliberately to preserve last-known inventory — file comment
L11–27); summary endpoint `Common/Server/API/KubernetesResourceAPI.ts` L235–270.

**Decision and justification:** SHIP in v2, not deferred. K8s needed a separate
k8sobjects *log* stream to build its inventory; Proxmox/Ceph identity + status
already arrive in every metric scrape that WI-3 is scanning anyway. The marginal
cost over WI-3 is one model + one bulkUpsert per product + the cleanup step in the
WI-2 crons. The payoff is the entire K8s list/detail UX: Postgres-served list
pages with status pills and CPU/mem bars (no 15-min ClickHouse scans à la Docker
Containers), name-keyed detail routes, sidebar badge counts, and honeycomb
widgets (WI-14). Without it, every per-cluster page is a ClickHouse group-by and
the products stay at Docker depth forever.

**ProxmoxResource** (`Common/Models/DatabaseModels/ProxmoxResource.ts`):
- `kind`: `Node | Guest | Storage`. Unique index
  `(projectId, proxmoxClusterId, kind, externalId)` where `externalId` = the pve
  `id` label (`node/pve1`, `qemu/100`, `storage/local`) — immutable, collision-free.
- Identity columns: `name` (from `pve_guest_info`/`pve_node_info`/`pve_storage_info`
  `name`/`storage` labels), `vmid` (nullable int), `guestType` (`qemu|lxc`),
  `parentNodeName` (the `node` label — guests and storages belong to a node).
- Status columns: `isUp` (from `pve_up`), `haState` (current `state` label of the
  `pve_ha_state` enum-series with value 1), `onboot` (from `pve_onboot_status`),
  `uptimeSeconds`.
- Latest-metric mirror: `latestCpuPercent` (`pve_cpu_usage_ratio × 100` — already
  a true ratio; **no allocatable-denominator cache needed**, unlike K8s
  `cpuCoresToPercent` L1198–1218 — document this delta), `latestMemoryBytes`,
  `maxMemoryBytes` (`pve_memory_size_bytes`), `latestMemoryPercent` (usage/size),
  `latestDiskBytes` / `maxDiskBytes` (`pve_disk_usage_bytes`/`pve_disk_size_bytes`;
  NULL for qemu guests without the QEMU guest agent — render N/A, never 0),
  `metricsUpdatedAt`, `lastSeenAt`.

**CephResource** (`Common/Models/DatabaseModels/CephResource.ts`):
- `kind`: `Osd | Pool | Mon | Mgr | Mds | Rgw`. Unique index
  `(projectId, cephClusterId, kind, externalId)`; `externalId` = `ceph_daemon`
  (e.g. `osd.3`, `mon.a`) or `pool_id`.
- OSD columns: `isUp`/`isIn` (`ceph_osd_up`/`ceph_osd_in`), `deviceClass` +
  `hostname` (from `ceph_osd_metadata` labels), `statBytes`/`statBytesUsed`
  (`ceph_osd_stat_bytes*`), `applyLatencyMs`/`commitLatencyMs`, `pgCount`
  (`ceph_osd_numpg`).
- Pool columns: `name` (from `ceph_pool_metadata`), `storedBytes`
  (`ceph_pool_stored`), `maxAvailBytes` (`ceph_pool_max_avail`), `objects`
  (`ceph_pool_objects`), `readOpsPerSec`/`writeOpsPerSec` (client-side rate of
  `ceph_pool_rd`/`ceph_pool_wr` — stored as latest raw counters; rates computed
  on read like K8s network, see WI-8).
- Mon/Mgr/Mds/Rgw: `inQuorum` (`ceph_mon_quorum_status`), `hostname`, `version`
  (from `*_metadata`).
- Shared: `metricsUpdatedAt`, `lastSeenAt`.

**Population:** entirely inside the WI-3 scan (extend the allow-lists with the
per-resource metrics above). Buffer per cluster, fold by latest `observedAt`
(newer wins, first-non-null-wins for labels — K8s buffer semantics
`OtelMetricsIngestService.ts` L1547–1574), flush after the ClickHouse flush:
`bulkUpsert` (identity + status, lastSeenAt dominance guard) then
`bulkUpdateLatestMetrics` (COALESCE + monotonic guard). Best-effort: failures
logged + swallowed.

**Cleanup:** step 2 of the WI-2 crons — for each **connected** cluster, hard-delete
rows with `lastSeenAt < now − 15min` (env overrides `PVE_INVENTORY_STALE_MINUTES`
/ `CEPH_INVENTORY_STALE_MINUTES`, min 5). Disconnected clusters skipped (preserve
last-known inventory through agent outages — copy the K8s file comment).

**Summary endpoints:** `Common/Server/API/ProxmoxResourceAPI.ts` /
`CephResourceAPI.ts` — POST `/proxmox-resource/inventory-summary/:clusterId`
returning `countsByKind` for sidebar badges. **Single-source rule (K8s lesson,
`View/Layout.tsx` L37–43):** once these exist, the WI-3 count columns must be
written from the same upsert buffer so list-page counts and sidebar badges can
never drift.

**Files:** 2 models + `Common/Models/DatabaseModels/Index.ts`, 2 services
(`ProxmoxResourceService.ts`, `CephResourceService.ts`) + `Services/Index.ts`,
1 migration, 2 API files + registration, `OtelMetricsIngestService.ts`,
the 2 WI-2 worker files.

### WI-7: List + detail pages built on the inventory (L per product)

**Pattern source:** the port-ready shared components —
`Components/Kubernetes/KubernetesResourceTable.tsx` (539 lines; generic client-side
list shell: status-badge color map, CPU/memory bar cells with three memory render
modes, filter/sort/paginate at PAGE_SIZE 25),
`KubernetesOverviewTab` (fully generic summaryFields/labels/conditions grid),
`KubernetesMetricsTab` (88 lines, product-agnostic MetricView host), the
`KubernetesResource` view-model interface (`Utils/KubernetesResourceUtils.ts`
L27–44) and `fetchInventoryResources` (slim select + transform + 15-min
`METRIC_STALE_MS` cutoff so stale CPU/mem render N/A, L398/416–534). Route param
contract: detail `subModelId` is the resource **externalId**, not a DB id
(`Utils/RouteMap.ts` L78 pattern; `View/PodDetail.tsx` L47–48 readback).

**Action (binding):** promote `KubernetesResourceTable`, `KubernetesOverviewTab`,
and `KubernetesMetricsTab` to `Components/Infrastructure/{ResourceTable,
ResourceOverviewTab,ResourceMetricsTab}.tsx` with product-neutral prop names; the
K8s pages re-export. Do NOT clone 900 lines of generic table per product.

**Proxmox pages** (`Pages/Proxmox/View/`):
- `Nodes.tsx` → `NodeDetail.tsx` (tabs: Overview — status/uptime/version/HA
  summary fields; Metrics — `pve_cpu_usage_ratio×100`, memory usage/size, network
  rx/tx rate via WI-8 helper, disk r/w rate, all filtered
  `id = node/<name>`).
- `Guests.tsx` (columns: Name, VMID, Type qemu/lxc, Node, Status running/stopped,
  HA state, CPU bar, Mem bar usage/max, Uptime) → `GuestDetail.tsx` (tabs:
  Overview; Metrics — cpu/mem/net/disk-io charts filtered `id = <type>/<vmid>`).
- `Storage.tsx` (columns: Name, Node, Used/Total bar, Status) → `StorageDetail.tsx`
  (Overview + usage-over-time chart).
- Replace v1's planned ClickHouse-group-by list pages with inventory-backed ones.

**Ceph pages** (`Pages/Ceph/View/`):
- `Osds.tsx` (columns: ID, Host, Device class, Up pill, In pill, Used/Total bar,
  PGs, Apply/Commit latency) → `OsdDetail.tsx` (Overview; Metrics — latency,
  usage, PG count over time filtered `ceph_daemon = osd.N`).
- `Pools.tsx` (columns: Name, Stored, Max avail, Used% bar, Objects, Read/Write
  IOPS) → `PoolDetail.tsx` (Overview; Metrics — stored growth, IOPS, throughput
  filtered `pool_id`).
- `Daemons.tsx` — mon/mgr/mds/rgw status table (quorum pill for mons, version,
  host). This is the honest **ControlPlane analog** for Ceph (K8s
  `ControlPlane.tsx` precedent) — a status table, not 6 metric tabs.

**SideMenu** (clone `Pages/Kubernetes/View/SideMenu.tsx` structure): Basic
(Overview/Insights/Documentation), Telemetry (Metrics/Logs), Resources (with
`badge={counts.x}` from the WI-6 summary endpoint), Activity (WI-11), Advanced
(Owners/Settings/Audit Logs/Delete with `danger-on-hover`). Layout fetches the
inventory summary once and passes counts down (`View/Layout.tsx` L44–55 pattern).

**Files:** ~14 new page files per product, 2 `View/Layout.tsx` + `View/SideMenu.tsx`,
3 promoted shared components, `Utils/PageMap.ts` / `RouteMap.ts` /
breadcrumbs additions (owner H per v1 ownership map).

### WI-8: Overview heroes (L per product)

**Pattern source:** `Pages/Kubernetes/View/Index.tsx` (2,946 lines): hero card with
connection + computed health badge (L1848–2079), `GoldenMetricTile` with
threshold-colored progress bars + `higherIsBetter` (L145–252), golden LineCharts
synced via `syncid`, health computation (Unhealthy if failed pods/notReady nodes;
Degraded if pending/pressure, L518–529), "Why is this cluster degraded?" clickable
drill-down (L2092+), Top-5 consumers (L541–638), per-section independent loaders
(no Promise.all gating, L1146–1156), refresh control with localStorage-persisted
auto-refresh. Network rates: `Utils/KubernetesNetworkUtils.ts` `computeNetworkRate`
(cumulative-counter deltas, clamp resets to 0, sum per bucket).

**Port the network helper:** extract `computeNetworkRate` to
`Utils/CounterRateUtils.ts` (shared); Proxmox uses it for
`pve_network_{receive,transmit}_bytes` and `pve_disk_{read,write}_bytes`; Ceph for
`ceph_pool_rd/wr/rd_bytes/wr_bytes`.

**Proxmox Overview computes:**
- Hero: connection badge; health badge — **Unhealthy** if any node `pve_up=0` or
  any HA resource in `error`/`fence` state; **Degraded** if any storage >85% used,
  any guest with `onboot=1` stopped, or `onlineNodeCount < nodeCount`.
- Quorum tile: "Quorum: 3/3 nodes online" — derived from `onlineNodeCount` vs
  `nodeCount` (pve-exporter exposes no corosync metric; do NOT invent one —
  document that this is node-visibility-derived, red when ≤ 50%).
- Golden tiles: Node availability %, Cluster CPU % (Σ `pve_cpu_usage_ratio ×
  pve_cpu_usage_limit` / Σ limit over node series — capacity-weighted), Memory %
  (Σ usage / Σ size), Storage % (worst storage), Guests running/total.
- Golden charts (synced): CPU %, Memory, Storage usage, Network throughput.
- HA state distribution chips (counts per `pve_ha_state` state label).
- Top-5 guests by CPU and by memory (from ProxmoxResource latest columns —
  Postgres, instant).
- "Why degraded?" drill-down: offline nodes, stopped onboot guests, error-state
  HA resources, >85% storages — each row links to the detail page.
- `CardModelDetail` footer + InfoCards (counts), `ResourceActivityCards`.

**Ceph Overview computes:**
- Hero: health pill OK/WARN/ERR from `healthStatus`; **health checks breakdown** —
  list active `ceph_health_detail` series (name + severity, e.g. `OSD_DOWN`,
  `PG_DEGRADED`) as the "why" drill-down. Add `ceph_health_detail` to the agent
  scrape allow-list expectation (mgr module exposes it on Quincy+; render
  gracefully when absent).
- Capacity tile + **projection**: used/total bar plus client-side linear fit of
  `ceph_cluster_total_used_bytes` over the selected range → "at current growth,
  85% (nearfull) in ~N days". Pure client math, K8s-style raw-fetch precedent.
- OSD matrix tile: up&in / up&out / down&in / down&out counts (client-side join
  of `ceph_osd_up` × `ceph_osd_in` latest values per daemon — same client-join
  approach as Host `View/Processes.tsx`).
- PG state distribution `StackedProgressBar`: active/clean vs degraded vs
  undersized vs other (`ceph_pg_active`, `ceph_pg_clean`, `ceph_pg_degraded`,
  `ceph_pg_undersized` against `ceph_pg_total`).
- Golden charts: capacity used, client IOPS (rate of Σ pool rd+wr), throughput
  (rate of rd_bytes+wr_bytes), average OSD apply/commit latency.
- Top-5 pools by stored bytes and by used % (stored/(stored+max_avail)).
- Mon quorum tile: in-quorum/total.

**Files:** `Pages/Proxmox/View/Index.tsx`, `Pages/Ceph/View/Index.tsx`,
`App/FeatureSet/Dashboard/src/Utils/CounterRateUtils.ts`, shared
`GoldenMetricTile` (extract from K8s Index.tsx into `Components/Infrastructure/`).

### WI-9: Alert templates to the K8s bar (M per product)

**Pattern source:** `Common/Types/Monitor/KubernetesAlertTemplates.ts` — shared
builders `buildKubernetesMonitorStep` / `buildOfflineCriteriaInstance` (CheckOn.
MetricValue, FilterCondition.Any, auto-resolve, changeMonitorStatus) /
`buildOnlineCriteriaInstance` / single-metric + ratio-with-formula configs
(`(num/den)*100`, `groupByAttributeKeys`); the Sum-vs-Avg contract documented at
L234–259 (same-receiver multi-series ratio ⇒ Sum/Sum; cross-receiver ⇒ Avg/Avg).
All Proxmox/Ceph ratios below are **same-receiver** (one prometheus scrape) ⇒
**Sum/Sum with groupBy**.

Create `ProxmoxAlertTemplates.ts` and `CephAlertTemplates.ts` mirroring the
builder structure (replacing the thinner v1 Docker-clone plan). Full v2 lists:

**Proxmox (9 templates):**
| id | Category/Severity | Metric & filter | Agg/Window | Fires / Recovers |
|---|---|---|---|---|
| pve-node-offline | Availability/Critical | `pve_up`, `pve.scope=node`, groupBy `id` | Min / Past5Min | <1 / ≥1 |
| pve-guest-down | Availability/Warning | `pve_up`, `pve.scope=guest`, groupBy `id` | Min / Past5Min | <1 / ≥1 |
| pve-quorum-risk | Availability/Critical | ratio Σ`pve_up`(node) ÷ count `pve_node_info` ×100 | Sum/Sum / Past5Min | ≤50 / >50 |
| pve-node-high-cpu | Node/Warning | `pve_cpu_usage_ratio`, `pve.scope=node`, groupBy `id` | Avg / Past5Min | >0.9 / ≤0.9 |
| pve-node-high-memory | Node/Warning | ratio `pve_memory_usage_bytes` ÷ `pve_memory_size_bytes` ×100, `pve.scope=node`, groupBy `id` | Sum/Sum / Past5Min | >85 / ≤85 |
| pve-guest-high-cpu | Guest/Warning | `pve_cpu_usage_ratio`, `pve.scope=guest`, groupBy `id` | Avg / Past5Min | >0.9 / ≤0.9 |
| pve-storage-near-full | Storage/Warning | ratio `pve_disk_usage_bytes` ÷ `pve_disk_size_bytes` ×100, `pve.scope=storage`, groupBy `id` | Sum/Sum / Past5Min | >85 / ≤85 |
| pve-lxc-disk-near-full | Storage/Warning | same ratio, `pve.type=lxc`, groupBy `id` (qemu excluded — disk usage needs guest agent) | Sum/Sum | >90 / ≤90 |
| pve-ha-state-error | HA/Critical | `pve_ha_state`, datapoint filter `state=error`, groupBy `id` | Max / Past5Min | >0 / =0 |

**Ceph (12 templates):**
| id | Category/Severity | Metric & filter | Agg/Window | Fires / Recovers |
|---|---|---|---|---|
| ceph-health-error | Cluster Health/Critical | `ceph_health_status` | Max / Past1Minute | ≥2 / <2 |
| ceph-health-warn | Cluster Health/Warning | `ceph_health_status` | Max / Past5Min | ≥1 / <1 |
| ceph-osd-down | OSD/Critical | `ceph_osd_up`, groupBy `ceph_daemon` | Min / Past5Min | <1 / ≥1 |
| ceph-osd-out | OSD/Warning | `ceph_osd_in`, groupBy `ceph_daemon` | Min / Past5Min | <1 / ≥1 |
| ceph-osd-high-latency | OSD/Warning | `ceph_osd_apply_latency_ms`, groupBy `ceph_daemon` | Avg / Past5Min | >100 / ≤100 |
| ceph-mon-quorum-degraded | Cluster Health/Critical | `ceph_mon_quorum_status`, groupBy `ceph_daemon` | Min / Past1Minute | <1 / ≥1 |
| ceph-pg-degraded | PG/Warning | `ceph_pg_degraded` | Max / Past5Min | >0 / =0 |
| ceph-pg-undersized | PG/Warning | `ceph_pg_undersized` | Max / Past5Min | >0 / =0 |
| ceph-pg-inactive | PG/Critical | formula `ceph_pg_total − ceph_pg_active` | Max−Max / Past5Min | >0 / =0 |
| ceph-cluster-near-full | Capacity/Warning | ratio `ceph_cluster_total_used_bytes` ÷ `ceph_cluster_total_bytes` ×100 | Sum/Sum / Past5Min | >85 / ≤85 |
| ceph-cluster-full | Capacity/Critical | same ratio | Sum/Sum / Past5Min | >95 / ≤95 |
| ceph-pool-near-full | Capacity/Warning | formula `stored/(stored+max_avail)×100` from `ceph_pool_stored`,`ceph_pool_max_avail`, groupBy `pool_id` | Sum/Sum / Past5Min | >85 / ≤85 |
| ceph-slow-ops | Cluster Health/Warning | `ceph_healthcheck_slow_ops` | Max / Past5Min | >0 / =0 |

(13 rows listed for Ceph including slow-ops; keep all.) Every template uses only
threshold/filter/ratio shapes the K8s builders already support — no new
capabilities. Expand `ProxmoxMetricCatalog.ts` / `CephMetricCatalog.ts` to cover
every metric referenced above with `{id, friendlyName, description, metricName,
category, defaultAggregation, defaultResourceScope, unit}` (K8s catalog shape,
27-entry precedent).

**Files:** `Common/Types/Monitor/ProxmoxAlertTemplates.ts`,
`CephAlertTemplates.ts`, `ProxmoxMetricCatalog.ts`, `CephMetricCatalog.ts`,
`Components/Form/Monitor/{Proxmox,Ceph}Monitor/*TemplatePicker.tsx`.

### WI-10: Monitor evaluation — affected-resource breakdown (M)

**Pattern source:** `App/FeatureSet/Workers/Jobs/TelemetryMonitor/
MonitorTelemetryMonitor.ts` `monitorKubernetes` (L1049–1358): always inject
`resource.k8s.cluster.name = clusterIdentifier` (L1101–1104); optional
resourceFilters; per-series in-process aggregation when groupBy present
(L1140–1162); affected-resources breakdown (L1194–1303) — fetch ≤100 newest raw
rows, extract identity labels, dedup keeping max value, render as the incident
root-cause markdown table (top 10 nonzero, worst-first) via
`MonitorCriteriaEvaluator` L1280+.

**Proxmox:** `monitorProxmox` injects `resource.proxmox.cluster.name = name`;
resourceFilters map node/guest/storage → `pve.scope` equality (+ `pve.id`).
Breakdown extracts `id`, `name`, `node`, `pve.scope` → table columns Resource /
Type / Node / Value. **Ceph:** `monitorCeph` injects `resource.ceph.cluster.name`;
breakdown extracts `ceph_daemon`, `pool_id`/`name`, `hostname` → Daemon / Pool /
Host / Value. Friendly metric names resolve through the WI-9 catalogs.

**Files:** `MonitorTelemetryMonitor.ts`,
`Common/Server/Utils/Monitor/MonitorCriteriaEvaluator.ts` (two render branches).

### WI-11: Activity wiring — incidents/alerts/maintenance per cluster (M)

**Pattern source:** `Alert.ts` has `hosts` (L588–607) and `dockerHosts` (L805)
ManyToMany; K8s SideMenu Activity section uses `CountModelSideMenuItem` with
`kubernetesClusters: new Includes([modelId])` + unresolved-state ids
(`View/SideMenu.tsx` L384–451); pages `Pages/Host/View/{Alerts,Incidents,
ScheduledMaintenance}.tsx` query the same key.

**Work:** add `proxmoxClusters` + `cephClusters` ManyToMany to `Alert`, `Incident`,
`ScheduledMaintenance` (+ join tables, + migration); Activity section in both
SideMenus with live badge counts; three tab pages per product; incident-creation
flows from WI-10 monitors stamp the cluster id.

**Files:** `Common/Models/DatabaseModels/{Alert,Incident,ScheduledMaintenance}.ts`,
migration, `Pages/{Proxmox,Ceph}/View/{Alerts,Incidents,ScheduledMaintenance}.tsx`,
both `View/SideMenu.tsx`.

---

## P2 — Operations & governance

### WI-12: Owner rules + label rules engines (M per product)

**Pattern source:** `KubernetesClusterLabelRule` / `KubernetesClusterOwnerRule`
models (matchers: labels any-overlap + case-insensitive name/description regex,
invalid regex → no-match + warn); engines run **once, on creation only**, from
`KubernetesClusterService.onCreateSuccess` (L28–55) — label engine first, syncs
in-memory labels so the owner engine can match rule-added labels; owner engine
dedups across rules by notify-flag and writes `OwnerUser/Team` rows with
`isOwnerNotified = !notify`. No retroactive re-application. Settings UIs:
`Pages/Kubernetes/Settings/{LabelRules,OwnerRules}.tsx` (3-step form).

**Work (×2 products):** models `ProxmoxClusterLabelRule`, `ProxmoxClusterOwnerRule`,
`ProxmoxClusterOwnerUser`, `ProxmoxClusterOwnerTeam` (the owner join models are
also the prerequisite for the Owners page and `useResourceOwners` facets — create
them here if v1 didn't), same four for Ceph; engine services
`ProxmoxClusterLabelRuleEngineService.ts` / `OwnerRuleEngineService.ts` (+ Ceph);
`onCreateSuccess` hooks; settings pages under `Pages/Proxmox/Settings/` and
`Pages/Ceph/Settings/`; SideMenu "Settings" collapsed section (Owner Rules, Label
Rules) on the product-level SideMenu (clone `Pages/Kubernetes/SideMenu.tsx`);
migration; permission blocks. Also port the `oneuptime.label.<name>` resource-attr
→ Label promotion (`promoteOneuptimeLabelsToCluster`, additive, fingerprint-cached
— `KubernetesClusterService.ts` L201–268) into both cluster services' maintenance
path, and document the attribute in both agent READMEs.

### WI-13: Insights pages (S per product)

**Pattern source:** `Pages/Kubernetes/View/Insights.tsx` (343 lines) — curated
`MetricView` presets sharing one time-range state; explicitly NOT computed
recommendations. **Proxmox sections:** Compute (node CPU ratio, node memory),
Guests (guest CPU, guest memory), Storage (usage + disk r/w rates), Network
(rx/tx rates via WI-8 helper). **Ceph sections:** Capacity (used bytes, per-pool
stored), Client I/O (IOPS, throughput), Latency (apply/commit per OSD), Data
Health (degraded/misplaced objects `ceph_num_objects_degraded` /
`ceph_num_objects_misplaced`, PG states).

**Files:** `Pages/Proxmox/View/Insights.tsx`, `Pages/Ceph/View/Insights.tsx`,
SideMenu entries.

### WI-14: Custom-dashboard widgets — triplet registration (M)

**Pattern source:** the three-place registration per kind: (1) type in
`Common/Types/Dashboard/DashboardComponents/` + `DashboardComponentType.ts` enum;
(2) util in `Common/Utils/Dashboard/Components/` building on
`DashboardKubernetesResourceListShared.ts`; (3) renderer in
`Components/Dashboard/Components/` over `DashboardKubernetesResourceListBase.tsx`
(Postgres `ModelAPI.getList` + list/honeycomb modes via
`DashboardKubernetesTileHelpers.ts`); wire-up in `DashboardView.tsx`,
`Toolbar/AddWidgetModal.tsx` category, optional template in
`DashboardTemplates.ts` (K8s template comments explain why snapshot-list widgets
beat Sum-of-gauge counts — same reasoning applies here).

**Scope (4 widgets, deliberately not 8):** `DashboardProxmoxNodeListComponent`,
`DashboardProxmoxGuestListComponent` (filters: clusters, guestType, status;
honeycomb colored by isUp/haState), `DashboardCephOsdListComponent` (honeycomb
colored by up/in — the classic OSD wall), `DashboardCephPoolListComponent` (list
with used% bars). All read WI-6 inventory via the shared list base — generalize
`DashboardKubernetesResourceListBase.tsx` to accept a model class rather than
cloning it. Add "Proxmox" and "Ceph" categories to `AddWidgetModal.tsx`. Add one
prebuilt template per product (`createProxmoxDashboardConfig`,
`createCephDashboardConfig`).

### WI-15: troubleshoot.sh analogs for both agents (M, shared core)

**Pattern source:** `HelmChart/Public/kubernetes-agent/troubleshoot.sh` (607
lines, 8 sections + VERDICT). Its crown jewel is the **definitive token check**:
OTLP endpoints deliberately return silent 200 on bad tokens, so it calls
`GET <url>/otlp/v1/validate` (real 200/401) with fallback to
`POST /fluentd/v1/logs` (400 on bad token). Both new scripts MUST reproduce this
— it explains the #1 support question ("pods healthy, still Disconnected").

`ProxmoxAgent/troubleshoot.sh` sections (docker-compose/systemd context, not kubectl):
1. **Runtime** — detect compose vs systemd install; service/container running.
2. **pve-exporter reachability** — curl `$PVE_EXPORTER_URL/metrics` (or `/pve`);
   verify `pve_up` series present; if zero series, diagnose PVE API auth
   (`PVE_API_TOKEN_ID`/`SECRET` set? exporter logs show 401? token privilege
   `PVEAuditor` hint).
3. **Cluster-name stamping** — `PROXMOX_CLUSTER_NAME` env set and non-empty;
   grep rendered collector config for the resource processor (a missing name is
   the exact analog of the K8s "no k8s.cluster.name ⇒ never connects" failure).
4. **Token shape** — `x-oneuptime-token` present, plausible length/charset.
5. **Collector health & self-metrics** — health endpoint; scrape success
   (`otelcol_receiver_accepted_metric_points` rising; prometheus receiver
   `up == 1` for the exporter target).
6. **Egress + definitive token check** — from inside the agent container (real
   network path): `GET $ONEUPTIME_URL/otlp/v1/validate`, fluentd fallback.
7. **Recent collector errors** — last 50 error-level lines.
8. **VERDICT** — pass/warn/fail rollup with the most likely cause.

`CephAgent/troubleshoot.sh`: same skeleton; section 2 becomes **mgr endpoints** —
curl every entry in `CEPH_MGR_ENDPOINTS`; detect the active-vs-standby trap
(standby mgr returns an empty body or redirect — warn loudly if NO endpoint
returns `ceph_health_status`, and if only one endpoint is configured, warn that
active-mgr failover will silently stop metrics); verify `honor_labels: true` in
the rendered config; section 3 checks `CEPH_CLUSTER_NAME`.

**Files:** `ProxmoxAgent/troubleshoot.sh`, `CephAgent/troubleshoot.sh`, README
sections, doc pages (`App/FeatureSet/Docs/Content/en/telemetry/{proxmox,ceph}.md`
— add a Troubleshooting section; pages must already be registered in
`App/FeatureSet/Docs/Utils/Nav.ts` per v1).

---

## P3 — Polish

### WI-16: Ceph cluster log page (S/M)

**Pattern source:** `Pages/Kubernetes/View/Events.tsx` — ClickHouse Log scan with
attribute filters, client-side parse, local Table with Type/Reason filters. Ceph
analog: the optional `filelog` receiver from WI-1 tails `/var/log/ceph/ceph.log`
(stamped with `ceph.cluster.name`); page `Pages/Ceph/View/ClusterLog.tsx` scans
24 h of logs, parses the ceph.log line format (timestamp, daemon, level
INF/WRN/ERR, message), filters on level. Render an info banner when no log rows
exist ("enable the filelog receiver in the agent" — ServiceMesh.tsx banner
precedent). **Proxmox task-log equivalent: rejected** (see below).

### WI-17: Host cross-link card on GuestDetail (M)

**Pattern source:** Host's "Linked Resources" card (`Pages/Host/View/Overview.tsx`
L1458–1523) and the `Host.dockerHostId`/`kubernetesClusterId` FKs (Host.ts
L772–896). Analog: add nullable `proxmoxClusterId` FK (SET NULL) to `Host.ts` +
migration. Auto-link heuristic at ingest enrichment: when a Host row's
`hostIdentifier` case-insensitively equals a ProxmoxResource guest `name` in the
same project, stamp the FK (best-effort, never overwrite a non-null value).
GuestDetail shows either the linked Host card (CPU/process depth lives there) or
an "Install the host agent inside this VM for process-level visibility" CTA
pointing at the Host docs. This — not a ProcessView clone — is the honest answer
to per-guest process depth (see Rejected list).

---

## Explicitly REJECTED K8s/Host features (considered, with reasons)

- **ProcessView / Processes tab for Proxmox guests** — pve-exporter exposes no
  per-guest process data (only cpu ratio, mem usage/size, net/disk counters,
  uptime, HA state); per-process depth requires an in-guest agent → WI-17 CTA
  instead.
- **YAML tab / `KubernetesYamlTab`** — no manifest-shaped object source; PVE/Ceph
  config would require API polling the agents don't do.
- **k8sobjects-style Events page for Proxmox** — PVE task log is API-only, not
  exposed by pve-exporter; an API-polling agent is out of scope for config-only
  agents. (Ceph gets WI-16 because ceph.log is a real file.)
- **ServiceMesh / eBPF page** — no analog data source.
- **6-tab ControlPlane page for Proxmox** — pve-exporter has no
  corosync/pmxcfs/pveproxy internals; the quorum-risk derivation in WI-8/WI-9 is
  the honest ceiling. (Ceph's analog ships as the WI-7 Daemons table.)
- **HPA/VPA-style Scaling section** — no autoscaling concept in either product.
- **Per-entity ClickHouse rollup MV (`MetricItemAggMV1mByHostV2` pattern)** —
  Host-only optimization justified by per-host query volume; cluster-scoped
  queries ride the existing primaryEntityId MV. Revisit only if Overview p95
  regresses.
- **Synthetic heartbeat metric (`oneuptime.host.heartbeat`)** — `pve_up` and
  `ceph_health_status` presence already provide availability signal per scrape.
- **Go infrastructure agent / `MonitorType.Server` track** — both products are
  OTel-collector-only by design (Path-A); the Monitor-keyed ingest path adds a
  second identity system for no benefit.
- **`provider` free-text column (K8s L376)** — nothing writes it on K8s either;
  `pveVersion`/`cephVersion` columns carry the equivalent value here.
- **Traces / Profiles / Performance tabs** — neither agent produces traces or
  profiles; empty tabs erode trust.
- **node-recently-rebooted alert template (`pve_uptime_seconds` < N)** — noisy on
  planned maintenance, low signal.
- **Retroactive label/owner rule re-application** — K8s deliberately runs rules
  on create only; keep parity, don't invent.

## Sequencing & dependency notes

- WI-1→WI-3 are prerequisites for WI-6 (the scan is shared) and WI-9 (filters
  need `pve.scope`). WI-6 gates WI-7, WI-14, and the Top-N sections of WI-8.
- WI-4, WI-5, WI-12 are independent — parallelize.
- Single-source-of-truth rule: once WI-6 lands, the WI-3 count columns are
  written from the inventory upsert buffer, never from a second code path
  (K8s badge-drift lesson, `View/Layout.tsx` L37–43).
- Everything stays under the worktree; compile/lint run as dedicated later
  stages per v1 process rules.
