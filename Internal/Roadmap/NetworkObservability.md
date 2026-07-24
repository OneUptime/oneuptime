# Network Observability — Roadmap

> Engineering roadmap for the network-monitoring epics that are **not** in the current PR.
> Baseline below reflects the codebase as of **2026-07-24**. When an epic is picked up, spin its design
> section out into its own doc (the `CodeFixSandboxDesign.md` precedent) and replace the section here
> with a link + status. Revisit sizing when adjacent epics land — several of these get cheaper together.

---

## 0. Shipped baseline (what the network product already covers)

So this doc reads standalone: everything below exists today and is the substrate the epics build on.

| Area | What ships | Code entry points |
|---|---|---|
| SNMP polling + inventory | v1/v2c/v3 (incl. OpenSSL-3 DES compat shim), system-group scalars, ENTITY-MIB chassis identity (vendor/model/serial/firmware), vendor health-OID templates (CPU/memory/temperature) | `Probe/Utils/Monitors/MonitorTypes/SnmpMonitor.ts`, `Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate.ts`, `Common/Models/DatabaseModels/NetworkDevice.ts` |
| Interface monitoring | IF-MIB walk with 64-bit HC counters (32-bit fallback), rates/utilization/errors per interface | `Common/Models/DatabaseModels/NetworkInterface.ts` |
| Topology | LLDP + CDP neighbor walks; opt-in ARP + FDB endpoint collection (row-bounded walks, wall-clock deadline) | `SnmpMonitor.ts` (endpoint phase), `Common/Models/DatabaseModels/NetworkEndpoint.ts` |
| Sites | Site hierarchy, site links, status rollups + uptime timeline, device-to-site assignment rules | `NetworkSite.ts`, `NetworkSiteLink.ts`, `NetworkSiteStatusTimeline.ts`, `NetworkSiteAssignmentRule.ts` |
| Discovery | Subnet sweeps (ICMP pre-sweep + SNMP probe; ping-only hosts kept for unmanaged gear) | `Probe/Utils/Discovery/SubnetScanner.ts`, `NetworkDeviceDiscoveryScan.ts` |
| Flow analytics | NetFlow v5 receiver → `NetworkFlow` ClickHouse table (top talkers / bandwidth attribution; fixed 30-day TTL). **NetFlow v9 ships in the current PR.** | `Probe/Services/NetFlowReceiver.ts`, `Probe/Utils/NetFlow/NetFlowV5Parser.ts`, `Common/Models/AnalyticsModels/NetworkFlow.ts` |
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
| 5 | sFlow + IPFIX ingestion | M | NetFlow v9 template machinery (current PR) |
| 6 | Topology history | M | None |
| 7 | Interface flap detection | S/M | None |
| 8 | Native ScheduledMaintenance + StatusPage relations | M | None |
| 9 | Full hardware sensor tables | L | Metric-cardinality plan |
| 10 | Per-project NetFlow retention | S | Billing/plan decision only |

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
    `snmpV3PrivKey`) are plain columns — NCM must not copy that pattern, and migrating those columns
    to encrypted storage should ride along with this epic.
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

**Problem.** NetFlow v5 shipped earlier and **NetFlow v9 ships in the current PR** — but sFlow-only
gear (much of the switching world) and IPFIX-only gear export nothing we can read.

**Design sketch.**

- *IPFIX (RFC 7011):* structurally NetFlow v9's sibling — reuse the v9 per-exporter template cache
  from the current PR; add variable-length fields and enterprise-specific IEs (which we can skip
  unknown-field-safe). Same UDP receiver, version-dispatched per datagram header.
- *sFlow (v5):* different animal — sampled packet headers, not flow records, on its own conventional
  port (6343). Parse the flow-sample structures, decode the raw header far enough for the 5-tuple,
  and scale octets/packets by the sampling rate.
- *Normalization:* everything lands as `NetworkFlow` rows (exporter-correlated to a `NetworkDevice`
  at ingest, same drop rule for unknown exporters). Add `samplingRate` (1 = unsampled) so sampled
  sFlow rows are never mistaken for exact byte counts in top-talker math; queries multiply through.
- *Probe config:* per-receiver enable flags + ports, mirroring the shipped NetFlow/trap/syslog
  receiver config surface.

**Dependencies.** NetFlow v9 template machinery (current PR).

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
