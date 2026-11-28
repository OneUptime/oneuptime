# OneUptime Storage Array Agent

Monitor storage arrays — capacity, latency, IOPS and bandwidth, volumes, hosts, pods and replication, hardware health, file systems, buckets and quotas — with OneUptime using a pre-configured OpenTelemetry Collector.

The agent is config-only: a stock `otel/opentelemetry-collector-contrib` container with a tuned config that scrapes the array's metrics — its OpenMetrics endpoints, its vendor's exporter beside the collector, or a Dell PowerScale's nodes over SNMP — stamps every metric with your array's identity, and ships it to OneUptime over OTLP. It supports:

| Array | How the agent reads it | Collector config |
|---|---|---|
| **Pure Storage FlashArray**, Purity//FA 6.7 and later | The array's own OpenMetrics endpoint (`https://<array>/metrics/...?namespace=purefa`) — no sidecar | `otel-collector-config.yaml` (default) |
| **Pure Storage FlashArray**, older Purity//FA | Pure's [FlashArray OpenMetrics exporter](https://github.com/PureStorage-OpenConnect/pure-fa-openmetrics-exporter), run as the `pure-fa-exporter` sidecar | `otel-collector-config.flasharray-exporter.yaml` |
| **Pure Storage FlashBlade** | Pure's [FlashBlade OpenMetrics exporter](https://github.com/PureStorage-OpenConnect/pure-fb-openmetrics-exporter), run as the `pure-fb-exporter` sidecar | `otel-collector-config.flashblade.yaml` |
| **Dell PowerStore** | Dell's [PowerStore Metrics Exporter](https://github.com/dell/powerstore-metrics-exporter), built and run as the `powerstore-exporter` sidecar; the cluster's alerts arrive by syslog at the `powerstore-syslog` collector | `otel-collector-config.powerstore.yaml` |
| **NetApp ONTAP** 9.12.1 and later (AFF, FAS, ASA, ONTAP Select, Cloud Volumes ONTAP), and **Amazon FSx for NetApp ONTAP** | [NetApp Harvest](https://github.com/NetApp/harvest) 26.11, run as the `netapp-harvest` sidecar: it logs in to the cluster's REST API with a read-only user and password | `otel-collector-config.netapp-ontap.yaml` |
| **Dell PowerScale** (Isilon), OneFS 8.0 and later | Each node over SNMP (Dell's ISILON-MIB), with the collector's own `snmp` receiver — no sidecar ([Dell PowerScale](#dell-powerscale)) | `otel-collector-config.powerscale.yaml` |

Pure Storage renamed itself **Everpure** in February 2026. FlashArray, FlashBlade and Purity kept their names, and so did the `purefa_*` / `purefb_*` metrics — everything here applies unchanged.

One agent monitors one array. Run one agent per array (see [Monitoring several arrays](#monitoring-several-arrays)).

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on any machine that can reach the array's management interface over HTTPS (TCP 443) — for ONTAP, the cluster management address. For a PowerStore, an x86-64 machine: Dell releases its exporter for x86-64 only
- A user on the array holding the **readonly** role, and an API token for it (see below). A PowerStore takes a user name and password instead (see [Dell PowerStore](#dell-powerstore)); an ONTAP cluster takes a read-only REST user and its password (see below)
- A **OneUptime ingestion key** — create one from _Project Settings → Telemetry & APM → Ingestion Keys_

### Creating the read-only user and its API token

The agent only ever reads. Give it a dedicated user with the built-in **readonly** role — never an administrator — and an API token for that user. Create the token **without an expiry**, or the agent stops the day it expires.

**FlashArray, Purity CLI** (SSH to the array as an administrator):

```bash
pureadmin create --role readonly oneuptime
pureadmin create --api-token oneuptime
```

The second command prints the token (a UUID). **FlashArray GUI:** open _Settings → Users and Policies_ (_Settings → Access_ on older releases), choose **Create User…** from the ⋮ menu of the **Users** panel and give the user the readonly role, then choose **Create API Token…** from the new user's ⋮ menu and leave **Expires In** empty.

**FlashBlade:** create a user with the **readonly** role and an API token for it the same way — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI. Releases without local users take a directory-service (LDAP / Active Directory) account whose group maps to the readonly role instead. FlashBlade API tokens start with `T-`.

**NetApp ONTAP** (SSH to the cluster as an administrator): a REST role that may read every API and nothing else, and an HTTP user with a password that holds it. The second command asks for the password:

```bash
security login rest-role create -role oneuptime-readonly -api /api -access readonly
security login create -user-or-group-name oneuptime -application http -authentication-method password -role oneuptime-readonly
```

In System Manager, the same is _Cluster → Settings → Users and Roles_: add a role with the REST API path `/api` and **Read-Only** access, then a user with that role and the **HTTP** login method with a password. Harvest needs nothing more: it never writes to the cluster.

**Amazon FSx for NetApp ONTAP** (SSH to the file system's management endpoint as `fsxadmin`): create the same user with FSx's predefined read-only role.

```bash
security login create -user-or-group-name oneuptime -application http -authentication-method password -role fsxadmin-readonly
```

The agent's address is the file system's **management endpoint** (its DNS name or IP, from the FSx console). FSx runs the file system on hardware AWS manages and answers no one's questions about disks, shelves or sensors, so the cluster's Hardware tab lists its nodes and ports and says why the rest is missing.

### Native endpoint or exporter?

Pure documents the native OpenMetrics endpoint for **Purity//FA 6.7.0 and later** (the deprecation notice on Pure's exporter says 6.6.11 and later). The quickest way to know is to ask the array, from the machine the agent will run on:

```bash
curl -k 'https://<array>/metrics/array?namespace=purefa' --header 'Authorization: Bearer <api-token>' | grep purefa_info
```

A `purefa_info{...} 1` line means the array serves its metrics natively: use the default config. A 404 means it does not: use the exporter config. FlashBlade always goes through Pure's exporter, and ONTAP always through NetApp Harvest: ONTAP has no metrics endpoint of its own.

### Dell PowerStore

The agent reads a PowerStore cluster through Dell's [PowerStore Metrics Exporter](https://github.com/dell/powerstore-metrics-exporter) (release `powerstore-metrics-exporter_v1.0.3`, Apache-2.0). Dell publishes it as a release binary, not an image, so the `powerstore-exporter` service builds Dell's documented image from `powerstore-exporter.Dockerfile` the first time it starts: busybox and Dell's binary, checked against its SHA-256. That one build needs to reach `quay.io` and `github.com`. The exporter answers the collector over the compose network only, and nothing is published.

**The user.** Dell's exporter logs in to the cluster's REST API with a user name and password: PowerStore has no API tokens. In PowerStore Manager, add a local user under _Settings → Users_ for the agent alone:

- **Storage Operator** on PowerStoreOS 4.1 and later (and on any cluster with thousands of volumes or file systems). The exporter reads performance from PowerStore's five-minute bulk metrics archive (`POWERSTORE_BULK_METRICS=true`, the default), which it turns on itself, and Dell's exporter needs that archive from PowerStoreOS 4.1. Storage Operator is the least role that may turn the archive on: Dell's README says the Operator role is not enough. It is also a role that can change storage, so give it a password nobody else knows, and keep the agent's machine and `.env` (mode 600) as you would an administrator's.
- **Operator** (read-only) on a PowerStoreOS older than 4.1, with `POWERSTORE_BULK_METRICS=false` in `.env`. The exporter then asks the cluster for each object's performance one by one. Dell warns this can strain a large cluster's metrics service; `POWERSTORE_REQUEST_LIMIT` (16 at once by default) is how many requests it sends together.

`POWERSTORE_API_VERSION` is `v3` (PowerStoreOS 3.6 and later, the default) or `v1` for an older release. The password is read from `.env` by the exporter alone — the collector never uses it — and the exporter's config file, which holds it, is written to a tmpfs each time the exporter starts. A `$` or a quote in the password is fine.

**Its alerts.** Dell's exporter reads no alerts, so the cluster sends its own: the `powerstore-syslog` service (the same pinned collector image, with `powerstore-syslog.yaml`) takes PowerStore's remote syslog on port **5514**, TCP and UDP, and ships every line to the array's Logs tab. It reads PowerStore's record into attributes — `powerstore.alert.id`, `powerstore.alert.state` (Active or Cleared), `powerstore.event.code`, `powerstore.resource.name`, … — and gives each alert the severity Dell's _Events and Alerts Reference Guide_ gives its event code (`powerstore.alert.severity`: Critical, Major, Minor or Info), which the alert templates read. To send it:

1. In PowerStore Manager, open _Settings → Security → Remote Logging_ and add a remote syslog server: this machine's address, port `5514`, UDP or TCP. Choose the audit types to send besides the alerts.
2. Open the port on this machine's firewall for the cluster's management network.
3. Optional, over TLS (TCP only): make a certificate, import it into PowerStore as the server's CA (_Remote Logging → Import certificate_), and in `docker-compose.yml` uncomment the `6514` port and the two certificate mounts; in `powerstore-syslog.yaml` uncomment `syslog/tls` and add it to the pipeline's receivers. Then point PowerStore at port `6514` with TLS on. In the agent's folder:

   ```bash
   openssl req -x509 -newkey rsa:4096 -nodes -days 825 \
     -subj "/CN=<this-machine>" -addext "subjectAltName=DNS:<this-machine>" \
     -keyout powerstore-syslog-tls.key -out powerstore-syslog-tls.crt
   sudo chown 10001:10001 powerstore-syslog-tls.key && sudo chmod 0400 powerstore-syslog-tls.key
   ```

`POWERSTORE_SYSLOG_PORT` moves the published port, for a second PowerStore agent on the same machine.

## Quick Start — Install Script

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent -o install.sh
bash install.sh
```

Every OneUptime serves this script and the agent's files for its own release, at `<your OneUptime URL>/install/storage-array-agent`: on a self-hosted OneUptime, use its URL in place of `https://oneuptime.com` in the commands here. The first line saves the script as `install.sh`, so you can read it before you run it.

The script asks which array this is (FlashArray with native metrics, an older FlashArray, a FlashBlade, a Dell PowerStore or a NetApp ONTAP cluster), then for your OneUptime URL, telemetry ingestion key, a stable array name, the array's management address and the read-only user's API token (read without echo) — for a PowerStore or an ONTAP cluster, the user's name and password (read without echo). It installs to `/opt/oneuptime-storage-array-agent`, downloads the compose file, every collector config, the PowerStore exporter's Dockerfile and syslog config and Harvest's four files, writes a `0600` `.env` file with the matching config and compose profile, and starts the agent with Docker Compose. Re-running it reuses everything in an existing `.env` instead of prompting again, and keeps any file you edited as `<file>.bak.<timestamp>` before replacing it.

## Quick Start — Docker Compose

Download `docker-compose.yml` and the three `otel-collector-config*.yaml` files from your OneUptime into a folder:

```bash
curl -fsSLO https://oneuptime.com/install/storage-array-agent/docker-compose.yml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flasharray-exporter.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flashblade.yaml
```

Then create a `.env` file next to them (`chmod 600 .env` — it holds the API token). For a FlashArray with native metrics:

```bash
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_TELEMETRY_INGESTION_KEY=your-telemetry-ingestion-key
STORAGE_ARRAY_NAME=fa-prod-01
STORAGE_SYSTEM=purestorage.flasharray
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.yaml
COMPOSE_PROFILES=
PURE_FA_ENDPOINT=fa-prod-01.example.com
PURE_FA_API_TOKEN=your-read-only-api-token
STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true
```

For an older FlashArray, set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter`. For a FlashBlade, set `STORAGE_SYSTEM=purestorage.flashblade`, `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flashblade.yaml`, `COMPOSE_PROFILES=flashblade`, and `PURE_FB_ENDPOINT` / `PURE_FB_API_TOKEN` instead of the `PURE_FA_*` pair.

For a Dell PowerStore, also download its three files:

```bash
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.powerstore.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/powerstore-exporter.Dockerfile
curl -fsSLO https://oneuptime.com/install/storage-array-agent/powerstore-syslog.yaml
```

and write its `.env` with the name and password of [the PowerStore user](#dell-powerstore). Put the password in single quotes, as here: Compose reads a value in single quotes as it is. A password with a `'` in it goes in double quotes instead, with each `"` and `\` in it written `\"` and `\\`, and each `$` written `$$`.

```bash
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_TELEMETRY_INGESTION_KEY=your-telemetry-ingestion-key
STORAGE_ARRAY_NAME=ps-prod-01
STORAGE_SYSTEM=dell.powerstore
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.powerstore.yaml
COMPOSE_PROFILES=powerstore
POWERSTORE_ENDPOINT=ps-prod-01.example.com
POWERSTORE_USERNAME=oneuptime
POWERSTORE_PASSWORD='the-users-password'
```

For a NetApp ONTAP cluster or Amazon FSx for NetApp ONTAP, download the NetApp config and Harvest's four files too:

```bash
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.netapp-ontap.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest.yml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest-rest.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest-keyperf.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest-restperf.yaml
```

and use this `.env`. Put the password in single quotes, as here: Compose then reads it exactly as written, whatever it holds (a password with a `'` in it goes in double quotes, with `\"`, `\\` and `$$` for a `"`, a `\` and a `$`):

```bash
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_TELEMETRY_INGESTION_KEY=your-telemetry-ingestion-key
STORAGE_ARRAY_NAME=ontap-prod-01
STORAGE_SYSTEM=netapp.ontap
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.netapp-ontap.yaml
COMPOSE_PROFILES=netapp-ontap
NETAPP_ONTAP_ENDPOINT=ontap-prod-01.example.com
NETAPP_ONTAP_USERNAME=oneuptime
NETAPP_ONTAP_PASSWORD='the-read-only-user-password'
STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true
```

Then start the agent:

```bash
docker compose up -d
```

After the first scrape (about a minute) the array appears automatically in the **Storage Arrays** section of OneUptime.

## Dell PowerScale

The agent polls a PowerScale (Isilon) cluster over SNMP, reading Dell's ISILON-MIB with the collector's own `snmp` receiver (no exporter, no API token). One cluster is one storage array.

- **Every node is polled at its own address** — a node answers SNMP only for its own drives, sensors and ports. Never use the SmartConnect zone name: it hands each poll to whichever node it picks.
- **`snmp/cluster`** (every 60 s) and **`snmp/quotas`** (every 5 min) read the cluster's health, capacity, throughput, node counts and SmartQuotas once, through `POWERSCALE_ENDPOINT`. **`snmp/node-<n>`** (every 60 s) reads node `<n>`'s health, CPU, protocol performance (NFS, SMB, S3, HDFS, ...), drives, fans, temperature and power sensors and ports.
- The config has 252 node slots (OneFS's largest cluster), `snmp/node-1` to `snmp/node-252`, each a copy of `snmp/node` at `POWERSCALE_NODE_<n>`. Only the ones `POWERSCALE_SNMP_RECEIVERS` lists run, and `install.sh` writes that list from `POWERSCALE_NODES`.
- OneFS gives sensor readings as text and CPU in per mil, throughput in bits: the `transform/powerscale` processor turns them into plain gauges, and `filter/powerscale` drops what is not a number (a sensor reading `N/A`).

Turn SNMP on with Dell's commands, on any node (OneFS applies them to the cluster), unless another tool already polls it — then reuse its community or user:

```bash
isi snmp settings modify --service yes
isi snmp settings modify --snmp-v1-v2c-access yes -c '<read-only-community>'
# or SNMPv3; the read-only user is `general` until renamed
isi snmp settings modify --snmp-v3-access yes -u '<read-only-user>' --snmp-v3-password '<authentication-password>' --snmp-v3-priv-password '<privacy-password>'
isi snmp settings view
```

Then install:

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent -o install.sh
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.powerscale.yaml bash install.sh
```

It asks for every node's address (`isi network interfaces list` lists them), the SNMP version, then the community or the SNMPv3 user and passwords (read without echo). Put `POWERSCALE_SNMP_AUTH_PROTOCOL`, `POWERSCALE_SNMP_PRIVACY_PROTOCOL` or `POWERSCALE_SNMP_SECURITY_LEVEL` in front of `bash install.sh` for an SNMPv3 user on other protocols or without privacy. A node added later: add it to `POWERSCALE_NODES` in `.env` and run `install.sh` again. `troubleshoot.sh` asks each node for `clusterName` with `snmpget` (the community or passwords go to it in a `snmp.conf` of its own, never on a command line).

Not read yet: OneFS's events, storage pools and data reduction, which only the OneFS API gives ([#11249](https://github.com/OneUptime/oneuptime/issues/11249)). Until then, send the events as SNMP traps to a OneUptime probe (`isi event channels create oneuptime snmp --host <probe> --community '<community>' --use-snmp-trap true`, then `isi event alerts modify <alert> --channel oneuptime`), with the nodes added as network devices on it.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Ingestion key (_Project Settings → Telemetry & APM → Ingestion Keys_) |
| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new array. The collector refuses to start without it |
| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray`, `purestorage.flashblade`, `dell.powerstore`, `netapp.ontap` or `dell.powerscale` (default: `purestorage.flasharray`) |
| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray), `otel-collector-config.flashblade.yaml` (FlashBlade), `otel-collector-config.powerstore.yaml` (Dell PowerStore), `otel-collector-config.netapp-ontap.yaml` (ONTAP) or `otel-collector-config.powerscale.yaml` (PowerScale) |
| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter`, `flashblade`, `powerstore` or `netapp-ontap` for the others |
| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |
| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |
| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |
| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |
| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint and in Harvest; `false` verifies it (default: `true`). Pure's and Dell's exporters never verify the array's certificate, so it does not apply to them |
| `POWERSTORE_ENDPOINT` | PowerStore | The cluster's management address — host name or IP, no `https://` |
| `POWERSTORE_USERNAME` | PowerStore | The PowerStore user Dell's exporter logs in as ([its role](#dell-powerstore)) |
| `POWERSTORE_PASSWORD` | PowerStore | That user's password. Only the exporter uses it |
| `POWERSTORE_BULK_METRICS` | No | `true` reads performance from PowerStore's five-minute bulk metrics archive (the default; needed from PowerStoreOS 4.1, and it needs Storage Operator); `false` reads each object one by one |
| `POWERSTORE_API_VERSION` | No | `v3` (PowerStoreOS 3.6 and later, the default) or `v1` |
| `POWERSTORE_REQUEST_LIMIT` | No | How many requests Dell's exporter sends the cluster at once (default: `16`) |
| `POWERSTORE_SYSLOG_PORT` | No | The port this machine takes the cluster's syslog on, TCP and UDP (default: `5514`) |
| `NETAPP_ONTAP_ENDPOINT` | ONTAP | The cluster's management address (for FSx, the file system's management endpoint) — host name or IP, no `https://` |
| `NETAPP_ONTAP_USERNAME` | ONTAP | The read-only REST user (`oneuptime` above) |
| `NETAPP_ONTAP_PASSWORD` | ONTAP | Its password. Only Harvest reads it, exactly as written |
| `POWERSCALE_NODES` | PowerScale | Every node's address, comma-separated — never the SmartConnect zone name. `install.sh` writes the three below from it |
| `POWERSCALE_ENDPOINT` | PowerScale | The node the cluster's own objects (health, capacity, quotas) are read through: the first node |
| `POWERSCALE_SNMP_RECEIVERS` | PowerScale | The polls the collector runs: `[snmp/cluster, snmp/quotas, snmp/node-1, ...]`, one `snmp/node-<n>` per node |
| `POWERSCALE_NODE_<n>` | PowerScale | Node `<n>`'s address, 1 to 252 (an IPv6 address in brackets) |
| `POWERSCALE_SNMP_VERSION` | No | `v2c` (default) or `v3` |
| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | The cluster's read-only community. OneFS's default, `I$ilonpublic`, works: `install.sh` refuses only `$$` and `${`, which the collector would expand |
| `POWERSCALE_SNMP_USER` | SNMPv3 | The cluster's SNMPv3 read-only user |
| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv` (default), `auth_no_priv` or `no_auth_no_priv` |
| `POWERSCALE_SNMP_AUTH_PROTOCOL` / `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | `SHA` (default), `MD5`, `SHA224`, `SHA256`, `SHA384` or `SHA512`, and the password |
| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` / `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3, `auth_priv` | `AES` (default), `DES`, `AES192`, `AES256`, `AES192C` or `AES256C`, and the password |
| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-storage-array-agent`). A second array's agent on the same machine needs one of its own ([Monitoring several arrays](#monitoring-several-arrays)): `install.sh` names a new agent after its directory unless you set it, and keeps it on every re-run |

## Scrape Behavior

- **One scrape job per endpoint**, each read as often as it is worth. FlashArray: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes (Pure's own recommendation — directory space is expensive for the array to compute). FlashBlade: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes.
- **Every job labels its series `scrape_endpoint: <endpoint>`.** Each endpoint also exports `purefa_info` / `purefb_info`, so OneUptime knows which families a batch is the complete list of — that is how a deleted volume, host, pod, file system or bucket leaves the inventory instead of lingering. Keep the labels as shipped.
- **Per-volume and per-host latency keeps three dimensions.** Each volume and host exports its latency in up to sixteen `dimension`s; a `metric_relabel_configs` rule keeps `usec_per_read_op`, `usec_per_write_op` and `usec_per_mirrored_write_op` and drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown (`purefa_array_performance_latency_usec`) is kept. Delete the rule to keep the per-volume breakdown too.
- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape per request, so the `batch` processor never splits a scrape. Keep the batch settings as shipped.
- **A PowerStore is read every 5 minutes**, its cluster's own state every minute (its heartbeat). PowerStore computes its performance and space in five-minute samples, and its capacity series are the latest of its daily space figures, so reading them more often only repeats a sample. The exporter serves each part of the cluster at `/metrics/<cluster>/<part>`: `cluster`, `appliance`, `capacity`, `hardware`, `port`, `volume`, `volumeGroup`, `nas` and `file`.
- **ONTAP: Harvest polls, the collector scrapes Harvest.** Harvest reads the cluster's configuration and state (Rest collector) every 3 minutes, its performance (KeyPerf for the cluster, nodes, aggregates, volumes and LUNs; RestPerf for ports and shelf parts) every minute and its EMS events every 3 minutes, and serves the latest of everything on `netapp-harvest:12990`, which the collector scrapes every 60 seconds (`scrape_endpoint: harvest`). The three `netapp-harvest-*.yaml` files limit Harvest to the objects OneUptime reads. Harvest's own `netapp_metadata_*` series say which objects it listed in full, so a deleted volume leaves the inventory and an object Harvest could not read (FSx's disks) keeps its last count. Harvest's measurements of itself are dropped. A SnapMirror relationship's schedule is turned into `netapp_snapmirror_schedule_seconds` (hourly: 3600), which the SnapMirror Behind Schedule alert compares its lag with.
- **ONTAP: Harvest's AutoSupport is off.** Harvest would otherwise send NetApp a daily report about itself and the cluster; the agent sends nothing to anyone but your OneUptime.

## Collected Metrics

Pure's semantic conventions are shared by the FlashArray native endpoint and both exporters. Every value is a gauge the array computes itself — latencies in microseconds per operation, throughput per second — and objects are identified by datapoint labels (`name`, `host`, `component_name`):

- **FlashArray array** (`/metrics/array`): `purefa_info`, `purefa_alerts_open`, `purefa_array_space_*`, `purefa_array_performance_*`, `purefa_hw_component_status`, `purefa_hw_component_temperature_celsius`, `purefa_hw_controller_info`, `purefa_drive_capacity_bytes`, `purefa_network_interface_*`
- **FlashArray volumes** (`/metrics/volumes`): `purefa_volume_performance_*`, `purefa_volume_space_*`
- **FlashArray hosts** (`/metrics/hosts`): `purefa_host_connectivity_info`, `purefa_host_connections_info`, `purefa_host_performance_*`, `purefa_host_space_*`
- **FlashArray pods** (`/metrics/pods`): `purefa_pod_performance_*`, `purefa_pod_space_*`, `purefa_pod_replica_links_*`
- **FlashArray directories** (`/metrics/directories`): `purefa_directory_performance_*`, `purefa_directory_space_*`
- **FlashBlade array** (`/metrics/array`): `purefb_info`, `purefb_alerts_open`, `purefb_array_space_*`, `purefb_array_performance_*`, `purefb_hardware_health`
- **FlashBlade file systems** (`/metrics/filesystems`): `purefb_file_systems_space_*`, `purefb_file_systems_performance_*`
- **FlashBlade object store** (`/metrics/objectstore`): `purefb_buckets_*`, `purefb_object_store_accounts_*`
- **PowerStore**, from Dell's exporter: `powerstore_cluster` and `powerstore_metro_*` (the cluster); `powerstore_appliance` and `powerstore_perf_avg_*` (each appliance's latency, IOPS, bandwidth and CPU); `powerstore_cap_*` (each appliance's space and data reduction); `powerstore_hardware_*` and `powerstore_wear_metrics_by_drive` (nodes, drives, fans, power supplies, batteries); `powerstore_fc_port_*`, `powerstore_eth_port_*`, `powerstore_metricFcPort_*` and `powerstore_metricEthPort_*` (front-end ports); `powerstore_volume_*` and `powerstore_metricVolume_*`; `powerstore_volumegroup_*` and `powerstore_metricVg_*`; `powerstore_nas_server_operational_status` and `powerstore_metricNas_*`; `powerstore_filesystem_*` and `powerstore_metricFilesystem_*`. The agent adds `powerstore_cap_physical_used_percent` (each appliance's physical space in use) and `powerstore_filesystem_logical_used_percent` (each file system's), and reads a node's state as 1 when it is Healthy and 0 otherwise, as Dell's description of the series says (dell/powerstore-metrics-exporter#24). PowerStore's exporter reports no hosts and no replication sessions, so this version has neither.

- **NetApp ONTAP** (all from Harvest, prefixed `netapp_`): the cluster's identity, health and subsystems (`netapp_cluster_*`, `netapp_subsystem_*`); nodes (`netapp_node_*`: health, model, version, failed fans and power supplies, CPU and uptime); aggregates (`netapp_aggr_*`: size, use, data reduction, state and performance); SVMs (`netapp_svm_*`); volumes and LUNs (`netapp_volume_*`, `netapp_lun_*`: size, use, state, latency, IOPS and throughput); disks, shelves and their parts, and the nodes' sensors (`netapp_disk_*`, `netapp_shelf_*`, `netapp_environment_sensor_*`); Ethernet and Fibre Channel ports (`netapp_net_port_*`, `netapp_nic_*`, `netapp_fcp_*`); SnapMirror relationships (`netapp_snapmirror_*`: lag, health, last transfer); ONTAP's own open problems (`netapp_health_*_alerts`: broken disks, shelf faults, HA takeover, ports down, system health alerts) and EMS events (`netapp_ems_events`, with Harvest's default list of events)

See the [Storage Array monitor docs](https://oneuptime.com/docs/monitor/storage-array-monitor) for the metric catalog and the alert templates built on these series.

## Optional — Ship the Array's Syslog

A PowerStore's syslog collector runs with its profile and takes the cluster's alerts as shipped (see [Dell PowerStore](#dell-powerstore)); this section is for Pure's arrays.

By default the agent ships **metrics only** — the Logs tab of the storage array stays empty until you enable a log receiver. Arrays forward their alerts and audit events as syslog, and every shipped config contains a commented-out `syslog` receiver pair (TCP and UDP on port 5514, RFC 3164) wired to a commented `logs` pipeline that stamps `storage.array.name` so the logs land on your array. To enable it:

1. **Uncomment the two `syslog/*` receivers and the `logs` pipeline** in the collector config you use. RFC 3164 timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.
2. **Uncomment the `ports:` block** in `docker-compose.yml` so the host publishes `5514/tcp` and `5514/udp`, then `docker compose up -d`. Open the port on the machine's firewall for the array's management network.
3. **Point the array at the agent** — as an administrator, not the read-only monitoring user. On a FlashArray, open _Settings → System → Syslog Servers_, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`), and send a test message. On a FlashBlade, add a syslog server with the same URI in its syslog settings. Both take the `PROTOCOL://HOST:PORT` form, also through their REST APIs (`syslog-servers`).

The syslog receiver honours only one transport per receiver, which is why TCP and UDP are separate named receivers — leave either commented if you only need one.

## Auto-tag with Project Labels

Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the array. Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.

Add the attributes to the `resource` processor in the collector config you use (next to `storage.array.name`):

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

The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated; labels added manually in the OneUptime UI are never removed by the agent.

## Monitoring several arrays

One agent reads one array. To monitor several from the same machine, install each into its own directory with its own `.env` and its own container name — two containers cannot share a name:

```bash
INSTALL_DIR=/opt/oneuptime-storage-array-agent-fa02 \
STORAGE_ARRAY_AGENT_CONTAINER_NAME=oneuptime-storage-array-agent-fa02 \
bash install.sh
```

Without `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, `install.sh` names the container after its directory (`oneuptime-storage-array-agent-fa02` here too). Either way the name is written to that agent's `.env`, which `docker-compose.yml` reads it from (`container_name: ${STORAGE_ARRAY_AGENT_CONTAINER_NAME:-oneuptime-storage-array-agent}`), so re-running `install.sh` to upgrade the agent keeps it. Leave `container_name` in `docker-compose.yml` as it is: an upgrade replaces that file. An agent set up before `.env` held the name, by editing `container_name` there, keeps that name on its next upgrade — `install.sh` reads it from the old file (or the container it runs, or the copy an earlier upgrade kept) and writes it to `.env`. With Docker Compose, set `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in each agent's `.env`.

A second PowerStore agent also needs a syslog port of its own: set `POWERSTORE_SYSLOG_PORT` (for example `5515`) in its `.env`, and point that cluster's remote logging at it. Pass the directory to the doctor script with `-d`.

## Run as a systemd Service

To survive reboots without relying on Docker's restart policy alone, install the provided unit:

```bash
sudo curl -fsSL https://oneuptime.com/install/storage-array-agent/systemd/oneuptime-storage-array-agent.service -o /etc/systemd/system/oneuptime-storage-array-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-storage-array-agent
```

The unit assumes the agent lives in `/opt/oneuptime-storage-array-agent` (the install script default).

## Upgrading

The collector and exporter images are pinned in `docker-compose.yml`, and the collector configs report the collector's pin to OneUptime as the agent's version (`oneuptime.agent.version`). When a newer OneUptime release pins a newer collector, a warning sign appears beside the **Agent Version** on the array's page; select it to see these commands.

Re-run `install.sh`: it reuses every value in your existing `.env` (nothing is prompted for again), refreshes `docker-compose.yml`, every collector config and Harvest's files (a file you edited is kept as `<file>.bak.<timestamp>`), and recreates the agent so the collector reads its new config. The script records what it installed in `.agent-files.sha256`, so a file nobody edited is replaced without a copy, however much the new version changed; in a directory without that record (one you set up by hand) every file that differs from the new version is kept, since it may hold edits. An agent installed outside `/opt/oneuptime-storage-array-agent` needs its folder: `INSTALL_DIR=<folder> bash install.sh`. It keeps its container name.

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent -o install.sh
bash install.sh
```

Installed it with Docker Compose instead? In the agent's folder, download the compose file and the collector configs again (for ONTAP, the NetApp config and Harvest's four files too), then pull and recreate the agent (re-apply any change you made to those files):

```bash
curl -fsSLO https://oneuptime.com/install/storage-array-agent/docker-compose.yml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flasharray-exporter.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flashblade.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.powerstore.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/powerstore-exporter.Dockerfile
curl -fsSLO https://oneuptime.com/install/storage-array-agent/powerstore-syslog.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.netapp-ontap.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest.yml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest-rest.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest-keyperf.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest-restperf.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.powerscale.yaml
docker compose pull
docker compose up -d --force-recreate
```

These commands download a PowerStore agent's three files too (`otel-collector-config.powerstore.yaml`, `powerstore-exporter.Dockerfile` and `powerstore-syslog.yaml`): like `install.sh`, they fetch every file the agent runs, whichever array it reads. `docker compose pull` passes over the exporter's image, which is built on this machine; `docker compose up` builds it again when a new release moves its tag.

An agent installed before its config reported a version shows none until it is upgraded this way.

## Uninstalling

```bash
cd /opt/oneuptime-storage-array-agent
docker compose down
```

Then delete the read-only user (and its API token) on the array if you no longer need it. On a PowerStore, run `docker compose --profile powerstore down` instead, to stop the exporter and the syslog collector too, then delete the agent's user and the remote syslog server. On ONTAP: `security login delete -user-or-group-name oneuptime -application http -authentication-method password`, then `security login rest-role delete -role oneuptime-readonly -api /api`. On a PowerScale, turn SNMP off or change the agent's community or SNMPv3 passwords if nothing else polls the cluster.

## Troubleshooting

### Run the doctor script first

`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, token shape, collector self-metrics, and a **definitive server-side token validation**. The last one matters most: OneUptime's OTLP endpoints refuse a bad ingestion key with `401` (`422` for a disabled key or a browser key), and the collector drops each refused batch with a single `Exporting failed` log line that is easy to miss. The script asks `GET <url>/otlp/v1/validate` from inside the agent's network namespace for a direct 200/401 verdict:

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh                 # add -d <dir> if you installed outside /opt/oneuptime-storage-array-agent
```

### No array appears in OneUptime

1. Check the collector logs: `docker logs oneuptime-storage-array-agent` — `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` / `connection refused` means a wrong `PURE_FA_ENDPOINT` / `PURE_FB_ENDPOINT`, and an export `401` means a bad ingestion key.
2. Ask the array by hand, from the agent's network namespace (the collector image is distroless, so test from alongside it): `docker run --rm --network container:oneuptime-storage-array-agent curlimages/curl -sk -H 'Authorization: Bearer <api-token>' 'https://<array>/metrics/array?namespace=purefa' | grep purefa_info`.
3. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.

### The FlashArray answers 404

Its Purity//FA has no native OpenMetrics endpoint. Re-run `install.sh` and choose the older-Purity option, or set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d`. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.

### The array refuses the API token

Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` and run `docker compose up -d`.

### `x509` / TLS errors

Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.

### A PowerStore sends nothing

1. Check the exporter: `docker compose logs powerstore-exporter`. A `401` means a wrong user name or password; a `403` on `latest_five_min_metrics` means the user's role cannot turn the bulk metrics archive on: give it **Storage Operator**, or set `POWERSTORE_BULK_METRICS=false` on a PowerStoreOS older than 4.1. After changing `.env`, run `docker compose up -d --force-recreate`.
2. With the bulk archive on, the exporter needs a minute after it starts before it answers, so the first scrape can come back empty.
3. Ask the exporter as the collector does: `docker run --rm --network container:oneuptime-storage-array-agent curlimages/curl -s http://powerstore-exporter:9010/metrics/<cluster>/cluster | grep powerstore_cluster`. No answer means the exporter is not running: `COMPOSE_PROFILES` must be `powerstore`, and its image must have built (`docker compose build powerstore-exporter` shows why it did not).
4. No alerts on the Logs tab: check the cluster's _Remote Logging_ settings, this machine's firewall on port 5514, and `docker compose logs powerstore-syslog`.

### `pure-fa-exporter` / `pure-fb-exporter` / `netapp-harvest` does not resolve

The exporter service is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` (`flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config, `netapp-ontap` for the ONTAP config). Fix `.env` and run `docker compose up -d`, then `docker compose ps` should list the exporter.

### ONTAP: Harvest cannot log in, or an object is missing

Read Harvest's log: `docker compose logs netapp-harvest`. `401` or `Unauthorized` means the cluster refused the user or its password: check that the user has the **http** login method (`security login show -user-or-group-name oneuptime`) and holds the read-only REST role, then fix `.env` and run `docker compose up -d`. `403` or `not authorized` on one object means the role does not reach that API: the role above reaches all of `/api`. On Amazon FSx for NetApp ONTAP, FSx answers so for disks, shelves and sensors whoever asks; that is expected, and the cluster's Hardware tab says so. `connection refused` or `no such host` means a wrong `NETAPP_ONTAP_ENDPOINT`: it is the cluster management address (for FSx, the management endpoint), not a node's or an SVM's.

### Common Commands

```bash
# Check agent status
docker compose ps

# View collector logs
docker logs -f oneuptime-storage-array-agent

# View the exporter's logs (older FlashArray / FlashBlade / PowerStore / ONTAP)
docker compose logs -f pure-fa-exporter
docker compose logs -f pure-fb-exporter
docker compose logs -f powerstore-exporter

# View the PowerStore syslog collector's logs
docker compose logs -f powerstore-syslog
docker compose logs -f netapp-harvest

# Check the collector's own counters (accepted / sent / failed datapoints)
docker run --rm --network container:oneuptime-storage-array-agent curlimages/curl -s http://127.0.0.1:8888/metrics | grep -E 'otelcol_(receiver_accepted|exporter_sent|exporter_send_failed)_metric_points'
```

See the [Storage Arrays telemetry docs](https://oneuptime.com/docs/telemetry/storage-arrays) for the full walkthrough and the [Storage Array monitor docs](https://oneuptime.com/docs/monitor/storage-array-monitor) for the metric catalog and alert templates.
