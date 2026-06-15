# Podman Monitor

Podman monitoring allows you to monitor the health and performance of your Podman hosts and the containers running on them. OneUptime collects metrics and container logs via a pre-configured OpenTelemetry Collector (the **OneUptime Podman Agent**) and evaluates them against your configured criteria.

## Overview

Podman monitors use metrics and logs from your hosts to provide visibility into your container workloads. This enables you to:

- Monitor Podman host and per-container health
- Track CPU, memory, network, block I/O, and process counts across containers
- Detect container restarts, crashes, and CPU throttling
- Stream structured container logs in the native OpenTelemetry format
- Alert on high CPU, high memory, restart loops, and more

## Creating a Podman Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Podman** as the monitor type
4. Select the Podman host and resource scope to monitor
5. Configure metric queries and aggregation
6. Configure monitoring criteria as needed

## Configuration Options

### Podman Host

Select the Podman host to monitor. Hosts are auto-registered the first time the OneUptime Podman Agent ships telemetry from them — you do not need to create them manually.

### Resource Scope

Choose the level at which to monitor resources:

| Scope | Description |
|-------|-------------|
| Host | Monitor the entire Podman host, aggregated across all containers |
| Container | Monitor a specific container by name or image |

### Metric Queries

Configure one or more metric queries to evaluate. Each query specifies:

- **Metric name** — The container metric to query
- **Aggregation** — How to aggregate metric values (Avg, Sum, Max, Min)
- **Filters** — Additional attribute-based filtering (e.g. by container name, image, or host)
- **Group By** — Optionally group by `resource.container.name` so each container is evaluated independently

You can also create **formulas** that combine multiple metric queries using mathematical expressions.

### Rolling Time Window

Select the time window for metric evaluation:

- Past 1 Minute
- Past 5 Minutes
- Past 10 Minutes
- Past 15 Minutes
- Past 30 Minutes
- Past 60 Minutes

## Collected Metrics

The Podman Agent uses the OpenTelemetry `docker_stats` receiver pointed at Podman's Docker-compatible socket (`/run/podman/podman.sock`), which scrapes the Podman API at a configurable interval (default every 30 seconds).

### CPU

| Metric | Description |
|--------|-------------|
| `container.cpu.utilization` | CPU utilization as a percentage of the host CPU |
| `container.cpu.usage.total` | Cumulative CPU time consumed by the container |
| `container.cpu.throttling_data.throttled_time` | Time the container was throttled by cgroups |
| `container.cpu.throttling_data.throttled_periods` | Number of throttling periods |

### Memory

| Metric | Description |
|--------|-------------|
| `container.memory.usage.total` | Current memory usage in bytes |
| `container.memory.usage.limit` | Memory limit in bytes |
| `container.memory.percent` | Memory usage as a percentage of the limit |

### Network

| Metric | Description |
|--------|-------------|
| `container.network.io.usage.rx_bytes` | Total bytes received |
| `container.network.io.usage.tx_bytes` | Total bytes transmitted |

### Block I/O

| Metric | Description |
|--------|-------------|
| `container.blockio.io_service_bytes_recursive.read` | Bytes read from block devices |
| `container.blockio.io_service_bytes_recursive.write` | Bytes written to block devices |

### Container Info

| Metric | Description |
|--------|-------------|
| `container.uptime` | Container uptime in seconds |
| `container.restarts` | Number of times the container has restarted |
| `container.pids.count` | Number of processes inside the container |

## Monitoring Criteria

### Available Check Types

| Check Type | Description |
|------------|-------------|
| Metric Value | The value of the configured metric query or formula |

### Aggregation Types

| Aggregation | Description |
|-------------|-------------|
| Average | Average value over the time window |
| Sum | Sum of all values |
| Maximum Value | Highest value in the time window |
| Minimum Value | Lowest value in the time window |
| All Values | All values must match the criteria |
| Any Value | At least one value must match |

### Filter Types

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Pre-built Alert Templates

OneUptime provides templates for common Podman monitoring scenarios:

| Template | Description | Threshold | Aggregation |
|----------|-------------|-----------|-------------|
| High Container CPU | CPU utilization per container | > 80% | Max (per container) |
| High Container Memory | Memory usage as percent of limit | > 85% | Max (per container) |
| High CPU Throttling | CPU throttled time | > 0 | Max (per container) |
| Container Restart Loop | Container restart count | > 5 | Max |
| High Process Count | Process count per container | > 500 | Max |
| Container Down | Container uptime reset to 0 | = 0 | Min |

> Note: CPU, memory, and throttling templates use **Max** aggregation grouped by `resource.container.name`. This prevents a single hot container's signal from being diluted by many idle containers on the same host.

## Collected Logs

In addition to metrics, the Podman Agent tails every container's log file via the OpenTelemetry filelog receiver and ships log records in the native OTLP log format. Each log record is enriched with:

- `resource.host.name` — the Podman host identifier
- `resource.container.id` — the full container ID
- `resource.container.runtime` — always `podman`
- `attributes["log.iostream"]` — `stdout` or `stderr`
- `severityText` / `severityNumber` — derived from the stream: `stderr` → `ERROR`, `stdout` → `INFO`
- `body` — the raw log line emitted by the container process
- `time` — the container engine's timestamp for the line

Logs appear on the Podman host's **Logs** tab and on each container's detail page.

### Log Driver Requirement

**Podman defaults to the `journald` log driver, which writes to the systemd journal rather than to a file the agent can tail.** The Podman Agent's filelog receiver tails the **`k8s-file`** path `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`. To ship container logs to OneUptime, run your containers with the `k8s-file` (or `json-file`) log driver:

- **`journald`** (Podman default) — sends logs to the systemd journal; no file to tail. The **Logs** tab will be empty.
- **`k8s-file`** — writes a per-container `ctr.log` file the filelog receiver can parse. **Recommended.**
- **`none`** — discards logs entirely.

**Run a single container with the `k8s-file` driver:**

```bash
podman run --log-driver k8s-file ... <image>
```

**Switch the default for new containers** by editing `/etc/containers/containers.conf`:

```toml
[containers]
log_driver = "k8s-file"
```

Then **recreate** the affected containers. Podman binds the log driver at container create time, so an existing container keeps its old driver until it is removed and recreated.

## Setup Requirements

To use Podman monitoring, you need to:

1. Install the OneUptime Podman Agent on each Podman host you want to monitor
2. Pass `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN`, and `PODMAN_HOST_NAME` as environment variables
3. Ensure the containers you want to observe use the `k8s-file` log driver (see above)

The agent is published as `oneuptime/podman-agent:release` on Docker Hub. See the [Podman Host installation guide](https://github.com/OneUptime/oneuptime/tree/master/PodmanAgent) for the full `podman run` and Compose examples.

## Troubleshooting

### Metrics show up but the Logs tab is empty

Your containers are almost certainly using Podman's default `journald` log driver. Switch any containers that need their logs shipped to the `k8s-file` driver (see the [Log Driver Requirement](#log-driver-requirement) section above) and recreate them.

### Filelog receiver logs `no files match the configured criteria`

This means the include glob `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` did not match any files when the agent started. Either:

1. No container on this host is using `k8s-file`, or
2. The bind mount exposing `/var/lib/containers/storage` is missing or pointing at an empty directory, or
3. The agent is running rootless and cannot read the rootful container storage path (or vice versa).

### Logs arrive but are grouped under the wrong host name

OneUptime auto-registers Podman hosts by `resource.host.name`, which is taken from the `PODMAN_HOST_NAME` environment variable. Changing `PODMAN_HOST_NAME` after the first telemetry batch will create a second host row rather than rename the existing one.

### Incidents are not firing for "High CPU"

Make sure the metric query's aggregation is **Max** (not Avg) and that it groups by `resource.container.name`. An Avg across all containers on a busy host is diluted by idle containers and rarely crosses the threshold.
