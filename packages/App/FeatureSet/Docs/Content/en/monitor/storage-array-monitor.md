# Storage Array Monitor

Storage array monitoring allows you to monitor the health and performance of your storage arrays — the array's own alerts, capacity, latency, hardware, volumes, hosts, replication, file systems and buckets — starting with Pure Storage FlashArray and Pure Storage FlashBlade. OneUptime collects metrics via a pre-configured OpenTelemetry Collector (the **OneUptime Storage Array Agent**) and evaluates them against your configured criteria.

## Overview

Storage array monitors use the metrics the array itself exports — Pure's `purefa_*` and `purefb_*` series — to provide visibility into your storage. This enables you to:

- Alert the moment the array raises a critical or warning alert of its own
- Catch capacity running out before writes fail
- Track read and write latency, IOPS and bandwidth for the whole array, each volume and each host
- Detect failed or degraded hardware components and failed drives
- Find hosts that lost their redundant paths to the array
- Watch ActiveCluster / ActiveDR replication lag, and FlashBlade file systems approaching their quota

## Creating a Storage Array Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Storage Array** as the monitor type
4. Select the storage array to monitor
5. Pick a template under **Quick Setup**, a single metric under **Custom Metric**, or build queries and formulas under **Advanced**
6. Configure monitoring criteria as needed

## Configuration Options

### Storage Array

Select the storage array to monitor. Arrays are auto-registered the first time the OneUptime Storage Array Agent ships telemetry from them (keyed by the `storage.array.name` resource attribute) — you do not need to create them manually. Every query the monitor runs is automatically scoped with `resource.storage.array.name` equal to the selected array's name, so two arrays that both have a volume called `vol-01` never bleed into each other's monitors. The array's platform (`storage.system`: `purestorage.flasharray` or `purestorage.flashblade`) decides which metrics and templates the form offers.

### Resource Filters

Optionally narrow the monitor to one object of the array. Each filter is an equality on the datapoint label the platform names that object with:

| Filter             | Platform   | Datapoint label                                                  | Notes                                                                                                   |
| ------------------ | ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Volume             | FlashArray | `name`                                                           | One volume, e.g. `vol-db-01`                                                                            |
| Host               | FlashArray | `host`                                                           | One host as the array knows it, e.g. `esxi-01`                                                          |
| Pod                | FlashArray | `name` (`local_pod` on replica link series)                      | One ActiveCluster / ActiveDR pod                                                                        |
| Hardware Component | Both       | `component_name` on a FlashArray, `name` on a FlashBlade         | One hardware component, e.g. `CH0.BAY1` or `CT0`                                                        |
| File System        | FlashBlade | `name`                                                           | One file system                                                                                         |
| Bucket             | FlashBlade | `name`                                                           | One object store bucket                                                                                 |

### Metric Queries

Configure one or more metric queries to evaluate. Each query specifies:

- **Metric name** — The storage array metric to query (`purefa_*` or `purefb_*` series, see the catalog below)
- **Aggregation** — How to aggregate metric values (Avg, Sum, Max, Min)
- **Filters** — Attribute-based filtering on the datapoint labels: `dimension` (which figure a performance series carries), `space` (which capacity figure), `severity` on open alerts, `component_status` on hardware, `status` on host connectivity, `protocol` on FlashBlade performance, `type` on FlashBlade space
- **Group By** — Optionally group by the object label (`name`, `host`, `component_name`, `local_pod`, `summary`) so each volume, host, component, pod or alert is evaluated independently — one incident per object

You can also create **formulas** that combine multiple metric queries using mathematical expressions — for example used capacity from `purefa_array_space_bytes` filtered to `space=capacity` minus the same metric filtered to `space=empty`.

### How Pure's Series Are Shaped

Pure's performance families put several figures on **one** metric name, told apart only by the `dimension` label: `purefa_array_performance_latency_usec` carries the read latency (`usec_per_read_op`), the write latency (`usec_per_write_op`), the mirrored write latency, and the SAN, queue, QoS and service-time components of each. Always filter on one `dimension` — averaging across them mixes a 200 µs read latency with a queue figure. Space families work the same way with the `space` label (`capacity`, `empty`, `snapshots`, `total_provisioned`, `total_physical`, `available_ratio`, ...).

Several series carry their state in a **label** with a value that is always 1: `purefa_alerts_open` (one series per open alert, labeled `severity`, `summary`, `code`, `component_type`), `purefa_hw_component_status` (labeled `component_status`), `purefa_host_connectivity_info` (labeled `status` and `details`), and `purefa_drive_capacity_bytes` (labeled `component_status`, value the drive's capacity). A series filtered to a bad state exists only while an object is in that state — absence means healthy. That makes "Max > 0 fires, = 0 recovers" the right shape for alerting on them, and it is how the templates below are built (their recover criteria treat series absence as zero).

In ClickHouse — and therefore in monitor filters and group-by keys — the agent's attributes are `resource.`-prefixed (`resource.storage.array.name`, `resource.storage.system`), while Pure's datapoint labels are bare (`name`, `host`, `component_name`, `dimension`, `space`, `severity`).

### Rolling Time Window

Select the time window for metric evaluation:

- Past 1 Minute
- Past 5 Minutes
- Past 10 Minutes
- Past 15 Minutes
- Past 30 Minutes
- Past 60 Minutes

The agent reads the array endpoint every 60 seconds and volumes, hosts and pods every 2 minutes, so the form proposes 5 minutes for a custom metric; a FlashBlade's file systems and buckets are read every 5 minutes, so it proposes 15 for those. FlashArray directories are read every 30 minutes — give a directory monitor a 60-minute window.

## Collected Metrics

The Storage Array Agent ships everything the array exports; the series below are the catalog the monitor form offers. Every value is a gauge the array computes itself — latencies are microseconds per operation, throughput is per second — so no rate math is needed. **Filter** is the datapoint label filter that makes the series mean what its row says; the form applies it for you.

### Array Health

| Metric               | Filter | Platform   | Unit    | Description                                                                                                                                                       |
| -------------------- | ------ | ---------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `purefa_alerts_open` | —      | FlashArray | `count` | One series per alert open on the array (value 1), labeled `severity` (`critical`, `warning`, `info`, `hidden`), `category`, `code`, `component_type` and `summary` |
| `purefb_alerts_open` | —      | FlashBlade | `count` | One series per alert open on the FlashBlade (value 1), labeled `severity` (`info`, `warning`, `critical`), `code`, `component_name`, `component_type`, `summary` and `kburl` (Pure's knowledge base article) |

### Capacity

| Metric                                    | Filter                       | Platform   | Unit    | Description                                                                                                                           |
| ----------------------------------------- | ---------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `purefa_array_space_utilization`          | —                            | FlashArray | `%`     | Share of the array's usable capacity in use. Pure raises its own capacity alerts at 80%, 90% and 100%                                 |
| `purefa_array_space_bytes`                | `space=capacity`             | FlashArray | `bytes` | Usable capacity of the array                                                                                                          |
| `purefa_array_space_bytes`                | `space=empty`                | FlashArray | `bytes` | Unused capacity — trend it to forecast when the array fills up                                                                        |
| `purefa_array_space_bytes`                | `space=snapshots`            | FlashArray | `bytes` | Physical space held only by snapshots; a fast climb usually means a protection group keeps more snapshots than planned                 |
| `purefa_array_space_data_reduction_ratio` | —                            | FlashArray | `ratio` | Deduplication and compression across the array, e.g. 4.2 for 4.2:1. A sustained drop means new data reduces poorly                    |
| `purefb_array_space_utilization`          | `type=array`                 | FlashBlade | `%`     | Share of the FlashBlade's usable capacity in use                                                                                      |
| `purefb_array_space_bytes`                | `type=array`, `space=empty`  | FlashBlade | `bytes` | Unused capacity of the FlashBlade                                                                                                     |
| `purefb_array_space_data_reduction_ratio` | `type=array`                 | FlashBlade | `ratio` | Data reduction across the FlashBlade                                                                                                  |

### Performance

| Metric                                     | Filter                                         | Platform   | Unit      | Description                                                                                                  |
| ------------------------------------------ | ---------------------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `purefa_array_performance_latency_usec`    | `dimension=usec_per_read_op`                   | FlashArray | `µs`      | Average latency of a read as hosts see it; FlashArray reads typically complete well under 1 ms              |
| `purefa_array_performance_latency_usec`    | `dimension=usec_per_write_op`                  | FlashArray | `µs`      | Average latency of a write as hosts see it                                                                   |
| `purefa_array_performance_latency_usec`    | `dimension=usec_per_mirrored_write_op`         | FlashArray | `µs`      | Average latency of a write to an ActiveCluster stretched pod, including the round trip to the peer array    |
| `purefa_array_performance_latency_usec`    | `dimension=san_usec_per_read_op`               | FlashArray | `µs`      | Time a read spends in the SAN; high SAN latency with low service latency points at the fabric or the host   |
| `purefa_array_performance_throughput_iops` | `dimension=reads_per_sec`                      | FlashArray | `ops/s`   | Read operations per second                                                                                   |
| `purefa_array_performance_throughput_iops` | `dimension=writes_per_sec`                     | FlashArray | `ops/s`   | Write operations per second                                                                                  |
| `purefa_array_performance_bandwidth_bytes` | `dimension=read_bytes_per_sec`                 | FlashArray | `bytes/s` | Bytes read per second                                                                                        |
| `purefa_array_performance_bandwidth_bytes` | `dimension=write_bytes_per_sec`                | FlashArray | `bytes/s` | Bytes written per second                                                                                     |
| `purefa_array_performance_queue_depth_ops` | —                                              | FlashArray | `ops`     | Operations queued on the array; a growing queue with rising latency means hosts send more than it can serve |
| `purefa_array_performance_average_bytes`   | `dimension=bytes_per_op`                       | FlashArray | `bytes`   | Average size of an operation — large I/O raises latency without anything being wrong                        |
| `purefb_array_performance_latency_usec`    | `dimension=usec_per_read_op`, `protocol=all`   | FlashBlade | `µs`      | Average read latency across all protocols                                                                    |
| `purefb_array_performance_latency_usec`    | `dimension=usec_per_write_op`, `protocol=all`  | FlashBlade | `µs`      | Average write latency across all protocols                                                                   |
| `purefb_array_performance_throughput_iops` | `dimension=reads_per_sec`, `protocol=all`      | FlashBlade | `ops/s`   | Read operations per second across all protocols                                                              |
| `purefb_array_performance_throughput_iops` | `dimension=writes_per_sec`, `protocol=all`     | FlashBlade | `ops/s`   | Write operations per second across all protocols                                                             |
| `purefb_array_performance_bandwidth_bytes` | `dimension=read_bytes_per_sec`, `protocol=all` | FlashBlade | `bytes/s` | Bytes read per second across all protocols                                                                   |
| `purefb_array_performance_bandwidth_bytes` | `dimension=write_bytes_per_sec`, `protocol=all` | FlashBlade | `bytes/s` | Bytes written per second across all protocols                                                               |

### Volumes

| Metric                                      | Filter                           | Platform   | Unit      | Description                                                   |
| ------------------------------------------- | -------------------------------- | ---------- | --------- | ------------------------------------------------------------- |
| `purefa_volume_performance_latency_usec`    | `dimension=usec_per_read_op`     | FlashArray | `µs`      | Average read latency of each volume — group by `name`         |
| `purefa_volume_performance_latency_usec`    | `dimension=usec_per_write_op`    | FlashArray | `µs`      | Average write latency of each volume                          |
| `purefa_volume_performance_throughput_iops` | `dimension=reads_per_sec`        | FlashArray | `ops/s`   | Read operations per second of each volume                     |
| `purefa_volume_performance_throughput_iops` | `dimension=writes_per_sec`       | FlashArray | `ops/s`   | Write operations per second of each volume                    |
| `purefa_volume_performance_bandwidth_bytes` | `dimension=read_bytes_per_sec`   | FlashArray | `bytes/s` | Bytes read per second from each volume                        |
| `purefa_volume_performance_bandwidth_bytes` | `dimension=write_bytes_per_sec`  | FlashArray | `bytes/s` | Bytes written per second to each volume                       |
| `purefa_volume_space_bytes`                 | `space=total_provisioned`        | FlashArray | `bytes`   | Size of each volume as hosts see it                           |
| `purefa_volume_space_bytes`                 | `space=total_physical`           | FlashArray | `bytes`   | Physical space each volume uses after data reduction          |
| `purefa_volume_space_data_reduction_ratio`  | —                                | FlashArray | `ratio`   | Data reduction ratio of each volume                           |

### Hosts

| Metric                                    | Filter                        | Platform   | Unit    | Description                                                                                                                                    |
| ----------------------------------------- | ----------------------------- | ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `purefa_host_connectivity_info`           | —                             | FlashArray | `count` | One series per host (value 1) labeled with its connectivity `status` (`healthy`, `critical`, `unused`) and `details` (`Redundant`, `Single Controller`, `None`, ...) |
| `purefa_host_performance_latency_usec`    | `dimension=usec_per_read_op`  | FlashArray | `µs`    | Average read latency each host sees — group by `host`                                                                                          |
| `purefa_host_performance_latency_usec`    | `dimension=usec_per_write_op` | FlashArray | `µs`    | Average write latency each host sees                                                                                                           |
| `purefa_host_performance_throughput_iops` | `dimension=reads_per_sec`     | FlashArray | `ops/s` | Read operations per second of each host                                                                                                        |
| `purefa_host_performance_throughput_iops` | `dimension=writes_per_sec`    | FlashArray | `ops/s` | Write operations per second of each host                                                                                                       |

### Replication

| Metric                                               | Filter                                 | Platform   | Unit      | Description                                                                                                                                                  |
| ---------------------------------------------------- | -------------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `purefa_pod_replica_links_lag_max_msec`              | —                                      | FlashArray | `ms`      | Largest replication lag of each pod replica link (ActiveDR / async), labeled `local_pod`, `remote_pod`, `remote`, `direction` and `status` — group by `local_pod` |
| `purefa_pod_replica_links_lag_average_msec`          | —                                      | FlashArray | `ms`      | Average replication lag of each pod replica link                                                                                                             |
| `purefa_pod_performance_replication_bandwidth_bytes` | —                                      | FlashArray | `bytes/s` | Replication traffic of each pod, labeled `direction` and `dimension`                                                                                         |
| `purefa_pod_performance_latency_usec`                | `dimension=usec_per_mirrored_write_op` | FlashArray | `µs`      | Average mirrored write latency of each ActiveCluster pod                                                                                                     |

### Hardware

| Metric                                        | Filter                           | Platform   | Unit       | Description                                                                                                                                                                                                  |
| --------------------------------------------- | -------------------------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `purefa_hw_component_status`                  | —                                | FlashArray | `count`    | One series per hardware component (value 1) — chassis, controllers, drive and NVRAM bays, power supplies, fans, temperature sensors, Ethernet and Fibre Channel ports — labeled `component_status` (`ok`, `critical`, `degraded`, `device_off`, `identifying`, `not_installed`, `unknown`) |
| `purefa_hw_component_temperature_celsius`     | —                                | FlashArray | `°C`       | Temperature of each sensor — group by `component_name`                                                                                                                                                       |
| `purefa_drive_capacity_bytes`                 | —                                | FlashArray | `bytes`    | Raw capacity of each drive, labeled with its `component_status` (`healthy`, `failed`, `missing`, `recovering`, `unhealthy`, `empty`, ...) and type                                                            |
| `purefa_network_interface_performance_errors` | `dimension=total_errors_per_sec` | FlashArray | `errors/s` | Errors per second on each Ethernet and Fibre Channel interface — sustained errors usually mean a bad cable, optic or switch port                                                                              |
| `purefb_hardware_health`                      | —                                | FlashBlade | —          | Health of each hardware component (blades, fabric modules, power supplies, fans, ...): 1 = healthy, 2 = unused, 0 = unhealthy. Take the minimum per `name`                                                    |

### File Systems

| Metric                                         | Filter                        | Platform   | Unit    | Description                                                                                  |
| ---------------------------------------------- | ----------------------------- | ---------- | ------- | -------------------------------------------------------------------------------------------- |
| `purefb_file_systems_performance_latency_usec` | `dimension=usec_per_read_op`  | FlashBlade | `µs`    | Average read latency of each file system — group by `name`                                   |
| `purefb_file_systems_performance_latency_usec` | `dimension=usec_per_write_op` | FlashBlade | `µs`    | Average write latency of each file system                                                    |
| `purefb_file_systems_space_bytes`              | `space=total_physical`        | FlashBlade | `bytes` | Physical space each file system uses                                                         |
| `purefb_file_systems_space_bytes`              | `space=available_ratio`       | FlashBlade | `ratio` | Share of each file system's provisioned size still available, 0 to 1 — near 0 it is about to fill its quota |

### Buckets

| Metric                                    | Filter                       | Platform   | Unit    | Description                                           |
| ----------------------------------------- | ---------------------------- | ---------- | ------- | ----------------------------------------------------- |
| `purefb_buckets_performance_latency_usec` | `dimension=usec_per_read_op` | FlashBlade | `µs`    | Average read latency of each bucket — group by `name` |
| `purefb_buckets_space_bytes`              | `space=total_physical`       | FlashBlade | `bytes` | Physical space each bucket uses                       |
| `purefb_buckets_object_count`             | —                            | FlashBlade | `count` | Number of objects in each bucket                      |

## Monitoring Criteria

### What Gets Evaluated

These monitors always evaluate the **Metric Value** — the value of the configured metric query or formula. The criteria form has no Filter Type selector; it shows **Metric**, **Aggregation**, **Condition**, and **Threshold**.

### Aggregation Types

| Aggregation   | Description                        |
| ------------- | ---------------------------------- |
| Average       | Average value over the time window |
| Sum           | Sum of all values                  |
| Maximum Value | Highest value in the time window   |
| Minimum Value | Lowest value in the time window    |
| All Values    | All values must match the criteria |
| Any Value     | At least one value must match      |

### Conditions

Static thresholds — compared against the **Threshold** you enter:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**

Baseline anomaly detection — no threshold; the form shows **Sensitivity** and **Baseline Window** instead, and compares each sample to the same-hour-of-week baseline built from that window:

- **Anomalously High** — Value rises above the expected range
- **Anomalously Low** — Value falls below the expected range
- **Anomalous** — Value leaves the expected range in either direction

Anomaly conditions stay in a "Learning" state and produce no alerts until at least the chosen Baseline Window of metric history exists.

### Criteria Examples

- **A volume is slow** — `purefa_volume_performance_latency_usec` filtered to `dimension=usec_per_read_op`, Average, grouped by `name`, **Greater Than** `2000` over the past 10 minutes.
- **The array is filling up** — `purefa_array_space_utilization`, Maximum, **Greater Than** `85` over the past 15 minutes.
- **A host runs on one controller** — `purefa_host_connectivity_info` filtered to `status=critical`, Maximum, grouped by `host`, **Greater Than** `0`.
- **A FlashBlade file system is almost full** — `purefb_file_systems_space_bytes` filtered to `space=available_ratio`, Minimum, grouped by `name`, **Less Than** `0.05`.

## Pre-built Alert Templates

OneUptime ships 18 templates — 11 for FlashArray and 7 for FlashBlade — and the form offers the ones for the selected array's platform. Each builds a complete monitor — a metric query, label filters, a group-by on the object's own label, a fire criteria, and an auto-recover criteria — that you can edit after applying. Thresholds are starting points. A criteria must hold for **every** value in its window before it fires, and a monitor that fired on a capacity, latency, lag or ratio threshold recovers only 10% past it, so a value hovering at the threshold does not flap; the alert and hardware templates recover as soon as the state clears:

### FlashArray

| Template                       | Category     | Severity | Watches                                                                                         | Fires when                                                                                                                                       |
| ------------------------------ | ------------ | -------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Critical Array Alert           | Array Health | Critical | `purefa_alerts_open` filtered to `severity=critical`, Max per `summary`, past 5 minutes        | > 0 — the array has an open critical alert (a failed component, a capacity emergency, a replication failure). One incident per alert; recovers when the alert closes |
| Warning Array Alert            | Array Health | Warning  | `purefa_alerts_open` filtered to `severity=warning`, Max per `summary`, past 5 minutes         | > 0 — the array has an open warning alert. One incident per alert; recovers when the alert closes                                               |
| Capacity Above 80%             | Capacity     | Warning  | `purefa_array_space_utilization`, Max, past 15 minutes                                          | > 80 — Pure's own first capacity threshold; recovers at ≤ 72                                                                                     |
| Capacity Above 90%             | Capacity     | Critical | `purefa_array_space_utilization`, Max, past 5 minutes                                           | > 90 — the array is close to refusing writes; recovers at ≤ 81                                                                                   |
| High Read Latency              | Performance  | Warning  | `purefa_array_performance_latency_usec` filtered to `dimension=usec_per_read_op`, Avg, past 10 minutes  | > 5000 µs (5 ms) — FlashArray reads normally complete well under 1 ms; recovers at ≤ 4500                                                        |
| High Write Latency             | Performance  | Warning  | `purefa_array_performance_latency_usec` filtered to `dimension=usec_per_write_op`, Avg, past 10 minutes | > 5000 µs (5 ms); recovers at ≤ 4500                                                                                                             |
| Hardware Component Failed      | Hardware     | Critical | `purefa_hw_component_status` filtered to `component_status=critical`, Max per `component_name`, past 5 minutes | > 0 — a controller, power supply, fan, bay or port is critical and redundancy is gone. One incident per component; recovers when it reports ok |
| Hardware Component Degraded    | Hardware     | Warning  | `purefa_hw_component_status` filtered to `component_status=degraded`, Max per `component_name`, past 5 minutes | > 0 — a component is degraded. One incident per component; recovers when it reports ok                                                     |
| Drive Failed                   | Hardware     | Critical | `purefa_drive_capacity_bytes` filtered to `component_status=failed`, Max per `component_name`, past 5 minutes | > 0 — a DirectFlash module or SSD failed and the array rebuilds onto the others. One incident per drive; recovers when it is replaced          |
| Host Lost Redundant Paths      | Hosts        | Warning  | `purefa_host_connectivity_info` filtered to `status=critical`, Max per `host`, past 5 minutes  | > 0 — the host reaches the array through one controller or none; a controller failover would take its storage offline. One incident per host; recovers when its paths are back |
| Replication Lag Above 1 Minute | Replication  | Warning  | `purefa_pod_replica_links_lag_max_msec`, Max per `local_pod`, past 10 minutes                   | > 60000 ms (60 s) — a failover now would lose more recent writes than planned. One incident per pod; recovers at ≤ 54000                         |

### FlashBlade

| Template                     | Category     | Severity | Watches                                                                                                        | Fires when                                                                                                          |
| ---------------------------- | ------------ | -------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Critical Array Alert         | Array Health | Critical | `purefb_alerts_open` filtered to `severity=critical`, Max per `summary`, past 5 minutes                       | > 0 — the FlashBlade has an open critical alert. One incident per alert; recovers when the alert closes              |
| Warning Array Alert          | Array Health | Warning  | `purefb_alerts_open` filtered to `severity=warning`, Max per `summary`, past 5 minutes                        | > 0 — the FlashBlade has an open warning alert. One incident per alert; recovers when the alert closes              |
| Capacity Above 80%           | Capacity     | Warning  | `purefb_array_space_utilization` filtered to `type=array`, Max, past 15 minutes                               | > 80; recovers at ≤ 72                                                                                              |
| Capacity Above 90%           | Capacity     | Critical | `purefb_array_space_utilization` filtered to `type=array`, Max, past 5 minutes                                | > 90 — writes fail for every client when it fills; recovers at ≤ 81                                                 |
| Hardware Component Unhealthy | Hardware     | Critical | `purefb_hardware_health`, Min per `name`, past 5 minutes                                                       | < 1 — a blade, fabric module, power supply or fan is not healthy (an unused slot reports 2). One incident per component; recovers at ≥ 1 |
| High Read Latency            | Performance  | Warning  | `purefb_array_performance_latency_usec` filtered to `dimension=usec_per_read_op` and `protocol=all`, Avg, past 10 minutes | > 10000 µs (10 ms) across all protocols; recovers at ≤ 9000                                            |
| File System Near Full        | File Systems | Warning  | `purefb_file_systems_space_bytes` filtered to `space=available_ratio`, Min per `name`, past 15 minutes        | < 0.1 — less than 10% of a file system's provisioned size is left. One incident per file system; recovers at ≥ 0.11 |

> Notes on the choices baked in: open-alert and hardware-state templates use **Max** of a series that exists only while the alert is open or the component is in that state, so one scrape showing it trips the threshold, and their recover criteria treat series absence as zero — the monitor returns to healthy when the alert closes or the component recovers. Every per-object template groups by the object's own label (`summary`, `component_name`, `host`, `local_pod`, `name`), so one incident fires per affected object and the alert names it. Latency templates use **Avg** of the array's own per-operation average, and capacity templates **Max** of the array's own utilization percentage. The FlashBlade hardware template uses **Min** per component, because a component's health is 1 when healthy and drops to 0 when not. Latencies are pinned in microseconds, capacity in percent.

Not covered by templates, with reasons: per-volume latency is workload-specific, so there is no one threshold to ship — build it from the catalog with a group-by on `name`; capacity forecasting needs a growth fit rather than a threshold; drive wear and SMART prediction have no OpenMetrics series.

## Setup Requirements

To use storage array monitoring, you need to:

1. Create a user with the readonly role and an API token for it on the array
2. Install the OneUptime Storage Array Agent on a machine that can reach the array's management interface over HTTPS — see the [Storage Array Agent installation guide](/docs/telemetry/storage-arrays)
3. Pass `ONEUPTIME_URL`, `ONEUPTIME_TELEMETRY_INGESTION_KEY`, `STORAGE_ARRAY_NAME`, and the array's address and API token (`PURE_FA_ENDPOINT` / `PURE_FA_API_TOKEN` or `PURE_FB_ENDPOINT` / `PURE_FB_API_TOKEN`) as environment variables
4. Wait for the array to auto-register (about a minute after the first scrape)

## Terraform

The [OneUptime Terraform provider](/docs/terraform/monitor-steps) carries a storage array monitor step's configuration in the `storage_array_monitor` escape-hatch attribute — the raw JSON of the `storageArrayMonitor` sub-config (`arrayIdentifier`, `storageSystem`, `resourceFilters`, `metricViewConfig`, `rollingTime`), written with `jsonencode()`:

```hcl
monitor_steps = [{
  storage_array_monitor = jsonencode({
    arrayIdentifier = "my-storage-array"
    storageSystem   = "purestorage.flasharray"
    resourceFilters = {}
    rollingTime     = "Past 15 Minutes"
    metricViewConfig = {
      queryConfigs = [{
        metricAliasData = { metricVariable = "capacity_used_percent", title = "Capacity Used", description = "", legend = "" }
        metricQueryData = {
          filterData = {
            metricName     = "purefa_array_space_utilization"
            attributes     = {}
            aggegationType = "Max"
            aggregateBy    = {}
          }
        }
      }]
      formulaConfigs = []
    }
  })
  criteria = [ /* ... */ ]
}]
```

`arrayIdentifier` is the array's `storage.array.name` (the `STORAGE_ARRAY_NAME` the agent was started with), not its OneUptime id. `storageSystem` only picks the catalog and templates the form shows; evaluation never depends on it.

## Troubleshooting

### The array does not appear in the monitor's array picker

The array registers itself from the agent's telemetry. Check the agent is running and shipping (see [Verify the Installation](/docs/telemetry/storage-arrays)) and that `STORAGE_ARRAY_NAME` is set.

### An alert or hardware template never fires

That is the healthy case: `purefa_alerts_open`, `purefa_hw_component_status`, `purefa_drive_capacity_bytes` and `purefa_host_connectivity_info` carry the state in a label, and a series filtered to a bad state (`severity=critical`, `component_status=failed`) exists only while something is in that state. No series during a healthy period is expected. To see the series behind a template, run its query on the **Metrics** page without the filter.

### A latency monitor looks wrong

Pure puts read, write, mirrored-write, SAN, queue and QoS figures on one metric name, told apart only by the `dimension` label. A query without a `dimension` filter averages them together. Filter on one dimension — the templates and the form's catalog do. Per-volume and per-host series keep only `usec_per_read_op`, `usec_per_write_op` and `usec_per_mirrored_write_op`: the agent drops the rest of the breakdown to save series, and the array-wide `purefa_array_performance_latency_usec` keeps all of it.

### A 1-minute window shows no data

The agent reads volumes, hosts and pods every 2 minutes, a FlashBlade's file systems and buckets every 5, and FlashArray directories every 30, so a 1-minute rolling window may contain no sample. Use a 5-minute window or longer (15 for file systems and buckets, 60 for directories).

### Incidents fire once for the whole array instead of per volume

Group the query by the object's label — `name` for volumes, pods, directories, file systems and buckets, `host` for hosts, `component_name` for FlashArray hardware. Datapoint labels are bare: `resource.name` matches nothing.
