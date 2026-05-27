# OneUptime Docker Agent

## Overview

The OneUptime Docker Agent is a pre-built container image that ships with a tuned OpenTelemetry Collector configuration. Run it next to your existing containers and it auto-discovers every container on the host, collects CPU / memory / network / block I/O metrics plus container logs, and forwards everything to OneUptime over OTLP. Single image, single command.

This page is the **installation guide**. For configuring Docker monitors and alerts on top of the data the agent collects, see [Docker Monitor](/docs/monitor/docker-monitor).

## Prerequisites

- Docker Engine 20.10+
- Access to `/var/run/docker.sock` on the host
- A **OneUptime Telemetry Ingestion Token** — create one from *Project Settings → Telemetry Ingestion Keys* and copy the value

## Quick Start (One Command)

Replace `YOUR_ONEUPTIME_URL`, `YOUR_TELEMETRY_INGESTION_TOKEN`, and the host name with values for your environment. The host name is how this Docker host will appear in OneUptime — pick something like `prod-docker-01`.

```bash
docker run -d \
  --name oneuptime-docker-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/docker-agent:release
```

That is it. Once the agent connects, your Docker host will appear automatically in the **Docker** section of the OneUptime dashboard.

## Alternative — Docker Compose

If you prefer Docker Compose, drop the following into a `docker-compose.yml`:

```yaml
services:
  oneuptime-docker-agent:
    image: oneuptime/docker-agent:release
    container_name: oneuptime-docker-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - DOCKER_HOST_NAME=my-docker-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Start it:

```bash
docker compose up -d
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (for example `https://oneuptime.com` or your self-hosted host) |
| `ONEUPTIME_SERVICE_TOKEN` | Yes | Telemetry ingestion token from *Project Settings → Telemetry Ingestion Keys* |
| `DOCKER_HOST_NAME` | No | Friendly name for this host. Defaults to `docker-host`. Set it to something stable per host (e.g. `prod-docker-01`) |

## Verify the Installation

Check that the agent is running:

```bash
docker ps --filter name=oneuptime-docker-agent
```

Check the agent logs:

```bash
docker logs -f oneuptime-docker-agent
```

Look for: `"Everything is ready. Begin running and processing data."`

Within a minute or so the host should appear in the OneUptime dashboard with metrics and logs flowing.

## Upgrading the Agent

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# Re-run the `docker run` command above
```

Or with Docker Compose:

```bash
docker compose pull
docker compose up -d
```

## Uninstalling the Agent

```bash
docker rm -f oneuptime-docker-agent
```

If you used Docker Compose:

```bash
docker compose down
```

## What Gets Collected

| Category | Data |
|----------|------|
| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |
| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |
| **Network Metrics** | Bytes and packets received / transmitted (per container) |
| **Block I/O Metrics** | Read / write bytes and operations (per container) |
| **Container Info** | Uptime, restart count, process count |
| **Container Logs** | stdout / stderr logs from all containers |

## Self-hosted OneUptime

If you are self-hosting OneUptime, set `ONEUPTIME_URL` to your own instance:

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

If your instance is HTTP-only, use `http://` and the appropriate port.

## Troubleshooting

### Docker Socket Permission Denied

The agent container must run as root (`--user 0:0`) to access `/var/run/docker.sock`. Ensure the `--user 0:0` flag (or `user: "0:0"` in Compose) is present.

### Agent Shows as Disconnected

1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`
2. Check the agent logs: `docker logs oneuptime-docker-agent | grep -i error`
3. Verify your OneUptime URL and service token are correct
4. Ensure your Docker host can reach the OneUptime instance over the network

### No Metrics Appearing

1. Verify the Docker socket is accessible inside the agent: `docker exec oneuptime-docker-agent ls -la /var/run/docker.sock`
2. Check the collector logs for export errors: `docker logs oneuptime-docker-agent | tail -100`
3. Ensure your service token is valid and not expired

### Host Name Shows as a Container ID

Set the `DOCKER_HOST_NAME` environment variable to a friendly name and recreate the container.

## Next steps

- Configure **Docker Monitors** to alert on container CPU / memory / restart conditions — see [Docker Monitor](/docs/monitor/docker-monitor).
- For Kubernetes clusters instead of standalone Docker hosts, use the [OneUptime Kubernetes Agent](/docs/telemetry/kubernetes-agent).
- For non-containerized hosts (Linux / macOS / Windows VMs and bare metal), use the [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
