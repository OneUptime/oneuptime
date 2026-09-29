export function getPodmanInstallationMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `
## Prerequisites

- Podman Engine 20.10+
- Access to \`/run/podman/podman.sock\`

## Quick Start (One Command)

The OneUptime Podman Agent is a pre-built image that ships with a tuned OpenTelemetry Collector configuration. You only need to pass a few environment variables.

\`\`\`bash
podman run -d \\
  --name oneuptime-podman-agent \\
  --user 0:0 \\
  --restart unless-stopped \\
  -v /run/podman/podman.sock:/run/podman/podman.sock:ro \\
  -v /var/lib/containers:/var/lib/containers:ro \\
  -e ONEUPTIME_URL="${data.oneuptimeUrl}" \\
  -e ONEUPTIME_SERVICE_TOKEN="${data.apiKey}" \\
  -e PODMAN_HOST_NAME="my-podman-host" \\
  oneuptime/podman-agent:release
\`\`\`

Replace \`my-podman-host\` with a friendly name for this host — it is how the host will appear in OneUptime.

That's it. Once the agent connects, your Podman host will appear automatically in the Podman section.

## Alternative: Podman Compose

If you prefer Podman Compose, create a \`podman-compose.yml\`:

\`\`\`yaml
services:
  oneuptime-podman-agent:
    image: oneuptime/podman-agent:release
    container_name: oneuptime-podman-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /run/podman/podman.sock:/run/podman/podman.sock:ro
      - /var/lib/containers:/var/lib/containers:ro
    environment:
      - ONEUPTIME_URL=${data.oneuptimeUrl}
      - ONEUPTIME_SERVICE_TOKEN=${data.apiKey}
      - PODMAN_HOST_NAME=my-podman-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
\`\`\`

Start it:

\`\`\`bash
podman compose up -d
\`\`\`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${data.oneuptimeUrl}\`) |
| \`ONEUPTIME_SERVICE_TOKEN\` | Yes | Telemetry ingestion service token |
| \`PODMAN_HOST_NAME\` | No | Friendly name for this host. Defaults to \`podman-host\` |

## Verify the Installation

Check that the agent is running:

\`\`\`bash
podman ps --filter name=oneuptime-podman-agent
\`\`\`

Check the agent logs:

\`\`\`bash
podman logs -f oneuptime-podman-agent
\`\`\`

Look for: \`"Everything is ready. Begin running and processing data."\`

## Upgrading the Agent

\`\`\`bash
podman pull oneuptime/podman-agent:release
podman rm -f oneuptime-podman-agent
# Re-run the \`podman run\` command above
\`\`\`

Or with Podman Compose:

\`\`\`bash
podman compose pull
podman compose up -d
\`\`\`

## Uninstalling the Agent

\`\`\`bash
podman rm -f oneuptime-podman-agent
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

### Podman Socket Permission Denied

The agent container must run as root (\`--user 0:0\`) to access \`/run/podman/podman.sock\`. Ensure the \`--user 0:0\` flag (or \`user: "0:0"\` in Compose) is present.

### Agent Shows as Disconnected

1. Check that the agent is running: \`podman ps --filter name=oneuptime-podman-agent\`
2. Check the agent logs: \`podman logs oneuptime-podman-agent | grep -i error\`
3. Verify your OneUptime URL and service token are correct
4. Ensure your Podman host can reach the OneUptime instance over the network

### No Metrics Appearing

1. Verify the Podman socket is accessible: \`podman exec oneuptime-podman-agent ls -la /run/podman/podman.sock\`
2. Check the collector logs for export errors
3. Ensure your service token is valid and not expired

### Host Name Shows as a Container ID

Set the \`PODMAN_HOST_NAME\` environment variable to a friendly name and recreate the container.
`;
}
