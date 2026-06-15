export function getDockerSwarmInstallationMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `
## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, running **on a Docker Swarm manager node**. The inventory poller calls manager-only API endpoints (\`/nodes\`, \`/services\`, \`/tasks\`), so it must run where the Docker socket belongs to a manager.
- A **OneUptime Telemetry Ingestion Key** — create one from *Project Settings → Telemetry Ingestion Keys* and copy the value.

**Agent placement:** run it on a manager node. For full per-node container metrics, run the collector on every node (all sharing the same \`DOCKER_SWARM_CLUSTER_NAME\`); the inventory poller only needs to run on one manager. When deploying as a swarm stack rather than via Compose, constrain the inventory poller to managers with \`node.role == manager\`.

## How it works

The agent is two cooperating containers:

1. **Collector** — a stock \`otel/opentelemetry-collector-contrib\` with a tuned config. It scrapes \`docker_stats\` for per-container CPU/memory, tails container logs, and tails the inventory snapshot file — stamping everything with \`docker.swarm.cluster.name\` before shipping to OneUptime over OTLP.
2. **Inventory poller** — a small \`curl\` + \`jq\` sidecar that every 5 minutes walks the Swarm manager API (\`docker node/service/task/network/secret/config/volume ls\`) and derives stacks from the \`com.docker.stack.namespace\` service label, writing one JSON line per object for the collector to forward.

## Quick Start — Install Script

\`\`\`bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/DockerSwarmAgent/install.sh -o install.sh
sh install.sh
\`\`\`

The script prompts for your OneUptime URL, telemetry ingestion key, and cluster name, installs to \`/opt/oneuptime-docker-swarm-agent\`, and starts the agent with Docker Compose.

## Quick Start — Docker Compose

Download \`docker-compose.yml\`, \`otel-collector-config.yaml\`, and \`inventory-snapshot.sh\` from the [DockerSwarmAgent directory](https://github.com/OneUptime/oneuptime/tree/master/DockerSwarmAgent) onto a manager node, then create a \`.env\` file next to them:

\`\`\`bash
ONEUPTIME_URL=${data.oneuptimeUrl}
ONEUPTIME_SERVICE_TOKEN=${data.apiKey}
DOCKER_SWARM_CLUSTER_NAME=my-swarm
\`\`\`

Then start the agent:

\`\`\`bash
chmod +x inventory-snapshot.sh
docker compose up -d
\`\`\`

Replace \`my-swarm\` with a friendly name for this cluster — it is how the cluster will appear in OneUptime. Keep it stable: changing it registers a new cluster.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${data.oneuptimeUrl}\`) |
| \`ONEUPTIME_SERVICE_TOKEN\` | Yes | Telemetry ingestion key |
| \`DOCKER_SWARM_CLUSTER_NAME\` | Yes | Cluster identifier shown in OneUptime. Stamped on every signal as the \`docker.swarm.cluster.name\` resource attribute. Defaults to \`docker-swarm\` |
| \`DOCKER_INVENTORY_INTERVAL_SECONDS\` | No | How often the poller refreshes the inventory snapshot (default \`300\`) |

## What Gets Collected

| Signal | Source | Powers |
|--------|--------|--------|
| Node / Service / Task / Stack / Network / Secret / Config / Volume inventory | inventory poller → Swarm manager API | the cluster's resource list + detail pages |
| Cluster counts (nodes ready, tasks running, services, stacks, …) | derived from the same snapshot | the overview cards + sidebar badges |
| Container CPU / memory / pids / uptime | \`docker_stats\` receiver | the Metrics tab |
| Container stdout/stderr logs | \`filelog\` receiver | the Logs tab |

The agent deliberately stamps **only** \`docker.swarm.cluster.name\` (not \`host.name\` / \`container.runtime\`) so OneUptime attributes the telemetry to this swarm cluster rather than auto-registering each node as a standalone Host or Docker Host.

## Verify the Installation

\`\`\`bash
docker compose ps
docker compose logs -f oneuptime-docker-swarm-agent
docker compose logs -f oneuptime-docker-swarm-inventory
\`\`\`

The cluster appears in OneUptime within a few minutes, and the resource list pages (Nodes, Services, Tasks, Stacks, Networks, Secrets, Configs, Volumes) populate after the first inventory snapshot (≤ 5 minutes).

## Upgrading the Agent

\`\`\`bash
cd /opt/oneuptime-docker-swarm-agent
docker compose pull
docker compose up -d
\`\`\`

## Uninstalling the Agent

\`\`\`bash
cd /opt/oneuptime-docker-swarm-agent
docker compose down
\`\`\`

## Troubleshooting

### No inventory appears

Confirm the poller runs on a manager (\`docker node ls\` must succeed there). Check \`docker compose logs oneuptime-docker-swarm-inventory\` for \`failed to emit ...\` lines.

### Cluster never appears

Check the collector logs and that \`ONEUPTIME_SERVICE_TOKEN\` / \`ONEUPTIME_URL\` are correct, and that the manager can reach the OneUptime instance.

### Status flaps to Disconnected

The cluster is marked disconnected after 15 minutes without telemetry; ensure the collector container stays running.

### Cluster Appears Under the Wrong Name

The cluster identity comes from \`DOCKER_SWARM_CLUSTER_NAME\`. Update the \`.env\` file and restart the agent — note that a new name registers a new cluster.
`;
}
