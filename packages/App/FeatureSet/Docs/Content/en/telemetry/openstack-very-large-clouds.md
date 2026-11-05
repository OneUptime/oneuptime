# Very Large OpenStack Clouds

What a cloud of any size costs before you install anything: how hard monitoring leans on its control plane, how much data it sends, and what OneUptime does differently as a cloud grows. Nearly every cloud needs none of this: the defaults of the [OpenStack Agent](/docs/telemetry/openstack) and a [probe](/docs/telemetry/openstack-agentless) hold up to thousands of instances without anything being set.

:::cards
- [The load on your control plane](#the-load-on-your-control-plane): Requests a minute per service, at each size.
- [The data it sends](#the-data-it-sends): Series and gigabytes a day, from your cloud's counts.
- [Summary mode](#summary-mode): What a cloud past 5,000 instances keeps, and gives up.
- [Sharing a cloud between collectors](#sharing-a-cloud-between-collectors): One agent per region or per service.
- [The database path](#the-database-path): Reading the largest clouds from their databases.
- [What the largest size was held to](#what-the-largest-size-was-held-to): An hour at 200,000 instances, with its budgets and what it measured.
:::

## The load on your control plane

### Through a probe

A probe keeps within a stated load however large the cloud. It asks each service one request at a time, Placement four, reads instances by what changed between full reads, and past a stated number reads what is one call per thing (a hypervisor's usages, a router's agents, a project's quotas) in turns. Each collection sends everything as last read, so no series has a gap: only how fresh those parts are moves.

Requests a minute with the defaults, once a collection has settled, on a cloud with OVN:

| Cloud | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hypervisors, 100 instances, 20 projects | 1.3 | 3.5 | 12.5 | 3.5 | 2.5 | 0.3 |
| 500 hypervisors, 20,000 instances, 1,000 projects | 1.3 | 4.2 | 253 | 7.5 | 8.5 | 0.3 |
| 5,000 hypervisors, 200,000 instances, 10,000 projects | 1.3 | 12.7 | 1,003 | 43.5 | 62.5 | 0.5 |

These are counted, not estimated: a test runs the real collector against a mock API of each size, on a clock it moves itself, and holds what it asked to these numbers exactly, service by service, wherever something different falls due. A request count does not depend on the machine it was counted on.

What each size holds besides its hypervisors, instances and projects is assumed, and a real cloud differs: a volume for every second instance, a snapshot and a backup for every tenth volume, a network, subnet, router and security group per project, a floating IP for every tenth instance, 40 flavors, two Neutron agents per hypervisor, and an image per ten projects, between 10 and 1,000. A list costs a request per thousand rows, so what your cloud really holds moves these only a little. What moves them most:

| What changes | What it costs |
| --- | --- |
| The first collection after a probe starts | One call for each hypervisor's inventories and one for its usages, however many there are |
| ML2/OVS rather than OVN | One call per router to ask which L3 agents hold it, at most 2,000 a collection |
| Instances changing | One call per instance that changed, to Nova, to read what happened to it, at most 25 a collection |
| [Project limits](/docs/telemetry/openstack-agentless#what-it-costs-your-cloud) turned on | Four calls per project, at most 250 projects a collection, so a cloud of 10,000 takes 80 minutes to come round |
| Collecting less often | **Collect every** on the cloud's **Settings** page. Twice as long is half the calls |
| More regions | Everything but Keystone again, per region |

A collection has nine-tenths of its interval, and at most ten minutes, and each service is read one request at a time. So how fast a large cloud's APIs answer decides how often it can be collected: at 200,000 instances and the default two minutes, Nova has to answer each page of its full read in about half a second, and Cinder its lists in about 0.8 of a second. A service that cannot finish reads as down until it does, and the card says **Collecting took too long**. Raise **Collect every**, which lowers the load as well, or use the [database path](#the-database-path).

### Through the agent

The agent's exporter logs in and reads every list whole on every scrape, and it asks Placement three things per hypervisor, one call at a time. Requests a minute with the defaults:

| Cloud | Keystone | Nova | Placement | Neutron | Cinder | Glance |
| --- | --- | --- | --- | --- | --- | --- |
| 10 hypervisors, 100 instances, 20 projects | 3.4 | 3 | 15.5 | 3.5 | 2 | 0.2 |
| 500 hypervisors, 20,000 instances, 1,000 projects | 3.4 | 13 | 751 | 7.5 | 7.5 | 0.2 |
| 5,000 hypervisors, 200,000 instances, 10,000 projects | 3.4 | 106 | 7,501 | 43.5 | 57 | 0.4 |

These are counted from the exporter's source, and the exporter has not been run at these sizes. A scrape has 110 seconds, so a Placement that answers in 20 ms runs out of time at about 1,800 hypervisors, and Nova at a second a page at about 110,000 instances. Past that, a scrape of them fails however gently it was asked. Past those sizes use the [database path](#the-database-path), or a probe.

### When an API slows down

A probe watches what each service usually answers in, and when an answer takes three times that and at least a second, or five seconds whatever is usual, it waits as long as that answer took before asking that service again. Several reads waiting at once take turns, so a pause does not end in a burst. A service that keeps answering `429` or `503` is left alone for a minute, then two, then four, up to half an hour. Nothing else is held up: each service is asked on its own.

The cloud's **Data Collection** card says so while it lasts, service by service: how slow its slowest answer was, and how long the probe held back. The agent's exporter cannot do this. A scrape runs whole, at its interval: raise `scrape_interval` and `scrape_timeout` for that job to go easier on a service.

## The data it sends

A cloud's series follow from its counts. The calculator on a cloud's **Documentation** page in OneUptime works this out from three numbers. To work it out yourself, for one region:

| Series | How many |
| --- | --- |
| Compute | 10 per hypervisor, plus flavors and control services, plus 7 |
| Placement | 15 per hypervisor, plus 4. A probe adds about 2 per flavor, for [how many of each fit](/docs/telemetry/openstack#capacity) |
| Neutron | Agents, networks, routers and floating IPs, 3 per subnet, plus 11. One more per router on ML2/OVS |
| Cinder | Services, snapshots and backups, 2 per storage pool, plus 26 |
| Instances and volumes, unless summary mode is on | 4 per instance, 2 per volume |
| Summary mode's counts, when it is on | One per status and one per project: about 6 plus projects |
| Keystone, Glance | Projects, domains and 9, and 2 per image plus 5. A probe adds 3 for each of Heat and Magnum, whether or not a cloud runs them |

Each scrape's rows are what you are billed for: the first five lines arrive every 2 minutes, 720 times a day, and the last every 5 minutes, 288 times. The price is the one on your bill, [per GB for how long it is kept](/docs/telemetry/openstack#what-it-costs). The bill reads the real size of each row, and this works it out at 1,024 bytes a row, what OneUptime's billing falls back on when it has no size for a row. A row with many labels, such as an instance's, costs more than that, and one with none costs less.

| Cloud | Series | GB a day, every series | GB a day, in summary mode | A month kept 15 days, in summary mode |
| --- | --- | --- | --- | --- |
| 10 hypervisors, 100 instances, 20 projects | 1,069 | 0.7 | Not in summary mode | $2.11 |
| 500 hypervisors, 20,000 instances, 1,000 projects | 123,841 | 84.5 | 16.6 | $49.70 |
| 5,000 hypervisors, 200,000 instances, 10,000 projects | 1,237,177 | 844.5 | 164.9 | $494.72 |

Those are through the agent, with one instance in a thousand in a state that keeps its series. A probe past the summary size sends what has not changed once a cycle rather than every collection, which comes to about 13.2 GB a day at the second size and 116 GB at the third.

Real usage per instance, from libvirt or Ceilometer, is on top of all of this: see [what it costs](/docs/telemetry/openstack#what-it-costs).

## Summary mode

Past 5,000 instances a cloud keeps counts and rows, rather than a series per instance. By that size those series are most of the bill, at about 17 GB a day against 4 GB for everything else, and they say what the rows and the counts already do.

**What it keeps:**

- A row for every part, on every page and list, kept current. Status changes reach it as usual.
- Every series of hypervisors, workers, networks, routers, floating IPs, address pools and storage pools.
- `openstack_nova_instances_by_status` and `openstack_nova_instances_by_project`, in each region.
- The series of any instance or volume in a state an alert watches: in `ERROR`, or stuck in `BUILD`, `RESIZE`, `attaching` and the like. So every [alert template](/docs/monitor/openstack-monitor#pre-built-alert-templates) goes on working, and goes on recovering by itself.

**What it gives up:**

- The history of each settled instance's and volume's status, and a chart or a monitor over those series. `openstack_nova_server_status`, `openstack_cinder_volume_gb` and `openstack_cinder_volume_status` stop for a part once it is settled. A monitor that needs one instance should choose its project, below.
- `openstack_placement_resource_provider_allocations` and `openstack_nova_server_local_gb`, whoever they belong to. A probe stops asking Placement for allocations altogether.

**To keep an instance's series anyway**, open the cloud's **Settings**, then **Real usage per instance**. **Only the projects and aggregates I choose** keeps every instance and volume of those projects, whatever size the cloud is. **Every instance** turns summary mode off for the whole cloud. A probe refuses that past about 480 MiB of metrics per collection, rather than holding that in memory: use the agent for such a cloud.

**Through a probe** there is one more difference. Past the summary size it reads everything every time, and sends only what changed, what someone chose, what an alert watches and a share of the rest. Each part comes round once a cycle, sized so a collection's upload stays about 24 MiB beyond the series that go every time: 6 minutes at 20,000 instances, 44 at 200,000. The **Data Collection** card says how long the cycle is. Two things follow from that:

- **A new cloud's lists fill over its first cycle.** The first collection knows what the cloud holds, and the card says so at once, but its rows arrive a share at a time. The same goes for a probe that has restarted, though the rows it left stay on the pages meanwhile. The card says when they all will have arrived.
- **A part that has gone stays listed a little longer.** It leaves within 15 minutes of nothing reporting it, plus the cycle, plus two reads. So 15 minutes and a few on most clouds, and just over an hour at 200,000 instances. A part that is still there is never removed. A failed read removes nothing, however long it lasts.

## Sharing a cloud between collectors

One agent reads a cloud however many regions it has, and that is what to start with. When one is too much for the machine it runs on or for a scrape's time, give each agent a share. Every one of them sends to the same OneUptime cloud under the same `OPENSTACK_CLOUD_NAME`. Two rules keep a chart and a bill from reading double:

- **Each pair of a region and a service belongs to one agent.** A row is the same row however many agents report it, but each agent's series are stored and billed.
- **Keystone belongs to one agent.** It is one for the whole cloud, whichever region asks it.

**One agent per region** is what most clouds want. List only that region's entries in `clouds.yaml` and `OPENSTACK_EXPORTER_CLOUDS`. Only the first agent keeps Keystone:

```bash
# On the agent for RegionOne, in .env
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionOne]

# On the agent for RegionTwo
OPENSTACK_CLOUD_NAME=prod
OPENSTACK_EXPORTER_CLOUDS=[RegionTwo]
OPENSTACK_AGENT_SERVICES=compute|placement|network|volume|image
```

**One agent per service** is for the largest clouds, where one service's lists are what a scrape cannot finish. `OPENSTACK_AGENT_SERVICES` keeps the jobs it names, and leaves the rest to another agent:

```bash
# Nova and Placement, which take the most
OPENSTACK_AGENT_SERVICES=compute|placement

# And everything else
OPENSTACK_AGENT_SERVICES=identity|network|volume|image
```

Set `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` on an agent that holds a large share: it holds a scrape in memory on its way out, and the default is 512 MiB. A row is vouched for by its own service in its own region, so an agent that stops takes nothing of what another agent reads. Name what a cloud stands on, the `OPENSTACK_RABBITMQ_TARGETS` and the [others like it](/docs/telemetry/openstack#environment-variables), on one agent only. If that agent stops while the others go on, those machines leave the pages after 15 minutes, and come back when it does.

**With probes**, a cloud has one probe. Give a region a probe of its own by connecting it as a cloud of its own, with only that region picked: nothing is counted twice, because each reads only its own region, and each reads Keystone for itself. Each is then a cloud of its own in OneUptime, with its own pages and its own alerts.

## The database path

Past **1,500 hypervisors or 100,000 instances** the agent can read a cloud's databases instead of its APIs, with [`openstack_database_exporter`](https://github.com/vexxhost/openstack_database_exporter). At that size a scrape of the APIs runs out of time, and reads that cannot finish are load for nothing. A database read costs the APIs nothing. It is offered only past that size, because below it the APIs answer well enough and this path gives things up.

**What it asks of you:**

- A read-only account on each service's database: Nova, Nova API, Placement, Neutron, Cinder, Glance and Keystone. A database left out is a service it leaves alone.
- A route from the agent's machine to those databases, which on most clouds are kept well away from anything else. It is one more thing that can read every project's records.
- One exporter per region, and per Nova cell. It reads what you point it at, and a second cell needs a second exporter.
- Its schemas tracking your release. It reads each service's tables directly, so an upgrade of OpenStack can change what it can read before a new version of the exporter does.

**To turn it on**, in `.env`:

```bash
COMPOSE_PROFILES=openstack-database-exporter
# Read from the databases, and from nowhere else: with the two together every series arrives twice.
OPENSTACK_EXPORTER_CLOUDS=[]
OPENSTACK_DATABASE_EXPORTER_TARGETS=[openstack-database-exporter:9180]
# What a hypervisor's full name adds to Nova's host name, so an instance finds its hypervisor.
OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX=.example.org
# oslo.db's form. Each is kept in .env, which only its owner can read.
NOVA_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/nova
NOVA_API_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/nova_api
PLACEMENT_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/placement
NEUTRON_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/neutron
CINDER_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/cinder
GLANCE_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/glance
KEYSTONE_DATABASE_URL=mysql+pymysql://oneuptime:secret@db.example:3306/keystone
# What a database cannot say, from the API: each is one small list a scrape.
OPENSTACK_WORKER_STATE_CLOUDS=[RegionOne]
```

**What it covers.** The same series under the same names, so every page, monitor and alert template reads them the same way. A test holds them to the API exporter's, name by name and label by label.

**What it does not:**

| What | Why, and what happens instead |
| --- | --- |
| Whether each Nova worker is alive | Its `openstack_nova_agent_state` reads 1 for any enabled service, so a stopped `nova-compute` would read up. The agent drops that series, and reads it from Nova's API, which is one small list |
| How full each storage pool is | Each backend reports that to Cinder's scheduler, and it is not in the database. The agent reads it from Cinder's API, which is one more |
| A network's MTU | Reads as not known |
| `openstack_placement_resource_provider_allocations`, a provider's generation | Nothing reads them |
| Quotas and limits per project | It can read them, and at 10,000 projects that is 790,000 datapoints a scrape, so the agent leaves them out. Delete that rule in `otel-collector-config.yaml` to keep them |
| Whether an API answers | `openstack_<service>_up` says whether its database does. A stopped API with a healthy database reads as up, so watch the APIs themselves with a [website monitor](/docs/monitor/website-monitor) |

**How far this is proven.** The series were read from the exporter's source and its own tests at the tag the agent pins, and each line up with what OneUptime reads. It has not been run here against a real database.

## What the largest size was held to

The real collector read a mock API of 5,000 hypervisors, 200,000 instances and 10,000 projects every two minutes for 60 minutes, on a real clock. What it sent went through the real fold and the real writes into a real Postgres, with the Overview's reads and the stale-row sweep running beside them every 30 seconds, and 200 instances changing every collection. Each budget below is asserted, and a run that misses one fails.

| What | Budget | Measured |
| --- | --- | --- |
| Requests a minute, as asked of each service | Exactly what the collector's schedule says, service by service | Exact. Keystone 1.3, Nova 25.1, Placement 1,166, Neutron 43.5, Cinder 62.4, Glance 0.5 |
| Collections skipped because the one before was still running | None | 0 of 30 |
| Ingest lag, from a collection starting to its last row being written | Under 2 minutes | 37 s at the median, 112 s at worst |
| An Overview opening, every read it makes at once | Under 6 seconds | 0.6 s at the median, 4.1 s at worst, and 5,008 bytes of what needs attention |
| The longest any writer waited on a lock on the inventory table | Under 5 seconds | 0.0 s, in 2,739 looks once a second |
| Parts deleted that were still there | None | 0 |

And what it took, which has no budget: 73 MiB of metrics a collection before compression, in up to 2 uploads, 14 s of this process's CPU a collection for reading, sending and writing together, and at most 998 MiB of JavaScript heap. A probe that collects a cloud this size needs that memory on top of its other work.

This ran on a Mac with 10 cores, shared with other work at a load average of about 33, and PostgreSQL 14 on the same machine, so the times are what a busy machine managed rather than what a server would. It was measured on 2026-11-05. An hour's requests hold its first collection, which asks Placement for every hypervisor's inventories, so they read a little above [the table](#through-a-probe) of a settled one, and 200 instances changing every collection is the rest of what Nova's reads there.

The margin is not wide on a machine that busy. An earlier hour, at a load average of about 42 that reached 95, ran as far as one collection's last row landing at 124 seconds, so the next collection was skipped, and every other budget held.

**What this leaves out.** The mock answers at once, so this says nothing about how fast your APIs are: [what a collection's time allows](#through-a-probe) is about that. It leaves out the HTTP server and queue between a probe and ingest, and ClickHouse, so a chart's or a monitor's read of the series is not in here, only the inventory's writes and reads. The rows are shaped like a real DevStack's and the counts are made up. No cloud this size has run against it.

## What the pages read

A large cloud's pages read as fast as a small one's, because none of them reads the whole cloud.

| Page | What it reads |
| --- | --- |
| **Overview** | Counts worked out on the server, and the rows that may need someone. Past 1,000 hosts or workers, the rest are only counted, so what it brings stays under a megabyte however large the cloud is |
| **Services** | The same: a card for each service, what needs someone first, and how many others are fine. A search asks the server, so it finds any host |
| Lists | A page at a time, each from the last row of the page before. A jump to a far page goes by offset, which on the last page of 200,000 rows takes seconds rather than a millisecond |
| **Topology** | Past 5,000 parts, the structure, what has failed and what that takes with it. It says what it left out |
| **Inventory writes** | At most 500 rows to a statement, and 5,000 to a delete, each its own transaction, so no writer waits long on another. A row nothing has changed on is not rewritten for up to 5 minutes, which cuts the write-ahead log more than twentyfold |

## Usage and spend

A cloud's [Spend page](/docs/telemetry/openstack#spend) reads the inventory's rows rather than any instance's series, so it works the same in summary mode, and its cost grows with projects rather than instances. It reads one row of the cloud and one page of projects. [Its own section](/docs/telemetry/openstack#at-each-size) has the numbers at each size.

## Next steps

:::cards
- [OpenStack Agent](/docs/telemetry/openstack): Install the agent.
- [OpenStack Without an Agent](/docs/telemetry/openstack-agentless): Collect a cloud with a probe.
- [OpenStack Monitor](/docs/monitor/openstack-monitor): Alert on what arrives.
:::
