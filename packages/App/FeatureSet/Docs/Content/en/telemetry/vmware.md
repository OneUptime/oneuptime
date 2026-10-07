# OneUptime VMware Agent

## Overview

The OneUptime VMware Agent is a pre-configured OpenTelemetry Collector that monitors VMware vSphere — vCenter Server, ESXi hosts, virtual machines, datastores, clusters, resource pools, and vSAN. It is config-only: a stock `otel/opentelemetry-collector-contrib` container whose native [`vcenter` receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/vcenterreceiver) polls the vSphere SDK with a read-only user, stamps every metric with your vCenter identity, and forwards everything to OneUptime over OTLP. No exporter sidecar, no plugin on vCenter, no agent inside the VMs. One `.env` file, one `docker compose up`. The same Compose file also runs the VMware AI agent beside the collector, for OneUptime AI — see [AI agent](#ai-agent). Prefer not to run Docker? The same collector, with the same config, also runs as a systemd service on any Linux machine — see [Alternative — Without Docker](#alternative-without-docker).

One agent monitors one vSphere endpoint — a **vCenter Server** (the normal case, covering every datacenter, cluster, and host it manages) or a **standalone ESXi host** that is not managed by a vCenter. Run one agent per vCenter.

This page is the **installation guide**. For configuring VMware monitors and alerts on top of the data the agent collects, see [VMware Monitor](/docs/monitor/vmware-monitor).

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin — or, for the [install without Docker](#alternative-without-docker), a Linux machine (x86_64 or arm64) with systemd 235 or later — on any machine that can reach vCenter over HTTPS (TCP 443)
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

The agent talks to vCenter over HTTPS, so it does not have to live anywhere near it — and ideally it should not run **on** the vCenter Server Appliance or inside a VM on the very cluster it watches: if that cluster goes down, your monitoring goes down with it. A small management VM on separate hardware, a monitoring host, or any Docker-capable machine — or, without Docker, any Linux machine with systemd — with a route to vCenter on TCP 443 is the right home. (The optional syslog listener additionally needs the ESXi hosts to reach the agent on the syslog port — see [Ship ESXi Syslog](#optional-ship-esxi-syslog).)

## Quick Start (Install Script)

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/install.sh -o install.sh
bash install.sh
```

The script prompts for your OneUptime URL, telemetry ingestion token, a stable vCenter name, the vCenter endpoint, and the read-only credentials (the password is read without echo), and whether the AI agent may apply fixes (if so, for a vSphere user of its own and the VMs it must never change), installs to `/opt/oneuptime-vmware-agent`, writes a `0600` `.env` file, and starts the agent with Docker Compose. Values are quoted for Docker Compose as they are written, so a password containing `$`, `#`, spaces or quotes works exactly as typed, and re-running the script reuses everything in an existing `.env` instead of prompting again.

## Alternative — Docker Compose

Download the two files from the [VMwareAgent directory](https://github.com/OneUptime/oneuptime/tree/master/agents/VMwareAgent) — `docker-compose.yml` and `otel-collector-config.yaml` — into a folder, then create a `.env` file next to them (`chmod 600 .env` — it holds a password):

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

## Alternative — Without Docker

The agent does not need Docker: it is one OpenTelemetry Collector binary and one config file. On a Linux machine (x86_64 or arm64) with systemd 235 or later — Ubuntu 18.04, Debian 10, RHEL 8, or newer — run the upstream `otelcol-contrib` release the agent pins, with the same `otel-collector-config.yaml`, as a systemd service. The unit the agent ships for it, [`oneuptime-vmware-agent-native.service`](https://github.com/OneUptime/oneuptime/blob/master/agents/VMwareAgent/systemd/oneuptime-vmware-agent-native.service), runs the collector as a throwaway unprivileged user with no capabilities and nothing it can write to.

Download the collector, the config, and the unit, and install them to `/opt/oneuptime-vmware-agent`:

```bash
cd "$(mktemp -d)"
VERSION=0.161.0   # the collector release the agent pins
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
curl -fL -o otelcol-contrib.tar.gz \
  https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.tar.gz
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/otel-collector-config.yaml
curl -fsSL -o oneuptime-vmware-agent.service \
  https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/systemd/oneuptime-vmware-agent-native.service

sudo install -d -m 0755 /opt/oneuptime-vmware-agent
sudo tar --no-same-owner --preserve-permissions -xzf otelcol-contrib.tar.gz -C /opt/oneuptime-vmware-agent otelcol-contrib
sudo install -m 0644 otel-collector-config.yaml /opt/oneuptime-vmware-agent/otel-collector-config.yaml
sudo install -m 0644 oneuptime-vmware-agent.service /etc/systemd/system/oneuptime-vmware-agent.service
```

The settings go in `/opt/oneuptime-vmware-agent/.env` — the same variables as the Docker install's `.env`. It holds a password, so make it readable by root alone before you open it:

```bash
sudo touch /opt/oneuptime-vmware-agent/.env
sudo chmod 600 /opt/oneuptime-vmware-agent/.env
sudoedit /opt/oneuptime-vmware-agent/.env
```

Put this in it:

```bash
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
VMWARE_VCENTER_NAME=my-vcenter
VCENTER_ENDPOINT=https://vcsa.example.com
VCENTER_USERNAME="oneuptime@vsphere.local"
VCENTER_PASSWORD="a-strong-password"
VCENTER_INSECURE_SKIP_VERIFY=true
VCENTER_COLLECTION_INTERVAL=2m
```

systemd reads this file, not a shell: keep the user name and the password in double quotes, with each `\` written `\\` and each `"` written `\"` — `DOMAIN\user` is `"DOMAIN\\user"` — while `$`, `#`, `'` and spaces go in as they are. That is the form every systemd version reads the same; older ones (RHEL 8's, for one) drop a backslash even inside single quotes. Then start the agent, and have it start on every boot:

```bash
sudo systemctl daemon-reload
sudo systemctl enable oneuptime-vmware-agent
sudo systemctl restart oneuptime-vmware-agent
```

The vCenter appears after the first collection, as with Docker. This install runs the collector alone: the [AI agent](#ai-agent) ships only as a container image. Run one agent per vCenter — if you are moving off the Docker install, `docker compose down` it first, or every metric arrives twice.

## Environment Variables

Docker Compose reads these from the `.env` next to `docker-compose.yml`; the install without Docker reads them from `/opt/oneuptime-vmware-agent/.env`, and its systemd unit supplies the same defaults.

| Variable                            | Required | Description                                                                                                                                                                                                       |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`                     | Yes      | Your OneUptime instance URL (for example `https://oneuptime.com` or your self-hosted host)                                                                                                                        |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes      | Telemetry ingestion token from _Project Settings → Telemetry & APM → Ingestion Keys_                                                                                                                              |
| `VMWARE_VCENTER_NAME`               | Yes      | The name this vCenter registers under in OneUptime, stamped on every metric as the `vmware.vcenter.name` resource attribute. Keep it stable — changing it later registers a second vCenter. Defaults to `vmware-vcenter` |
| `VCENTER_ENDPOINT`                  | Yes      | Scheme + host of vCenter Server or a standalone ESXi host, **without** `/sdk`, e.g. `https://vcsa.example.com`                                                                                                    |
| `VCENTER_USERNAME`                  | Yes      | vSphere user with the Read-Only role, e.g. `oneuptime@vsphere.local` (or `DOMAIN\user` for an Active Directory identity source)                                                                                   |
| `VCENTER_PASSWORD`                  | Yes      | That user's password. If it contains `$`, `#`, spaces or quotes, single-quote it in `.env` (`install.sh` does this for you) — see Troubleshooting; without Docker, double-quote it instead (see [Alternative — Without Docker](#alternative-without-docker))                                                                                                                                                                                              |
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

Installed it without Docker? Check the service and its log instead:

```bash
systemctl status oneuptime-vmware-agent --no-pager
sudo journalctl -u oneuptime-vmware-agent -f
```

Nothing is exported until the first full inventory walk completes, so give it one collection interval (2 minutes by default); the vCenter then appears in the OneUptime dashboard with metrics flowing.

![The vCenter overview showing datacenter, cluster, ESXi host, virtual machine and datastore counts alongside host CPU, host memory, datastore usage and VM CPU ready](/docs/static/images/VMwareVCenterOverview.png)

The overview answers "is this vCenter healthy" first: effective hosts, capacity-weighted host CPU and memory, the fullest datastore, and the worst VM CPU ready time. When something is degraded it names the object responsible rather than making you go looking.

### ESXi hosts

![The Hosts page listing every ESXi host with its cluster, datacenter, CPU and memory utilization](/docs/static/images/VMwareHosts.png)

### Virtual machines

![The Virtual Machines page listing every VM with its host, power state, cluster, resource pool, CPU ready, CPU and memory](/docs/static/images/VMwareVirtualMachines.png)

Powered-off virtual machines and templates are listed too. vCenter only reports CPU counters for powered-on VMs, so their CPU columns read N/A rather than a misleading zero.

### Datastores

![The Datastores page listing each datastore with used and total capacity and a utilization bar](/docs/static/images/VMwareDatastores.png)

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
2. **Uncomment the `ports:` block** in `docker-compose.yml` so the host publishes `5514/tcp` and `5514/udp`, then `docker compose up -d`. Without Docker there is no port to publish — the collector listens on the machine itself — so run `sudo systemctl restart oneuptime-vmware-agent` instead. Open the port on the machine's firewall for the ESXi management network.
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

The collector reads its config only when it starts: run `docker compose restart oneuptime-vmware-agent`, or `sudo systemctl restart oneuptime-vmware-agent` without Docker. The vCenter shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated; labels added manually in the OneUptime UI are never removed by the agent.

## Run as a systemd Service

```bash
sudo cp systemd/oneuptime-vmware-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-vmware-agent
```

The unit assumes the agent lives in `/opt/oneuptime-vmware-agent` (the install script default). It wraps Docker Compose; the [install without Docker](#alternative-without-docker) is a systemd service already, with a unit of its own.

## Upgrading the Agent

The agent reports the collector version its files pin as its **Agent Version**. When that is older than the version this OneUptime release pins, a warning sign appears beside it on the vCenter's **Overview** and in the **vCenters** list. Select it to see these commands. An agent installed before its files reported a version shows none until it is upgraded this way.

The collector image is pinned in `docker-compose.yml` and its config is a file next to it, so pulling alone does not move the agent forward. Re-run `install.sh`: it reuses every value in your existing `.env` (nothing is prompted for again), refreshes `docker-compose.yml` and `otel-collector-config.yaml`, and recreates the agent so the collector reads its new config.

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/install.sh -o install.sh
bash install.sh
```

Installed it with Docker Compose instead? In the agent's folder, download both files again (re-apply any change you made to them), then pull the images and recreate the agent:

```bash
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/otel-collector-config.yaml
docker compose pull
docker compose up -d --force-recreate
```

Installed it without Docker? Run the install commands again — they download the release this OneUptime pins with the latest `otel-collector-config.yaml` and unit, and keep your `.env` (re-apply any change you made to the config) — then restart the service:

```bash
cd "$(mktemp -d)"
VERSION=0.161.0   # the collector release the agent pins
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
curl -fL -o otelcol-contrib.tar.gz \
  https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.tar.gz
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/otel-collector-config.yaml
curl -fsSL -o oneuptime-vmware-agent.service \
  https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/systemd/oneuptime-vmware-agent-native.service

sudo install -d -m 0755 /opt/oneuptime-vmware-agent
sudo tar --no-same-owner --preserve-permissions -xzf otelcol-contrib.tar.gz -C /opt/oneuptime-vmware-agent otelcol-contrib
sudo install -m 0644 otel-collector-config.yaml /opt/oneuptime-vmware-agent/otel-collector-config.yaml
sudo install -m 0644 oneuptime-vmware-agent.service /etc/systemd/system/oneuptime-vmware-agent.service
sudo systemctl daemon-reload
sudo systemctl restart oneuptime-vmware-agent
```

## Uninstalling the Agent

```bash
cd /opt/oneuptime-vmware-agent
docker compose down
```

Without Docker:

```bash
sudo systemctl disable --now oneuptime-vmware-agent
sudo rm /etc/systemd/system/oneuptime-vmware-agent.service
sudo systemctl daemon-reload
sudo rm -r /opt/oneuptime-vmware-agent
```

Then remove the `oneuptime` user's permission in vCenter if you no longer need it, and the AI agent's own user if you created one.

## Self-hosted OneUptime

If you are self-hosting OneUptime, set `ONEUPTIME_URL` to your own instance:

```bash
ONEUPTIME_URL=https://your-oneuptime-host.example.com
```

If your instance is HTTP-only, use `http://` and the appropriate port.

## Troubleshooting

### Run the diagnostic script first

The agent ships with a doctor script, [`troubleshoot.sh`](https://github.com/OneUptime/oneuptime/blob/master/agents/VMwareAgent/troubleshoot.sh), that checks the whole chain: container runtime, vCenter reachability and credentials, vCenter-name stamping, ingestion-token shape, collector self-metrics, and a **definitive server-side token validation**. The token check is the important one — OneUptime's OTLP endpoints refuse a bad ingestion token with `401` (`422` for a disabled key or a browser key), and the collector treats both as permanent: it drops the batch and logs one `Exporting failed` error for it, which is easy to miss while the container itself stays healthy. The script calls `GET <url>/otlp/v1/validate` from inside the agent's network namespace to get a direct `200` (valid) / `401` (invalid) verdict, falling back to `POST /fluentd/v1/logs` on older servers, and probes `<VCENTER_ENDPOINT>/sdk/vimServiceVersions.xml` the same way so DNS, firewall, and TLS failures show up exactly as the collector hits them.

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-vmware-agent
```

It ends with a VERDICT section naming the most likely root cause. The sections below cover the same ground manually.

### Installed without Docker

The diagnostic script needs Docker. Without it the collector runs on the machine itself, so check the same chain directly — the service and its log, vCenter's SDK on the collector's own network path, whether OneUptime accepts the ingestion key (`"valid":true` with `"keyType":"Server"`), and the collector's own counters, which it serves on `127.0.0.1:8890` rather than `8888` so it can run beside another collector:

```bash
systemctl status oneuptime-vmware-agent --no-pager
sudo journalctl -u oneuptime-vmware-agent -n 100 --no-pager
curl -sk https://<vcenter-host>/sdk/vimServiceVersions.xml
curl -s -H "x-oneuptime-token: <key>" https://<oneuptime-host>/otlp/v1/validate
curl -s http://127.0.0.1:8890/metrics | grep -E 'otelcol_(receiver_accepted|exporter_sent|exporter_send_failed)_metric_points'
```

The log reads like the container's, so the sections below apply. A service that keeps restarting logs why: `Failed with result 'resources'` means systemd cannot read `/opt/oneuptime-vmware-agent/.env`, and `cannot unmarshal the configuration` or `requires positive value` means a value in it is not one the collector takes. systemd reads `.env` with rules of its own, and older versions (RHEL 8's, for one) drop a backslash even inside single quotes: keep the user name and password in double quotes, with each `\` written `\\` and each `"` written `\"`, the one form every version reads as typed. And since the collector trusts the machine's CA store, you can keep TLS verification on: add vCenter's root certificate — the `.0` files under `certs/lin/` in `https://<vcenter>/certs/download.zip` — to `/usr/local/share/ca-certificates/` (with a `.crt` name) and run `update-ca-certificates` on Debian and Ubuntu, or to `/etc/pki/ca-trust/source/anchors/` and run `update-ca-trust` on RHEL, then restart the service.

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

## AI agent

The agent's `docker-compose.yml` also runs the **VMware AI agent**, `oneuptime-vmware-ai-agent` (image `oneuptime/resource-ai-agent:release`). While OneUptime AI investigates an incident or alert on this vCenter it runs read-only `govc` commands through it — `govc vm.info web-01`, `govc events -n 50 /DC/vm/web-01`, `govc metric.sample -n 12 /DC/vm/web-01 cpu.usage.average` — and, only if you allow it, applies fixes such as powering a VM back on. It registers as the vCenter named `VMWARE_VCENTER_NAME`, like the collector, and shows up on the vCenter's **AI → AI agent** page in OneUptime.

- **AI investigations are on by default.** Once the agent connects, OneUptime AI investigates incidents and alerts on this vCenter with it, and the vCenter's **Overview** shows the agent's status. To stop, set `ONEUPTIME_AI_INVESTIGATION=false` where the agent runs (**Change** under **What AI may do** on the AI agent page shows how), or leave the agent out.
- **The vSphere role is the hard limit.** Investigations log in as the collector's **Read-Only** user (`VCENTER_USERNAME` / `VCENTER_PASSWORD`), which can read and nothing else. Fixes need a user of the AI agent's own whose role may power VMs on, off and reset them (`VirtualMachine.Interact.PowerOn`, `PowerOff` and `Reset`), granted only on the folders AI may fix and set as `ONEUPTIME_AI_VCENTER_USERNAME` / `ONEUPTIME_AI_VCENTER_PASSWORD`.
- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`; `ONEUPTIME_AI_WRITE_TARGETS` (VM and host names or inventory paths) limits what a fix may touch. It never changes the VM named after the host in `VCENTER_ENDPOINT` — normally the vCenter appliance — and knows the appliance by that name only: when `VCENTER_ENDPOINT` is an IP address, or the appliance's VM has another name, put that VM in `ONEUPTIME_AI_PROTECTED_TARGETS`, with the VM the agent runs on. `ONEUPTIME_AI_FIXES` in the same `.env` says how fixes run — `ask-for-approval` (a person approves each one), `automatic` or `bypass-approval` — and the AI agent page shows it read-only ([What AI may do, set by the agent](/docs/ai/infrastructure-ai-agents#what-ai-may-do-set-by-the-agent)).
- To verify vCenter's certificate instead of skipping verification, mount its CA into the container and set `VCENTER_CA_FILE`; on a vCenter with several datacenters, set `GOVC_DATACENTER`.
- It runs as UID 1000 with no capabilities, and never runs guest operations, snapshots, `esxcli` or anything that creates or destroys a VM. Delete the `oneuptime-vmware-ai-agent` service from `docker-compose.yml` if you do not use OneUptime AI.
- The [install without Docker](#alternative-without-docker) has no AI agent: it ships only as a container image. To add one, run it with Docker on any machine that can reach vCenter — download `docker-compose.yml`, write a `.env` next to it with the settings of `/opt/oneuptime-vmware-agent/.env`, single-quoted as Docker Compose wants them, and start the AI agent alone with `docker compose up -d oneuptime-vmware-ai-agent` (not the collector, which already runs).

What it may run, how fixes work and how to troubleshoot it: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#vmware-vcenter). The agent's README has the exact commands for the fixes role.

## Next steps

- Configure **VMware Monitors** to alert on host, virtual machine, datastore, cluster, datacenter, and vSAN conditions — see [VMware Monitor](/docs/monitor/vmware-monitor).
- For the OS-level view inside individual VMs or of the agent machine itself, use the [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
