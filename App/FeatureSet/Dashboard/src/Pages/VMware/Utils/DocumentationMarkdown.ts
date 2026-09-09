/*
 * In-app install guide for the OneUptime VMware Agent. The compose file
 * and the collector config below are the REAL files shipped in
 * VMwareAgent/ (docker-compose.yml, otel-collector-config.yaml) — keep
 * them in sync when the agent changes. The `.env` block interpolates the
 * viewer's OneUptime URL and the ingestion key they picked in the card.
 */
export function getVMwareInstallationMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `
## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on any machine that can reach vCenter Server over HTTPS (TCP 443)
- vCenter Server / ESXi **7.0 or later** (the collector's \`vcenter\` receiver supports vSphere 7 and 8)
- A vSphere user holding the built-in **Read-Only** role, propagated from the top-level vCenter object (see below)

One agent monitors one vSphere endpoint — a **vCenter Server** (the normal case, covering every datacenter, cluster and ESXi host it manages) or a **standalone ESXi host** that is not managed by a vCenter. Run one agent per vCenter.

**Agent placement:** the agent talks to vCenter over HTTPS, so it does not have to live near it — and ideally it should not run on the vCenter Server Appliance or inside a VM on the very cluster it watches: if that cluster goes down, your monitoring goes down with it. A small management VM on separate hardware, a monitoring host, or any Docker-capable machine with a route to vCenter on TCP 443 is the right home.

### Creating the read-only vSphere user

The agent only ever reads: inventory, performance counters and vSAN statistics. Give it a dedicated account with the built-in **Read-Only** role — never an administrator.

**Via the vSphere Client:**

1. Create the account: *Menu → Administration → Single Sign On → Users and Groups*, pick the \`vsphere.local\` domain (or your identity source), **Add** a user such as \`oneuptime\` and set a password. This yields the principal \`oneuptime@vsphere.local\`.
2. Grant the role: select the top-level **vCenter Server** object in the *Hosts and Clusters* inventory, open the **Permissions** tab, click **Add**, choose the user, set the role to **Read-Only**, and tick **Propagate to children**.

Propagation is the part people miss. The receiver walks datacenters → clusters → hosts → VMs → datastores → resource pools, and every object the user cannot see is silently absent from the metrics — a Read-Only role granted on the vCenter object *without* propagation yields an inventory with nothing in it.

**Or with \`govc\`** (from a machine with administrator credentials):

\`\`\`bash
govc sso.user.create -p 'a-strong-password' -R ReadOnly oneuptime
govc permissions.set -principal oneuptime@vsphere.local -role ReadOnly -propagate=true /
\`\`\`

For a **standalone ESXi host** (no vCenter), create the user under *Host → Manage → Security & Users → Users* in the ESXi Host Client and assign the Read-Only role under *Host → Manage → Security & Users → Permissions*.

## Quick Start — Install Script

\`\`\`bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/VMwareAgent/install.sh -o install.sh
bash install.sh
\`\`\`

The script prompts for your OneUptime URL, telemetry ingestion key, a stable vCenter name, the vCenter endpoint and the read-only credentials (the password is read without echo), installs to \`/opt/oneuptime-vmware-agent\`, writes a \`0600\` \`.env\` file and starts the agent with Docker Compose. Values are quoted for Docker Compose as they are written, so a password containing \`$\`, \`#\`, spaces or quotes works exactly as typed, and re-running the script reuses everything in an existing \`.env\` instead of prompting again.

## Quick Start — Docker Compose

The agent is config-only: a stock \`otel/opentelemetry-collector-contrib\` container whose native \`vcenter\` receiver polls the vSphere SDK with your read-only user, stamps the data with your vCenter identity, and ships it to OneUptime over OTLP. No exporter sidecar, no plugin on vCenter, no agent inside the VMs.

Download \`docker-compose.yml\` and \`otel-collector-config.yaml\` from the [VMwareAgent directory](https://github.com/OneUptime/oneuptime/tree/master/VMwareAgent) into a folder, then create a \`.env\` file next to them (\`chmod 600 .env\` — it holds a password):

\`\`\`bash
ONEUPTIME_URL=${data.oneuptimeUrl}
ONEUPTIME_TELEMETRY_INGESTION_KEY=${data.apiKey}
VMWARE_VCENTER_NAME=my-vcenter
VCENTER_ENDPOINT=https://vcsa.example.com
VCENTER_USERNAME=oneuptime@vsphere.local
VCENTER_PASSWORD=a-strong-password
VCENTER_INSECURE_SKIP_VERIFY=true
VCENTER_COLLECTION_INTERVAL=2m
\`\`\`

Then start the agent:

\`\`\`bash
docker compose up -d
\`\`\`

Replace \`my-vcenter\` with a friendly name for this vCenter — it is how the vCenter will appear in OneUptime. Keep it stable: changing it registers a new vCenter. After the first collection (about one \`VCENTER_COLLECTION_INTERVAL\`) the vCenter appears automatically in the **VMware** section, with its datacenters, clusters, ESXi hosts, virtual machines, datastores and resource pools inventoried.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime instance URL (e.g. \`${data.oneuptimeUrl}\`) |
| \`ONEUPTIME_TELEMETRY_INGESTION_KEY\` | Yes | Telemetry ingestion key |
| \`VMWARE_VCENTER_NAME\` | Yes | The name this vCenter registers under in OneUptime. Stamped on every metric as the \`vmware.vcenter.name\` resource attribute. Keep it stable — changing it registers a new vCenter (default: \`vmware-vcenter\`) |
| \`VCENTER_ENDPOINT\` | Yes | Scheme + host of vCenter Server or a standalone ESXi host, **without** \`/sdk\`, e.g. \`https://vcsa.example.com\` |
| \`VCENTER_USERNAME\` | Yes | vSphere user with the Read-Only role, e.g. \`oneuptime@vsphere.local\` (or \`DOMAIN\\\\user\` for an Active Directory identity source) |
| \`VCENTER_PASSWORD\` | Yes | That user's password. If it contains \`$\`, \`#\`, spaces or quotes, single-quote it in \`.env\` (\`install.sh\` does this for you) — see Troubleshooting |
| \`VCENTER_INSECURE_SKIP_VERIFY\` | No | \`true\` to accept vCenter's default self-signed (VMCA) certificate; \`false\` keeps TLS verification on (default: \`false\`) |
| \`VCENTER_COLLECTION_INTERVAL\` | No | How often the whole inventory is polled. Raise to \`5m\` or \`10m\` for very large vCenters (default: \`2m\`) |

## The Compose File

This is the \`docker-compose.yml\` the agent runs (the \`.env\` file above supplies the values). The collector image is pinned; when a newer OneUptime release bumps the pin, re-download both files before pulling:

\`\`\`yaml
services:
  oneuptime-vmware-agent:
    # Upstream collector, pinned. There is no oneuptime/vmware-agent image —
    # the agent is entirely defined by otel-collector-config.yaml. The native
    # \`vcenter\` receiver talks to vCenter directly, so no exporter sidecar
    # is needed.
    image: otel/opentelemetry-collector-contrib:0.154.0
    container_name: oneuptime-vmware-agent
    volumes:
      - ./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro
    # Uncomment (together with the syslog receivers and the logs pipeline
    # in otel-collector-config.yaml) to accept syslog forwarded by ESXi
    # hosts — Syslog.global.logHost = udp://<this-machine>:5514 or
    # tcp://<this-machine>:5514. This powers the Logs tab of the vCenter
    # dashboard.
    # ports:
    #   - "5514:5514/tcp"
    #   - "5514:5514/udp"
    environment:
      - ONEUPTIME_URL=\${ONEUPTIME_URL}
      - ONEUPTIME_TELEMETRY_INGESTION_KEY=\${ONEUPTIME_TELEMETRY_INGESTION_KEY}
      # The name this vCenter registers under in OneUptime (stamped on
      # every metric as the vmware.vcenter.name resource attribute). Keep
      # it stable — changing it registers a brand-new vCenter.
      - VMWARE_VCENTER_NAME=\${VMWARE_VCENTER_NAME:-vmware-vcenter}
      # Scheme + host of vCenter Server (or a standalone ESXi host), no
      # /sdk suffix, e.g. https://vcsa.example.com
      - VCENTER_ENDPOINT=\${VCENTER_ENDPOINT}
      # A vSphere user holding the Read-Only role.
      - VCENTER_USERNAME=\${VCENTER_USERNAME}
      - VCENTER_PASSWORD=\${VCENTER_PASSWORD}
      # vCenter ships a self-signed certificate by default. Verification
      # stays ON unless you opt out with "true".
      - VCENTER_INSECURE_SKIP_VERIFY=\${VCENTER_INSECURE_SKIP_VERIFY:-false}
      # Full-inventory poll interval. Raise to 5m/10m for very large
      # vCenters (thousands of VMs).
      - VCENTER_COLLECTION_INTERVAL=\${VCENTER_COLLECTION_INTERVAL:-2m}
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
\`\`\`

## The Collector Config

This is the full \`otel-collector-config.yaml\` the agent runs. The \`resource\` processor stamps the \`vmware.vcenter.name\` attribute that registers the vCenter in OneUptime and that every VMware page, monitor and alert template scopes on — keep it in place if you customize the config. The \`batch\` processor deliberately has no \`send_batch_max_size\`: OneUptime reads a whole collection per request to sum inventory counts and infer VM power state, so a scrape must never be split across exports:

\`\`\`yaml
receivers:
  # Poll vCenter Server (or a standalone ESXi host) through the vSphere
  # SDK with the collector's native \`vcenter\` receiver. No exporter
  # sidecar is needed: the receiver walks the inventory itself and emits
  # one OTLP resource per vSphere object (datacenter, cluster, ESXi host,
  # virtual machine, VM template, datastore, resource pool) with the
  # object's identity in RESOURCE attributes (vcenter.datacenter.name,
  # vcenter.cluster.name, vcenter.host.name, vcenter.vm.name / vcenter.vm.id,
  # vcenter.datastore.name, vcenter.resource_pool.inventory_path, ...).
  vcenter:
    # Scheme + host only, e.g. https://vcsa.example.com — the receiver
    # appends /sdk itself. Works against vCenter Server (normal case) and
    # against a standalone ESXi host that is not managed by a vCenter.
    endpoint: "\${env:VCENTER_ENDPOINT}"
    # A vSphere user holding the built-in Read-Only role, propagated from
    # the vCenter root object to every child.
    username: "\${env:VCENTER_USERNAME}"
    password: "\${env:VCENTER_PASSWORD}"
    # How often the whole inventory is walked. 2m is a sensible default;
    # raise it (5m, 10m) for vCenters with thousands of VMs — every
    # collection is a full vSphere SDK round-trip.
    collection_interval: "\${env:VCENTER_COLLECTION_INTERVAL}"
    initial_delay: 1s
    # Maximum performance-counter entities per query. 256 matches the
    # vpxd.stats.maxQueryMetrics default on vCenter; lowering it only helps
    # when the vCenter administrator has tightened that setting.
    max_query_metrics: 256
    tls:
      # vCenter appliances ship a self-signed (VMCA) certificate by
      # default. Set VCENTER_INSECURE_SKIP_VERIFY=true to accept it, or
      # keep verification on and trust the VMCA root on this machine.
      # The placeholder is deliberately UNQUOTED: a quoted "\${env:...}"
      # is a string and fails this boolean field at startup.
      insecure_skip_verify: \${env:VCENTER_INSECURE_SKIP_VERIFY}
    metrics:
      # Off by default upstream. OneUptime uses it as the denominator for
      # host memory utilisation (usage / capacity) on the Hosts page, so
      # it is enabled here. Do not disable it.
      vcenter.host.memory.capacity:
        enabled: true
      # Other optional metrics the receiver can emit, all off by default.
      # Enable any of them the same way if you want them in OneUptime:
      #   vcenter.vm.cpu.time                        (CPU time by cpu_state: idle/ready/wait)
      #   vcenter.vm.memory.granted                  (memory granted to the VM, MiBy)
      #   vcenter.host.memory.active                 (actively used host memory)
      #   vcenter.host.memory.ballooned              (memory reclaimed by ballooning on the host)
      #   vcenter.host.memory.granted                (memory granted to VMs on the host)
      #   vcenter.vm.network.broadcast.packet.rate   (broadcast packets/s per vNIC)
      #   vcenter.vm.network.multicast.packet.rate   (multicast packets/s per vNIC)

  # Optional: receive syslog forwarded by ESXi hosts (and vCenter) — this
  # is what powers the Logs tab of the vCenter dashboard. Off by default
  # because it needs a listening port published on this machine. To
  # enable it:
  #   1. Uncomment the \`syslog\` receivers below, the \`logs\` pipeline at
  #      the bottom of this file, and the port mapping in docker-compose.yml.
  #   2. On every ESXi host set Syslog.global.logHost (Host → Configure →
  #      System → Advanced System Settings) to udp://<agent-host>:5514 or
  #      tcp://<agent-host>:5514, and open the outbound syslog firewall
  #      rule on the host (Configure → System → Firewall → syslog).
  # ESXi speaks classic BSD syslog (RFC 3164). The resource processor
  # below stamps vmware.vcenter.name on these logs too, so they land on
  # this vCenter. A syslog receiver honours only one of \`tcp:\` / \`udp:\`
  # (tcp wins, udp is silently ignored), so TCP and UDP are two named
  # receivers — uncomment both to accept either transport.
  # syslog/tcp:
  #   tcp:
  #     listen_address: "0.0.0.0:5514"
  #   protocol: rfc3164
  # syslog/udp:
  #   udp:
  #     listen_address: "0.0.0.0:5514"
  #   protocol: rfc3164

processors:
  # Stamp every metric with the vCenter identity. OneUptime auto-registers
  # the vCenter from \`vmware.vcenter.name\`, and every VMware page and
  # monitor scopes on it — this attribute is what makes the data appear
  # under the VMware section of the dashboard. Keep it stable: changing
  # it later registers a brand-new vCenter. (It is deliberately NOT
  # \`vcenter.cluster.name\`: the receiver already stamps that per vSphere
  # compute cluster, and an upsert would overwrite the real cluster names.)
  resource:
    attributes:
      - key: vmware.vcenter.name
        value: "\${env:VMWARE_VCENTER_NAME}"
        action: upsert
      # Defensive: the native vcenter receiver does not synthesize
      # service.name / service.instance.id, but OTEL_RESOURCE_ATTRIBUTES
      # or a customised pipeline could add them. OneUptime routes batches
      # by service.name first, so if one slipped through it would register
      # a phantom Service instead of routing this data to the vCenter
      # discovered from \`vmware.vcenter.name\` (and break per-vCenter
      # retention settings). Do not remove these two deletes.
      - key: service.name
        action: delete
      - key: service.instance.id
        action: delete
  batch:
    timeout: 10s
    # Large enough to hold one complete scrape of a big inventory. There
    # is deliberately NO send_batch_max_size: a scrape must never be split
    # across exports, because OneUptime reads a whole scrape per request
    # to (a) sum inventory counts (host / VM / datastore counts fan out
    # over status and power_state) and (b) infer VM power state from the
    # presence of vcenter.vm.cpu.* datapoints next to the VM's memory and
    # disk datapoints. Splitting would zero counts and flip VMs "off".
    send_batch_size: 8192
  memory_limiter:
    check_interval: 5s
    # The receiver materialises the whole inventory on every collection;
    # 512 MiB leaves ample headroom for vCenters with thousands of VMs.
    limit_mib: 512
    spike_limit_mib: 128

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [vcenter]
      processors: [memory_limiter, resource, batch]
      exporters: [otlphttp]
    # Uncomment together with the syslog receivers above to ship ESXi
    # syslog (powers the Logs tab of the vCenter dashboard):
    # logs:
    #   receivers: [syslog/tcp, syslog/udp]
    #   processors: [memory_limiter, resource, batch]
    #   exporters: [otlphttp]
\`\`\`

## Verify the Installation

Check that the agent is running:

\`\`\`bash
docker compose ps
\`\`\`

Check the agent logs:

\`\`\`bash
docker compose logs -f oneuptime-vmware-agent
\`\`\`

Look for: \`"Everything is ready. Begin running and processing data."\` — then give it one collection interval: nothing is sent until the first full inventory walk completes.

## What Gets Collected

Every \`VCENTER_COLLECTION_INTERVAL\` the receiver walks the full vSphere inventory and emits one OpenTelemetry resource per object. Identity lives in **resource attributes** — \`vcenter.datacenter.name\`, \`vcenter.cluster.name\`, \`vcenter.host.name\`, \`vcenter.vm.name\` / \`vcenter.vm.id\`, \`vcenter.datastore.name\`, \`vcenter.resource_pool.name\` / \`vcenter.resource_pool.inventory_path\` — and the agent adds \`vmware.vcenter.name\` on top so OneUptime can route everything to your vCenter.

| vSphere object | Identity (resource attributes) | Metrics |
|---|---|---|
| **Datacenter** | \`vcenter.datacenter.name\` | \`vcenter.datacenter.cluster.count{status}\`, \`.host.count{status,power_state}\`, \`.vm.count{status,power_state}\`, \`.datastore.count\`, \`.disk.space{disk_state}\`, \`.cpu.limit\`, \`.memory.limit\` |
| **Cluster** | + \`vcenter.cluster.name\` | \`vcenter.cluster.cpu.effective\`, \`.cpu.limit\`, \`.memory.effective\`, \`.memory.limit\`, \`.host.count{effective}\`, \`.vm.count{power_state}\`, \`.vm_template.count\`, \`vcenter.cluster.vsan.*\` |
| **ESXi host** | + \`vcenter.host.name\` (and \`vcenter.cluster.name\` when clustered) | \`vcenter.host.cpu.usage\` / \`.capacity\` / \`.utilization\` / \`.reserved\`, \`.memory.usage\` / \`.utilization\` / \`.capacity\`, \`.disk.latency.avg\` / \`.latency.max\` / \`.throughput\`, \`.network.usage\` / \`.throughput\` / \`.packet.rate\` / \`.packet.drop.rate\` / \`.packet.error.rate\`, \`vcenter.host.vsan.*\` |
| **Virtual machine** | + \`vcenter.host.name\`, \`vcenter.vm.name\`, \`vcenter.vm.id\` (instance UUID); \`vcenter.resource_pool.*\` or \`vcenter.virtual_app.*\` | \`vcenter.vm.disk.usage{disk_state}\`, \`.disk.utilization\`, \`.memory.usage\` / \`.utilization\` / \`.ballooned\` / \`.swapped\` / \`.swapped_ssd\`; **powered-on VMs only:** \`.cpu.usage\`, \`.cpu.readiness\`, \`.cpu.utilization\`, \`.disk.latency.*\` / \`.throughput\`, \`.network.*\`, \`vcenter.vm.vsan.*\` |
| **VM template** | \`vcenter.vm_template.name\`, \`vcenter.vm_template.id\` | \`vcenter.vm.disk.usage{disk_state}\` only |
| **Datastore** | + \`vcenter.datastore.name\` | \`vcenter.datastore.disk.usage{disk_state}\`, \`.disk.utilization\` |
| **Resource pool** | + \`vcenter.resource_pool.name\`, \`vcenter.resource_pool.inventory_path\` | \`vcenter.resource_pool.cpu.usage\` / \`.cpu.shares\`, \`.memory.usage{type}\` / \`.memory.shares\` / \`.memory.ballooned\` / \`.memory.swapped\` / \`.memory.granted{type}\` |

Datapoint attributes (\`{...}\` above) are what you filter and group by in monitor criteria: \`direction\` (\`read\`/\`write\`, \`transmitted\`/\`received\`), \`disk_state\` (\`available\`/\`used\`), \`status\` (\`red\`/\`yellow\`/\`green\`/\`gray\`), \`effective\` (\`true\`/\`false\`), \`power_state\` (\`on\`/\`off\`/\`standby\`/\`suspended\`/\`unknown\`), \`object\` (the NIC or disk instance), \`cpu_reservation_type\` (\`total\`/\`used\`) and \`type\`. In OneUptime, resource attributes are \`resource.\`-prefixed (\`resource.vcenter.host.name\`) and datapoint attributes are bare (\`disk_state\`). Units are the receiver's own: MHz for CPU usage and capacity, \`%\` for utilization and CPU readiness, MiB for host/VM/resource-pool memory, bytes for cluster and datacenter memory and all disk space, \`ms\` for disk latency and \`µs\` for vSAN latency.

### VM power state

The receiver does not export a per-VM power-state metric. Instead it emits \`vcenter.vm.cpu.*\` **only for powered-on VMs**, so OneUptime infers the state from what arrived in each collection: a VM that reported CPU metrics is *powered on*; one that reported only memory and disk usage is *powered off* (or suspended — vSphere does not tell them apart here). This is why the shipped \`batch\` processor must stay as it is.

## Shipping ESXi Syslog (optional)

By default the agent ships **metrics only** — the Logs tab of the vCenter dashboard stays empty until you enable a log receiver. The shipped config contains a commented-out \`syslog\` receiver pair (TCP and UDP on port 5514, RFC 3164 — ESXi's native format) wired to a commented \`logs\` pipeline that stamps \`vmware.vcenter.name\` so the logs land on this vCenter.

1. **Uncomment the two \`syslog/*\` receivers and the \`logs\` pipeline** in \`otel-collector-config.yaml\`.
2. **Uncomment the \`ports:\` block** in \`docker-compose.yml\`, then \`docker compose up -d\`. Open the port on the machine's firewall for the ESXi management network.
3. **Point every ESXi host at the agent.** Select the host, open *Configure → System → Advanced System Settings*, set \`Syslog.global.logHost\` to \`udp://<agent-host>:5514\` (or \`tcp://\`), then allow the outbound traffic under *Configure → System → Firewall → Edit → syslog*. Or per host with \`esxcli\`:

\`\`\`bash
esxcli system syslog config set --loghost='udp://<agent-host>:5514'
esxcli system syslog reload
esxcli network firewall ruleset set --ruleset-id=syslog --enabled=true
\`\`\`

## Auto-tag with Project Labels

Any resource attribute prefixed with \`oneuptime.label.\` is promoted to a project Label and attached to the vCenter. Add the attributes to the \`resource\` processor next to \`vmware.vcenter.name\`:

\`\`\`yaml
      - key: oneuptime.label.team
        value: platform
        action: upsert
      - key: oneuptime.label.env
        value: production
        action: upsert
\`\`\`

The vCenter shows up tagged \`team:platform\` and \`env:production\`. Labels added manually in the OneUptime UI are never removed by the agent.

## Upgrading the Agent

\`\`\`bash
cd /opt/oneuptime-vmware-agent
docker compose pull
docker compose up -d
\`\`\`

## Uninstalling the Agent

\`\`\`bash
cd /opt/oneuptime-vmware-agent
docker compose down
\`\`\`

Then remove the \`oneuptime\` user's permission in vCenter if you no longer need it.

## Troubleshooting

### Run the Diagnostic Script First

\`troubleshoot.sh\` checks the whole chain — container runtime, vCenter reachability and credentials, vCenter-name stamping, token shape, collector self-metrics, and a **definitive server-side token validation** (OneUptime's OTLP endpoints return a silent \`200\` on a bad ingestion key, so log inspection alone cannot tell you the key is wrong; the script asks \`GET /otlp/v1/validate\` for a real 200/401 verdict):

\`\`\`bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/VMwareAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-vmware-agent
\`\`\`

### vCenter Shows as Disconnected

1. Check that the agent is running: \`docker compose ps\`
2. Check the agent logs: \`docker compose logs oneuptime-vmware-agent | grep -i error\`
3. Verify your OneUptime URL and ingestion key are correct
4. Ensure the agent machine can reach the OneUptime instance over the network

### No vCenter Appears / No Metrics

1. Check the collector logs: a login error (\`incorrect user name or password\`, \`InvalidLogin\`) means bad credentials — or a password containing \`$\`, \`#\`, spaces or quotes that is not single-quoted in \`.env\` (Docker Compose expands \`$VAR\` and treats a space followed by \`#\` as a comment otherwise), \`x509: certificate signed by unknown authority\` means TLS verification is on against a self-signed certificate (set \`VCENTER_INSECURE_SKIP_VERIFY=true\`), \`connection refused\` / \`no such host\` means a wrong \`VCENTER_ENDPOINT\`.
2. Verify the endpoint is reachable from the agent's network (the collector image is distroless, so test from alongside it): \`docker run --rm --network container:oneuptime-vmware-agent curlimages/curl -sk https://<vcenter-host>/sdk/vimServiceVersions.xml\` — you should see an XML document advertising \`urn:vim25\`.
3. Make sure \`VMWARE_VCENTER_NAME\` is set — discovery keys on the \`vmware.vcenter.name\` resource attribute.

### Hosts Appear but No VMs, Datastores or Clusters

The Read-Only role was granted on the vCenter object without **Propagate to children**, or on a narrower object than the vCenter root. Objects the user cannot see are silently absent. Fix the permission on the top-level vCenter object with propagation enabled; the next collection fills in the inventory.

### Large Inventories

Each collection is a full walk of the inventory plus one performance query per object batch. For vCenters with thousands of VMs raise \`VCENTER_COLLECTION_INTERVAL\` to \`5m\` or \`10m\` (a collection that takes longer than the interval is skipped, not overlapped), match \`max_query_metrics\` to your vCenter's \`vpxd.stats.maxQueryMetrics\` if the log reports \`The maximum number of performance metrics per query exceeded\`, and raise \`limit_mib\` if the memory limiter reports dropped data.

### vCenter Appears Under the Wrong Name

The vCenter identity comes from \`VMWARE_VCENTER_NAME\`. Update the \`.env\` file and restart the agent — note that a new name registers a new vCenter.
`;
}
