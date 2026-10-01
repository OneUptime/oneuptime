# OneUptime Proxmox Agent

## Overview

The OneUptime Proxmox Agent is a pre-configured OpenTelemetry Collector that monitors Proxmox VE clusters — nodes, QEMU VMs, LXC containers, storage, and HA state. It scrapes [prometheus-pve-exporter](https://github.com/prometheus-pve/prometheus-pve-exporter) (optionally running the exporter for you), stamps every metric with your cluster identity, and forwards everything to OneUptime over OTLP. One `.env` file, one `docker compose up`.

This page is the **installation guide**. For configuring Proxmox monitors and alerts on top of the data the agent collects, see [Proxmox Monitor](/docs/monitor/proxmox-monitor).

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on any machine that can reach your Proxmox VE API (port 8006)
- A Proxmox VE API token with the **PVEAuditor** role (read-only)
- A **OneUptime Telemetry Ingestion Token** — create one from _Project Settings → Telemetry & APM → Ingestion Keys_ and copy the value

### Create the Proxmox API Token

**Fastest path — run this on any PVE node** (shell as root):

```bash
pveum user add monitoring@pam
pveum acl modify / --roles PVEAuditor --users monitoring@pam
pveum user token add monitoring@pam oneuptime --privsep 1
pveum acl modify / --roles PVEAuditor --tokens 'monitoring@pam!oneuptime'
```

(The first command only fails, harmlessly, if `monitoring@pam` already exists — API tokens carry their own secret, so the user needs no password or system account.)

The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. The ACL must sit at the root path `/` because **PVEAuditor** needs read access to every node, guest, and storage object the exporter walks — granting it on a narrower path hides the rest of the cluster and produces `401`/`403 Permission check failed (/, Sys.Audit)` errors. `pveum user token add` prints the token secret once; in your `.env` that becomes `PVE_API_TOKEN_ID=monitoring@pam!oneuptime` and `PVE_API_TOKEN_SECRET=<the printed secret>`.

**Or via the Proxmox web UI:**

1. In the Proxmox web UI go to _Datacenter → Permissions → API Tokens_ and click **Add**.
2. Pick (or create) a user, give the token an ID like `oneuptime`, and leave **Privilege Separation** checked.
3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.
4. Under _Datacenter → Permissions_ add the **PVEAuditor** role on path `/` twice: once as an **API Token Permission** for the token, once as a **User Permission** for its user. A privilege-separated token only gets the permissions its user also has, so both need the role.

### Where to Run the Agent

The agent queries the PVE API over the network, so it does not have to live on a cluster node — and ideally it should not: run it on a machine that survives a node failure (a small monitoring VM on separate hardware, a management host), or point `PVE_HOST` at a VIP / round-robin DNS name instead of a single node's address. If the agent's API target is the node that just died, your monitoring dies with it. (The one exception is the optional journald logs pipeline, which must run on a PVE node — see [Ship Proxmox Service Logs](#optional-ship-proxmox-service-logs).)

## Quick Start (Install Script)

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/ProxmoxAgent/install.sh -o install.sh
bash install.sh
```

The script prompts for your OneUptime URL, telemetry ingestion token, cluster name, and Proxmox API details — and whether the [AI agent](#ai-agent) may apply fixes, and if so for a token of its own and the guests it must never change — installs to `/opt/oneuptime-proxmox-agent`, and starts the agent with Docker Compose.

## Alternative — Docker Compose

Download the two files from the [ProxmoxAgent directory](https://github.com/OneUptime/oneuptime/tree/master/agents/ProxmoxAgent) — `docker-compose.yml` and `otel-collector-config.yaml` — into a folder, then create a `.env` file next to them:

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

If you already run prometheus-pve-exporter somewhere, drop `COMPOSE_PROFILES` and point the agent at it instead. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` if you use the [AI agent](#ai-agent), which calls the API with that token; otherwise drop them too:

```bash
PVE_EXPORTER_URL=your-exporter-host:9221
```

## Environment Variables

| Variable                            | Required                     | Description                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`                     | Yes                          | Your OneUptime instance URL (for example `https://oneuptime.com` or your self-hosted host)                                                                                                                    |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes                          | Telemetry ingestion token from _Project Settings → Telemetry & APM → Ingestion Keys_                                                                                                                          |
| `PROXMOX_CLUSTER_NAME`              | Yes                          | Cluster identifier shown in OneUptime, stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it later registers a second cluster. Defaults to `proxmox-cluster` |
| `PVE_HOST`                          | Yes                          | Proxmox VE API host (any node of the cluster) the exporter and the AI agent query, e.g. `192.168.1.10`                                                                                                        |
| `PVE_EXPORTER_URL`                  | No                           | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`)                                                                                           |
| `PVE_API_TOKEN_ID`                  | Bundled exporter or AI agent | Full Proxmox API token id, e.g. `oneuptime@pve!exporter`. The AI agent reads the API with it unless it has a token of its own (`ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`)         |
| `PVE_API_TOKEN_SECRET`              | Bundled exporter or AI agent | Proxmox API token secret                                                                                                                                                                                      |
| `PVE_VERIFY_SSL`                    | No                           | Verify the Proxmox API TLS certificate (the exporter and the AI agent). Defaults to `false` because Proxmox ships self-signed certificates                                                                    |
| `COMPOSE_PROFILES`                  | No                           | Set to `pve-exporter` to start the bundled exporter container                                                                                                                                                 |

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

The agent scrapes the exporter every 30 seconds with both the cluster and node collectors enabled — which also covers the exporter's default-on `backup-info` (cluster-level) and `replication` (node-level) collectors. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:

| Category             | Metrics                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Availability**     | `pve_up`, `pve_uptime_seconds`                                                                                                                                                                                                                                                                                                                                              |
| **Node**             | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes`                                                                                                                                                                                                                                                            |
| **Guest (VM / LXC)** | `pve_guest_info`, CPU / memory / network series on `qemu/*` and `lxc/*` ids (`pve_network_receive_bytes`, `pve_network_transmit_bytes`)                                                                                                                                                                                                                                     |
| **Storage**          | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info`                                                                                                                                                                                                                                                                                                           |
| **HA**               | `pve_ha_state`                                                                                                                                                                                                                                                                                                                                                              |
| **Backup coverage**  | `pve_not_backed_up_total` (count of guests not covered by any backup job; one cluster-level series, no `id` label), `pve_not_backed_up_info` (one series per uncovered guest, labeled with its `id`). Honest boundary: "covered by a backup job" means the guest is selected by at least one job — whether backups ran recently or succeeded is not exposed by pve-exporter |
| **Replication**      | `pve_replication_failed_syncs`, `pve_replication_duration_seconds`, `pve_replication_last_sync_timestamp_seconds`, `pve_replication_last_try_timestamp_seconds`, `pve_replication_next_sync_timestamp_seconds`, `pve_replication_info` — per storage replication job; their `id` label carries the replication **job** id (e.g. `100-0`), not a resource id                 |

OneUptime monitor criteria and attribute filters match on equality, not prefix, so the shipped collector config also splits the `id` label into three extra datapoint attributes (the built-in Proxmox alert templates filter on them — keep the `transform/pve-identity` processor in place):

| Attribute   | Values                                                                       | Example for `qemu/100` |
| ----------- | ---------------------------------------------------------------------------- | ---------------------- |
| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest`                |
| `pve.type`  | `node`, `qemu`, `lxc`, `storage`                                             | `qemu`                 |
| `pve.id`    | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`)         | `100`                  |

The original `id` label is kept untouched.

## Optional — Ship Proxmox Service Logs

By default the agent ships **metrics only**, so the Logs tab of the Proxmox dashboard stays empty. The PVE control plane logs to the systemd journal under eight units: `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd`, and `qmeventd`. The shipped `otel-collector-config.yaml` contains a commented-out `journald` receiver targeting exactly those units, wired to a commented `logs` pipeline that stamps `proxmox.cluster.name` so the logs land on your cluster.

To enable it:

1. **Run the agent on a PVE node.** The journal is per-host — a remote agent cannot read it. This is the one setup that conflicts with the placement advice above; if you want to keep the metrics agent off-cluster, run a second, log-only collector on the node instead (copy the config, delete the `prometheus` receiver and the `metrics` pipeline).
2. **Uncomment the `journald` receiver and the `logs` pipeline** in `otel-collector-config.yaml`.
3. **Uncomment the journal volume mounts** in `docker-compose.yml` so the container can read the host journal:

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

   The `systemd` package is installed only for the `journalctl` binary; this image runs as root, which is what grants journal read access. Alternatively, skip Docker for the logs path entirely and run the `otelcol-contrib` release `.deb` directly on the node — `journalctl` is already there.

Logs are per node: the journald receiver ships the journal of the node the agent runs on. For service logs from every node, run the log-only collector from step 1 on each node.

### Fallback Without a Custom Image — Filelog on /var/log/syslog

If you would rather keep the stock image, tail syslog instead: install rsyslog on the node (`apt install rsyslog` — Debian 12 / PVE 8 and later no longer ship it by default), mount `/var/log` into the container (`- /var/log:/var/log:ro` — mount the directory, not the file, so log rotation does not pin a stale inode), and use a `filelog` receiver in place of the journald one:

```yaml
receivers:
  filelog:
    include:
      - /var/log/syslog
    start_at: end
```

You lose per-unit filtering (syslog carries everything, not just the eight PVE services) and the stock image's non-root user must be able to read the file, but no image swap is needed. Wire it into the same commented `logs` pipeline (`receivers: [filelog]`).

## Zero-install Alternative — Proxmox VE 9+ Native OpenTelemetry Push

Proxmox VE 9.0 and later ship a built-in **OpenTelemetry metric server** that pushes node, guest, and storage metrics to any OTLP/HTTP endpoint — no agent or exporter to install. Configure it under _Datacenter → Metric Server → Add → OpenTelemetry_:

| Field    | Value                                                                |
| -------- | -------------------------------------------------------------------- |
| Server   | Your OneUptime host, e.g. `oneuptime.com` (or your self-hosted host) |
| Port     | `443`                                                                |
| Protocol | `https`                                                              |
| Path     | `/otlp/v1/metrics`                                                   |
| Headers  | `{"x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"}`            |

Add it once — every node of the cluster pushes its own metrics. Nothing else to configure: OneUptime recognizes the native push and translates it into the same `pve_*` series the agent sends, so:

- the cluster registers itself under your Proxmox cluster name (a standalone node registers under its node name),
- the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work the same as with the agent,
- the original `proxmox_node_*` / `proxmox_vm_*` / `proxmox_storage_*` series stay available in [Metrics Explorer](/docs/monitor/metrics-monitor) for anything else PVE reports (load average, swap, pressure stall, per-NIC traffic, …).

If you set `proxmox.cluster.name` under _Resource Attributes_ before, it keeps being used — the cluster keeps its name.

### When a node stops reporting

Each node pushes only its own status, so a node that goes down cannot say so itself. The nodes that are still alive report it for it:

- About 2 minutes after its last report, the node shows **Offline** on the Nodes page. **Last Seen** on the node's own page keeps the time of its own last report.
- After about 5 minutes, **Node Offline** fires for it. **Cluster Quorum at Risk** counts it as offline too; because that template needs a full 5-minute window of reports, it fires about 7–9 minutes after the node went quiet.
- With its next report it is **Online** again and its alert recovers.

Offline here means the node **stopped reporting**, not necessarily that it is down. A node that is up but whose `pvestatd` is hung or killed, whose cluster file system (`pmxcfs`) is down, or whose network to OneUptime is cut is reported the same way.

What it cannot cover:

- **A standalone host, or a whole cluster going silent at once.** Nobody is left to report it, so no per-node alert fires. The cluster turns **Disconnected** instead, the same as when the agent stops.
- **A node silent for more than 7 days** is no longer reported. Its alert resolves and it drops off the Nodes page.
- **A node you take out of the cluster** looks the same as a dead one. Use **Remove Node** on its page: it goes away and its alert resolves. Otherwise it stays Offline for up to 7 days.
- **The node's guests and storage.** Only the node itself is kept as Offline; its VMs, containers and storage drop off their pages about 15 minutes after its last report. Guests that HA restarts on another node come back under that node.

After a OneUptime ingest outage, a node that newly went quiet is only reported once one of the others has pushed again for 2 minutes, so the outage itself never pages for every node. A node that was already Offline stays Offline through a short outage and keeps its alert; after an outage longer than 5 minutes it is reported again once the others have pushed for 2 minutes.

In [Metrics Explorer](/docs/monitor/metrics-monitor) these reports are the `pve_up` = 0 points labelled `oneuptime.proxmox.inferred` = `not-reporting`, so you can always tell them apart from what a node said about itself.

### What the native push cannot do

The native push only sends what each node knows about itself, so part of what the agent collects has no native equivalent:

| Needs the agent                 | Why                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| HA state                        | Not pushed — the **HA Resource in Error State** template needs the agent.                                    |
| Start-on-boot flag              | Not pushed — the **Guest Down** template, which only pages for guests set to start on boot, needs the agent. |
| Backup coverage and replication | Not pushed — the **Guest Not Backed Up** and **Replication Failing** templates need the agent.               |

If you need those, run the agent instead. Use one or the other for a cluster: running both reports every resource twice.

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

### Run the diagnostic script first

The agent ships with a doctor script, [`troubleshoot.sh`](https://github.com/OneUptime/oneuptime/blob/master/agents/ProxmoxAgent/troubleshoot.sh), that checks the whole chain: container runtime, the exporter scrape, cluster-name stamping, ingestion-token shape, collector self-metrics, and a **definitive server-side token validation**. The token check is the important one — OneUptime's OTLP endpoints refuse a bad ingestion token with `401` (`422` for a disabled key or a browser key), and the collector treats both as permanent: it drops the batch and logs one `Exporting failed` error for it, which is easy to miss while the container itself stays healthy. The script calls `GET <url>/otlp/v1/validate` from inside the agent's network namespace to get a direct `200` (valid) / `401` (invalid) verdict, falling back to `POST /fluentd/v1/logs` on older servers.

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/ProxmoxAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-proxmox-agent
```

It ends with a VERDICT section naming the most likely root cause. The sections below cover the same ground manually.

### No cluster appears in OneUptime

1. Check the collector logs: `docker logs oneuptime-proxmox-agent` — a `401` on export means a bad ingestion token, connection refused means a wrong `ONEUPTIME_URL`.
2. Verify the exporter scrape works. The bundled exporter does not publish its port on the host, so test from inside its network namespace: `docker run --rm --network container:oneuptime-pve-exporter curlimages/curl -s "http://localhost:9221/pve?target=YOUR_PVE_HOST" | head` should print `pve_*` metric lines. (For an external exporter, `curl` its `host:9221` directly.)
3. Make sure `PROXMOX_CLUSTER_NAME` is set — discovery keys on the `proxmox.cluster.name` resource attribute.

### The exporter logs 401 / authentication errors

The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user.

### Only node metrics, no guest metrics

Guest series (`qemu/*`, `lxc/*` ids) come from the exporter's cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized `otel-collector-config.yaml`, restore the `cluster: ["1"]` param.

### Metrics land under the wrong cluster

OneUptime auto-registers Proxmox clusters by `proxmox.cluster.name`, taken from the `PROXMOX_CLUSTER_NAME` environment variable. Changing it after the first telemetry batch creates a second cluster row rather than renaming the existing one.

## AI agent

The agent's `docker-compose.yml` also runs the **Proxmox AI agent**, `oneuptime-proxmox-ai-agent` (image `oneuptime/resource-ai-agent:release`). While OneUptime AI investigates an incident or alert on this cluster it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, `pvesh get /nodes/pve1/qemu/101/status/current`, `pvesh get /nodes/pve1/tasks --errors 1 --limit 20` — and, only if you allow it, applies fixes such as starting or rebooting a guest. There is no `pvesh` binary in it: each command becomes exactly one call to the Proxmox VE API at `PVE_HOST`, with a token from the same `.env`. It registers as the cluster named `PROXMOX_CLUSTER_NAME`, like the collector, and shows up on the cluster's **AI → AI agent** page in OneUptime.

- **The API token is the hard limit.** Investigations use the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else; if you run your own exporter and have no token in `.env`, add one. Fixes need a token of the AI agent's own that may power guests (`VM.PowerMgmt`, for example the `PVEVMUser` role on `/vms` or on one pool), set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`.
- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`; `ONEUPTIME_AI_WRITE_TARGETS` (VMIDs such as `100,101`, and `<node>/<service>` for node services) limits what a fix may touch. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`. Then choose on the AI agent page whether each fix needs a person's approval.
- Like the exporter, it does not verify the API's self-signed certificate unless you set `PVE_VERIFY_SSL=true` or point `PVE_CA_FILE` at the cluster's CA (`/etc/pve/pve-root-ca.pem`, mounted into the container).
- It runs as UID 1000 with no capabilities and a read-only root filesystem, and never reads `/access`, opens a console or changes configuration. Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml` if you do not use OneUptime AI.

What it may run, how fixes work and how to troubleshoot it: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters). The agent's README has the exact `pveum` commands for a fixes token.

## Next steps

- Configure **Proxmox Monitors** to alert on node, guest, storage, HA, backup-coverage, and replication conditions — see [Proxmox Monitor](/docs/monitor/proxmox-monitor).
- Monitoring Ceph as the storage backend of your Proxmox cluster? Pair this agent with the [OneUptime Ceph Agent](/docs/telemetry/ceph).
- For the OS-level view of individual hosts, use the [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
