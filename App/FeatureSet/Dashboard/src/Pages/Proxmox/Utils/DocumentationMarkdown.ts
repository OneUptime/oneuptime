export function getProxmoxInstallationMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `
## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on any machine that can reach your Proxmox VE API (port 8006)
- A Proxmox VE API token with the **PVEAuditor** role (read-only) — create one under *Datacenter → Permissions → API Tokens*

### Creating the Proxmox API token

1. In the Proxmox web UI go to *Datacenter → Permissions → API Tokens* and click **Add**.
2. Pick (or create) a user, give the token an ID like \`oneuptime\`, and **uncheck Privilege Separation** (or grant the token its own permissions in the next step).
3. Under *Datacenter → Permissions* add a permission on path \`/\` for the token with the **PVEAuditor** role.
4. Copy the token id (\`user@realm!tokenname\`) and the secret — the secret is shown only once.

## Quick Start — Install Script

\`\`\`bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/ProxmoxAgent/install.sh -o install.sh
bash install.sh
\`\`\`

The script prompts for your OneUptime URL, telemetry ingestion key, cluster name, and Proxmox API details, installs to \`/opt/oneuptime-proxmox-agent\`, and starts the agent with Docker Compose.

## Quick Start — Docker Compose

The agent is config-only: a stock \`otel/opentelemetry-collector-contrib\` container with a tuned config that scrapes prometheus-pve-exporter, stamps the data with your cluster identity, and ships it to OneUptime over OTLP. The compose file optionally runs the exporter for you.

Download \`docker-compose.yml\` and \`otel-collector-config.yaml\` from the [ProxmoxAgent directory](https://github.com/OneUptime/oneuptime/tree/master/ProxmoxAgent) into a folder, then create a \`.env\` file next to them:

\`\`\`bash
ONEUPTIME_URL=${data.oneuptimeUrl}
ONEUPTIME_TELEMETRY_INGESTION_KEY=${data.apiKey}
PROXMOX_CLUSTER_NAME=my-proxmox-cluster
PVE_HOST=192.168.1.10
PVE_API_TOKEN_ID=oneuptime@pve!exporter
PVE_API_TOKEN_SECRET=your-token-secret
COMPOSE_PROFILES=pve-exporter
\`\`\`

Then start the agent (the \`pve-exporter\` profile also starts the bundled exporter):

\`\`\`bash
docker compose up -d
\`\`\`

Replace \`my-proxmox-cluster\` with a friendly name for this cluster — it is how the cluster will appear in OneUptime. Keep it stable: changing it registers a new cluster.

### Already running pve-exporter?

Skip the bundled exporter: drop \`COMPOSE_PROFILES\`, \`PVE_API_TOKEN_ID\`, and \`PVE_API_TOKEN_SECRET\` from the \`.env\` file and point the agent at your exporter instead:

\`\`\`bash
PVE_EXPORTER_URL=your-exporter-host:9221
\`\`\`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${data.oneuptimeUrl}\`) |
| \`ONEUPTIME_TELEMETRY_INGESTION_KEY\` | Yes | Telemetry ingestion key |
| \`PROXMOX_CLUSTER_NAME\` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the \`proxmox.cluster.name\` resource attribute. Defaults to \`proxmox-cluster\` |
| \`PVE_HOST\` | Yes | Proxmox VE API host (any node of the cluster) the exporter queries, e.g. \`192.168.1.10\` |
| \`PVE_EXPORTER_URL\` | No | Address (\`host:port\`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (\`pve-exporter:9221\`) |
| \`PVE_API_TOKEN_ID\` | Bundled exporter only | Full Proxmox API token id, e.g. \`oneuptime@pve!exporter\` |
| \`PVE_API_TOKEN_SECRET\` | Bundled exporter only | Proxmox API token secret |
| \`PVE_VERIFY_SSL\` | No | Verify the Proxmox API TLS certificate (default: \`false\` — PVE ships self-signed certificates) |

## Verify the Installation

Check that the agent is running:

\`\`\`bash
docker compose ps
\`\`\`

Check the agent logs:

\`\`\`bash
docker compose logs -f oneuptime-proxmox-agent
\`\`\`

Look for: \`"Everything is ready. Begin running and processing data."\`

## What Gets Collected

The agent scrapes the exporter every 30 seconds with both the cluster and node collectors enabled. Every series carries an \`id\` label identifying the resource — \`node/<name>\`, \`qemu/<vmid>\`, \`lxc/<vmid>\`, or \`storage/<node>/<storage>\`:

| Category | Metrics |
|----------|---------|
| **Availability** | \`pve_up\`, \`pve_uptime_seconds\` |
| **Node** | \`pve_node_info\`, \`pve_cpu_usage_ratio\`, \`pve_cpu_usage_limit\`, \`pve_memory_usage_bytes\`, \`pve_memory_size_bytes\` |
| **Guest (VM / LXC)** | \`pve_guest_info\`, plus CPU / memory / network series on \`qemu/*\` and \`lxc/*\` ids |
| **Storage** | \`pve_disk_usage_bytes\`, \`pve_disk_size_bytes\` |
| **HA** | \`pve_ha_state\` |

## Zero-install Alternative — Proxmox VE 9+ Native OpenTelemetry Push

Proxmox VE 9.0 and later can push metrics directly to OneUptime via the built-in OpenTelemetry metric server (*Datacenter → Metric Server → Add → OpenTelemetry*) — no agent or exporter required:

- **Server**: your OneUptime host
- **Port**: \`443\`, **Protocol**: \`https\`
- **Path**: \`/otlp/v1/metrics\`
- **Headers**: \`{"x-oneuptime-token": "<your-telemetry-ingestion-key>"}\`
- **Resource Attributes**: \`proxmox.cluster.name=my-proxmox-cluster\` — required for the cluster to register itself in OneUptime

Note: the native push emits \`proxmox_*\` metric names, while the agent emits pve-exporter's \`pve_*\` names. OneUptime's built-in Proxmox monitor catalog and alert templates target the \`pve_*\` names, so the agent path is recommended.

## Upgrading the Agent

\`\`\`bash
cd /opt/oneuptime-proxmox-agent
docker compose pull
docker compose up -d
\`\`\`

## Uninstalling the Agent

\`\`\`bash
cd /opt/oneuptime-proxmox-agent
docker compose down
\`\`\`

## Troubleshooting

### Cluster Shows as Disconnected

1. Check that the agent is running: \`docker compose ps\`
2. Check the agent logs: \`docker compose logs oneuptime-proxmox-agent | grep -i error\`
3. Verify your OneUptime URL and ingestion key are correct
4. Ensure the agent machine can reach the OneUptime instance over the network

### No Metrics Appearing

1. Check the exporter is reachable: \`curl "http://localhost:9221/pve?target=<PVE_HOST>&cluster=1&node=1"\`
2. Verify the Proxmox API token has the **PVEAuditor** role on path \`/\`
3. Check the collector logs for scrape or export errors

### Cluster Appears Under the Wrong Name

The cluster identity comes from \`PROXMOX_CLUSTER_NAME\`. Update the \`.env\` file and restart the agent — note that a new name registers a new cluster.
`;
}
