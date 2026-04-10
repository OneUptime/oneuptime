# OneUptime Docker Agent

Monitor Docker hosts, containers, and container logs with OneUptime using a pre-configured OpenTelemetry Collector.

The agent is published as a Docker image — `oneuptime/docker-agent` — that bundles a tuned collector config. Just pass a few environment variables and run it.

## Prerequisites

- Docker Engine 20.10+
- Access to `/var/run/docker.sock`
- Containers you want to collect logs from must use the **`json-file`** log driver (this is Docker's default). The agent tails `/var/lib/docker/containers/*/*-json.log` via the OpenTelemetry filelog receiver, which cannot parse Docker's `local` driver (binary protobuf) or any other driver. See [Log Driver Requirement](#log-driver-requirement) below.

## Quick Start — `docker run`

```bash
docker run -d \
  --name oneuptime-docker-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
  -e ONEUPTIME_URL="https://oneuptime.com" \
  -e ONEUPTIME_SERVICE_TOKEN="your-service-token" \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/docker-agent:release
```

That's it. The host will appear automatically in the Docker section of OneUptime.

## Quick Start — Docker Compose

Create a `.env` file:

```bash
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_SERVICE_TOKEN=your-service-token
DOCKER_HOST_NAME=my-docker-host
```

Then start the agent:

```bash
docker compose up -d
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL |
| `ONEUPTIME_SERVICE_TOKEN` | Yes | Telemetry ingestion service token (Settings → API Keys) |
| `DOCKER_HOST_NAME` | No | Friendly name for this host (default: `docker-host`) |

## Image Tags

| Tag | Description |
|-----|-------------|
| `oneuptime/docker-agent:release` | Latest stable release (community) |
| `oneuptime/docker-agent:enterprise-release` | Latest stable release (enterprise) |
| `oneuptime/docker-agent:<version>` | Pinned version, e.g. `10.0.31` |
| `ghcr.io/oneuptime/docker-agent:release` | Same image mirrored on GHCR |

## Collected Metrics

- **CPU**: `container.cpu.usage.total`, `container.cpu.percent`, `container.cpu.throttling_data.throttled_time`
- **Memory**: `container.memory.usage.total`, `container.memory.usage.limit`, `container.memory.percent`
- **Network**: `container.network.io.usage.rx_bytes`, `container.network.io.usage.tx_bytes`
- **Block I/O**: `container.blockio.io_service_bytes_recursive.read`, `container.blockio.io_service_bytes_recursive.write`
- **Container Info**: `container.uptime`, `container.restarts`, `container.pids.count`

## Collected Logs

Container logs are automatically collected from `/var/lib/docker/containers/*/*-json.log` and enriched with container metadata (container id, image, runtime, host name) plus a derived severity — lines written to stderr become `ERROR` and lines written to stdout become `INFO`. Logs are shipped in the native OpenTelemetry log record format, so `severityText`, `severityNumber`, `body`, `attributes`, `traceId`, and `spanId` are all populated.

### Log Driver Requirement

The agent only ingests logs from containers that use Docker's **`json-file`** log driver. This is Docker's default, but some installations override it to `local` (which writes binary protobuf chunks to `local-logs/` instead of `*-json.log` files) or to a remote driver (`journald`, `syslog`, `fluentd`, `gelf`, etc.) — none of which the filelog receiver can read.

**To check a container's current log driver:**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**To check the daemon default:**

```bash
docker info --format '{{.LoggingDriver}}'
```

**To switch a Compose service to `json-file` with sensible rotation**, add a `logging` block to each service:

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

**To switch the daemon default** (affects all containers created afterwards), edit `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Then restart Docker and recreate (not just restart) the affected containers — the log driver is baked in at container create time, so an existing container will keep its old driver until it is removed and recreated.

## Upgrading

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# Re-run the `docker run` command above
```

Or with Compose:

```bash
docker compose pull
docker compose up -d
```

## Uninstalling

```bash
docker rm -f oneuptime-docker-agent
```

## Building the Image Locally

If you want to build the image yourself (for development or air-gapped environments), from the repo root:

```bash
npm run prerun  # generates Dockerfile from Dockerfile.tpl
docker build -f ./DockerAgent/Dockerfile -t oneuptime/docker-agent:local .
```

## Troubleshooting

### Docker Socket Permission Denied

The agent must run as root (`--user 0:0`) to access `/var/run/docker.sock`. Ensure the `--user 0:0` flag (or `user: "0:0"` in Compose) is present.

### No Container Logs in the Dashboard

If metrics show up but the **Logs** tab is empty (or only shows logs from the agent itself), the most common cause is that your containers are not using the `json-file` log driver.

**Diagnose:**

```bash
# 1. Check the agent's filelog receiver — this should list each container log it is watching
docker logs oneuptime-docker-agent 2>&1 | grep -E "Started watching file|no files match"

# 2. Check which log driver your containers are actually using
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'

# 3. Check whether the log file the receiver expects actually exists
docker run --rm --volumes-from oneuptime-docker-agent alpine:3.19 \
  sh -c 'ls /var/lib/docker/containers/*/*-json.log 2>&1 | head'
```

If step 1 shows `no files match the configured criteria`, or step 3 returns no files for the containers you care about, those containers are not using `json-file`. See [Log Driver Requirement](#log-driver-requirement) for how to switch.

After changing the log driver, you must **recreate** (not just restart) each container, because Docker binds the log driver to the container at create time:

```bash
# For docker compose
docker compose up -d --force-recreate <service>

# For plain docker
docker rm -f <container>
docker run ... <image>
```

### Logs Are Ingested but Don't Appear on a Specific Docker Host Page

The Docker host page filters by `resource.host.name` equal to the host's `hostIdentifier`. This value is taken from the `DOCKER_HOST_NAME` environment variable passed to the agent. If you change `DOCKER_HOST_NAME` after the host is auto-registered, OneUptime will create a second host row with the new name and logs will appear under that one.

```bash
# Confirm the agent is stamping the expected host name
docker inspect oneuptime-docker-agent --format '{{range .Config.Env}}{{println .}}{{end}}' | grep DOCKER_HOST_NAME
```

### Common Commands

```bash
# Check agent status
docker ps --filter name=oneuptime-docker-agent

# View agent logs
docker logs -f oneuptime-docker-agent

# Verify Docker socket access
docker exec oneuptime-docker-agent ls -la /var/run/docker.sock
```
