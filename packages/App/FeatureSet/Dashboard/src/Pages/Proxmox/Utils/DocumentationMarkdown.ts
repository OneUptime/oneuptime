export function getProxmoxInstallationMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `
## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on any machine that can reach your Proxmox VE API (port 8006)
- A Proxmox VE API token with the **PVEAuditor** role (read-only) — mint it with the two-liner below, or in the UI under *Datacenter → Permissions → API Tokens*

**Agent placement:** run the agent somewhere that survives a node failure — a VM outside the cluster, a management host, or at minimum point \`PVE_HOST\` at a virtual IP that fails over between nodes. An agent running on (or scraping) a single PVE node goes dark exactly when that node dies.

### Creating the Proxmox API token

**Fastest path** — run this shell two-liner as root on any PVE node (create the user first with \`pveum user add monitoring@pam\` if it doesn't exist yet):

\`\`\`bash
pveum user token add monitoring@pam oneuptime --privsep 1
pveum acl modify / --roles PVEAuditor --tokens 'monitoring@pam!oneuptime'
\`\`\`

The first command prints the token secret — copy it now, it is shown only once. The ACL must sit on the root path \`/\`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with \`Permission check failed (/, Sys.Audit)\`.

**Prefer the UI?** The same token in 4 clicks:

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

## The Collector Config

This is the full \`otel-collector-config.yaml\` the agent runs (the \`.env\` file above supplies the \`\${env:...}\` values). The \`transform/pve-identity\` processor derives the \`pve.scope\` / \`pve.type\` / \`pve.id\` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:

\`\`\`yaml
receivers:
  # Scrape prometheus-pve-exporter, which translates the Proxmox VE API
  # into Prometheus metrics (pve_* series for nodes, guests, storage and
  # HA state). The exporter can run as the bundled compose service (see
  # docker-compose.yml, profile "pve-exporter") or anywhere else — point
  # PVE_EXPORTER_URL (host:port, no scheme) at it.
  prometheus:
    config:
      scrape_configs:
        - job_name: oneuptime-proxmox
          # The exporter serves metrics on /pve and proxies each scrape
          # to the Proxmox VE API host given in the \`target\` parameter.
          metrics_path: /pve
          params:
            # Proxmox VE API host (any cluster node) the exporter queries.
            target: ["\${env:PVE_HOST}"]
            # Enable both the cluster collectors (guest up/cpu/memory,
            # HA state — pve_up, pve_guest_info, pve_ha_state) and the
            # node collectors (node cpu/memory/disk — pve_node_info,
            # pve_cpu_usage_ratio on node ids).
            cluster: ["1"]
            node: ["1"]
          # pve-exporter answers each scrape with a live Proxmox VE API
          # round-trip; 30s keeps the load on pveproxy negligible.
          scrape_interval: 30s
          static_configs:
            - targets: ["\${env:PVE_EXPORTER_URL}"]

processors:
  # Split the pve-exporter identity label into equality-filterable parts.
  # pve-exporter encodes resource identity in a single datapoint label
  # \`id\` with values like \`node/pve1\`, \`qemu/100\`, \`lxc/101\` or
  # \`storage/pve1/local\`. OneUptime monitor criteria and attribute
  # filters match on equality (not prefix), so derive three attributes:
  #   pve.scope — node | guest | storage | cluster
  #               (\`qemu\` and \`lxc\` both map to \`guest\`)
  #   pve.type  — node | qemu | lxc | storage
  #               (left unset on \`cluster/*\` series)
  #   pve.id    — everything after the first slash of \`id\`
  #               (\`pve1\`, \`100\`, \`pve1/local\`)
  # The original \`id\` label is kept untouched — group-by pages and
  # breakdowns still use it. Do not remove this processor: the built-in
  # Proxmox alert templates filter on these attributes.
  transform/pve-identity:
    error_mode: ignore
    metric_statements:
      - context: datapoint
        statements:
          - set(attributes["pve.scope"], "node") where attributes["id"] != nil and IsMatch(attributes["id"], "^node/")
          - set(attributes["pve.type"], "node") where attributes["id"] != nil and IsMatch(attributes["id"], "^node/")
          - set(attributes["pve.scope"], "guest") where attributes["id"] != nil and IsMatch(attributes["id"], "^qemu/")
          - set(attributes["pve.type"], "qemu") where attributes["id"] != nil and IsMatch(attributes["id"], "^qemu/")
          - set(attributes["pve.scope"], "guest") where attributes["id"] != nil and IsMatch(attributes["id"], "^lxc/")
          - set(attributes["pve.type"], "lxc") where attributes["id"] != nil and IsMatch(attributes["id"], "^lxc/")
          - set(attributes["pve.scope"], "storage") where attributes["id"] != nil and IsMatch(attributes["id"], "^storage/")
          - set(attributes["pve.type"], "storage") where attributes["id"] != nil and IsMatch(attributes["id"], "^storage/")
          - set(attributes["pve.scope"], "cluster") where attributes["id"] != nil and IsMatch(attributes["id"], "^cluster/")
          - set(attributes["pve.id"], attributes["id"]) where attributes["id"] != nil and IsMatch(attributes["id"], "/")
          - replace_pattern(attributes["pve.id"], "^[^/]+/", "") where attributes["pve.id"] != nil
  # Stamp every metric with the cluster identity. OneUptime auto-registers
  # the Proxmox cluster from \`proxmox.cluster.name\`, and every Proxmox
  # page and monitor scopes on it — this attribute is what makes the data
  # appear under the Proxmox section of the dashboard. Keep it stable:
  # changing it later registers a brand-new cluster.
  resource:
    attributes:
      - key: proxmox.cluster.name
        value: "\${env:PROXMOX_CLUSTER_NAME}"
        action: upsert
      # The prometheus receiver synthesizes service.name (= the scrape job
      # name, "oneuptime-proxmox") and service.instance.id on every batch
      # per the Prometheus->OTLP compatibility spec. Drop them: OneUptime
      # routes batches by service.name first, so leaving them in would
      # register a phantom "oneuptime-proxmox" Service instead of routing
      # this data to the Proxmox cluster discovered from
      # \`proxmox.cluster.name\` (which would also break per-cluster
      # retention settings). Do not remove these two deletes.
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
      processors: [memory_limiter, transform/pve-identity, resource, batch]
      exporters: [otlphttp]
\`\`\`

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

The collector also splits the \`id\` label into three equality-filterable datapoint attributes (see the \`transform/pve-identity\` processor in the config above) — monitor criteria and dashboard filters match on these:

| Attribute | Values | Example for \`qemu/100\` |
|-----------|--------|------------------------|
| \`pve.scope\` | \`node\`, \`guest\`, \`storage\`, \`cluster\` (\`qemu\` and \`lxc\` both map to \`guest\`) | \`guest\` |
| \`pve.type\` | \`node\`, \`qemu\`, \`lxc\`, \`storage\` | \`qemu\` |
| \`pve.id\` | Everything after the first \`/\` of \`id\` (\`pve1\`, \`100\`, \`pve1/local\`) | \`100\` |

The original \`id\` label is kept untouched.

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

### Run the Diagnostic Script First

\`troubleshoot.sh\` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics, and a **definitive server-side token validation** (OneUptime's OTLP endpoints return a silent \`200\` on a bad ingestion key, so log inspection alone cannot tell you the key is wrong; the script asks \`GET /otlp/v1/validate\` for a real 200/401 verdict):

\`\`\`bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/ProxmoxAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-proxmox-agent
\`\`\`

### Cluster Shows as Disconnected

1. Check that the agent is running: \`docker compose ps\`
2. Check the agent logs: \`docker compose logs oneuptime-proxmox-agent | grep -i error\`
3. Verify your OneUptime URL and ingestion key are correct
4. Ensure the agent machine can reach the OneUptime instance over the network

### No Metrics Appearing

1. Check the exporter is reachable. The bundled exporter does not publish its port on the host, so run curl inside its network namespace: \`docker run --rm --network container:oneuptime-pve-exporter curlimages/curl -s "http://localhost:9221/pve?target=<PVE_HOST>&cluster=1&node=1" | head\` — you should see \`pve_*\` metric lines. (For an external exporter, curl its \`host:9221\` directly.)
2. Verify the Proxmox API token has the **PVEAuditor** role on path \`/\`
3. Check the collector logs for scrape or export errors

### Cluster Appears Under the Wrong Name

The cluster identity comes from \`PROXMOX_CLUSTER_NAME\`. Update the \`.env\` file and restart the agent — note that a new name registers a new cluster.
`;
}
