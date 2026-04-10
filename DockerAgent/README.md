# OneUptime Docker Agent

Monitor Docker hosts, containers, and container logs with OneUptime using a pre-configured OpenTelemetry Collector.

The agent is published as a Docker image — `oneuptime/docker-agent` — that bundles a tuned collector config. Just pass a few environment variables and run it.

## Prerequisites

- Docker Engine 20.10+
- Access to `/var/run/docker.sock`

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

Container logs are automatically collected from `/var/lib/docker/containers/` and enriched with container metadata.

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

### Common Commands

```bash
# Check agent status
docker ps --filter name=oneuptime-docker-agent

# View agent logs
docker logs -f oneuptime-docker-agent

# Verify Docker socket access
docker exec oneuptime-docker-agent ls -la /var/run/docker.sock
```
