# OneUptime VMware Agent

Monitor VMware vSphere — vCenter, ESXi hosts, virtual machines, datastores, clusters, resource pools and vSAN — with OneUptime using a pre-configured OpenTelemetry Collector.

The agent is config-only: a stock `otel/opentelemetry-collector-contrib` container whose native [`vcenter` receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/vcenterreceiver) polls the vSphere SDK with a read-only user, stamps the data with your vCenter identity, and ships it to OneUptime over OTLP. No exporter sidecar, no plugin on vCenter, no agent inside the VMs: a full install is one `.env` file and one `docker compose up`.

Prefer not to run Docker? The same collector — the upstream `otelcol-contrib` release this agent pins, with the same config — runs as a systemd service on any Linux machine: see [Quick Start — Without Docker](#quick-start--without-docker).

One agent monitors one vSphere endpoint — a **vCenter Server** (the normal case, covering every datacenter, cluster and host it manages) or a **standalone ESXi host** that is not managed by a vCenter. Run one agent per vCenter.

Next to the collector, `docker-compose.yml` also runs the **OneUptime AI agent** (`oneuptime-vmware-ai-agent`), which lets OneUptime AI look at this vCenter with `govc` while it investigates an incident or alert. It is read-only unless you allow fixes; see [OneUptime AI agent](#oneuptime-ai-agent).

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin — or, for the [install without Docker](#quick-start--without-docker), a Linux machine (x86_64 or arm64) with systemd 235 or later — on any machine that can reach vCenter over HTTPS (TCP 443)
- vCenter Server / ESXi **7.0 or later** (the receiver supports vSphere 7 and 8)
- A vSphere user holding the built-in **Read-Only** role, propagated from the top-level vCenter object (see below)
- A **OneUptime Telemetry Ingestion Key** — create one from *Project Settings → Telemetry Ingestion Keys*

### Creating the read-only vSphere user

The agent only ever reads: inventory, performance counters and vSAN statistics. Give it a dedicated account with the built-in **Read-Only** role — never an administrator.

**Via the vSphere Client:**

1. Create the account: *Menu → Administration → Single Sign On → Users and Groups*, pick the `vsphere.local` domain (or your identity source), **Add** a user such as `oneuptime` and set a password. This yields the principal `oneuptime@vsphere.local`.
2. Grant the role: select the top-level **vCenter Server** object in the *Hosts and Clusters* inventory, open the **Permissions** tab, click **Add**, choose the user, set the role to **Read-Only**, and tick **Propagate to children**.

Propagation is the part people miss. The receiver walks datacenters → clusters → hosts → VMs → datastores → resource pools, and every object the user cannot see is silently absent from the metrics — a Read-Only role granted on the vCenter object *without* propagation yields an inventory with nothing in it and a dashboard full of zeros.

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

For a **standalone ESXi host** (no vCenter), create the user under *Host → Manage → Security & Users → Users* in the ESXi Host Client and assign the Read-Only role under *Host → Manage → Security & Users → Permissions* (or `esxcli system account add` followed by `esxcli system permission set --id oneuptime --role ReadOnly`).

### Where to run the agent

The agent talks to vCenter over HTTPS, so it does not have to live anywhere near it — and ideally it should not run **on** the vCenter Server Appliance or inside a VM on the very cluster it watches: if that cluster goes down, your monitoring goes down with it. A small management VM on separate hardware, a monitoring host, or any Docker-capable machine — or, without Docker, any Linux machine with systemd — with a route to vCenter on TCP 443 is the right home. (The optional syslog listener needs the ESXi hosts to reach the agent on the syslog port too — see [Shipping ESXi syslog](#shipping-esxi-syslog-optional).)

## Quick Start — Install Script

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/install.sh -o install.sh
bash install.sh
```

The script prompts for your OneUptime URL, telemetry ingestion key, a stable vCenter name, the vCenter endpoint and the read-only credentials (the password is read without echo), installs to `/opt/oneuptime-vmware-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Values are quoted for Docker Compose as they are written, so a password containing `$`, `#`, spaces or quotes works exactly as typed, and re-running the script reuses everything in an existing `.env` instead of prompting again.

## Quick Start — Docker Compose

Download `docker-compose.yml` and `otel-collector-config.yaml` from this directory into a folder, then create a `.env` file next to them (`chmod 600 .env` — it holds a password):

```bash
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_TELEMETRY_INGESTION_KEY=your-telemetry-ingestion-key
VMWARE_VCENTER_NAME=prod-vcenter
VCENTER_ENDPOINT=https://vcsa.example.com
VCENTER_USERNAME=oneuptime@vsphere.local
VCENTER_PASSWORD=a-strong-password
VCENTER_INSECURE_SKIP_VERIFY=true
VCENTER_COLLECTION_INTERVAL=2m
```

Then start the agent:

```bash
docker compose up -d
```

After the first collection (about one `VCENTER_COLLECTION_INTERVAL`) the vCenter appears automatically in the **VMware** section of OneUptime, with its datacenters, clusters, ESXi hosts, virtual machines, datastores and resource pools inventoried.

## Quick Start — Without Docker

The agent does not need Docker: it is one OpenTelemetry Collector binary and one config file. On a Linux machine (x86_64 or arm64) with systemd 235 or later — Ubuntu 18.04, Debian 10, RHEL 8 or newer — run the upstream `otelcol-contrib` release this agent pins, with the same `otel-collector-config.yaml`, as a systemd service. The unit, [`systemd/oneuptime-vmware-agent-native.service`](systemd/oneuptime-vmware-agent-native.service), runs the collector as a throwaway unprivileged user (`DynamicUser=yes`) with no capabilities and nothing it can write to.

Download the collector, the config and the unit, and install them to `/opt/oneuptime-vmware-agent`:

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

The settings go in `/opt/oneuptime-vmware-agent/.env` — the variables of the Docker install's `.env`. It holds a password, so make it readable by root alone before you open it:

```bash
sudo touch /opt/oneuptime-vmware-agent/.env
sudo chmod 600 /opt/oneuptime-vmware-agent/.env
sudoedit /opt/oneuptime-vmware-agent/.env
```

Put this in it:

```bash
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_TELEMETRY_INGESTION_KEY=your-telemetry-ingestion-key
VMWARE_VCENTER_NAME=prod-vcenter
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

Check it with `systemctl status oneuptime-vmware-agent` and `sudo journalctl -u oneuptime-vmware-agent -f` — look for `Everything is ready. Begin running and processing data.` — and give it one collection interval.

This install runs the collector alone: the [OneUptime AI agent](#oneuptime-ai-agent) ships only as a container image. Run one agent per vCenter — if you are moving off the Docker install, `docker compose down` it first, or every metric arrives twice.

## Environment Variables

Docker Compose reads these from the `.env` next to `docker-compose.yml`; the install without Docker from `/opt/oneuptime-vmware-agent/.env`, whose systemd unit supplies the same defaults.

| Variable | Required | Description |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key (*Project Settings → Telemetry Ingestion Keys*) |
| `VMWARE_VCENTER_NAME` | Yes | The name this vCenter registers under in OneUptime. Stamped on every metric as the `vmware.vcenter.name` resource attribute. Keep it stable — changing it registers a new vCenter (default: `vmware-vcenter`) |
| `VCENTER_ENDPOINT` | Yes | Scheme + host of vCenter Server or a standalone ESXi host, **without** `/sdk`, e.g. `https://vcsa.example.com` |
| `VCENTER_USERNAME` | Yes | vSphere user with the Read-Only role, e.g. `oneuptime@vsphere.local` (or `DOMAIN\user` for an AD identity source) |
| `VCENTER_PASSWORD` | Yes | That user's password. If it contains `$`, `#`, spaces or quotes, single-quote it in `.env` (`install.sh` does this for you) — see Troubleshooting; without Docker, double-quote it instead (see [Quick Start — Without Docker](#quick-start--without-docker)) |
| `VCENTER_INSECURE_SKIP_VERIFY` | No | `true` to accept vCenter's default self-signed (VMCA) certificate; `false` keeps TLS verification on (default: `false`) |
| `VCENTER_COLLECTION_INTERVAL` | No | How often the whole inventory is polled. Raise to `5m` or `10m` for very large vCenters (default: `2m`) |

## Collected Metrics

Every `VCENTER_COLLECTION_INTERVAL` the receiver walks the full vSphere inventory and emits one OpenTelemetry resource per object. Identity lives in **resource attributes** — `vcenter.datacenter.name`, `vcenter.cluster.name`, `vcenter.host.name`, `vcenter.vm.name` / `vcenter.vm.id`, `vcenter.datastore.name`, `vcenter.resource_pool.name` / `vcenter.resource_pool.inventory_path` — and the agent adds `vmware.vcenter.name` on top so OneUptime can route everything to your vCenter.

| vSphere object | Identity (resource attributes) | Metrics |
|---|---|---|
| **Datacenter** | `vcenter.datacenter.name` | `vcenter.datacenter.cluster.count{status}`, `.host.count{status,power_state}`, `.vm.count{status,power_state}`, `.datastore.count`, `.disk.space{disk_state}`, `.cpu.limit`, `.memory.limit` |
| **Cluster** | + `vcenter.cluster.name` | `vcenter.cluster.cpu.effective`, `.cpu.limit`, `.memory.effective`, `.memory.limit`, `.host.count{effective}`, `.vm.count{power_state}`, `.vm_template.count`, `vcenter.cluster.vsan.*` (throughput, operations, latency, congestions) |
| **ESXi host** | + `vcenter.host.name` (and `vcenter.cluster.name` when clustered) | `vcenter.host.cpu.usage` / `.capacity` / `.utilization` / `.reserved{cpu_reservation_type}`, `.memory.usage` / `.utilization` / `.capacity`, `.disk.latency.avg{direction,object}` / `.latency.max{object}` / `.throughput{direction,object}`, `.network.usage{object}` / `.throughput{direction,object}` / `.packet.rate` / `.packet.drop.rate` / `.packet.error.rate`, `vcenter.host.vsan.*` |
| **Virtual machine** | + `vcenter.host.name`, `vcenter.vm.name`, `vcenter.vm.id` (instance UUID); `vcenter.resource_pool.*` or `vcenter.virtual_app.*` | `vcenter.vm.disk.usage{disk_state}`, `.disk.utilization`, `.memory.usage` / `.utilization` / `.ballooned` / `.swapped` / `.swapped_ssd`; **powered-on VMs only:** `.cpu.usage`, `.cpu.readiness`, `.cpu.utilization`, `.disk.latency.avg` / `.latency.max` / `.throughput`, `.network.*`, `vcenter.vm.vsan.*` |
| **VM template** | `vcenter.vm_template.name`, `vcenter.vm_template.id` | `vcenter.vm.disk.usage{disk_state}` only |
| **Datastore** | + `vcenter.datastore.name` | `vcenter.datastore.disk.usage{disk_state}`, `.disk.utilization` |
| **Resource pool** | + `vcenter.resource_pool.name`, `vcenter.resource_pool.inventory_path` | `vcenter.resource_pool.cpu.usage` / `.cpu.shares`, `.memory.usage{type}` / `.memory.shares` / `.memory.ballooned` / `.memory.swapped` / `.memory.granted{type}` |

Datapoint attributes (`{...}` above) are exactly what you filter and group by in OneUptime: `direction` (`read`/`write`, `transmitted`/`received`), `disk_state` (`available`/`used`), `status` (`red`/`yellow`/`green`/`gray`), `effective` (`true`/`false`), `power_state` (`on`/`off`/`standby`/`suspended`/`unknown`), `object` (the NIC or disk instance), `cpu_reservation_type` (`total`/`used`) and `type`. Units are the receiver's own: MHz for CPU usage and capacity, `%` for utilization and CPU readiness, MiB for host/VM/resource-pool memory, bytes for cluster and datacenter memory and all disk space, `ms` for disk latency and `µs` for vSAN latency.

`vcenter.host.memory.capacity` is off by default upstream; the shipped config turns it on because OneUptime uses it as the denominator for host memory utilisation. A comment in `otel-collector-config.yaml` lists the remaining optional metrics (`vcenter.vm.cpu.time`, `vcenter.vm.memory.granted`, `vcenter.host.memory.active` / `.ballooned` / `.granted`, `vcenter.vm.network.broadcast.packet.rate` / `.multicast.packet.rate`) if you want them.

### VM power state

The receiver does not export a per-VM power-state metric. Instead it emits `vcenter.vm.cpu.*` **only for powered-on VMs**, so OneUptime infers the state from what arrived in each collection: a VM that reported CPU metrics is *powered on*; one that reported only memory and disk usage is *powered off* (or suspended — vSphere does not tell them apart here). This inference reads a **whole collection at a time**, which is why the shipped `batch` processor has a large `send_batch_size` and deliberately no `send_batch_max_size`: a collection split across two exports would zero inventory counts and flip VMs to "off". Keep the batch settings as shipped.

## Shipping ESXi syslog (optional)

By default the agent ships **metrics only** — the Logs tab of the vCenter dashboard stays empty until you enable a log receiver. ESXi hosts (and vCenter itself) can forward their syslog to any listener, and the shipped config contains a commented-out `syslog` receiver pair (TCP and UDP on port 5514, RFC 3164 — ESXi's native format) wired to a commented `logs` pipeline that stamps `vmware.vcenter.name` so the logs land on your vCenter.

To enable it:

1. **Uncomment the two `syslog/*` receivers and the `logs` pipeline** in `otel-collector-config.yaml`.
2. **Uncomment the `ports:` block** in `docker-compose.yml` so the host publishes `5514/tcp` and `5514/udp`, then `docker compose up -d`. Without Docker there is no port to publish — the collector listens on the machine itself — so run `sudo systemctl restart oneuptime-vmware-agent` instead. Open the port on the machine's firewall for the ESXi management network.
3. **Point every ESXi host at the agent.** In the vSphere Client select the host, open *Configure → System → Advanced System Settings*, edit `Syslog.global.logHost` and set it to `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`; several targets can be comma-separated). Then allow the outbound traffic under *Configure → System → Firewall → Edit → syslog*. Or in one line per host with `esxcli`:

   ```bash
   esxcli system syslog config set --loghost='udp://<agent-host>:5514'
   esxcli system syslog reload
   esxcli network firewall ruleset set --ruleset-id=syslog --enabled=true
   ```

   With PowerCLI across a whole cluster: `Get-VMHost | Get-AdvancedSetting -Name Syslog.global.logHost | Set-AdvancedSetting -Value 'udp://<agent-host>:5514' -Confirm:$false`.

The syslog receiver honours only one transport per receiver, which is why TCP and UDP are separate named receivers — leave either commented if you only need one. If you prefer TLS syslog (`ssl://`), terminate it in front of the agent; the receiver itself speaks plain TCP/UDP.

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

## OneUptime AI agent

The `oneuptime-vmware-ai-agent` service (image `oneuptime/resource-ai-agent`) runs the `govc` commands OneUptime AI asks for, so an investigation can check a VM's power state, the host it runs on, recent events and tasks, and performance counters on this vCenter — and, only if you allow it, apply a fix such as powering a VM back on. It shares the collector's `.env`: it logs in with **its own** vCenter credentials from there (OneUptime never sends it any) and registers as the vCenter named `VMWARE_VCENTER_NAME`, the same one the collector reports into. It appears on that vCenter's **AI → AI agent** page in OneUptime, where you also choose whether OneUptime AI proposes fixes and whether a person approves each one.

It runs as UID 1000 with a read-only root filesystem and no capabilities, and only talks HTTPS to vCenter and to OneUptime. If you do not use OneUptime AI, delete the `oneuptime-vmware-ai-agent` service from `docker-compose.yml`.

The install without Docker has no AI agent: it ships only as a container image. To add one to such an install, run it with Docker on any machine that can reach vCenter — download `docker-compose.yml` into a folder, write a `.env` next to it with the settings of `/opt/oneuptime-vmware-agent/.env`, single-quoted as Docker Compose wants them, and start the AI agent alone with `docker compose up -d oneuptime-vmware-ai-agent` (not the collector, which already runs; two collectors report every metric twice).

### What it may run

Every command is checked by the same policy three times — by OneUptime's AI tools, when OneUptime queues it, and by the agent right before it starts `govc` (never through a shell):

| Kind | Commands | When it runs |
|---|---|---|
| **Read** | `govc about`, `ls`, `find`, `vm.info`, `host.info`, `host.service.ls`, `host.date.info`, `datastore.info`, `pool.info`, `events`, `tasks`, `metric.ls`, `metric.sample`, `object.collect` (runtime and health properties only), `tags.ls`, `version` | Investigations, always |
| **Safe fix** | `govc vm.power -on /DC/vm/FOLDER/VM`, `govc vm.power -r /DC/vm/FOLDER/VM` (graceful guest reboot through VMware Tools), one VM at a time, named by its inventory path | Only with `ONEUPTIME_AI_ALLOW_WRITES=true`; can run unattended in *Automatic* mode |
| **Risky fix** | `govc vm.power -s` (guest shutdown), `-off`, `-reset`, `-suspend`, a power operation on several VMs or on a bare VM name (govc acts on every VM with that name), `govc host.maintenance.exit HOST` (the host's name, never a path) | Only with `ONEUPTIME_AI_ALLOW_WRITES=true`; a person approves it unless your settings say otherwise |
| **Always a person** | `govc vm.migrate`, `govc host.maintenance.enter HOST` | Only with `ONEUPTIME_AI_ALLOW_WRITES=true`, and always after a person approves |
| **Never** | Anything else: guest operations (`guest.*`), creating, cloning, changing or destroying VMs, snapshots, devices and disks, datastore file access, `esxcli`, host add/remove/reboot, permissions, roles, sessions, licenses, `govc env`, a VM's `extraConfig` (`vm.info -e`, `-json`), and the endpoint, credential, TLS and debug flags (`-u`, `-k`, `-cert`, `-debug`, `-dump`, ...) | — |

Secrets `govc` prints (guestinfo values such as cloud-init user data, session ids, anything that looks like a password or token) are masked before the output leaves the agent.

### Allowing fixes

1. Create a vSphere user for OneUptime AI's fixes and a role with the privileges the fixes need — powering VMs on and off and resetting them; add `Host.Config.Maintenance` only if you want maintenance-mode fixes, and `Resource.HotMigrate` / `Resource.ColdMigrate` for migrations. Grant the built-in **Read-Only** role on the top-level vCenter object (propagated) so the user sees the inventory, and the fixes role only where fixes are allowed:

   ```bash
   govc role.create OneUptimeAIFixes VirtualMachine.Interact.PowerOn VirtualMachine.Interact.PowerOff VirtualMachine.Interact.Reset VirtualMachine.Interact.Suspend
   govc sso.user.create -p 'a-strong-password' oneuptime-ai
   govc permissions.set -principal oneuptime-ai@vsphere.local -role ReadOnly -propagate=true /
   govc permissions.set -principal oneuptime-ai@vsphere.local -role OneUptimeAIFixes -propagate=true /DC/vm/production
   ```

2. Add to `.env` and run `docker compose up -d`:

   ```bash
   ONEUPTIME_AI_ALLOW_WRITES=true
   ONEUPTIME_AI_VCENTER_USERNAME=oneuptime-ai@vsphere.local
   ONEUPTIME_AI_VCENTER_PASSWORD='a-strong-password'
   # Recommended: the VM this agent runs on, if it runs inside this vCenter, and
   # the vCenter appliance's VM when it is not named after VCENTER_ENDPOINT's host.
   ONEUPTIME_AI_PROTECTED_TARGETS=monitoring-vm-01
   ```

3. On the vCenter's **AI → AI agent** page in OneUptime, choose how fixes are applied (*Ask for approval*, *Automatic* or *Bypass approval*).

Without `ONEUPTIME_AI_VCENTER_USERNAME` the agent uses `VCENTER_USERNAME` for everything; with the collector's Read-Only user, vCenter itself then refuses every fix (and the agent's message lists the privileges the role needs). `install.sh` asks about fixes on a fresh install and writes these settings for you.

The agent **never** changes the VM named after the host in `VCENTER_ENDPOINT` (`vcsa` for `https://vcsa.example.com`, or the full host name) — normally the vCenter appliance itself — nor anything in `ONEUPTIME_AI_PROTECTED_TARGETS`, whatever inventory path a command names it by (`vcsa` and `/DC/vm/infra/vcsa` are the same VM). It knows the appliance by that name only: when `VCENTER_ENDPOINT` is an IP address (the agent then warns at start-up), or the appliance's VM has another name, put that VM's name in `ONEUPTIME_AI_PROTECTED_TARGETS`, or nothing stops a fix from rebooting the vCenter. To restrict fixes to certain VMs or hosts, set `ONEUPTIME_AI_WRITE_TARGETS`: its globs are matched against each name exactly as the command writes it, so list both forms when you use paths (`web-*,/DC/vm/web/*`).

### AI agent settings

These go in the same `.env`; the agent also reads `VMWARE_VCENTER_NAME`, `VCENTER_ENDPOINT`, `VCENTER_USERNAME`, `VCENTER_PASSWORD` and `VCENTER_INSECURE_SKIP_VERIFY` from the collector's settings above.

| Variable | Default | Description |
|---|---|---|
| `ONEUPTIME_AI_ALLOW_WRITES` | `false` | `true` lets OneUptime AI apply fixes. Anything else keeps the agent read-only |
| `ONEUPTIME_AI_VCENTER_USERNAME` / `ONEUPTIME_AI_VCENTER_PASSWORD` | — | The vSphere user the agent logs in as instead of `VCENTER_USERNAME` / `VCENTER_PASSWORD` — one whose role allows the fixes. Set both or neither |
| `ONEUPTIME_AI_WRITE_TARGETS` | all | Comma-separated globs of the VMs and hosts fixes may touch. Empty means any, except the protected ones |
| `ONEUPTIME_AI_PROTECTED_TARGETS` | — | Comma-separated names (or globs) of VMs and hosts OneUptime AI must never change, on top of the VM named after `VCENTER_ENDPOINT`'s host. List the vCenter appliance's VM here when the endpoint is an IP address or the VM is named otherwise |
| `VCENTER_CA_FILE` | — | Path, inside the agent's container, of a PEM file with the CA that signed vCenter's certificate (its VMCA root, from `https://<vcenter>/certs/download.zip`). Mount it with the commented `volumes:` lines of the service. Lets you keep `VCENTER_INSECURE_SKIP_VERIFY=false` with vCenter's own certificate |
| `GOVC_DATACENTER` | — | The datacenter commands use when they name none; set it when this vCenter has more than one |

### Troubleshooting the AI agent

```bash
docker logs --tail 100 oneuptime-vmware-ai-agent
docker exec oneuptime-vmware-ai-agent wget -qO- http://127.0.0.1:3877/status
```

`/status` shows whether the agent is registered, which vCenter it serves, the vCenter version it last saw and, if it cannot reach vCenter, why.

| What you see | What to do |
|---|---|
| `vCenter rejected the agent's login` | Check the user (full principal, e.g. `oneuptime@vsphere.local`) and password the message names, how the password is quoted in `.env`, and that the account is not locked. |
| `The agent does not trust vCenter's TLS certificate` | Set `VCENTER_CA_FILE` to a mounted copy of vCenter's CA, or `VCENTER_INSECURE_SKIP_VERIFY=true` on a private management network. |
| `VCENTER_ENDPOINT ... is a plain http:// address` | Use `https://`: the agent never sends its password unencrypted. |
| `... this agent is read-only` | Set `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and `docker compose up -d`. |
| `... may not make this change: give the user ... a role with VirtualMachine.Interact...` | Grant the fixes role to `ONEUPTIME_AI_VCENTER_USERNAME` on those VMs (see [Allowing fixes](#allowing-fixes)). |
| `... which the VMware AI agent protects` | The VM is named after `VCENTER_ENDPOINT`'s host or is in `ONEUPTIME_AI_PROTECTED_TARGETS`; leave that change to a person. |
| `This vCenter has more than one datacenter` | Set `GOVC_DATACENTER`, or OneUptime AI names objects by their full path. |
| `Killed (timeout ...): govc produced no output at all` | vCenter is unreachable from the agent: check `VCENTER_ENDPOINT` and the network to it on TCP 443. |

## Run as a systemd Service

To survive reboots without relying on Docker's restart policy alone, install the provided unit:

```bash
sudo cp systemd/oneuptime-vmware-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-vmware-agent
```

The unit assumes the agent lives in `/opt/oneuptime-vmware-agent` (the install script default). It wraps Docker Compose; the [install without Docker](#quick-start--without-docker) is a systemd service already, with its own unit, `systemd/oneuptime-vmware-agent-native.service`.

## Upgrading

The collector image is pinned in `docker-compose.yml`, and `otel-collector-config.yaml` reports that pin to OneUptime as the agent's version (`oneuptime.agent.version`). When a newer OneUptime release pins a newer collector, a warning sign appears beside the **Agent Version** on the vCenter's page; select it to see these commands.

Re-run `install.sh`: it reuses every value in your existing `.env` (nothing is prompted for again), refreshes `docker-compose.yml` and `otel-collector-config.yaml`, and recreates the agent so the collector reads its new config.

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/install.sh -o install.sh
bash install.sh
```

Installed it with Docker Compose instead? Download both files again, then pull and recreate the agent (re-apply any change you made to the two files):

```bash
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/otel-collector-config.yaml
docker compose pull
docker compose up -d --force-recreate
```

Installed it without Docker? Run the install commands again — they download the release this agent pins with the latest `otel-collector-config.yaml` and unit, and keep your `.env` (re-apply any change you made to the config) — then restart the service:

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

An agent installed before its config reported a version shows none until it is upgraded this way.

## Uninstalling

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

Then remove the `oneuptime` user's permission in vCenter (and the OneUptime AI fixes user's, if you created one) if you no longer need it.

## Troubleshooting

### Run the doctor script first

`troubleshoot.sh` checks the whole chain — container runtime, vCenter reachability and credentials, vCenter-name stamping, token shape, collector self-metrics, and a **definitive server-side token validation**. The last one matters most: OneUptime's OTLP endpoints refuse a bad ingestion key with `401` (`422` for a disabled key or a browser key), and the collector drops each refused batch with a single `Exporting failed` log line that is easy to miss. The script asks `GET <url>/otlp/v1/validate` from inside the agent's network namespace for a direct 200/401 verdict, and probes `<VCENTER_ENDPOINT>/sdk/vimServiceVersions.xml` the same way so DNS, firewall and TLS failures show up exactly as the collector hits them:

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh                 # add -d <dir> if you installed outside /opt/oneuptime-vmware-agent
```

### Installed without Docker

`troubleshoot.sh` needs Docker. Without it the collector runs on the machine itself, so check the same chain directly:

```bash
# The service, and the collector's log
systemctl status oneuptime-vmware-agent --no-pager
sudo journalctl -u oneuptime-vmware-agent -n 100 --no-pager

# vCenter's SDK, on the collector's own network path (-k mirrors VCENTER_INSECURE_SKIP_VERIFY=true)
curl -sk https://<vcenter-host>/sdk/vimServiceVersions.xml

# Whether OneUptime accepts the ingestion key: "valid":true with "keyType":"Server"
curl -s -H "x-oneuptime-token: <key>" https://<oneuptime-host>/otlp/v1/validate

# The collector's own counters, on 127.0.0.1:8890 rather than 8888 (the unit says why)
curl -s http://127.0.0.1:8890/metrics | grep -E 'otelcol_(receiver_accepted|exporter_sent|exporter_send_failed)_metric_points'
```

The log reads like the container's (below). A service that keeps restarting logs why: `Failed with result 'resources'` means systemd cannot read `/opt/oneuptime-vmware-agent/.env`, and `cannot unmarshal the configuration` or `requires positive value` means a value in it is not one the collector takes. systemd reads `.env` with rules of its own, and older versions (RHEL 8's, for one) drop a backslash even inside single quotes: keep the user name and password in double quotes, with each `\` written `\\` and each `"` written `\"`, the one form every version reads as typed. And since the collector trusts the machine's CA store, you can keep TLS verification on: add vCenter's root certificate — the `.0` files under `certs/lin/` in `https://<vcenter>/certs/download.zip` — to `/usr/local/share/ca-certificates/` (with a `.crt` name) and run `update-ca-certificates` on Debian and Ubuntu, or to `/etc/pki/ca-trust/source/anchors/` and run `update-ca-trust` on RHEL, then restart the service.

### No vCenter appears in OneUptime

1. Check the collector logs: `docker logs oneuptime-vmware-agent` — a login error (`incorrect user name or password`, `InvalidLogin`) means bad credentials, `x509: certificate signed by unknown authority` means TLS verification is on against a self-signed certificate, `connection refused` / `no such host` means a wrong `VCENTER_ENDPOINT`, and export `401`s mean a bad ingestion key.
2. Verify the endpoint is reachable from the agent's network (the collector image is distroless, so test from alongside it): `docker run --rm --network container:oneuptime-vmware-agent curlimages/curl -sk https://<vcenter-host>/sdk/vimServiceVersions.xml` — you should see an XML document advertising `urn:vim25`.
3. Make sure `VMWARE_VCENTER_NAME` is set — discovery keys on the `vmware.vcenter.name` resource attribute.
4. Give it one collection interval: nothing is sent until the first full inventory walk completes.

### `x509` / TLS errors

vCenter appliances present a certificate issued by their own VMCA, which no Docker image trusts. Either set `VCENTER_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network) or replace vCenter's machine certificate with one issued by a CA the collector image trusts. Do **not** point the endpoint at an `http://` URL — vCenter only serves the SDK over HTTPS.

### vCenter rejects the login (401 / `InvalidLogin`)

Use the full principal — `oneuptime@vsphere.local`, or `DOMAIN\user` / `user@domain.example` for an Active Directory identity source — and check how the password is written in `.env`. Docker Compose v2 expands `$VAR` references in unquoted and double-quoted values and treats a space followed by `#` as the start of a comment, so a password containing `$`, `#`, spaces or quotes must be **single-quoted** — `VCENTER_PASSWORD='p@ss$word'` — which is what `install.sh` writes; a password that itself contains a single quote goes in double quotes with every `$` written as `$$` and `"` / `\` escaped with a backslash. A locked account (too many failed attempts) rejects a correct password too; check *Administration → Single Sign On → Users and Groups*.

### Hosts appear but no VMs, datastores or clusters (`NoPermission`)

The Read-Only role was granted on the vCenter object without **Propagate to children**, or on a narrower object than the vCenter root. Objects the user cannot see are silently absent. Fix the permission on the top-level vCenter object with propagation enabled; the next collection fills in the inventory.

### Large inventories: slow collections, `vpxd.stats.maxQueryMetrics` errors

Each collection is a full walk of the inventory plus one performance query per object batch. For vCenters with thousands of VMs:

- Raise `VCENTER_COLLECTION_INTERVAL` to `5m` or `10m`. A collection that takes longer than the interval is skipped, not overlapped, so a too-short interval simply yields gaps.
- The receiver asks for up to `max_query_metrics: 256` entities per performance query. vCenter caps this server-side with `vpxd.stats.maxQueryMetrics` (default 256 in vCenter 7/8). If a vCenter administrator lowered that setting, you will see `The maximum number of performance metrics per query exceeded` in the collector log — lower `max_query_metrics` in `otel-collector-config.yaml` to match, or raise the vCenter setting under *vCenter → Configure → Advanced Settings*.
- Watch the collector's memory: the shipped `memory_limiter` allows 512 MiB. If the log reports the limiter dropping data, raise `limit_mib` (and give the container more memory).

### Monitoring a standalone ESXi host (no vCenter)

Point `VCENTER_ENDPOINT` at the host itself (`https://esxi01.example.com`) with a local ESXi user holding the Read-Only role. Everything a single host knows is collected: the host, its VMs, datastores and resource pools. There is no datacenter or cluster object on a standalone host, so those pages stay empty, and the vCenter REST API is absent, so the doctor script reports the credential check as inconclusive (the collector log is authoritative there).

### Common Commands

```bash
# Check agent status
docker compose ps

# View collector logs
docker logs -f oneuptime-vmware-agent

# Reach the vSphere SDK from inside the agent's network namespace
# (-k mirrors VCENTER_INSECURE_SKIP_VERIFY=true; drop it to test TLS trust)
docker run --rm --network container:oneuptime-vmware-agent curlimages/curl -sk https://<vcenter-host>/sdk/vimServiceVersions.xml

# Check the collector's own counters (accepted / sent / failed datapoints)
docker run --rm --network container:oneuptime-vmware-agent curlimages/curl -s http://127.0.0.1:8888/metrics | grep -E 'otelcol_(receiver_accepted|exporter_sent|exporter_send_failed)_metric_points'
```

See the [VMware telemetry docs](https://oneuptime.com/docs/telemetry/vmware) for the full walkthrough and the [VMware monitor docs](https://oneuptime.com/docs/monitor/vmware-monitor) for the metric catalog and alert templates.
