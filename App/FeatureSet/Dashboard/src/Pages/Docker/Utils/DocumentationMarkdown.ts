export function getDockerInstallationMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `
## Prerequisites

- Docker Engine 20.10+
- Docker Compose v2
- Access to \`/var/run/docker.sock\`

## Installation

### Step 1: Create a directory for the agent

\`\`\`bash
mkdir -p /opt/oneuptime-docker-agent
cd /opt/oneuptime-docker-agent
\`\`\`

### Step 2: Create the OTel Collector config

Save the following as \`otel-collector-config.yaml\`:

\`\`\`yaml
receivers:
  docker_stats:
    endpoint: unix:///var/run/docker.sock
    collection_interval: 30s
    provide_per_core_cpu_metrics: true

  filelog:
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
    detectors: [env, system, docker]
    system:
      hostname_sources: [os]
  batch:
    timeout: 10s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 5s
    limit_mib: 512
    spike_limit_mib: 128

exporters:
  otlphttp:
    endpoint: "${data.oneuptimeUrl}/otlp"
    headers:
      x-oneuptime-service-token: "${data.apiKey}"

service:
  pipelines:
    metrics:
      receivers: [docker_stats]
      processors: [memory_limiter, resourcedetection, resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog]
      processors: [memory_limiter, resourcedetection, resource, batch]
      exporters: [otlphttp]
\`\`\`

### Step 3: Create \`docker-compose.yml\`

\`\`\`yaml
services:
  oneuptime-docker-agent:
    image: otel/opentelemetry-collector-contrib:latest
    container_name: oneuptime-docker-agent
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - ./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml
    restart: unless-stopped
\`\`\`

### Step 4: Start the agent

\`\`\`bash
docker compose up -d
\`\`\`

### Step 5: Verify

\`\`\`bash
docker compose ps
docker compose logs -f oneuptime-docker-agent
\`\`\`

The Docker host will appear automatically in OneUptime once metrics start flowing.

## What Gets Collected

- **CPU Metrics**: Usage, percentage, throttling time (per container)
- **Memory Metrics**: Usage, limit, percentage, RSS, cache (per container)
- **Network Metrics**: Bytes and packets received/transmitted (per container)
- **Block I/O Metrics**: Read/write bytes (per container)
- **Container Info**: Uptime, restart count, process count
- **Container Logs**: Automatically collected from all containers

## Troubleshooting

### Agent shows as disconnected

Verify the agent is running and can reach OneUptime:

\`\`\`bash
docker compose logs oneuptime-docker-agent | grep -i error
\`\`\`

### Missing metrics

Ensure the Docker socket is accessible:

\`\`\`bash
docker compose exec oneuptime-docker-agent ls -la /var/run/docker.sock
\`\`\`
`;
}
