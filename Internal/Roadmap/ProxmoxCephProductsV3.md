# Proxmox & Ceph Products — V3: The World-Class Bar

Builds on `Internal/Roadmap/ProxmoxCephProducts.md` (v1, Docker parity — committed)
and `Internal/Roadmap/ProxmoxCephProductsV2.md` (v2, Kubernetes/Host bar — in
flight on this worktree: ~100 modified + ~50 untracked files at time of writing).
V3 is the gap between "K8s-bar parity" and **the best Proxmox/Ceph monitoring
product on the market**, benchmarked against Datadog's Proxmox integration
(GA July 2025, v2.2+), PRTG's four PVE sensors, Pulse (~5.9k stars), Checkmk's
`proxmox_ve` agent, Zabbix's official template, the upstream Ceph Dashboard
(Reef/Squid), and ceph-mixin (~85 alert rules, 19 dashboards).

Hard rule carried from v1/v2: **no invented metrics.** Every metric named below
is verified — either already flowing through our agents (both scrape with
pve-exporter `cluster=1&node=1`, see `ProxmoxAgent/otel-collector-config.yaml`
L21–22) or confirmed in pve-exporter / ceph-mgr source per the June 2026
benchmark briefs. Anything requiring the PVE/PBS/Ceph APIs directly is honestly
deferred to a v4 API-agent track, with the deferral stated inline.

Effort tags: S = <½ day, M = 1–2 days, L = 3+ days.

---

## 1. What "world-class" means (the measurable bar)

A claim we can demo, not a vibe. V3 is done when every line below is true:

1. **TTFV ≤ 10 minutes**, measured signup → green "Connected" pill, with no
   page refresh: empty-state `DocumentationCard` → create ingestion key inline
   (shipped, v1) → paste ONE env-prefixed command (shipped, v2 — see
   `Pages/Proxmox/Utils/DocumentationMarkdown.ts` L34 `ONEUPTIME_URL=${...}`)
   → mint the PVE token with a copy-paste `pveum` two-liner instead of 4 UI
   clicks (V3, WI-18) → the list page polls and flips to the table on first
   data without a hard refresh (V3, WI-18). The Kubernetes gold path is ~4
   steps and *doesn't* have the live flip (`Pages/Kubernetes/Clusters.tsx`
   L91–109 is a one-shot count) — we exceed the internal bar, not just match it.
2. **Feature parity-or-better, verifiably:** every row in the gap table (§2)
   is either ✅ or has a numbered work item or an explicit v4 deferral. Concrete
   targets: ≥ Datadog's metric/dashboard/monitor surface (they ship 4 monitors;
   we ship 10 Proxmox templates after WI-24), Pulse's backup-coverage view at
   the fidelity pve-exporter supports (WI-24), and ~21 Ceph alert templates
   covering every ceph-mixin rule the mgr/prometheus module's metrics can
   express (WI-26) — with the inexpressible ones listed, not ignored.
3. **Zero dead-end states:** every tab, page, and empty list renders a next
   action. Known dead end today: the Proxmox Logs tab (v2 WI-5 wires it; the
   agent ships no log receiver) — fixed by WI-27. Ceph `ceph_health_detail`
   absence already renders gracefully (v2 WI-8 contract).
4. **Tested:** alert templates, snapshot scan, inventory upsert, and monitor
   routing have unit tests (WI-20/21); the product has the repo's first
   non-skipped-pattern E2E specs for onboarding (WI-22).
5. **Discoverable:** `/product/proxmox` and `/product/ceph` landing pages, nav
   + footer + features-table presence, README feature section, localized navbar
   strings, launch blog post per repo convention (WI-19, WI-30–33).

---

## 2. Competitive gap table

Legend: ✅ v1/v2 = covered by committed v1 or in-flight v2 · **V3** = work item
below · *v4* = honestly deferred (requires API agent / other exporter).

### Proxmox — vs Datadog (DD), PRTG, Pulse, Checkmk (CMK), Zabbix (ZBX)

| Feature | DD | PRTG | Pulse | CMK | ZBX | OneUptime |
|---|---|---|---|---|---|---|
| Auto-discover cluster from first data | manual | meta-scan | LAN scan | manual | manual | ✅ v1 (OTLP upsert) |
| Single agent covers whole cluster | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ v1 (exporter `cluster=1&node=1`) |
| Node/guest/storage up + CPU/mem/disk/net perf | ✅ (~34 metrics) | ✅ | ✅ | ✅ | ✅ | ✅ v1/v2 (pve_* catalog) |
| Inventory list pages, status pills, CPU/mem bars | hosts list | sensor tree | ✅ wall | ✅ | ✅ | ✅ v2 WI-6/7 |
| At-a-glance honeycomb/wall widget | ✗ | ✗ | ✅ (hallmark) | ✗ | ✗ | ✅ v2 WI-14 |
| Out-of-box overview dashboard | ✅ | per-sensor | ✅ | ✅ | ✅ | ✅ v2 WI-8 hero + WI-14 template |
| Shipped alert/monitor templates | 4 | channel limits | defaults | rule packs | triggers | ✅ v2: 9 → **V3: 11** (WI-24/25) |
| Quorum / cluster-health alert | ha.quorate metric | ✅ quorum channel | ✅ | ✅ pvecm | ✅ | ✅ v2 (pve-quorum-risk; node-visibility-derived, documented) |
| HA resource state monitoring | ✅ 2.0.0 | ✗ | ✅ | ✗ | ✗ | ✅ v2 (pve_ha_state template + chips) |
| **Backup coverage ("which guests have no backup job")** | ✗ | ✗ | ✅ (killer feature) | partial | ✗ | **V3 WI-24** (`pve_not_backed_up_total/_info` — verified) |
| Per-guest backup age / success / size / bandwidth | ✗ | ✗ | ✅ (PBS+vzdump) | ✅ (task-log parse) | ✗ | *v4 — requires PVE/PBS API; pve-exporter has no last-backup metric (verified)* |
| Snapshot age / snapshot trees | ✗ | ✗ | ✅ | ✅ | ✗ | *v4 — API-only, no exporter metric* |
| **Storage replication health** | ✗ (confirmed gap) | ✗ | ✗ | ✗ | ✗ | **V3 WI-25** (`pve_replication_*` — verified, default-on) |
| PVE task events (migrate, vzdump, apt…) | ✅ 15 types (no vzdump) | ✗ | ✗ | via logs | ✗ | *v4 — task log is API-only (v2 rejected-list)* |
| PVE service logs (pveproxy, pvedaemon, HA…) | journald recipe | ✗ | ✗ | ✗ | ✗ | **V3 WI-27** (journald receiver recipe + empty-tab banner) |
| Resource include/exclude filtering | ✅ regex | ✗ | ✅ | rules | macros | ✅ v2 WI-10 (scope/id equality filters) |
| Guest ↔ in-guest host agent merge | ✅ external tags | ✗ | agents | piggyback | ✗ | ✅ v2 WI-17 (Host FK cross-link + CTA) |
| PBS server monitoring | ✗ | ✗ | ✅ | ✗ | ✗ | *v4 — PBS API/pbs_exporter track* |
| Ceph awareness from the PVE product | ✗ (no Ceph metrics) | ✅ status channel | ✗ | ✗ | ✗ | **V3 WI-28** (link to a full Ceph product — beats a single channel) |
| Setup-friction killers (token snippet, validate endpoint, troubleshooter) | ✗ (top complaint) | ✗ | ✅ | ✗ | ✗ | ✅ v2 (troubleshoot.sh + `/otlp/v1/validate`) + **V3 WI-18** (`pveum` two-liner, live flip) |
| Per-host pricing pain | ~$15–23/host/mo | per-sensor | free | licensed | free | flat project pricing — marketing angle (WI-31) |

### Ceph — vs upstream Dashboard (Reef/Squid) + ceph-mixin

| Feature | Upstream | ceph-mixin | OneUptime |
|---|---|---|---|
| Health pill + "why" breakdown | ✅ | 2 rules | ✅ v2 WI-8 (`ceph_health_status` + `ceph_health_detail` drill-down) |
| Capacity gauge with nearfull/full thresholds | ✅ double-doughnut | ✅ | ✅ v2 (tile; fixed 85/95 defaults documented) |
| Capacity forecasting | ✗ (operator gripe) | ✅ predict_linear alerts | ✅ v2 UI fit + **V3 WI-29** (per-pool/storage) · *alerting on forecast = v4* |
| OSD up/in matrix + honeycomb | ✅ | ✅ | ✅ v2 WI-8/14 |
| PG state breakdown | ✅ | ✅ | ✅ v2 (`ceph_pg_active/clean/degraded/undersized/total`) |
| Pool list: used%, IOPS, throughput | ✅ | ✅ | ✅ v2 WI-7 |
| Mon quorum + clock skew | ✅ | ✅ | ✅ v2 quorum · **V3 WI-26** clock skew (health_detail) |
| Daemon crash detection | ✅ | ✅ (RECENT_CRASH) | **V3 WI-26** (`ceph_health_detail{name="RECENT_CRASH"}` — verified: no `ceph_crash_*` metric exists) |
| Slow ops (cluster + per-daemon) | ✅ | ✅ both | ✅ v2 cluster · **V3 WI-26** per-daemon (`ceph_daemon_health_metrics{type="SLOW_OPS"}`) |
| OSD network/heartbeat issues | ✅ | ✅ (health checks) | **V3 WI-26** (`OSD_SLOW_PING_TIME_FRONT/BACK` via health_detail — verified: no ping-time gauge exists) |
| Scrub staleness alerts | ✅ | ✅ | **V3 verify-then-add** (§3.9 — metric name unverified) |
| OSD nearfull/full/backfillfull, mon disk space | ✅ | ✅ | **V3 WI-26** (health_detail names) |
| PG imbalance, hardware/SMART, NVMe-oF, RBD-mirror, cephadm rules | ✗/✅ | ✅ (~40 rules) | *v4 / rejected — need cross-series math, SMART data, or ceph-exporter (mixin counts inflated by these)* |
| Recovery throughput as first-class series | ✅ | ✅ | **V3 verify-then-add** (§3.9) |
| RGW / CephFS deep views | ✅ (S3 analytics, Squid) | ✅ 5 dashboards | *v4 — per-daemon perf counters moved to ceph-exporter since Reef (verified)* |
| Multi-cluster fleet view | only in Tentacle | ✅ 1 dashboard | ✅ v1 — the Clusters list page with health pills/capacity bars IS a fleet view (marketing angle, WI-31) |
| Cluster log viewer | ✅ | n/a | ✅ v2 WI-16 (filelog → ClusterLog page) |
| Works without bolting on Grafana/Alertmanager | ✗ (iframes, top gripe) | requires stack | ✅ by construction — lead marketing angle (WI-31) |

---

## 3. V3 work items (prioritized)

Numbering continues from v2 (WI-1…WI-17).

### P0 — Launch blockers (ship immediately after v2 merges, before announcement)

#### WI-18: TTFV finishers — `pveum` two-liner + live first-data flip (S)

The v2 worktree already shipped the env-prefixed one-liner and troubleshoot
docs (verified: `Pages/Proxmox/Utils/DocumentationMarkdown.ts` L21–34, L249).
Two finishers remain from the product-quality audit:

1. **`pveum` snippet.** The docs currently walk 4 Proxmox-UI clicks to mint a
   PVEAuditor token — Datadog's #1 forum complaint is exactly this ceremony
   (403 `Permission check failed (/, Sys.Audit)` threads). Add a "or run this
   on any PVE node" alternative above the UI steps:
   `pveum user token add monitoring@pam oneuptime --privsep 1` +
   `pveum acl modify / --roles PVEAuditor --tokens 'monitoring@pam!oneuptime'`
   with a one-line explanation of why the ACL must be at `/` root. Ceph is
   already a one-liner (`ceph mgr module enable prometheus`) — no change.
   Also add a short **agent placement** note (run the agent on a host that
   survives node failure, or point `PVE_HOST` at a VIP — Datadog ships
   Agent-HA failover; this is our honest answer).
2. **Live first-data poll.** `Pages/Proxmox/Clusters.tsx` (and Ceph twin) does
   a one-shot `ModelAPI.count` on mount (verified L41–45) — same as K8s
   (`Pages/Kubernetes/Clusters.tsx` L91–109), so the user pastes the command
   and must hard-refresh to see Connected. While `count === 0`, re-count every
   10 s (clear on unmount, stop on first nonzero) and flip empty-state → table.
   This *exceeds* the K8s bar; optionally back-port to K8s/Docker/Host as a
   separate follow-up (do not bundle — keep v3 diff product-scoped).

**Files:** `App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown.ts`,
`Pages/Ceph/Utils/DocumentationMarkdown.ts` (placement note n/a, key steps audit),
`Pages/Proxmox/Clusters.tsx`, `Pages/Ceph/Clusters.tsx`,
`App/FeatureSet/Docs/Content/en/telemetry/proxmox.md`.

#### WI-19: i18n — the 4 missing navbar keys × 16 locales (S)

Bug-level gap (verified still present): `NavBar.tsx` L210+ calls
`t("navbar.items.proxmoxTitle", "Proxmox")` etc., but `proxmoxTitle`,
`proxmoxDescription`, `cephTitle`, `cephDescription` are absent from
`App/FeatureSet/Dashboard/src/Locales/en.json` (K8s/Docker precedent at L73–76)
and the 15 other locale files (`da de es fr hi it ja ko nl no pt ru sv zh-CN
zh-TW`). Non-English users currently see English nav items. Add all 4 keys to
all 16 files ("Proxmox"/"Ceph" stay as-is; descriptions translated). Page-body
hardcoded English is K8s/Docker parity — out of scope.

**Files:** `App/FeatureSet/Dashboard/src/Locales/*.json` (16 files).

#### WI-20: Alert-template unit tests (S/M)

The one real test-parity miss: `Common/Tests/Types/Monitor/KubernetesAlertTemplates.test.ts`
exists; the 9 Proxmox + 13 Ceph templates (verified counts in the worktree's
`Common/Types/Monitor/ProxmoxAlertTemplates.ts` / `CephAlertTemplates.ts`) have
none. Clone the K8s test shape: every template builds a valid MonitorStep;
template ids unique; every referenced metric exists in the matching
`*MetricCatalog.ts`; fire/recover thresholds are disjoint and on the same
metric/aggregation; ratio templates use Sum/Sum with `groupByAttributeKeys`
per the documented same-receiver contract; `pve.scope`/datapoint filters
present where the spec table requires them. Extend the same file when
WI-24/25/26 add templates (write the tests so new templates are enumerated,
not hand-listed).

**Files:** `Common/Tests/Types/Monitor/ProxmoxAlertTemplates.test.ts`,
`Common/Tests/Types/Monitor/CephAlertTemplates.test.ts`.

#### WI-21: Unit tests — snapshot scan, inventory upsert, monitor mapping (M)

None of these v2 surfaces are tested (K8s/Docker aren't either — the bar is
"world-class", not parity):

- **Snapshot scan fold:** synthetic OTLP batches through the WI-3 scan —
  counts derived correctly (`nodeCount`/`onlineNodeCount`/`osdUpCount`/
  `healthStatus`/`capacityUsedPercent`); a partial batch never zeroes a count
  (COALESCE-per-column semantics); non-allow-listed metrics are skipped. May
  require extracting the pure fold/derive helpers from
  `App/FeatureSet/Telemetry/Services/OtelMetricsIngestService.ts` into an
  exported testable unit — a refactor-for-testability, no behavior change.
- **Inventory buffer semantics:** ProxmoxResource/CephResource fold — newer
  `observedAt` wins, first-non-null wins for labels, `lastSeenAt` dominance,
  qemu guests without guest agent get NULL disk (never 0).
- **Monitor mapping:** `monitorProxmox`/`monitorCeph` inject
  `resource.proxmox.cluster.name`/`resource.ceph.cluster.name`; resourceFilters
  map to `pve.scope`/`pve.id` equality; `MonitorCriteriaEvaluator` breakdown
  branches render the Resource/Type/Node/Value and Daemon/Pool/Host/Value
  tables (top-10 nonzero, worst-first).

**Files:** `Common/Tests/Server/Utils/Telemetry/ProxmoxCephSnapshotScan.test.ts`
(or co-located per existing layout), `Common/Tests/Server/Services/
{Proxmox,Ceph}ResourceService.test.ts`, `Common/Tests/Server/Utils/Monitor/
MonitorCriteriaEvaluator.test.ts` (extend), plus the export refactor in
`OtelMetricsIngestService.ts`.

#### WI-22: E2E specs — onboarding path (M)

Repo-wide there is zero product E2E coverage (13 specs, both Dashboard specs
`test.describe.skip`'d). Clone the `E2E/Tests/Dashboard/CreateMonitor.spec.ts`
pattern (register → `selectProjectPlan` from `E2E/Tests/Helpers/
selectProjectPlan.ts` → navigate via `getByTestId`):

- `ProxmoxProduct.spec.ts` / `CephProduct.spec.ts`: assert the empty-state
  `DocumentationCard` renders; the inline "New Key" `ModelFormModal` creates a
  telemetry ingestion key and it appears in the dropdown; install command block
  contains the interpolated URL/key/cluster-name.
- **Stretch (separate test):** POST a minimal OTLP metrics fixture to
  `/otlp/v1/metrics` with `x-oneuptime-token` via plain `fetch` in-spec (no
  existing pattern — keep it self-contained), then assert the list flips to
  Connected (exercises WI-18's poll). Follow the repo's existing skip-gating
  convention so CI behavior matches the other Dashboard specs.

**Files:** `E2E/Tests/Dashboard/ProxmoxProduct.spec.ts`,
`E2E/Tests/Dashboard/CephProduct.spec.ts`.

#### WI-23: MCP exposure — verification only (S)

No work expected: both generator copies (`App/FeatureSet/MCP/Tools/
ToolGenerator.ts` L61 and `MCP/Services/SelectFieldGenerator.ts` L103) iterate
`Common/Models/DatabaseModels/Index.ts`, and v1/v2 register
ProxmoxCluster/CephCluster/ProxmoxResource/CephResource (+ rule/owner models)
there. V3 task = a checklist assertion that every new v2/v3 model is in
`Index.ts` and tool generation includes it (smoke-run the generator), nothing
more. Flag if any model was intentionally excluded.

### P1 — Differentiators (the "world-class" features)

#### WI-24: Backup coverage — the Pulse answer, at exporter fidelity (M)

The single most-loved Pulse feature is "which guests have no recent backup?".
pve-exporter cannot answer *recency* (verified: there are **no** `pve_backup_*`
metrics), but its default-enabled cluster-level `backup-info` collector exposes
exactly two metrics, already flowing through our agent today (we scrape with
`cluster=1`):

- `pve_not_backed_up_total` — count of guests not covered by **any** backup job
- `pve_not_backed_up_info` — present per uncovered guest, labeled only `['id']`

Work:
1. **Snapshot scan:** add both names to `PVE_SNAPSHOT_METRIC_NAMES`; new
   `ProxmoxCluster.guestsWithoutBackupCount` column (migration via
   `npm run generate-postgres-migration` + register in `SchemaMigrations/Index.ts`)
   written from `pve_not_backed_up_total` on the WI-3 extras path; new
   `ProxmoxResource.isBackedUp` boolean derived per guest — covered when no
   `pve_not_backed_up_info` series carries its id in a batch that contains the
   backup-info series at all (same never-zero-on-partial-batch guard).
   ⚠️ Implementation gate: confirm the `id` label format from a live exporter
   (`qemu/100` vs bare vmid) before keying the join to `externalId`; the brief
   verifies the label set, not the value format.
2. **UI:** "Backup coverage" `GoldenMetricTile` on the Proxmox Overview hero
   ("18 of 20 guests in a backup job", red when uncovered > 0, wired into the
   "Why degraded?" drill-down with per-guest rows); "Backup" column on
   `Guests.tsx` (green "In job" / red "Not backed up" badge).
3. **Alert template #10:** `pve-guest-not-backed-up` — Backup/Warning,
   `pve_not_backed_up_total`, Max / Past5Min, fires > 0 / recovers = 0
   (cluster-scope; per-guest naming comes from the breakdown table via
   `pve_not_backed_up_info` groupBy `id`). Catalog entries for both metrics.
4. **Honest boundary, stated in docs and UI tooltip:** "covered by a job" ≠
   "backed up recently and successfully". Freshness/success/size/verification
   require the PVE vzdump task log or PBS API (Checkmk parses task logs
   *because* "Proxmox does not provide backup status directly"; Pulse calls
   both APIs). That is the **v4 API-agent track** — do not fake it with
   invented metrics. The tile copy says "backup job coverage", never "backups
   healthy".

**Files:** `OtelMetricsIngestService.ts`, `Common/Models/DatabaseModels/
{ProxmoxCluster,ProxmoxResource}.ts` + migration, `Common/Server/Services/
ProxmoxClusterService.ts`/`ProxmoxResourceService.ts`,
`Pages/Proxmox/View/Index.tsx`, `Pages/Proxmox/View/Guests.tsx`,
`Common/Types/Monitor/{ProxmoxAlertTemplates,ProxmoxMetricCatalog}.ts`,
docs page.

#### WI-25: Replication health — first SaaS mover (M)

Datadog's brief confirms "no replication metrics"; PRTG/Zabbix/Pulse have none
either. pve-exporter's node-level `replication` collector is **default-on**
and our agent already scrapes `node=1`, so these are flowing today (all
verified from exporter source, labeled `id`; `pve_replication_info` adds
`type,source,target,guest`):

`pve_replication_last_sync_timestamp_seconds`, `pve_replication_last_try_timestamp_seconds`,
`pve_replication_next_sync_timestamp_seconds`, `pve_replication_duration_seconds`,
`pve_replication_failed_syncs`, `pve_replication_info`.

Work:
1. **Alert template #11:** `pve-replication-failing` — Replication/Critical,
   `pve_replication_failed_syncs`, groupBy `id`, Max / Past5Min, fires > 0 /
   recovers = 0. (A *staleness* alert — `now − last_sync` — is **not
   expressible** in the criteria engine: there is no wall-clock function over
   metric values. Do not fake it; staleness is UI-only below. Revisit if the
   engine ever grows derived/now()-based expressions — v4.)
2. **UI:** "Replication" card on the Proxmox Overview (rendered only when
   `pve_replication_info` series exist — zero-state honest): table of job id,
   guest (joined to inventory name via `guest` label), source → target, last
   sync age (client-side `now − last_sync_timestamp`, amber > 1 h, red > 6 h —
   fixed documented thresholds since the job schedule isn't exported), last
   duration, failed-sync count (red > 0). Failed rows feed "Why degraded?".
3. Catalog entries for all six metrics; Insights "Replication" section
   (duration + failed_syncs over time).

**Files:** `Pages/Proxmox/View/Index.tsx`, `Pages/Proxmox/View/Insights.tsx`,
`Common/Types/Monitor/{ProxmoxAlertTemplates,ProxmoxMetricCatalog}.ts`.

#### WI-26: Ceph alert depth — 13 → ~21 templates via health checks (M)

ceph-mixin has ~85 rules, but a large share need data the mgr/prometheus
module does not export (verified gaps: no `ceph_crash_*` metric, no
heartbeat-ping gauges, no SMART, per-daemon perf counters moved to the
separate ceph-exporter since Reef). What the mgr module *does* verifiably
export is `ceph_health_detail{name,severity}` (one series per **active**
health check) and `ceph_daemon_health_metrics{type,ceph_daemon}`. Both are
equality-filterable on datapoint labels — the exact shape v2's
`pve-ha-state-error` template already uses, so **no new engine capability**.

Add 8 templates to `CephAlertTemplates.ts` (all fire Max > 0 / recover = 0,
Past5Min unless noted; severity per mixin):

| id | Severity | Filter |
|---|---|---|
| ceph-pg-damaged | Critical | `ceph_health_detail` where `name=PG_DAMAGED` OR `name=OSD_SCRUB_ERRORS` (two filters, FilterCondition.Any) |
| ceph-daemon-crash | Critical | `name=RECENT_CRASH` (the only crash signal that exists — document) |
| ceph-osd-slow-heartbeats | Warning | `name=OSD_SLOW_PING_TIME_FRONT` OR `name=OSD_SLOW_PING_TIME_BACK` |
| ceph-mon-clock-skew | Warning | `name=MON_CLOCK_SKEW` |
| ceph-osd-nearfull | Warning | `name=OSD_NEARFULL` |
| ceph-osd-full | Critical (Past1Minute) | `name=OSD_FULL` |
| ceph-mon-disk-space | Warning + Critical criteria | `name=MON_DISK_LOW` (warn) / `name=MON_DISK_CRIT` (crit) in one template |
| ceph-daemon-slow-ops | Warning | `ceph_daemon_health_metrics` where `type=SLOW_OPS`, groupBy `ceph_daemon` (per-daemon complement to v2's cluster-level `ceph-slow-ops`) |

Semantics note to encode in descriptions: health-detail series exist **only
while the check is active** (Quincy+); absence = healthy, so Max>0/=0 with
auto-resolve is correct and quiet by default.

Explicitly NOT added, with reasons (mirror the v2 rejected-list discipline):
PG-imbalance (cross-series stddev vs average — unsupported math);
predict_linear capacity-forecast alerts (no server-side derived metrics — UI
forecast only, v4 if the engine grows it); hardware/SMART and device-failure
prediction (no mgr metric — verified); NVMe-oF / RBD-mirror / cephadm groups
(different exporters); scrub staleness → §3.9 verify-then-add.

Update `CephMetricCatalog.ts` (+`ceph_health_detail`,
`ceph_daemon_health_metrics`), the TemplatePicker, WI-20 tests pick the new
rows up automatically.

**Files:** `Common/Types/Monitor/{CephAlertTemplates,CephMetricCatalog}.ts`,
`Components/Form/Monitor/CephMonitor/*TemplatePicker.tsx`.

#### WI-27: Proxmox logs path — kill the empty Logs tab (S/M)

v2 WI-5 wires a Logs tab for Proxmox, but the agent ships no log receiver →
guaranteed dead-end state. Datadog's recipe proves the demand (journald units
pveproxy, pvedaemon, pve-firewall, pve-ha-crm, pve-ha-lrm, pvescheduler,
pvestatd, qmeventd).

1. **Agent:** commented-out `journald` receiver block in
   `ProxmoxAgent/otel-collector-config.yaml` targeting those 8 units, wired to
   a commented logs pipeline (mirror of the Ceph filelog block at
   `CephAgent/otel-collector-config.yaml` L41/L95–98, which v2 already
   shipped). Caveats to document honestly: requires the collector to run on
   the PVE node with `/var/log/journal` mounted and a `journalctl` binary in
   the image — verify the contrib image at implementation; if absent, document
   the filelog-on-`/var/log/syslog` fallback instead of shipping a broken block.
2. **UI:** info banner on `Pages/Proxmox/View/Logs.tsx` when the range returns
   0 rows — "The Proxmox agent ships no logs by default. Enable the journald
   receiver →" linking the docs anchor (ServiceMesh.tsx banner precedent, same
   as v2 WI-16's ClusterLog banner). Add the twin banner to
   `Pages/Ceph/View/Logs.tsx` pointing at the filelog block.
3. Docs section in `telemetry/proxmox.md`.

**Files:** `ProxmoxAgent/otel-collector-config.yaml`, `ProxmoxAgent/README.md`,
`Pages/Proxmox/View/Logs.tsx`, `Pages/Ceph/View/Logs.tsx`,
`App/FeatureSet/Docs/Content/en/telemetry/proxmox.md`.

#### WI-28: Hyperconverged PVE ↔ Ceph cross-link (M)

Most serious Proxmox clusters run Ceph; PRTG's only Ceph story is one status
channel inside its PVE sensor. We have a full Ceph product — link them:

- Nullable `cephClusterId` FK (SET NULL on delete) on `ProxmoxCluster` +
  migration. **Manual link only** via a dropdown on
  `Pages/Proxmox/View/Settings.tsx` — pve-exporter exposes no fsid, so there
  is no honest auto-link heuristic; do not invent one (contrast: WI-17's
  host link had a name-equality signal).
- Proxmox Overview hero gains a "Ceph storage" card when linked: health pill +
  capacity bar straight from the linked `CephCluster` snapshot columns
  (`healthStatus`, `capacityUsedPercent` — Postgres, instant), deep-linking to
  the Ceph cluster Overview. Reciprocal "Runs on Proxmox cluster X" card on
  the Ceph Overview (reverse lookup).
- Degraded Ceph health does NOT change the Proxmox health badge (separate
  products, separate alerting) — card-level red only; document the decision.

**Files:** `Common/Models/DatabaseModels/ProxmoxCluster.ts` + migration,
`Pages/Proxmox/View/{Settings,Index}.tsx`, `Pages/Ceph/View/Index.tsx`.

#### WI-29: Forecast depth — storage & pool growth projections (S)

Reuse v2 WI-8's client-side linear fit (Ceph cluster capacity → "85% in ~N
days") in two more places, closing the "long-horizon capacity" gripe operators
have with the upstream dashboard: `StorageDetail.tsx` — fit
`pve_disk_usage_bytes` over the selected range, render "at current growth,
full in ~N days" when slope > 0 (hide otherwise); `PoolDetail.tsx` — same fit
on `ceph_pool_stored` against `stored + max_avail` (the mixin
CephPoolGrowthWarning analog, UI-only). Pure client math on already-fetched
series; no new metrics, no alerting (v4).

**Files:** `Pages/Proxmox/View/StorageDetail.tsx`,
`Pages/Ceph/View/PoolDetail.tsx`, shared fit helper next to
`Utils/CounterRateUtils.ts`.

### P2 — Discoverability & launch

#### WI-30: Trademark-safe iconography (S)

`IconProp` has no Proxmox/Ceph entries (verified). Follow the existing
hand-drawn-generic convention (the repo's "Kubernetes" helm wheel and "Docker"
whale at `Common/UI/Components/Icon/Icon.tsx` L2759/L2810 are stroke
approximations, not official marks — Proxmox is a trademark of Proxmox Server
Solutions GmbH; Ceph of the Ceph Foundation): add `IconProp.Proxmox` (generic
server-stack/hypervisor glyph) and `IconProp.Ceph` (generic hexagon-cluster
glyph) to `Common/Types/Icon/IconProp.ts` (K8s/Docker precedent L325–326) +
SVG cases in `Icon.tsx`; Home icon partials
`Home/Views/Partials/icons/{proxmox,ceph}.ejs` (clone kubernetes.ejs/docker.ejs
shape); static `Home/Static/img/{proxmox,ceph}.svg` only if WI-31's hero/tabs
need them. Never ship the official logos.

#### WI-31: Landing pages + site surface (M/L)

Clone the Docker/Kubernetes/Host trio end-to-end (all refs verified by the
marketing audit):

- Routes: `Home/Routes.ts` — `/product/proxmox`, `/product/ceph` next to
  `/product/kubernetes` (L1229) / `/product/docker` (L1243) / `/product/host`
  (L1254), each via `getSEOForPath`.
- Views: `Home/Views/proxmox.ejs`, `Home/Views/ceph.ejs` (structure of
  `kubernetes.ejs`: title/meta + `head`/`head-social`, nav, hero, feature
  sections, logo-roll, `Partials/enterprise-ready`, features-table, cta,
  footer, `Partials/video-script`).
- SEO: `Home/Utils/PageSEO.ts` entries keyed `"/product/proxmox"` /
  `"/product/ceph"` (template at L406/441/476: title, description,
  canonicalPath, breadcrumbs, softwareApplication JSON-LD feature list).
- Nav/footer/grid: `Home/Views/nav.ejs` desktop mega-menu L216–248 + mobile
  L932–948; `footer.ejs` Products column L115–117;
  `Partials/hero-cards/product-grid.ejs` + new card partials in
  `Partials/hero-cards/`; `features-table.ejs` product card (K8s card
  L549–563) + extend the "Container, VM & Kubernetes" bullet (L258);
  `Partials/product-showcase.ejs` (L253); optionally `product-tabs.ejs`
  (`TAB_ORDER` L1148 + a real product screenshot).
- Sitemap: routes auto-appear via the router walk in `Home/Utils/Sitemap.ts`;
  optionally add both (and the missing kubernetes/docker/host trio) to
  `PAGE_CONFIG` at 0.9/weekly.
- **Copy angles (from the briefs, all defensible):** flat pricing vs Datadog's
  ~$15–23/host/mo where backup-reporting VMs become billable hosts; a full
  Ceph product where Datadog has zero Ceph metrics; backup-coverage +
  replication alerting no SaaS competitor ships; no Grafana/Alertmanager
  bolt-on (the upstream Ceph dashboard's top gripe); fleet view of all
  clusters (upstream got multi-cluster only in Tentacle); 10-minute
  copy-paste onboarding with a real token validator.

#### WI-32: README + docs surface (S)

`README.md`: add Proxmox + Ceph to the "Replace X with OneUptime" framing /
a Features subsection (L33–101 region; infrastructure platforms aren't
enumerated today, so this is additive). Docs nav is already done (v1 —
`App/FeatureSet/Docs/Utils/Nav.ts` L264–269, L527–532); `/docs` has no index
grid to update (redirects straight to getting-started). Cross-link the two
landing pages ↔ docs pages ↔ in-app DocumentationCards.

#### WI-33: Launch comms per repo convention (S, mostly out-of-repo)

The tracked `CHANGELOG` is empty by convention — do not invent in-repo
changelog discipline for one launch. The actual convention (memory + audit):
version via `VERSION` file + `sync-package-versions`; promote master→release;
announcements ship as posts in the separate `oneuptime/blog` repo (pulled
every 3 h by `Home/Jobs/UpdateBlog.ts`). Deliverable checklist: launch post in
the blog repo (TTFV walkthrough GIF, the §2 comparison table distilled,
backup-coverage + replication hero shots), release merge timed with it,
landing pages (WI-31) live first, docs pages final. In-repo work: none beyond
WI-31/32.

#### WI-34 (stretch): Docs translations to Docker parity (L, optional)

`docker-host.md`/`kubernetes-agent.md` exist genuinely translated in all 16
`App/FeatureSet/Docs/Content/<locale>/` dirs; the 4 Proxmox/Ceph docs pages
(+2 monitor pages) are `en/`-only (English fallback prevents 404s). Full
parity = 6 files × 15 locales. Do after the English content stabilizes
(WI-24/25/27 all edit these pages) — translating churning docs is waste.
Follow the i18n architecture notes (en is source of truth).

### 3.9 Verify-then-add bucket (one S-sized spike, no shipping without evidence)

One-time task against a live ceph-mgr (Reef + Squid) and pve-exporter scrape;
add catalog entries/templates/UI series ONLY for names that appear:

- **Scrub staleness:** mixin's CephPGNotScrubbed/NotDeepScrubbed analogs need a
  per-pool not-scrubbed-style metric; our verified list confirms per-pool
  `ceph_pg_<state>` including `ceph_pg_scrubbing`/`ceph_pg_deep` but NOT a
  staleness metric. If absent → v4 (API), and say so in docs.
- **Recovery throughput:** the upstream dashboard charts recovery rate as
  first-class; candidate `ceph_pool_recovering_*` names are unverified. If
  present → add to WI-8 hero charts + catalog; if not → v4 note.
- **Node loadavg/iowait (Datadog has `cpu.avg1/5/15`, `cpu.iowait`):**
  pve-exporter node-collector equivalents unverified. If present → catalog +
  NodeDetail chart; if not → the WI-17 in-guest/host-agent CTA is the answer.
- **`pve_not_backed_up_info` id format** (gates the WI-24 per-guest join).

Record findings in this file when done (append a "verified" table) so v4
scoping starts from evidence.

---

## 3.10 Explicitly rejected for v3 → the v4 API-agent track (honest list)

Everything below requires polling the PVE / PBS / Ceph APIs or new exporters —
out of scope for the config-only OTel agents by design (v2 rejected-list
precedent). They are the *next* moat, not this release:

- **Per-guest backup freshness/success/size/verification** (vzdump task-log
  parsing à la Checkmk; PBS datastore/verify state à la Pulse). The decisive
  Pulse/Checkmk moat — biggest single v4 prize.
- **Snapshot age / snapshot trees** (API-only).
- **PVE task events** (migrate/start/stop/vzdump streams — Datadog has 15
  types but no vzdump; v4 could leapfrog).
- **PBS server monitoring as a product** (pbs_exporter or PBS API).
- **True corosync quorum / qdevice status** (node-visibility-derived quorum
  stays the documented ceiling).
- **RGW / CephFS deep views, per-daemon perf forensics** (ceph-exporter
  daemon integration).
- **Forecast-based alerting** (predict_linear needs server-side derived
  metrics in the criteria engine).
- **SMART / device-failure prediction** (no mgr metric — verified).
- **Replication-staleness alerting** (needs wall-clock math in criteria).

---

## 4. Sequencing vs in-flight v2

**Binding rule: v3 implementation starts only after the v2 worktree merges.**
The v2 churn (~100 modified + ~50 untracked files) directly overlaps the v3
hot files — `OtelMetricsIngestService.ts` (WI-24 extends the WI-3/WI-6 scan),
`ProxmoxAlertTemplates.ts`/`CephAlertTemplates.ts` (WI-24/25/26 append),
`DocumentationMarkdown.ts` + `Clusters.tsx` (WI-18), the View pages
(WI-25/27/28/29), both agent configs (WI-27). Starting v3 on these files now
guarantees conflicts.

Order of operations:

1. **v2 lands** (compile/lint/migration registration per AGENTS.md: generated
   migrations, `npm run fix`, `npm run compile`).
2. **Phase A = P0 (WI-18…WI-23)** — small, independent, launch-gating. Ship
   with or immediately after the v2 release; WI-33's blog post waits for these
   (the TTFV demo *is* the launch story).
3. **Phase B = P1 (WI-24…WI-29)** + the §3.9 verification spike (run the spike
   first; it gates WI-26's optional scrub rows and WI-24's join). WI-24/25/26
   are independent of each other; WI-28 touches the same Overview files as
   WI-25 — sequence those two.
4. **Phase C = P2 (WI-30…WI-33)** — the `Home/`, `README.md`, and Icon files
   are touched by neither v2 nor any other v3 item, so Phase C may run in
   parallel with Phase B by a second owner without conflict risk (the only
   v3-internal dependency: WI-31 needs WI-30's icons; WI-33 ships last).
5. WI-34 (translations) trails everything — only after WI-24/25/27 stop
   editing the English docs pages.

Single-source rules carried forward: WI-24's `guestsWithoutBackupCount` and
`isBackedUp` are written from the same WI-3/WI-6 scan buffer as every other
snapshot column (no second code path — K8s badge-drift lesson); all new
templates go through the WI-9 builders and the WI-20 tests enumerate them
automatically; every new metric must exist in a `*MetricCatalog.ts` entry or
it doesn't ship.
