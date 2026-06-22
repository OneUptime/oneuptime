# DRAFT — Proxmox & Ceph launch post (for the `oneuptime/blog` repo)

> **⚠️ This file is a DRAFT and lives in the product repo only for review.**
> The published post belongs in the separate **`oneuptime/blog`** repository
> (posts are pulled into oneuptime.com every 3 hours by `Home/Jobs/UpdateBlog.ts`).
> Do **not** publish from this repo, and do not merge this file's content into
> docs — it is marketing copy, not documentation.
>
> **Target location in the blog repo:** `posts/YYYY-MM-DD-monitor-proxmox-and-ceph/README.md`
> (date prefix in the folder name is the publish date — set it when publishing).
> Register the post in the blog repo's post index, pick tags from `Tags.md`,
> and set the author from `Authors.json`, per that repo's conventions.

## Publishing checklist (all boxes before merge in the blog repo)

- [ ] **Landing pages live first:** `https://oneuptime.com/product/proxmox` and
      `https://oneuptime.com/product/ceph` (WI-31) are deployed and return 200.
- [ ] **Docs pages final:** `/docs/telemetry/proxmox`, `/docs/telemetry/ceph`,
      `/docs/monitor/proxmox-monitor`, `/docs/monitor/ceph-monitor` reflect the
      shipped feature set (WI-24/25/26/27 all edit these pages — wait for them).
- [ ] **Release merge timed with the post:** the features below ship in the
      release that promotes `master` → `release` (VERSION bump +
      `sync-package-versions`). Publish the post after that release is live on
      oneuptime.com, not before.
- [ ] **Verify the template counts** in the comparison tables against the shipped
      code: 11 Proxmox templates (`Common/Types/Monitor/ProxmoxAlertTemplates.ts`)
      and ~21 Ceph templates (`Common/Types/Monitor/CephAlertTemplates.ts`).
      Update the numbers below if the final count differs.
- [ ] **TODO media** (record against a real PVE+Ceph lab, light theme, no
      customer data):
  - [ ] TTFV walkthrough **GIF**: empty state → create key inline → paste
        command → `pveum` two-liner → list flips to "Connected" without refresh.
  - [ ] Screenshot: Proxmox Overview hero with the **Backup coverage** tile red.
  - [ ] Screenshot: **Replication** card with a failed sync row.
  - [ ] Screenshot: Ceph Overview — health pill + "why" drill-down open.
  - [ ] Screenshot: Ceph OSD honeycomb / guest wall widget.
  - [ ] `social-media.png` for the post folder.
- [ ] **No official logos:** any artwork uses OneUptime's generic glyphs
      (server-stack for Proxmox, hexagon-cluster for Ceph). Proxmox is a
      trademark of Proxmox Server Solutions GmbH; Ceph is a trademark of the
      Ceph Foundation — keep the trademark footnote at the bottom of the post.

---

# Monitor Proxmox VE and Ceph with OneUptime

If you run Proxmox VE — and especially if you run Ceph under it — your
monitoring story has probably been one of these: a Datadog bill that grows with
every host, a self-hosted Grafana + Prometheus + Alertmanager stack you now
also have to monitor, or a dashboard you check manually and hope for the best.

Today we're launching first-class **Proxmox** and **Ceph** monitoring in
OneUptime: two full products with inventory, dashboards, logs, and ready-made
alert templates — built on the same open-source, OpenTelemetry-native platform
that already monitors your websites, APIs, Kubernetes clusters, and Docker
hosts. Flat project pricing. No per-host billing. No Grafana bolt-on.

<!-- TODO: hero screenshot — Proxmox Overview page -->

## Ten minutes from signup to "Connected"

The agent is deliberately boring: a stock OpenTelemetry Collector container
with a tuned config that scrapes
[prometheus-pve-exporter](https://github.com/prometheus-pve/prometheus-pve-exporter)
(for Proxmox) or the Ceph mgr's built-in `prometheus` module (for Ceph) and
ships everything to OneUptime over OTLP. One agent covers the whole cluster.

Here's the entire onboarding path:

1. **Open Proxmox in the OneUptime dashboard.** The empty state shows the full
   setup guide — you never leave the page.
2. **Create a telemetry ingestion key inline.** One click, no detour through
   settings.
3. **Mint a read-only Proxmox API token** with two copy-paste commands on any
   PVE node — no clicking through the Proxmox permissions UI:

   ```bash
   pveum user token add monitoring@pam oneuptime --privsep 1
   pveum acl modify / --roles PVEAuditor --tokens 'monitoring@pam!oneuptime'
   ```

4. **Download the two agent files, fill a five-line `.env`, run
   `docker compose up -d`.** The compose file can run the exporter for you, or
   point at one you already have.
5. **Watch the page flip to "Connected."** The cluster list polls for first
   data and switches from setup guide to live table on its own — no refresh.

For Ceph it's even shorter: `ceph mgr module enable prometheus`, then the same
`.env` + `docker compose up -d`.

If something's wrong, you're not guessing: the agent ships with a
`troubleshoot.sh` script and the platform exposes a token validation endpoint,
so "is my key right, is data arriving" is a command, not a support ticket.

<!-- TODO: TTFV walkthrough GIF here -->

## Backup coverage: the question your hypervisor can't answer at 2 a.m.

The question every Proxmox operator eventually asks is _"which guests are not
in any backup job?"_ — usually right after discovering the answer the hard way.

OneUptime answers it on the Proxmox Overview: a **Backup coverage** tile
("18 of 20 guests in a backup job") that goes red the moment any guest is
uncovered, a per-guest **Backup** column on the guest list, and a shipped alert
template (`pve-guest-not-backed-up`) so an uncovered guest pages you instead of
waiting to be noticed. Among the tools we benchmarked — Datadog, PRTG, Checkmk,
Zabbix — no SaaS product ships this view.

**The honest boundary:** this is backup _job coverage_, not backup _freshness_.
"In a backup job" does not mean "backed up recently and successfully" —
Proxmox only exposes freshness through its task-log and PBS APIs, which the
config-only agent doesn't poll (yet — that's on the roadmap). We'd rather tell
you exactly what the number means than imply more than the data supports.

<!-- TODO: screenshot — Backup coverage tile + Guests backup column -->

## Storage replication health: a first

If you use Proxmox storage replication (`pvesr`) as your cheap HA layer, a
silently failing replication job means your "replica" is a snapshot from last
Tuesday. As far as we can tell, **no other SaaS monitoring product covers
Proxmox storage replication at all** — Datadog's integration has no replication
metrics, and neither do PRTG, Zabbix, or Checkmk.

OneUptime ships a **Replication** card on the cluster Overview — every job with
guest, source → target, last sync age, duration, and failed-sync count — plus
an alert template (`pve-replication-failing`) that fires per job the moment
syncs start failing, and replication charts in Insights. Sync _staleness_
(amber after 1 h, red after 6 h) is surfaced in the UI; the alert fires on
failed syncs, which is the signal the data can honestly support today.

<!-- TODO: screenshot — Replication card with a failed row -->

## Ceph health that explains itself — no Grafana required

The upstream Ceph Dashboard is genuinely good — and its most common operator
gripe is that the moment you want real graphs or alerts, you're deploying and
maintaining Grafana, Prometheus, and Alertmanager next to it.

OneUptime's Ceph product is complete by construction, in the same pane as the
rest of your monitoring:

- **A health pill with a "why":** `HEALTH_WARN` is a starting point, not an
  answer. The Overview breaks the status down into the active health checks
  behind it, so "why is it yellow" is one click.
- **Capacity with a forecast:** usage against the nearfull/full thresholds,
  plus a client-side growth fit — "at current growth, ~N days to 85%" — at the
  cluster, pool, and storage level.
- **The full inventory:** OSD up/in matrix and honeycomb, PG state breakdown,
  pool list with usage/IOPS/throughput, monitor quorum, and a cluster log
  viewer.
- **~21 shipped alert templates**, built from the health checks the Ceph mgr
  actually exports: PG damage and scrub errors, daemon crashes, slow ops
  (cluster-wide and per-daemon), OSD slow heartbeats, monitor clock skew and
  disk space, OSD nearfull/full, and more. That covers every
  [ceph-mixin](https://github.com/ceph/ceph-mixin) rule expressible from the
  mgr's `prometheus` module metrics — and where mixin rules need data the mgr
  doesn't export (SMART, per-daemon perf counters, RBD-mirror), we say so in
  the docs instead of shipping templates that can never fire.
- **A fleet view for free:** every Ceph cluster in the project on one list page
  with health pills and capacity bars. The upstream dashboard only gained
  multi-cluster views in recent releases.

And because most serious Proxmox clusters run Ceph: link a Ceph cluster to its
Proxmox cluster and each Overview gets a cross-link card with the other's
health and capacity at a glance.

<!-- TODO: screenshot — Ceph Overview, health drill-down open -->

## How it compares

Distilled from our benchmark against Datadog's Proxmox integration, PRTG's PVE
sensors, Pulse, Checkmk, Zabbix, the upstream Ceph Dashboard, and ceph-mixin
(June 2026):

### Proxmox

| Capability                                          | Datadog             | PRTG                | Pulse            | Checkmk    | Zabbix           | OneUptime                         |
| --------------------------------------------------- | ------------------- | ------------------- | ---------------- | ---------- | ---------------- | --------------------------------- |
| Single agent covers the whole cluster               | ✅                  | ✅                  | ✅               | ✅         | ✅               | ✅                                |
| Backup coverage ("which guests have no backup job") | ✗                   | ✗                   | ✅               | partial    | ✗                | ✅                                |
| Storage replication health                          | ✗                   | ✗                   | ✗                | ✗          | ✗                | ✅                                |
| HA resource state monitoring                        | ✅                  | ✗                   | ✅               | ✗          | ✗                | ✅                                |
| Shipped alert/monitor templates                     | 4                   | channel limits      | defaults         | rule packs | triggers         | 11                                |
| At-a-glance guest wall / honeycomb                  | ✗                   | ✗                   | ✅               | ✗          | ✗                | ✅                                |
| Full Ceph product alongside PVE                     | ✗ (no Ceph metrics) | status channel only | ✗                | ✗          | ✗                | ✅                                |
| Copy-paste token setup + validation endpoint        | ✗                   | ✗                   | ✅               | ✗          | ✗                | ✅                                |
| Pricing                                             | ~$15–23/host/mo     | per-sensor          | free (self-host) | licensed   | free (self-host) | flat project pricing, open source |

Pulse is excellent — and self-hosted, Proxmox-only. If you want its best ideas
_plus_ uptime checks, status pages, on-call, incident management, logs, and
APM in one open-source platform, that's exactly the gap this launch fills.

### Ceph

| Capability                                      | Upstream Dashboard   | ceph-mixin                            | OneUptime                               |
| ----------------------------------------------- | -------------------- | ------------------------------------- | --------------------------------------- |
| Health pill + "why" breakdown                   | ✅                   | 2 rules                               | ✅                                      |
| Works without Grafana/Alertmanager bolt-on      | ✗ (embedded Grafana) | ✗ (requires stack)                    | ✅                                      |
| Capacity forecasting in the UI                  | ✗                    | alerts only                           | ✅ (cluster, pool, storage)             |
| OSD matrix, PG states, pool metrics, mon quorum | ✅                   | ✅                                    | ✅                                      |
| Shipped alert templates                         | —                    | ~85 rules (many need extra exporters) | ~21, all firable from mgr metrics alone |
| Multi-cluster fleet view                        | recent releases only | single dashboard                      | ✅                                      |
| Cluster log viewer                              | ✅                   | n/a                                   | ✅                                      |

## What we deliberately did not ship (yet)

We have a hard rule: **no invented metrics.** Everything above is built on data
the Proxmox exporter and Ceph mgr verifiably emit today. Some things need the
PVE, PBS, or Ceph APIs directly, and they're on the roadmap as a future
API-agent track rather than faked now:

- Per-guest backup **freshness, success, and size** (vzdump task logs / PBS API)
- Snapshot age and snapshot trees
- PVE task event streams (migrations, vzdump runs, apt updates)
- Proxmox Backup Server monitoring as a product
- RGW and CephFS deep views (per-daemon perf counters live in the separate
  ceph-exporter since Reef)
- SMART / device-failure prediction (the mgr exports no SMART data)
- Forecast-based and replication-staleness _alerting_ (today these are UI
  signals; the alert engine evaluates metrics, not wall-clock math)

If a vendor tells you they alert on something in this list using only exporter
metrics, ask them which metric.

## Get started

- **Proxmox:** [oneuptime.com/product/proxmox](https://oneuptime.com/product/proxmox)
  · [agent setup docs](https://oneuptime.com/docs/telemetry/proxmox)
  · [monitors & alerts docs](https://oneuptime.com/docs/monitor/proxmox-monitor)
- **Ceph:** [oneuptime.com/product/ceph](https://oneuptime.com/product/ceph)
  · [agent setup docs](https://oneuptime.com/docs/telemetry/ceph)
  · [monitors & alerts docs](https://oneuptime.com/docs/monitor/ceph-monitor)

Sign up free at [oneuptime.com](https://oneuptime.com), or self-host — the
whole platform is open source under Apache 2.0:
[github.com/OneUptime/oneuptime](https://github.com/OneUptime/oneuptime).
Ten minutes from now, your cluster can be on a status page.

---

_Proxmox® is a registered trademark of Proxmox Server Solutions GmbH. Ceph and
the Ceph logo are trademarks of the Ceph Foundation. OneUptime is not
affiliated with, endorsed by, or sponsored by either project; product names are
used solely to identify compatibility._
