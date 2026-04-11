# Docker Monitor

Docker monitoring allows you to monitor the health and performance of your Docker hosts and the containers running on them. OneUptime collects metrics and container logs via a pre-configured OpenTelemetry Collector (the **OneUptime Docker Agent**) and evaluates them against your configured criteria.

## Overview

Docker monitors use metrics and logs from your hosts to provide visibility into your container workloads. This enables you to:

- Monitor Docker host and per-container health
- Track CPU, memory, network, block I/O, and process counts across containers
- Detect container restarts, crashes, and CPU throttling
- Stream structured container logs in the native OpenTelemetry format
- Alert on high CPU, high memory, restart loops, and more

## Creating a Docker Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Docker** as the monitor type
4. Select the Docker host and resource scope to monitor
5. Configure metric queries and aggregation
6. Configure monitoring criteria as needed

## Configuration Options

### Docker Host

Select the Docker host to monitor. Hosts are auto-registered the first time the OneUptime Docker Agent ships telemetry from them — you do not need to create them manually.

### Resource Scope

Choose the level at which to monitor resources:

| Scope | Description |
|-------|-------------|
| Host | Monitor the entire Docker host, aggregated across all containers |
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

The Docker Agent uses the OpenTelemetry `docker_stats` receiver, which scrapes the Docker Engine API at a configurable interval (default every 30 seconds).

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

OneUptime provides templates for common Docker monitoring scenarios:

| Template | Description | Threshold | Aggregation |
|----------|-------------|-----------|-------------|
| High Container CPU | CPU utilization per container | > 90% | Max (per container) |
| High Container Memory | Memory usage as percent of limit | > 85% | Max (per container) |
| High CPU Throttling | CPU throttled periods | > 0 | Max (per container) |
| Container Restart Loop | Container restart count | > 3 | Sum |
| Container Down | Container uptime reset to 0 | = 0 | Min |

> Note: CPU, memory, and throttling templates use **Max** aggregation grouped by `resource.container.name`. This prevents a single hot container's signal from being diluted by many idle containers on the same host.

## Collected Logs

In addition to metrics, the Docker Agent tails every container's `*-json.log` file via the OpenTelemetry filelog receiver and ships log records in the native OTLP log format. Each log record is enriched with:

- `resource.host.name` — the Docker host identifier
- `resource.container.id` — the full container ID
- `resource.container.runtime` — always `docker`
- `attributes["log.iostream"]` — `stdout` or `stderr`
- `severityText` / `severityNumber` — derived from the stream: `stderr` → `ERROR`, `stdout` → `INFO`
- `body` — the raw log line emitted by the container process
- `time` — the Docker daemon's timestamp for the line

Logs appear on the Docker host's **Logs** tab and on each container's detail page.

### Log Driver Requirement

**The Docker Agent only ingests logs from containers that use Docker's `json-file` log driver.** This is Docker's default, but it can be overridden per-container or globally:

- **`local`** driver — writes binary protobuf chunks to `/var/lib/docker/containers/<id>/local-logs/container.log`. The filelog receiver cannot parse this format.
- **`journald`**, **`syslog`**, **`fluentd`**, **`gelf`**, **`awslogs`**, **`splunk`**, etc. — send logs to a remote destination; no file to tail.
- **`none`** — discards logs entirely.

If any of the above are in use, you will see metrics on the Docker host page but the **Logs** tab will be empty (or only contain the Docker Agent's own logs).

**Check a specific container's log driver:**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**Check the daemon default:**

```bash
docker info --format '{{.LoggingDriver}}'
```

**Switch a Docker Compose service to `json-file` with sensible rotation:**

```yaml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
```

**Switch the daemon default** (applies to every container created afterwards) by editing `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Then restart the Docker daemon and **recreate** the affected containers. Docker binds the log driver at container create time, so an existing container keeps its old driver until it is removed and recreated:

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# Plain docker
docker rm -f <container>
docker run ... <image>
```

## Setup Requirements

To use Docker monitoring, you need to:

1. Install the OneUptime Docker Agent on each Docker host you want to monitor
2. Pass `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN`, and `DOCKER_HOST_NAME` as environment variables
3. Ensure the containers you want to observe use the `json-file` log driver (see above)

The agent is published as `oneuptime/docker-agent:release` on Docker Hub. See the [Docker Agent installation guide](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent) for the full `docker run` and `docker compose` examples.

## Troubleshooting

### Metrics show up but the Logs tab is empty

Your containers are almost certainly not using the `json-file` log driver. Run the diagnostic commands in the [Log Driver Requirement](#log-driver-requirement) section above and switch any containers that need their logs shipped.

### Filelog receiver logs `no files match the configured criteria`

This means the include glob `/var/lib/docker/containers/*/*-json.log` did not match any files when the agent started. Either:

1. No container on this host is using `json-file`, or
2. The bind mount `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` is missing or pointing at an empty directory, or
3. The agent is running on Docker Desktop for macOS without the Linux VM's container directory exposed.

### Logs arrive but are grouped under the wrong host name

OneUptime auto-registers Docker hosts by `resource.host.name`, which is taken from the `DOCKER_HOST_NAME` environment variable. Changing `DOCKER_HOST_NAME` after the first telemetry batch will create a second host row rather than rename the existing one.

### Incidents are not firing for "High CPU"

Make sure the metric query's aggregation is **Max** (not Avg) and that it groups by `resource.container.name`. An Avg across all containers on a busy host is diluted by idle containers and rarely crosses the threshold.
