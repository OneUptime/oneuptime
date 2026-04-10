export function getDockerInstallationMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `
## Prerequisites

- Docker Engine 20.10+
- Access to \`/var/run/docker.sock\`

## Quick Start (One Command)

The OneUptime Docker Agent is a pre-built image that ships with a tuned OpenTelemetry Collector configuration. You only need to pass a few environment variables.

\`\`\`bash
docker run -d \\
  --name oneuptime-docker-agent \\
  --user 0:0 \\
  --restart unless-stopped \\
  -v /var/run/docker.sock:/var/run/docker.sock:ro \\
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \\
  -e ONEUPTIME_URL="${data.oneuptimeUrl}" \\
  -e ONEUPTIME_SERVICE_TOKEN="${data.apiKey}" \\
  -e DOCKER_HOST_NAME="my-docker-host" \\
  oneuptime/docker-agent:release
\`\`\`

Replace \`my-docker-host\` with a friendly name for this host — it is how the host will appear in OneUptime.

That's it. Once the agent connects, your Docker host will appear automatically in the Docker section.

## Alternative: Docker Compose

If you prefer Docker Compose, create a \`docker-compose.yml\`:

\`\`\`yaml
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
      - ONEUPTIME_URL=${data.oneuptimeUrl}
      - ONEUPTIME_SERVICE_TOKEN=${data.apiKey}
      - DOCKER_HOST_NAME=my-docker-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
\`\`\`

Start it:

\`\`\`bash
docker compose up -d
\`\`\`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${data.oneuptimeUrl}\`) |
| \`ONEUPTIME_SERVICE_TOKEN\` | Yes | Telemetry ingestion service token |
| \`DOCKER_HOST_NAME\` | No | Friendly name for this host. Defaults to \`docker-host\` |

## Verify the Installation

Check that the agent is running:

\`\`\`bash
docker ps --filter name=oneuptime-docker-agent
\`\`\`

Check the agent logs:

\`\`\`bash
docker logs -f oneuptime-docker-agent
\`\`\`

Look for: \`"Everything is ready. Begin running and processing data."\`

## Upgrading the Agent

\`\`\`bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# Re-run the \`docker run\` command above
\`\`\`

Or with Docker Compose:

\`\`\`bash
docker compose pull
docker compose up -d
\`\`\`

## Uninstalling the Agent

\`\`\`bash
docker rm -f oneuptime-docker-agent
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

The agent container must run as root (\`--user 0:0\`) to access \`/var/run/docker.sock\`. Ensure the \`--user 0:0\` flag (or \`user: "0:0"\` in Compose) is present.

### Agent Shows as Disconnected

1. Check that the agent is running: \`docker ps --filter name=oneuptime-docker-agent\`
2. Check the agent logs: \`docker logs oneuptime-docker-agent | grep -i error\`
3. Verify your OneUptime URL and service token are correct
4. Ensure your Docker host can reach the OneUptime instance over the network

### No Metrics Appearing

1. Verify the Docker socket is accessible: \`docker exec oneuptime-docker-agent ls -la /var/run/docker.sock\`
2. Check the collector logs for export errors
3. Ensure your service token is valid and not expired

### Host Name Shows as a Container ID

Set the \`DOCKER_HOST_NAME\` environment variable to a friendly name and recreate the container.
`;
}
