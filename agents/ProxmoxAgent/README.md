# OneUptime Proxmox Agent

Monitor Proxmox VE clusters — nodes, QEMU VMs, LXC containers, storage, and HA state — with OneUptime using a pre-configured OpenTelemetry Collector.

The agent is config-only: a stock `otel/opentelemetry-collector-contrib` container with a tuned config that scrapes [prometheus-pve-exporter](https://github.com/prometheus-pve/prometheus-pve-exporter), stamps the data with your cluster identity, and ships it to OneUptime over OTLP. The compose file optionally runs the exporter for you, so a full install is one `.env` file and one `docker compose up`. It also runs the [OneUptime AI agent](#oneuptime-ai-agent), which lets OneUptime AI read the cluster through the Proxmox VE API while it investigates an incident — read-only unless you allow fixes.

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
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/ProxmoxAgent/install.sh -o install.sh
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
| `PVE_HOST` | Yes | Proxmox VE API host (any node of the cluster) the exporter and the AI agent query, e.g. `192.168.1.10` |
| `PVE_PORT` | No | Proxmox VE API port the AI agent uses when `PVE_HOST` names none (default: `8006`) |
| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |
| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `oneuptime@pve!exporter` (PVEAuditor, read-only) |
| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |
| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |
| `PVE_CA_FILE` | No | AI agent: a CA certificate (the cluster's `/etc/pve/pve-root-ca.pem`, mounted into the container) to verify the API's certificate against; setting it turns verification on |
| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes; anything else keeps it read-only (default: `false`) |
| `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET` | For fixes | A token of the AI agent's own, used instead of `PVE_API_TOKEN_ID` when set — see [The API token](#the-api-token-is-the-hard-limit) |
| `ONEUPTIME_AI_WRITE_TARGETS` | No | Comma-separated globs of the guests (VMIDs, e.g. `101,2*`) and node services (`pve1/pveproxy`, `*/pveproxy`) fixes may touch (default: all) |
| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | Comma-separated globs of guests and node services OneUptime AI must never change — at least the VMID of the VM the agent runs in, if it runs on this cluster |
| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |

## OneUptime AI agent

The compose file also runs `oneuptime-proxmox-ai-agent` (the [`oneuptime/resource-ai-agent`](../ResourceAIAgent/README.md) image). It lets OneUptime AI look at this cluster while it investigates an incident or alert on it and, only if you allow it, apply a fix. It registers as the cluster named `PROXMOX_CLUSTER_NAME` — the name the collector stamps on your metrics — and shows up on the cluster's **AI → AI agent** page in OneUptime, where you also choose whether fixes need a person's approval.

There is no `pvesh` binary in it. OneUptime AI writes commands in `pvesh` grammar (`pvesh get /cluster/status`, `pvesh create /nodes/pve1/qemu/101/status/start`); the agent checks each one against the same command policy OneUptime already applied, turns it into exactly one call to the Proxmox VE API (`https://PVE_HOST:8006/api2/json/...`) with its own API token, and sends the answer back with secrets (cloud-init passwords, storage keys) redacted. OneUptime never sends it a credential, and it never uses the proxy it reaches OneUptime through to reach Proxmox.

**What it reads** — always read-only: cluster status, resources, HA state, tasks and the cluster log; each node's status, services, storage, disks, network and replication; each guest's status, config (secrets redacted), pending changes, snapshots and usage; QEMU guest-agent information. It never reads anything under `/access` (users, tokens, ACLs), never opens a console, the QEMU monitor or guest-agent exec and file calls, and never runs `pvesh set` or `pvesh delete`.

**What it may fix** — only with `ONEUPTIME_AI_ALLOW_WRITES=true` and AI remediation turned on for the cluster in OneUptime:

| Fix | How it runs |
|-----|-------------|
| Start, resume or reboot one guest | Safe: may run on its own in *Automatic* mode |
| Shut down, stop or suspend one guest; reset one VM; start, restart or reload one of `pveproxy`, `pvedaemon`, `pvestatd`, `pve-ha-lrm`, `pve-ha-crm`, `spiceproxy`, `pvescheduler`, `pve-firewall`, `chrony`, `cron`, `postfix` | Risky: needs approval unless you allowlisted it or bypass approvals |
| Migrate a guest; start, restart or reload `corosync` or `pve-cluster` | Always a person's decision |

A fix names its node and guest (`/nodes/pve1/qemu/101/...`, never `localhost`). The agent follows the task a fix starts until it stops, so a guest that fails to start is reported as a failure, with the task's log. Allowlist entries on the AI agent page spell each command out in full, e.g. `pvesh create /nodes/pve1/qemu/101/status/reboot`: `*` stands for one whole word only, so write one entry per guest.

### The API token is the hard limit

Whatever the policy allows, Proxmox VE lets the agent do only what its token may.

- **Investigations** use the collector's token, `PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET` — the PVEAuditor token from [Creating the Proxmox API token](#creating-the-proxmox-api-token). If you run your own exporter and have no token in `.env`, create one and add both variables. PVEAuditor reads everything the agent reads except node logs (`/nodes/{node}/syslog` and `/journal` need `Sys.Syslog`) and the QEMU guest agent (`VM.GuestAgent.Audit` on Proxmox VE 9, `VM.Monitor` on 8); grant those only if you want OneUptime AI to read them. If Proxmox answers reads with `403`, grant the role to the token's user too: a token with privilege separation only gets permissions its user also has.
- **Fixes** need a token of the AI agent's own, so the collector's token stays read-only. On any node, as root:

  ```bash
  pveum user add oneuptime-ai@pve --comment "OneUptime AI agent"
  # Read the whole cluster, like the collector's token:
  pveum acl modify / --roles PVEAuditor --users oneuptime-ai@pve
  # Start, reboot, shut down and stop guests (VM.PowerMgmt):
  pveum acl modify /vms --roles PVEVMUser --users oneuptime-ai@pve
  # A token that carries exactly this user's permissions:
  pveum user token add oneuptime-ai@pve fixes --privsep 0
  ```

  Then add to `.env` and run `docker compose up -d`:

  ```bash
  ONEUPTIME_AI_ALLOW_WRITES=true
  ONEUPTIME_AI_PVE_API_TOKEN_ID=oneuptime-ai@pve!fixes
  ONEUPTIME_AI_PVE_API_TOKEN_SECRET=<the secret pveum printed>
  # Optional: what fixes may touch, and what they never may (VMIDs, <node>/<service>).
  ONEUPTIME_AI_WRITE_TARGETS=
  ONEUPTIME_AI_PROTECTED_TARGETS=105
  ```

  To grant less: give `PVEVMUser` on `/pool/<pool>` or `/vms/<vmid>` instead of `/vms`, so Proxmox only lets it touch those guests. `PVEVMUser` also allows consoles, backups and CD-ROM and cloud-init changes, which the agent never makes; a role with exactly what fixes need works too (`pveum role add OneUptimeAIPower --privs "VM.PowerMgmt VM.Audit"`, granted instead of `PVEVMUser`). Restarting node services needs `Sys.Modify` on `/nodes/<node>` and migrating a guest `VM.Migrate` (the `PVEVMAdmin` role): grant them only if you want those fixes. Without a privilege, Proxmox refuses the call and the agent reports which privilege it needed.

If the agent runs in a VM or container on this cluster, put its VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.

### TLS

Like the exporter, the AI agent does not verify the API's certificate by default, because Proxmox VE ships a self-signed one — so anything that can intercept the traffic between the agent and `PVE_HOST` could read the token. To verify it, copy `/etc/pve/pve-root-ca.pem` from any node next to `docker-compose.yml`, uncomment the `volumes` of the `oneuptime-proxmox-ai-agent` service, and set `PVE_CA_FILE=/etc/oneuptime/pve-root-ca.pem` in `.env`. If the API has a publicly trusted certificate, set `PVE_VERIFY_SSL=true` instead.

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

Nothing else to configure. OneUptime recognizes the native push and translates it into the same `pve_*` series this agent sends: the cluster registers itself under your Proxmox cluster name (a standalone node under its node name), and the Nodes / Guests / Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer. A `proxmox.cluster.name` resource attribute you set earlier keeps being used.

Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it. It shows Offline about 2 minutes after its last report, **Node Offline** fires after about 5 minutes and **Cluster Quorum at Risk** counts it as offline (it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports); its next report brings it back. This means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns Disconnected instead, as when this agent stops. A node silent for more than 7 days is no longer reported. For a node you took out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days. The reports carry `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.

What only the agent can do: HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed at all. Use one or the other for a cluster: running both reports every resource twice.

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

`troubleshoot.sh` checks the whole chain — container runtime, exporter scrape, cluster-name stamping, token shape, collector self-metrics, and a **definitive server-side token validation**. The last one matters most: OneUptime's OTLP endpoints refuse a bad ingestion key with `401` (`422` for a disabled key or a browser key), and the collector drops each refused batch with a single `Exporting failed` log line that is easy to miss. The script asks `GET <url>/otlp/v1/validate` from inside the agent's network namespace for a direct 200/401 verdict:

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/ProxmoxAgent/troubleshoot.sh -o troubleshoot.sh
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

### The AI agent

```bash
docker logs --tail 100 oneuptime-proxmox-ai-agent
docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status
```

The status shows whether the agent registered with OneUptime and — in its posture — whether it reaches the Proxmox VE API (`reachable`, `reachError`), the Proxmox VE version, how many nodes are online, whether the cluster is quorate, and which token it uses (never the secret). The same reasons appear on the cluster's **AI → AI agent** page.

| What you see | What to do |
|--------------|------------|
| `PVE_HOST is not set` | Set `PVE_HOST` in `.env` to any node's address, then `docker compose up -d`. |
| `No Proxmox VE API token is set` | Set `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` (see [The API token](#the-api-token-is-the-hard-limit)). |
| `Could not connect to the Proxmox VE API ... PVE_HOST is "localhost"` | Inside the agent's container `localhost` is the container itself: set `PVE_HOST` to a node's address. |
| `The TLS handshake with the Proxmox VE API ... failed` | Set `PVE_CA_FILE` to the cluster's CA (see [TLS](#tls)), or `PVE_VERIFY_SSL=false`. |
| `HTTP 401 ... did not accept the token` | Check the token id (`user@realm!tokenname`) and secret, and that the token still exists and has not expired. |
| `HTTP 403 ... typically needs <privilege>` | Grant the token that privilege (see [The API token](#the-api-token-is-the-hard-limit)). |
| `this agent is read-only (ONEUPTIME_AI_ALLOW_WRITES ...)` | Set `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env`, then `docker compose up -d`. |

### Common Commands

```bash
# Check agent status
docker compose ps

# View collector logs
docker logs -f oneuptime-proxmox-agent

# View exporter logs (bundled exporter)
docker logs -f oneuptime-pve-exporter

# View AI agent logs
docker logs -f oneuptime-proxmox-ai-agent

# Test the exporter scrape by hand (the bundled exporter does not
# publish its port on the host, so run curl inside its network namespace)
docker run --rm --network container:oneuptime-pve-exporter curlimages/curl -s "http://localhost:9221/pve?target=<PVE_HOST>" | head
```
