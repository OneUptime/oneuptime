# OneUptime Proxmox Agent

Monitor Proxmox VE clusters — nodes, QEMU VMs, LXC containers, storage, and HA state — with OneUptime using a pre-configured OpenTelemetry Collector.

The agent is config-only: a stock `otel/opentelemetry-collector-contrib` container with a tuned config that scrapes [prometheus-pve-exporter](https://github.com/prometheus-pve/prometheus-pve-exporter), stamps the data with your cluster identity, and ships it to OneUptime over OTLP. The compose file optionally runs the exporter for you, so a full install is one `.env` file and one `docker compose up`.

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on any machine that can reach your Proxmox VE API (port 8006)
- A Proxmox VE API token with the **PVEAuditor** role (read-only) — create one under *Datacenter → Permissions → API Tokens*
- A **OneUptime Telemetry Ingestion Key** — create one from *Project Settings → Telemetry Ingestion Keys*

### Creating the Proxmox API token

**Fastest path — run this on any PVE node** (shell as root):

```bash
pveum user token add monitoring@pam oneuptime --privsep 1
pveum acl modify / --roles PVEAuditor --tokens 'monitoring@pam!oneuptime'
```

(If the `monitoring@pam` user does not exist yet, create it first with `pveum user add monitoring@pam` — API tokens carry their own secret, so the user needs no password or system account.)

The ACL must sit at the root path `/` because **PVEAuditor** needs read access to every node, guest, and storage object the exporter walks — granting it on a narrower path hides the rest of the cluster and produces `401`/`403 Permission check failed (/, Sys.Audit)` errors. The first command prints the token secret once; in your `.env` that becomes `PVE_API_TOKEN_ID=monitoring@pam!oneuptime` and `PVE_API_TOKEN_SECRET=<the printed secret>`.

**Or via the Proxmox web UI:**

1. In the Proxmox web UI go to *Datacenter → Permissions → API Tokens* and click **Add**.
2. Pick (or create) a user, give the token an ID like `oneuptime`, and **uncheck Privilege Separation** (or grant the token its own permissions in the next step).
3. Under *Datacenter → Permissions* add a permission on path `/` for the token with the **PVEAuditor** role.
4. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.

### Where to run the agent

The agent queries the PVE API over the network, so it does not have to live on a cluster node — and ideally it should not: run it on a machine that survives a node failure (a small monitoring VM on separate hardware, a management host), or point `PVE_HOST` at a VIP / round-robin DNS name instead of a single node's address. If the agent's API target is the node that just died, your monitoring dies with it. (The one exception is the optional journald logs pipeline, which must run on a PVE node — see [Shipping Proxmox service logs](#shipping-proxmox-service-logs-optional).)

## Quick Start — Install Script

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/ProxmoxAgent/install.sh -o install.sh
bash install.sh
```

The script prompts for your OneUptime URL, telemetry ingestion key, cluster name, and Proxmox API details, installs to `/opt/oneuptime-proxmox-agent`, and starts the agent with Docker Compose.

## Quick Start — Docker Compose

Download `docker-compose.yml` and `otel-collector-config.yaml` from this directory into a folder, then create a `.env` file next to them:

```bash
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_TELEMETRY_INGESTION_KEY=your-telemetry-ingestion-key
PROXMOX_CLUSTER_NAME=my-proxmox-cluster
PVE_HOST=192.168.1.10
PVE_API_TOKEN_ID=oneuptime@pve!exporter
PVE_API_TOKEN_SECRET=your-token-secret
COMPOSE_PROFILES=pve-exporter
```

Then start the agent (the `pve-exporter` profile also starts the bundled exporter):

```bash
docker compose up -d
```

The cluster will appear automatically in the **Proxmox** section of OneUptime.

### Already running pve-exporter?

Skip the bundled exporter: drop `COMPOSE_PROFILES`, `PVE_API_TOKEN_ID`, and `PVE_API_TOKEN_SECRET` from the `.env` file and point the agent at your exporter instead:

```bash
PVE_EXPORTER_URL=your-exporter-host:9221
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key (*Project Settings → Telemetry Ingestion Keys*) |
| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |
| `PVE_HOST` | Yes | Proxmox VE API host (any node of the cluster) the exporter queries, e.g. `192.168.1.10` |
| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |
| `PVE_API_TOKEN_ID` | Bundled exporter only | Full Proxmox API token id, e.g. `oneuptime@pve!exporter` |
| `PVE_API_TOKEN_SECRET` | Bundled exporter only | Proxmox API token secret |
| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |
| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |

## Collected Metrics

The agent scrapes the exporter's `/pve` endpoint every 30 seconds with both the cluster and node collectors enabled. Every series carries an `id` label that identifies the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:

- **Availability**: `pve_up`, `pve_uptime_seconds`
- **Node**: `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes`
- **Guest (VM / LXC)**: `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids (`pve_network_receive_bytes`, `pve_network_transmit_bytes`)
- **Storage**: `pve_disk_usage_bytes`, `pve_disk_size_bytes`
- **HA**: `pve_ha_state`
- **Backup coverage**: `pve_not_backed_up_total` (count of guests not covered by any backup job), `pve_not_backed_up_info` (one series per uncovered guest, labeled with its `id`). These come from the exporter's `backup-info` collector, which is enabled by default and runs under the cluster scope (`cluster=1`, already set in the shipped config) — no extra flags needed. Note the honest boundary: "covered by a backup job" means the guest is selected by at least one job, not that recent backups succeeded.

### Derived identity attributes — `pve.scope` / `pve.type` / `pve.id`

OneUptime monitor criteria and attribute filters match on equality, not prefix, so the shipped config includes a `transform/pve-identity` processor that splits the `id` label into three extra datapoint attributes. The built-in Proxmox alert templates filter on them — do not remove the processor:

| Attribute | Values | Example for `qemu/100` |
|-----------|--------|------------------------|
| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |
| `pve.type` | `node`, `qemu`, `lxc`, `storage` (unset on `cluster/*` series) | `qemu` |
| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |

The original `id` label is kept untouched — group-by pages and breakdowns still use it.

## Shipping Proxmox service logs (optional)

By default the agent ships **metrics only** — the Logs tab of the Proxmox dashboard stays empty until you enable a log receiver. The PVE control plane logs to the systemd journal under eight units: `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd`, and `qmeventd`. The shipped config contains a commented-out `journald` receiver targeting exactly those units, wired to a commented `logs` pipeline that stamps `proxmox.cluster.name` so the logs land on your cluster.

To enable it:

1. **Run the agent on a PVE node.** The journal is per-host — a remote agent cannot read it. This is the one setup that conflicts with the [placement advice](#where-to-run-the-agent) above; if you want to keep the metrics agent off-cluster, run a second, log-only collector on the node instead (copy the config, delete the `prometheus` receiver and `metrics` pipeline).
2. **Uncomment the `journald` receiver and the `logs` pipeline** in `otel-collector-config.yaml`.
3. **Uncomment the journal volumes** in `docker-compose.yml` so the container can read the host journal:

   ```yaml
   - /var/log/journal:/var/log/journal:ro
   - /etc/machine-id:/etc/machine-id:ro
   ```

4. **Swap the collector image.** The stock `otel/opentelemetry-collector-contrib` image is built `FROM scratch`: it contains no `journalctl` binary (which the journald receiver shells out to) and runs as a non-root user that cannot read the journal. Build a thin wrapper and point `image:` in `docker-compose.yml` at it:

   ```dockerfile
   FROM otel/opentelemetry-collector-contrib:latest AS otelcol
   FROM debian:stable-slim
   RUN apt-get update \
       && apt-get install -y --no-install-recommends systemd \
       && rm -rf /var/lib/apt/lists/*
   COPY --from=otelcol /otelcol-contrib /otelcol-contrib
   ENTRYPOINT ["/otelcol-contrib"]
   CMD ["--config", "/etc/otelcol-contrib/config.yaml"]
   ```

   (The `systemd` package is installed only for the `journalctl` binary; this image runs as root, which is what grants journal read access. Alternatively, skip Docker for the logs path entirely and run the `otelcol-contrib` release `.deb` directly on the node — `journalctl` is already there.)

Logs are per node: the journald receiver ships the journal of the node the agent runs on. For service logs from every node, run the log-only collector from step 1 on each node.

### Fallback without a custom image — filelog on /var/log/syslog

If you would rather keep the stock image, tail syslog instead: install rsyslog on the node (`apt install rsyslog` — Debian 12 / PVE 8 and later no longer ship it by default), mount `/var/log` into the container (`- /var/log:/var/log:ro` — mount the directory, not the file, so rotation does not pin a stale inode), and use a `filelog` receiver in place of the journald one:

```yaml
receivers:
  filelog:
    include:
      - /var/log/syslog
    start_at: end
```

You lose per-unit filtering (syslog carries everything, not just the eight PVE services) and the stock image's non-root user must be able to read the file, but no image swap is needed. Wire it into the same commented `logs` pipeline (`receivers: [filelog]`).

## Zero-install Alternative — Proxmox VE 9+ Native OpenTelemetry Push

Proxmox VE 9.0 and later can push metrics directly to OneUptime via the built-in OpenTelemetry metric server (*Datacenter → Metric Server → Add → OpenTelemetry*) — no agent or exporter required:

- **Server**: your OneUptime host (e.g. `oneuptime.com`)
- **Port**: `443`, **Protocol**: `https`
- **Path**: `/otlp/v1/metrics`
- **Headers**: `{"x-oneuptime-token": "your-telemetry-ingestion-key"}`

Two trade-offs to be aware of:

1. **Cluster discovery**: the agent path is what powers cluster auto-registration in OneUptime, because it stamps the `proxmox.cluster.name` resource attribute. With the native push, set *Resource Attributes* to `proxmox.cluster.name=my-proxmox-cluster` so the cluster registers itself; without it the metrics ingest but no Proxmox cluster appears.
2. **Metric names differ**: the native push emits `proxmox_node_*` / `proxmox_vm_*` / `proxmox_storage_*` series, while the agent emits pve-exporter's `pve_*` series. OneUptime's built-in Proxmox monitor catalog and alert templates target the `pve_*` names.

See the [Proxmox telemetry docs](https://oneuptime.com/docs/telemetry/proxmox) for the full walkthrough.

## Auto-tag with Project Labels

Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the cluster. Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.

Add the attributes to the `resource` processor in `otel-collector-config.yaml` (next to `proxmox.cluster.name`):

```yaml
processors:
  resource:
    attributes:
      # ...existing attributes...
      - key: oneuptime.label.team
        value: platform
        action: upsert
      - key: oneuptime.label.env
        value: production
        action: upsert
```

The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated; labels added manually in the OneUptime UI are never removed by the agent.

## Run as a systemd Service

To survive reboots without relying on Docker's restart policy alone, install the provided unit:

```bash
sudo cp systemd/oneuptime-proxmox-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-proxmox-agent
```

The unit assumes the agent lives in `/opt/oneuptime-proxmox-agent` (the install script default).

## Upgrading

```bash
cd /opt/oneuptime-proxmox-agent
docker compose pull
docker compose up -d
```

## Uninstalling

```bash
cd /opt/oneuptime-proxmox-agent
docker compose down
```

## Troubleshooting

### Run the doctor script first

`troubleshoot.sh` checks the whole chain — container runtime, exporter scrape, cluster-name stamping, token shape, collector self-metrics, and a **definitive server-side token validation**. The last one matters most: OneUptime's OTLP endpoints deliberately return a silent `200` on a bad ingestion key (so a misconfigured collector cannot retry-flood the server), which means log inspection alone can never tell you the key is wrong. The script asks `GET <url>/otlp/v1/validate` from inside the agent's network namespace for a real 200/401 verdict:

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/ProxmoxAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh                 # add -d <dir> if you installed outside /opt/oneuptime-proxmox-agent
```

### No cluster appears in OneUptime

1. Check the collector logs: `docker logs oneuptime-proxmox-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).
2. Verify the scrape works (the collector image is distroless, so test from alongside it): `docker run --rm --network container:oneuptime-pve-exporter curlimages/curl -s "http://localhost:9221/pve?target=<PVE_HOST>" | head` — you should see `pve_*` metric lines.
3. Make sure `PROXMOX_CLUSTER_NAME` is set — discovery keys on the `proxmox.cluster.name` resource attribute.

### The exporter returns 401 / 595 errors

The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the token has the **PVEAuditor** role on path `/` (with privilege separation either disabled or permissions granted to the token itself).

### Only node metrics, no guest metrics

Guest series (`qemu/*`, `lxc/*` ids) come from the cluster collector. The shipped config enables it (`cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.

### Common Commands

```bash
# Check agent status
docker compose ps

# View collector logs
docker logs -f oneuptime-proxmox-agent

# View exporter logs (bundled exporter)
docker logs -f oneuptime-pve-exporter

# Test the exporter scrape by hand (the bundled exporter does not
# publish its port on the host, so run curl inside its network namespace)
docker run --rm --network container:oneuptime-pve-exporter curlimages/curl -s "http://localhost:9221/pve?target=<PVE_HOST>" | head
```
