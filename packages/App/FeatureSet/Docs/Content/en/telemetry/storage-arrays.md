# OneUptime Storage Array Agent

## Overview

The OneUptime Storage Array Agent is a pre-configured OpenTelemetry Collector that monitors storage arrays — capacity and data reduction, latency, IOPS and bandwidth, volumes, hosts, pods and replication, hardware health, file systems and buckets. It is config-only: a stock `otel/opentelemetry-collector-contrib` container that scrapes the array's OpenMetrics endpoints with the API token of a read-only user, stamps every metric with your array's identity, and forwards everything to OneUptime over OTLP. One `.env` file, one `docker compose up`.

Storage Arrays is a vendor-neutral product in OneUptime. It supports:

| Array                                                  | How the agent reads it                                                                                                                       | Collector config                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Pure Storage FlashArray**, Purity//FA 6.7 and later  | The array's own OpenMetrics endpoint (`https://<array>/metrics/...?namespace=purefa`) — nothing runs beside the collector                     | `otel-collector-config.yaml` (default)           |
| **Pure Storage FlashArray**, older Purity//FA          | Pure's FlashArray OpenMetrics exporter, run by the same Compose file as the `pure-fa-exporter` service                                       | `otel-collector-config.flasharray-exporter.yaml` |
| **Pure Storage FlashBlade**                            | Pure's FlashBlade OpenMetrics exporter, run by the same Compose file as the `pure-fb-exporter` service                                       | `otel-collector-config.flashblade.yaml`          |

Pure Storage renamed itself **Everpure** in February 2026. FlashArray, FlashBlade and Purity kept their names, and so did the `purefa_*` / `purefb_*` metrics, so everything on this page applies unchanged to arrays sold under either name.

One agent monitors one array. Run one agent per array — see [Monitoring Several Arrays](#monitoring-several-arrays).

This page is the **installation guide**. For configuring storage array monitors and alerts on top of the data the agent collects, see [Storage Array Monitor](/docs/monitor/storage-array-monitor).

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on any machine that can reach the array's management interface over HTTPS (TCP 443)
- A user on the array holding the built-in **readonly** role, and an API token for it (see below)
- A **OneUptime Telemetry Ingestion Token** — create one from _Project Settings → Telemetry & APM → Ingestion Keys_ and copy the value

### Create the Read-Only User and API Token

The agent only ever reads. Give it a dedicated user with the built-in **readonly** role — never an administrator — and an API token for that user. Create the token **without an expiry**, or the agent stops the day the token expires.

**FlashArray, with the Purity CLI** (SSH to the array as an administrator):

```bash
pureadmin create --role readonly oneuptime
pureadmin create --api-token oneuptime
```

The second command prints the API token, a UUID. **FlashArray, in the GUI:** open _Settings → Users and Policies_ (_Settings → Access_ on older releases), choose **Create User…** from the ⋮ menu of the **Users** panel and give the user the readonly role, then choose **Create API Token…** from the new user's ⋮ menu and leave **Expires In** empty.

**FlashBlade:** create a user with the **readonly** role and an API token for it the same way — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI. On a release without local users, use a directory-service (LDAP / Active Directory) account whose group maps to the readonly role. FlashBlade API tokens start with `T-`.

### Native Endpoint or Exporter?

Pure documents the native OpenMetrics endpoint for **Purity//FA 6.7.0 and later** (the deprecation notice on Pure's FlashArray exporter says 6.6.11 and later). The quickest way to know is to ask the array, from the machine the agent will run on:

```bash
curl -k 'https://<array>/metrics/array?namespace=purefa' --header 'Authorization: Bearer <api-token>' | grep purefa_info
```

A `purefa_info{...} 1` line means the array serves its metrics natively: use the default config. A `404` means it does not: use the exporter config, which runs Pure's exporter next to the collector — Pure has deprecated that exporter, so move to the native config once the array is upgraded. A FlashBlade always goes through Pure's FlashBlade exporter.

### Where to Run the Agent

The agent talks to the array's management interface over HTTPS, so it can run on any Docker-capable machine with a route to the management network on TCP 443 — a monitoring host or a small management VM. Prefer a machine whose own storage does not live on the array it watches: if the array goes down, your monitoring should not go down with it. (The optional syslog listener additionally needs the array to reach the agent on the syslog port — see [Ship the Array's Syslog](#optional-ship-the-arrays-syslog).)

## Quick Start (Install Script)

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/install.sh -o install.sh
bash install.sh
```

The script asks which array this is — a FlashArray serving native metrics, a FlashArray on an older Purity//FA, or a FlashBlade — then for your OneUptime URL, telemetry ingestion token, a stable array name, the array's management address, and the read-only user's API token (read without echo). It installs to `/opt/oneuptime-storage-array-agent`, downloads the Compose file and all three collector configs, writes a `0600` `.env` file with the matching config and Compose profile, and starts the agent with Docker Compose. Values are quoted for Docker Compose as they are written, re-running the script reuses everything in an existing `.env` instead of prompting again, and a file you edited is kept as `<file>.bak.<timestamp>` before it is replaced.

## Alternative — Docker Compose

Download `docker-compose.yml` and the three `otel-collector-config*.yaml` files from the [StorageArrayAgent directory](https://github.com/OneUptime/oneuptime/tree/master/agents/StorageArrayAgent) into a folder, then create a `.env` file next to them (`chmod 600 .env` — it holds the API token). For a FlashArray that serves native metrics:

```bash
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
STORAGE_ARRAY_NAME=my-storage-array
STORAGE_SYSTEM=purestorage.flasharray
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.yaml
COMPOSE_PROFILES=
PURE_FA_ENDPOINT=fa-prod-01.example.com
PURE_FA_API_TOKEN=YOUR_READ_ONLY_API_TOKEN
PURE_FB_ENDPOINT=
PURE_FB_API_TOKEN=
STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true
```

For a FlashArray on an older Purity//FA, set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter`. For a FlashBlade, set `STORAGE_SYSTEM=purestorage.flashblade`, `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flashblade.yaml` and `COMPOSE_PROFILES=flashblade`, and fill in `PURE_FB_ENDPOINT` and `PURE_FB_API_TOKEN` instead of the `PURE_FA_*` pair.

Start it:

```bash
docker compose up -d
```

That is it. After the first scrape (about a minute) the array appears automatically in the **Storage Arrays** section of the OneUptime dashboard.

## Environment Variables

| Variable                             | Required   | Description                                                                                                                                                                                                       |
| ------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`                      | Yes        | Your OneUptime instance URL (for example `https://oneuptime.com` or your self-hosted host)                                                                                                                        |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY`  | Yes        | Telemetry ingestion token from _Project Settings → Telemetry & APM → Ingestion Keys_                                                                                                                              |
| `STORAGE_ARRAY_NAME`                 | Yes        | The name this array registers under in OneUptime, stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it later registers a second array. The collector refuses to start without it |
| `STORAGE_SYSTEM`                     | No         | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade`. Defaults to `purestorage.flasharray`                                                       |
| `STORAGE_ARRAY_COLLECTOR_CONFIG`     | No         | Which shipped collector config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |
| `COMPOSE_PROFILES`                   | No         | Starts the exporter the chosen config scrapes: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the other two                                                                     |
| `PURE_FA_ENDPOINT`                   | FlashArray | The FlashArray's management address — host name or IP, without `https://`                                                                                                                                        |
| `PURE_FA_API_TOKEN`                  | FlashArray | API token of the FlashArray user with the readonly role                                                                                                                                                            |
| `PURE_FB_ENDPOINT`                   | FlashBlade | The FlashBlade's management address — host name or IP, without `https://`                                                                                                                                        |
| `PURE_FB_API_TOKEN`                  | FlashBlade | API token of the FlashBlade user with the readonly role                                                                                                                                                            |
| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No         | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it. Defaults to `true`. Pure's exporters never verify the array's certificate, so it does not apply to them            |

## How the Agent Scrapes

- **One scrape job per endpoint**, each read as often as it is worth. FlashArray: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes, which is Pure's own recommendation — directory space is expensive for the array to compute. FlashBlade: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes, again following Pure's advice to read the file system and object store endpoints less often than the array.
- **Every job labels its series `scrape_endpoint: <endpoint>`.** Each endpoint also exports `purefa_info` / `purefb_info`, so OneUptime knows which families a batch is the complete list of — that is how a deleted volume, host, pod, file system or bucket leaves the inventory instead of lingering. Keep the labels as shipped.
- **Per-volume and per-host latency keeps three dimensions.** Each volume and host exports its latency in up to sixteen `dimension`s. A `metric_relabel_configs` rule keeps `usec_per_read_op`, `usec_per_write_op` and `usec_per_mirrored_write_op` and drops the QoS rate limit, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown on `purefa_array_performance_latency_usec` is kept. Delete the rule to keep the per-volume breakdown too.
- **The API token is a Bearer token.** The native config sends it to the array itself; the exporter configs send it to the exporter over the Compose network only — the exporters' ports are never published.
- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape per request, so the shipped `batch` processor never splits a scrape across exports. Keep the batch settings as shipped.

## Verify the Installation

Check that the agent is running:

```bash
docker compose ps
```

Check the collector logs:

```bash
docker logs -f oneuptime-storage-array-agent
```

Look for: `"Everything is ready. Begin running and processing data."`

Within a minute or so the array appears in the OneUptime dashboard with its capacity, performance, open alerts and hardware. Volumes, hosts and pods follow within 2 minutes, a FlashBlade's file systems and buckets within 5, and FlashArray directories within 30.

## What Gets Collected

Pure's semantic conventions are shared by the FlashArray native endpoint and both exporters. Every value is a gauge the array computes itself — latencies in microseconds per operation, throughput per second — so no rate math is involved, and objects are identified by **datapoint labels** (`name` for volumes, pods, directories, file systems and buckets; `host` for hosts; `component_name` for FlashArray hardware). The agent adds the `storage.array.name` and `storage.system` resource attributes on top so OneUptime can route everything to your array:

| Endpoint                          | Metric families                                                                                                                                                                                                                                                       | What OneUptime builds from them                                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FlashArray `/metrics/array`       | `purefa_info`, `purefa_alerts_open`, `purefa_array_space_*`, `purefa_array_performance_*`, `purefa_hw_component_status`, `purefa_hw_component_temperature_celsius`, `purefa_hw_controller_info`, `purefa_drive_capacity_bytes`, `purefa_network_interface_*`             | The array's name, Purity version and system id; capacity, used space and data reduction; open alert counts; array health; the **Hardware** page (components, drives, controllers, network interfaces) |
| FlashArray `/metrics/volumes`     | `purefa_volume_performance_*`, `purefa_volume_space_*`, `purefa_volume_qos_*`                                                                                                                                                                                         | The **Volumes** page: provisioned and physical size, data reduction, read and write latency, IOPS and bandwidth per volume                                               |
| FlashArray `/metrics/hosts`       | `purefa_host_connectivity_info`, `purefa_host_connections_info`, `purefa_host_performance_*`, `purefa_host_space_*`                                                                                                                                                   | The **Hosts** page: connectivity (redundant paths or not), connected volumes, latency, IOPS and bandwidth per host                                                       |
| FlashArray `/metrics/pods`        | `purefa_pod_performance_*`, `purefa_pod_space_*`, `purefa_pod_replica_links_*`, `purefa_pod_mediator_status`                                                                                                                                                          | The **Replication** page: ActiveCluster and ActiveDR pods, replica link status and lag                                                                                  |
| FlashArray `/metrics/directories` | `purefa_directory_performance_*`, `purefa_directory_space_*`                                                                                                                                                                                                          | The **Directories** page (FlashArray File Services)                                                                                                                     |
| FlashBlade `/metrics/array`       | `purefb_info`, `purefb_alerts_open`, `purefb_array_space_*`, `purefb_array_performance_*`, `purefb_hardware_health`                                                                                                                                                   | The FlashBlade's name, Purity version and system id; capacity and data reduction; open alert counts; array health; the **Hardware** page                                |
| FlashBlade `/metrics/filesystems` | `purefb_file_systems_space_*`, `purefb_file_systems_performance_*`                                                                                                                                                                                                    | The **File Systems** page: provisioned and used space, data reduction, latency, IOPS and bandwidth per file system                                                     |
| FlashBlade `/metrics/objectstore` | `purefb_buckets_space_*`, `purefb_buckets_quota_space_bytes`, `purefb_buckets_object_count`, `purefb_buckets_performance_*`, `purefb_object_store_accounts_*`                                                                                                         | The **Buckets** page: space, quota, object count and performance per bucket, grouped by account                                                                        |

The array's health on its overview is **Critical** while it reports an open critical alert or a hardware component, drive or controller in a critical, failed, missing or unhealthy state; **Warning** while it reports an open warning alert or a degraded or unknown component; and **OK** otherwise. In ClickHouse — and therefore in monitor criteria — the array's attributes are `resource.`-prefixed (`resource.storage.array.name`, `resource.storage.system`), while the datapoint labels stay bare (`name`, `host`, `dimension`, `space`).

## Optional — Ship the Array's Syslog

By default the agent ships **metrics only**, so the Logs tab of the storage array stays empty. Arrays forward their alerts and audit events as syslog, and every shipped collector config contains a commented-out `syslog` receiver pair (TCP and UDP on port 5514, RFC 3164) wired to a commented `logs` pipeline that stamps `storage.array.name` so the logs land on your array.

To enable it:

1. **Uncomment the two `syslog/*` receivers and the `logs` pipeline** in the collector config you use. RFC 3164 timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.
2. **Uncomment the `ports:` block** in `docker-compose.yml` so the host publishes `5514/tcp` and `5514/udp`, then `docker compose up -d`. Open the port on the machine's firewall for the array's management network.
3. **Point the array at the agent**, as an administrator rather than the read-only monitoring user. On a FlashArray, open _Settings → System → Syslog Servers_, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`), and send a test message. On a FlashBlade, add a syslog server with the same URI in its syslog settings. Both arrays take the `PROTOCOL://HOST:PORT` form, also through their REST APIs (`syslog-servers`).

The syslog receiver honours only one transport per receiver, which is why TCP and UDP are separate named receivers — leave either commented if you only need one. The stock collector image handles syslog; no custom image is needed.

## Auto-tag with Project Labels

Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the storage array. Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.

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

## Monitoring Several Arrays

One agent reads one array. To monitor several from the same machine, install each into its own directory with its own `.env` — for example `INSTALL_DIR=/opt/oneuptime-storage-array-agent-fa02 bash install.sh` — and give each its own `container_name` in its `docker-compose.yml` (for example `oneuptime-storage-array-agent-fa02`): two containers cannot share a name. Pass the directory to the diagnostic script with `-d`.

## Run as a systemd Service

```bash
sudo cp systemd/oneuptime-storage-array-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-storage-array-agent
```

The unit assumes the agent lives in `/opt/oneuptime-storage-array-agent` (the install script default).

## Upgrading the Agent

The agent reports the collector version its files pin as its **Agent Version**. When that is older than the version this OneUptime release pins, a warning sign appears beside it on the array's **Overview**. Select it to see these commands. An agent installed before its files reported a version shows none until it is upgraded this way.

The collector image is pinned in `docker-compose.yml` and its configs are files next to it, so pulling alone does not move the agent forward. Re-run `install.sh`: it reuses every value in your existing `.env` (nothing is prompted for again), refreshes `docker-compose.yml` and the three collector configs (a file you edited is kept as `<file>.bak.<timestamp>`), and recreates the agent so the collector reads its new config. An agent installed outside `/opt/oneuptime-storage-array-agent` needs its folder: `INSTALL_DIR=<folder> bash install.sh`.

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/install.sh -o install.sh
bash install.sh
```

Installed it with Docker Compose instead? In the agent's folder, download the compose file and the three collector configs again (re-apply any change you made to them), then pull the images and recreate the agent:

```bash
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/otel-collector-config.yaml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/otel-collector-config.flasharray-exporter.yaml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/otel-collector-config.flashblade.yaml
docker compose pull
docker compose up -d --force-recreate
```

## Uninstalling the Agent

```bash
cd /opt/oneuptime-storage-array-agent
docker compose down
```

Then delete the read-only user and its API token on the array if you no longer need them.

## Self-hosted OneUptime

If you are self-hosting OneUptime, set `ONEUPTIME_URL` to your own instance:

```bash
ONEUPTIME_URL=https://your-oneuptime-host.example.com
```

If your instance is HTTP-only, use `http://` and the appropriate port.

## Troubleshooting

### Run the diagnostic script first

The agent ships with a doctor script, [`troubleshoot.sh`](https://github.com/OneUptime/oneuptime/blob/master/agents/StorageArrayAgent/troubleshoot.sh), that checks the whole chain: container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter — DNS, TLS, whether a FlashArray has the native endpoint at all, and whether the array accepts the API token, which it hands to curl on stdin), array-name stamping, ingestion-token shape, collector self-metrics, and a **definitive server-side token validation**. The token check is the important one — OneUptime's OTLP endpoints refuse a bad ingestion token with `401` (`422` for a disabled key or a browser key), and the collector treats both as permanent: it drops the batch and logs one `Exporting failed` error for it, which is easy to miss while the container itself stays healthy. The script calls `GET <url>/otlp/v1/validate` from inside the agent's network namespace to get a direct `200` (valid) / `401` (invalid) verdict, falling back to `POST /fluentd/v1/logs` on older servers.

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-storage-array-agent
```

It ends with a VERDICT section naming the most likely root cause. The sections below cover the same ground manually.

### No array appears in OneUptime

1. Check the collector logs: `docker logs oneuptime-storage-array-agent` — `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` / `connection refused` means a wrong `PURE_FA_ENDPOINT` or `PURE_FB_ENDPOINT`, and a `401` on export means a bad ingestion token.
2. Ask the array from the agent's network. The collector image is distroless (no shell, no curl), so test from a sibling container in its network namespace: `docker run --rm --network container:oneuptime-storage-array-agent curlimages/curl -sk -H 'Authorization: Bearer <api-token>' 'https://<array>/metrics/array?namespace=purefa'` should print `purefa_*` lines.
3. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.

### The FlashArray answers 404

Its Purity//FA has no native OpenMetrics endpoint. Re-run `install.sh` and choose the older-Purity option, or set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d`. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.

### The array refuses the API token

Check that you pasted the API token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` and run `docker compose up -d`. Through Pure's exporters a refused token shows up in the collector log as an HTTP `400` from the exporter, whose body reads `failed to login`.

### `x509` / TLS errors

Arrays present a self-signed certificate by default, which no Docker image trusts. Either set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network) or install a certificate on the array from a CA the collector image trusts.

### `pure-fa-exporter` or `pure-fb-exporter` does not resolve

The exporter service is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.

### Deleted volumes or hosts stay in the inventory

OneUptime removes an object when a complete scrape of its endpoint no longer contains it, which it recognises by the `scrape_endpoint` label. If you replaced the shipped collector config with your own, keep the `scrape_endpoint` labels on its scrape jobs; otherwise objects leave the inventory only when they go stale.

### Metrics land under the wrong array

OneUptime auto-registers storage arrays by `storage.array.name`, taken from the `STORAGE_ARRAY_NAME` environment variable. Changing it after the first telemetry batch creates a second array rather than renaming the existing one.

### Sending metrics without the agent

The agent is one stock collector config, so a collector fleet you already run can do the same job: copy the scrape jobs and the `resource` processor from the shipped config into your own. The `storage.array.name` resource attribute is what registers the array in OneUptime, and the `service.name` / `service.instance.id` deletes keep the data from being routed to a phantom Service — keep both, and keep the `scrape_endpoint` labels.

## Next steps

- Configure **Storage Array Monitors** to alert on open array alerts, capacity, latency, failed or degraded hardware, failed drives, hosts that lost their redundant paths, replication lag and full file systems — see [Storage Array Monitor](/docs/monitor/storage-array-monitor).
- Running VMware on the array? Pair this agent with the [OneUptime VMware Agent](/docs/telemetry/vmware) for the datastore and VM view of the same storage.
- For the OS-level view of the machines that use the array, use the [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
