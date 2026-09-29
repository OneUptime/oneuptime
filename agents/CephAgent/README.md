# OneUptime Ceph Agent

Monitor Ceph clusters — health, mon quorum, OSDs, pools, and placement groups — with OneUptime using a pre-configured OpenTelemetry Collector.

The agent is config-only: a stock `otel/opentelemetry-collector-contrib` container with a tuned config that scrapes the Ceph mgr `prometheus` module on every mgr daemon, stamps the data with your cluster identity, and ships it to OneUptime over OTLP.

Next to the collector, `docker-compose.yml` also runs the **OneUptime AI agent** (`oneuptime-ceph-ai-agent`), which lets OneUptime AI look at this cluster with the `ceph` CLI while it investigates an incident or alert. It connects as its own read-only Ceph client and applies fixes only if you allow them; see [OneUptime AI agent](#oneuptime-ai-agent).

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on any machine that can reach your Ceph mgr daemons (port 9283)
- The Ceph mgr `prometheus` module enabled (see below)
- A **OneUptime Telemetry Ingestion Key** — create one from _Project Settings → Telemetry Ingestion Keys_

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
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/CephAgent/install.sh -o install.sh
bash install.sh
```

The script prompts for your OneUptime URL, telemetry ingestion key, cluster name, and mgr endpoints, installs to `/opt/oneuptime-ceph-agent`, and starts the agent with Docker Compose. Run on a machine where `ceph` works with admin rights, it also offers to create the AI agent's Ceph client and put its `ceph.conf` and keyring in place (see [OneUptime AI agent](#oneuptime-ai-agent)).

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

The cluster will appear automatically in the **Ceph** section of OneUptime. The AI agent service starts too, and waits for its `ceph/` folder: see [Setting up the AI agent](#setting-up-the-ai-agent).

## Environment Variables

| Variable                            | Required | Description                                                                                                                                                                                 |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`                     | Yes      | Your OneUptime instance URL                                                                                                                                                                 |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes      | Telemetry ingestion key (_Project Settings → Telemetry Ingestion Keys_)                                                                                                                     |
| `CEPH_CLUSTER_NAME`                 | Yes      | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`)        |
| `CEPH_MGR_ENDPOINTS`                | Yes      | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283]`. The install script adds the brackets for you |

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

## Optional — Ship the Ceph Cluster Log

The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which powers the **Cluster Log** page of the Ceph dashboard. It is off by default because it requires the agent to run on a host that has the cluster log (a mon host by default). To enable it:

1. Uncomment the `filelog` receiver and the `logs` pipeline in `otel-collector-config.yaml`.
2. Uncomment the `/var/log/ceph` volume mount in `docker-compose.yml`.
3. Restart: `docker compose up -d`

Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) at read time, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.

## Auto-tag with Project Labels

Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the cluster. Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.

Add the attributes to the `resource` processor in `otel-collector-config.yaml` (next to `ceph.cluster.name`):

```yaml
processors:
  resource:
    attributes:
      # ...existing attributes...
      - key: oneuptime.label.team
        value: storage
        action: upsert
      - key: oneuptime.label.env
        value: production
        action: upsert
```

The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated; labels added manually in the OneUptime UI are never removed by the agent.

## OneUptime AI agent

The `oneuptime-ceph-ai-agent` service (image `oneuptime/resource-ai-agent`) runs the `ceph` commands OneUptime AI asks for, so an investigation can read `ceph status`, `ceph health detail`, the OSD tree, pool and PG states, recent crashes and the cluster log — and, only if you allow it, apply a fix such as marking an OSD back in or clearing `noout`. It connects as **its own Ceph client**, `client.oneuptime-ai`, with the `ceph.conf` and keyring in the `ceph/` folder next to `docker-compose.yml` (mounted read-only at `/etc/ceph`); OneUptime never sends it a credential. It registers as the cluster named `CEPH_CLUSTER_NAME`, the same one the collector reports into, and appears on that cluster's **AI → AI agent** page in OneUptime, where you also choose whether OneUptime AI proposes fixes and whether a person approves each one.

**The client's caps are the hard limit.** With the read caps below, nothing the agent runs can change the cluster, whatever its settings say. The agent runs as UID 1000 with a read-only root filesystem and no capabilities, starts `ceph` without a shell for every command, and passes its own `--conf`, `--keyring`, `--id` and `--connect-timeout` — a command can never choose another cluster, client or keyring. If you do not use OneUptime AI, delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.

### Setting up the AI agent

On a Ceph admin node (any machine where `ceph` works with the admin keyring), in the install directory (`/opt/oneuptime-ceph-agent` by default):

```bash
mkdir -p ceph
ceph config generate-minimal-conf > ceph/ceph.conf
ceph auth get-or-create client.oneuptime-ai mon 'allow r' mgr 'allow r' osd 'allow r' -o ceph/ceph.client.oneuptime-ai.keyring
sudo chown 1000:1000 ceph/ceph.client.oneuptime-ai.keyring
sudo chmod 600 ceph/ceph.client.oneuptime-ai.keyring
docker compose up -d
```

If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. The keyring is a secret: keep it mode `600`, owned by UID 1000 (the agent's user). **Never put the admin keyring there** — the agent needs nothing but its own client.

The agent connects **out** to the monitors listed in `mon_host` (TCP 3300 and 6789) and to the mgr and OSD daemons (TCP 6800–7300); Docker's default network reaches them whenever this machine does. If `mon_host` uses addresses only the host itself reaches (such as `127.0.0.1` on a monitor host), uncomment `network_mode: host` in the service.

### What it may run

Every command is checked by the same policy three times — by OneUptime's AI tools, when OneUptime queues it, and by the agent right before it starts `ceph` — and then by the monitors against the client's caps:

| Kind | Commands | When it runs |
|---|---|---|
| **Read** | `ceph status` (`-s`), `health [detail]`, `df [detail]`, `versions`, `progress`, `quorum_status`, `log last ...`, `osd tree`, `osd df`, `osd perf`, `osd stat`, `osd dump`, `osd blocked-by`, `osd find ID`, `osd metadata`, `osd ok-to-stop ID`, `osd safe-to-destroy ID`, `osd pool ls [detail]`, `osd pool stats`, `osd pool get POOL VAR`, `pg stat`, `pg dump_stuck`, `pg PGID query`, `pg ls-by-*`, `mon stat`, `mon dump`, `mgr stat`, `mgr services`, `mgr module ls`, `crash ls`, `crash info ID`, `orch ps`, `orch ls`, `orch host ls`, `orch device ls`, `balancer status`, `fs status`, `fs ls`, `mds stat` — with `--format json`, `json-pretty` or `plain` | Investigations, always |
| **Safe fix** | `ceph osd in ID`, `osd unset FLAG`, `crash archive ID`, `orch daemon restart TYPE.ID`, `pg scrub PGID`, `pg deep-scrub PGID` | Only with `ONEUPTIME_AI_ALLOW_WRITES=true`; can run unattended in *Automatic* mode |
| **Risky fix** | `ceph osd out ID`, `osd down ID`, `osd set FLAG`, `osd reweight ID 0..1`, `pg repair PGID`, `mgr fail [NAME]`, `orch daemon stop\|start TYPE.ID`, `orch restart SERVICE`, `crash archive-all`, `balancer on\|off` | Only with `ONEUPTIME_AI_ALLOW_WRITES=true`; a person approves it unless your settings say otherwise |
| **Always a person** | `ceph osd set pause` (stops all client I/O), `ceph osd pool set POOL size\|min_size N` | Only with `ONEUPTIME_AI_ALLOW_WRITES=true`, and always after a person approves |
| **Never** | Anything else: `osd purge`, `destroy`, `rm`, `lost`, `crush`, creating, deleting or renaming pools and every other pool setting, `auth` (cephx keys), `config-key` (secrets), `config`, `tell`, `daemon` and `--admin-daemon`, `injectargs`, `fs` and `mon` changes, `mgr module enable\|disable`, `orch apply\|rm\|host\|upgrade`, `crash rm\|prune`, and every option that picks a cluster, client, keyring or file (`-c`, `-k`, `--id`, `-n`, `-m`, `-i`, `-o`, `-w`, ...) | — |

FLAG is one of `noout`, `norebalance`, `nobackfill`, `norecover`, `noscrub`, `nodeep-scrub` and `pause`, and every fix names one OSD, PG, daemon, service or crash report. cephx keys and other secrets `ceph` prints are masked before the output leaves the agent.

### Allowing fixes

1. Give `client.oneuptime-ai` the caps for the fixes. `ceph auth caps` replaces the client's caps and keeps its key, so the keyring in `ceph/` stays valid. On top of the read caps, this profile allows the fixes above and no other change (verified on Ceph 19 Squid; the read caps never include `auth` or `config-key`):

   ```bash
   ceph auth caps client.oneuptime-ai \
     mon 'allow r, allow command "osd in", allow command "osd out", allow command "osd down", allow command "osd set", allow command "osd unset", allow command "osd reweight", allow command "osd pool set" with var=size, allow command "osd pool set" with var=min_size, allow command "mgr fail"' \
     mgr 'allow r, allow command "pg scrub", allow command "pg deep-scrub", allow command "pg repair", allow command "crash archive", allow command "crash archive-all", allow command "orch daemon" with action=start, allow command "orch daemon" with action=stop, allow command "orch daemon" with action=restart, allow command "orch" with action=restart, allow command "balancer on", allow command "balancer off"' \
     osd 'allow r'
   ```

   (`osd set` and `osd unset` accept any flag at the cap level; the agent's policy only ever sends the flags listed above.) A shorter, broader alternative is `mon 'allow rw' mgr 'allow rw' osd 'allow r'` — the agent's command policy is then the only limit on what a fix may do. To go back to read-only, run `ceph auth caps client.oneuptime-ai mon 'allow r' mgr 'allow r' osd 'allow r'`.

2. Add to `.env` and run `docker compose up -d`:

   ```bash
   ONEUPTIME_AI_ALLOW_WRITES=true
   # Optional: only these targets may be changed (globs; "cluster" is the target of cluster-wide flags such as noout)
   ONEUPTIME_AI_WRITE_TARGETS=osd.*,cluster
   # Optional: never change these
   ONEUPTIME_AI_PROTECTED_TARGETS=osd.0,.mgr
   ```

3. On the cluster's **AI → AI agent** page in OneUptime, choose how fixes are applied (*Ask for approval*, *Automatic* or *Bypass approval*).

`install.sh` asks about fixes on a fresh install and, when it creates the client, gives it these caps for you.

A fix's targets are written the way the agent compares them with `ONEUPTIME_AI_WRITE_TARGETS` and `ONEUPTIME_AI_PROTECTED_TARGETS`: `osd.3` for an OSD (whether the command wrote `3` or `osd.3`), the pool name, the PG id (`1.2f`), the daemon name as `ceph orch ps` lists it (`mon.host1`), the service name for `orch restart`, `mgr.NAME` for `mgr fail NAME`, `crash/ID` for a crash report, and `cluster` for cluster-wide changes (`osd set`/`unset`, `balancer on`/`off`, `crash archive-all`, `mgr fail` without a name).

### AI agent settings

These go in the same `.env`; the agent also reads `CEPH_CLUSTER_NAME` from the collector's settings above.

| Variable | Default | Description |
|---|---|---|
| `ONEUPTIME_AI_ALLOW_WRITES` | `false` | `true` lets OneUptime AI apply fixes (within the client's caps). Anything else keeps the agent read-only |
| `ONEUPTIME_AI_WRITE_TARGETS` | all | Comma-separated globs of the targets fixes may touch (see above). Empty means any, except the protected ones |
| `ONEUPTIME_AI_PROTECTED_TARGETS` | — | Comma-separated targets (or globs) OneUptime AI must never change |
| `CEPH_CLIENT_ID` | `oneuptime-ai` | The Ceph client the agent connects as, without `client.`. Its keyring is `ceph/ceph.client.<CEPH_CLIENT_ID>.keyring` |
| `CEPH_CONF` / `CEPH_KEYRING` | `/etc/ceph/ceph.conf` / `/etc/ceph/ceph.client.<CEPH_CLIENT_ID>.keyring` | Paths **inside the agent's container**, for a layout other than the `ceph/` folder; set them in the service's `environment:`. Each must be one plain absolute path |

### Troubleshooting the AI agent

```bash
docker logs --tail 100 oneuptime-ceph-ai-agent
docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status
```

`/status` shows whether the agent is registered, which cluster it serves, the Ceph release and health it last saw and, if it cannot reach the cluster, why.

| What you see | What to do |
|---|---|
| `The ceph.conf at /etc/ceph/ceph.conf is not in the agent's container` | Put `ceph config generate-minimal-conf`'s output at `ceph/ceph.conf` next to `docker-compose.yml`. |
| `The keyring ... is not in the agent's container` / `is not a file` | Create the client's keyring in `ceph/` (see [Setting up the AI agent](#setting-up-the-ai-agent)); Docker mounts an empty directory where a file is missing. |
| `... is not readable by the agent (UID 1000)` | `sudo chown 1000:1000 ceph/ceph.client.oneuptime-ai.keyring && sudo chmod 600 ceph/ceph.client.oneuptime-ai.keyring` |
| `The monitors rejected client.oneuptime-ai's key` | The keyring belongs to another client or an old key: export it again with `ceph auth get client.oneuptime-ai -o ceph/ceph.client.oneuptime-ai.keyring`, and check `CEPH_CLIENT_ID`. |
| `The agent cannot reach the monitors in ... (mon_host)` / `timed out` | Check `mon_host` in `ceph/ceph.conf` and that this machine reaches the monitors on TCP 3300 and 6789 (or use `network_mode: host`). |
| `client.oneuptime-ai may not read this: give it the read caps` | `ceph auth caps client.oneuptime-ai mon 'allow r' mgr 'allow r' osd 'allow r'` |
| `client.oneuptime-ai's caps do not allow this change` | Give it the fixes caps (see [Allowing fixes](#allowing-fixes)), or leave that change to a person. |
| `... this agent is read-only` | Set `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and `docker compose up -d`. |
| `Killed (timeout ...): ceph produced no output at all` | The monitors are unreachable, or the command needs an active mgr (`pg`, `df`, `osd df`, `crash`, `orch`, `balancer`): check `ceph mgr stat`. |
| `This cluster has no orchestrator backend (cephadm)` | Normal on clusters not managed by cephadm (Proxmox, Rook, packages): OneUptime AI uses the other commands. |

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

Then remove the AI agent's Ceph client if you created one: `ceph auth del client.oneuptime-ai`.

## Troubleshooting

### Run the doctor script first

`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics, and a **definitive server-side token validation**. The last one matters most: OneUptime's OTLP endpoints refuse a bad ingestion key with `401` (`422` for a disabled key or a browser key), and the collector drops each refused batch with a single `Exporting failed` log line that is easy to miss. The script asks `GET <url>/otlp/v1/validate` from inside the agent's network namespace for a direct 200/401 verdict:

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/CephAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh                 # add -d <dir> if you installed outside /opt/oneuptime-ceph-agent
```

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

# View the AI agent's logs and status
docker logs -f oneuptime-ceph-ai-agent
docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status

# Check which mgr is active
ceph mgr stat

# Test a mgr metrics endpoint by hand
curl http://<mgr-host>:9283/metrics | head
```
