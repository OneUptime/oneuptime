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

## The Collector Config

This is the full \`otel-collector-config.yaml\` the agent runs (the \`.env\` file above supplies the \`\${env:...}\` values). The commented-out \`filelog\` receiver and \`logs\` pipeline optionally ship \`/var/log/ceph/ceph.log\`, which powers the **Cluster Log** page:

\`\`\`yaml
receivers:
  # Scrape the Ceph mgr prometheus module (\`ceph mgr module enable
  # prometheus\`, default port 9283) on EVERY mgr — active and standbys.
  # Only the active mgr returns metrics; standbys answer with an empty
  # response (or an HTTP error if mgr/prometheus/standby_behaviour is set
  # to "error"), so scraping all of them survives mgr failover with no
  # config change.
  prometheus:
    config:
      scrape_configs:
        - job_name: oneuptime-ceph
          # Keep the labels Ceph exports (ceph_daemon, pool_id, etc.).
          # Without honor_labels the instance label is rewritten per
          # scrape target and flips every time the active mgr changes,
          # breaking series continuity.
          honor_labels: true
          # The mgr prometheus module caches a scrape for
          # mgr/prometheus/scrape_interval (default 15s). Never scrape
          # more often than that cache interval — 30s is a comfortable
          # default for a production cluster.
          scrape_interval: 30s
          static_configs:
            # CEPH_MGR_ENDPOINTS is a comma-separated list of host:port
            # pairs wrapped in square brackets so the collector parses it
            # as a list, e.g.
            #   CEPH_MGR_ENDPOINTS=[ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283]
            - targets: \${env:CEPH_MGR_ENDPOINTS}

  # Optional: tail the Ceph cluster log and ship it to OneUptime — this is
  # what powers the Cluster Log page of the Ceph dashboard. Off by default
  # because it requires the agent to run on a host that has
  # /var/log/ceph/ceph.log (a mon host by default) AND the directory
  # mounted into the container — uncomment the matching volume in
  # docker-compose.yml:
  #   - /var/log/ceph:/var/log/ceph:ro
  # Then uncomment this receiver and the \`logs\` pipeline at the bottom of
  # this file. Lines ship verbatim; OneUptime parses the ceph.log format
  # (timestamp, daemon, INF/WRN/ERR level, message) at read time, and the
  # resource processor below stamps \`ceph.cluster.name\` so the log lands
  # on this cluster.
  # filelog:
  #   include:
  #     - /var/log/ceph/ceph.log
  #   # Tail from the end so an agent restart does not re-ship the file.
  #   start_at: end

processors:
  # Stamp every metric with the cluster identity. OneUptime auto-registers
  # the Ceph cluster from \`ceph.cluster.name\`, and every Ceph page and
  # monitor scopes on it — this attribute is what makes the data appear
  # under the Ceph section of the dashboard. Keep it stable: changing it
  # later registers a brand-new cluster.
  resource:
    attributes:
      - key: ceph.cluster.name
        value: "\${env:CEPH_CLUSTER_NAME}"
        action: upsert
      # Optionally also stamp the cluster fsid (\`ceph fsid\`). Uncomment
      # and set CEPH_CLUSTER_FSID in the .env file:
      # - key: ceph.cluster.fsid
      #   value: "\${env:CEPH_CLUSTER_FSID}"
      #   action: upsert
      # The prometheus receiver synthesizes service.name (= the scrape job
      # name, "oneuptime-ceph") and service.instance.id on every batch per
      # the Prometheus->OTLP compatibility spec. Drop them: OneUptime
      # routes batches by service.name first, so leaving them in would
      # register a phantom "oneuptime-ceph" Service instead of routing
      # this data to the Ceph cluster discovered from \`ceph.cluster.name\`
      # (which would also break per-cluster retention settings). Do not
      # remove these two deletes.
      - key: service.name
        action: delete
      - key: service.instance.id
        action: delete
  batch:
    timeout: 10s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 5s
    limit_mib: 256
    spike_limit_mib: 64

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [memory_limiter, resource, batch]
      exporters: [otlphttp]
    # Uncomment together with the filelog receiver above to ship the Ceph
    # cluster log (powers the Cluster Log page):
    # logs:
    #   receivers: [filelog]
    #   processors: [memory_limiter, resource, batch]
    #   exporters: [otlphttp]
\`\`\`

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

## Optional — Ship the Ceph Cluster Log

The agent can tail \`/var/log/ceph/ceph.log\` and ship it to OneUptime, which powers the **Cluster Log** page of this dashboard. It is off by default because it requires the agent to run on a host that has the cluster log (a mon host by default). To enable it:

1. Uncomment the \`filelog\` receiver and the \`logs\` pipeline in \`otel-collector-config.yaml\` (see the config above).
2. Uncomment the \`/var/log/ceph\` volume mount in \`docker-compose.yml\`.
3. Restart: \`docker compose up -d\`

## Troubleshooting

### Run the Diagnostic Script First

\`troubleshoot.sh\` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics, and a **definitive server-side token validation** (OneUptime's OTLP endpoints return a silent \`200\` on a bad ingestion key, so log inspection alone cannot tell you the key is wrong; the script asks \`GET /otlp/v1/validate\` for a real 200/401 verdict):

\`\`\`bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/CephAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-ceph-agent
\`\`\`

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
