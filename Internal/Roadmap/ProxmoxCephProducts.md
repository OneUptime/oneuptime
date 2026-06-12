# Proxmox & Ceph Monitoring Products — Implementation Spec (v1)

Two new first-class infrastructure monitoring products, built by cloning the Docker
product template (commit `98b4d0f796`, 51 files, +5,051 lines — run
`git show 98b4d0f796 --stat` and read individual file diffs with
`git show 98b4d0f796 -- <path>`). Where the live Docker code has evolved past that
commit (e.g. `Pages/Docker/View/` now has Owners/Incidents/Alerts tabs), prefer the
**current** file as the template. v1 scope = Docker-v1 parity per product.

## 1. Attribute conventions (we define these — no upstream semconv exists)

Stamped as OTLP **resource attributes** by our agent collector configs:

| Attribute | Required | Meaning |
|---|---|---|
| `proxmox.cluster.name` | yes | Join key. User-configured cluster identifier (defaults to PVE cluster name). Discovery + scoping key, analog of `k8s.cluster.name`. |
| `proxmox.node.name` | when node-scoped | PVE node hostname. |
| `proxmox.guest.vmid` / `proxmox.guest.name` / `proxmox.guest.type` (`qemu`\|`lxc`) | when guest-scoped | Present when a resource is guest-scoped (PVE 9 OTLP push path; pve-exporter keeps guest identity in datapoint labels like `id="qemu/100"`). |
| `ceph.cluster.name` | yes | Join key. User-configured (env `CEPH_CLUSTER_NAME`). |
| `ceph.cluster.fsid` | optional | Ceph cluster fsid when known. |

Guest/OSD/pool **identity in metric datapoint labels** (`id`, `ceph_daemon`, `pool`)
is queried via ClickHouse group-by on pages — same approach as Docker's Containers
page. Do not invent per-guest resources in v1 collector configs.

## 2. Entity layer (owner: agent A)

- `Common/Types/Telemetry/EntityType.ts`: add `ProxmoxCluster = "proxmox.cluster"`,
  `ProxmoxNode = "proxmox.node"`, `ProxmoxGuest = "proxmox.guest"`,
  `CephCluster = "ceph.cluster"`.
- `Common/Utils/Telemetry/EntityKey.ts`: add `keyForProxmoxCluster`, `keyForCephCluster`
  helpers mirroring `keyForKubernetesCluster`.
- `Common/Server/Utils/Telemetry/TelemetryEntity.ts`: resolvers — fire only when the
  identifying attributes are present: proxmox.cluster from `proxmox.cluster.name`;
  proxmox.node from cluster name + `proxmox.node.name`; proxmox.guest from cluster
  name + `proxmox.guest.vmid`; ceph.cluster from `ceph.cluster.name`.
- `Common/Utils/Telemetry/EntityRelationship.ts` RULES: `proxmox.node|proxmox.cluster`
  → MemberOf, `proxmox.guest|proxmox.node` → RunsOn, `proxmox.guest|proxmox.cluster`
  → MemberOf, `host|proxmox.cluster` → MemberOf (only if a comparable host|k8s rule
  exists — mirror precedent, don't invent).
- `Common/Server/Utils/Telemetry/EntityRegistry.ts`: per-type caps mirroring
  KubernetesCluster (cluster=10,000) and pod-like caps for node/guest.
- Mirror existing tests if any exist for K8s/Docker entity extraction.

## 3. Monitor layer (owner: agent B)

- `Common/Types/Monitor/MonitorType.ts`: add `Proxmox`, `Ceph` — title, description,
  category, and inclusion in the telemetry-monitor list, mirroring `Docker` exactly.
- New: `MonitorStepProxmoxMonitor.ts`, `MonitorStepCephMonitor.ts` (clone
  `MonitorStepDockerMonitor.ts`).
- `Common/Types/Monitor/MonitorStep.ts`: wire both (clone Docker wiring).
- New: `ProxmoxMetricCatalog.ts` (clone `DockerMetricCatalog.ts` shape). Metrics
  (pve-exporter names): `pve_up`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`,
  `pve_memory_usage_bytes`, `pve_memory_size_bytes`, `pve_disk_usage_bytes`,
  `pve_disk_size_bytes`, `pve_network_receive_bytes`, `pve_network_transmit_bytes`,
  `pve_uptime_seconds`, `pve_ha_state`, `pve_guest_info`, `pve_node_info`.
  Categories: Availability / Node / Guest / Storage / HA.
- New: `CephMetricCatalog.ts`. Metrics: `ceph_health_status`,
  `ceph_mon_quorum_status`, `ceph_osd_up`, `ceph_osd_in`,
  `ceph_cluster_total_bytes`, `ceph_cluster_total_used_bytes`, `ceph_pool_stored`,
  `ceph_pool_max_avail`, `ceph_pool_objects`, `ceph_pool_rd`, `ceph_pool_wr`,
  `ceph_pool_rd_bytes`, `ceph_pool_wr_bytes`, `ceph_pg_active`, `ceph_pg_degraded`,
  `ceph_pg_undersized`. Categories: Cluster Health / OSD / Pool / PG.
- New: `ProxmoxAlertTemplates.ts` (clone `DockerAlertTemplates.ts` shape), templates:
  node-offline (`pve_up` < 1 on node ids), guest-down, node-high-cpu
  (`pve_cpu_usage_ratio` > 0.9), high-memory, storage-near-full, ha-state-degraded,
  guest-high-cpu. Only use threshold/filter shapes that DockerAlertTemplates
  actually supports — do not invent new template capabilities.
- New: `CephAlertTemplates.ts`: health-warning (`ceph_health_status` >= 1),
  health-error (>= 2), osd-down (`ceph_osd_up` < 1), mon-quorum-degraded,
  pg-degraded (> 0), pg-undersized (> 0), pool-low-capacity (`ceph_pool_max_avail`
  below threshold).
- `Common/Server/Utils/Monitor/MonitorCriteriaEvaluator.ts`: routing for both types
  (clone Docker's +10-line diff).

## 4. Backend models/services (owner: agent C)

- New `Common/Models/DatabaseModels/ProxmoxCluster.ts` and `CephCluster.ts` — clone
  the **current** `DockerHost.ts` wholesale (decorators, permissions, billing access
  control `PlanType` gates, columns: name = the cluster join key, description,
  agentVersion, lastSeenAt-equivalents — whatever DockerHost has, renamed).
  Register in `Common/Models/DatabaseModels/Index.ts`.
- New `Common/Server/Services/ProxmoxClusterService.ts`, `CephClusterService.ts`
  (clone `DockerHostService.ts`); register in `Common/Server/Services/Index.ts`.
- `Common/Types/Permission.ts`: clone the Docker permission block for both products.
- Migration: hand-write `1781500000000-AddProxmoxAndCephClusterTables.ts` under
  `Common/Server/Infrastructure/Postgres/SchemaMigrations/` creating both tables —
  clone the SQL/QueryRunner style of `1781200000000-AddTelemetryEntityTable.ts`, and
  derive columns/indexes/FKs from what the DockerHost table migration (or the model
  decorators) imply. Register in `SchemaMigrations/Index.ts` (import + array).
- `App/FeatureSet/BaseAPI/Index.ts`: register both models (clone Docker's +12 diff).

## 5. Agents (owner: agent D)

`ProxmoxAgent/` and `CephAgent/` — clone the `DockerAgent/` file set: `README.md`,
`otel-collector-config.yaml`, `docker-compose.yml`, `install.sh`, `systemd/` unit.
No Go code; config-only.

- ProxmoxAgent: `prometheus` receiver scraping pve-exporter (`PVE_EXPORTER_URL` env;
  compose file includes an optional `prompve/prometheus-pve-exporter` container wired
  to `PVE_API_TOKEN_ID`/`PVE_API_TOKEN_SECRET`/`PVE_HOST` envs);
  `resource`/`attributes` processor stamping `proxmox.cluster.name` from
  `PROXMOX_CLUSTER_NAME` env; `otlphttp` exporter to `ONEUPTIME_URL/otlp` with
  `x-oneuptime-token: ONEUPTIME_TELEMETRY_INGESTION_KEY`. README also documents the
  PVE 9+ native OpenTelemetry metric-server push as a zero-install alternative for
  metrics (Datacenter → Metric Server), noting the agent path is what powers
  cluster discovery because it stamps `proxmox.cluster.name`.
- CephAgent: `prometheus` receiver scraping **all** ceph-mgr `/metrics` endpoints
  (`CEPH_MGR_ENDPOINTS` comma-separated env), `honor_labels: true`, 30s interval
  (README: never below 15s; scrape every mgr to survive active-mgr failover); stamp
  `ceph.cluster.name` from `CEPH_CLUSTER_NAME`. README notes Reef+ `ceph-exporter`
  per-host daemons and node_exporter pairing as optional extra scrape targets.

## 6. Ingest + worker wiring (owner: agent E, after A/B/C)

Clone Docker's diffs in: `App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts`
(discovery: resource carries `proxmox.cluster.name` → upsert ProxmoxCluster row,
same for Ceph; primary-entity routing), `OtelLogsIngestService.ts`,
`OtelMetricsIngestService.ts` (+6-line analogs),
`App/FeatureSet/Telemetry/API/ProbeIngest/Monitor.ts`, and
`App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts`
(`monitorProxmox()` + `monitorCeph()` cloned from `monitorDocker()`).

## 7. Dashboard UI (owners: F = Proxmox, G = Ceph — NEW files only; H = shared wiring)

Page sets (clone current `Pages/Docker/` equivalents):

- `Pages/Proxmox/`: `Clusters.tsx`, `Documentation.tsx`, `Layout.tsx`,
  `SideMenu.tsx`, `Utils/DocumentationMarkdown.ts`, `View/{Layout,SideMenu,Overview,
  Nodes,Guests,Storage,Metrics,Logs,Settings,Delete,Documentation}.tsx`.
  Nodes/Guests/Storage = ClickHouse metric group-by pages modeled on Docker's
  `View/Containers.tsx` (group `pve_*` series by `id` label: `node/...`, `qemu/...`,
  `lxc/...`, `storage/...`).
- `Pages/Ceph/`: `Clusters.tsx`, `Documentation.tsx`, `Layout.tsx`, `SideMenu.tsx`,
  `Utils/DocumentationMarkdown.ts`, `View/{Layout,SideMenu,Overview,Osds,Pools,
  Metrics,Logs,Settings,Delete,Documentation}.tsx`. Overview leads with health
  status (`ceph_health_status` 0/1/2 → OK/Warning/Error pill) + capacity; Osds/Pools
  group by `ceph_daemon` / `pool` labels.
- New `Routes/ProxmoxRoutes.tsx`, `Routes/CephRoutes.tsx` (clone `DockerRoutes.tsx`).
- New `Utils/Breadcrumbs/ProxmoxBreadcrumbs.ts`, `CephBreadcrumbs.ts`.
- New `Components/Proxmox/DocumentationCard.tsx`, `Components/Ceph/DocumentationCard.tsx`.
- New `Components/Form/Monitor/ProxmoxMonitor/{ProxmoxMonitorStepForm,
  ProxmoxMetricPicker,ProxmoxTemplatePicker}.tsx`, same for `CephMonitor/`.

**PageMap key contract (F/G/H must use these exact names; H defines them):**
`PROXMOX_CLUSTERS`, `PROXMOX_DOCUMENTATION`, `PROXMOX_CLUSTER_VIEW`,
`PROXMOX_CLUSTER_VIEW_NODES`, `PROXMOX_CLUSTER_VIEW_GUESTS`,
`PROXMOX_CLUSTER_VIEW_STORAGE`, `PROXMOX_CLUSTER_VIEW_METRICS`,
`PROXMOX_CLUSTER_VIEW_LOGS`, `PROXMOX_CLUSTER_VIEW_SETTINGS`,
`PROXMOX_CLUSTER_VIEW_DELETE`, `PROXMOX_CLUSTER_VIEW_DOCUMENTATION`;
`CEPH_CLUSTERS`, `CEPH_DOCUMENTATION`, `CEPH_CLUSTER_VIEW`,
`CEPH_CLUSTER_VIEW_OSDS`, `CEPH_CLUSTER_VIEW_POOLS`, `CEPH_CLUSTER_VIEW_METRICS`,
`CEPH_CLUSTER_VIEW_LOGS`, `CEPH_CLUSTER_VIEW_SETTINGS`, `CEPH_CLUSTER_VIEW_DELETE`,
`CEPH_CLUSTER_VIEW_DOCUMENTATION`.
URL segments mirror Docker (`docker/hosts` → `proxmox/clusters`, `ceph/clusters`).

**H owns (and ONLY H edits):** `App.tsx`, `Routes/AllRoutes.tsx`,
`Components/NavBar/NavBar.tsx`, `Utils/PageMap.ts`, `Utils/RouteMap.ts`,
`Utils/Breadcrumbs/index.ts`, `Components/Form/Monitor/MonitorStep.tsx`,
`Components/Form/Monitor/CriteriaFilter.tsx`, `CriteriaFilters.tsx`.

## 8. Docs (owner: agent D)

`App/FeatureSet/Docs/Content/en/telemetry/proxmox.md`, `ceph.md` (agent install +
PVE-9 native push / mgr-module scrape recipes), `monitor/proxmox-monitor.md`,
`monitor/ceph-monitor.md` (clone docker equivalents); register all four in
`App/FeatureSet/Docs/Utils/Nav.ts` (pages 404 without registration).

## 9. Process rules (all agents)

- Work ONLY under `/Users/nawazdhandala/Projects/OneUptime/oneuptime/.claude/worktrees/proxmox-ceph`.
  NEVER edit files under the main repo root directly.
- Respect the file-ownership map; if you need a change in a file you don't own,
  put it in your final report instead of editing.
- All imports at top of file; don't worry about circular dependencies (AGENTS.md).
- Clone the Docker template faithfully — naming, decorators, comment density. When
  the v1 commit and current code disagree, follow current code.
- Compile (`npm run compile` in Common / App / App/FeatureSet/Dashboard) and lint
  (`npm run fix`) run as dedicated later stages — do not run them yourself.
