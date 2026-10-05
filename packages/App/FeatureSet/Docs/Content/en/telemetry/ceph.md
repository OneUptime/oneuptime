# OneUptime Ceph Agent

## Overview

The OneUptime Ceph Agent is a pre-configured OpenTelemetry Collector that monitors Ceph clusters — health status, mon quorum, OSDs, pools, and placement groups. It scrapes the Ceph mgr `prometheus` module on **every** mgr daemon (so metrics survive active-mgr failover), stamps every metric with your cluster identity, and forwards everything to OneUptime over OTLP. One `.env` file, one `docker compose up`.

This page is the **installation guide**. For configuring Ceph monitors and alerts on top of the data the agent collects, see [Ceph Monitor](/docs/monitor/ceph-monitor).

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on any machine that can reach your Ceph mgr daemons (port 9283)
- The Ceph mgr `prometheus` module enabled (see below)
- A **OneUptime Telemetry Ingestion Token** — create one from _Project Settings → Telemetry & APM → Ingestion Keys_ and copy the value

### Enable the mgr Prometheus Module

```bash
ceph mgr module enable prometheus
```

Every mgr daemon then serves Prometheus metrics on port `9283` at `/metrics`. **Only the active mgr returns metrics** — standby mgrs answer with an empty response (or an HTTP error if `mgr/prometheus/standby_behaviour` is set to `error`). That is why the agent scrapes all mgr endpoints: when the active mgr fails over, metrics keep flowing with no config change.

To list your mgr daemons:

```bash
ceph mgr stat                    # active mgr
ceph orch ps --daemon-type mgr   # all mgrs (cephadm clusters)
```

## Quick Start (Install Script)

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/CephAgent/install.sh -o install.sh
bash install.sh
```

The script prompts for your OneUptime URL, telemetry ingestion token, cluster name, and mgr endpoints — and whether the [AI agent](#ai-agent) may apply fixes, offering to create the AI agent's own Ceph client with this machine's admin access — installs to `/opt/oneuptime-ceph-agent`, and starts the agent with Docker Compose.

## Alternative — Docker Compose

Download the two files from the [CephAgent directory](https://github.com/OneUptime/oneuptime/tree/master/agents/CephAgent) — `docker-compose.yml` and `otel-collector-config.yaml` — into a folder (the AI agent also reads a `ceph/` folder next to them: see [AI agent](#ai-agent)), then create a `.env` file next to them:

```bash
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
CEPH_CLUSTER_NAME=my-ceph-cluster
CEPH_MGR_ENDPOINTS=[ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283]
```

> List **every** mgr daemon (active and standbys), comma-separated and wrapped in square brackets — the brackets make the collector parse the value as a list of scrape targets.

Start it:

```bash
docker compose up -d
```

That is it. Once the agent connects, your cluster will appear automatically in the **Ceph** section of the OneUptime dashboard.

## Environment Variables

| Variable                            | Required | Description                                                                                                                                                                                     |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`                     | Yes      | Your OneUptime instance URL (for example `https://oneuptime.com` or your self-hosted host)                                                                                                      |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes      | Telemetry ingestion token from _Project Settings → Telemetry & APM → Ingestion Keys_                                                                                                                    |
| `CEPH_CLUSTER_NAME`                 | Yes      | Cluster identifier shown in OneUptime, stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it later registers a second cluster. Defaults to `ceph` |
| `CEPH_MGR_ENDPOINTS`                | Yes      | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283]`. The install script adds the brackets for you     |

## How the Agent Scrapes

- **All mgrs, 30-second interval.** The mgr prometheus module caches each scrape for `mgr/prometheus/scrape_interval` (default 15 seconds). Never scrape below 15 seconds — you would only re-read the cache. 30 seconds is the shipped default.
- **`honor_labels: true`.** The labels Ceph exports (`ceph_daemon`, `pool_id`, per-daemon instance labels) are kept as-is. Without it, the `instance` label would be rewritten per scrape target and flip every time the active mgr changes, breaking series continuity.

## Verify the Installation

Check that the agent is running:

```bash
docker compose ps
```

Check the collector logs:

```bash
docker logs -f oneuptime-ceph-agent
```

Look for: `"Everything is ready. Begin running and processing data."`

Within a minute or so the cluster should appear in the OneUptime dashboard with metrics flowing.

## What Gets Collected

The agent ships everything the mgr prometheus module exports. The series OneUptime's Ceph dashboard, metric catalog, and alert templates are built on:

| Category             | Metrics                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Cluster Health**   | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), `ceph_health_detail` (one series per **active** health check, labeled `name`/`severity` — Quincy and later; powers the health-check alert templates and the dashboard's "why" drill-down), `ceph_healthcheck_slow_ops`, `ceph_daemon_health_metrics` (per-daemon, keyed by `type`), `ceph_mon_quorum_status`, `ceph_mon_metadata`, `ceph_cluster_total_bytes`, `ceph_cluster_total_used_bytes` |
| **OSD**              | `ceph_osd_up`, `ceph_osd_in`, `ceph_osd_apply_latency_ms`, `ceph_osd_commit_latency_ms`, `ceph_osd_stat_bytes`, `ceph_osd_stat_bytes_used`, `ceph_osd_numpg`, `ceph_osd_metadata` — per OSD via the `ceph_daemon` label (e.g. `osd.3`)                                                                                                                                                                                                           |
| **Pool**             | `ceph_pool_stored`, `ceph_pool_max_avail`, `ceph_pool_objects`, `ceph_pool_rd`, `ceph_pool_wr`, `ceph_pool_rd_bytes`, `ceph_pool_wr_bytes`, `ceph_pool_metadata` — data series carry only a `pool_id` label; the pool name lives on `ceph_pool_metadata`                                                                                                                                                                                         |
| **Placement Groups** | `ceph_pg_total`, `ceph_pg_active`, `ceph_pg_clean`, `ceph_pg_degraded`, `ceph_pg_undersized` (all per pool, `pool_id` label), `ceph_num_objects_degraded`, `ceph_num_objects_misplaced`                                                                                                                                                                                                                                                          |

## Optional Extra Scrape Targets

The mgr module covers cluster-level health and capacity. For deeper visibility you can add more jobs under `scrape_configs` in `otel-collector-config.yaml`:

- **`ceph-exporter` (Reef 18.2+)** — cephadm deploys a `ceph-exporter` daemon on every cluster host serving per-daemon performance counters on port `9926`. Add one target per host.
- **`node_exporter`** — the standard pairing for OS-level metrics (CPU, RAM, disks, network) on each Ceph host, default port `9100`.

Both inherit the `ceph.cluster.name` resource attribute from the shipped `resource` processor, so they land on the same cluster in OneUptime.

## Optional — Ship the Ceph Cluster Log

The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which powers the **Cluster Log** page of the Ceph dashboard. It is off by default because it requires the agent to run on a host that has the cluster log (a mon host by default). To enable it:

1. Uncomment the `filelog` receiver and the `logs` pipeline in `otel-collector-config.yaml`.
2. Uncomment the `/var/log/ceph` volume mount in `docker-compose.yml`.
3. Restart: `docker compose up -d`

Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) at read time, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.

## Run as a systemd Service

```bash
sudo cp systemd/oneuptime-ceph-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-ceph-agent
```

The unit assumes the agent lives in `/opt/oneuptime-ceph-agent` (the install script default).

## Upgrading the Agent

The agent reports the collector version its files pin as its **Agent Version**. When that is older than the version this OneUptime release pins, a warning sign appears beside it on the cluster's **Overview**. Select it to see these commands. An agent installed before its files reported a version shows none until it is upgraded this way.

The collector image is pinned in `docker-compose.yml` and its config is a file next to it, so pulling alone does not move the agent forward. Download both files again (your `.env` stays; re-apply any change you made to the two files), then pull the images and recreate the agent so the collector reads its new config:

```bash
cd /opt/oneuptime-ceph-agent
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/CephAgent/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/CephAgent/otel-collector-config.yaml
docker compose pull
docker compose up -d --force-recreate
```

Installed it with Docker Compose in a folder of your own? Run the same commands there, without the `cd`.

## Uninstalling the Agent

```bash
cd /opt/oneuptime-ceph-agent
docker compose down
```

If you created the AI agent's Ceph client, remove it on an admin node with `ceph auth del client.oneuptime-ai`.

## Self-hosted OneUptime

If you are self-hosting OneUptime, set `ONEUPTIME_URL` to your own instance:

```bash
ONEUPTIME_URL=https://your-oneuptime-host.example.com
```

If your instance is HTTP-only, use `http://` and the appropriate port.

## Troubleshooting

### Run the diagnostic script first

The agent ships with a doctor script, [`troubleshoot.sh`](https://github.com/OneUptime/oneuptime/blob/master/agents/CephAgent/troubleshoot.sh), that checks the whole chain: container runtime, every configured mgr endpoint (including the active-vs-standby trap — only the active mgr serves metrics, so it warns loudly when no endpoint returns `ceph_health_status` or when only one endpoint is configured), cluster-name stamping, ingestion-token shape, collector self-metrics, and a **definitive server-side token validation**. The token check is the important one — OneUptime's OTLP endpoints refuse a bad ingestion token with `401` (`422` for a disabled key or a browser key), and the collector treats both as permanent: it drops the batch and logs one `Exporting failed` error for it, which is easy to miss while the container itself stays healthy. The script calls `GET <url>/otlp/v1/validate` from inside the agent's network namespace to get a direct `200` (valid) / `401` (invalid) verdict, falling back to `POST /fluentd/v1/logs` on older servers.

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/CephAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-ceph-agent
```

It ends with a VERDICT section naming the most likely root cause. The sections below cover the same ground manually.

### No cluster appears in OneUptime

1. Check the collector logs: `docker logs oneuptime-ceph-agent` — a `401` on export means a bad ingestion token, connection refused means a wrong `ONEUPTIME_URL`.
2. Verify a mgr serves metrics: `curl http://ACTIVE_MGR_HOST:9283/metrics | head` should print `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.
3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.

### Metrics stop after a mgr failover

You are probably scraping only the previously active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scraping standby mgrs is cheap and returns empty responses.

### Scrape errors for standby mgrs in the collector logs

Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so these are noise; switch the behaviour back to `default` to silence them.

### Metrics land under the wrong cluster

OneUptime auto-registers Ceph clusters by `ceph.cluster.name`, taken from the `CEPH_CLUSTER_NAME` environment variable. Changing it after the first telemetry batch creates a second cluster row rather than renaming the existing one.

## AI agent

The agent's `docker-compose.yml` also runs the **Ceph AI agent**, `oneuptime-ceph-ai-agent` (image `oneuptime/resource-ai-agent:release`). While OneUptime AI investigates an incident or alert on this cluster it runs read-only `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls` — and, only if you allow it, applies fixes such as marking an OSD back in or clearing `noout`. It registers as the cluster named `CEPH_CLUSTER_NAME`, like the collector, and shows up on the cluster's **AI → AI agent** page in OneUptime.

It connects as **its own Ceph client**, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml` (mounted read-only at `/etc/ceph`). The client's caps are the hard limit: with read caps, nothing the agent runs can change the cluster. On a Ceph admin node, in the install directory:

```bash
mkdir -p ceph
ceph config generate-minimal-conf > ceph/ceph.conf
ceph auth get-or-create client.oneuptime-ai mon 'allow r' mgr 'allow r' osd 'allow r' -o ceph/ceph.client.oneuptime-ai.keyring
sudo chown 1000:1000 ceph/ceph.client.oneuptime-ai.keyring
sudo chmod 600 ceph/ceph.client.oneuptime-ai.keyring
docker compose up -d
```

- **AI investigations are on by default.** Once the agent connects, OneUptime AI investigates incidents and alerts on this cluster with it, and the cluster's **Overview** shows the agent's status. To stop, set `ONEUPTIME_AI_INVESTIGATION=false` where the agent runs (**Change** under **What AI may do** on the AI agent page shows how), or leave the agent out.
- Never put the admin keyring there. `install.sh` offers to create the client for you.
- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true` and give the client the caps for the fixes (the agent's README lists them); `ONEUPTIME_AI_WRITE_TARGETS` (for example `osd.*,cluster`) limits what a fix may touch. `ONEUPTIME_AI_FIXES` in the same `.env` says how fixes run — `ask-for-approval` (a person approves each one), `automatic` or `bypass-approval` — and the AI agent page shows it read-only ([What AI may do, set by the agent](/docs/ai/infrastructure-ai-agents#what-ai-may-do-set-by-the-agent)).
- It connects out to the monitors (TCP 3300 and 6789) and the mgr and OSD daemons (TCP 6800–7300), runs as UID 1000 with no capabilities, and never runs `auth`, `config-key`, `tell` or anything that deletes data. Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml` if you do not use OneUptime AI.

What it may run, how fixes work and how to troubleshoot it: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).

## Next steps

- Configure **Ceph Monitors** to alert on health status, OSD availability, PG states, capacity, daemon crashes, clock skew, slow operations, and more — see [Ceph Monitor](/docs/monitor/ceph-monitor).
- Running Ceph as storage for Proxmox VE? Pair this agent with the [OneUptime Proxmox Agent](/docs/telemetry/proxmox).
- For the OS-level view of individual hosts, use the [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
