# OneUptime Ceph Agent

Monitor Ceph clusters — health, mon quorum, OSDs, pools, and placement groups — with OneUptime using a pre-configured OpenTelemetry Collector.

The agent is config-only: a stock `otel/opentelemetry-collector-contrib` container with a tuned config that scrapes the Ceph mgr `prometheus` module on every mgr daemon, stamps the data with your cluster identity, and ships it to OneUptime over OTLP.

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on any machine that can reach your Ceph mgr daemons (port 9283)
- The Ceph mgr `prometheus` module enabled (see below)
- A **OneUptime Telemetry Ingestion Key** — create one from *Project Settings → Telemetry Ingestion Keys*

### Enabling the mgr prometheus module

```bash
ceph mgr module enable prometheus
```

Every mgr daemon then serves the exposition format on port `9283` at `/metrics`. Note that **only the active mgr returns metrics** — standby mgrs answer with an empty response (or an HTTP error if you set `mgr/prometheus/standby_behaviour` to `error`). That is why the agent scrapes **all** mgr endpoints: when the active mgr fails over, metrics keep flowing with no config change.

To list your mgr daemons:

```bash
ceph mgr stat            # active mgr
ceph orch ps --daemon-type mgr   # all mgrs (cephadm clusters)
```

## Quick Start — Install Script

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/CephAgent/install.sh -o install.sh
bash install.sh
```

The script prompts for your OneUptime URL, telemetry ingestion key, cluster name, and mgr endpoints, installs to `/opt/oneuptime-ceph-agent`, and starts the agent with Docker Compose.

## Quick Start — Docker Compose

Download `docker-compose.yml` and `otel-collector-config.yaml` from this directory into a folder, then create a `.env` file next to them:

```bash
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_TELEMETRY_INGESTION_KEY=your-telemetry-ingestion-key
CEPH_CLUSTER_NAME=my-ceph-cluster
CEPH_MGR_ENDPOINTS=[ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283]
```

Then start the agent:

```bash
docker compose up -d
```

The cluster will appear automatically in the **Ceph** section of OneUptime.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key (*Project Settings → Telemetry Ingestion Keys*) |
| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |
| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283]`. The install script adds the brackets for you |

## Scrape Behavior

- **All mgrs are scraped** (active + standbys) so metrics survive active-mgr failover.
- **`honor_labels: true`** — the labels Ceph exports (`ceph_daemon`, `pool_id`, instance labels) are kept as-is. Without it, the per-target `instance` label would flip every time the active mgr changes and break series continuity.
- **30-second scrape interval.** The mgr prometheus module caches scrapes for `mgr/prometheus/scrape_interval` (default 15 seconds) — never scrape below 15 seconds, you would only re-read the cache.

## Collected Metrics

- **Cluster Health**: `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), `ceph_mon_quorum_status`, `ceph_cluster_total_bytes`, `ceph_cluster_total_used_bytes`
- **OSD**: `ceph_osd_up`, `ceph_osd_in` (per `ceph_daemon` label, e.g. `osd.3`)
- **Pool**: `ceph_pool_stored`, `ceph_pool_max_avail`, `ceph_pool_objects`, `ceph_pool_rd`, `ceph_pool_wr`, `ceph_pool_rd_bytes`, `ceph_pool_wr_bytes`
- **Placement Groups**: `ceph_pg_active`, `ceph_pg_degraded`, `ceph_pg_undersized`

## Optional Extra Scrape Targets

The mgr module covers cluster-level health and capacity. For deeper visibility you can add more jobs to `otel-collector-config.yaml` under `scrape_configs`:

- **`ceph-exporter` (Reef 18.2+)** — cephadm deploys a `ceph-exporter` daemon on every host that serves per-daemon performance counters on port `9926`. Add one target per host.
- **`node_exporter`** — the standard pairing for OS-level metrics (CPU, RAM, disks, network) on each Ceph host, default port `9100`.

Both inherit the `ceph.cluster.name` resource attribute from the shipped `resource` processor, so they land on the same cluster in OneUptime.

## Run as a systemd Service

To survive reboots without relying on Docker's restart policy alone, install the provided unit:

```bash
sudo cp systemd/oneuptime-ceph-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-ceph-agent
```

The unit assumes the agent lives in `/opt/oneuptime-ceph-agent` (the install script default).

## Upgrading

```bash
cd /opt/oneuptime-ceph-agent
docker compose pull
docker compose up -d
```

## Uninstalling

```bash
cd /opt/oneuptime-ceph-agent
docker compose down
```

## Troubleshooting

### No cluster appears in OneUptime

1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).
2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.
3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.

### Metrics stop after a mgr failover

You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.

### Scrape errors for standby mgrs in the collector logs

Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.

### Common Commands

```bash
# Check agent status
docker compose ps

# View collector logs
docker logs -f oneuptime-ceph-agent

# Check which mgr is active
ceph mgr stat

# Test a mgr metrics endpoint by hand
curl http://<mgr-host>:9283/metrics | head
```
