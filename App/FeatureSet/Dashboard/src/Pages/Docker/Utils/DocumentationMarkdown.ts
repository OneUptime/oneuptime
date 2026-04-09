export function getDockerInstallationMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `
## Prerequisites

- Docker Engine 20.10+
- Docker Compose v2
- Access to \`/var/run/docker.sock\`

## Step 1: Create a Directory for the Agent

\`\`\`bash
sudo mkdir -p /opt/oneuptime-docker-agent
cd /opt/oneuptime-docker-agent
\`\`\`

## Step 2: Create the OTel Collector Config

Save the following as \`otel-collector-config.yaml\`:

\`\`\`yaml
receivers:
  docker_stats:
    endpoint: unix:///var/run/docker.sock
    collection_interval: 30s
    provide_per_core_cpu_metrics: true

  file_log:
    include:
      - /var/lib/docker/containers/*/*.log
    operators:
      - type: json_parser
      - type: move
        from: attributes.log
        to: body
      - type: move
        from: attributes.stream
        to: attributes["log.iostream"]

processors:
  resource:
    attributes:
      - key: container.runtime
        value: "docker"
        action: upsert
  resourcedetection:
    detectors: [env, system]
    system:
      hostname_sources: [os]
    override: false
  batch:
    timeout: 10s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 5s
    limit_mib: 512
    spike_limit_mib: 128

exporters:
  otlp_http:
    endpoint: "${data.oneuptimeUrl}/otlp"
    headers:
      x-oneuptime-service-token: "${data.apiKey}"

service:
  pipelines:
    metrics:
      receivers: [docker_stats]
      processors: [memory_limiter, resourcedetection, resource, batch]
      exporters: [otlp_http]
    logs:
      receivers: [file_log]
      processors: [memory_limiter, resourcedetection, resource, batch]
      exporters: [otlp_http]
\`\`\`

## Step 3: Create \`docker-compose.yml\`

\`\`\`yaml
services:
  oneuptime-docker-agent:
    image: otel/opentelemetry-collector-contrib:latest
    container_name: oneuptime-docker-agent
    user: "0:0"
    environment:
      - OTEL_RESOURCE_ATTRIBUTES=host.name=\${DOCKER_HOST_NAME:-docker-host}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - ./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
\`\`\`

> **Note:** The \`user: "0:0"\` setting is required so the collector can access the Docker socket. The \`DOCKER_HOST_NAME\` environment variable lets you set a friendly name for this host — set it in a \`.env\` file or export it before running.

## Step 4: Create a \`.env\` File (Optional)

Create a \`.env\` file to customize the host name:

\`\`\`bash
DOCKER_HOST_NAME=my-docker-server
\`\`\`

If omitted, the host will appear as **docker-host** in OneUptime.

## Step 5: Start the Agent

\`\`\`bash
docker compose up -d
\`\`\`

## Step 6: Verify the Installation

Check that the agent is running:

\`\`\`bash
docker compose ps
\`\`\`

You should see:

\`\`\`
NAME                     IMAGE                                         STATUS
oneuptime-docker-agent   otel/opentelemetry-collector-contrib:latest   Up
\`\`\`

Check the logs for successful startup:

\`\`\`bash
docker compose logs -f oneuptime-docker-agent
\`\`\`

Look for: \`"Everything is ready. Begin running and processing data."\`

Once the agent connects, your Docker host will appear automatically in the Docker section.

## Configuration Options

### Custom Host Name

Set \`DOCKER_HOST_NAME\` in your \`.env\` file or export it:

\`\`\`bash
export DOCKER_HOST_NAME=production-docker-01
docker compose up -d
\`\`\`

### Adjust Collection Interval

Edit \`otel-collector-config.yaml\` and change \`collection_interval\`:

\`\`\`yaml
receivers:
  docker_stats:
    collection_interval: 15s  # default: 30s
\`\`\`

### Adjust Memory Limits

If the collector uses too much memory, lower the limit:

\`\`\`yaml
processors:
  memory_limiter:
    limit_mib: 256   # default: 512
    spike_limit_mib: 64  # default: 128
\`\`\`

### Disable Log Collection

If you only need metrics (no container logs), remove the \`file_log\` receiver and the \`logs\` pipeline from the config, and remove the \`/var/lib/docker/containers\` volume mount from \`docker-compose.yml\`.

## Upgrading the Agent

\`\`\`bash
docker compose pull
docker compose up -d
\`\`\`

## Uninstalling the Agent

\`\`\`bash
docker compose down
sudo rm -rf /opt/oneuptime-docker-agent
\`\`\`

## What Gets Collected

| Category | Data |
|----------|------|
| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |
| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |
| **Network Metrics** | Bytes and packets received/transmitted (per container) |
| **Block I/O Metrics** | Read/write bytes and operations (per container) |
| **Container Info** | Uptime, restart count, process count |
| **Container Logs** | stdout/stderr logs from all containers |

## Troubleshooting

### Docker Socket Permission Denied

The agent container must run as root (\`user: "0:0"\`) to access \`/var/run/docker.sock\`. Ensure this line is present in your \`docker-compose.yml\`.

### Agent Shows as Disconnected

1. Check that the agent is running: \`docker compose ps\`
2. Check the agent logs: \`docker compose logs oneuptime-docker-agent | grep -i error\`
3. Verify your OneUptime URL and API key are correct
4. Ensure your Docker host can reach the OneUptime instance over the network

### No Metrics Appearing

1. Verify the Docker socket is accessible: \`docker compose exec oneuptime-docker-agent ls -la /var/run/docker.sock\`
2. Check the OTel collector logs for export errors
3. Ensure your ingestion key is valid and not expired

### Host Name Shows as Container ID

If the host name appears as a long hex string instead of a friendly name, set the \`DOCKER_HOST_NAME\` environment variable in your \`.env\` file and restart the agent.
`;
}
