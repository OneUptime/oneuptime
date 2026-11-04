# OneUptime OpenStack Agent

Monitor an OpenStack cloud with OneUptime: its services and agents, hypervisors, instances, networks, routers, volumes, storage pools, images and projects, in every region.

The agent is two pinned upstream programs and their configuration. [openstack-exporter](https://github.com/openstack-exporter/openstack-exporter) reads the cloud's APIs and turns them into `openstack_*` series. A stock OpenTelemetry Collector asks it for one OpenStack service at a time, stamps every series with the cloud and region it came from, and ships them to OneUptime over OTLP. The OpenTelemetry Collector has no OpenStack receiver of its own, and the exporter is what operators already know: Kolla-Ansible ships it.

One agent watches one cloud: one Keystone, with one region or several. It only ever reads, and nothing in it runs on your controllers or compute nodes.

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, or, to [install without Docker](#quick-start-without-docker), a Linux machine (x86_64 or arm64) with systemd 235 or later and root
- A route from that machine to Keystone and to each service's public endpoint
- A credential for the cloud: see [Access](#access)
- A **OneUptime Telemetry Ingestion Key**: create one from *Project Settings → Telemetry Ingestion Keys*

## Where to run it

Run the agent outside the cloud it watches: a small VM on separate hardware, a management host, another cloud. An agent inside a cloud that has failed goes quiet with it, and quiet looks like a healthy cloud that stopped reporting. All it needs is the route above.

## Access

OpenStack has no global read-only role, and that is the hardest thing about monitoring it. VMware's "use the Read-Only role" has no equal here:

- `reader` is scoped to a project everywhere except Keystone and Ironic.
- Hypervisors, services, agents, pools and Placement default to admin.
- A `policy.yaml` override cannot open all-project lists in Neutron or Cinder, which scope those by admin context in their own code. Nova's developers say API policy alone is not enough there either.
- Neutron and Cinder answer a plain reader with a `200` and only that reader's own project. It looks like it worked, and it did not.
- Where Cinder has `enforce_new_defaults` off, which is Cinder's own default, any role on a project can create that project's volumes, including `reader` and `oneuptime_monitoring`. Seen on Epoxy, Flamingo and Gazpacho. A read-only role on a real project is not read-only there.

So there are three levels, and each one costs something. Start with the first if you can.

| Level | What it needs | What it sees | What goes without |
|-------|---------------|--------------|-------------------|
| **1. Full view** | An application credential on an account with `admin` on a project of its own, limited by access rules to reading | Everything the agent reads | Nothing. With access rules it cannot write |
| **2. Infrastructure only** | The `oneuptime_monitoring` role on a project of its own that holds nothing and has zero quota, and the policy overrides in `access/policy/` | Hypervisors, services, agents, address pools, storage pools, Placement and the project list: control-plane health and capacity | Instances, volumes and routers appear only for projects the role is assigned on, and on many clouds a role on a project can also write there. No policy line changes that for Neutron or Cinder |
| **3. Project view** | Plain `reader` on chosen projects, for a team watching its own part of a cloud someone else runs | Those projects' volumes and networks | All infrastructure: no hypervisors, services, agents, pools or capacity. Through the agent, no instances either. And on many clouds `reader` can write there |

`Tests/Ops/openstack-e2e/access-matrix.sh` runs each level on a real cloud in CI, compares every list with what an admin sees, and fails if the credentials we recommend at levels 1 and 2 can write.

Whichever you choose, [`troubleshoot.sh`](#troubleshooting) reads every path with the real credential and tells you what it can see.

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

Access rules need `service_type` set for keystonemiddleware on each service, and a restart of that service:

```ini
# nova.conf, for example. neutron.conf: network. cinder.conf: block-storage, or volumev3 on an older catalog. glance-api.conf: image. placement.conf: placement.
[keystone_authtoken]
service_type = compute
```

Without it, the service refuses the credential with a `401`. If you will not make that change, make the same credential without `--access-rules`: a plain admin application credential. It works, and it can write, so `troubleshoot.sh` labels it as one.

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

The project holds nothing and has zero quota on purpose. Where Cinder has `enforce_new_defaults` off, any role on a project can create that project's volumes. With nothing to touch and no quota to make anything with, there is nothing for it to write.

Merge each file in `access/policy/`, on every controller, into the file named by `[oslo_policy] policy_file` in that service's config (`nova.conf`, `neutron.conf` and so on). That is `/etc/nova/policy.yaml`, and so on, unless your deployment says otherwise: DevStack says `policy.json`. Each rule keeps the service's default and adds the role, and oslo.policy notices a changed file on its own, so no restart is needed. You can download them from your OneUptime:

```bash
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/policy/nova.yaml
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/policy/neutron.yaml
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/policy/cinder.yaml
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/policy/keystone.yaml
curl -fsSLO https://oneuptime.com/install/openstack-agent/access/policy/placement.yaml
```

**To take the overrides off again, empty the file (`{}`) and never delete it.** On Flamingo (2025.2) and Epoxy (2025.1), oslo.policy raises on every check once a policy file it has read is gone, so that service fails every request. When the service is Keystone, it stops validating tokens and the whole cloud answers `503`. If it has already happened, restart the service.

Then, logged in as that account on that project: `openstack application credential create oneuptime-agent --expiration 2027-11-01T00:00:00`.

Putting the role on a real project to see its volumes and routers also lets the account write there, on a cloud where Cinder has `enforce_new_defaults` off. `troubleshoot.sh` warns when the credential's project holds things.

### Level 3: Project view

```bash
openstack role add --project my-team --user my-monitoring-account reader
```

Then, logged in as that account on that project: `openstack application credential create oneuptime-agent --expiration 2027-11-01T00:00:00`. The agent sees that project's volumes and networks and nothing else, and `troubleshoot.sh` says so. Two things to know before you choose this:

- **Through the agent it shows no instances at all.** The exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. Only a OneUptime probe, collecting without this agent, can list one project's instances.
- **It may be able to write.** On a cloud where Cinder has `enforce_new_defaults` off, plain `reader` can create volumes in its project too.

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
2. Installs to `/opt/oneuptime-openstack-agent` and writes `.env` and `clouds.yaml`, both mode `0600`. Nothing secret goes on a command line.
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
COMPOSE_PROFILES=openstack-exporter
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

Already running openstack-exporter, say the one Kolla-Ansible deploys? Point the agent at it, and the bundled one never starts:

```bash
OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh
```

No Keystone URL or credential is asked for: your exporter holds them. It must run with `--multi-cloud`, and its `clouds.yaml` needs an entry named for each region you give, because the collector stamps that name as the region. Turn off what the bundled one turns off, too: see [What it costs](#what-it-costs). From inside the agent's container `localhost` is the container itself, so use an address containers can reach.

## Settings

Answers to the installer. Set any of them in the environment to skip its question, and to change one later. The first group lives in `.env`; `clouds.yaml` alone holds the credential.

| Variable | Required | Description |
|----------|----------|-------------|
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key (*Project Settings → Telemetry Ingestion Keys*) |
| `OPENSTACK_CLOUD_NAME` | Yes | The name this cloud has in OneUptime, stamped on every metric as `openstack.cloud.name`. Keep it stable: changing it registers a new cloud (default: `openstack`) |
| `OPENSTACK_AUTH_URL` | Bundled exporter | The Keystone auth URL. `/v3` is added if it is missing |
| `OPENSTACK_EXPORTER_CLOUDS` | Yes | The regions, comma-separated, with or without square brackets. `.env` holds them in brackets, which the collector reads as a list: `[RegionOne,RegionTwo]` (default: `RegionOne`) |
| `OPENSTACK_EXPORTER_ADDRESS` | No | `host:port` of [your own exporter](#bring-your-own-exporter). Leave it out for the bundled one |
| `OPENSTACK_CA_FILE` | No | A PEM file with the CA of a cloud that has its own. The installer keeps a copy as `ca.pem` next to `clouds.yaml`, and `.env` then says `./ca.pem` |
| `OPENSTACK_EXPORTER_USER` | No | The `uid:gid` the exporter's container runs as, which must own `clouds.yaml`. The installer sets it (default: `65532:65532`) |
| `COMPOSE_PROFILES` | Bundled exporter | `openstack-exporter` starts the bundled exporter. The installer sets it |

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

Each service also reports `openstack_<service>_up` (`openstack_nova_up`, `openstack_neutron_up`, ...). Every series carries:

- `openstack.cloud.name` and `oneuptime.agent.version`, as resource attributes;
- `openstack.region.name`, as a datapoint attribute, from the name of the `clouds.yaml` entry;
- `openstack_service`, the job's OpenStack service (`compute`, `network`, ...).

Do not remove the `transform/openstack-identity` processor, or the two deletes of `service.name` and `service.instance.id` in the `resource` processor: monitor filters match on equality, and without the deletes the data would register a phantom Service instead of reaching the cloud.

## What it costs

Monitoring must never be what takes a cloud down, so the defaults are gentle. Each scrape logs in to Keystone again and makes real API calls. Each of these is changed in one place:

| Setting | Default | Turning it on or changing it gives you | What it costs |
|---------|---------|---------------------------------|---------------|
| Slow metrics | Off | Quotas and limits per project, and usage per server: the list is below | One call per project per scrape, so it grows with the number of projects |
| Per-port series | Off | `openstack_neutron_port`, `openstack_neutron_ports`, `openstack_neutron_ports_no_ips`, `openstack_neutron_ports_lb_not_active` | An unscoped list of every port. On a large cloud that [can saturate Neutron and cause cascading failures](https://github.com/openstack-exporter/openstack-exporter/issues/540), so leave it off unless you know your port count is small |
| Scrape intervals | 2 and 5 minutes | Fresher data, or less load | Twice as often is twice the API calls. Keep each `scrape_timeout` under its `scrape_interval`, so a slow scrape never stacks on the one before |

- **Slow metrics:** delete the `--disable-metric` line for what you want, from the exporter's `command` in `docker-compose.yml`, or from `ExecStart` in `oneuptime-openstack-exporter.service` without Docker. The cost is one call per project per scrape:

  | Delete | To collect |
  |--------|------------|
  | `--disable-metric=nova-quota_cores` | `openstack_nova_quota_*` |
  | `--disable-metric=nova-limits_vcpus_max` | `openstack_nova_limits_*` |
  | `--disable-metric=neutron-quota_network` | `openstack_neutron_quota_*` |
  | `--disable-metric=cinder-limits_volume_max_gb` | `openstack_cinder_limits_*`, `openstack_cinder_volume_type_quota_gigabytes` |
  | `--disable-metric=nova-server_local_gb` | `openstack_nova_server_local_gb`, usage per server. This one is a single usage report that walks every server rather than a call per project, and it is slow on a large cloud all the same |

  Each flag names the series that reads the rest of its row, which is why one line turns them all off. Do not use the exporter's own `--disable-slow-metrics` instead: it also takes `openstack_glance_image_*`, the image list the Images page reads with one call.
- **Per-port series:** delete the four `--disable-metric=neutron-port*` lines, in the same place.
- **Intervals:** change `scrape_interval` and `scrape_timeout` under a job in `otel-collector-config.yaml`.

Then `docker compose up -d --force-recreate`, or `sudo systemctl daemon-reload` and restart both services without Docker. An upgrade replaces these files and keeps your copy as `<file>.bak.<timestamp>`, naming it at the end, so re-apply your edit afterwards.

Two more lines stay in, because you will not miss them. `--disable-metric=neutron-subnets_total` leaves out many series saying what the address pools already say (`openstack_neutron_subnets_total`, `openstack_neutron_subnets_used`, `openstack_neutron_subnets_free`). `--disable-metric=nova-security_groups` leaves out a read of a route Nova no longer has, which would only fill the exporter's log.

To read internal endpoints rather than public ones, add `--endpoint-type=internal` in the same place.

### Upstream issues this is designed around

openstack-exporter is the collector operators know, and three of its open issues matter here. The project has also [asked for maintainers](https://github.com/openstack-exporter/openstack-exporter/issues/443).

- [Issue 660](https://github.com/openstack-exporter/openstack-exporter/issues/660): one failing service empties a whole scrape. So there is one scrape job per service. Do not merge them.
- [Issue 540](https://github.com/openstack-exporter/openstack-exporter/issues/540): an unscoped port list can saturate Neutron. So the per-port series are off, and `troubleshoot.sh` asks for one small page of ports.
- [Issue 244](https://github.com/openstack-exporter/openstack-exporter/issues/244): scrapes time out on larger clouds. So intervals are minutes rather than seconds, each with a timeout under it. If `openstack_*_up` goes missing for one service on a large cloud, raise that job's interval and timeout before anything else.

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

That is the design working: the others keep reporting. `troubleshoot.sh` says whether the service answers. Then look at the exporter's log: `docker logs oneuptime-openstack-exporter`, or `journalctl -u oneuptime-openstack-exporter` without Docker.

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
