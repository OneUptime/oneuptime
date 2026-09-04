# Network Observability — Roadmap

> Engineering roadmap for the network-monitoring epics that are **not** in the current PR.
> Baseline below reflects the codebase as of **2026-09-03** (network devices v2: ping-first polling,
> credential profiles, alert policies). When an epic is picked up, spin its design
> section out into its own doc (the `CodeFixSandboxDesign.md` precedent) and replace the section here
> with a link + status. Revisit sizing when adjacent epics land — several of these get cheaper together.

---

## 0. Shipped baseline (what the network product already covers)

So this doc reads standalone: everything below exists today and is the substrate the epics build on.

| Area | What ships | Code entry points |
|---|---|---|
| Ping-first polling | Every probe-polled device is **pinged** on its schedule, and walked over SNMP in parallel only when a usable credential set resolves (v1/v2c community non-empty, or v3 username non-empty). Reachability = ping OR walk; the walk's own outcome is a separate column (`isSnmpReachable`) that never moves the verdict, which is what makes "SNMP failing" a state distinct from "Down". Old probes that do not advertise the `networkDevicePing` capability are never handed a credential-less device — those stay Pending with one warn per batch naming the probe, rather than being walked with a default community and reported Down | `Probe/Jobs/NetworkDevice/FetchList.ts`, `Probe/Utils/Monitors/MonitorTypes/PingMonitor.ts` (`checkReachability`), `App/FeatureSet/Telemetry/API/ProbeIngest/NetworkDevicePoll.ts`, `Common/Utils/NetworkDevice/SnmpCredentialUtil.ts`, `Common/Server/Utils/Monitor/NetworkInventoryUtil.ts` |
| SNMP polling + inventory | v1/v2c/v3 (incl. OpenSSL-3 DES compat shim), system-group scalars, ENTITY-MIB chassis identity (vendor/model/serial/firmware), vendor health-OID templates (CPU/memory/temperature) | `Probe/Utils/Monitors/MonitorTypes/SnmpMonitor.ts`, `Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate.ts`, `Common/Models/DatabaseModels/NetworkDevice.ts` |
| SNMP credential profiles | `NetworkSnmpCredentialProfile` — one named credential set shared by devices and sites, secrets `encrypted: true` with the restricted read list. Resolution per poll: device's own credentials -> device's profile -> the device's own site's profile (no ancestor walk); none of the three = ping only. Delete is refused with a count of referencing devices and sites | `Common/Models/DatabaseModels/NetworkSnmpCredentialProfile.ts`, `Common/Server/Services/NetworkSnmpCredentialProfileService.ts`, `Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil.ts` (`resolveSnmpCredentials`) |
| Alert policies — **definition only** | `NetworkAlertPolicy` ships: scope (sites AND roles AND labels, OR within a kind, empty kind = all), a Network Device monitor template, the ownership validators (one template backs one policy and cannot also be selected by an auto-import rule), the Settings page and the recommended-policy bootstrap (pack template + all-devices policy, find-or-create by marker). **The provisioning engine is deliberately NOT attached** — `onCreateSuccess` / `onUpdateSuccess` / `onDeleteSuccess` are named seams that log and return, so a saved policy provisions no monitors and `coveredDeviceCount` / `lastSyncAt` are never stamped (the table renders "Not counted yet"). See epic 12 | `Common/Models/DatabaseModels/NetworkAlertPolicy.ts`, `Common/Server/Services/NetworkAlertPolicyService.ts` (engine attachment points), `Common/Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil.ts`, `App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/AlertPolicies.tsx` |
| Site monitoring defaults | `NetworkSite.probeId` (copy-at-write, nearest-ancestor wins, never re-points existing devices) and `NetworkSite.snmpCredentialProfileId` (read live on every poll, direct site only). Tenancy: an inherited probe must be attachable to the device's project, with a DB backstop in `claimDevicesForPolling` | `Common/Server/Services/NetworkSiteService.ts` (`resolveDefaultProbeIdForSite`), `Common/Server/Services/NetworkDeviceService.ts` (`resolveInheritedSiteProbeId`) |
| Interface monitoring | IF-MIB walk with 64-bit HC counters (32-bit fallback), rates/utilization/errors per interface | `Common/Models/DatabaseModels/NetworkInterface.ts` |
| Topology | LLDP + CDP neighbor walks; opt-in ARP + FDB endpoint collection (row-bounded walks, wall-clock deadline) | `SnmpMonitor.ts` (endpoint phase), `Common/Models/DatabaseModels/NetworkEndpoint.ts` |
| Sites | Site hierarchy, site links, status rollups + uptime timeline, device-to-site assignment rules | `NetworkSite.ts`, `NetworkSiteLink.ts`, `NetworkSiteStatusTimeline.ts`, `NetworkSiteAssignmentRule.ts` |
| Discovery | Subnet sweeps (ICMP pre-sweep + SNMP probe; ping-only hosts kept for unmanaged gear), or ping-only when `isSnmpEnabled` is off — no SNMP packet sent, no credentials stored. **Every host imports probe-polled**, with the scan's probe and polling on; what differs between an SNMP responder and a ping-only host is only whether the scan's credentials ride along. Discovered hosts are named by reverse DNS (PTR) when SNMP gives no `sysName`; best-effort, address as fallback | `Probe/Utils/Discovery/SubnetScanner.ts`, `Probe/Utils/Discovery/ReverseDnsResolver.ts`, `Common/Utils/NetworkDiscovery/DiscoveryImportEligibility.ts` (`monitoringMethodForDiscoveredHost`), `Common/Utils/NetworkDiscovery/ScanModeUtil.ts`, `NetworkDeviceDiscoveryScan.ts` |
| Bound-monitor override | `monitoringMethod = Monitor` is now an override for gear no probe can reach, not the way ping-only devices are modelled. Nothing polls such a device; its bound monitor's status is its status, the binding stays optional everywhere (forms, API, discovery), and an unbound one reads Pending tagged "No monitor" on the list, the site tab and the Overview hero. Health precedence: the stamped monitor status is authoritative **only** for monitor-backed devices — a Network Device monitor on a probe-polled device never overrides its poll, so the list, the map and the site rollup agree. Escape hatches: a Devices-page banner counting unbound overrides, a "Switch to Probe Polling" bulk action, and a Ping monitor creatable from the create form, the device page or in bulk | `Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod.ts`, `Common/Utils/NetworkDevice/DeviceHealthStateUtil.ts`, `Common/Server/Services/NetworkDeviceService.ts` (`refreshStampedMonitorStatus`, `pollResidueReset`), `App/FeatureSet/Dashboard/src/Components/NetworkDevice/UnboundDevicesBanner.tsx`, `useBulkSwitchToProbePolling.tsx` |
| Device status vocabulary | One rule behind every surface: Up / Down / Pending plus qualifier pills ("Stale", "No probe", "No monitor", "SNMP failing"), an SNMP facet (OK / Failing / Not configured) on the Devices list, and a "No SNMP" interfaces cell instead of a misleading `0 / 0` | `Common/Utils/NetworkDevice/DeviceReachabilityUtil.ts`, `App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil.ts`, `DeviceFacets.ts` |
| Flow analytics | NetFlow v5 **and v9** receivers → `NetworkFlow` ClickHouse table (top talkers / bandwidth attribution; fixed 30-day TTL) | `Probe/Services/NetFlowReceiver.ts`, `Probe/Utils/NetFlow/NetFlowV5Parser.ts`, `NetFlowV9Parser.ts`, `Common/Models/AnalyticsModels/NetworkFlow.ts` |
| Event ingestion | SNMP trap receiver (v1→v2 OID mapping, rate-limited) and syslog receiver, forwarded to probe ingest | `Probe/Services/SnmpTrapReceiver.ts`, `Probe/Services/SyslogReceiver.ts` |
| Latency matrix | Probe-to-target latency matrix / network path monitoring | `Common/Types/Monitor/LatencyMatrix.ts`, `Probe/Utils/Monitors/MonitorTypes/NetworkPathMonitor.ts` |
| Automation | Owner rules, label rules (+ rule engines), site assignment rules | `NetworkDeviceOwnerRule*.ts`, `NetworkDeviceLabelRule*.ts`, `NetworkSiteAssignmentRule.ts` |

## Epic index

| # | Epic | Size | Hard dependencies |
|---|---|---|---|
| 1 | Network Configuration Management (NCM) | **XL** — flagship | Encrypted credential storage; probe SSH/NETCONF client |
| 2 | IPAM | L | None (feeds off shipped discovery + ARP) |
| 3 | Wireless | L | None (extends shipped SNMP path) |
| 4 | Capacity forecasting | M | Stable interface-utilization metric names; Insights inbox (shipped) |
| 5 | sFlow + IPFIX ingestion | M | NetFlow v9 template machinery (shipped) |
| 6 | Topology history | M | None |
| 7 | Interface flap detection | S/M | None |
| 8 | Native ScheduledMaintenance + StatusPage relations | M | None |
| 9 | Full hardware sensor tables | L | Metric-cardinality plan |
| 10 | Per-project NetFlow retention | S | Billing/plan decision only |
| 11 | Ingest write path at fleet scale | **L** — 11a/11c(a)/11d shipped; 11b half-shipped, 11c(b–c) open | None — see below |
| 12 | Alert policy provisioning engine | M | Policy model + validators + indexed fan-out (all shipped) |

---

## 12. Alert policy provisioning engine — M

**Where this stands.** `NetworkAlertPolicy` ships as a *definition*: the model, the project-scoped
validators, the scope type, the Settings page and the recommended-policy bootstrap. What does not
ship is `NetworkAlertPolicyEngineService` — the thing that turns a saved policy into monitors.
`NetworkAlertPolicyService` carries three named seams for it (`onCreateSuccess`, `onUpdateSuccess`,
`onDeleteSuccess`) that today log and return, so the service's shape will not change when the engine
arrives. Until then a policy provisions nothing, `coveredDeviceCount` / `lastSyncAt` /
`lastSyncError` / `templateSyncedAt` are never stamped, and the page renders "Not counted yet".
The public docs say so explicitly — keep those two in step
(`App/FeatureSet/Docs/Content/en/monitor/network-device-monitor.md`, and the in-app help markdown in
`AlertPolicies.tsx`, which currently describes the engine as if it were running).

**What the engine has to be.** One mutation path, `reconcileDevice(projectId, deviceId)`: desired =
enabled policies whose scope matches AND the device is `!isArchived && !isMonitorBacked && probeId
NOT NULL`; actual = monitors with `autoProvisionedNetworkDeviceId = device AND networkAlertPolicyId
NOT NULL`; the diff applied under a Redis lock (`NetworkAlertPolicy:Device:<id>`, the `Semaphore`
util) so two hooks racing on one device cannot double-provision. `syncPolicy(policyId)` is
`reconcileDevice` paged over the matching devices.

**Attachment points**, all of which exist already and are why the prerequisites were built first:

- last link of `NetworkDeviceService.onCreateSuccess`'s out-of-band chain;
- `NetworkDeviceService.onUpdateSuccess` when `siteId`/`site`, `networkDeviceRoleId`/
  `networkDeviceRole`, labels, `isArchived`, `monitoringMethod` or `probeId` are written;
- inline while `updatedItemIds.length <= 5`, otherwise a five-minute reconcile job with a per-project
  `MAX_MONITORS_PER_POLICY_SYNC` of 500 and `_id` keyset paging.

**Already in place, do not rebuild:** the indexed fan-out (11b below), the partial unique index
`(autoProvisionedNetworkDeviceId, monitorTemplateId)` that makes provenance a database fact, the
one-template-one-owner validators on both the policy and the auto-import rule, the SET NULL FKs as
delete backstops, and `NetworkAlertPolicyBootstrapUtil` for the recommended template.

**Open questions.**
- Plan/billing: precheck `ProjectService.getCurrentPlan` once per run and stop on the first plan
  exception — but what does the UI say when a sync stops half way? (`lastSyncError` is the column;
  the wording is not designed.)
- Disabling a policy is a paged `updateBy { disableActiveMonitoring: true }`. Re-enabling must not
  clobber a monitor a human disabled by hand in the meantime — store provenance for that bit, or
  accept the clobber and say so?
- Reconcile cost on a bulk site move: 10,000 devices changing site is 10,000 `reconcileDevice` calls
  behind one job. Batch by policy instead when the update carries a single scope-relevant key?

---

## 11. Ingest write path at fleet scale — L

**Where this came from.** The read path was rebuilt for 80,000 devices (fleet counts moved from
"download every row into the browser" to grouped aggregates in Postgres; indexes added; the
site-hierarchy rollup went from an 8-page, 200,000-row walk to one grouped read). Measuring that
work turned up three things on the **write** side that are hard walls rather than slowdowns. They
are recorded here rather than fixed there because each is a substantial change to the SNMP ingest
path with its own testing story, and none of them is on the surface the read work touched.

The numbers below assume 80,000 devices on a five-minute interval — **267 walks/sec** — and ~50
interfaces per device. Note that today `DEVICE_POLL_FETCH_LIMIT` (250 per probe per minute) is what
stops a fleet reaching that rate: the real cadence at 80,000 devices is roughly one poll per device
every 160 minutes. So these are latent until an operator raises the fetch limit, which is exactly
what `NetworkDevicePoll.ts` tells them to do. Raising it without these fixes moves the bottleneck
into Postgres.

### 11a. Interfaces are written one row at a time — SHIPPED

**Done.** `NetworkInterfaceService.upsertWalkedInterfaces` batches the walk into one `SELECT`, one
`INSERT … ON CONFLICT` per 500 new ports and one `UPDATE … FROM (VALUES …)` per 500 known ones. The
per-row decision is pure and lives in `Common/Utils/Monitor/InterfaceInventoryUtil.planWalkUpsert`.

Measured on the seeded fleet, steady-state walk of a 50-port device: **101 statements → 2**, and
**903 ms → 20 ms** wall clock. The first-discovery walk was worse than the roadmap said — 200
statements, because `DatabaseService.create` wraps each row in its own transaction and
`@UniqueColumnBy` adds a `countBy` per row — and is now also 2.

Two things it deliberately does not do: there is **no no-op detection** (`lastSeenAt` is stamped
every walk, so no row is ever unchanged; suppressing the write would mean letting "last seen" go
stale on a port that is answering), and there is **no cap** on interfaces per walk. A failed chunk
is retried row-by-row, so one malformed interface costs only itself rather than the other 499.

<details><summary>Original problem statement</summary>

### 11a (original) — Interfaces are written one row at a time

`Common/Server/Utils/Monitor/NetworkInventoryUtil.ts` upserts each walked interface with its own
`updateOneById` / `create`. `DatabaseService._updateBy` issues a SELECT before every UPDATE, so one
walk of a 50-port switch is **101 statements**. At 267 walks/sec that is ~26,700 statements/sec, or
roughly 18 seconds of database wait per wall-clock second.

**Fix:** one `INSERT … ON CONFLICT ("networkDeviceId","interfaceIndex") DO UPDATE` per chunk. The
unique partial index it needs already exists (`IDX_network_interface_device_ifindex`), and
`NetworkEndpointService.upsertDiscoveredEndpoints` is a working template for exactly this shape.

</details>

### 11b. Every Network Device monitor in the project is fetched on every walk — HALF SHIPPED

**Half done.** `NetworkDeviceWalkUtil.findMonitorsWatchingDevices` no longer reads the project's
whole monitor set in one gulp. It is now a union of two reads, deduped by id:

- **the indexed half** — monitors with `autoProvisionedNetworkDeviceId IN (deviceIds)`, served by the
  leading column of the partial unique index
  `IDX_monitor_auto_provisioned_device_template_unique`. Every monitor an alert policy will provision
  lands here, so the fleet-scale case is O(matching monitors), not O(project monitors);
- **the legacy half** — a **paged** scan restricted to `autoProvisionedNetworkDeviceId IS NULL`,
  still filtered in JavaScript over `monitorSteps` jsonb, for monitors a human created by hand.

So the quadratic term is gone for provisioned monitors and survives, bounded by paging, for
hand-built ones. That was the right trade to make now (it is the prerequisite epic 12 needs), and it
is not the whole fix.

**What is left:** make the hand-built link queryable too — a denormalised `Monitor.networkDeviceId`
maintained by the monitor-step save path and indexed `(projectId, networkDeviceId)`, or a generated
column / GIN index over the referenced device id — plus a backfill that stamps it on existing
monitors, after which the legacy half can be deleted rather than paged. A Redis cache keyed on the
project's max monitor `updatedAt` is a stopgap, not the answer.

### 11c. `lastWalkLog` is read twice and rewritten whole on every poll — (a) SHIPPED, (b)/(c) OPEN

**(a) is done:** the delta-baseline write goes through `updateColumnsByIdWithoutHooks`, so the
pre-update SELECT is gone — 2 statements → 1, 16.1 ms → 11.1 ms for a 19.8 KB log. Nothing rides on
the hooks for that payload (it carries one column, and `NetworkDevice` declares no workflow, audit
or realtime decorators); the soft-delete guard the SELECT used to provide is restored explicitly.

**(b) and (c) are NOT done, and the headline numbers below are untouched by (a).** The ~12 KB of WAL
per rewrite, and therefore the ~580 GB/day of dead TOAST and ~56 GB/day of WAL, are what storing
less would fix. Do not tick this item off on the strength of (a).

A realistic 48-interface walk log measures ~25 KB of jsonb — past the TOAST threshold, so stored
out of line. Each poll detoasts it in the walk util, detoasts it again inside `_updateBy`'s
pre-update SELECT, and writes a fresh 25 KB, orphaning the old one. Measured WAL for that write is
2,429 B/row against 579 B/row for a plain HOT update. At 267 walks/sec that is ~580 GB/day of dead
TOAST tuples for autovacuum to reclaim on the product's hottest table, and ~56 GB/day of WAL from
one column.

**Fix, in order of value:** (a) route the write through `updateColumnsByIdWithoutHooks`, which skips
the pre-update SELECT; (b) store only the counter fields `SnmpInterfaceRateUtil` needs for a delta
rather than the whole response — roughly 10× smaller; (c) treat it as the cache it is and move the
baseline to Redis with a TTL of twice the poll interval.

### 11d. Site-assignment rules re-run on every poll — SHIPPED

**Done.** A project with no assignment rules is remembered as such for ten seconds, so an
unattached device's poll skips both the device read and the rule read. Measured: **160,000 queries
per five-minute cycle removed** at 80,000 devices, ~533/sec.

Only the NEGATIVE answer is cached, and only for the path that retries: a device with no site is
re-evaluated every poll, so a skip there is a deferral the next poll undoes. A device that already
has a site is re-evaluated only on a real identity change — a one-shot event — so that path never
consults the cache. Skipping it would not be a deferral but a permanent, silent loss.

### 11e. Smaller, same area

- **~~Site-assignment rules re-run on every poll for any device with no site.~~ (shipped, above.)** Every successful walk
  writes `sysName`, which is an identity column, and `shouldReapplySiteAssignmentRules` returns true
  unconditionally for a device with no `siteId` — so each such device re-reads the whole rule set
  every cycle to conclude nothing. Cache the project's rules for a poll batch, and skip the path
  entirely when the project has no rules (one count answers it).
- **`materializedPath` cannot be served by its index, in either spelling.** `pathStartsWith` emits
  `LIKE 'prefix%'`, which a plain btree cannot serve under a non-`C` collation; the hierarchy
  endpoint's `QueryHelper.search()` emits `ILIKE '%…%'`, which nothing can serve. Both seq-scan
  `NetworkSite`. Invisible at 1,200 sites, ~50–150 ms per call at 10–20k. Fix: index
  `("projectId", "materializedPath" varchar_pattern_ops)` and use the prefix form everywhere, or
  move the column to `ltree` with GiST.
- **Topology passes up to 10,000 UUIDs as a literal `IN` list** (~390 KB of SQL text) and, when a
  label-based link rule is resolvable, reads the whole fleet into request memory. Pass one
  `= ANY($1::uuid[])` array parameter, and express the rule's question ("how many devices carrying
  label set P are in site S") as a `GROUP BY siteId` aggregate over the label junction.
- **The grouped health aggregate's plan is on a knife edge.** Postgres cannot estimate the
  cardinality of expression group keys and over-estimates by ~13×; depending on current statistics
  it picks HashAggregate (228 ms) or Sort → GroupAggregate (1,720 ms, ~3.7 MB spilled). Extended
  statistics did not repair the estimate. Scoping the drill-down to the subtree in view (shipped)
  shrinks both plans; raising `work_mem` on this path is the remaining lever.
- **Dashboard surfaces still fetching to count:** the Latency Matrix pulls every `MonitorProbe` row
  with its `lastMonitoringLog` jsonb and renders an unvirtualised monitors × probes grid with no
  truncation flag; `DeviceMonitorLookupUtil` pulls every Network Device monitor in the project
  (`monitorSteps` included) on every device Overview, and its 10,000-row cap can make a monitored
  device render "no monitors are alerting on this device"; the discovery review modal renders up to
  32,768 unvirtualised rows and imports them with one sequential create each; the CSV site import is
  O(n²) in progress reporting and unvirtualised in both its tables.
- **`ModelForm` pre-fetches 10,000 rows per entity dropdown** before the modal paints, even though
  `EntityDropdown` does its own server-side search at 50 rows. Opening the device-link form on a
  large fleet fetches ~40,000 rows for nothing. Shared infra, so the highest blast radius on this
  list — and the cheapest fix.

---

## 1. Network Configuration Management (NCM) — XL, flagship

**Problem.** Config change is the leading cause of network incidents, and we see none of it. There is
no config backup, no diff history, no way to answer "what changed on this router before the incident",
and no compliance checking. This is the biggest single gap against dedicated NCM tools and the epic
most likely to win network-team deals on its own.

**Design sketch.**

- *Models (Postgres):*
  - `NetworkDeviceCredential` — SSH/NETCONF credentials, project-scoped, optionally shared across
    devices/sites. Secrets MUST use the `DatabaseService` encrypted-column path
    (`Common/Server/Utils/Encryption.ts`) and be write-only through the API (never readable back).
    Note honestly: today's SNMP secrets on `NetworkDevice` (`snmpCommunityString`, `snmpV3AuthKey`,
    `snmpV3PrivKey`) are still plain columns — NCM must not copy that pattern, and migrating those
    columns to encrypted storage should ride along with this epic. The pattern to copy is
    `NetworkSnmpCredentialProfile`, which ships with `encrypted: true` on all three secrets and the
    restricted read list (no Viewer/SettingsViewer, no `canReadOnRelationQuery`) — so the "one shared
    credential set, encrypted, referenced by many devices" shape is now proven in-tree, and the
    device-column migration is the only part still outstanding.
  - `NetworkDeviceConfigVersion` — one row per captured config: device, capturedAt, content hash
    (dedupe: identical consecutive captures store no new body), config body, collection method,
    startup-vs-running flag.
  - `NetworkComplianceRule` (project-scoped: regex/line-must-exist/line-must-not-exist over config
    text, device scope via labels/sites) and `NetworkComplianceResult` (per device × rule, pass/fail
    + matched lines).
- *Probe:* new job type — the probe is currently a poller only. SSH client (`ssh2`), NETCONF over the
  SSH subsystem, per-vendor playbooks (disable pagination, `show running-config`, etc. — start with a
  small plugin interface per vendor keyed off the shipped `sysObjectId`/`vendor` fields). Redact
  device-embedded secrets (e.g. `snmp-server community`, type-7 passwords) **on the probe** before
  upload. Scheduled capture (daily default) + on-demand "back up now".
- *APIs:* credential CRUD; config version list; diff endpoint (server-side unified diff between two
  versions); compliance run/results.
- *UI:* per-device config timeline; side-by-side diff viewer; compliance dashboard; and the payoff —
  **change-vs-incident correlation**: config-change events overlaid on incident timelines and exposed
  to Sentinel's `recent_changes` tool so investigations can cite "config changed 14 min before alert".

**Dependencies.** Encrypted credential storage (above); decide config-body storage (Postgres `text` is
fine for v1 — configs are ~10–500 KB and deduped; object storage only if that proves wrong).

**Open questions.**
- CLI-first or NETCONF-first for v1? (CLI covers far more installed gear; NETCONF diffs cleaner.)
- Config *push* (remediation, "restore this version") — explicitly out of scope for v1? Writing to
  network devices needs its own safety story, same spirit as the Sentinel mutation gates.
- Diff noise: banners/timestamps/counters inside config output produce false diffs — per-vendor
  normalization rules needed; who owns keeping them current?
- Do compliance failures raise alerts through the existing alert pipeline or stay a dashboard-only
  signal in v1?

## 2. IPAM — L

**Problem.** Subnets exist only as CIDR strings typed into discovery scans. Nobody can ask "how full
is 10.20.0.0/24", "give me a free IP", or "what is this IP" — even though the raw data (discovery
sweeps, ARP caches in `NetworkEndpoint`, interface IPs) is already being collected.

**Design sketch.**

- *Models:* `Subnet` as a first-class Postgres model — cidr, name/description, site relation, labels,
  gateway/reserved ranges. Optional `SubnetIpReservation` for manual "this IP is spoken for" rows.
- *Server:* utilization computed, not stored authoritatively — join observed IPs (endpoint ARP rows
  with `lastSeenAt` inside a freshness window, discovery results, device/interface IPs) against the
  CIDR. A worker job materializes per-subnet counts for list-page speed.
- *APIs/UI:* subnet list with utilization bars; per-subnet IP grid (used / free / reserved / stale,
  with the device+MAC that claims each IP and where it was last seen); free-IP finder; conflict
  surfacing (same IP seen behind two MACs).
- *Integration:* `NetworkSiteAssignmentRule` gains a subnet-membership condition (device IP ∈ subnet →
  site), and discovery scans can be launched from a subnet instead of a raw CIDR string.

**Dependencies.** None hard — this is mostly a read model over shipped collection paths.

**Open questions.**
- Staleness semantics: after how long unseen does an IP count as free again? (Proposal: configurable,
  default 30 days, never auto-free reserved rows.)
- Overlapping subnets / VRFs: v1 assumes non-overlapping per project — acceptable?
- IPv6 in v1 or explicitly later? (The grid UI doesn't survive a /64; utilization needs a different
  presentation.)

## 3. Wireless — L

**Problem.** APs and WLCs poll like any SNMP device today, but we model none of the wireless-specific
surface: SSIDs, client counts, RF health, roaming. Wireless is where end-user complaints actually
live in franchise/branch estates.

**Design sketch.**

- *Discovery:* ride the existing SNMP path — classify AP/WLC from `sysObjectId` (the shipped vendor
  fingerprint), starting with controller-based estates (Cisco WLC / AIRESPACE-WIRELESS-MIB) where one
  poll target yields the whole AP fleet.
- *Models:* APs behind a controller become `NetworkDevice` rows (or a lightweight child model) linked
  to the WLC; per-AP/SSID metrics (client count, channel utilization, noise, retransmits) go through
  the metrics pipeline; `WirelessClientSession` as a ClickHouse analytics table (client MAC, AP,
  SSID, RSSI, session start/end) — roaming history is then just the session rows for a MAC ordered by
  time, same query shape as `NetworkFlow`.
- *Probe:* client tables on a busy WLC run to tens of thousands of rows — MUST reuse the shipped
  row-bounded walk + phase-deadline pattern from `SnmpMonitor.ts` (built for exactly this: ARP/FDB
  tables bounded by learned-MAC count), not `session.tableColumns`.
- *UI:* AP list under the controller device; SSID/RF panels; client search by MAC with roam timeline.

**Dependencies.** None hard. Topology history (epic 6) makes roam visualization richer but is not
required.

**Open questions.**
- Vendor order after Cisco WLC — Aruba? UniFi (SNMP surface is thin; may need their API, which breaks
  the "probe speaks SNMP only" line)?
- Client MACs + hostnames are user-adjacent PII — retention window and whether client sessions are
  opt-in like endpoint collection is today.
- Standalone (controllerless) APs: worth supporting in v1 or WLC-only?

## 4. Capacity forecasting — M

**Problem.** `NetworkInterface.utilizationPercent` is an instantaneous reading. Links do not fail
suddenly, they fill up slowly — the product should say "this uplink saturates in ~3 weeks" before the
80%-utilization alert fires at 2am.

**Design sketch.**

- *No new collection.* Interface utilization already flows through the metrics pipeline;
  `MetricBaselineHourly` (hour-of-week bands, 90-day TTL) already exists for seasonality.
- *Detector, not subsystem:* implement as a deterministic detector in the existing AI SRE insights
  framework (`Common/Server/Utils/AI/Sentinel/Insights/Detectors/` — same home as the trace-p99 and
  metric-drift detectors). Fit a trend on daily utilization aggregates (start with OLS on daily p95;
  seasonality handled by baselining, not by the fit), project the crossing date for a saturation
  threshold, and emit a `SentinelInsight` when the crossing lands inside the horizon (e.g. ≤ 45 days).
- *UI:* projection line + crossing date on the interface graph; insights inbox entry with
  confirm/dismiss (which also feeds the G11 precision instrumentation for free).

**Dependencies.** Stable metric naming for interface utilization; insights inbox (shipped).

**Open questions.**
- Minimum history before projecting (proposal: ≥ 21 days, else stay silent — a loud wrong forecast is
  worse than none)?
- Threshold to project against: fixed 80%? per-interface override?
- Do we forecast anything besides interface utilization in v1 (device CPU/memory trend is the same
  math) or keep scope tight?

## 5. sFlow + IPFIX ingestion — M

**Problem.** NetFlow v5 and v9 have both shipped — but sFlow-only
gear (much of the switching world) and IPFIX-only gear export nothing we can read.

**Design sketch.**

- *IPFIX (RFC 7011):* structurally NetFlow v9's sibling — reuse the shipped v9 per-exporter template
  cache; add variable-length fields and enterprise-specific IEs (which we can skip
  unknown-field-safe). Same UDP receiver, version-dispatched per datagram header.
- *sFlow (v5):* different animal — sampled packet headers, not flow records, on its own conventional
  port (6343). Parse the flow-sample structures, decode the raw header far enough for the 5-tuple,
  and scale octets/packets by the sampling rate.
- *Normalization:* everything lands as `NetworkFlow` rows (exporter-correlated to a `NetworkDevice`
  at ingest, same drop rule for unknown exporters). Add `samplingRate` (1 = unsampled) so sampled
  sFlow rows are never mistaken for exact byte counts in top-talker math; queries multiply through.
- *Probe config:* per-receiver enable flags + ports, mirroring the shipped NetFlow/trap/syslog
  receiver config surface.

**Dependencies.** NetFlow v9 template machinery (shipped, `Probe/Utils/NetFlow/NetFlowV9Parser.ts`).

**Open questions.**
- `samplingRate` as a new `NetworkFlow` column (schema change on the highest-volume table) vs. baking
  the multiplication in at ingest and losing the "this was sampled" signal — leaning column.
- Template persistence across probe restarts (v9/IPFIX flows are unparseable until templates re-arrive;
  is a re-learn window acceptable, or do templates get checkpointed)?
- Memory bound on per-exporter template caches for probes watching thousands of exporters.

## 6. Topology history — M

**Problem.** Topology is a live snapshot: `cdpNeighbors`/`lldpNeighbors` JSON columns are overwritten
each poll and `NetworkEndpoint` keeps only `lastSeenAt`. "What changed since yesterday" — the first
question after any mystery outage — is unanswerable, and users cannot pin layouts or annotate the map.

**Design sketch.**

- *Model:* `NetworkTopologySnapshot` — periodic (proposal: hourly, thinning to daily after 7 days)
  worker-written captures of the edge set: device↔device edges from LLDP/CDP with local/remote port,
  plus per-device endpoint counts (not per-MAC — endpoints churn too much to snapshot individually).
  Postgres JSON is fine at snapshot granularity; ClickHouse only if retention ambitions grow.
- *Diff:* server endpoint computing added/removed/changed edges between two snapshots. UI: a
  "changes since…" panel and a time slider on the existing topology view.
- *Layout pinning / annotations:* separate small model (`NetworkTopologyLayout`) — per-project pinned
  node positions + free-text annotations. Deliberately independent of snapshots so pinning ships even
  if snapshot cadence questions drag.
- *Integration:* topology diffs are exactly the "recent changes" an investigation wants — feed them to
  Sentinel's `recent_changes` surface alongside NCM config diffs (epic 1).

**Dependencies.** None.

**Open questions.**
- Retention (proposal: 90 days of snapshots) and whether it is plan-gated.
- Are attribute changes (interface speed/description changed on an existing edge) part of the diff or
  edges-only in v1?
- Per-user vs per-project layouts (proposal: per-project — a shared map is the point).

## 7. Interface flap detection — S/M

**Problem.** A port flapping between polls is invisible today: the poll sees whatever state exists at
poll time, and linkUp/linkDown traps arrive only from devices configured to send them. `ifLastChange`
(IF-MIB 1.3.6.1.2.1.2.2.1.9) is not collected anywhere in the codebase (verified 2026-07-24).

**Design sketch.**

- *Probe (S):* add the `ifLastChange` column to the IF-MIB walk — the table is already walked every
  poll, so this is one more column, no new PDU pattern.
- *Server:* compare against the previously stored value per interface; a changed `ifLastChange` with
  unchanged-or-higher `sysUpTime` means ≥ 1 transition since last poll (the value is a sysUpTime
  timestamp — agent restarts and the 497-day sysUpTime wrap must read as "unknown", not "flap").
  Maintain a rolling transition count per interface (either counters on `NetworkInterface` or a small
  timeline table if we want history).
- *Criteria (the M half):* new monitor criteria filter — "interface flapping: ≥ N transitions in M
  minutes" — joining the existing interface-based criteria; linkDown/linkUp traps, where configured,
  accelerate detection but are never required.
- *UI:* flap badge on the interface list; transition count on the interface panel.

**Dependencies.** None.

**Open questions.**
- One transition per poll interval is the floor of what `ifLastChange` can prove (it stores only the
  *last* transition) — is that honest enough for the criteria semantics, or do we require traps for
  true counts and document the difference?
- Per-interface exclusion for expected-noisy ports (user access ports cycle constantly) — label-based
  exclusion or per-interface flag?

## 8. Native ScheduledMaintenance + StatusPage relations — M

**Problem.** Maintenance windows and status pages attach to monitors only. A `NetworkDevice` or
`NetworkSite` participates indirectly via its monitor, which breaks the obvious workflows: "put this
whole site into maintenance Saturday night" and "show branch-office network health on our status
page". Verified: `ScheduledMaintenance.ts` has no NetworkDevice/NetworkSite relations today.

**Design sketch.**

- *Models:* join relations mirroring the existing monitors pattern —
  `ScheduledMaintenance.networkDevices` / `.networkSites`, and status-page resource support for both
  (site resources roll up from the shipped `NetworkSiteStatusTimeline`; device resources from the
  device's `currentMonitorStatus`).
- *Server:* selecting a site expands to its member devices **at window start, not at creation** (a
  device moved into the site after scheduling is covered — this matches user intent and must be a
  deliberate, documented choice). During an active window: device-sourced alerts are suppressed-with-
  annotation (never silently dropped) and site uptime timelines record a maintenance state rather
  than degraded.
- *UI:* device/site pickers on the maintenance form; network resource types in status-page resource
  config; maintenance banner on device/site pages during active windows.

**Dependencies.** None. (Epic 1's change correlation gets better when maintenance windows exist on
devices natively — a config change inside a declared window is expected, outside one is a finding.)

**Open questions.**
- Status-page uptime math for a site: from `NetworkSiteStatusTimeline` (rollup semantics, already
  shipped) or recomputed from member devices? Proposal: the timeline — one source of truth.
- Do subscriber notifications for network resources reuse the monitor wording or need their own
  templates?

## 9. Full hardware sensor tables — L

**Problem.** Health OIDs today come from vendor templates that pin **first-row scalar instances** —
literally "ciscoEnvMonTemperatureValue — first temperature sensor", "hrProcessorLoad — first
processor" (`SnmpVendorTemplate.ts`). A modular chassis or switch stack has dozens of sensors; fans,
PSUs, optics light levels, stack members, and PoE budgets are not modeled at all. The first failed
fan in slot 7 is exactly the early warning a network product exists to give.

**Design sketch.**

- *Probe:* walk ENTITY-SENSOR-MIB `entPhySensorTable` joined against `entPhysicalTable` (already
  walked for chassis identity) for sensor names/positions; vendor fallbacks where ENTITY-SENSOR is
  absent (CISCO-ENVMON, MikroTik health — the template OIDs we already know). Add: optics/DOM
  rx/tx power per lane for interface health, stack-member rows (per-member serial/role/state), and
  POWER-ETHERNET-MIB `pethMainPseTable` for PoE budget/consumption. All of it best-effort per table
  (the shipped ifXTable pattern: a failed walk leaves the stored snapshot, never half-clears it) and
  inside a phase budget like the endpoint walks.
- *Models:* `NetworkDeviceSensor` (Postgres — sensor type, name, physical position, latest value,
  operational status, source MIB) as the inventory/status row; per-sensor history through the metrics
  pipeline. Interface optics readings hang off `NetworkInterface`.
- *UI:* hardware tab per device — sensor table grouped by type, PSU/fan status, stack view, PoE
  budget bar; optics levels on the interface panel.
- *Alerting:* sensor status + threshold criteria (device-reported thresholds from
  `entSensorThresholdTable` when present, user-defined otherwise).

**Dependencies.** A metric-cardinality decision: hundreds of sensors × poll rate is real volume —
proposal: poll sensors on a slower cadence than interfaces (e.g. 5× the interval), status row every
poll, metric point on the slow cadence.

**Open questions.**
- Do vendor templates stay (as the alertable-scalar quick path) or get absorbed once tables exist?
- Sensor identity across reboots: `entPhysicalIndex` is not guaranteed stable — key sensors on
  physical name + position rather than index?
- How much of this folds into epic 3 (an AP's radios are ENTITY rows too)?

## 10. Per-project NetFlow retention — S

**Problem.** `NetworkFlow` has a fixed 30-day TTL. The model comment already defers this: *"Fixed-
window TTL for now; per-project retention (a retentionDate column computed at ingest, like
Log/Metric) is the phase-2 follow-up."* Flows are the highest-volume rows in the product; retention
is both a cost lever and a sales checkbox (some shops must keep 90+ days, some want 7).

**Design sketch.**

- Follow the Log/Metric pattern exactly: `retentionDate` column computed at ingest from the project's
  data-retention setting, TTL keyed on it (`retentionDate DELETE`), default preserved at 30 days for
  projects with no setting. Keep the server-assigned-time property the current TTL has (retention
  derives from `ingestedAt`, so a device with a wrong clock cannot expire rows early). Existing rows:
  ALTER adds the column with a default derived from `ingestedAt + 30d` — no backfill scan needed if
  the default expression handles it; verify against the oldest supported ClickHouse (the model
  comment's 24.x `BAD_TTL_EXPRESSION` incident is the cautionary tale — TTL expressions must stay
  version-portable or they take the whole boot schema-sync down).

**Dependencies.** Purely a product/billing decision: retention caps per plan.

**Open questions.**
- Plan limits (proposal: cap by plan, hard ceiling regardless of plan since flow volume is unmetered
  today).
- Does flow volume itself need metering/billing before long retention is offered?
