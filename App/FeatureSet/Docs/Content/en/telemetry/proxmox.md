# OneUptime Proxmox Agent

## Overview

The OneUptime Proxmox Agent is a pre-configured OpenTelemetry Collector that monitors Proxmox VE clusters — nodes, QEMU VMs, LXC containers, storage, and HA state. It scrapes [prometheus-pve-exporter](https://github.com/prometheus-pve/prometheus-pve-exporter) (optionally running the exporter for you), stamps every metric with your cluster identity, and forwards everything to OneUptime over OTLP. One `.env` file, one `docker compose up`.

This page is the **installation guide**. For configuring Proxmox monitors and alerts on top of the data the agent collects, see [Proxmox Monitor](/docs/monitor/proxmox-monitor).

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on any machine that can reach your Proxmox VE API (port 8006)
- A Proxmox VE API token with the **PVEAuditor** role (read-only)
- A **OneUptime Telemetry Ingestion Token** — create one from *Project Settings → Telemetry Ingestion Keys* and copy the value

### Create the Proxmox API Token

1. In the Proxmox web UI go to *Datacenter → Permissions → API Tokens* and click **Add**.
2. Pick (or create) a user, give the token an ID like `oneuptime`, and **uncheck Privilege Separation** (or grant the token its own permissions in the next step).
3. Under *Datacenter → Permissions* add a permission on path `/` for the token with the **PVEAuditor** role.
4. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.

## Quick Start (Install Script)

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/ProxmoxAgent/install.sh -o install.sh
bash install.sh
```

The script prompts for your OneUptime URL, telemetry ingestion token, cluster name, and Proxmox API details, installs to `/opt/oneuptime-proxmox-agent`, and starts the agent with Docker Compose.

## Alternative — Docker Compose

Download the two files from the [ProxmoxAgent directory](https://github.com/OneUptime/oneuptime/tree/master/ProxmoxAgent) — `docker-compose.yml` and `otel-collector-config.yaml` — into a folder, then create a `.env` file next to them:

```bash
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
PROXMOX_CLUSTER_NAME=my-proxmox-cluster
PVE_HOST=192.168.1.10
PVE_API_TOKEN_ID=oneuptime@pve!exporter
PVE_API_TOKEN_SECRET=your-token-secret
COMPOSE_PROFILES=pve-exporter
```

Start it (the `pve-exporter` profile also starts the bundled exporter container):

```bash
docker compose up -d
```

That is it. Once the agent connects, your cluster will appear automatically in the **Proxmox** section of the OneUptime dashboard.

If you already run prometheus-pve-exporter somewhere, drop `COMPOSE_PROFILES`, `PVE_API_TOKEN_ID`, and `PVE_API_TOKEN_SECRET` and point the agent at it instead:

```bash
PVE_EXPORTER_URL=your-exporter-host:9221
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (for example `https://oneuptime.com` or your self-hosted host) |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion token from *Project Settings → Telemetry Ingestion Keys* |
| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime, stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it later registers a second cluster. Defaults to `proxmox-cluster` |
| `PVE_HOST` | Yes | Proxmox VE API host (any node of the cluster) the exporter queries, e.g. `192.168.1.10` |
| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |
| `PVE_API_TOKEN_ID` | Bundled exporter only | Full Proxmox API token id, e.g. `oneuptime@pve!exporter` |
| `PVE_API_TOKEN_SECRET` | Bundled exporter only | Proxmox API token secret |
| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate. Defaults to `false` because Proxmox ships self-signed certificates |
| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |

## Verify the Installation

Check that the agent is running:

```bash
docker compose ps
```

Check the collector logs:

```bash
docker logs -f oneuptime-proxmox-agent
```

Look for: `"Everything is ready. Begin running and processing data."`

Within a minute or so the cluster should appear in the OneUptime dashboard with metrics flowing.

## What Gets Collected

The agent scrapes the exporter every 30 seconds with both the cluster and node collectors enabled. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:

| Category | Metrics |
|----------|---------|
| **Availability** | `pve_up`, `pve_uptime_seconds` |
| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |
| **Guest (VM / LXC)** | `pve_guest_info`, CPU / memory / network series on `qemu/*` and `lxc/*` ids (`pve_network_receive_bytes`, `pve_network_transmit_bytes`) |
| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes` |
| **HA** | `pve_ha_state` |

## Zero-install Alternative — Proxmox VE 9+ Native OpenTelemetry Push

Proxmox VE 9.0 and later ship a built-in **OpenTelemetry metric server** that pushes node, guest, and storage metrics to any OTLP/HTTP endpoint — no agent or exporter to install. Configure it under *Datacenter → Metric Server → Add → OpenTelemetry*:

| Field | Value |
|-------|-------|
| Server | Your OneUptime host, e.g. `oneuptime.com` (or your self-hosted host) |
| Port | `443` |
| Protocol | `https` |
| Path | `/otlp/v1/metrics` |
| Headers | `{"x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"}` |

Two trade-offs to be aware of:

1. **Cluster discovery.** The agent path is what powers cluster auto-registration in OneUptime, because it stamps the `proxmox.cluster.name` resource attribute on every metric. With the native push, set the metric server's *Resource Attributes* option to `proxmox.cluster.name=my-proxmox-cluster` so the cluster registers itself — without it the metrics ingest into your project but no Proxmox cluster appears.
2. **Different metric names.** The native push emits `proxmox_node_*` / `proxmox_vm_*` / `proxmox_storage_*` series, while the agent emits pve-exporter's `pve_*` series. OneUptime's built-in Proxmox metric catalog and alert templates target the `pve_*` names, so the agent path is recommended; the native push is great as a zero-install way to get raw metrics into [Metrics Explorer](/docs/monitor/metrics-monitor) and custom dashboards.

You can also run both: native push for low-latency raw metrics, agent for discovery, the Proxmox dashboard pages, and alert templates.

## Run as a systemd Service

```bash
sudo cp systemd/oneuptime-proxmox-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-proxmox-agent
```

The unit assumes the agent lives in `/opt/oneuptime-proxmox-agent` (the install script default).

## Upgrading the Agent

```bash
cd /opt/oneuptime-proxmox-agent
docker compose pull
docker compose up -d
```

## Uninstalling the Agent

```bash
cd /opt/oneuptime-proxmox-agent
docker compose down
```

## Self-hosted OneUptime

If you are self-hosting OneUptime, set `ONEUPTIME_URL` to your own instance:

```bash
ONEUPTIME_URL=https://your-oneuptime-host.example.com
```

If your instance is HTTP-only, use `http://` and the appropriate port.

## Troubleshooting

### No cluster appears in OneUptime

1. Check the collector logs: `docker logs oneuptime-proxmox-agent` — a `401` on export means a bad ingestion token, connection refused means a wrong `ONEUPTIME_URL`.
2. Verify the exporter scrape works. The bundled exporter does not publish its port on the host, so test from inside its network namespace: `docker run --rm --network container:oneuptime-pve-exporter curlimages/curl -s "http://localhost:9221/pve?target=YOUR_PVE_HOST" | head` should print `pve_*` metric lines. (For an external exporter, `curl` its `host:9221` directly.)
3. Make sure `PROXMOX_CLUSTER_NAME` is set — discovery keys on the `proxmox.cluster.name` resource attribute.

### The exporter logs 401 / authentication errors

The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the token has the **PVEAuditor** role on path `/` (with privilege separation either disabled or permissions granted to the token itself).

### Only node metrics, no guest metrics

Guest series (`qemu/*`, `lxc/*` ids) come from the exporter's cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized `otel-collector-config.yaml`, restore the `cluster: ["1"]` param.

### Metrics land under the wrong cluster

OneUptime auto-registers Proxmox clusters by `proxmox.cluster.name`, taken from the `PROXMOX_CLUSTER_NAME` environment variable. Changing it after the first telemetry batch creates a second cluster row rather than renaming the existing one.

## Next steps

- Configure **Proxmox Monitors** to alert on node, guest, storage, and HA conditions — see [Proxmox Monitor](/docs/monitor/proxmox-monitor).
- Monitoring Ceph as the storage backend of your Proxmox cluster? Pair this agent with the [OneUptime Ceph Agent](/docs/telemetry/ceph).
- For the OS-level view of individual hosts, use the [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
