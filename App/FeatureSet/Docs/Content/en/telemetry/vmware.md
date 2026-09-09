# OneUptime VMware Agent

## Overview

The OneUptime VMware Agent is a pre-configured OpenTelemetry Collector that monitors VMware vSphere — vCenter Server, ESXi hosts, virtual machines, datastores, clusters, resource pools, and vSAN. It is config-only: a stock `otel/opentelemetry-collector-contrib` container whose native [`vcenter` receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/vcenterreceiver) polls the vSphere SDK with a read-only user, stamps every metric with your vCenter identity, and forwards everything to OneUptime over OTLP. No exporter sidecar, no plugin on vCenter, no agent inside the VMs. One `.env` file, one `docker compose up`.

One agent monitors one vSphere endpoint — a **vCenter Server** (the normal case, covering every datacenter, cluster, and host it manages) or a **standalone ESXi host** that is not managed by a vCenter. Run one agent per vCenter.

This page is the **installation guide**. For configuring VMware monitors and alerts on top of the data the agent collects, see [VMware Monitor](/docs/monitor/vmware-monitor).

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on any machine that can reach vCenter over HTTPS (TCP 443)
- vCenter Server / ESXi **7.0 or later** (the receiver supports vSphere 7 and 8)
- A vSphere user holding the built-in **Read-Only** role, propagated from the top-level vCenter object (see below)
- A **OneUptime Telemetry Ingestion Token** — create one from _Project Settings → Telemetry & APM → Ingestion Keys_ and copy the value

### Create the Read-Only vSphere User

The agent only ever reads: inventory, performance counters, and vSAN statistics. Give it a dedicated account with the built-in **Read-Only** role — never an administrator.

**Via the vSphere Client:**

1. Create the account: _Menu → Administration → Single Sign On → Users and Groups_, pick the `vsphere.local` domain (or your identity source), click **Add**, name the user `oneuptime`, and set a password. This yields the principal `oneuptime@vsphere.local`.
2. Grant the role: select the top-level **vCenter Server** object in the _Hosts and Clusters_ inventory, open the **Permissions** tab, click **Add**, choose the user, set the role to **Read-Only**, and tick **Propagate to children**.

Propagation is the part people miss. The receiver walks datacenters → clusters → hosts → VMs → datastores → resource pools, and every object the user cannot see is silently absent from the metrics — a Read-Only role granted on the vCenter object _without_ propagation yields an inventory with nothing in it and a dashboard full of zeros.

**Or with `govc`** (from a machine with administrator credentials):

```bash
govc sso.user.create -p 'a-strong-password' -R ReadOnly oneuptime
govc permissions.set -principal oneuptime@vsphere.local -role ReadOnly -propagate=true /
```

**Or with PowerCLI:**

```powershell
New-SsoPersonUser -UserName oneuptime -Password 'a-strong-password'
New-VIPermission -Entity (Get-Folder -NoRecursion) -Principal 'VSPHERE.LOCAL\oneuptime' -Role ReadOnly -Propagate:$true
```

For a **standalone ESXi host** (no vCenter), create the user under _Host → Manage → Security & Users → Users_ in the ESXi Host Client and assign the Read-Only role under _Host → Manage → Security & Users → Permissions_ (or `esxcli system account add` followed by `esxcli system permission set --id oneuptime --role ReadOnly`).

### Where to Run the Agent

The agent talks to vCenter over HTTPS, so it does not have to live anywhere near it — and ideally it should not run **on** the vCenter Server Appliance or inside a VM on the very cluster it watches: if that cluster goes down, your monitoring goes down with it. A small management VM on separate hardware, a monitoring host, or any Docker-capable machine with a route to vCenter on TCP 443 is the right home. (The optional syslog listener additionally needs the ESXi hosts to reach the agent on the syslog port — see [Ship ESXi Syslog](#optional-ship-esxi-syslog).)

## Quick Start (Install Script)

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/VMwareAgent/install.sh -o install.sh
bash install.sh
```

The script prompts for your OneUptime URL, telemetry ingestion token, a stable vCenter name, the vCenter endpoint, and the read-only credentials (the password is read without echo), installs to `/opt/oneuptime-vmware-agent`, writes a `0600` `.env` file, and starts the agent with Docker Compose. Values are quoted for Docker Compose as they are written, so a password containing `$`, `#`, spaces or quotes works exactly as typed, and re-running the script reuses everything in an existing `.env` instead of prompting again.

## Alternative — Docker Compose

Download the two files from the [VMwareAgent directory](https://github.com/OneUptime/oneuptime/tree/master/VMwareAgent) — `docker-compose.yml` and `otel-collector-config.yaml` — into a folder, then create a `.env` file next to them (`chmod 600 .env` — it holds a password):

```bash
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
VMWARE_VCENTER_NAME=my-vcenter
VCENTER_ENDPOINT=https://vcsa.example.com
VCENTER_USERNAME=oneuptime@vsphere.local
VCENTER_PASSWORD=a-strong-password
VCENTER_INSECURE_SKIP_VERIFY=true
VCENTER_COLLECTION_INTERVAL=2m
```

Start it:

```bash
docker compose up -d
```

That is it. After the first collection (about one `VCENTER_COLLECTION_INTERVAL`) the vCenter appears automatically in the **VMware** section of the OneUptime dashboard, with its datacenters, clusters, ESXi hosts, virtual machines, datastores, and resource pools inventoried.

## Environment Variables

| Variable                            | Required | Description                                                                                                                                                                                                       |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`                     | Yes      | Your OneUptime instance URL (for example `https://oneuptime.com` or your self-hosted host)                                                                                                                        |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes      | Telemetry ingestion token from _Project Settings → Telemetry & APM → Ingestion Keys_                                                                                                                              |
| `VMWARE_VCENTER_NAME`               | Yes      | The name this vCenter registers under in OneUptime, stamped on every metric as the `vmware.vcenter.name` resource attribute. Keep it stable — changing it later registers a second vCenter. Defaults to `vmware-vcenter` |
| `VCENTER_ENDPOINT`                  | Yes      | Scheme + host of vCenter Server or a standalone ESXi host, **without** `/sdk`, e.g. `https://vcsa.example.com`                                                                                                    |
| `VCENTER_USERNAME`                  | Yes      | vSphere user with the Read-Only role, e.g. `oneuptime@vsphere.local` (or `DOMAIN\user` for an Active Directory identity source)                                                                                   |
| `VCENTER_PASSWORD`                  | Yes      | That user's password. If it contains `$`, `#`, spaces or quotes, single-quote it in `.env` (`install.sh` does this for you) — see Troubleshooting                                                                                                                                                                                              |
| `VCENTER_INSECURE_SKIP_VERIFY`      | No       | `true` to accept vCenter's default self-signed (VMCA) certificate; `false` keeps TLS verification on. Defaults to `false`                                                                                          |
| `VCENTER_COLLECTION_INTERVAL`       | No       | How often the whole inventory is polled. Raise to `5m` or `10m` for very large vCenters. Defaults to `2m`                                                                                                         |

## Verify the Installation

Check that the agent is running:

```bash
docker compose ps
```

Check the collector logs:

```bash
docker logs -f oneuptime-vmware-agent
```

Look for: `"Everything is ready. Begin running and processing data."`

Nothing is exported until the first full inventory walk completes, so give it one collection interval (2 minutes by default); the vCenter then appears in the OneUptime dashboard with metrics flowing.

## What Gets Collected

Every `VCENTER_COLLECTION_INTERVAL` the receiver walks the full vSphere inventory and emits one OpenTelemetry resource per object. Identity lives in **resource attributes** — `vcenter.datacenter.name`, `vcenter.cluster.name`, `vcenter.host.name`, `vcenter.vm.name` / `vcenter.vm.id`, `vcenter.datastore.name`, `vcenter.resource_pool.name` / `vcenter.resource_pool.inventory_path` — and the agent adds `vmware.vcenter.name` on top so OneUptime can route everything to your vCenter:

| vSphere object      | Identity (resource attributes)                                                                                                     | Metrics                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Datacenter**      | `vcenter.datacenter.name`                                                                                                          | `vcenter.datacenter.cluster.count`, `vcenter.datacenter.host.count`, `vcenter.datacenter.vm.count`, `vcenter.datacenter.datastore.count`, `vcenter.datacenter.disk.space`, `vcenter.datacenter.cpu.limit`, `vcenter.datacenter.memory.limit`                                                                                                             |
| **Cluster**         | + `vcenter.cluster.name`                                                                                                           | `vcenter.cluster.cpu.effective`, `vcenter.cluster.cpu.limit`, `vcenter.cluster.memory.effective`, `vcenter.cluster.memory.limit`, `vcenter.cluster.host.count`, `vcenter.cluster.vm.count`, `vcenter.cluster.vm_template.count`, `vcenter.cluster.vsan.*` (throughput, operations, latency, congestions)                                               |
| **ESXi host**       | + `vcenter.host.name` (and `vcenter.cluster.name` when the host is in a cluster)                                                   | `vcenter.host.cpu.usage` / `.capacity` / `.utilization` / `.reserved`, `vcenter.host.memory.usage` / `.utilization` / `.capacity`, `vcenter.host.disk.latency.avg` / `.latency.max` / `.throughput`, `vcenter.host.network.usage` / `.throughput` / `.packet.rate` / `.packet.drop.rate` / `.packet.error.rate`, `vcenter.host.vsan.*`                   |
| **Virtual machine** | + `vcenter.host.name`, `vcenter.vm.name`, `vcenter.vm.id` (instance UUID); `vcenter.resource_pool.*` or `vcenter.virtual_app.*`   | `vcenter.vm.disk.usage`, `vcenter.vm.disk.utilization`, `vcenter.vm.memory.usage` / `.utilization` / `.ballooned` / `.swapped` / `.swapped_ssd`; **powered-on VMs only:** `vcenter.vm.cpu.usage`, `vcenter.vm.cpu.readiness`, `vcenter.vm.cpu.utilization`, `vcenter.vm.disk.latency.avg` / `.latency.max` / `.throughput`, `vcenter.vm.network.*`, `vcenter.vm.vsan.*` |
| **VM template**     | `vcenter.vm_template.name`, `vcenter.vm_template.id`                                                                               | `vcenter.vm.disk.usage` only                                                                                                                                                                                                                                                                                                                            |
| **Datastore**       | + `vcenter.datastore.name`                                                                                                         | `vcenter.datastore.disk.usage`, `vcenter.datastore.disk.utilization`                                                                                                                                                                                                                                                                                    |
| **Resource pool**   | + `vcenter.resource_pool.name`, `vcenter.resource_pool.inventory_path`                                                             | `vcenter.resource_pool.cpu.usage` / `.cpu.shares`, `vcenter.resource_pool.memory.usage` / `.memory.shares` / `.memory.ballooned` / `.memory.swapped` / `.memory.granted`                                                                                                                                                                                 |

Count and capacity metrics fan out over **datapoint attributes**, which are exactly what you filter and group by in OneUptime monitor criteria:

| Attribute              | Values                                                                              | Carried by                                                         |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `direction`            | `read` / `write` for disk, `transmitted` / `received` for network                   | disk latency & throughput, network throughput & packet rates       |
| `disk_state`           | `available` / `used`                                                                | `vcenter.datastore.disk.usage`, `vcenter.vm.disk.usage`, `vcenter.datacenter.disk.space` |
| `status`               | `red` / `yellow` / `green` / `gray` (vSphere's overall status of the object)        | `vcenter.datacenter.cluster.count` / `.host.count` / `.vm.count`   |
| `power_state`          | hosts: `on` / `off` / `standby` / `unknown`; VMs: `on` / `off` / `suspended` / `unknown` | `vcenter.datacenter.host.count` / `.vm.count`, `vcenter.cluster.vm.count` |
| `effective`            | `true` / `false` (stored as strings)                                                | `vcenter.cluster.host.count`                                       |
| `object`               | The NIC, disk, or vCPU instance (e.g. `vmnic0`)                                     | per-device host and VM disk / network series                       |
| `cpu_reservation_type` | `total` / `used`                                                                    | `vcenter.host.cpu.reserved`                                        |
| `type`                 | memory: `guest` / `host` / `overhead`, `private` / `shared`; vSAN: `read` / `write` / `unmap` | resource-pool memory series, vSAN latency & IOPS            |

Units are the receiver's own OTLP unit metadata, so OneUptime rescales them for display: `MHz` for CPU usage and capacity, `%` for utilization and CPU readiness, `MiBy` for host / VM / resource-pool memory, `By` for cluster and datacenter memory and all disk space, `ms` for host and VM disk latency, and `us` (microseconds) for vSAN latency. In ClickHouse — and therefore in monitor criteria — the identity attributes are `resource.`-prefixed (`resource.vcenter.host.name`, `resource.vmware.vcenter.name`) while datapoint attributes stay bare (`disk_state`, `power_state`, `status`).

`vcenter.host.memory.capacity` is off by default upstream; the shipped config turns it on because OneUptime uses it as the denominator for host memory utilization. A comment in `otel-collector-config.yaml` lists the remaining optional metrics (`vcenter.vm.cpu.time`, `vcenter.vm.memory.granted`, `vcenter.host.memory.active`, `vcenter.host.memory.ballooned`, `vcenter.host.memory.granted`, `vcenter.vm.network.broadcast.packet.rate`, `vcenter.vm.network.multicast.packet.rate`) if you want them — enable any of them the same way.

### VM Power State

The receiver does not export a per-VM power-state metric. Instead it emits `vcenter.vm.cpu.*` **only for powered-on VMs**, so OneUptime infers the state from what arrived in each collection: a VM that reported CPU metrics is **Powered on**; one that reported only memory and disk usage is **Powered off** (or suspended — vSphere does not tell them apart here). VM templates carry no power state. This inference reads a **whole collection at a time**, which is why the shipped `batch` processor has a large `send_batch_size` and deliberately no `send_batch_max_size`: a collection split across two exports would zero inventory counts and flip VMs to "off". Keep the batch settings as shipped.

## Optional — Ship ESXi Syslog

By default the agent ships **metrics only**, so the Logs tab of the vCenter dashboard stays empty. ESXi hosts (and vCenter itself) can forward their syslog to any listener, and the shipped `otel-collector-config.yaml` contains a commented-out `syslog` receiver pair (TCP and UDP on port 5514, RFC 3164 — ESXi's native format) wired to a commented `logs` pipeline that stamps `vmware.vcenter.name` so the logs land on your vCenter.

To enable it:

1. **Uncomment the two `syslog/*` receivers and the `logs` pipeline** in `otel-collector-config.yaml`.
2. **Uncomment the `ports:` block** in `docker-compose.yml` so the host publishes `5514/tcp` and `5514/udp`, then `docker compose up -d`. Open the port on the machine's firewall for the ESXi management network.
3. **Point every ESXi host at the agent.** In the vSphere Client select the host, open _Configure → System → Advanced System Settings_, edit `Syslog.global.logHost`, and set it to `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`; several targets can be comma-separated). Then allow the outbound traffic under _Configure → System → Firewall → Edit → syslog_. Or in one line per host with `esxcli`:

   ```bash
   esxcli system syslog config set --loghost='udp://<agent-host>:5514'
   esxcli system syslog reload
   esxcli network firewall ruleset set --ruleset-id=syslog --enabled=true
   ```

   With PowerCLI across a whole cluster: `Get-VMHost | Get-AdvancedSetting -Name Syslog.global.logHost | Set-AdvancedSetting -Value 'udp://<agent-host>:5514' -Confirm:$false`.

The syslog receiver honours only one transport per receiver, which is why TCP and UDP are separate named receivers — leave either commented if you only need one. If you prefer TLS syslog (`ssl://`), terminate it in front of the agent; the receiver itself speaks plain TCP/UDP. Unlike the Proxmox agent's journald path, no custom collector image is needed — the stock image handles syslog.

## Auto-tag with Project Labels

Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the vCenter. Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.

Add the attributes to the `resource` processor in `otel-collector-config.yaml` (next to `vmware.vcenter.name`):

```yaml
processors:
  resource:
    attributes:
      # ...existing attributes...
      - key: oneuptime.label.team
        value: platform
        action: upsert
      - key: oneuptime.label.env
        value: production
        action: upsert
```

The vCenter shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated; labels added manually in the OneUptime UI are never removed by the agent.

## Run as a systemd Service

```bash
sudo cp systemd/oneuptime-vmware-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-vmware-agent
```

The unit assumes the agent lives in `/opt/oneuptime-vmware-agent` (the install script default).

## Upgrading the Agent

```bash
cd /opt/oneuptime-vmware-agent
docker compose pull
docker compose up -d
```

The collector image is pinned in `docker-compose.yml`; when a newer OneUptime release bumps the pin, re-download `docker-compose.yml` and `otel-collector-config.yaml` from the VMwareAgent directory before pulling — or re-run `install.sh`, which reuses every value in your existing `.env` (nothing is prompted for again) and refreshes only those two files.

## Uninstalling the Agent

```bash
cd /opt/oneuptime-vmware-agent
docker compose down
```

Then remove the `oneuptime` user's permission in vCenter if you no longer need it.

## Self-hosted OneUptime

If you are self-hosting OneUptime, set `ONEUPTIME_URL` to your own instance:

```bash
ONEUPTIME_URL=https://your-oneuptime-host.example.com
```

If your instance is HTTP-only, use `http://` and the appropriate port.

## Troubleshooting

### Run the diagnostic script first

The agent ships with a doctor script, [`troubleshoot.sh`](https://github.com/OneUptime/oneuptime/blob/master/VMwareAgent/troubleshoot.sh), that checks the whole chain: container runtime, vCenter reachability and credentials, vCenter-name stamping, ingestion-token shape, collector self-metrics, and a **definitive server-side token validation**. The token check is the important one — OneUptime's OTLP endpoints deliberately return a silent `200` on a bad ingestion token (so a misconfigured collector cannot retry-flood the server), which means the collector logs look clean even when every datapoint is being dropped. The script calls `GET <url>/otlp/v1/validate` from inside the agent's network namespace to get a real `200` (valid) / `401` (invalid) verdict, falling back to `POST /fluentd/v1/logs` on older servers, and probes `<VCENTER_ENDPOINT>/sdk/vimServiceVersions.xml` the same way so DNS, firewall, and TLS failures show up exactly as the collector hits them.

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/VMwareAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-vmware-agent
```

It ends with a VERDICT section naming the most likely root cause. The sections below cover the same ground manually.

### No vCenter appears in OneUptime

1. Check the collector logs: `docker logs oneuptime-vmware-agent` — a login error (`incorrect user name or password`, `InvalidLogin`) means bad credentials, `x509: certificate signed by unknown authority` means TLS verification is on against a self-signed certificate, `connection refused` / `no such host` means a wrong `VCENTER_ENDPOINT`, and a `401` on export means a bad ingestion token.
2. Verify the endpoint is reachable from the agent's network. The collector image is distroless (no shell, no curl), so test from a sibling container in its network namespace: `docker run --rm --network container:oneuptime-vmware-agent curlimages/curl -sk https://<vcenter-host>/sdk/vimServiceVersions.xml` should print an XML document advertising `urn:vim25`.
3. Make sure `VMWARE_VCENTER_NAME` is set — discovery keys on the `vmware.vcenter.name` resource attribute.
4. Give it one collection interval: nothing is sent until the first full inventory walk completes.

### `x509` / TLS errors

vCenter appliances present a certificate issued by their own VMCA, which no Docker image trusts. Either set `VCENTER_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network) or replace vCenter's machine certificate with one issued by a CA the collector image trusts. Do **not** point the endpoint at an `http://` URL — vCenter only serves the SDK over HTTPS.

### vCenter rejects the login (401 / `InvalidLogin`)

Use the full principal — `oneuptime@vsphere.local`, or `DOMAIN\user` / `user@domain.example` for an Active Directory identity source — and check how the password is written in `.env`. Docker Compose v2 expands `$VAR` references in unquoted and double-quoted values and treats a space followed by `#` as the start of a comment, so a password containing `$`, `#`, spaces or quotes must be **single-quoted** — `VCENTER_PASSWORD='p@ss$word'` — which is what `install.sh` writes; a password that itself contains a single quote goes in double quotes with every `$` written as `$$` and `"` / `\` escaped with a backslash. A locked account (too many failed attempts) rejects a correct password too; check _Administration → Single Sign On → Users and Groups_.

### Hosts appear but no VMs, datastores, or clusters (`NoPermission`)

The Read-Only role was granted on the vCenter object without **Propagate to children**, or on a narrower object than the vCenter root. Objects the user cannot see are silently absent. Fix the permission on the top-level vCenter object with propagation enabled; the next collection fills in the inventory.

### Every VM shows as powered off

VM power state is inferred from the presence of `vcenter.vm.cpu.*` datapoints in the same collection as the VM's memory and disk datapoints (see [VM Power State](#vm-power-state)). If you customized the `batch` processor and added a `send_batch_max_size`, a large inventory is split across exports and the CPU datapoints land in a different request from the rest — restore the shipped batch settings.

### Large inventories: slow collections, `vpxd.stats.maxQueryMetrics` errors

Each collection is a full walk of the inventory plus one performance query per object batch. For vCenters with thousands of VMs:

- Raise `VCENTER_COLLECTION_INTERVAL` to `5m` or `10m`. A collection that takes longer than the interval is skipped, not overlapped, so a too-short interval simply yields gaps.
- The receiver asks for up to `max_query_metrics: 256` entities per performance query. vCenter caps this server-side with `vpxd.stats.maxQueryMetrics` (default 256 in vCenter 7/8). If a vCenter administrator lowered that setting, you will see `The maximum number of performance metrics per query exceeded` in the collector log — lower `max_query_metrics` in `otel-collector-config.yaml` to match, or raise the vCenter setting under _vCenter → Configure → Advanced Settings_.
- Watch the collector's memory: the shipped `memory_limiter` allows 512 MiB. If the log reports the limiter dropping data, raise `limit_mib` (and give the container more memory).

### Monitoring a standalone ESXi host (no vCenter)

Point `VCENTER_ENDPOINT` at the host itself (`https://esxi01.example.com`) with a local ESXi user holding the Read-Only role. Everything a single host knows is collected: the host, its VMs, datastores, and resource pools. There is no datacenter or cluster object on a standalone host, so those pages stay empty, and the vCenter REST API is absent, so the doctor script reports the credential check as inconclusive (the collector log is authoritative there).

### Metrics land under the wrong vCenter

OneUptime auto-registers vCenters by `vmware.vcenter.name`, taken from the `VMWARE_VCENTER_NAME` environment variable. Changing it after the first telemetry batch creates a second vCenter row rather than renaming the existing one.

### Sending metrics without the agent

There is no native OTLP push in vSphere — vCenter does not export OpenTelemetry on its own, so the agent (or any OpenTelemetry Collector with the `vcenter` receiver) is the way in. If you already run a collector fleet, you can add the `vcenter` receiver to it instead of running this agent: copy the `vcenter` receiver block and the `resource` processor from the shipped `otel-collector-config.yaml` into your own config. The `vmware.vcenter.name` resource attribute is what registers the vCenter in OneUptime, and the `service.name` / `service.instance.id` deletes keep the data from being routed to a phantom Service — keep both.

## Next steps

- Configure **VMware Monitors** to alert on host, virtual machine, datastore, cluster, datacenter, and vSAN conditions — see [VMware Monitor](/docs/monitor/vmware-monitor).
- For the OS-level view inside individual VMs or of the agent machine itself, use the [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
