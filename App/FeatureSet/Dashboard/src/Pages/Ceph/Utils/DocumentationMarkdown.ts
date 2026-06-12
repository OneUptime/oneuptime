export function getCephInstallationMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `
## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on any machine that can reach your Ceph mgr daemons (port 9283)
- The Ceph mgr \`prometheus\` module enabled
- A OneUptime Telemetry Ingestion Key (selected above)

### Enable the mgr prometheus module

\`\`\`bash
ceph mgr module enable prometheus
\`\`\`

Every mgr daemon then serves metrics on port \`9283\` at \`/metrics\`. Only the **active** mgr returns metrics — standby mgrs answer with an empty response. The agent therefore scrapes **all** mgr endpoints, so metrics keep flowing when the active mgr fails over.

To list your mgr daemons:

\`\`\`bash
ceph mgr stat                    # active mgr
ceph orch ps --daemon-type mgr   # all mgrs (cephadm clusters)
\`\`\`

## Quick Start (Install Script)

\`\`\`bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/CephAgent/install.sh -o install.sh
bash install.sh
\`\`\`

The script prompts for your OneUptime URL, telemetry ingestion key, cluster name, and mgr endpoints, installs to \`/opt/oneuptime-ceph-agent\`, and starts the agent with Docker Compose.

## Alternative: Docker Compose

Download \`docker-compose.yml\` and \`otel-collector-config.yaml\` from the [CephAgent directory](https://github.com/OneUptime/oneuptime/tree/master/CephAgent) into a folder, then create a \`.env\` file next to them:

\`\`\`bash
ONEUPTIME_URL=${data.oneuptimeUrl}
ONEUPTIME_TELEMETRY_INGESTION_KEY=${data.apiKey}
CEPH_CLUSTER_NAME=my-ceph-cluster
CEPH_MGR_ENDPOINTS=[ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283]
\`\`\`

Replace \`my-ceph-cluster\` with a friendly name for this cluster — it is how the cluster will appear in OneUptime. Keep it stable: changing it registers a new cluster.

Then start the agent:

\`\`\`bash
docker compose up -d
\`\`\`

That's it. Once the agent connects, your cluster will appear automatically in the Ceph section.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${data.oneuptimeUrl}\`) |
| \`ONEUPTIME_TELEMETRY_INGESTION_KEY\` | Yes | Telemetry ingestion key (*Project Settings → Telemetry Ingestion Keys*) |
| \`CEPH_CLUSTER_NAME\` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the \`ceph.cluster.name\` resource attribute |
| \`CEPH_MGR_ENDPOINTS\` | Yes | Comma-separated \`host:port\` list of **all** mgr daemons, wrapped in square brackets, e.g. \`[ceph-mon-1:9283,ceph-mon-2:9283]\`. The install script adds the brackets for you |

## Verify the Installation

Check that the agent is running:

\`\`\`bash
docker ps --filter name=oneuptime-ceph-agent
\`\`\`

Check the agent logs:

\`\`\`bash
docker logs -f oneuptime-ceph-agent
\`\`\`

Look for: \`"Everything is ready. Begin running and processing data."\`

## What Gets Collected

| Category | Data |
|----------|------|
| **Cluster Health** | \`ceph_health_status\` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |
| **OSD** | Up / in state for every OSD (per \`ceph_daemon\` label, e.g. \`osd.3\`) |
| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |
| **Placement Groups** | Active, degraded, and undersized PG counts |

## Scrape Behavior

- **All mgrs are scraped** (active + standbys) so metrics survive active-mgr failover.
- **30-second scrape interval.** The mgr prometheus module caches scrapes for 15 seconds by default — never scrape below 15 seconds.
- **\`honor_labels: true\`** keeps the labels Ceph exports (\`ceph_daemon\`, \`pool_id\`) as-is so series stay continuous across mgr failovers.

## Upgrading the Agent

\`\`\`bash
cd /opt/oneuptime-ceph-agent
docker compose pull
docker compose up -d
\`\`\`

## Uninstalling the Agent

\`\`\`bash
cd /opt/oneuptime-ceph-agent
docker compose down
\`\`\`

## Troubleshooting

### No cluster appears in OneUptime

1. Check the collector logs: \`docker logs oneuptime-ceph-agent\` — look for export errors (\`401\` means a bad ingestion key, connection refused means a wrong \`ONEUPTIME_URL\`).
2. Verify a mgr endpoint serves metrics: \`curl http://<active-mgr>:9283/metrics | head\` — you should see \`ceph_*\` metric lines. If not, enable the module: \`ceph mgr module enable prometheus\`.
3. Make sure \`CEPH_MGR_ENDPOINTS\` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.

### Metrics stop after a mgr failover

You are probably scraping only the (previously) active mgr. List **every** mgr daemon in \`CEPH_MGR_ENDPOINTS\` — scrapes of standby mgrs are cheap and return empty responses.

### Cluster shows as Disconnected

1. Check that the agent is running: \`docker ps --filter name=oneuptime-ceph-agent\`
2. Check the agent logs: \`docker logs oneuptime-ceph-agent | grep -i error\`
3. Verify your OneUptime URL and ingestion key are correct
4. Ensure the agent machine can reach the OneUptime instance over the network
`;
}
