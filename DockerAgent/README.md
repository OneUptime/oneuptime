# OneUptime Docker Agent

Monitor your Docker containers with OneUptime using the OpenTelemetry Collector.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose v2
- Access to `/var/run/docker.sock`

## Quick Start

### Option A: One-Line Install

```bash
curl -sSL https://raw.githubusercontent.com/nickatnight/OneUptime/master/DockerAgent/install.sh | bash
```

### Option B: Docker Compose (Manual)

1. Clone or download this directory
2. Create a `.env` file:

```bash
ONEUPTIME_URL=https://your-oneuptime-instance.com
ONEUPTIME_SERVICE_TOKEN=your-service-token
ONEUPTIME_PROJECT_ID=your-project-id
```

3. Start the agent:

```bash
docker compose up -d
```

### Option C: systemd Service

1. Run the install script or manually copy files to `/opt/oneuptime-docker-agent/`
2. Copy the systemd unit file:

```bash
sudo cp systemd/oneuptime-docker-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-docker-agent
```

## Configuration

The agent is configured via `otel-collector-config.yaml`. Key settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `collection_interval` | `30s` | How often to collect Docker metrics |
| `provide_per_core_cpu_metrics` | `true` | Collect per-core CPU usage |
| `batch.timeout` | `10s` | Batch export timeout |
| `memory_limiter.limit_mib` | `512` | Memory limit for the collector |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL |
| `ONEUPTIME_SERVICE_TOKEN` | Yes | Service token from Settings > API Keys |
| `ONEUPTIME_PROJECT_ID` | Yes | Your OneUptime project ID |

## Collected Metrics

The agent collects the following Docker container metrics:

- **CPU**: `container.cpu.usage.total`, `container.cpu.percent`, `container.cpu.throttling_data.throttled_time`
- **Memory**: `container.memory.usage.total`, `container.memory.usage.limit`, `container.memory.percent`
- **Network**: `container.network.io.usage.rx_bytes`, `container.network.io.usage.tx_bytes`
- **Block I/O**: `container.blockio.io_service_bytes_recursive.read`, `container.blockio.io_service_bytes_recursive.write`
- **Container Info**: `container.uptime`, `container.restarts`, `container.pids.count`

## Collected Logs

Container logs are automatically collected from `/var/lib/docker/containers/` and enriched with container metadata.

## Troubleshooting

### Docker Socket Permission Denied

The agent container must run as root (`user: "0:0"` in docker-compose.yml) to access `/var/run/docker.sock`. This is already configured in the provided `docker-compose.yml`. If you see a "permission denied" error for the Docker socket, ensure:

1. The `user: "0:0"` line is present in your `docker-compose.yml`
2. The Docker socket is mounted as a volume: `/var/run/docker.sock:/var/run/docker.sock:ro`

### Common Commands

```bash
# Check agent status
docker compose ps

# View agent logs
docker compose logs -f

# Verify Docker socket access
docker compose exec oneuptime-docker-agent ls -la /var/run/docker.sock

# Test connectivity to OneUptime
docker compose exec oneuptime-docker-agent wget -q -O- ${ONEUPTIME_URL}/status
```
