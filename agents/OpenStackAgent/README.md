# OneUptime OpenStack Agent

Monitor an OpenStack cloud with OneUptime: its services and agents, hypervisors, instances, networks, routers, volumes, storage pools, images and projects, in every region.

The agent is two pinned upstream programs and their configuration. [openstack-exporter](https://github.com/openstack-exporter/openstack-exporter) reads the cloud's APIs and turns them into `openstack_*` series. A stock OpenTelemetry Collector asks it for one OpenStack service at a time, stamps every series with the cloud and region it came from, and ships them to OneUptime over OTLP. The OpenTelemetry Collector has no OpenStack receiver of its own, and the exporter is what operators already know: Kolla-Ansible ships it.

One agent watches one cloud: one Keystone, with one region or several. It only reads, unless you opt in to the [AI agent's fixes](#fixes), and nothing in it runs on your controllers or compute nodes.

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, or, to [install without Docker](#quick-start-without-docker), a Linux machine (x86_64 or arm64) with systemd 235 or later, glibc 2.34 or later (RHEL 9, Ubuntu 22.04, Debian 12) and root
- A route from that machine to Keystone and to each service's public endpoint
- A credential for the cloud: see [Access](#access)
- A **OneUptime ingestion key**: create one from *Project Settings → Telemetry & APM → Ingestion Keys*

## Where to run it

Run the agent outside the cloud it watches: a small VM on separate hardware, a management host, another cloud. An agent inside a cloud that has failed goes quiet with it, and quiet looks like a healthy cloud that stopped reporting. All it needs is the route above.

## Access

OpenStack has no global read-only role, and that is the hardest thing about monitoring it. VMware's "use the Read-Only role" has no equal here:

- `reader` is scoped to a project everywhere except Keystone and Ironic.
- Hypervisors, services, agents, pools and Placement default to admin.
- A `policy.yaml` override cannot open all-project lists in Neutron or Cinder, which scope those by admin context in their own code.
- Cinder's services and storage pools answer anything but an admin with a `403`, from Cinder's own code, after policy has already passed. No override opens those either.
- Neutron and Cinder answer a plain reader with a `200` and only that reader's own project. It looks like it worked, and it did not.
- Where Cinder has `enforce_new_defaults` off, which is Cinder's own default, any role on a project can create that project's volumes, including `reader` and `oneuptime_monitoring`. On Epoxy, Flamingo and Gazpacho a plain reader and the role on a real project both created a volume (`202`). On Hibiscus both were refused (`403`), because DevStack only turns `enforce_new_defaults` on there. A read-only role on a real project is not read-only.

So there are three levels, and each one costs something. Start with the first if you can.

| Level | What it needs | What it sees | What goes without |
|-------|---------------|--------------|-------------------|
| **1. Full view** | An application credential on an account with `admin` on a project of its own, limited by access rules to reading, with `service_type` set on each service | Every read the agent makes, and `cinder-volume` and `cinder-scheduler` state and storage pools, which only this level sees | Keystone's users and groups, on purpose. It cannot write: every write answered `401` |
| **2. Infrastructure only** | The `oneuptime_monitoring` and `reader` roles on a project of its own that holds nothing and has zero quota, and the policy overrides in `access/policy/` | All of Keystone's projects, domains, services and endpoints, all of Nova including every project's servers, all of Placement, and Neutron's agents and IP availabilities | Neutron's networks, subnets, routers, floating IPs and ports, and Cinder's volumes and snapshots, are only its own project's, so on an empty project just the shared and external ones. No `cinder-volume` or `cinder-scheduler` state or storage pools. It cannot write: every write answered `403`, or `409` and `413` from quota |
| **3. Project view** | Plain `reader` on a real project, for a team watching its own part of a cloud someone else runs | That project's volumes, networks and routers, from Cinder and Neutron | All infrastructure: no hypervisors, services, agents, pools or capacity. Through the agent, no instances either, because the exporter's all-projects read is refused. And on many clouds `reader` can write there |

`Tests/Ops/openstack-e2e/access-matrix.sh` runs each level on a real cloud in CI, compares every list with what an admin sees, and fails if the credentials we recommend at levels 1 and 2 can write.

Whichever you choose, [`troubleshoot.sh`](#troubleshooting) reads every path with the real credential and tells you what it can see.

### What each level reads

This is what five real clouds answered, on Epoxy, Flamingo, Gazpacho (OVN and OVS) and Hibiscus. `Tests/Ops/openstack-e2e/access-table.py` writes it from those recordings.

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

Octavia, Ironic, Heat, Magnum, Manila, Designate, Barbican, Swift, Trove and Gnocchi are not here because those clouds do not run them. `troubleshoot.sh` asks them too, where a cloud does.

What the agent's exporter got with each, in series per service. The counts follow what a cloud holds when it is asked, so compare them with each other and not with yours:

| Exporter service | Admin | Level 1: Full view | Level 2: Infrastructure only | Level 3: Project view |
| --- | --- | --- | --- | --- |
| identity | 14 | 13 | 13 | 4 |
| compute | 33 | 33 | 33 | 15 |
| placement | 25 | 25 | 25 | 1 |
| network | 36 to 40 | 36 to 40 | 24 to 26 | 14 |
| volume | 33 | 33 to 41 | 23 | 29 to 37 |
| image | 4 | 4 | 4 | 4 |

### Level 1: Full view

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

It prints the `id` and `secret`; the secret is shown only once. Give it an expiry and never `--unrestricted`, which would let it make more credentials.

An access rule is matched against the path the service sees. A service behind a path prefix, like `https://cloud.example/compute/v2.1`, sees `/compute/v2.1/servers`, and refuses the shipped rule for `/v2.1/servers` with a `401`. `access-rules-for-cloud.py` adds each rule again under its service's prefix, read from your catalog, and keeps the original, so on a cloud that gives each service its own port it changes nothing that matters.

Two of the exporter's reads take rules that are easy to miss by hand. It reads Octavia's root before anything else, and behind Apache a service sees that as `/load-balancer//`, with two slashes. Refused, the exporter answers an empty `200`, so the cloud looks as if it doesn't run Octavia. And it lists Swift's account with a trailing slash, which `/v1/*` doesn't match. Refused, `openstack_object_store_up` reads `0`. The fitted rules carry both. A credential's rules can't be changed, so if yours was made from an older copy of them, make a new one.

Access rules need `service_type` set for keystonemiddleware on each service, and a restart of that service:

```ini
# nova.conf, for example. neutron.conf: network. cinder.conf: block-storage. glance-api.conf: image. placement.conf: placement.
[keystone_authtoken]
service_type = compute
```

The same for the services a cloud may not run, where yours runs them:

| Config file | `service_type` |
|-------------|----------------|
| `octavia.conf` | `load-balancer` |
| `ironic.conf` | `baremetal` |
| `heat.conf` | `orchestration` |
| `magnum.conf` | `container-infra` |
| `manila.conf` | `sharev2`. The rules also carry `shared-file-system`, for a Manila configured that way |
| `designate.conf` | `dns` |
| `barbican.conf` | `key-manager` |
| `trove.conf` | `database` |
| `gnocchi.conf` | `metric` |
| `cloudkitty.conf` | `rating`, for a probe, since the exporter doesn't read CloudKitty |
| `proxy-server.conf`, under `[filter:authtoken]` | `object-store`, and `include_service_catalog = True` beside it. keystonemiddleware checks the rules against the token's catalog, so with `False`, which DevStack sets, Swift answers the credential `500` |

On the services a cloud may not run, what each level got on real clouds differs from the tables above in four ways:

- **Ironic** answers a project's credential, an admin's too, with only the nodes that project owns, and refuses its conductors. Only system scope reads every node and the conductors, and the agent's credential is on a project. To read a node with it, make its project the owner: `openstack baremetal node set --owner`.
- **Swift** lists the credential's own project's containers, and no other. Another project's account answers `403` unless the credential has `ResellerAdmin`.
- **Barbican** answers a credential about its own project alone, and refuses a plain reader. OneUptime reads no secret.
- **Gnocchi** lets any role on a project create a metric, so on a cloud that runs it, level 2 and level 3 can write there.

The rules also carry `volume` and `volumev3`, for a Cinder configured that way. Keystone needs nothing.

Without `service_type`, the service refuses the credential with a `401`. With the rules fitted, `service_type` set and the APIs restarted, every read answered `200` and every write `401`, on every release we record. The exporter gets what an admin gets, except Keystone's users and groups, on purpose. That holds on the services a cloud may not run too: recorded on DevStack, level 1 got the same series as an admin's credential from each one the exporter reads, and every write answered `401`.

If you will not make that change, make the same credential without `--access-rules`: a plain admin application credential. It works, and it can write, so `troubleshoot.sh` labels it as one.

### Level 2: Infrastructure only

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

Neutron's `GET /security-groups` answers this project `409 Quota exceeded`, because it tries to create the project's default group. That is harmless, and `troubleshoot.sh` reads it as expected.

Merge each file in `access/policy/`, on every controller, into the file named by `[oslo_policy] policy_file` in that service's config (`nova.conf`, `neutron.conf` and so on). That is `/etc/nova/policy.yaml`, and so on, unless your deployment says otherwise: DevStack says `policy.json`. Each rule keeps the service's default and adds the role, and oslo.policy notices a changed file on its own, so no restart is needed. You can download them from your OneUptime:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/policy/nova.yaml
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/policy/neutron.yaml
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/policy/keystone.yaml
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/policy/placement.yaml
```

There is no file for Cinder. Its `os-services` and `scheduler-stats/get_pools` answer the role with `403 User does not have admin privileges`, on all five clouds we record. That comes from Cinder's own code requiring an admin context, after policy has already passed, so no override can open them. So this level does not see `cinder-volume` or `cinder-scheduler` state or storage pools. Only level 1 does, and the **Block Storage Service Down**, **Storage Pool Warning** and **Storage Pool Critical** alerts need it.

**To take the overrides off again, empty the file (`{}`) and never delete it.** On Flamingo (2025.2) and Epoxy (2025.1), oslo.policy raises on every check once a policy file it has read is gone, so that service fails every request. When the service is Keystone, it stops validating tokens and the whole cloud answers `503`. If it has already happened, restart the service.

Then, logged in as that account on that project: `openstack application credential create oneuptime-agent --expiration 2027-11-01T00:00:00`.

Putting the role on a real project to see its volumes and routers also lets the account write there, on a cloud where Cinder has `enforce_new_defaults` off. `troubleshoot.sh` warns when the credential's project holds things.

### Level 3: Project view

```bash
openstack role add --project my-team --user my-monitoring-account reader
```

Then, logged in as that account on that project: `openstack application credential create oneuptime-agent --expiration 2027-11-01T00:00:00`. The agent sees that project's rows from Cinder and Neutron and no infrastructure, and `troubleshoot.sh` says so. Three things to know before you choose this:

- **Through the agent it shows no instances at all.** The exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. Only a OneUptime probe, collecting without this agent, can list one project's instances.
- **It may be able to write.** On a cloud where Cinder has `enforce_new_defaults` off, plain `reader` can create volumes in its project too. On Epoxy, Flamingo and Gazpacho it did (`202`), and on Hibiscus it was refused (`403`), because DevStack only turns `enforce_new_defaults` on there. Cinder's own default is off.
- **Placement reads as not answering.** Every call it makes is refused, and the exporter reports that the way it reports a stopped Placement: `openstack_placement_up 0`, on all five clouds we record. The pages can tell, from what else is closed to this credential, and say so. The Placement API Down template can't, so leave that one out at this level.

### Replacing a credential

Make the second credential before you delete the first, so the agent never goes without one: create the new one, [give it to the agent](#upgrading), check the cloud still reports, then delete the old one with `openstack application credential delete`.

## Quick Start: Install Script

```bash
curl -fsSL https://oneuptime.com/install/openstack-agent -o install.sh
bash install.sh
```

Every OneUptime serves this script and the agent's files for its own release, at `<your OneUptime URL>/install/openstack-agent`: on a self-hosted OneUptime, use its URL in place of `https://oneuptime.com` in the commands here. The first line saves the script as `install.sh`, so you can read it before you run it.

The script asks one question at a time: your OneUptime URL, telemetry ingestion key, a stable cloud name, the Keystone auth URL, the region names, the credential (an application credential by default, read without echo; a username and password if you say no to it) and a private CA file if the cloud has its own certificate authority. Every answer also works as an environment variable: see [Settings](#settings).

It then:

1. **Checks the credential with Keystone** (`POST /v3/auth/tokens`) and that each region is in the catalog, before it writes or starts anything. A refusal stops it, with what to fix.
2. Installs to `/opt/oneuptime-openstack-agent`, or to `oneuptime-openstack-agent` in your home folder if you have no rights on `/opt` (it needs only the `docker` group), and writes `.env` and `clouds.yaml`, both mode `0600`. Nothing secret goes on a command line.
3. Starts the agent with Docker Compose.

`clouds.yaml` has one entry per region, **named for the region**, because the exporter's series do not say which region they are from and the collector stamps the entry's name on them as `openstack.region.name`:

```yaml
clouds:
  "RegionOne":
    region_name: "RegionOne"
    identity_api_version: 3
    auth_type: v3applicationcredential
    auth:
      auth_url: "https://keystone.example.com:5000/v3"
      application_credential_id: "..."
      application_credential_secret: "..."
```

The cloud appears in the **OpenStack** section of OneUptime after the first scrapes, within a few minutes.

## Quick Start: Docker Compose

Download the files from your OneUptime into a folder:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/docker-compose.yml
curl -fsSLO https://oneuptime.com/install/openstack-agent/otel-collector-config.yaml
```

Write a `clouds.yaml` next to them, as above, one entry per region. The exporter's image runs as uid 65532, and the file must be readable by that user alone:

```bash
sudo chown 65532:65532 clouds.yaml
sudo chmod 600 clouds.yaml
```

Then a `.env` (`chmod 600 .env`):

```bash
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_TELEMETRY_INGESTION_KEY=your-telemetry-ingestion-key
OPENSTACK_CLOUD_NAME=my-cloud
OPENSTACK_EXPORTER_CLOUDS=[RegionOne,RegionTwo]
COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent
```

And start it: `docker compose up -d`.

## Quick Start: Without Docker

```bash
curl -fsSL https://oneuptime.com/install/openstack-agent -o install.sh
sudo bash install.sh --without-docker
```

The same questions, the same check with Keystone and the same files, but it runs the upstream releases of the same two programs as systemd services. Each release archive is held to a sha256 pinned in `install.sh`, and a download that does not match stops the install before anything changes.

| Installed | What it is |
|-----------|-----------|
| `/opt/oneuptime-openstack-agent/otelcol-contrib`, `openstack-exporter` | The binaries, at the versions `docker-compose.yml` pins |
| `oneuptime-openstack-agent.service` | The collector, as a throwaway unprivileged user (`DynamicUser=yes`) with no capabilities and nothing it can write to. It never sees the OpenStack credential |
| `oneuptime-openstack-exporter.service` | The exporter, as the `oneuptime-openstack` system user, the only account that can read `clouds.yaml`. It listens on `127.0.0.1:9180` alone |

`.env` here is read by systemd rather than by Docker Compose, so if you edit it, keep values in double quotes, with each `\` written `\\` and each `"` written `\"`, while `$`, `#`, `'` and spaces go in as they are.

Run one agent per cloud: if you are moving off the Docker install, run `docker compose down` first, or every metric arrives twice. `install.sh --without-docker` on a Docker install's folder keeps its answers.

## Run as a systemd Service

To survive reboots without relying on Docker's restart policy alone, install the provided unit:

```bash
sudo curl -fsSL https://oneuptime.com/install/openstack-agent/systemd/oneuptime-openstack-agent.service -o /etc/systemd/system/oneuptime-openstack-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-openstack-agent
```

The unit assumes the agent lives in `/opt/oneuptime-openstack-agent` (the install script default). It wraps Docker Compose; the install without Docker is a systemd service already.

## Bring your own exporter

Already running openstack-exporter? Point the agent at it, and the bundled one never starts. No Keystone URL or credential is asked for: your exporter holds them. How depends on how it was started. From inside the agent's container `localhost` is the container itself, so use an address containers can reach.

**With `--multi-cloud`,** as the bundled one runs:

```bash
OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh
```

Its `clouds.yaml` needs an entry named for each region you give, because the collector stamps that name as the region. Turn off what the bundled one turns off, too: see [What it costs](#what-it-costs).

**Without it,** as Kolla-Ansible's and Canonical's charm run. It has no `/probe`, so the collector asks it for everything at once on `/metrics`, every 2 minutes, for one region:

```bash
OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=10.0.0.254:9198 OPENSTACK_CONTROL_PLANE_REGION=RegionOne bash install.sh
```

Kolla-Ansible serves it on its internal VIP on `9198`, behind an HAProxy that gives up after 45 seconds, and pins exporter 1.7.0, which says less than the one the agent pins. On five real clouds the pages went without (`OpenStackExporterStablePages.test.ts` holds this to those recordings):

| Goes without | Because | What it costs |
| --- | --- | --- |
| Everything of Cinder's | It asks the catalog for `volumev3`, and finds no such thing where Cinder registers as `block-storage` | **Volumes** and **Storage pools** stay empty, and **Services** has no Block Storage API, `cinder-volume` or `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** and **Volume Stuck** stay quiet |
| How many instances a hypervisor holds, and its aggregates | Nova's list of hypervisors fails at the newest microversion, which Kolla-Ansible asks for | Those two on **Hypervisors**, and what a lost host says it takes with it. Its vCPUs, memory and disk are still there: they come from Placement |
| Domains | It has no such series | **Domains** stays empty |
| An image's status, visibility and creation date | It has no such labels | Those columns on **Images**. **Image Stuck** stays quiet, so an image stuck on its way to `active` goes unnoticed |
| A network's MTU | It has no such label | That line on a network's page |

## What the cloud stands on

Optional, and off until you name something. The collector can read the exporters a cloud's RabbitMQ, MariaDB, Memcached, HAProxy, OVN, Open vSwitch and libvirt already have, every minute, and the cloud's **Control Plane** card then says how each is. What nobody named, it says is not watched, rather than that it is fine.

Name each in `.env`, then run `docker compose up -d`. A list takes `host:port` targets, and a target can say which region it is in:

```bash
OPENSTACK_RABBITMQ_TARGETS=[10.0.0.11:15692,10.0.0.12:15692,10.0.0.13:15692]
OPENSTACK_MARIADB_TARGETS=[10.0.0.11:9104,10.0.0.12:9104,10.0.0.13:9104]
OPENSTACK_MEMCACHED_TARGETS=[10.0.0.11:9150,10.0.0.12:9150]
OPENSTACK_HAPROXY_TARGETS=[10.0.0.11:9101,10.0.0.12:9101]
OPENSTACK_NETWORK_EXPORTER_TARGETS=[10.0.0.11:1981,10.0.0.21:1981,RegionTwo@10.1.0.21:1981]
OPENSTACK_LIBVIRT_HEALTH_TARGETS=[10.0.0.21:9177]
OPENSTACK_CONTROL_PLANE_REGION=RegionOne
```

On Kolla-Ansible, whose Prometheus already knows all of them, `control-plane-targets.py` prints these for you:

```bash
sudo cat /etc/kolla/prometheus-server/prometheus.yml | python3 control-plane-targets.py --region RegionOne
```

Name every member of a cluster: whether a whole cluster is down is read from all of them. Only a few series of each are kept, so this is little data, and nothing here writes to any of them. [OpenStack by Deployment Tool](https://oneuptime.com/docs/telemetry/openstack-deployment-tools) has each tool's steps, including how far each has been tested, which is not end to end on any of them.

## Traces, with OSProfiler

An optional profile, off until you ask for it, on each controller and compute node whose services you want traced. It is a collector of its own and nothing else from this folder.

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/install-traces.sh
sudo -E bash install-traces.sh
```

It uses Docker Compose where the machine has it, and otherwise a systemd service (`bash install-traces.sh native` asks for that). It listens on `127.0.0.1:4318`, because [OSProfiler's OTLP driver](https://github.com/openstack/osprofiler/blob/master/osprofiler/drivers/otlp.py) can only post plain HTTP, removes what a traced call was handed (`args`, `kwargs`, `result`, `db.params`), stamps the cloud, region and machine, which the driver never says, and forwards the rest to OneUptime over TLS.

It never touches OpenStack's own config. Each service then needs the driver's two libraries, `opentelemetry-sdk` and `opentelemetry-exporter-otlp`, below version 1.44, which [hangs a service as it starts a subprocess](https://github.com/open-telemetry/opentelemetry-python/issues/5789), and this, with a key of your own that is the same on every service:

```ini
[profiler]
enabled = True
hmac_keys = <your key>
connection_string = otlp://127.0.0.1:4318
trace_sqlalchemy = False
```

Nothing arrives until a request is signed with that key: only a signed request is traced, so this is not an always-on feed. The cloud's **Traces** page gives the command, and its guide says how for each deployment tool. On a stock cloud Placement sends nothing, and on 2025.2 `nova-conductor`, `nova-scheduler` and `cinder-volume` do not either: [the docs](https://oneuptime.com/docs/telemetry/openstack#what-a-trace-shows) say which, and what can be done about it.

| Setting | Default | What it is for |
| --- | --- | --- |
| `OPENSTACK_CLOUD_NAME` | asked | The name this cloud has in OneUptime, the one its agent reports under |
| `OPENSTACK_REGION_NAME` | asked, `RegionOne` | The region this machine serves |
| `OPENSTACK_NODE_NAME` | this machine's name | What a span says it came from |
| `OPENSTACK_TRACES_LISTEN_ADDRESS` | `127.0.0.1:4318` | Without Docker: where it listens. For services in containers of their own, such as OpenStack-Ansible's in LXC |
| `OPENSTACK_TRACES_PUBLISH_ADDRESS` | `127.0.0.1` | With Docker: the address the port is published on |

## OneUptime AI agent

`docker-compose.yml` also has `oneuptime-openstack-ai-agent` (image `oneuptime/resource-ai-agent:release`, profile `openstack-ai-agent`). With it, OneUptime AI reads the cloud while it investigates an incident or alert, and cites what it ran. It shares this folder's `.env`, and registers under the same `OPENSTACK_CLOUD_NAME` the collector reports.

It reads, unless you give it what it needs to change something ([Fixes](#fixes)). It runs `openstack` commands written in the CLI's grammar, and there is no `openstack` binary in it and no shell: each read becomes one `GET` to the service that answers it. Keystone's users, credentials and role assignments, consoles and Barbican's secrets are refused. `user_data`, admin passwords, an image's `direct_url` and a volume's `provider_auth` are masked before the output leaves the agent.

`install.sh` starts it beside the exporter it bundles (`COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent`). To start it yourself:

```bash
COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent docker compose up -d
```

- **The credential.** It uses the entry of `clouds.yaml` the exporter reads: what the access level you chose lets that credential see is what it can read. A credential made with access rules needs to be [replaced](#replacing-a-credential) from the current `access/application-credential-access-rules.json`, which gained a few `GET` paths for the agent; until then, the commands those paths answer come back with a `403` and everything else works.
- **Your own exporter.** There is no `clouds.yaml` here then. Make a credential for the agent, and set in `.env`:

  ```bash
  COMPOSE_PROFILES=openstack-ai-agent
  OPENSTACK_AI_CLOUDS_FILE=/dev/null
  OPENSTACK_AUTH_URL=https://keystone.example.com:5000
  ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID=...
  ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET=...
  ```

- **Without Docker.** `install.sh --without-docker` does not run it. Run the Docker install to have OneUptime AI read this cloud.
- **Other settings.** `ONEUPTIME_AI_INVESTIGATION=false` stops investigations. `ONEUPTIME_AI_OPENSTACK_CLOUD` picks another entry of `clouds.yaml`, `ONEUPTIME_AI_OPENSTACK_REGION` and `ONEUPTIME_AI_OPENSTACK_INTERFACE` the region and endpoints a command reads, and `ONEUPTIME_AI_OPENSTACK_CA_FILE` a certificate authority.

What it may run, and how to troubleshoot it: [Infrastructure AI Agents](https://oneuptime.com/docs/ai/infrastructure-ai-agents#openstack-clouds).

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

Where each way of deploying a cloud keeps those two settings. Only the first row has been run, on a real DevStack, where this credential re-enabled a real `nova-compute` and Nova took the evacuation of a dead host's instances, and everything else it tried was refused: reads and other services with a 401, and other actions on a server with a 403. The rest say what each tool's own documentation says, and have not been followed on a real deployment:

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


## Settings

Answers to the installer. Set any of them in the environment to skip its question, and to change one later. The first group lives in `.env`; `clouds.yaml` alone holds the credential.

| Variable | Required | Description |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Ingestion key (*Project Settings → Telemetry & APM → Ingestion Keys*) |
| `OPENSTACK_CLOUD_NAME` | Yes | The name this cloud has in OneUptime, stamped on every metric as `openstack.cloud.name`. Keep it stable: changing it registers a new cloud (default: `openstack`) |
| `OPENSTACK_AUTH_URL` | Bundled exporter | The Keystone auth URL. `/v3` is added if it is missing |
| `OPENSTACK_EXPORTER_CLOUDS` | Yes | The regions, comma-separated, with or without square brackets. `.env` holds them in brackets, which the collector reads as a list: `[RegionOne,RegionTwo]` (default: `RegionOne`) |
| `OPENSTACK_EXPORTER_ADDRESS` | No | `host:port` of [your own exporter](#bring-your-own-exporter). Leave it out for the bundled one |
| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | No | The compute nodes to read real instance usage from through `prometheus-libvirt-exporter`, such as `[compute-01:9177,compute-02:9177]`. Defaults to none: see [Real usage](https://oneuptime.com/docs/telemetry/openstack#real-usage) |
| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | No | The same through Ceilometer's own exporter, such as `[compute-01:9101]`. Defaults to none |
| `OPENSTACK_CA_FILE` | No | A PEM file with the CA of a cloud that has its own. The installer keeps a copy as `ca.pem` next to `clouds.yaml`, and `.env` then says `./ca.pem` |
| `OPENSTACK_EXPORTER_USER` | No | The `uid:gid` the exporter's container runs as, which must own `clouds.yaml`. The installer sets it (default: `65532:65532`) |
| `COMPOSE_PROFILES` | Bundled exporter | `openstack-exporter` starts the bundled exporter, and `openstack-ai-agent` the [AI agent](#oneuptime-ai-agent). The installer sets it |
| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | No | `host:port` of [an exporter running without `--multi-cloud`](#bring-your-own-exporter). `.env` holds it in brackets |
| `OPENSTACK_RABBITMQ_TARGETS`, `OPENSTACK_MARIADB_TARGETS`, `OPENSTACK_MEMCACHED_TARGETS`, `OPENSTACK_HAPROXY_TARGETS`, `OPENSTACK_NETWORK_EXPORTER_TARGETS`, `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | No | [What the cloud stands on](#what-the-cloud-stands-on). The installer keeps them across a re-run, and never asks |
| `OPENSTACK_CONTROL_PLANE_REGION` | No | The region of a target in those lists that does not say its own (default: the first region) |

| Variable | Description |
|----------|-------------|
| `OPENSTACK_APPLICATION_CREDENTIAL_ID`, `OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | An application credential |
| `OPENSTACK_USERNAME`, `OPENSTACK_PASSWORD`, `OPENSTACK_PROJECT_NAME`, `OPENSTACK_USER_DOMAIN_NAME`, `OPENSTACK_PROJECT_DOMAIN_NAME` | A username and password instead. An application credential is better: it can be limited to reading and can expire |
| `OPENSTACK_AGENT_WITHOUT_DOCKER` | `true` is the same as `--without-docker` |
| `OPENSTACK_SKIP_KEYSTONE_CHECK` | `true` installs without asking Keystone first, for when Keystone is down for now or only the containers can reach it |

These have names of their own rather than the `OS_*` ones an openrc file sets, so an admin's sourced openrc never becomes the agent's credential without anyone being asked.

## Collected metrics

One scrape job per OpenStack service, through the exporter's `/probe?cloud=<region>&include_services=<service>`, so a failing Nova leaves only Nova's series missing:

| Scrape job | Every | Timeout | Series |
|------------|-------|---------|--------|
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

Each service also reports `openstack_<service>_up` (`openstack_nova_up`, `openstack_neutron_up`, ...). Every series carries:

- `openstack.cloud.name` and `oneuptime.agent.version`, as resource attributes;
- `openstack.region.name`, as a datapoint attribute, from the name of the `clouds.yaml` entry;
- `openstack_service`, the job's OpenStack service (`compute`, `network`, ...).

Do not remove the `transform/openstack-identity` processor, or the two deletes of `service.name` and `service.instance.id` in the `resource` processor: monitor filters match on equality, and without the deletes the data would register a phantom Service instead of reaching the cloud.

## Bare metal

The `oneuptime-openstack-baremetal` job reads Ironic where the cloud runs it. Ironic shows a project only the nodes it owns (recorded on DevStack), and by its default policy only a system-scoped credential reads them all, or one whose role has `baremetal:node:list_all`. This agent uses one credential for every service, and Nova's lists refuse system scope, so out of the box it reads what the credential's project owns. The Bare Metal page compares that with what Placement holds, and says when the list isn't the whole cloud's.

The exporter has no series for Ironic's conductors, a node's driver, or why a node failed. A probe reads those from Ironic's API, where its credential may. Stopped, Ironic gives the exporter an empty 200, the same as a cloud without it, so the pages say only that it has gone quiet.

## What it costs

Monitoring must never be what takes a cloud down, so the defaults are gentle. Each scrape logs in to Keystone again and makes real API calls. Each of these is changed in one place:

| Setting | Default | Turning it on or changing it gives you | What it costs |
|---------|---------|---------------------------------|---------------|
| Project quotas | Off | How much of each quota a project has used, on its page and under Needs attention, and the Project Quota Nearly Reached alert | Four API calls per project, per region, once an hour (Nova one, Cinder two, Neutron one), from an exporter of their own |
| Slow metrics | Off | Nova's own quota lists and usage per server: the list is below | One call per project per scrape, so it grows with the number of projects |
| Per-port series | Off | `openstack_neutron_port`, `openstack_neutron_ports`, `openstack_neutron_ports_no_ips`, `openstack_neutron_ports_lb_not_active` | An unscoped list of every port. On a large cloud that [can saturate Neutron and cause cascading failures](https://github.com/openstack-exporter/openstack-exporter/issues/540), so leave it off unless you know your port count is small |
| Services a cloud may not run | On | Load balancers, bare metal, stacks, clusters, shares, DNS, object storage, databases and Gnocchi, where the cloud has them | A cloud without one pays one login each 5 minutes. Designate costs one call per zone per scrape, so it grows with the number of zones |
| Scrape intervals | 2 and 5 minutes | Fresher data, or less load | Twice as often is twice the API calls. Keep each `scrape_timeout` under its `scrape_interval`, so a slow scrape never stacks on the one before |

- **Project quotas:** run `install.sh` again with `OPENSTACK_COLLECT_QUOTAS=true`. It starts a second exporter, `openstack-quota-exporter`, that reads nothing else, and the collector asks it once an hour for `openstack_nova_limits_*`, `openstack_neutron_quota_*`, `openstack_cinder_limits_*` and `openstack_cinder_volume_type_quota_gigabytes`. They change slowly, and an exporter reads the same things whichever job asks, so reading them less often takes an exporter of their own. Your own exporter has no such thing: the agent reads what it says, on every scrape.
- **Slow metrics:** delete the `--disable-metric` line for what you want, from the exporter's `command` in `docker-compose.yml`, or from `ExecStart` in `oneuptime-openstack-exporter.service` without Docker. The cost is one call per project per scrape:

  | Delete | To collect |
  |--------|------------|
  | `--disable-metric=nova-quota_cores` | `openstack_nova_quota_*` |
  | `--disable-metric=nova-server_local_gb` | `openstack_nova_server_local_gb`, usage per server. This one is a single usage report that walks every server rather than a call per project, and it is slow on a large cloud all the same |

  The three lines that leave project quotas out of this exporter (`--disable-metric=nova-limits_vcpus_max`, `--disable-metric=neutron-quota_network`, `--disable-metric=cinder-limits_volume_max_gb`) stay in. Deleting them reads them every two minutes as well.

  Each flag names the series that reads the rest of its row, which is why one line turns them all off. Do not use the exporter's own `--disable-slow-metrics` instead: it also takes `openstack_glance_image_*`, the image list the Images page reads with one call. Neutron's list of quotas is an admin's alone at every level but level 1, so `openstack_neutron_quota_*` needs that level.
- **Per-port series:** delete the four `--disable-metric=neutron-port*` lines, in the same place.
- **Intervals:** change `scrape_interval` and `scrape_timeout` under a job in `otel-collector-config.yaml`.

Then `docker compose up -d --force-recreate`, or `sudo systemctl daemon-reload` and restart both services without Docker. An upgrade replaces these files and keeps your copy as `<file>.bak.<timestamp>`, naming it at the end, so re-apply your edit afterwards.

Three more lines stay in, because you will not miss them. `--disable-metric=neutron-subnets_total` leaves out many series saying what the address pools already say (`openstack_neutron_subnets_total`, `openstack_neutron_subnets_used`, `openstack_neutron_subnets_free`). `--disable-metric=nova-security_groups` leaves out a read of a route Nova no longer has, which would only fill the exporter's log. `--disable-metric=gnocchi-total_metrics` leaves out a read of every metric in Gnocchi, page by page, for one count (`openstack_gnocchi_total_metrics`): a Gnocchi can hold millions.

To read internal endpoints rather than public ones, add `--endpoint-type=internal` in the same place.

### Upstream issues this is designed around

openstack-exporter is the collector operators know, and three of its open issues matter here. The project has also [asked for maintainers](https://github.com/openstack-exporter/openstack-exporter/issues/443).

- [Issue 660](https://github.com/openstack-exporter/openstack-exporter/issues/660): one failing service empties a whole scrape. So there is one scrape job per service. Do not merge them.
- [Issue 540](https://github.com/openstack-exporter/openstack-exporter/issues/540): an unscoped port list can saturate Neutron. So the per-port series are off, and `troubleshoot.sh` asks for one small page of ports.
- [Issue 244](https://github.com/openstack-exporter/openstack-exporter/issues/244): scrapes time out on larger clouds. So intervals are minutes rather than seconds, each with a timeout under it. If `openstack_*_up` goes missing for one service on a large cloud, raise that job's interval and timeout before anything else.

## Very large clouds

[Very Large OpenStack Clouds](https://oneuptime.com/docs/telemetry/openstack-very-large-clouds) has what each size costs in requests a minute and gigabytes a day, and says what each of these gives up.

**Past 5,000 instances** OneUptime keeps a row for every part and counts per hypervisor, project and status, and drops the series per instance and per volume of everything settled as they arrive. Nothing here changes. Choose projects to keep under **Real usage per instance** on the cloud's **Settings** page.

**To share a cloud between agents**, give each the same `OPENSTACK_CLOUD_NAME` and its own share. `OPENSTACK_EXPORTER_CLOUDS` names its regions, and `OPENSTACK_AGENT_SERVICES` its services, such as `compute|placement`. A region and a service belong to one agent, and Keystone to one agent for the whole cloud, or their series arrive twice. Set `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` on an agent with a large share: it holds a scrape in memory on its way out, and the default is `512`.

**Past 1,500 hypervisors or 100,000 instances** a scrape of the APIs runs out of time, because the exporter asks Placement three things per hypervisor one call at a time, and reads every instance on every scrape. Those clouds can be read from their databases with [`openstack_database_exporter`](https://github.com/vexxhost/openstack_database_exporter), which the `openstack-database-exporter` profile starts:

| Setting | What it is |
| --- | --- |
| `COMPOSE_PROFILES` | `openstack-database-exporter,openstack-ai-agent`, for that exporter and the [AI agent](#oneuptime-ai-agent), which reads the first entry of `clouds.yaml` here |
| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | `[openstack-database-exporter:9180]`, with `OPENSTACK_EXPORTER_CLOUDS=[]`, or every series arrives twice |
| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | oslo.db's form, with a read-only account: `mysql+pymysql://oneuptime:secret@db.example:3306/nova`. A database left out is a service it leaves alone |
| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | What a hypervisor's full name adds to Nova's host name, such as `.example.org`, so an instance finds the hypervisor it runs on |
| `OPENSTACK_WORKER_STATE_CLOUDS` | The `clouds.yaml` entries to read two small lists from, such as `[RegionOne]`: whether each Nova worker is alive, and how full each storage pool is. A database says neither |

It needs a route from this machine to those databases, and one exporter per region and Nova cell. It cannot say whether an API answers, only whether its database does, so watch the APIs themselves. It has been read from its source and its own tests, and has not been run here against a real database.

To upgrade, run `install.sh` again, as on any agent: it keeps all of this, and checks the credential with Keystone for the entries `OPENSTACK_WORKER_STATE_CLOUDS` names. While the targets are set, it refuses a region in `OPENSTACK_EXPORTER_CLOUDS`, because every series would arrive twice. [`troubleshoot.sh`](#troubleshooting) asks these exporters what the collector asks them, and says which database each can read.

## Upgrading

The collector image is pinned in `docker-compose.yml`, and `otel-collector-config.yaml` reports that pin to OneUptime as the agent's version (`oneuptime.agent.version`).

Re-run `install.sh`, with `sudo` if you installed without Docker:

```bash
curl -fsSL https://oneuptime.com/install/openstack-agent -o install.sh
bash install.sh
```

It reuses every value in your existing `.env` and the credential in `clouds.yaml`, so nothing is asked again; an exported variable still overrides a value. It checks the credential with Keystone, refreshes the agent's files, pulls the images and recreates the containers so the collector reads its new config. A file you edited since `install.sh` installed it is kept next to the new one as `<file>.bak.<timestamp>`, and the script names it at the end.

To change what is in `clouds.yaml`, move the file aside and run the script again, which asks only for the credential. Or export what changes, such as `OPENSTACK_EXPORTER_CLOUDS=RegionOne,RegionTwo` to add a region. The old file is kept as `clouds.yaml.bak.<timestamp>`, as private as it was. It holds the old credential, so delete it once the agent reports with the new one.

## Uninstalling

```bash
cd /opt/oneuptime-openstack-agent
docker compose down
cd /
sudo rm -r /opt/oneuptime-openstack-agent
```

If it installed in your home folder, use `~/oneuptime-openstack-agent` in those commands, with no `sudo`. If you run it as a systemd service, take the unit away first:

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

Then delete the credential: `openstack application credential delete oneuptime-agent`. If you used [the policy overrides](#level-2-infrastructure-only), take them out of each service's file, or empty the file (`{}`). Never delete the file.

## Troubleshooting

### Run the doctor script first

```bash
curl -fsSL https://oneuptime.com/install/openstack-agent/troubleshoot.sh -o troubleshoot.sh
sudo bash troubleshoot.sh                 # add -d <dir> if you installed outside /opt/oneuptime-openstack-agent
```

It checks the whole chain, on the network path the agent uses: the containers or services, `clouds.yaml`, the exporter, DNS, TLS, Keystone, each service in the catalog, the cloud name, and the ingestion key, with a direct answer from OneUptime. OneUptime's OTLP endpoints refuse a bad ingestion key with `401` (`422` for a disabled key or a browser key), and the collector drops each refused batch with a single `Exporting failed` log line that is easy to miss.

### What can this credential read?

The same script reads each path the agent needs, one small page at a time, and reports each one:

| It says | What it means |
|---------|---------------|
| **reads everything** | The answer shows it: a list that is not per project, or rows from projects that are not this credential's |
| **may be own project only** | A `200`, and every row has one project id, the credential's own, or there are no rows to tell by. On a cloud with one project that may be all there is. If you have more, this is Neutron and Cinder's trap, and the pages will show that one project |
| **refused** | `401` or `403` |
| **not deployed** | The service is not in this region's catalog, or the API answers `404` |
| **expected on a project with zero quota** | Neutron's `GET /security-groups` answering `409 Quota exceeded` on a level 2 project. That is harmless, and nothing to fix |

For each gap it says which pages and alerts go without it and what to do, down to the line to add to a `policy.yaml`. Then it says which [level](#access) the answers add up to, and warns when the credential's own project holds things, which it may be able to write to. `--skip-access` leaves all this out.

### No cloud appears in OneUptime

1. Run the doctor. Its last section says what to fix first.
2. Check the collector's log: `docker logs oneuptime-openstack-agent`, or `journalctl -u oneuptime-openstack-agent` without Docker. Export `401`s mean a bad ingestion key, and `connection refused` a wrong `ONEUPTIME_URL`.
3. Give it one scrape interval: 2 minutes for compute, 5 for identity.

### The exporter keeps restarting, or says it cannot read its config

The exporter must be the owner of `clouds.yaml`. Its image runs as uid 65532. Run as root, `install.sh` gives the file to that user; run as anyone else, it runs the exporter as that user instead, and says so in `OPENSTACK_EXPORTER_USER`. Re-run `install.sh` to put it right, or `sudo chown 65532:65532 clouds.yaml` when the variable is unset.

### x509 / TLS errors from Keystone

The exporter's image trusts public certificate authorities, not your machine's. Give it the cloud's own: `OPENSTACK_CA_FILE=/path/to/ca.pem bash install.sh`.

### One service's data is missing

That is the design working: the others keep reporting. `troubleshoot.sh` says whether the service answers. Then look at the exporter's log: `docker logs oneuptime-openstack-exporter`, or `journalctl -u oneuptime-openstack-exporter` without Docker. An access-rule credential made from an older copy of the rules does this on Swift, and on Octavia behind a path, even though the script's own reads pass: make a new one.

### Common Commands

```bash
# Check agent status
docker compose ps

# View collector and exporter logs
docker logs -f oneuptime-openstack-agent
docker logs -f oneuptime-openstack-exporter

# Ask the exporter what the collector asks it (it does not publish its port on the
# host, so run curl inside its network namespace)
docker run --rm --network container:oneuptime-openstack-exporter curlimages/curl -s "http://localhost:9180/probe?cloud=RegionOne&include_services=identity" | head

# Check the collector's own counters (accepted / sent / failed datapoints)
docker run --rm --network container:oneuptime-openstack-agent curlimages/curl -s http://127.0.0.1:8888/metrics | grep -E 'otelcol_(receiver_accepted|exporter_sent|exporter_send_failed)_metric_points'
```

Without Docker, the exporter answers on `127.0.0.1:9180` and the collector's own counters are on `127.0.0.1:8891`.
