# OneUptime Storage Array Agent

Monitor storage arrays — capacity, latency, IOPS and bandwidth, volumes, hosts, pods and replication, hardware health, file systems and buckets — with OneUptime using a pre-configured OpenTelemetry Collector.

The agent is config-only: a stock `otel/opentelemetry-collector-contrib` container with a tuned config that scrapes the array's OpenMetrics endpoints with a read-only API token, stamps every metric with your array's identity, and ships it to OneUptime over OTLP. It supports:

| Array | How the agent reads it | Collector config |
|---|---|---|
| **Pure Storage FlashArray**, Purity//FA 6.7 and later | The array's own OpenMetrics endpoint (`https://<array>/metrics/...?namespace=purefa`) — no sidecar | `otel-collector-config.yaml` (default) |
| **Pure Storage FlashArray**, older Purity//FA | Pure's [FlashArray OpenMetrics exporter](https://github.com/PureStorage-OpenConnect/pure-fa-openmetrics-exporter), run as the `pure-fa-exporter` sidecar | `otel-collector-config.flasharray-exporter.yaml` |
| **Pure Storage FlashBlade** | Pure's [FlashBlade OpenMetrics exporter](https://github.com/PureStorage-OpenConnect/pure-fb-openmetrics-exporter), run as the `pure-fb-exporter` sidecar | `otel-collector-config.flashblade.yaml` |

Pure Storage renamed itself **Everpure** in February 2026. FlashArray, FlashBlade and Purity kept their names, and so did the `purefa_*` / `purefb_*` metrics — everything here applies unchanged.

One agent monitors one array. Run one agent per array (see [Monitoring several arrays](#monitoring-several-arrays)).

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on any machine that can reach the array's management interface over HTTPS (TCP 443)
- A user on the array holding the **readonly** role, and an API token for it (see below)
- A **OneUptime Telemetry Ingestion Key** — create one from _Project Settings → Telemetry Ingestion Keys_

### Creating the read-only user and its API token

The agent only ever reads. Give it a dedicated user with the built-in **readonly** role — never an administrator — and an API token for that user. Create the token **without an expiry**, or the agent stops the day it expires.

**FlashArray, Purity CLI** (SSH to the array as an administrator):

```bash
pureadmin create --role readonly oneuptime
pureadmin create --api-token oneuptime
```

The second command prints the token (a UUID). **FlashArray GUI:** open _Settings → Users and Policies_ (_Settings → Access_ on older releases), choose **Create User…** from the ⋮ menu of the **Users** panel and give the user the readonly role, then choose **Create API Token…** from the new user's ⋮ menu and leave **Expires In** empty.

**FlashBlade:** create a user with the **readonly** role and an API token for it the same way — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI. Releases without local users take a directory-service (LDAP / Active Directory) account whose group maps to the readonly role instead. FlashBlade API tokens start with `T-`.

### Native endpoint or exporter?

Pure documents the native OpenMetrics endpoint for **Purity//FA 6.7.0 and later** (the deprecation notice on Pure's exporter says 6.6.11 and later). The quickest way to know is to ask the array, from the machine the agent will run on:

```bash
curl -k 'https://<array>/metrics/array?namespace=purefa' --header 'Authorization: Bearer <api-token>' | grep purefa_info
```

A `purefa_info{...} 1` line means the array serves its metrics natively: use the default config. A 404 means it does not: use the exporter config. FlashBlade always goes through Pure's exporter.

## Quick Start — Install Script

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/install.sh -o install.sh
bash install.sh
```

The script asks which array this is (FlashArray with native metrics, an older FlashArray, or a FlashBlade), then for your OneUptime URL, telemetry ingestion key, a stable array name, the array's management address and the read-only user's API token (read without echo). It installs to `/opt/oneuptime-storage-array-agent`, downloads the compose file and all three collector configs, writes a `0600` `.env` file with the matching config and compose profile, and starts the agent with Docker Compose. Re-running it reuses everything in an existing `.env` instead of prompting again, and keeps any file you edited as `<file>.bak.<timestamp>` before replacing it.

## Quick Start — Docker Compose

Download `docker-compose.yml` and the three `otel-collector-config*.yaml` files from this directory into a folder, then create a `.env` file next to them (`chmod 600 .env` — it holds the API token). For a FlashArray with native metrics:

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

Then start the agent:

```bash
docker compose up -d
```

After the first scrape (about a minute) the array appears automatically in the **Storage Arrays** section of OneUptime.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key (_Project Settings → Telemetry Ingestion Keys_) |
| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new array. The collector refuses to start without it |
| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |
| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |
| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |
| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |
| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |
| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |
| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |
| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |

## Scrape Behavior

- **One scrape job per endpoint**, each read as often as it is worth. FlashArray: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes (Pure's own recommendation — directory space is expensive for the array to compute). FlashBlade: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes.
- **Every job labels its series `scrape_endpoint: <endpoint>`.** Each endpoint also exports `purefa_info` / `purefb_info`, so OneUptime knows which families a batch is the complete list of — that is how a deleted volume, host, pod, file system or bucket leaves the inventory instead of lingering. Keep the labels as shipped.
- **Per-volume and per-host latency keeps three dimensions.** Each volume and host exports its latency in up to sixteen `dimension`s; a `metric_relabel_configs` rule keeps `usec_per_read_op`, `usec_per_write_op` and `usec_per_mirrored_write_op` and drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown (`purefa_array_performance_latency_usec`) is kept. Delete the rule to keep the per-volume breakdown too.
- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape per request, so the `batch` processor never splits a scrape. Keep the batch settings as shipped.

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

See the [Storage Array monitor docs](https://oneuptime.com/docs/monitor/storage-array-monitor) for the metric catalog and the alert templates built on these series.

## Optional — Ship the Array's Syslog

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

One agent reads one array. To monitor several from the same machine, install each into its own directory with its own `.env` (`INSTALL_DIR=/opt/oneuptime-storage-array-agent-fa02 bash install.sh`), and give each one its own `container_name` in its `docker-compose.yml` (for example `oneuptime-storage-array-agent-fa02`) — two containers cannot share a name. Pass the directory to the doctor script with `-d`.

## Run as a systemd Service

To survive reboots without relying on Docker's restart policy alone, install the provided unit:

```bash
sudo cp systemd/oneuptime-storage-array-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-storage-array-agent
```

The unit assumes the agent lives in `/opt/oneuptime-storage-array-agent` (the install script default).

## Upgrading

```bash
cd /opt/oneuptime-storage-array-agent
docker compose pull
docker compose up -d
```

The collector and exporter images are pinned in `docker-compose.yml`; when a newer OneUptime release bumps a pin, re-download `docker-compose.yml` and the collector configs from this directory before pulling — or re-run `install.sh`, which reuses every value in your existing `.env` (nothing is prompted for again) and refreshes only those files.

## Uninstalling

```bash
cd /opt/oneuptime-storage-array-agent
docker compose down
```

Then delete the read-only user (and its API token) on the array if you no longer need it.

## Troubleshooting

### Run the doctor script first

`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, token shape, collector self-metrics, and a **definitive server-side token validation**. The last one matters most: OneUptime's OTLP endpoints refuse a bad ingestion key with `401` (`422` for a disabled key or a browser key), and the collector drops each refused batch with a single `Exporting failed` log line that is easy to miss. The script asks `GET <url>/otlp/v1/validate` from inside the agent's network namespace for a direct 200/401 verdict:

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/troubleshoot.sh -o troubleshoot.sh
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

### `pure-fa-exporter` / `pure-fb-exporter` does not resolve

The exporter service is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` (`flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config). Fix `.env` and run `docker compose up -d`, then `docker compose ps` should list the exporter.

### Common Commands

```bash
# Check agent status
docker compose ps

# View collector logs
docker logs -f oneuptime-storage-array-agent

# View the exporter's logs (older FlashArray / FlashBlade)
docker compose logs -f pure-fa-exporter
docker compose logs -f pure-fb-exporter

# Check the collector's own counters (accepted / sent / failed datapoints)
docker run --rm --network container:oneuptime-storage-array-agent curlimages/curl -s http://127.0.0.1:8888/metrics | grep -E 'otelcol_(receiver_accepted|exporter_sent|exporter_send_failed)_metric_points'
```

See the [Storage Arrays telemetry docs](https://oneuptime.com/docs/telemetry/storage-arrays) for the full walkthrough and the [Storage Array monitor docs](https://oneuptime.com/docs/monitor/storage-array-monitor) for the metric catalog and alert templates.
