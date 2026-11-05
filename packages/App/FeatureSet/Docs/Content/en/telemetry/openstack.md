# OpenStack Agent

The OneUptime OpenStack agent monitors an OpenStack cloud: its services and agents, hypervisors, instances, networks, routers, volumes, storage pools, images and projects, in every region. It reads the cloud's APIs with a credential you choose and sends what it finds to OneUptime, where the cloud appears with its regions, hypervisors and projects. [OpenStack monitors](/docs/monitor/openstack-monitor) alert on what arrives, and a [probe](/docs/telemetry/openstack-agentless) can collect a cloud with nothing to install.

:::cards
- [Probe or agent?](/docs/telemetry/openstack-agentless#probe-or-agent): Which to pick, for a cloud that could use either.
- [Choose how much it sees](#choose-how-much-the-agent-sees): OpenStack has no global read-only role, so there are three levels.
- [Install the agent](#install-the-agent): A credential, then the install script, Docker Compose or no Docker at all.
- [What it costs your cloud](#what-it-costs-your-cloud): What each setting reads, and how to change it.
- [Capacity](#capacity): How many more of each flavor fit, and how many days until each thing is full.
- [Spend](#spend): Who's using what, what that comes to at your prices or as CloudKitty rated it, and what could be reclaimed.
- [Service logs](#service-logs): Parsed, with a request followed across services.
- [Lifecycle events](#lifecycle-events): Instance actions on the feed and on charts, from notifications or a probe.
- [Who did what](#who-did-what): Audit trails into Security Events.
- [Trace a request](#trace-requests-through-the-control-plane): One signed request, followed across the control plane.
- [Check it from outside](#check-the-cloud-from-outside): Whether anyone can actually boot an instance, from a probe outside the cloud.
- [With no internet](#with-no-internet): The agent's four images, and how to copy them to a registry of your own.
- [By deployment tool](/docs/telemetry/openstack-deployment-tools): Kolla-Ansible, OpenStack-Ansible, OpenStack-Helm, Atmosphere, Sunbeam, Red Hat and Mirantis.
- [Troubleshooting](#troubleshooting): A diagnostic script, and the usual problems.
:::

## How it works

The agent is two pinned upstream programs and their configuration, on one machine: [openstack-exporter](https://github.com/openstack-exporter/openstack-exporter) reads the cloud's APIs and turns them into `openstack_*` series, and an OpenTelemetry Collector asks it for one OpenStack service at a time, stamps every series with the cloud and region it came from, and sends them to OneUptime. Nothing runs on your controllers or compute nodes, unless you add the optional [logs profile](#service-logs), which reads their logs.

```mermaid title="From a cloud to OneUptime"
flowchart TB
    apis["Keystone, Nova, Neutron, Cinder,<br/>Glance, Placement"]
    exporter["openstack-exporter"] -->|"reads with<br/>your credential"| apis
    collector["Collector"] -->|"one service at a time,<br/>every 2 or 5 minutes"| exporter
    collector -->|"OTLP"| oneuptime["OneUptime"]
```

The cloud registers itself with its first data, under the name the agent stamps on every metric as `openstack.cloud.name`. One agent watches one cloud: one Keystone, with one region or several.

## Before you begin

- Docker Engine 20.10 or later with the Docker Compose v2 plugin, or, to run without Docker, a Linux machine (x86_64 or arm64) with systemd 235 or later, glibc 2.34 or later (RHEL 9, Ubuntu 22.04, Debian 12) and root.
- A route from that machine to Keystone and to each service's public endpoint.
- The `openstack` command line, as someone who can create the credential below.
- An ingestion key. Create one under **Project Settings → Telemetry & APM → Ingestion Keys** and copy its value.
- Outbound HTTPS from that machine to your OneUptime URL.

### Where to run the agent

Run the agent outside the cloud it watches: a small VM on separate hardware, a management host, another cloud. An agent inside a cloud that has failed goes quiet with it, and quiet looks like a healthy cloud that stopped reporting.

## Choose how much the agent sees

OpenStack has no global read-only role, and that is the hardest thing about monitoring it:

- `reader` is scoped to a project everywhere except Keystone and Ironic.
- Hypervisors, services, agents, pools and Placement default to admin.
- A policy override cannot open all-project lists in Neutron or Cinder, which scope those by admin context in their own code.
- Cinder's services and storage pools answer anything but an admin with a `403`, from Cinder's own code, after policy has already passed. No override opens those either.
- Neutron and Cinder answer a plain reader with a `200` and only that reader's own project. It looks like it worked, and it did not.
- Where Cinder has `enforce_new_defaults` off, which is Cinder's own default, any role on a project can create that project's volumes, including `reader` and `oneuptime_monitoring`. On Epoxy, Flamingo and Gazpacho a plain reader and the role on a real project both created a volume (`202`). On Hibiscus both were refused (`403`), because DevStack only turns `enforce_new_defaults` on there. A read-only role on a real project is not read-only.

So there are three levels, and each one costs something. Start with the first if you can.

| Level | What it needs | What it sees | What goes without |
| --- | --- | --- | --- |
| **1. Full view** | An application credential on an account with `admin` on a project of its own, limited by access rules to reading, with `service_type` set on each service | Every read the agent makes, and `cinder-volume` and `cinder-scheduler` state and storage pools, which only this level sees | Keystone's users and groups, on purpose. It cannot write: every write answered `401` |
| **2. Infrastructure only** | The `oneuptime_monitoring` and `reader` roles on a project of its own that holds nothing and has zero quota, and the policy overrides the agent ships | All of Keystone's projects, domains, services and endpoints, all of Nova including every project's servers, all of Placement, and Neutron's agents and IP availabilities | Neutron's networks, subnets, routers, floating IPs and ports, and Cinder's volumes and snapshots, are only its own project's, so on an empty project just the shared and external ones. No `cinder-volume` or `cinder-scheduler` state or storage pools. It cannot write: every write answered `403`, or `409` and `413` from quota |
| **3. Project view** | Plain `reader` on a real project, for a team watching its own part of a cloud someone else runs | That project's volumes, networks and routers, from Cinder and Neutron | All infrastructure: no hypervisors, services, agents, pools or capacity. Through the agent, no instances either, because the exporter's all-projects read is refused. And on many clouds `reader` can write there |

The **Block Storage Service Down**, **Storage Pool Warning** and **Storage Pool Critical** templates need level 1. **Compute Service Down**, **Network Agent Down** and the Placement and hypervisor templates need level 1 or 2, and nothing at level 3 reads an instance.

### What each level reads

This is what five real clouds answered, on Epoxy, Flamingo, Gazpacho (OVN and OVS) and Hibiscus. Each cell is written from those recordings.

| Read | Level 1: Full view | Level 2: Infrastructure only | Level 3: Project view |
| --- | --- | --- | --- |
| Keystone: projects | all | all | refused |
| Keystone: domains | all | all | refused |
| Keystone: regions | all | what anyone sees | what anyone sees |
| Keystone: services | all | all | refused |
| Keystone: endpoints | all | all | refused |
| Nova: servers, all projects | all | all | refused |
| Nova: services | all | all | refused |
| Nova: hypervisors | all | all | refused |
| Nova: aggregates | all | all | refused |
| Nova: availability zones, detail | all | all | refused |
| Nova: flavors | all | what anyone sees | what anyone sees |
| Nova: usage per project | all | all | refused |
| Placement: resource providers | all | all | refused |
| Neutron: agents | all | all | nothing |
| Neutron: networks | all | own project only | own project only |
| Neutron: subnets | all | own project only | own project only |
| Neutron: routers | all | own project only | own project only |
| Neutron: floating IPs | all | own project only | own project only |
| Neutron: IP availabilities | all | all | nothing |
| Neutron: security groups | all | 409, expected | own project only |
| Neutron: ports | all | own project only | own project only |
| Neutron: quotas | all | refused | refused |
| Cinder: volumes, all projects | all | own project only | own project only |
| Cinder: services | all | refused | refused |
| Cinder: pools | all | refused | refused |
| Cinder: snapshots, all projects | all | own project only | own project only |
| Cinder: backups, all projects | all | none recorded | none recorded |
| Cinder: volume types | all | what anyone sees | what anyone sees |
| Glance: images | all | what anyone sees | what anyone sees |

- **all**: the same rows an admin saw.
- **own project only**: that project's rows, and anything shared or external. On a project that holds nothing, that is just the shared and external ones.
- **refused**: a `401` or a `403`.
- **what anyone sees**: every credential saw every row, on clouds that hold only public flavors, volume types and images. A private one in another project takes level 1.
- **nothing**: a `200` with no rows, on a project that has networks too. It looks like it worked, and it did not.
- **none recorded**: a `200` with no rows where an admin saw none either, so there was nothing to tell by.
- **409, expected**: Neutron tries to create the project's default security group when it lists them, and zero quota does not let it, so it answers `409 Quota exceeded`. That is harmless, and nothing to fix.

Octavia, Ironic, Heat, Magnum, Manila, Designate, Barbican, Swift, Trove and Gnocchi are not here because those clouds do not run them. The [diagnostic script](#troubleshooting) asks them too, where a cloud does, and it reads every path with your real credential and says what that credential can see.

What the agent's exporter got with each, in series per service. The counts follow what a cloud holds when it is asked, so compare them with each other and not with yours:

| Exporter service | Admin | Level 1: Full view | Level 2: Infrastructure only | Level 3: Project view |
| --- | --- | --- | --- | --- |
| identity | 14 | 13 | 13 | 4 |
| compute | 33 | 33 | 33 | 15 |
| placement | 25 | 25 | 25 | 1 |
| network | 36 to 40 | 36 to 40 | 24 to 26 | 14 |
| volume | 33 | 33 to 41 | 23 | 29 to 37 |
| image | 4 | 4 | 4 | 4 |

## Install the agent

Every OneUptime serves the agent's install script and files for its own release: the commands below download them from `https://oneuptime.com`, so on a self-hosted OneUptime replace it with your URL. The install script is saved as `install.sh` first, so you can read it before you run it.

:::steps
### Create the credential

Pick the level you chose. Each makes an application credential, which prints an `id` and a `secret`: the secret is shown only once. Give it an expiry and never `--unrestricted`, which would let it make more credentials.

:::tabs
@tab Level 1: Full view
As an admin, make a project and an account for the agent:

```bash
openstack project create --domain default oneuptime-monitoring
openstack user create --domain default --password-prompt oneuptime-monitoring
openstack role add --project oneuptime-monitoring --user oneuptime-monitoring admin
```

Then, logged in as that account on that project, make the credential. The rules are the exact `GET` paths the agent uses, fitted to your cloud:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/application-credential-access-rules.json
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/access-rules-for-cloud.py
openstack catalog list -f json | python3 access-rules-for-cloud.py \
  application-credential-access-rules.json > access-rules-for-this-cloud.json
openstack application credential create oneuptime-agent \
  --role admin \
  --access-rules "$(cat access-rules-for-this-cloud.json)" \
  --expiration 2027-11-01T00:00:00
```

An access rule is matched against the path the service sees. A service behind a path prefix, like `https://cloud.example/compute/v2.1`, sees `/compute/v2.1/servers`, and refuses the shipped rule for `/v2.1/servers` with a `401`. `access-rules-for-cloud.py` adds each rule again under its service's prefix, read from your catalog.

Two of the exporter's reads take rules that are easy to miss by hand. It reads Octavia's root before anything else, and behind Apache a service sees that as `/load-balancer//`, with two slashes. Refused, the exporter answers an empty `200`, so the cloud looks as if it doesn't run Octavia. And it lists Swift's account with a trailing slash, which `/v1/*` doesn't match. Refused, `openstack_object_store_up` reads `0`. The fitted rules carry both. A credential's rules can't be changed, so if yours was made from an older copy of them, make a new one.

Access rules also need `service_type` set for keystonemiddleware on each service, and a restart of that service. Without it, the service refuses the credential with a `401`:

```ini title="nova.conf"
[keystone_authtoken]
service_type = compute
```

| Config file | `service_type` |
| --- | --- |
| `nova.conf` | `compute` |
| `neutron.conf` | `network` |
| `cinder.conf` | `block-storage`. The rules also carry `volume` and `volumev3`, for a Cinder configured that way |
| `glance-api.conf` | `image` |
| `placement.conf` | `placement` |
| `octavia.conf` | `load-balancer` |
| `ironic.conf` | `baremetal` |
| `heat.conf` | `orchestration` |
| `magnum.conf` | `container-infra` |
| `manila.conf` | `sharev2`. The rules also carry `shared-file-system`, for a Manila configured that way |
| `designate.conf` | `dns` |
| `barbican.conf` | `key-manager` |
| `trove.conf` | `database` |
| `gnocchi.conf` | `metric` |
| `proxy-server.conf`, under `[filter:authtoken]` | `object-store`, and `include_service_catalog = True` beside it. keystonemiddleware checks the rules against the token's catalog, so with `False`, which DevStack sets, Swift answers the credential `500` |

Only the services your cloud runs need a line.

On the services a cloud may not run, what each level got on real clouds differs from the tables above in four ways:

- **Ironic** answers a project's credential, an admin's too, with only the nodes that project owns, and refuses its conductors. Only system scope reads every node and the conductors, and the agent's credential is on a project. To read a node with it, make its project the owner: `openstack baremetal node set --owner`.
- **Swift** lists the credential's own project's containers, and no other. Another project's account answers `403` unless the credential has `ResellerAdmin`.
- **Barbican** answers a credential about its own project alone, and refuses a plain reader. OneUptime reads no secret.
- **Gnocchi** lets any role on a project create a metric, so on a cloud that runs it, level 2 and level 3 can write there.

Keystone needs nothing. With the rules fitted, `service_type` set and the APIs restarted, every read answered `200` and every write `401`, on every release we record. The exporter gets what an admin gets, except Keystone's users and groups, on purpose. That holds on the services a cloud may not run too: recorded on DevStack, level 1 got the same series as an admin's credential from each one the exporter reads, and every write answered `401`.

If you will not make that change, make the same credential without `--access-rules`: a plain admin application credential. It works, and it can write, so the diagnostic script labels it as one.
@tab Level 2: Infrastructure only
As an admin, make the role, a project that holds nothing and has zero quota, and an account:

```bash
openstack role create oneuptime_monitoring
openstack project create --domain default --description "OneUptime monitoring: holds nothing" oneuptime-monitoring
openstack quota set --instances 0 --cores 0 --ram 0 --key-pairs 0 oneuptime-monitoring
openstack quota set --volumes 0 --gigabytes 0 --snapshots 0 --backups 0 --backup-gigabytes 0 oneuptime-monitoring
openstack quota set --networks 0 --subnets 0 --ports 0 --routers 0 --floating-ips 0 --secgroups 0 --secgroup-rules 0 oneuptime-monitoring
openstack user create --domain default --password-prompt oneuptime-monitoring
openstack role add --project oneuptime-monitoring --user oneuptime-monitoring oneuptime_monitoring
openstack role add --project oneuptime-monitoring --user oneuptime-monitoring reader
```

The project holds nothing and has zero quota on purpose. Where Cinder has `enforce_new_defaults` off, any role on a project can create that project's volumes. With nothing to touch and no quota to make anything with, there is nothing for it to write: on every release we record, every write answered `403`, or `409` and `413` from quota.

Download the policy overrides, and merge each file, on every controller, into the file named by `[oslo_policy] policy_file` in that service's config (`nova.conf`, `neutron.conf` and so on). That is `/etc/nova/policy.yaml`, and so on, unless your deployment says otherwise: DevStack says `policy.json`. Each rule keeps the service's default and adds the role, and oslo.policy notices a changed file on its own, so no restart is needed.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/policy/nova.yaml
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/policy/neutron.yaml
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/policy/keystone.yaml
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/policy/placement.yaml
```

There is no file for Cinder. Its `os-services` and `scheduler-stats/get_pools` answer the role with `403 User does not have admin privileges`, on all five releases we record. That comes from Cinder's own code requiring an admin context, after policy has already passed, so no override can open them.

**To take the overrides off again, empty the file (`{}`) and never delete it.** On Flamingo (2025.2) and Epoxy (2025.1), oslo.policy raises on every check once a policy file it has read is gone, so that service fails every request. When the service is Keystone, it stops validating tokens and the whole cloud answers `503`. If it has already happened, restart the service.

Then, logged in as that account on that project, make the credential:

```bash
openstack application credential create oneuptime-agent --expiration 2027-11-01T00:00:00
```

Putting the role on a real project to see its volumes and routers also lets the account write there, on a cloud where Cinder has `enforce_new_defaults` off. The diagnostic script warns when the credential's project holds things.
@tab Level 3: Project view
Give an account the plain `reader` role on the project, then, logged in as that account on that project, make the credential:

```bash
openstack role add --project my-team --user my-monitoring-account reader
openstack application credential create oneuptime-agent --expiration 2027-11-01T00:00:00
```

The agent sees that project's rows from Cinder and Neutron and no infrastructure. Three things to know before you choose this:

- **Through the agent it shows no instances at all.** The exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. Only a OneUptime probe, collecting without this agent, can list one project's instances.
- **It may be able to write.** On a cloud where Cinder has `enforce_new_defaults` off, plain `reader` can create volumes in its project too. On Epoxy, Flamingo and Gazpacho it did (`202`), and on Hibiscus it was refused (`403`), because DevStack only turns `enforce_new_defaults` on there. Cinder's own default is off.
- **Placement reads as not answering.** Every call it makes is refused, and the exporter reports that the way it reports a stopped Placement: `openstack_placement_up 0`, on all five releases we record. The pages can tell, from what else is closed to this credential, and say so. The [Placement API Down](/docs/monitor/openstack-monitor#pre-built-alert-templates) template can't, so leave that one out at this level.
:::

### Install and start the agent

:::tabs
@tab install.sh
Download the install script and run it on the machine that will host the agent:

```bash
curl -fsSL https://oneuptime.com/install/openstack-agent -o install.sh
bash install.sh
```

The script asks for your OneUptime URL, the ingestion key, a stable name for the cloud, the Keystone auth URL, the region names, the application credential (a username and password if you say no to it) and a private CA file if the cloud has its own certificate authority. Nothing secret is echoed or goes on a command line. It checks the credential with Keystone before it writes or starts anything, installs to `/opt/oneuptime-openstack-agent`, or to `oneuptime-openstack-agent` in your home folder if you have no rights on `/opt` (it needs only the `docker` group), writes `.env` and `clouds.yaml` with mode `0600`, and starts the agent with Docker Compose. Every answer also works as an environment variable, and running the script again reuses them instead of asking again, which is how you [upgrade the agent](#upgrading-the-agent).
@tab Docker Compose
Download `docker-compose.yml` and `otel-collector-config.yaml` from your OneUptime into a new folder:

```bash
mkdir oneuptime-openstack-agent && cd oneuptime-openstack-agent
curl -fsSLO https://oneuptime.com/install/openstack-agent/docker-compose.yml
curl -fsSLO https://oneuptime.com/install/openstack-agent/otel-collector-config.yaml
```

Create a `clouds.yaml` next to them, with one entry per region, **named for the region**, because the exporter's series do not say which region they are from and the collector stamps the entry's name on them as `openstack.region.name`:

```yaml title="clouds.yaml"
clouds:
  RegionOne:
    region_name: RegionOne
    identity_api_version: 3
    auth_type: v3applicationcredential
    auth:
      auth_url: https://keystone.example.com:5000/v3
      application_credential_id: your-credential-id
      application_credential_secret: your-credential-secret
```

Then a `.env` file:

```bash title=".env"
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
OPENSTACK_CLOUD_NAME=my-cloud
OPENSTACK_EXPORTER_CLOUDS=[RegionOne,RegionTwo]
COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent
```

`OPENSTACK_EXPORTER_CLOUDS` lists every region, in square brackets, and `COMPOSE_PROFILES` starts the bundled exporter and the [AI agent](#ai-agent). Both files hold secrets. The exporter runs as uid 65532, and must be the one account that can read `clouds.yaml`. Start the agent:

```bash
chmod 600 .env
sudo chown 65532:65532 clouds.yaml
sudo chmod 600 clouds.yaml
docker compose up -d
```
@tab Without Docker
On Linux (x86_64 or arm64) with systemd 235 or later and glibc 2.34 or later, the install script runs the upstream releases of the same two programs as systemd services. RHEL 8 and its relatives have an older glibc, which the exporter's release can't run on: the script says so and changes nothing, so use Docker there.

```bash
curl -fsSL https://oneuptime.com/install/openstack-agent -o install.sh
sudo bash install.sh --without-docker
```

The same questions, the same check with Keystone and the same files. Each release archive is held to a sha256 pinned in `install.sh`, and a download that does not match stops the install before anything changes. The collector runs as a throwaway unprivileged user that never sees the OpenStack credential, and the exporter as the `oneuptime-openstack` system user, the only account that can read `clouds.yaml`, listening on `127.0.0.1:9180` alone.

Run one agent per cloud: moving off a Docker install, run `docker compose down` first, or every metric arrives twice.
:::

Already run openstack-exporter with `--multi-cloud`? Point the agent at it, and the bundled one never starts: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`, or leave `COMPOSE_PROFILES` out of `.env` and set `OPENSTACK_EXPORTER_ADDRESS` there. Its `clouds.yaml` needs an entry named for each region, and it should turn off what the bundled one turns off: see [What it costs your cloud](#what-it-costs-your-cloud). Use an address the agent's container can reach: `localhost` is the container itself.

Kolla-Ansible's exporter runs without `--multi-cloud`, so it has no `/probe`, and it is pinned to a release that says less. [Use the exporter you already run](/docs/telemetry/openstack-deployment-tools#use-the-exporter-you-already-run) says how to read it, and exactly what the pages go without. [OpenStack by Deployment Tool](/docs/telemetry/openstack-deployment-tools) has the rest of each tool's steps.

### Check the agent is running

```bash
cd /opt/oneuptime-openstack-agent    # or the folder the script said it installed to
docker compose ps
docker logs oneuptime-openstack-agent
```

`docker compose ps` lists the collector (`oneuptime-openstack-agent`), the bundled exporter (`oneuptime-openstack-exporter`) and the [AI agent](#ai-agent) (`oneuptime-openstack-ai-agent`). The collector's logs should show this line once it has started:

```text
Everything is ready. Begin running and processing data.
```

Without Docker, ask `systemctl status oneuptime-openstack-agent oneuptime-openstack-exporter` and `journalctl -u oneuptime-openstack-agent`.

### Find the cloud in OneUptime

Open **Products → Infrastructure → OpenStack**. The cloud appears under its `OPENSTACK_CLOUD_NAME` after its first collection, within a few minutes. Compute, network, volume and Placement are read every 2 minutes, identity and images every 5.
:::

## Environment variables

The install script writes these to `/opt/oneuptime-openstack-agent/.env`; a Docker Compose install reads them from the `.env` next to `docker-compose.yml`. After changing one, run `docker compose up -d` in that folder. `clouds.yaml` alone holds the credential.

| Variable | Required | Description |
| --- | --- | --- |
| `ONEUPTIME_URL` | Yes | Your OneUptime URL, such as `https://oneuptime.com` or your self-hosted instance. |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | The ingestion key from **Project Settings → Telemetry & APM → Ingestion Keys**. |
| `OPENSTACK_CLOUD_NAME` | Yes | The cloud's name in OneUptime, stamped on every metric as the `openstack.cloud.name` resource attribute. Keep it stable: changing it registers a new cloud. Defaults to `openstack`. |
| `OPENSTACK_AUTH_URL` | Bundled exporter | An answer to the install script: the Keystone auth URL. `/v3` is added if it is missing. |
| `OPENSTACK_EXPORTER_CLOUDS` | Yes | The regions, in square brackets, such as `[RegionOne,RegionTwo]`, each the name of a `clouds.yaml` entry. Defaults to `[RegionOne]`. |
| `OPENSTACK_EXPORTER_ADDRESS` | No | `host:port`, no scheme, of your own exporter. Leave it out for the bundled one. |
| `OPENSTACK_CA_FILE` | No | A PEM file with the certificate authority of a cloud that has its own. The install script keeps a copy as `ca.pem` next to `clouds.yaml`. |
| `OPENSTACK_EXPORTER_USER` | No | The `uid:gid` the exporter's container runs as, which must own `clouds.yaml`. Defaults to `65532:65532`. |
| `COMPOSE_PROFILES` | Bundled exporter | `openstack-exporter` starts the bundled exporter, and `openstack-ai-agent` the [AI agent](#ai-agent). |
| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | No | The compute nodes to read [real usage](#real-usage) from through `prometheus-libvirt-exporter`, in square brackets, such as `[compute-01:9177,compute-02:9177]`. Defaults to none. |
| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | No | The same through Ceilometer's own exporter, such as `[compute-01:9101]`. Defaults to none. |
| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | No | An exporter already running without `--multi-cloud`, such as Kolla-Ansible's: `[10.0.0.254:9198]`. See [Use the exporter you already run](/docs/telemetry/openstack-deployment-tools#use-the-exporter-you-already-run). |
| `OPENSTACK_RABBITMQ_TARGETS` | No | RabbitMQ's Prometheus plugin on each node, for [what the cloud stands on](#what-the-cloud-stands-on): `[10.0.0.11:15692,10.0.0.12:15692]`. Defaults to none. |
| `OPENSTACK_MARIADB_TARGETS` | No | mysqld_exporter beside each MariaDB node, usually on `9104`. Defaults to none. |
| `OPENSTACK_MEMCACHED_TARGETS` | No | memcached_exporter beside each Memcached, usually on `9150`. Defaults to none. |
| `OPENSTACK_HAPROXY_TARGETS` | No | HAProxy's own Prometheus exporter. Defaults to none. |
| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | No | openstack-network-exporter on each node, for OVN and Open vSwitch, usually on `1981`. Defaults to none. |
| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | No | prometheus-libvirt-exporter on each compute node, usually on `9177`, for whether libvirt answers and nothing per instance. Defaults to none. |
| `OPENSTACK_CONTROL_PLANE_REGION` | No | The region of a target above that does not say its own. A target can: `RegionTwo@10.1.0.11:15692`. Defaults to the first region. |
| `OPENSTACK_AGENT_SERVICES` | No | Which services this agent reads, for [sharing a cloud between agents](/docs/telemetry/openstack-very-large-clouds#sharing-a-cloud-between-collectors), such as `compute\|placement`. Defaults to all of them. |
| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | No | What the collector may hold in memory. A very large cloud's scrape takes more than the default of `512`. |
| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | No | `openstack_database_exporter`, for [the database path](/docs/telemetry/openstack-very-large-clouds#the-database-path): `[openstack-database-exporter:9180]`. Defaults to none. The other settings of that path are listed there. |

The install script also reads the credential from the environment, to skip its questions: `OPENSTACK_APPLICATION_CREDENTIAL_ID` and `OPENSTACK_APPLICATION_CREDENTIAL_SECRET`, or `OPENSTACK_USERNAME`, `OPENSTACK_PASSWORD`, `OPENSTACK_PROJECT_NAME`, `OPENSTACK_USER_DOMAIN_NAME` and `OPENSTACK_PROJECT_DOMAIN_NAME`. They have names of their own rather than the `OS_*` ones an openrc file sets, so an admin's sourced openrc never becomes the agent's credential without anyone being asked. An application credential is better than a username and password: it can be limited to reading and can expire.

## What the cloud stands on

Most OpenStack outages begin underneath it: a RabbitMQ gone, Galera out of quorum, an OVN database with no leader. The agent can read the exporters those already have, every minute, and it is off until you name them. Nothing here writes to any of them, and only a few series of each are kept.

Name each in the agent's `.env`, every member of a cluster, then run `docker compose up -d`:

```bash
OPENSTACK_RABBITMQ_TARGETS=[10.0.0.11:15692,10.0.0.12:15692,10.0.0.13:15692]
OPENSTACK_MARIADB_TARGETS=[10.0.0.11:9104,10.0.0.12:9104,10.0.0.13:9104]
OPENSTACK_MEMCACHED_TARGETS=[10.0.0.11:9150,10.0.0.12:9150]
OPENSTACK_HAPROXY_TARGETS=[10.0.0.11:9101,10.0.0.12:9101]
OPENSTACK_NETWORK_EXPORTER_TARGETS=[10.0.0.21:1981,10.0.0.22:1981,RegionTwo@10.1.0.21:1981]
OPENSTACK_LIBVIRT_HEALTH_TARGETS=[10.0.0.21:9177,10.0.0.22:9177]
OPENSTACK_CONTROL_PLANE_REGION=RegionOne
```

A target can say which region it is in, as the last one in that list does. One that does not is in `OPENSTACK_CONTROL_PLANE_REGION`. On Kolla-Ansible, whose Prometheus already knows all of them, `control-plane-targets.py` prints these lines for you, and [OpenStack by Deployment Tool](/docs/telemetry/openstack-deployment-tools) says where each exporter is on the others.

What each one reads, and what the agent needs of it:

| Setting | Reads | Enable it with |
| --- | --- | --- |
| `OPENSTACK_RABBITMQ_TARGETS` | RabbitMQ's own plugin, `/metrics` and each queue from `/metrics/detailed` | `rabbitmq-plugins enable rabbitmq_prometheus` on each node |
| `OPENSTACK_MARIADB_TARGETS` | mysqld_exporter beside each node. Its defaults already report Galera | Nothing beyond the exporter |
| `OPENSTACK_MEMCACHED_TARGETS` | memcached_exporter beside each Memcached | Nothing beyond the exporter |
| `OPENSTACK_HAPROXY_TARGETS` | HAProxy's own exporter | `http-request use-service prometheus-exporter` on a `frontend` of its own |
| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | openstack-network-exporter on each machine with Open vSwitch or OVN's databases | Its default collectors. A machine reports what it runs |
| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | prometheus-libvirt-exporter on each compute node, and only whether libvirt answers | Nothing beyond the exporter |

Then the cloud's **Control Plane** card has one line for each, and a page per dependency with one line per machine. **Not watched** on that card means you have not named it: it never reads as healthy. Trouble there goes to the cloud's **Needs attention**. The cloud's **Recommendations** page offers [the alert templates](/docs/monitor/openstack-monitor#what-the-cloud-stands-on), and `troubleshoot.sh` checks that each target answers and is what you said it is.

For more of a RabbitMQ or a database than a cloud's health needs, the [Queues](/docs/telemetry/queues) and [Databases](/docs/telemetry/databases) products read them through their own agents, which is more data than this and on its own terms. The Control Plane pages link to them. Installing those is separate, because those products read those agents' series and not these.

Two things to know about openstack-network-exporter 0.3.0, the version these were recorded with:

- **It connects to Open vSwitch's database once.** After Open vSwitch restarts, `ovs_build_info`, its bridges, its interfaces and all of ovn-controller's series stay gone until the exporter restarts too, while Open vSwitch's own series come straight back. **Exporter Lost Open vSwitch's Database** says when that has happened.
- **It reads one OVN database's cluster status on a machine.** That is Southbound where a machine has both sockets, as Kolla-Ansible's have. So Northbound's leader shows only where a machine has no Southbound to read.

## What the agent collects

The collector makes one scrape job per OpenStack service, through the exporter's `/probe?cloud=<region>&include_services=<service>`, so a failing Nova leaves only Nova's series missing:

| Scrape job | Every | Timeout | Series |
| --- | --- | --- | --- |
| `oneuptime-openstack-compute` | 2 minutes | 110 s | `openstack_nova_agent_state`, `openstack_nova_running_vms`, `openstack_nova_vcpus_used`, `openstack_nova_memory_used_bytes`, `openstack_nova_local_storage_used_bytes`, `openstack_nova_total_vms`, `openstack_nova_server_status`, `openstack_nova_flavors`, `openstack_nova_availability_zones` |
| `oneuptime-openstack-network` | 2 minutes | 110 s | `openstack_neutron_agent_state`, `openstack_neutron_networks`, `openstack_neutron_subnets`, `openstack_neutron_routers`, `openstack_neutron_router`, `openstack_neutron_l3_agent_of_router`, `openstack_neutron_floating_ips`, `openstack_neutron_security_groups`, `openstack_neutron_network_ip_availabilities_total`, `openstack_neutron_network_ip_availabilities_used` |
| `oneuptime-openstack-volume` | 2 minutes | 110 s | `openstack_cinder_agent_state`, `openstack_cinder_volumes`, `openstack_cinder_volume_gb`, `openstack_cinder_snapshots`, `openstack_cinder_pool_capacity_free_gb`, `openstack_cinder_pool_capacity_total_gb` |
| `oneuptime-openstack-placement` | 2 minutes | 110 s | `openstack_placement_resource_total`, `openstack_placement_resource_usage`, `openstack_placement_resource_allocation_ratio`, `openstack_placement_resource_reserved` |
| `oneuptime-openstack-identity` | 5 minutes | 120 s | `openstack_identity_projects`, `openstack_identity_project_info`, `openstack_identity_domains`, `openstack_identity_regions` |
| `oneuptime-openstack-image` | 5 minutes | 120 s | `openstack_glance_images`, `openstack_glance_image_bytes`, `openstack_glance_image_created_at` |
| `oneuptime-openstack-load-balancer` | 5 minutes | 120 s | `openstack_loadbalancer_total_loadbalancers`, `openstack_loadbalancer_loadbalancer_status`, `openstack_loadbalancer_total_amphorae`, `openstack_loadbalancer_amphora_status`, `openstack_loadbalancer_total_pools`, `openstack_loadbalancer_pool_status` |
| `oneuptime-openstack-baremetal` | 5 minutes | 120 s | `openstack_ironic_node`, `openstack_ironic_node_updated_at`, `openstack_ironic_node_provision_updated_at` |
| `oneuptime-openstack-orchestration` | 5 minutes | 120 s | `openstack_heat_stack_status`, `openstack_heat_stack_status_counter` |
| `oneuptime-openstack-container-infra` | 5 minutes | 120 s | `openstack_container_infra_total_clusters`, `openstack_container_infra_cluster_masters`, `openstack_container_infra_cluster_nodes`, `openstack_container_infra_cluster_status` |
| `oneuptime-openstack-sharev2` | 5 minutes | 120 s | `openstack_sharev2_shares_counter`, `openstack_sharev2_share_gb`, `openstack_sharev2_share_status`, `openstack_sharev2_share_status_counter` |
| `oneuptime-openstack-dns` | 5 minutes | 120 s | `openstack_designate_zones`, `openstack_designate_zone_status`, `openstack_designate_recordsets`, `openstack_designate_recordsets_status` |
| `oneuptime-openstack-object-store` | 5 minutes | 120 s | `openstack_object_store_objects`, `openstack_object_store_bytes` |
| `oneuptime-openstack-database` | 5 minutes | 120 s | `openstack_trove_total_instances`, `openstack_trove_instance_status`, `openstack_trove_instance_volume_size_gb`, `openstack_trove_instance_volume_used_gb` |
| `oneuptime-openstack-gnocchi` | 5 minutes | 120 s | `openstack_gnocchi_status_metricd_processors`, `openstack_gnocchi_status_metric_having_measures_to_process`, `openstack_gnocchi_status_measures_to_process` |

The last nine are services a cloud may not run. Asked about one that is not in its catalog, the exporter logs in to Keystone, logs one line (`No suitable endpoint could be found in the service catalog`) and answers with nothing, and that cloud shows no trace of the service. It is one login each 5 minutes per service and region, which is why these are all 5 minutes. To ask only for the services you run, set `OPENSTACK_AGENT_SERVICES`, such as `identity|compute|placement|network|volume|image`.

Each service also reports `openstack_<service>_up`, such as `openstack_nova_up`. The [OpenStack monitor](/docs/monitor/openstack-monitor#collected-metrics) lists every series with what it means. Every series carries:

| Attribute | What it says |
| --- | --- |
| `openstack.cloud.name` | The cloud's name, a resource attribute |
| `oneuptime.agent.version` | The collector version the agent's files pin, a resource attribute |
| `openstack.region.name` | The region, from the name of the `clouds.yaml` entry, on each datapoint |
| `openstack_service` | The job's OpenStack service (`compute`, `network`, ...), on each datapoint |

Monitor filters match on equality, so keep the `transform/openstack-identity` processor if you customize the config, and the two deletes of `service.name` and `service.instance.id` in the `resource` processor: without the deletes the data registers a phantom Service instead of reaching the cloud.

## What it costs your cloud

Monitoring must never be what takes a cloud down, so the defaults are gentle. Each scrape logs in to Keystone again and makes real API calls. [Very Large OpenStack Clouds](/docs/telemetry/openstack-very-large-clouds) has what that comes to, in requests a minute and gigabytes a day, at each size.

| Setting | Default | Turning it on or changing it gives you | What it costs |
| --- | --- | --- | --- |
| Project quotas | Off | How much of each quota a project has used, on its page and under **Needs attention**, and the Project Quota Nearly Reached alert | Four API calls per project, per region, once an hour (Nova one, Cinder two, Neutron one), from an exporter of their own |
| Slow metrics | Off | Nova's own quota lists and usage per server | One call per project per scrape, so it grows with the number of projects |
| Per-port series | Off | `openstack_neutron_port`, `openstack_neutron_ports`, `openstack_neutron_ports_no_ips`, `openstack_neutron_ports_lb_not_active` | An unscoped list of every port. On a large cloud that [can saturate Neutron and cause cascading failures](https://github.com/openstack-exporter/openstack-exporter/issues/540), so leave it off unless you know your port count is small |
| Services a cloud may not run | On | Load balancers, bare metal, stacks, clusters, shares, DNS, object storage, databases and Gnocchi, where the cloud has them | A cloud without one pays one login each 5 minutes. Designate costs one call per zone per scrape, so it grows with the number of zones |
| Scrape intervals | 2 and 5 minutes | Fresher data, or less load | Twice as often is twice the API calls. Keep each `scrape_timeout` under its `scrape_interval`, so a slow scrape never stacks on the one before |

**Project quotas:** run `install.sh` again with `OPENSTACK_COLLECT_QUOTAS=true`. It starts a second exporter, `openstack-quota-exporter`, that reads nothing else, and the collector asks it once an hour for `openstack_nova_limits_*`, `openstack_neutron_quota_*`, `openstack_cinder_limits_*` and `openstack_cinder_volume_type_quota_gigabytes`. They change slowly, and an exporter reads the same things whichever job asks, so reading them less often takes an exporter of their own. Your own exporter has no such thing: the agent reads what it says, on every scrape.

**Slow metrics:** delete the `--disable-metric` line for what you want, from the exporter's `command` in `docker-compose.yml`, or from `ExecStart` in `oneuptime-openstack-exporter.service` without Docker. The cost is one call per project per scrape.

| Delete | To collect |
| --- | --- |
| `--disable-metric=nova-quota_cores` | `openstack_nova_quota_*` |
| `--disable-metric=nova-server_local_gb` | `openstack_nova_server_local_gb`, usage per server. This one is a single usage report that walks every server rather than a call per project, and it is slow on a large cloud all the same |

The three lines that leave project quotas out of this exporter (`--disable-metric=nova-limits_vcpus_max`, `--disable-metric=neutron-quota_network`, `--disable-metric=cinder-limits_volume_max_gb`) stay in. Deleting them reads them every two minutes as well.

Each flag names the series that reads the rest of its row, which is why one line turns them all off. Do not use the exporter's own `--disable-slow-metrics` instead: it also takes `openstack_glance_image_*`, the image list the Images page reads with one call. Neutron's list of quotas is an admin's alone at every level but level 1, so `openstack_neutron_quota_*` needs that level.

**Per-port series:** delete the four `--disable-metric=neutron-port*` lines, in the same place.

**Intervals:** change `scrape_interval` and `scrape_timeout` under a job in `otel-collector-config.yaml`.

Then run `docker compose up -d --force-recreate`, or `sudo systemctl daemon-reload` and restart both services without Docker. An upgrade replaces these files and keeps your copy as `<file>.bak.<timestamp>`, so make your edit again afterwards.

Three more lines stay in, because you will not miss them. `--disable-metric=neutron-subnets_total` leaves out many series saying what the address pools already say (`openstack_neutron_subnets_total`, `openstack_neutron_subnets_used`, `openstack_neutron_subnets_free`). `--disable-metric=nova-security_groups` leaves out a read of a route Nova no longer has, which would only fill the exporter's log. `--disable-metric=gnocchi-total_metrics` leaves out a read of every metric in Gnocchi, page by page, for one count (`openstack_gnocchi_total_metrics`): a Gnocchi can hold millions.

To read internal endpoints rather than public ones, add `--endpoint-type=internal` in the same place.

Three open upstream issues shape all this, and the project has also [asked for maintainers](https://github.com/openstack-exporter/openstack-exporter/issues/443):

- [Issue 660](https://github.com/openstack-exporter/openstack-exporter/issues/660): one failing service empties a whole scrape. So there is one scrape job per service. Do not merge them.
- [Issue 540](https://github.com/openstack-exporter/openstack-exporter/issues/540): an unscoped port list can saturate Neutron. So the per-port series are off, and the diagnostic script asks for one small page of ports.
- [Issue 244](https://github.com/openstack-exporter/openstack-exporter/issues/244): scrapes time out on larger clouds. So intervals are minutes rather than seconds, each with a timeout under it. If `openstack_*_up` goes missing for one service on a large cloud, raise that job's interval and timeout before anything else.

## Bare metal

If your cloud runs Ironic, it gets a **Bare Metal** section with every node Ironic shows the credential: where it is in Ironic's state machine, its power, whether someone put it in maintenance and why, its resource class, and when Ironic last saw it move. A cloud without Ironic has no such section, no alert about it and no line on any page.

A node is not a hypervisor, even though Nova and Placement both list it as one under its UUID, so it is not counted as somewhere to run a virtual machine. How many nodes of each resource class could take an instance is on the Bare Metal page, for the nodes Ironic shows this credential, and on the [Capacity](#capacity) page, for every node Placement holds.

What needs someone, at the same lines as the [alert templates](/docs/monitor/openstack-monitor#pre-built-alert-templates):

| Reads | Means |
| --- | --- |
| A failed state, such as `clean failed` or `deploy failed`, or `error` | It stays failed until someone acts: Ironic retries none of these, and does not always put the node in maintenance |
| The same passing state, such as `wait call-back`, for 2 hours | Ironic gives up on waiting after 30 minutes by default, so something else is holding it. A long disk erase can honestly take this long: the page reads Ironic's own time, which an erase's heartbeats keep moving, and an alert only reads the word |
| In maintenance for 7 days | Planned until then, like a service someone disabled, so nothing says it needs attention before that |
| `active` with its power off | Whatever runs on it has stopped. If its owner stopped the instance on it, the node's page says that is planned. An alert reads one series and cannot tell |

### What it can't see

Each of these was recorded on a real DevStack, and each page says so where it matters:

- **Ironic shows a project only the nodes it owns.** Placement answers everyone, so where it holds a node Ironic didn't list, the page says the list is not the whole cloud's. By Ironic's default policy only a system-scoped credential reads every node, or one whose role has `baremetal:node:list_all`.
- **The exporter doesn't carry why a node failed.** It has a maintenance reason and no `last_error`, and Ironic can empty `last_error` within about a minute anyway, with the node still failed: it did for a failed clean, and left a failed deploy's. So look straight away with `openstack baremetal node show <node> -c last_error`, or in the conductor's log. A [probe](/docs/telemetry/openstack-agentless) reads `last_error` and keeps the last one it saw.
- **The exporter has no conductors.** Only a probe reads them, and Ironic refuses a project's credential the list unless its policy says otherwise (`baremetal:conductor:get`).
- **A stopped Ironic reads the same as no Ironic.** Asked about one that is stopped, the exporter answers an empty 200, as it does for a cloud that never had it. So a page says only that it hasn't heard from Ironic, and that the nodes are as they last read. It never says down. Two weeks after the rest of the cloud last reported without it, those rows go, and they come back if it does.

## Capacity

"Can we fit this?" is the question an OpenStack operator gets asked most, and Nova's free counts don't answer it: allocation ratios, reservations and fragmentation all matter, so a cloud can have thousands of vCPUs free and no room for one large instance. A cloud's **Capacity** page says how many more of each flavor fit, and what is short, soonest first. It reads one summary, worked out every two minutes, so a cloud of 5,000 hosts loads as fast as a cloud of one. **Export CSV** on its flavor table downloads everything on the page.

Everything on it is allocation: what has been promised, not what is busy. An idle instance holds all of it.

**What capacity is.** For each resource provider and resource class, capacity is `(total - reserved) x allocation_ratio`, and allocated is what Placement has promised. That adds up by zone, aggregate, region and cloud. A host whose `nova-compute` is down keeps reporting its last numbers, and a disabled one takes nothing on, so neither counts as room. What they hold is still there, and a forecast counts it.

**Bare metal.** A node takes one instance whole, so a cloud with Ironic gets a table of its own, by resource class: how many nodes, how many could take an instance, how many are in use, and how many are held back, because Nova's Ironic driver can't use them right now. These are Placement's own numbers, so they are the whole cloud's even where Ironic shows a project only what it owns, and they are not in the vCPUs and memory above. A probe reads which class a flavor asks for and counts it against these. The agent's exporter doesn't say, so on the agent a bare metal flavor counts as its vCPUs, memory and disk, on hosts.

**How many more fit.** Each flavor is counted host by host, because an instance needs all of what it asks for on one host. Beside the count is what it would be if everything free were on one host, which is how a full cloud is told from a fragmented one. A flavor no host could hold even empty says **Too large for every host**, and nothing ever alerts on it. Counts are for an instance booted from an image: one booted from a volume asks for no root disk.

The page says where each count came from:

| | Through a probe | Through the agent |
| --- | --- | --- |
| **Counted from** | `GET /allocation_candidates`, which is what Nova's scheduler asks, as [StackHPC's os-capacity](https://github.com/stackhpc/os-capacity) does. Inventories fill in until a flavor's turn comes round | The Placement series the exporter already sends: `openstack_placement_resource_{total,reserved,allocation_ratio,usage}` |
| **Sees traits and nested providers** | Yes. A flavor's extra specs are asked for too, so `trait:` and `resources:` count | No: the exporter's flavor series has no extra specs, so a flavor that needs a trait counts every host, and the page says so |
| **A host's `max_unit`** | Placement's own | Taken to be the host's total, which is what Nova sets |

A probe asks gently, because this is the one read that makes Placement work. It asks about one shape of flavor at a time, so flavors that ask for the same thing are one question, and at most 4 a collection, in turns, however many flavors there are. So a cloud of 40 flavors collected every 2 minutes costs 2 calls a minute and goes round in 20 minutes. Each answer is limited to 1,000 hosts, which is Nova's own `max_placement_results`: one boot's worth of work. A count from an answer that long is a floor, and the page says **At least**. It asks nothing on its first collection, nothing when Placement has been slow that collection, and for an hour nothing once a credential has been refused, because the count from inventories is there anyway. An application credential or the `oneuptime_monitoring` role needs `/allocation_candidates` to be allowed: it is in `access/application-credential-access-rules.json` and `access/policy/placement.yaml`.

**Beside what hosts really use.** Where [real usage](#real-usage) reaches OneUptime, the page puts the ratio you set beside what the hosts really use at their peak over a day, and the ratio at which they would reach the 90% line that **Hypervisor CPU Saturated** and **Hypervisor Memory Pressure** draw. It is a straight line from one day of one workload, so it says how far a ratio could move, not that you should move it. It says nothing until over half of a zone's hosts report.

**When things fill up.** Each zone's resource classes, each external network's IPv4 addresses and each storage pool have a forecast: a straight line through what was allocated over the last week, against what there is today. A new cloud says **Not enough history** until it has a day of it.

**Whether a zone can lose a host.** What is allocated in the zone, on a lost host too, against what its other hosts could promise with the largest gone, as VMware's Host failure asks of a cluster. It compares amounts rather than where each instance would land, so a zone that passes has room for an evacuation, not a promise that every instance finds a host: the flavor table shows what is fragmented. A zone of one host has nothing to say, and neither does one with a host someone disabled, because that is planned work.

**Allocations no instance explains.** When Placement holds more on a host than its instances' flavors add up to, for over half an hour, the page names the host. That is usually an [orphaned allocation](https://docs.openstack.org/nova/latest/admin/troubleshooting/orphaned-allocations.html), left by a delete or a move that failed part way, and it silently eats capacity. It compares vCPUs and memory, because an instance booted from a volume holds none of its flavor's disk. It says nothing of a host with anything on it moving, or an instance of a flavor the cloud no longer lists. To see what they are, and to remove them once you've checked each is really no instance's or migration's:

```bash
nova-manage placement audit --verbose
nova-manage placement audit --verbose --delete
```

**Alerts.** **Flavor Can No Longer Be Placed**, **Capacity Forecast Under 14 Days** and **Reserved Headroom Gone** read series OneUptime writes from the same summary. They are in the [monitor's templates](/docs/monitor/openstack-monitor#pre-built-alert-templates) and on the cloud's **Recommendations** page.

**What it costs.** Nothing on the agent. A probe adds the calls above. OneUptime writes about 2 series for each zone's resource class, external network and storage pool, and one for each flavor people can ask for, every two minutes, billed as any other metric.

## Spend

Private clouds still cost money, and whoever runs one is asked who's using what and what could be reclaimed. A cloud's **Spend** page answers both, on any cloud at any size, and works with no setup at all. It shows usage and estimates to plan with. OneUptime doesn't invoice anyone, and nothing here is an amount a tenant owes.

**This month against last** is at the top, then who's growing, then each project, largest first, with **Export CSV**. The domains, and what was used on which flavor and volume type, sit beneath. A project's own page has its month line by line and the months before it.

### How usage is worked out

Every 15 minutes, a worker reads what each project holds in the cloud's inventory, and adds that for the time since the last reading: vCPU-hours and memory-hours by flavor, volume GB-hours by type, floating IP-hours, and image and snapshot storage. No per-instance series is read or written, so it costs the metric store and the telemetry bill nothing, and it works the same on a cloud in [summary mode](/docs/telemetry/openstack-very-large-clouds#summary-mode).

What that means for the numbers:

- **A resize moves hours from one flavor to the other**, and a deletion stops them. A change is counted from the first reading that shows it, so each one can be out by up to 15 minutes. An instance that lived less than that may never be seen.
- **A part counts until the inventory lets go of it,** which is up to [the stale window](#environment-variables) after it went. On a large cloud read in turns, a change takes as long as its turn to arrive.
- **An instance holds its flavor from when it's placed until it's deleted.** One shut off still counts, on its own line, because Nova keeps its vCPUs and memory set aside on its host. One that never reached a host doesn't count, and neither does one shelved off its host.
- **A volume or snapshot in error, or still being made, doesn't count,** because it has no space behind it on the whole.
- **Hours OneUptime wasn't reading aren't guessed at.** A gap longer than an hour counts its last hour, and the page says how many hours weren't counted.
- **The agent's exporter reports how many snapshots there are, not which,** so snapshot storage is only counted on a cloud [connected without an agent](/docs/telemetry/openstack-agentless).

### Prices

Prices are yours and they're optional. Without them the page shows usage. Under **Prices**, set a currency and a price per hour for a vCPU, a GB of memory, a GB of volume, a floating IP, a GB of image and a GB of snapshot. **Advanced** has a price per instance-hour by flavor, which is then the whole of that flavor's price, a price by volume type, and a switch to leave out shut-off instances. A month is about 730 hours.

A price of zero means no price, not a free cloud. What has no price is said to have none, and a project that used something unpriced is counted on the page, so a total of what is priced is never passed off as all of it. Today's prices apply to the whole of every period shown, last month's too, so changing a price doesn't read as a project's usage moving. A price changed now shows within 15 minutes.

### CloudKitty

If the cloud runs [CloudKitty](https://github.com/openstack/cloudkitty), what it rated replaces the calculation, project by project, and the page says which it used. A probe asks once an hour, for this month and last, and it's asked of `GET /v2/summary`, or `GET /v1/report/summary` on a CloudKitty too old for it. That's at most two requests per 1,000 projects an hour, plus a request for its version each time it's read.

- **Only a [probe](/docs/telemetry/openstack-agentless) can read it.** The agent's exporter has no series for CloudKitty, so a cloud connected through an agent calculates, and says so.
- **What it sees is what the credential may see.** CloudKitty's own policy shows most credentials only their own project. The projects it doesn't rate go on being worked out from your prices.
- **It doesn't say a currency.** A rate is shown in your price list's currency if you've set one, and as a number alone if not.
- **This was written to CloudKitty's API reference,** and no real CloudKitty has answered it yet.

### Budgets

A budget says what a project, or a whole cloud, may come to in a month, in the currency of your prices. As with [a connected cloud's budgets](/docs/telemetry/cloud-costs), it raises an alert the first time in a month the estimate passes each share of it (80% and 100% unless you say otherwise), and one when holding what's held now would pass it before the month ends. A new month starts from nothing, and last month's alerts are resolved. A budget only ever alerts: it stops nothing. Without prices or CloudKitty there's nothing to compare, so it stays quiet and its row says it hasn't been checked.

### What could be reclaimed

The cloud's **Recommendations** page lists what's been left unused, what each would free, and the command that lists it, once an hour. OneUptime never removes anything, and every one of these is a question for whoever owns it.

| What | When it's named | What it frees | The command that lists them |
|---|---|---|---|
| Hypervisors that could be emptied | 20% or less of its vCPUs and memory are allocated, everything on it fits on the other hosts in its zone and aggregates, and the zone could still lose a host afterwards | The whole host | `openstack hypervisor list --long` |
| Instances shut off for a long time | Shut off for 30 days | Their vCPUs, memory and local disk | `openstack server list --all-projects --status SHUTOFF --long` |
| Volumes attached to nothing | Available for 30 days, attached to nothing | Their storage | `openstack volume list --all-projects --status available --long` |
| Old volume snapshots | Made 90 days ago. Probe only | Their storage | `openstack volume snapshot list --all-projects --long` |
| Images nothing was booted from | Private or shared, 30 days old, not protected, and no instance or volume came from it. Probe only | Their storage | `openstack image list --long` |
| Floating IPs nothing is using | Unassociated for 7 days | An address | `openstack floating ip list --status DOWN --long` |

Nothing in use is ever named. How long something has been so comes from the cloud's own clock where a probe reports one. Through an agent it's how long OneUptime has seen it so, so on the day you connect a cloud nothing's old yet. A rule that can't be sure says so instead of guessing: the agent can't say which image an instance booted from, so an image in use would look unused, and it can't list snapshots, so those two rules wait for a probe. A host is named by what's allocated rather than how busy it is, it's never named in a zone with a host lost or disabled, and hosts are taken emptiest first so what's named can all be done. It can't see traits or anything else an instance needs of a host.

### At each size

A reading costs the same however often instances change, and what it costs grows with what's named here. These are tested on Postgres, with the statements counted exactly and the largest size's time held to a budget.

| Hypervisors | Instances | Projects | Statements a reading | Rows kept | What the page reads |
|---|---|---|---|---|---|
| 10 | 100 | 10 | 13 | 750 | One row of the cloud, one page of projects |
| 500 | 20,000 | 1,000 | 14 | 75,000 | One row of the cloud, one page of projects |
| 5,000 | 200,000 | 10,000 | 37 | 750,000 | One row of the cloud, one page of projects |

Once a cloud has a last month, a reading reads that too, one statement per 2,000 projects. The hourly rules read five lists of at most 5,000 rows, and go through every instance's row once to see what's in use.

At the largest size, what each project holds is read in under 5 seconds, a whole reading takes under 30, and the row the page reads stays under 2 MB. Rows kept are one per project for each of 13 months, and one per project for each of the last 62 days. They don't depend on how many instances there are, and none of it counts as telemetry.

## Real usage

Nova and Placement say what is promised on a hypervisor, not what is busy: an idle instance holds all of its vCPUs. So nothing in OneUptime calls those numbers usage. To see what is really busy, point the agent at whichever of these your cloud already runs. The OpenTelemetry Collector has no libvirt receiver of its own.

| Source | Where it runs | Turn it on |
| --- | --- | --- |
| [`prometheus-libvirt-exporter`](https://github.com/inovex/prometheus-libvirt-exporter) | Port 9177 on each compute node. Kolla-Ansible runs it when Prometheus and KVM are on. | Set `OPENSTACK_LIBVIRT_EXPORTER_TARGETS=[compute-01:9177,compute-02:9177]` |
| Ceilometer's own exporter, from 2025.1 | Port 9101 on each compute node, beside its polling agent. | In `ceilometer.conf`, under `[polling]`, set `enable_prometheus_exporter = true`, `prometheus_listen_addresses` to an address the agent can reach, and `batch_size` higher than the most instances on one node. Then set `OPENSTACK_CEILOMETER_EXPORTER_TARGETS=[compute-01:9101]` |

After changing either, run `docker compose up -d`. Each exporter speaks for one compute node, so name every node you want read.

Ceilometer only says what its `polling.yaml` asks for, and the file it ships leaves some of this out. Add these meters to it for the whole picture:

| Meter | Without it |
| --- | --- |
| `vcpus` | An instance's CPU is measured against what its flavor says instead. Epoxy has no such meter. |
| `memory.resident` | Nothing says what instances hold on their hypervisor, so no **Hypervisor Memory Pressure** |
| `disk.device.read.latency`, `disk.device.write.latency` | No disk latency, so no **Instance Disk Latency High** |

OneUptime turns both into one set of series as they arrive, beside the originals: `openstack.instance.*` for each instance, by its UUID, and `openstack.hypervisor.instances.*` for what a hypervisor's instances add up to. The [OpenStack monitor](/docs/monitor/openstack-monitor#collected-metrics) lists them. So pages and alerts mean the same thing whichever source a cloud has:

| What it reads | libvirt | Ceilometer |
| --- | --- | --- |
| CPU in use | How much CPU time passed, over the time between two readings | The same, from a cumulative number in nanoseconds |
| CPU waiting, what the guest calls steal | `libvirt_domain_vcpu_delay_seconds_total` | `ceilometer_cpu_delay`, once a release has it. No released Ceilometer does yet, from Epoxy to Hibiscus, so these show no reading |
| Memory in use | What the guest's balloon driver says: available less usable | `ceilometer_memory_usage`, which is the same sum. Without a balloon driver neither has this, and it is left out rather than guessed |
| Memory on the hypervisor | `libvirt_domain_memory_stats_rss_bytes` | `ceilometer_memory_resident`. It holds more than the flavor's size, because QEMU itself is in it |
| Disk and network | Rates per disk and interface, and latency as the time requests took over how many there were | The same |

Ceilometer's readings only change once a polling cycle, five minutes by default, however often they are read. A rate is worked out between the moments a reading changed, so it doesn't read 0, 0, then five times the truth, and a reading that didn't change adds no data. The first value seen says nothing about when it was polled, so the first rate takes two polls. Once a poll has moved something about an instance, what it left as it was reads 0, and a reading on an instance where nothing moves reads 0 after 11 minutes. A counter that goes backwards has restarted, after an instance rebooted or moved, and counts from zero. `libvirt_domain_info_memory_usage_bytes` is not read as usage: it is the size of the balloon, which on an idle instance is its flavor's memory.

A shut-off instance has no reading from either source: libvirt reports a CPU time of 0 and Ceilometer says nothing, and neither is an instance doing nothing. A config drive is a CD-ROM, which libvirt's exporter leaves out and Ceilometer doesn't, so with Ceilometer an instance that has one shows one more disk, usually `hda`, reading nothing.

An instance's page shows CPU, memory, disk and network beside its flavor's size, with their charts under **Usage**. A hypervisor's page shows what its instances use, measured against what it has before any allocation ratio, and names the busiest beside what each was given, with their charts under **Metrics**. Past a line it says which instances are responsible, and which are being made to wait. Without a source each page says so, and what to add. Where OneUptime's [host agent](/docs/telemetry/hosts) runs on a hypervisor, its page reads that machine's own CPU, memory, disk and network from there, which includes the host's own processes, so it can be past the line while its instances aren't.

The agent's troubleshooting script reads each exporter you named, says how many instances it knows and which meters Ceilometer isn't polling, and what each one costs you.

Four [alert templates](/docs/monitor/openstack-monitor#pre-built-alert-templates) read these: **Hypervisor CPU Saturated**, **Hypervisor Memory Pressure**, **Instance CPU Saturated** and **Instance Disk Latency High**. Without a source they stay quiet.

### What it costs

Per-instance series multiply fast, so keeping them is a choice, under the cloud's **Settings**, in **Real usage per instance**:

| Choice | What it keeps |
| --- | --- |
| Automatic, the default | Every instance while the cloud has 500 or fewer, and none past that |
| Every instance | Every instance, at any size |
| Only the projects and aggregates I choose | The instances of those projects, and those on the hypervisors of those aggregates |
| None | No instance's series |

An instance not kept loses its original series too, so the choice stops the whole cost, and it still counts towards its hypervisor's totals, which are five series per hypervisor whatever you choose. The agent's scrape jobs keep only what OneUptime reads of each exporter. Past 5,000 instances the same choice also decides who keeps a [series of their status](/docs/telemetry/openstack-very-large-clouds#summary-mode).

What one instance costs, with two vCPUs, one disk and one network interface:

| Source | Series per instance | Rows per hour | Rows per month, 100 instances | Rows per month, 1,000 instances |
| --- | --- | --- | --- | --- |
| `prometheus-libvirt-exporter`, read every minute | 30 | 1,800 | 131,400,000 | 1,314,000,000 |
| Ceilometer's exporter, read every minute and polled every 5 | 24 | 864 | 63,072,000 | 630,720,000 |

Each further disk adds 12 series to either, and each further interface 4. Each further vCPU adds 1 from libvirt. The agent's collector holds these in memory on their way out, so a large cloud may want more than its default 512 MiB. The guide's calculator, under **Documentation** on a cloud, puts a price on these for a cloud of your size.

## Projects and domains

A cloud holds many tenants, so OneUptime keeps track of whose everything is.

- **Projects** lists every project with its domain, what it runs, what needs attention in it and the incidents and alerts open on its parts. A project's page says the same in full, and names any host that is down under it.
- **Domains** says how many projects each domain holds.
- **Every list of what a project owns** can be narrowed to one project, and to one domain on a cloud with more than one. Both go by ID, so renaming a project or a domain breaks nothing.

### Send a project's alerts to its team

On a project's page, add a rule under **Who is told about this** or **Labels on what opens about this**. **Domains** has the same two for a whole domain. From then on, every alert and incident that reaches that project or domain gets those owners or labels.

A rule here is an **OpenStack Cloud Owner Rule** or **OpenStack Cloud Label Rule** with the project's or domain's ID on it, so it also appears under the cloud's **Owner Rules** or **Label Rules** settings, where you can write one by hand under **One project or domain**. A rule with either ID adds nothing to the cloud itself. Conditions on the cloud still apply, and a rule made from **Domains** names its cloud, because every cloud has a domain called `default`. If you rename that cloud, update the rule's name condition.

An alert or incident on a part of the cloud reaches each project with something on that part, however many there are. Only a monitor can say what it reaches, so a rule like this does not reach an incident someone declares by hand. Labels go on as the alert opens, and owners right after.

Rules written earlier as a pair of alert and incident rules, matching ``OpenStack project `<id>` `` or ``OpenStack domain `<id>` `` in the description, keep working and are listed here too. A description names at most 50 of the projects it reaches, so a pair like that stops there. Remove it and add the rule again to lift that limit.

### Quotas

With quotas on, a project's page shows how much of each it has used: instances, cores, RAM, gigabytes of volumes, networks, ports and floating IPs. A project at 90% of one, or past it, appears under **Needs attention**. A limit of -1 means no limit, so it is never at anything. They are read once an hour. A reading more than three hours old is shown but no longer judged, because quotas may have been turned off.

They are off by default because of what they cost: see [What it costs your cloud](#what-it-costs-your-cloud). OpenStack's quota on how many volumes a project may hold is not shown, because the exporter reads only its gigabytes.

### Labels from Nova metadata

To see a Nova metadata key as a label, add `--nova.metadata-extra-labels=team` to the exporter's command, with any more keys after a comma. A project's page shows the values its instances carry.

## Topology and blast radius

A cloud's **Topology** page draws it region by region: availability zones, hypervisors and the instances on them, storage pools and volumes, networks, routers and floating IPs, and the APIs and services. Each part is coloured by the same rules as **Needs attention**, so a hypervisor whose `nova-compute` has stopped is red, with its instances beneath it.

Past 5,000 parts, the map reads what has failed and what that takes with it rather than everything, opens on the hosts that failed and says what it left out. **Needs attention** narrows it to all of the rest. [Infrastructure](/docs/telemetry/topology) draws the cloud beside your hosts and clusters.

A part's blast radius is what it takes with it, by count and by project:

| When this fails | It reaches |
| --- | --- |
| A hypervisor, or its `nova-compute` | Its instances |
| A storage pool | Its volumes, and the instances they are attached to |
| An L3 agent | The routers no other agent can take over, and their floating IPs |
| A region's API | Everything that API serves in the region, in every project |

A part's page shows it. An alert or incident on the part says it in its description, such as "3 instances in 2 projects", with their names.

The exporter does not say which network an instance is on, or which pool holds a volume, so neither is drawn for a cloud the agent collects. The map says so, and a storage pool's blast radius says it cannot tell rather than answering none. A [probe](/docs/telemetry/openstack-agentless) says both. The map then joins a volume to its pool, when Cinder treats its credential as an admin, and a pool's blast radius counts its volumes and the instances they are attached to. It also joins an instance to each network it has an address on. Nova names those networks only by name, and Neutron allows two with one name, so the map looks for one in the instance's project, then one shared with it, then any by that name, and draws no join when two are equally likely. What is still unknown stays in the map's notice.

## Joined up with the rest of OneUptime

An incident rarely stays in OpenStack. A pod is slow because its node's instance sits on a full hypervisor whose volumes sit on a degraded Ceph pool. Each of those reports to OneUptime on its own, and these are the joins.

No link is made on a guess. A name that matches two parts links to neither, whichever end you read it from: a host called `compute-01` beside two hypervisors called `compute-01.east.example` and `compute-01.west.example` is on neither, and a hypervisor two hosts could be has no host. The same UUID in two clouds, such as a restored copy, links to neither, unless one of them is archived.

| What | Links to | How |
| --- | --- | --- |
| A [host](/docs/telemetry/hosts) running OneUptime's agent on a compute node | Its hypervisor | By name, where exactly one host and one hypervisor match. A short name matches a full one, and two full names in different domains are two machines |
| A host inside a guest | Its instance | Its `host.id` is the instance's UUID, which the collector's `nova` resource detector reports. Put it first, so it wins over `system`: `detectors: [nova, system, env]`. Leave `host.name` to `system` with `nova: { resource_attributes: { host.name: { enabled: false } } }`, or the host's name changes to the instance's |
| A Kubernetes node | Its instance | Its `spec.providerID`, `openstack:///<uuid>` or `openstack://<region>/<uuid>`, which `openstack-cloud-controller-manager` sets |
| A service | The instance or hypervisor it runs on | The host its telemetry names, or the Kubernetes node its pods are on |
| A Cinder storage pool | Its Ceph cluster | See below |

Each page links to the next: a host, a Kubernetes node and a service say where they run, an instance says what it also is, and [Infrastructure](/docs/telemetry/topology) draws a linked host's services under their instance. A host's link is made once and left alone. It is checked every five minutes until it can be made, and is never written over. When more than one cloud could be it, choose one under **OpenStack Cloud** on the host's Settings page.

The RabbitMQ and MariaDB pages under **What It Stands On** lead to [Queues](/docs/telemetry/queues) and [Databases](/docs/telemetry/databases), which go deeper once their own agent reads them.

When a hypervisor fails, its blast radius goes on past the cloud, and an alert's description and OneUptime AI read the same answer: its instances, the machine itself, the hosts and Kubernetes nodes its instances are, the clusters those are in, and the services on those hosts and nodes. An investigation that starts at a slow service can walk down to its hypervisor.

### A storage pool and Ceph

What each source says about a pool decides how it links:

| Source | What it says | What happens |
| --- | --- | --- |
| A [probe](/docs/telemetry/openstack-agentless) at the Full view level | Cinder's RBD driver names the Ceph cluster's fsid and pool in `location_info` | It links on its own, when one [Ceph cluster](/docs/telemetry/ceph) here reports that fsid. A Ceph cluster reports it only with `ceph.cluster.fsid` set in its agent's config |
| The agent's exporter | The pool's name, its backend's name and its vendor, which reads `Open Source` for LVM and RBD alike | Nothing says it is on Ceph. A Ceph pool of the same name in exactly one cluster is offered, for someone to confirm once on the pool's page, unless another Cinder pool has that name too. With no such match they can choose a cluster, or say it isn't on Ceph |

Once linked, the pool's page says how its cluster reads, and `HEALTH_WARN` or `HEALTH_ERR` appears in the cloud's **Needs attention**. A suggestion nobody confirmed raises nothing. An answer someone gave can be changed on the pool's page. Only the Full view credential can see pools at all: see [Choose how much the agent sees](#choose-how-much-the-agent-sees).

## Heat and Magnum

If your cloud runs Heat or Magnum, they appear on their own: there is nothing to turn on. A cloud that runs neither shows no trace of them, with no menu entry, no card on **Services** and no alert to choose from. What says so is the cloud's own answer, never a setting: the agent asks about each on every collection, and a service Keystone's catalog doesn't name answers with nothing.

A cloud with Heat gets **Stacks** under **Orchestration**, and one with Magnum gets **Kubernetes Clusters**. Each lists every stack or cluster with its status in the service's own word, and each has a page. A stack or cluster in a failed state reaches **Needs attention** by name, and so does one still in progress after two hours, which is twice what either service gives one of its own accord. Magnum builds a cluster with a Heat stack, so a failed cluster and its failed stack read as one line, by the cluster's name, and each page links to the other.

### What each way of collecting sees

The exporter says less about these services than a read of their APIs does, and neither service shows anything but an admin the whole cloud. So each page says what your cloud's collector can't see.

| What | Agent, Full view | Probe, Full view | Anything less |
| --- | --- | --- | --- |
| Every project's stacks and their status | Yes | Yes | Its own project's at most, with no project on them, and no error says so |
| Whose a stack is | Yes | Yes | No |
| Why a stack failed | No. Run `openstack stack failures list` | Yes | No |
| Every project's Kubernetes clusters and their status | Yes | Yes | None of another project's, and no error says so |
| Whose a cluster is | From its Heat stack | From Magnum | No |
| Why a cluster failed, its template and its Kubernetes version | No. Run `openstack coe cluster show` | Yes | No |
| Heat's engines and Magnum's conductors on **Services** | No | Yes | No |
| Which instances and volumes a stack owns | No | Where Heat answers it | Its own project's at most |

Two failures read differently, and both are what a real cloud does:

- **A stopped `heat-engine`** reads as **Orchestration API Down**, on either collector. Heat's API asks an engine for its lists, so with none left it can't answer them, after a minute's wait for an RPC timeout. A stack an engine left in progress can stay in progress after the engine comes back, and reads **Stack Stuck In Progress** once two hours have passed.
- **A stopped `magnum-conductor`** isn't shown anywhere on a cloud the agent collects, because Magnum's API carries on answering without one and the exporter doesn't read conductors. Its clusters just stop moving. A probe with a Full view credential reads them, which is the only way to see this, or run `openstack coe service list`.

Which instances and volumes a stack owns is on one more read of that stack, which the agent's exporter doesn't make. On a cloud a probe collects, a stack's page lists them, and an instance's or a volume's page and alerts name the stack. It reads what its credential may, and a stack's page says when nothing has. On a cloud the agent collects, run `openstack stack resource list`.

### A cluster with the Kubernetes agent on it

Install the [Kubernetes agent](/docs/telemetry/kubernetes-agent) on a cluster Magnum built and the two link both ways, with nothing to set: the Magnum cluster's page names the Kubernetes cluster, and the Kubernetes cluster's page names the Magnum cluster and the cloud it is in. Each node's page already says which instance and hypervisor it is.

What makes it a link is that the nodes' `spec.providerID` names instances, and those instances' names are what Magnum's Heat driver gives the servers of that cluster's stack: `<stack>-master-0`, `<stack>-node-0`. So it takes three things, and without any of them there is no link and no error:

- The OpenStack cloud provider on the cluster, which is what sets `spec.providerID`, and which Magnum turns on by default.
- A credential that can read Heat, because the stack's name comes from there.
- A cluster built with the Heat driver. A driver that builds no Heat stack has nothing to join on.

A link is never a guess. An agent installed twice under two names, or one cluster holding servers of two Magnum clusters, links to neither. A machine you joined to the cluster by hand, or a node group with a stack of its own, says nothing either way.

A server of a Magnum cluster names its cluster on its own page and in any alert about it, and a hypervisor's **What it takes with it** names each Magnum cluster with a server on it.

If a service leaves Keystone's catalog, its rows go about 15 minutes after the exporter starts answering with nothing about it, provided the rest of the cloud is still answering. A failed collection, or a Keystone nobody can log in to, takes nothing away. An incident a monitor had open on it stays open until someone resolves it, because silence never closes an incident.

## Manila

If your cloud runs Manila, a cloud gets **Shares** under **Storage** on its own, and one that doesn't shows no trace of it. Each share has its status in Manila's own word, what it holds room for, its protocol and whose it is, and a page of its own. A share in an error state reaches **Needs attention** by name, and so does one still on its way after an hour: Manila has no timeout of its own for a slow backend, so one that hung reads the same as one that's slow until then. A share migrating or being backed up is left alone, because those last as long as its data takes to copy.

| What | Agent, Full view | Probe, Full view | Anything less |
| --- | --- | --- | --- |
| Every project's shares and their status | Yes | Yes | Its own project's at most, and the monitoring role none, and no error says so |
| Which backend holds a share, and whether its access rules are in force | No. Run `openstack share show` | Yes | No |
| Why a share failed | No. Run `openstack share message list` | No. Run the same | No |
| How much of a share is used | No: only its backend knows | No | No |
| `manila-share`, `manila-scheduler` and `manila-data` on **Services** | No. Run `openstack share service list` | Yes | No |

Manila's API carries on answering without its other services, so on a cloud the agent collects a stopped `manila-share` isn't shown anywhere: its shares just stop changing, and **Share Stuck** is what eventually says so. A probe with a Full view credential reads them, and **Manila Service Down** then says so. Manila says `stopped` for a service that shut down cleanly, and `down` only for one that died, once its heartbeat has grown old.

A cloud without Manila costs nothing for it: the exporter answers with nothing, and that makes no row. If Manila leaves Keystone's catalog, its rows go about 15 minutes after that starts, as [Heat's and Magnum's do](#heat-and-magnum).

## Designate

A cloud that runs Designate gets **DNS Zones** under **Network** on its own, and one that doesn't shows no trace of it. Each zone has its status in Designate's own word, how many recordsets it holds and whose it is, and a page of its own, which lists any of its recordsets that aren't `ACTIVE`. Only those have rows: a zone can hold any number of recordsets, and the question is which of them went wrong. One goes from the list once it reads `ACTIVE` again, at the inventory's next sweep.

A zone in `ERROR` reaches **Needs attention** by name, and so does one `PENDING` after half an hour. Designate's worker gives up by itself well before that, so what stays `PENDING` has nothing working on it. A zone's own `SOA` and `NS` read `ERROR` with it, so that is said once, by the zone.

| What | Agent, Full view | Anything less |
| --- | --- | --- |
| Every project's zones and their status | Yes | Nothing: see below |
| Recordsets that aren't `ACTIVE`, and how many each zone holds | Yes | No |
| Why a zone failed | No: check `designate-worker`'s log | No |
| Designate's services | No. Run `openstack dns service list` | No |

Two things read differently from every other service here, both recorded:

- **A stopped Designate API says nothing at all.** The exporter reads its versions first, gets no answer, and answers an empty `200`, exactly as for a cloud without Designate. So nothing from the exporter can tell the two apart, and OneUptime doesn't claim to. A cloud that had Designate reads as having gone quiet after 20 minutes, on **Services** and in **Needs attention**. Its rows go after two weeks of that, and come back if it does. No alert can say this on a cloud the agent collects. A probe reads Keystone's catalog itself, so **DNS API Down** can.
- **`openstack_designate_up` reading 0 means a refusal.** The exporter asks for every project's zones, which only an admin may. So a credential that has never read them is told that, rather than that Designate is down, and isn't offered Designate's alerts.

A stopped `designate-worker` leaves Designate's API answering and its own list reading `UP` for a while, because it goes by a heartbeat. Changes are accepted and not carried out, and **DNS Zone Stuck Pending** is what says so.

## Trove

A cloud that runs Trove gets **Databases** on its own, and one that doesn't shows no trace of it. Each database has its status in Trove's own word, what it runs, its volume and whose it is, and a page of its own. One in an error state reaches **Needs attention** by name, and so does one still on its way after an hour, or one past 85% of its volume.

| What | Agent, Full view | Probe, Full view | Anything less |
| --- | --- | --- | --- |
| Every project's databases and their status | Yes | Yes | Nothing at all: see below |
| How full a running database's volume is | Yes | Yes | No |
| Why a database failed, and what it was doing | No. Run `openstack database instance show` | Yes | No |
| `trove-taskmanager` and `trove-conductor` | No: Trove has no list of them | No | No |

The exporter reads Trove's mgmt API, which only an admin may. Trove refuses anything less, and the exporter reads a refusal just as it reads Trove stopped: `openstack_trove_up` reads 0 and nothing else is said. So a credential that has never once read Trove is told that, rather than that Trove is down, and isn't offered Trove's alerts. A probe reads the same list and tells the two apart: Trove answered, so its API reads as up, and the connection test says it was refused. Once it has read Trove, a 0 reads as down, which is also what a credential that has since lost its access reads as.

A stopped `trove-taskmanager` isn't shown anywhere, because Trove's lists answer without it and it has no list of workers: what it was working on just stops moving, and **Database Instance Stuck** is what says so. Trove gives up on a guest by itself well before that hour.

Nothing has been recorded of a database reaching `ACTIVE`, because Nova refused the guest on every test run, so how full a volume reads has only been checked on made-up numbers. An instance that isn't running reads 0 used, and that reads as nothing rather than as empty.

## Gnocchi

A cloud that runs Gnocchi gets its API on **Services** on its own, and one that doesn't shows no trace of it. Gnocchi has no parts anyone opens one by one, so what it says goes on that API's own page: how many measures and metrics are waiting, and how many processors it has.

No processors reaches **Needs attention**, and so does a backlog past 10,000 measures. Gnocchi's API goes on answering and taking measures with `gnocchi-metricd` stopped, recorded, so its processors are the only place that shows. Nothing is lost while that lasts, but nothing newer can be read.

| What | Agent, Full view | Probe, Full view | Anything less |
| --- | --- | --- | --- |
| Whether its API answers | Yes | Yes | Nothing: see below |
| How many measures and metrics are waiting, and how many processors it has | Yes | Yes | No |

The exporter reads Gnocchi's status, which only an admin may. Gnocchi refuses anything less, and the exporter reads a refusal just as it reads Gnocchi stopped: `openstack_gnocchi_up` reads 0. So a credential that has never once read Gnocchi is told that, rather than that Gnocchi is down, and isn't offered its alerts. A probe tells the two apart: Gnocchi answered, so its API reads up, and the connection test says it was refused.

**Gnocchi Backlog Growing** reads a line through the last two hours. A busy cloud's backlog never reads 0, so a large one that is falling is fine, and one that isn't falling is what it says. The runners only ever got to a backlog of 10 measures, so its line has only been checked on made-up numbers.

## Service logs

The agent above reads a cloud's APIs from outside. Why an instance failed to build is somewhere else: in `nova-api`, `nova-conductor`, `nova-scheduler`, `nova-compute`, Neutron and Cinder, on several machines. An optional logs profile sends those lines to OneUptime, parsed, with a stack trace as one record. Unlike the agent, it runs on the cloud's own controllers and compute nodes, and it only reads.

:::cards
- [Install the logs profile](#install-the-logs-profile): One command per machine, or a chart value.
- [Follow a request](#follow-a-request): From an instance's page to its scheduler line in two clicks.
- [Log alerts](#log-alerts): The failures every operator knows by their words.
- [What it keeps and costs](#what-it-keeps-and-costs): The filters it starts with, and what they save.
- [Secrets](#secrets-in-logs): What never gets stored, and how that is done.
:::

### Install the logs profile

Where a cloud's services log depends on what deployed it:

| Deployed with | Where its services log | What to run |
| --- | --- | --- |
| Kolla-Ansible | Files in `/var/log/kolla`, in the `kolla_logs` Docker volume | `install-logs.sh files` on each node. A container that can read those files and nothing else |
| OpenStack-Ansible | The journal, its containers' passed through to the host | `install-logs.sh journald` on each host. A systemd service in the `systemd-journal` group |
| DevStack | The journal, under `devstack@*` units | `install-logs.sh journald` |
| OpenStack-Helm, Atmosphere, Red Hat's distribution | Pods | The [Kubernetes agent](/docs/telemetry/kubernetes-agent), with the chart values below |

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-logs.sh
sudo bash install-logs.sh
```

With no argument the script looks at the machine, and asks if it cannot tell. It asks for your OneUptime URL, the ingestion key, the cloud's name, which must be the name the cloud has in OneUptime, and the region this machine serves. Every answer also works as an environment variable, so a run across a fleet asks nothing: `ONEUPTIME_URL`, `ONEUPTIME_TELEMETRY_INGESTION_KEY`, `OPENSTACK_CLOUD_NAME`, `OPENSTACK_REGION_NAME`, `OPENSTACK_NODE_NAME` and `OPENSTACK_LOGS_PROFILE`. Running it again is the upgrade, and keeps every answer.

| Variable | What it is for |
| --- | --- |
| `OPENSTACK_REGION_NAME` | The region this machine serves, which the cloud's Logs page narrows by. Defaults to `RegionOne`. A machine set up before this says no region, so its logs only show under **All regions** until you run the script again |
| `OPENSTACK_NODE_NAME` | This machine's name, which a hypervisor's and a service's pages read logs by. Defaults to the machine's own |
| `OPENSTACK_LOGS_DIRECTORY` | Where Kolla-Ansible's logs are, if not in its usual Docker volume |
| `OPENSTACK_LOGS_TIMEZONE` | The zone oslo.log writes its times in. Defaults to `UTC` |
| `OPENSTACK_LOGS_UNITS` | The journal's units to read, in square brackets. Defaults to every OpenStack service's |

The files profile reads OpenStack's services by name, so RabbitMQ, MariaDB, HAProxy and libvirt in the same folder are left alone. A collector restarted later goes on from the line it had reached.

On a cluster, name the cloud in the Kubernetes agent's values, with the namespaces its services run in. Pods in those namespaces then have their stack traces joined, and their logs go under the cloud as well as the cluster. This takes the agent's DaemonSet log mode: the log tailer the restricted presets use does not read it.

```yaml title="values.yaml"
logs:
  openStack:
    cloudName: my-cloud
    namespaces:
      - openstack
```

### Follow a request

Every line OneUptime reads has its level, service, machine, request, user, project and instance as attributes, however the service was configured: oslo.log's default format, DevStack's journal format, `use_json`, and `use_journal` are all read as the same thing. So:

- An instance's **Logs** tab shows what names its UUID, starting with the requests those lines belong to, the failed ones first. A hypervisor's shows what came from that machine, and a service's its own.
- Any line that has a request ID says **Follow request**, which opens that request on the cloud's Logs page: every line holding its ID or its global ID, across every service, in time order.

The services join when the one calling them sends a global request ID. Nova sends one to Neutron, Cinder and Glance, and something you wrote may not. So the page says which services joined, and names those that wrote other requests' lines in the same moments, which OneUptime can't tell took part or not.

### Log alerts

The cloud's **Recommendations** page offers these beside the other [alert templates](/docs/monitor/openstack-monitor#what-the-services-say):

| Alert | Fires on |
| --- | --- |
| **No Valid Host** | `No valid host was found` |
| **RabbitMQ Connection Lost** | `AMQP server on <host> is unreachable`, or `MessagingTimeout` |
| **Database Connection Lost** | `DBConnectionError`, or MySQL's `Lost connection` and `Can't connect` |
| **Too Many Errors from a Service** | One service on one machine writing many `ERROR` lines |
| **Token Validation Failing** | A service saying `Authorization failed for token`, or Keystone `not a recognized Fernet token`: what a controller whose Fernet keys differ from the others looks like |

### What it keeps and costs

A cloud writes a great deal nobody reads. The first time a project's OpenStack logs arrive, it gets these as [drop filters](/docs/telemetry/drop-filters-and-scrub-rules), where they can be counted, changed or turned off. Turned off, they stay off, and so does one you delete while either of the others is left. Delete all three and the next logs bring all three back, so turn off what you don't want.

| Filter | What it drops | What it saves | What it costs you |
| --- | --- | --- | --- |
| **OpenStack: DEBUG lines** | Every `DEBUG` line. It is where a cloud's secrets have leaked | With `debug = True`, most of what a cloud writes: 85 to 87% of lines and 70 to 76% of bytes on our test clouds, across three releases. Nothing with `debug = False` | The detail you turn `debug` on to read. Turn this off while you debug a service |
| **OpenStack: health checks** | A load balancer asking each API for `/` or `/healthcheck`: a line every few seconds, per API, per controller | At one check every 2 seconds, 43,200 lines a day for each API on each controller. At the 220 to 490 bytes these lines were on our test clouds, that's 10 to 21 MB a day. This is arithmetic from the size of a line: our test clouds have no load balancer | Nothing a person reads. The same line from a person looks the same |
| **OpenStack: routine notifications** | `metrics.update`, and every `*.exists` and `*.usage`. See [Lifecycle events](#lifecycle-events) | Not measured: our recordings are too short to hold many. It grows with the number of instances | Nothing that says anything changed. Turn this off to keep every notification |

These filters match only what OneUptime read from a cloud's logs, so nothing else in a project is touched.

### Secrets in logs

OpenStack's debug logs have leaked tokens and passwords, and a Fernet token in a log is a login. Before a cloud's line is stored, whatever rules a project has set, OneUptime takes out Fernet, JWS and PKI tokens by their shape, the value of anything named as a secret (`password`, `token`, `X-Auth-Token`, `adminPass`, and the like), the password in a URL such as a `transport_url`, and private keys. A line too long to keep whole is cut first, and a secret the cut fell inside goes as well. Nothing turns this off. Four [scrub rules](/docs/telemetry/drop-filters-and-scrub-rules) cover the same shapes on a project's other logs, such as a pod's with no cloud named. Those are yours to change.

oslo.log masks a good deal itself, and not everything: our test clouds' Cinder wrote `connection_info` in the clear, CHAP password included. OneUptime takes that out too, though anyone who can read the service's own log can still read it there.

## Lifecycle events

"What changed just before this?" is the first question in any incident, and OpenStack says so through its notifications: instances migrated, a hypervisor disabled, a volume detached. Those go to a message bus nobody reads, and attaching a consumer to a production RabbitMQ is a risk operators rightly refuse. So OneUptime asks for no consumer. oslo.messaging's `log` driver writes each notification as JSON, with passwords masked, to the service's own log, and the [logs profile](#install-the-logs-profile) carries it.

Each one becomes:

- A line on the part's **Feed**, and on the cloud's.
- A marker on the part's charts, and a suspect when OneUptime AI investigates an incident on it.
- The real time a part's state changed, rather than when the next collection noticed.
- For what failed, **Instance Action Failed** and **Scheduling Failed** alerts, each with the reason it gives.

### Turn on notifications

Each service takes the same setting, and Nova one more, because it defaults to `unversioned`:

```ini title="nova.conf"
[oslo_messaging_notifications]
driver = log

[notifications]
notification_format = versioned
```

Set `driver = log` in `neutron.conf`, `cinder.conf` and `glance-api.conf` too. Each service needs a restart to read it, and what that takes depends on what deployed it:

| Deployed with | Where it goes | What restarts it |
| --- | --- | --- |
| Kolla-Ansible | `/etc/kolla/config/global.conf` for every service, and `/etc/kolla/config/nova.conf` for Nova's own | `kolla-ansible reconfigure -i <inventory> -t nova,neutron,cinder,glance` |
| OpenStack-Ansible | `nova_nova_conf_overrides`, `neutron_neutron_conf_overrides`, `cinder_cinder_conf_overrides` and `glance_glance_api_conf_overrides` in `user_variables.yml` | `openstack-ansible openstack.osa.nova`, and the same for each service. An older release names its playbooks `os-nova-install.yml` |
| OpenStack-Helm | `conf.nova.oslo_messaging_notifications.driver` and `conf.nova.notifications.notification_format` in the chart's values, and the same for each service's chart | `helm upgrade`, which restarts the pods whose configuration changed |
| Red Hat's distribution | `customServiceConfig` for each service in the `OpenStackControlPlane` resource. This is from Red Hat's documentation: we have not run it | Its operators, when the resource changes |
| DevStack | Each service's file in `/etc`. `iniset` does it | `sudo systemctl restart "devstack@n-*" "devstack@q-*" "devstack@c-*" "devstack@g-*"` |

A cloud that sends these to Ceilometer too can name two: `driver` can be set more than once. If that Ceilometer reads Nova's older form, use `notification_format = both`. OneUptime reads the versioned one of each pair, so nothing appears twice.

Leave `notify_on_state_change` as it is. It only adds `instance.update` lines, which are [steps on the way](#what-is-kept), and Nova's other events already say when a part's state changed.

### Without notifications

A cloud whose configuration isn't yours to change can still have failed actions. A [probe](/docs/telemetry/openstack-agentless) reads `os-instance-actions` for the instances that changed since it last looked, and says each thing as the notification Nova would have sent, with the reason Nova gives. It costs one call per instance that changed, a few per collection at most, and a quiet cloud none at all. It stays quiet once a cloud's own notifications arrive, so nothing is said twice.

Nova keeps these only per instance, and with no record that changed nothing brings one up. A failed volume attach can leave its instance as it was, so a probe can't see it. Notifications can.

Nova can also write off a build with nothing on its action: on our test clouds, a build that failed on its compute host left the action looking fine and the reason in the instance's fault. So the newest action of an instance in `ERROR` counts as failed, with that fault as the reason.

### What is kept

Three levels of event, as the [drop filter](#what-it-keeps-and-costs) reads them:

| Level | What | Where it goes |
| --- | --- | --- |
| Routine | `metrics.update`, `*.exists` and `*.usage`, which say nothing happened | Dropped, one setting away from kept. Kept, they are logs and go nowhere else |
| Trail | Steps on the way: `*.start`, a port updated while an instance boots, `instance.update` | Logs, to follow a request by |
| Change | Something happened | Logs, the feed, chart markers and OneUptime AI |

## Who did what

Security teams need to know who changed what in a cloud: role grants, failed logins and admin actions. OpenStack can write all of it, and it goes the same way as everything above: to the logs, with no bus. OneUptime reads it as a source of [Security Events](/docs/telemetry/security-events).

Whichever you turn on, OneUptime reads it once **Find security events in your logs** is on, under **Security Events → Connections**. [Each tool's guide](/docs/telemetry/openstack-deployment-tools) says where these settings go on it.

### Turn on Keystone's audit trail

```ini title="keystone.conf"
[DEFAULT]
notification_format = cadf
notification_opt_out = identity.authenticate.pending

[oslo_messaging_notifications]
driver = log
```

Name `notification_opt_out` yourself. Keystone's documentation says every login is left out by default. On Epoxy, Flamingo and Hibiscus its own default sends failed logins and leaves out those that worked: 24 wrong logins sent 24 notifications, whether or not the user existed, and good logins sent none. Naming `pending` alone sends a line for each login, failed or not. **OpenStack admin credential used from a new address** reads the ones that worked. To send failed logins only, add `identity.authenticate.success`, and that detection then reads what the audit filter saw.

### Turn on the audit filter

Keystone's notifications cover identity. For who did what through Nova, Neutron, Cinder and Glance, keystonemiddleware's audit filter records each call. It goes in the service's paste file, with a map file from pyCADF, in `etc/pycadf` under the Python environment the service runs in:

```ini title="api-paste.ini"
[filter:audit]
paste.filter_factory = keystonemiddleware.audit:filter_factory
audit_map_file = /path/to/venv/etc/pycadf/nova_api_audit_map.conf
```

```ini title="nova.conf"
[audit_middleware_notifications]
driver = log
```

In each pipeline, `audit` goes right after `authtoken` and the context filter that follows it. Not at the end: Neutron's `extensions` filter answers its routers and security groups, and a filter after it never sees them.

The filter writes two lines for each call, and most calls are reads. A read says nothing unless it was refused, so OneUptime keeps what changed something, and what was refused, which is what someone probing a cloud looks like. `ignore_req_list = GET, HEAD` in the filter's section leaves reads out of the logs too, and refused reads with them.

### What reaches Security Events

| What | Who, what, and on what |
| --- | --- |
| A login, failed or not | Who, from which address, against Keystone |
| A role granted or taken | Who, which role, to whom, on which project or domain |
| A change to Keystone's records | Who, which change, and which project, user or application credential |
| A call through the audit filter | Who, which action, on which part, and whether it was refused |
| A security group opened to the world | Who, which group, which project, and the sensitive port it opened |
| An image made public | Who, which image, and whose it was |

Keystone sends nothing for a role given on the system, so nothing here sees one. When a user joins a group it says only that the group changed, and not who joined. A login for a user who doesn't exist names what was typed, which someone can mistype a password into. To keep that out, add a [scrub rule](/docs/telemetry/drop-filters-and-scrub-rules) for the `user_name` in those lines.

A project and a part are named from the cloud's inventory where OneUptime knows them, so a case reads `project payments` and `instance web-1` and not their IDs. A part's project is the one its row says, whichever project the token that touched it was for. Keystone's users aren't in the inventory, because the access the agent asks for leaves them out on purpose. A user is named once one of the cloud's events has said their name, and by ID until then. A role is named by ID, because no event says its name.

The cloud's page says what Security Events found about it, a case names the cloud, and each part's page has **Who changed this**: who did what around the moment its state last changed. It reads the audit trail, and a notification's own actor without one, and it isn't there when neither says anything.

These six [detections](/docs/telemetry/security-events) come from the rule library:

| Detection | What it says |
| --- | --- |
| **OpenStack failed logins burst** | Ten or more failed sign-ins from one address in five minutes |
| **OpenStack role granted on a protected project** | A role given on `admin` or `service`. Add your own projects to the rule's list. It reads a project's name, so it needs the cloud's inventory |
| **OpenStack admin credential used from a new address** | The `admin` account used from an address it has not used in thirty days: a sign-in, a change or a call through the audit filter. Behind a load balancer that doesn't pass on the client's address, every address is the load balancer's |
| **OpenStack application credential created** | One was made. Keystone's notification reads the same for one that is unrestricted, so this fires on every one and says so. `openstack application credential show` says which it was |
| **OpenStack security group opened to the world** | `0.0.0.0/0`, `::/0` or no address at all, inbound, on a sensitive port or every port |
| **OpenStack public image published** | An image seen public for the first time in thirty days. An edit to one already known stays quiet, because Glance says what an image is and not what it was. So one made private and public again within those thirty days isn't said twice |

### What is never stored

A CADF event can hold what should not be kept: its initiator's credential holds part of a token, an invalid password's attachment holds part of its hash, and an API request can hold anything. OneUptime keeps a list of named fields, and nothing else of an event, so what a new release adds stays out until someone reads it and adds it. A request path keeps no query string. Request and response bodies stay off: the audit filter does not write them, and they would not be kept if it did. Audit records keep [Security Events'](/docs/telemetry/security-events) own retention, and a line goes through a project's log scrub rules before it is read.

## Trace requests through the control plane

"Why does booting an instance take four minutes?" crosses Nova, Neutron, Keystone and Glance, and logs only show the pieces. A trace shows where the time went. OpenStack's way of making one is [OSProfiler](https://docs.openstack.org/osprofiler/latest/), and OneUptime shows what it sends in [Traces](/docs/telemetry/traces-explorer), joined to the cloud's parts and to its logs.

Be clear about what you are turning on:

- **It is off until you ask for it, and it is per request.** A span exists only for a request [signed with an HMAC key](https://docs.openstack.org/osprofiler/latest/user/integration.html) your services hold. With nothing signed nothing is sent, so this is never an always-on feed.
- **Its [OTLP driver](https://github.com/openstack/osprofiler/blob/master/osprofiler/drivers/otlp.py) is marked experimental** by OpenStack, so try it on a cloud that can take it first.
- **It can only post plain HTTP**, which is why a collector on each machine takes its spans and forwards them to OneUptime over TLS.
- **It needs `opentelemetry-sdk` and `opentelemetry-exporter-otlp` in each service**, which no deployment tool's images hold.

> [!WARNING]
> Stay below version 1.44 of OpenTelemetry's SDK. That version hangs a service when it starts a subprocess ([its bug](https://github.com/open-telemetry/opentelemetry-python/issues/5789)). On our 2026.2 test cloud, whose pins name 1.44.0, it left Neutron's API never answering, and cinder-volume stopped working. The commands here ask for less than 1.44, and that held on the same cloud: with 1.43.0 every service came back with the driver on, and Neutron is in the trace. 2026.2's constraints file names 1.44.0, so it refuses them: leave it out of this one install.

:::cards
- [What a trace shows](#what-a-trace-shows): What is traced, and what is not, on a stock cloud.
- [Turn on traces](#turn-on-traces): The collector, the libraries and the config.
- [Trace a request](#trace-a-request): The command for your cloud, and where its trace is.
- [What tracing costs](#what-tracing-costs): What was counted, and what nobody has measured.
:::

### What a trace shows

Everything here was read from what the driver really sent for a signed boot on DevStack, on OpenStack 2025.2 and 2026.2, not from its documentation. One request is one trace, whichever services it crosses, and its Trace ID is the one the client prints. Each service is named as you know it, and joined to its page. A trace is also tied to what its requests named: a boot to the instance it made, its image and its network.

| Service | On a stock cloud | What you can do |
| --- | --- | --- |
| `nova-api`, `nova-compute`, `neutron-server`, `keystone`, `glance-api`, `cinder-api`, `cinder-scheduler` | In the trace | |
| Placement | Sends nothing. It keeps a config of its own without `[profiler_otlp]`, so the driver stops as it starts, with `no such option profiler_otlp` in its log | [One line](#placement-one-line) of its code. With `trace_requests` on, `nova-compute` shows its own calls to Placement without it |
| `nova-conductor`, `nova-scheduler` | On 2025.2 they send nothing while they run more than one worker: they make the driver and then fork on eventlet, and nothing a forked worker made arrived. On 2026.2 they run on threads and are in the trace | On 2025.2, [one worker each](#novas-conductor-and-scheduler-one-worker-each) |
| `cinder-volume` | Sends nothing: it always runs each backend in a forked worker, on 2026.2 too | Nothing to set |
| Neutron's RPC server | Sends nothing. It never says it started OSProfiler, and Neutron's API does | Nothing to set |

So on a stock 2025.2 cloud, a span that one of those called arrives with a parent that never does. `nova-compute`'s `build_and_run_instance` is called by `nova-conductor`, so everything `nova-compute` did for a boot is under a span whose parent is missing. The trace is whole otherwise, it says **Not in this trace** above the waterfall, and those services' lines are still in [the logs of that request](#from-a-trace-to-its-logs).

On 2026.2 a trace can also hold what is not its request's, and miss what is. Nova's workers there keep a signed request's context on their threads, so `nova-compute`'s part of attaching a volume arrived under the boot before it, more than a minute after that boot, and not under the attach. A failed boot's conductor spans did the same. Read a trace's times as well as its services.

### Turn on traces

Open your cloud's **Traces** page. It has these steps for whichever tool deployed your cloud, with its paths and variables. None of those tools' guides has been followed on a real deployment of that tool: what has been run is the same config on DevStack, and each guide says so.

:::steps
#### Run the collector on each machine

On every controller and compute node whose services you want traced. It listens on this machine alone, removes what a call was handed, says which cloud and machine a span is from, and forwards the rest over TLS.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-traces.sh
sudo -E bash install-traces.sh
```

#### Give each service the libraries

In the environment each service runs from. Without them a service says so in its log and carries on, untraced. On 2026.2, leave its constraints file out of this one install, because it names 1.44.0.

```bash
pip install 'opentelemetry-sdk<1.44' 'opentelemetry-exporter-otlp<1.44'
```

#### Turn OSProfiler on

Make one key with `openssl rand -hex 32`, and give every service that same key. Anyone holding it can make any request traced, so keep it as you keep a password. Leave `hmac_keys` unset and OSProfiler uses the literal value `SECRET_KEY`. Add this to `nova.conf`, `neutron.conf`, `cinder.conf`, `glance-api.conf` and `keystone.conf`, and restart them.

```ini
[profiler]
enabled = True
hmac_keys = <your key>
connection_string = otlp://127.0.0.1:4318
trace_sqlalchemy = False
```

#### Check each service started it

Each service's own log should hold this line as it starts, and no `Could not initialize driver`:

```text
osprofiler is enabled with connection string: otlp://127.0.0.1:4318
```
:::

### Placement, one line

Without this, a signed request still reaches Placement and works, and Placement's own part of it is not in the trace. With it, a boot crosses Placement, `allocation_candidates` and the instance's allocations included: this was run on 2025.2 and on 2026.2. It is a change to OpenStack's code on your machines, so it is yours to keep across upgrades. Run it with the Python in Placement's environment, add the same `[profiler]` section to `placement.conf`, and restart it:

```bash
sed -i '/profiler\.set_defaults(config)/a\        config.register_opts(profiler._OTLP_OPTS, group="profiler_otlp")' "$(python3 -c 'import placement.wsgi as module; print(module.__file__)')"
```

### Nova's conductor and scheduler, one worker each

On 2026.2 these run on threads, and send spans as they are, so this is for 2025.2. With one worker each they run in the process that made the driver. That was run on 2025.2: with Placement's line too, a boot's trace had no span missing its parent, from `nova-api` through both of them to `nova-compute`, and a failed scheduling showed as a failed span, `No valid host was found`. One worker is also all the capacity each of those processes then has, so this is for a test cloud, or a quiet hour of looking into something, and not for a busy cloud to run on.

```ini title="nova.conf"
[conductor]
workers = 1

[scheduler]
workers = 1
```

OpenStack-Helm's Nova chart sets both to 1 already and scales by pods.

### Trace a request

**Trace a request**, on your cloud's **Traces** page, has the commands for this cloud. They ask for your key without echoing it, which keeps it out of your shell's history and the machine's process list:

```bash
read -rs OS_PROFILE && export OS_PROFILE
openstack server list
openstack server create --wait --flavor <flavor> --image <image> --network <network> oneuptime-trace-test
openstack server delete --wait oneuptime-trace-test
unset OS_PROFILE
```

`openstack --os-profile <key> server create ...` does the same, with the key in your history. Each command prints `Trace ID: ...`, whether or not anything was traced, so paste it into the page to open that trace. Give it a few seconds, because spans are sent in batches. On 2025.2 an API's spans can wait for that worker's next request: 15 seconds after a signed `server list`, `nova-api`'s had not arrived on our test cloud, and they came with the next request.

A signed `server list` crosses `nova-api`, `keystone`, `neutron-server` and `glance-api`. A signed boot adds `nova-compute`, tied to the instance it made. If those are there, it works.

| What you see | What it means |
| --- | --- |
| No `Trace ID` line | The client has no OSProfiler, and ignores your key without it. `pip install osprofiler` where you run `openstack` |
| A `Trace ID`, and no trace | A wrong key is not an error: the request just goes untraced. Check the key, that the service was restarted, its log, and that the collector answers `curl -i -X POST http://127.0.0.1:4318/v1/traces` |
| A span missing its parent | It was called by a service that sends nothing. See [What a trace shows](#what-a-trace-shows) |
| A service hangs or will not answer after a restart | `pip list \| grep opentelemetry-sdk` where it runs. Version 1.44 hangs it as soon as it runs a command. Install below it, or take `[profiler]` off that service. `py-spy dump --pid <worker>` shows it stuck in `TracerProvider._handle_fork`. If it had already hung, restart again after installing below it: on our test cloud the first restart still did not answer, because Nova's API was waiting on Neutron's hung workers, and the next one did. What hung can stay behind a restart too, so kill what is left |

Your traces are on the cloud's **Traces** page, an instance's, a volume's and a network's are on its **Traces** tab, and a service's and an API's on theirs. An instance a request made is found by the requests that named it: a boot's own `POST` cannot name it, and what follows does.

### The control plane

The cloud's **Traces** page draws the control plane from your newest traces: which service called which, how often and how long it took. It is what those requests crossed and no more, so a service no traced request reached is not on it, and a call from a service that sends nothing is not drawn.

### From a trace to its logs

No span holds a request ID, and no log line holds a trace's, because OSProfiler and oslo.log do not know each other. With the [logs profile](#service-logs) on, the card above a trace finds its requests by what the two have in common, and says how sure each is:

| It says | Which means |
| --- | --- |
| Its lines name an instance this trace touched | As good as an ID: on a real boot, this gives the request ID Nova's own instance actions give |
| An API logged the same call at the same moment | Sure, unless someone else made the same call at that moment |
| Only the same services at the same moment | On a quiet cloud that is the request, and on a busy one it may not be |

Each opens [that request](#follow-a-request), across every service, which includes the ones that send no spans.

### What tracing costs

Nothing until a request is signed. With OSProfiler on and nothing signed, a request costs one failed check of a header. OpenStack [gives no figure](https://docs.openstack.org/osprofiler/latest/user/integration.html) for what a signed one costs, and neither do we, because nobody has measured it. A signed request does more work in every service it crosses, sends every span over HTTP from each of them, and carries your key across the message bus in its context. Sign what you are looking into, not traffic.

What has been counted is what a signed boot sends, on one machine's DevStack:

| Settings | On 2025.2: spans, and what the collector sends on | On 2026.2: spans, and what the collector sends on |
| --- | --- | --- |
| The defaults above | About 100, 50 KB | About 180, 80 KB |
| `trace_requests = True` | About 150, 90 KB | About 320, 170 KB |
| `trace_sqlalchemy = True` | About 900, 1 MB | About 1,000, 1 MB |

On 2026.2 `nova-conductor` sends too, and later work lands in the trace, so of those 180 about 130 had arrived 15 seconds after the boot.

With the collector stopped, a signed boot still worked and its spans were lost, so tracing did not get in the request's way.

### What a span holds

OSProfiler's driver copies what a traced call was handed into its span, written out as Python would print it: an instance's admin password and user data, and a volume's connection info. The collector removes `args`, `kwargs`, `result` and `db.params` before they leave the machine, and OneUptime removes them on arrival for a span that came some other way. Nothing turns that off. A statement from `trace_sqlalchemy` is kept with its placeholders, and its values are not.

Your key is in neither. It does travel between a service's own parts, in the context of each message on your message bus, for as long as a signed request lasts.

### Traces on a schedule

A trace only exists when a request is signed, so nothing here traces a cloud on its own. [The lifecycle check](#the-lifecycle-check) signs its own writes when it is given the key, each step in a trace of its own, so a slow boot it sees has a trace. The key is the one place OneUptime holds one: encrypted, write-only, and for that check alone.

## Check the cloud from outside

Every service can report healthy while no one can boot an instance, so the truest test is doing what users do, from where they are. A probe does it from outside the cloud, because a check inside a failed cloud says nothing. Run these on [a probe of your own](/docs/probe/custom-probe), somewhere that reaches the cloud's public endpoints the way your users do. On OneUptime Cloud, shared probes never receive OpenStack credentials.

Both are on the cloud's **Checks** page. [The OpenStack monitor's templates](/docs/monitor/openstack-monitor#checks-from-outside) turn what they find into incidents.

### API checks

Every minute by default, and read-only. Keystone issues a token, each service in the catalog answers an authenticated one-row read, and each endpoint's certificate is read for when it expires. Whatever the catalog names is what gets asked, so there is no list to keep.

A cloud a probe already collects needs one click: **Turn On API Checks** uses the same probe, address and credential. A cloud the agent collects has none of those on a probe, so it asks for them. Any credential that can log in will do, because a service that refuses it has still answered.

It costs one login and one small read per service per region, each minute, with no retries. A credential Keystone refuses is asked again later rather than every minute, because repeating one is what locks an account.

### The lifecycle check

Every 30 minutes by default, and only if you opt in. In a project it has to itself, with a credential of its own, it creates a server, waits for `ACTIVE`, optionally attaches a floating IP and pings it, optionally creates and attaches a volume, then deletes everything. Each step's duration is a series, and a failed run names its step and the fault Nova or Cinder gave.

:::warning
This check writes to your cloud. Everything below is what keeps that to one project, and it is checked before every run.
:::

Create the project, with room for three runs at once, because what a run that died left behind counts against the quota until the janitor removes it:

```bash
openstack project create --domain default --description "OneUptime lifecycle check" oneuptime-checks
openstack quota set --instances 3 --cores 3 --ram 2048 --volumes 3 --gigabytes 3 \
  --floating-ips 3 --secgroups 6 --secgroup-rules 20 --ports 8 oneuptime-checks
openstack user create --domain default --password-prompt oneuptime-check
openstack role add --project oneuptime-checks --user oneuptime-check member
```

Give the project a network to boot on, as that user on that project. The router is only for the floating IP part:

```bash
openstack network create oneuptime-check-net
openstack subnet create --network oneuptime-check-net --subnet-range 192.168.250.0/24 oneuptime-check-subnet
openstack router create oneuptime-check-router
openstack router set --external-gateway public oneuptime-check-router
openstack router add subnet oneuptime-check-router oneuptime-check-subnet
```

Then make its credential, still as that user:

```bash
openstack application credential create --role member oneuptime-check
```

On the **Checks** page, choose **Turn On the Lifecycle Check**, name the project, and paste the credential's ID and secret. Leave the flavor, image and network empty and each run picks them: the small test image if there is one, the smallest flavor that fits it, and the project's one network. If it cannot tell which you mean it says so rather than guessing.

#### What it creates

Everything has a name of exactly this form, in the check's project, and nothing else is ever created:

```text
oneuptime-check-<key>-<when>-<random>-<part>
```

`<key>` is twelve hex characters of a hash of this check, so two checks sharing a project never touch each other's. `<when>` is when the run started, in UTC. `<part>` says what it is:

| Part | What it is | When |
| --- | --- | --- |
| `server` | One server, of the smallest flavor that fits | Every run |
| `sg` | One security group, letting ICMP in from anywhere | With the floating IP part |
| `fip` | One floating IP. A floating IP has no name, so this is its description | With the floating IP part |
| `volume` | One volume, 1 GiB unless you say otherwise | With the volume part |

Nova also makes the server's port, and deletes it with the server.

#### What it may touch

It deletes what a run just made, and what the janitor finds. The janitor deletes something only if all of this holds, and nothing that merely looks similar does:

- Its name is exactly the form above, for this check's key, and for what it is: `oneuptime-check-web`, a copy called `...-server-old` or a volume with a server's name are all left alone.
- It names no other project.
- It is older than two intervals, by both what its name says and what the service says. A run still going is younger than one.
- For a volume, it is attached to nothing this check did not make.

Each run starts with the janitor, so what a crash left behind is gone within two intervals and a run. Until then a run skips itself if something named for the check is younger than a run can take, because a run may still be going, and a run never starts while one is.

#### What it refuses

Before each run, and again before each write, it refuses to go on with a credential that could reach further than the project it was given. A refused run writes nothing, and the page says why.

- Its token is not scoped to a project, or is scoped to another one. After the first run the project's ID is pinned, so a new project of the same name is refused too.
- Any of its roles has `admin` or `service` in its name, or Keystone calls this its admin project.
- It is an application credential created `--unrestricted`, which could make more credentials.
- It can read what only an admin can: every project, every hypervisor or every network agent. A role can be called anything, so this is asked as well as the names.

An application credential is better than a password here, because it cannot be scoped to any other project.

#### Trace a slow boot

Save your [OSProfiler](#trace-requests-through-the-control-plane) key on the **Checks** page and each step's writes are signed, each step its own trace, so a slow boot has a trace holding the boot and nothing else. The waits are not signed, because a signed request does more work in every service it crosses. The key is encrypted and write-only, like the credential: it goes to this probe and into each signature, and comes back from nowhere.

#### Turning it off

Turn the check off and no more runs start. Until nothing named for it is left, the probe keeps running the janitor alone, which is why the credential is kept that long. Then OneUptime forgets the credential and the key, and you can delete the project. Deleting the cloud in OneUptime forgets them at once and clears nothing up, so turn the check off first and wait for the page to stop saying it is clearing up. If the credential is gone first, find what is left by name:

```bash
openstack server list --name '^oneuptime-check-'
openstack volume list --name 'oneuptime-check-'
```

### OpenStack's own tracing

oslo.middleware 8.2.0 and oslo.messaging 18.3.1, on 2026.2, can trace with nothing signed, so they could one day be an always-on feed. We ran them, and OneUptime does not read them yet, because as shipped they do not follow a request across services:

- oslo.messaging on its own sends nothing, and logs `has no attribute 'trace_exporter'` for every call.
- With oslo.middleware's filter added to each API's pipeline, an API call is a trace of its own. A boot made 83 traces, and none crossed two services, because nothing passes the trace along on an outgoing HTTP call. Keystone and Placement have no pipeline to add it to.
- Those spans hold no request ID, and the RPC spans do.

If you turn them on, their spans still reach this cloud's **Traces** page through the collector, under their own names.

## AI agent

The agent's `docker-compose.yml` also runs the **OpenStack AI agent**, `oneuptime-openstack-ai-agent` (image `oneuptime/resource-ai-agent:release`). While OneUptime AI investigates an incident or alert on this cloud it runs read-only `openstack` commands through it — `openstack compute service list --host compute-01`, `openstack server list --all-projects --limit 50 --host compute-01`, `openstack server event list ID`, `openstack network agent list`, `openstack volume service list` — and cites what it ran. There is no `openstack` binary in the agent and no shell: each command becomes one `GET` to the service that answers it, with the agent's own credential. The agent registers with the same `OPENSTACK_CLOUD_NAME` the collector reports, so it serves this cloud.

- **AI investigations are on by default.** Once the agent connects, OneUptime AI investigates incidents and alerts on this cloud with it, and the cloud's **Overview** shows the agent's status. To stop, set `ONEUPTIME_AI_INVESTIGATION=false` where the agent runs. **AI > Agent** has the agent's status, **Test connection**, **Reset agent** and the install instructions, **AI > Insights** what it has done, and **AI > Logs** the commands it ran.
- **It reads, until you say otherwise.** Fixes are off until you opt in twice, and use a credential of their own: see [Fixes](#fixes). Keystone's users, credentials and role assignments, consoles, what a guest printed and Barbican's secrets are off-limits to it, to read or to change.
- **The credential is the hard limit.** It uses the credential in `clouds.yaml` that the exporter reads, so it sees what the level you chose in [Choose how much the agent sees](#choose-how-much-the-agent-sees) lets it see. If you made that credential with access rules, make a new one from the current [rules](https://oneuptime.com/install/openstack-agent/access/application-credential-access-rules.json): they gained a few `GET` paths for the agent (an instance's actions, one network, subnet, router, floating IP, port or image), and the old ones still work for everything else. To use a credential of its own, set `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` and `OPENSTACK_AUTH_URL`, and `OPENSTACK_AI_CLOUDS_FILE=/dev/null` if there is no `clouds.yaml` beside the agent, as with your own exporter.
- **Secrets stay out.** An instance's `user_data`, its admin password, an image's `direct_url` and a volume's `provider_auth`, and the generic secrets every AI agent masks, are removed from the output before it reaches the model or a log.
- `install.sh` starts it with the exporter it bundles (the `openstack-ai-agent` Compose profile). With your own exporter there is no `clouds.yaml` beside it, so it needs a credential of its own and starts when you add that profile to `COMPOSE_PROFILES` in `.env`. `install.sh --without-docker` does not run it: use the Docker install if you want OneUptime AI to read this cloud.
- It runs as the owner of `clouds.yaml` with no capabilities and a read-only root filesystem. Delete the `oneuptime-openstack-ai-agent` service from `docker-compose.yml` if you do not use OneUptime AI. A re-run of `install.sh` puts it back and keeps your edited file as `docker-compose.yml.bak.<timestamp>`, so delete it again after an [upgrade](#upgrading-the-agent).

What it may run and how to troubleshoot it: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#openstack-clouds). OneUptime AI's investigations read this cloud's Needs attention, blast radius, service logs and lifecycle events as well, where you have turned them on.

### Fixes

OneUptime AI can make ten changes on a cloud, and only ten. It never deletes anything, and never touches Keystone, quotas or security groups.

| Tier | The change |
| --- | --- |
| Safe | `openstack server start SERVER-ID`, `openstack server reboot --soft SERVER-ID`, `openstack compute service set --enable HOST nova-compute`, `openstack network agent set --enable AGENT-ID` |
| Riskier | `openstack server reboot --hard SERVER-ID`, `openstack server migrate SERVER-ID [--host HOST]`, `openstack server migrate live SERVER-ID [--host HOST]`, `openstack compute service set --disable --disable-reason "REASON" HOST nova-compute`, `openstack network agent set --disable AGENT-ID` |
| Always asks a person | `openstack server evacuate SERVER-ID... [--host HOST]`, in every mode, whatever the allowlist says. The number of instances an evacuation may touch without asking is zero: Nova only takes one once the host is down, so every evacuation that can run is of a dead hypervisor |
| Denied, whoever approves it | Anything that deletes (`server delete`, `volume delete`, `project delete`...), anything in Keystone, quotas, security groups, `--state` and `--down`, and every command not in this table |

Each change has one spelling, in that order: another flag order, an abbreviation or a flag the real client also takes is refused. So what a person approves, what an allowlist entry names and what runs are the same words. A cold `server migrate` leaves the instance in `VERIFY_RESIZE` until a person confirms it, which OneUptime AI never does.

**Fixes are off until you opt in twice.** On the agent, `ONEUPTIME_AI_ALLOW_WRITES=true` and a credential for changes. On the cloud, **What AI may do** other than Off, or `ONEUPTIME_AI_FIXES` on the agent. A first connection leaves them off, unlike the other kinds of resource.

**Before a person approves a change,** the agent reads what it touches, and the card says how many instances and projects, and which. An evacuation's card also says what state the host is in, and what else it holds that the plan does not name. An evacuation the agent cannot read in full is not proposed. Every fix is a change event on the feed of each part it touched, and on the cloud's, with who approved it.

**Where a change may land.** Both settings take `project:ID`, `host:NAME` and `instance:ID`, separated by commas, each of which may hold a `*`. A project and an instance go by their IDs, because a name can be reused: an entry that names one any other way keeps the agent read-only until it is fixed.

- `ONEUPTIME_AI_PROTECTED_TARGETS` is what is never touched. It wins over every other setting, a write target naming the same thing and a person's approval included. Put the instance this agent runs on here, if it runs on this cloud.
- `ONEUPTIME_AI_WRITE_TARGETS` limits where changes can land. A move that names no `--host` is refused when a host is listed in either: the scheduler could place it anywhere.

The agent reads which project and host an instance is in just before it changes it, with its read credential. What it cannot read, it does not change.

#### The credential for changes

Changes use a credential of their own, and never the one the agent reads with: the agent refuses to run with the same one in both places.

Nova only hands another project's instance to an admin context, in its own code after policy has passed, so no narrower role can restart an instance in someone else's project. So this credential's role is `admin`, and what limits it is everything around that role:

1. **Its own account, on an empty project with no quota.** There is nothing to touch there, and no quota to make anything with.

   ```bash
   openstack role create oneuptime_remediation
   openstack project create --domain default --description "OneUptime fixes: holds nothing" oneuptime-remediation
   openstack quota set --instances 0 --cores 0 --ram 0 --key-pairs 0 oneuptime-remediation
   openstack quota set --volumes 0 --gigabytes 0 --snapshots 0 --backups 0 --backup-gigabytes 0 oneuptime-remediation
   openstack quota set --networks 0 --subnets 0 --ports 0 --routers 0 --floating-ips 0 --secgroups 0 --secgroup-rules 0 oneuptime-remediation
   openstack user create --domain default --password-prompt oneuptime-remediation
   openstack role add --project oneuptime-remediation --user oneuptime-remediation admin
   openstack role add --project oneuptime-remediation --user oneuptime-remediation oneuptime_remediation
   ```

2. **Access rules: four paths, and nothing else.** Logged in as that account on that project, fitted to your cloud:

   ```bash
   curl -fsSLO https://oneuptime.com/install/openstack-agent/access/write-application-credential-access-rules.json
   curl -fsSLO https://oneuptime.com/install/openstack-agent/access/access-rules-for-cloud.py
   openstack catalog list -f json | python3 access-rules-for-cloud.py \
     write-application-credential-access-rules.json > write-access-rules-for-this-cloud.json
   openstack application credential create oneuptime-agent-fixes \
     --role admin --role oneuptime_remediation \
     --access-rules "$(cat write-access-rules-for-this-cloud.json)" \
     --expiration 2027-11-01T00:00:00
   ```

   Access rules need `service_type` set for keystonemiddleware on Nova (`compute`) and Neutron (`network`), and a restart of each.

3. **A policy file, for what access rules cannot see.** `POST /servers/{id}/action` is one path for a start and a forced delete. `access/policy/write-nova.yaml` takes away from the `oneuptime_remediation` role every action on that path the agent never makes, and leaves everyone else's defaults as they are. A stolen credential then starts, reboots, moves and evacuates, and nothing else.

Then give the agent its ID and secret, and restart it:

```bash
ONEUPTIME_AI_ALLOW_WRITES=true
ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID=...
ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET=...
```

Where each way of deploying a cloud keeps those two settings. The first row is the one OneUptime's test rig follows on a real DevStack; the rest say what each tool's own documentation says, and have not been followed on a real deployment:

| Deployment | `service_type` | The policy file |
| --- | --- | --- |
| By hand, packages, or DevStack | `[keystone_authtoken] service_type` in `/etc/nova/nova.conf` and `/etc/neutron/neutron.conf`, then restart their APIs | Merge into `/etc/nova/policy.yaml` |
| Kolla-Ansible | The same section in `/etc/kolla/config/nova.conf` and `/etc/kolla/config/neutron.conf`, then `kolla-ansible reconfigure -t nova,neutron` | `/etc/kolla/config/nova/policy.yaml`, with the same `reconfigure` |
| OpenStack-Ansible | `nova_nova_conf_overrides` and `neutron_neutron_conf_overrides` in `user_variables.yml`, then run each service's playbook | `nova_policy_overrides` in `user_variables.yml` |
| OpenStack-Helm | `conf.nova.keystone_authtoken.service_type` and `conf.neutron.keystone_authtoken.service_type` in each chart's values, then `helm upgrade` | `conf.policy` in Nova's values |
| Atmosphere | The same values, through `openstack_helm_nova_values` and `openstack_helm_neutron_values` | `conf.policy`, through `openstack_helm_nova_values` |
| Canonical Sunbeam | Not offered by the charms, so access rules are not either: this is the plain credential below | Not offered by the charms |
| Red Hat OpenStack on OpenShift | `customServiceConfig` of Nova's and Neutron's API templates in the `OpenStackControlPlane` | `defaultConfigOverwrite` of Nova's API template, as `policy.yaml` |
| Mirantis MOSK | `services` values for Nova and Neutron in the `OpenStackDeployment` | `features.policies` in the `OpenStackDeployment` |

A cloud where you make none of these changes can still use an application credential on that account without `--access-rules`. It works, and it can do everything an admin can, with nothing but the agent's own policy between it and that. Keep that in mind when you decide who may read the agent's `.env`.

### Runbooks for the common failures

The cloud's **AI agent** page offers a runbook for each of these, to add and make your team's own: what to check, with the read to check it by, and which fix it may come to and what tier that fix is. Each is a run of manual steps, for a person to tick off. Nothing in one runs on its own, because a change to the cloud goes through a fix and its policy.

| Failure | The fix it may come to |
| --- | --- |
| Compute service down | Safe: enable it. Riskier: disable it. Always asks a person: evacuate what it held |
| Instance stuck | Safe: start it, or reboot it softly. Riskier: reboot it hard, or move it |
| Volume stuck | By hand: nothing here changes a volume, and resetting its state is for a person who has read the logs |
| Router without an agent | Safe: enable the agent. Riskier: disable it |
| RabbitMQ partition | By hand, on the machines: RabbitMQ is below OpenStack, and no command OneUptime AI has reaches it |
| Galera lost quorum | By hand, on the machines, from the node with the highest `wsrep_last_committed` |

## Run as a systemd service

To start the agent with the machine and restart it when it fails, install its systemd unit. It assumes the agent lives in `/opt/oneuptime-openstack-agent`, where the install script puts it. An install without Docker is a systemd service already.

```bash
sudo curl -fsSL https://oneuptime.com/install/openstack-agent/systemd/oneuptime-openstack-agent.service -o /etc/systemd/system/oneuptime-openstack-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-openstack-agent
```

## Upgrading the agent

The agent reports the collector version its files pin as its **Agent Version**. When this OneUptime pins a newer one, a warning sign appears beside it. Select it to see these commands.

The collector image is pinned in `docker-compose.yml` and its config is a file next to it, so pulling alone does not move the agent forward. Run `install.sh` again, with `sudo` if you installed without Docker: it reuses every value in your existing `.env` and the credential in `clouds.yaml` (nothing is asked again), checks the credential with Keystone, refreshes the agent's files (a file you edited is kept as `<file>.bak.<timestamp>`), pulls the images and recreates the agent so the collector reads its new config.

```bash
curl -fsSL https://oneuptime.com/install/openstack-agent -o install.sh
bash install.sh
```

Installed it with Docker Compose instead? In the agent's folder, download both files again (and make again any change you made to them), then pull the images and recreate the agent:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/docker-compose.yml
curl -fsSLO https://oneuptime.com/install/openstack-agent/otel-collector-config.yaml
docker compose pull
docker compose up -d --force-recreate
```

To change what is in `clouds.yaml`, move the file aside and run the script again, which asks only for the credential. Or export what changes, such as `OPENSTACK_EXPORTER_CLOUDS=RegionOne,RegionTwo` to add a region. The old file is kept as `clouds.yaml.bak.<timestamp>`, as private as it was. It holds the old credential, so delete it once the agent reports with the new one. To replace a credential, make the second one before you delete the first, so the agent never goes without one.

## Uninstalling the agent

```bash
cd /opt/oneuptime-openstack-agent
docker compose down
cd /
sudo rm -r /opt/oneuptime-openstack-agent
```

If it installed in your home folder, use `~/oneuptime-openstack-agent` in those commands, with no `sudo`. If you [run it as a systemd service](#run-as-a-systemd-service), take the unit away first:

```bash
sudo systemctl disable --now oneuptime-openstack-agent
sudo rm -f /etc/systemd/system/oneuptime-openstack-agent.service
sudo systemctl daemon-reload
```

Without Docker:

```bash
sudo systemctl disable --now oneuptime-openstack-agent oneuptime-openstack-exporter
sudo rm -f /etc/systemd/system/oneuptime-openstack-agent.service /etc/systemd/system/oneuptime-openstack-exporter.service
sudo systemctl daemon-reload
sudo rm -r /opt/oneuptime-openstack-agent
sudo userdel oneuptime-openstack
```

Then delete the credential: `openstack application credential delete oneuptime-agent`. If you used the policy overrides, take them out of each service's file, or empty the file (`{}`). Never delete the file.

## With no internet

An agent behind an air gap needs three things from outside it: the install script and its files, which your own OneUptime serves; the images its `docker-compose.yml` runs, which you copy to a registry on your side; and nothing else. The agent only ever sends to your OneUptime URL and reads your cloud.

The images are pinned in `docker-compose.yml`, so what you mirror is exactly what the agent runs:

| Image | Where it comes from | What for |
| --- | --- | --- |
| `otel/opentelemetry-collector-contrib:0.161.0` | Docker Hub | The collector. Always, and the [logs](#service-logs) and [traces](#trace-requests-through-the-control-plane) profiles run the same one |
| `ghcr.io/openstack-exporter/openstack-exporter:2.0.0-alpha@sha256:2a864f41db28a1656a5034e8a17831fb37986e8856fd3f5361586a05f928950a` | GitHub Container Registry | The bundled exporter, and the one that reads project quotas. Not needed if you [run your own exporter](#install-and-start-the-agent) |
| `oneuptime/resource-ai-agent:release` | Docker Hub | The [AI agent](#ai-agent). Not needed if you take its service out of `docker-compose.yml`. The `release` tag moves with each OneUptime release, so copy it again when you upgrade |
| `ghcr.io/vexxhost/openstack-database-exporter:v1.2.0@sha256:cae2c794f14f84f697d802a60b866ce69a99ebcffade7dd5e6e0e46f44457508` | GitHub Container Registry | Only the [database path](/docs/telemetry/openstack-very-large-clouds#the-database-path) |

The two that name a digest are copied by digest, so a mirror that keeps the digest holds the same bytes. On a machine that reaches the internet and your registry, `crane copy` keeps it (`skopeo copy --all --preserve-digests` does too). Or save them to a file with `docker save`, carry it across, and `docker load` it on the agent's machine.

```bash
crane copy otel/opentelemetry-collector-contrib:0.161.0 registry.example.com/otel/opentelemetry-collector-contrib:0.161.0
crane copy ghcr.io/openstack-exporter/openstack-exporter:2.0.0-alpha@sha256:2a864f41db28a1656a5034e8a17831fb37986e8856fd3f5361586a05f928950a registry.example.com/openstack-exporter/openstack-exporter:2.0.0-alpha
crane copy oneuptime/resource-ai-agent:release registry.example.com/oneuptime/resource-ai-agent:release
```

Then, on the agent's machine, run [the install script](#install-and-start-the-agent) as usual, from your own OneUptime. It tries to pull the images, says so when it cannot, and starts with the ones the machine has. With a registry, change each `image:` in `docker-compose.yml` to your copy and run `docker compose up -d`. `install.sh` replaces `docker-compose.yml` each time it runs and keeps your edited one as `docker-compose.yml.bak.<timestamp>`, so make the edit again after an [upgrade](#upgrading-the-agent).

Do not use `--without-docker` behind a gap. It downloads the collector's and the exporter's release archives from GitHub, with no option to download from a mirror instead.

OneUptime's own images cross the gap another way: [Air-Gapped Installation](/docs/installation/air-gapped) covers the platform's, and not the agent's. The agent's images are not in that bundle.

## Troubleshooting

:::details Run the diagnostic script first
The agent ships with a script, [`troubleshoot.sh`](https://oneuptime.com/install/openstack-agent/troubleshoot.sh), that checks the whole chain on the network path the agent uses: the containers or services, `clouds.yaml`, the exporter, DNS, TLS, Keystone, each service in the catalog, the cloud name, and whether OneUptime accepts the ingestion key. OneUptime refuses a bad key with `401` (`422` for a disabled key or a browser key), and the collector drops each refused batch with a single `Exporting failed` log line that is easy to miss.

```bash
curl -fsSL https://oneuptime.com/install/openstack-agent/troubleshoot.sh -o troubleshoot.sh
sudo bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-openstack-agent
```

It reads every path the agent needs with the real credential, one small page at a time, and reports each as **reads everything**, **may be own project only**, **refused** or **not deployed**, with which pages and alerts go without it and what to do. Then it says which level the answers add up to, warns when the credential's own project holds things, and ends with a verdict naming the most likely cause.
:::

:::details No cloud appears in OneUptime
1. Read the collector's logs: `docker logs oneuptime-openstack-agent`, or `journalctl -u oneuptime-openstack-agent` without Docker. A `401` on export means a bad ingestion key; connection refused means a wrong `ONEUPTIME_URL`.
2. Check that the exporter answers. The bundled exporter does not publish its port on the host, so ask from inside its network: `docker run --rm --network container:oneuptime-openstack-exporter curlimages/curl -s "http://localhost:9180/probe?cloud=RegionOne&include_services=identity" | head` should print `openstack_identity_*` lines.
3. Give it one scrape interval: 2 minutes for compute, 5 for identity.
:::

:::details The exporter keeps restarting, or says it cannot read its config
The exporter must be the owner of `clouds.yaml`. Its image runs as uid 65532. Run as root, `install.sh` gives the file to that user; run as anyone else, it runs the exporter as that user instead, and says so in `OPENSTACK_EXPORTER_USER`. Re-run `install.sh` to put it right, or `sudo chown 65532:65532 clouds.yaml` when the variable is unset.
:::

:::details x509 or TLS errors from Keystone
The exporter's image trusts public certificate authorities, not your machine's. Give it the cloud's own: `OPENSTACK_CA_FILE=/path/to/ca.pem bash install.sh`.
:::

:::details Every read answers 401 with an access-rule credential
A service behind a path prefix refuses the shipped rules: fit them to your cloud with `access-rules-for-cloud.py`. Each service also needs `service_type` set for keystonemiddleware, and a restart. Both are under [Create the credential](#install-the-agent), at level 1.
:::

:::details Hypervisors or services are empty
A level 3 credential cannot read them, and neither can a role without the policy overrides. Use level 1, or level 2 with the policy files merged into the file `[oslo_policy] policy_file` names. A file the service does not read changes nothing: the diagnostic script says which reads were refused.
:::

:::details Cinder's services or storage pools are empty
Only level 1 sees `cinder-volume` and `cinder-scheduler` state and storage pools. Cinder's own code answers anything else with `403 User does not have admin privileges`, after policy has already passed, so no override opens them.
:::

:::details Security groups answer 409 Quota exceeded
That is expected at level 2, and harmless. Neutron tries to create a project's default security group when it lists them, and a project with zero quota cannot hold one. There is nothing to fix.
:::

:::details Volumes and routers show only one project
Neutron and Cinder answer anything but an admin with a `200` and only its own project, which looks like it worked. Seeing every project takes level 1. A role on a real project shows that project, and on many clouds lets the account write there.
:::

:::details No instances at level 3
The exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. Use level 1 or 2, or a [probe](/docs/telemetry/openstack-agentless), which can list one project's instances.
:::

:::details One service's data is missing
That is the design working: the others keep reporting. The diagnostic script says whether the service answers. Then read the exporter's log: `docker logs oneuptime-openstack-exporter`, or `journalctl -u oneuptime-openstack-exporter` without Docker. An access-rule credential made from an older copy of the rules does this on Swift, and on Octavia behind a path, even though the script's own reads pass: make a new one.
:::

:::details Every OpenStack service fails after taking a policy file away
On Flamingo and Epoxy, oslo.policy raises on every check once a policy file it has read is gone, and when the service is Keystone the whole cloud answers `503`. Restart the service. To take overrides off, empty the file (`{}`) and never delete it.
:::

:::details A cloud's service logs don't arrive
Read the collector's log: `docker logs oneuptime-openstack-logs` for the files profile, or `journalctl -u oneuptime-openstack-logs` for the journal's. A `401` means a bad ingestion key. If lines arrive under no cloud, `OPENSTACK_CLOUD_NAME` isn't the name the cloud has in OneUptime: run `install-logs.sh` again with the right one.
:::

:::details Lines arrive with no level, request or service
OneUptime reads oslo.log's own formats. A cloud that changed `logging_context_format_string` or `logging_default_format_string` writes something else, and those lines are kept as they are, with nothing read from them. Put the format back, or turn on `use_json`, which reads the same whatever the format says.
:::

:::details The Feed stays empty
Each service needs `driver = log` and a restart, and Nova `notification_format = versioned` as well: see [Turn on notifications](#turn-on-notifications). To check a service, grep its log for `oslo.messaging.notification`. If there's nothing, look at `default_log_levels`: a level above `INFO` for `oslo.messaging` silences most of them. A cloud whose configuration isn't yours to change can use a [probe](#without-notifications).
:::

## Next steps

:::cards
- [OpenStack Monitor](/docs/monitor/openstack-monitor): Alert on services, hypervisors, instances, networks and storage pools.
- [OpenStack Without an Agent](/docs/telemetry/openstack-agentless): Collect a cloud from a probe, with nothing to install.
- [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector): The OS-level view of each controller and hypervisor.
:::
