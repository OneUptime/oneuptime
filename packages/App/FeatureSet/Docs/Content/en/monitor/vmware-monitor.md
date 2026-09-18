# VMware Monitor

VMware monitoring allows you to monitor the health and performance of your vSphere environment — vCenter Server, ESXi hosts, virtual machines, datastores, clusters, resource pools, and vSAN. OneUptime collects metrics via a pre-configured OpenTelemetry Collector (the **OneUptime VMware Agent**, built on the collector's native `vcenter` receiver) and evaluates them against your configured criteria.

## Overview

VMware monitors use metrics from your vCenter to provide visibility into your virtualization workloads. This enables you to:

- Monitor datacenter, cluster, ESXi host, and per-VM health
- Track CPU, memory, disk, and network usage across hosts and virtual machines
- Catch CPU ready contention, ballooning, and host swapping before guests slow down
- Watch datastores approaching capacity
- Alert on hosts in maintenance mode or unresponsive, on red / yellow vSphere status roll-ups, and on vSAN latency and congestion

## Creating a VMware Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **VMware** as the monitor type
4. Select the vCenter to monitor
5. Configure metric queries and aggregation
6. Configure monitoring criteria as needed

## Configuration Options

### vCenter

Select the vCenter to monitor. A vCenter is one vSphere endpoint the agent connects to — a vCenter Server or a standalone ESXi host — and it is auto-registered the first time the OneUptime VMware Agent ships telemetry from it (keyed by the `vmware.vcenter.name` resource attribute). You do not need to create it manually. Every query the monitor runs is automatically scoped with `resource.vmware.vcenter.name` equal to the selected vCenter's name.

### Resource Filters

Optionally narrow the monitor to one part of the inventory. Each filter is an equality on one of the identity resource attributes the `vcenter` receiver stamps on every series:

| Filter             | Resource attribute                              | Notes                                                                                                                                      |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Datacenter name    | `resource.vcenter.datacenter.name`              | Present on every series                                                                                                                    |
| Cluster name       | `resource.vcenter.cluster.name`                 | Present on cluster, host, VM, and resource-pool series inside a cluster; absent for standalone ESXi hosts and the objects on them          |
| Host name          | `resource.vcenter.host.name`                    | Matches the ESXi host's own series **and** the series of every VM it runs (the receiver stamps the parent host on VM resources)            |
| VM name            | `resource.vcenter.vm.name`                      | One virtual machine                                                                                                                        |
| Datastore name     | `resource.vcenter.datastore.name`               | One datastore                                                                                                                              |
| Resource pool path | `resource.vcenter.resource_pool.inventory_path` | The inventory path (`/DC/host/Cluster/Resources/pool`) rather than the pool name, because pool names are only unique within their parent |

### Metric Queries

Configure one or more metric queries to evaluate. Each query specifies:

- **Metric name** — The VMware metric to query (`vcenter.*` series, see the catalog below)
- **Aggregation** — How to aggregate metric values (Avg, Sum, Max, Min)
- **Filters** — Attribute-based filtering on the datapoint attributes (`status`, `power_state`, `effective`, `disk_state`, `direction`, `object`, `type`) or on the `resource.vcenter.*` identity attributes
- **Group By** — Optionally group by an identity attribute (`resource.vcenter.host.name`, `resource.vcenter.vm.name`, `resource.vcenter.datastore.name`, ...) so each host, VM, or datastore is evaluated independently — one incident per object

You can also create **formulas** that combine multiple metric queries using mathematical expressions — for example a host memory percentage from `vcenter.host.memory.usage / vcenter.host.memory.capacity`, although the receiver already ships ready-made percentages (`vcenter.host.memory.utilization`) for the common cases.

### Identity Attributes

The `vcenter` receiver emits one OpenTelemetry resource per vSphere object and identifies it through **resource attributes** — there is no agent-stamped scope label the way Proxmox has `pve.scope`. Which attributes a series carries tells you what kind of object it describes:

| vSphere object      | Identity resource attributes                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Datacenter          | `vcenter.datacenter.name`                                                                                                      |
| Cluster             | `vcenter.datacenter.name`, `vcenter.cluster.name`                                                                              |
| ESXi host           | `vcenter.datacenter.name`, `vcenter.host.name` (+ `vcenter.cluster.name` when clustered)                                       |
| Virtual machine     | `vcenter.datacenter.name`, `vcenter.host.name`, `vcenter.vm.name`, `vcenter.vm.id` (+ `vcenter.cluster.name`; `vcenter.resource_pool.*` or `vcenter.virtual_app.*`) |
| VM template         | `vcenter.datacenter.name`, `vcenter.host.name`, `vcenter.vm_template.name`, `vcenter.vm_template.id`                           |
| Datastore           | `vcenter.datacenter.name`, `vcenter.datastore.name`                                                                            |
| Resource pool       | `vcenter.datacenter.name`, `vcenter.resource_pool.name`, `vcenter.resource_pool.inventory_path` (+ `vcenter.cluster.name` or `vcenter.host.name`) |

In ClickHouse — and therefore in monitor filters and group-by keys — resource attributes are `resource.`-prefixed (`resource.vcenter.host.name`), while datapoint attributes are bare (`disk_state`, `power_state`, `status`, `effective`, `direction`, `object`, `type`). The receiver's boolean `effective` attribute is stored as the string `"true"` / `"false"`, so filter it with the string. Filter on an identity attribute to scope a query to one object, and group by it to evaluate each object independently.

### Rolling Time Window

Select the time window for metric evaluation:

- Past 1 Minute
- Past 5 Minutes (default)
- Past 10 Minutes
- Past 15 Minutes
- Past 30 Minutes
- Past 60 Minutes

The agent polls vCenter every `VCENTER_COLLECTION_INTERVAL` (2 minutes by default), so a 1-minute window may contain no sample at all — new VMware monitors default to 5 minutes for this reason. Keep the window at 5 minutes or longer, and lengthen it if you raised the collection interval for a large inventory.

## Collected Metrics

The VMware Agent walks the full vSphere inventory every collection interval (2 minutes by default) and emits the series below. Units are the receiver's own OTLP unit metadata: `MHz`, `%`, `MiBy` (mebibytes), `By` (bytes), `KiBy`, `ms`, `us` (microseconds), `{KiBy/s}`, `By/s`, and counts. Metrics marked _off by default_ are not collected until you enable them in `otel-collector-config.yaml` (the shipped config already enables `vcenter.host.memory.capacity`).

### Datacenter

| Metric                               | Unit                | Description                                                                                                                                                    |
| ------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vcenter.datacenter.cluster.count`   | `{clusters}`        | Clusters in the datacenter, fanned out by `status` (`red` / `yellow` / `green` / `gray`). Sum for the total; filter `status = red` for clusters with a critical alarm |
| `vcenter.datacenter.cpu.limit`       | `MHz`               | Total CPU available to the datacenter across every ESXi host                                                                                                   |
| `vcenter.datacenter.datastore.count` | `{datastores}`      | Datastores in the datacenter                                                                                                                                   |
| `vcenter.datacenter.disk.space`      | `By`                | Datastore space across the datacenter, fanned out by `disk_state` (`used` / `available`). used ÷ (used + available) is the datacenter-wide storage utilization |
| `vcenter.datacenter.host.count`      | `{hosts}`           | ESXi hosts in the datacenter, fanned out by `status` and `power_state` (`on` / `off` / `standby` / `unknown`). Filter `status = red` or `power_state = off`      |
| `vcenter.datacenter.memory.limit`    | `By`                | Total physical memory available to the datacenter across every ESXi host                                                                                       |
| `vcenter.datacenter.vm.count`        | `{virtual_machines}` | Virtual machines in the datacenter, fanned out by `status` and `power_state` (`on` / `off` / `suspended` / `unknown`). Filter `power_state = on` for running VMs |

### Cluster

| Metric                              | Unit                          | Description                                                                                                                                                  |
| ----------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vcenter.cluster.cpu.effective`     | `MHz`                         | CPU the cluster can actually schedule — excludes hosts in maintenance mode or unresponsive. Compare with `vcenter.cluster.cpu.limit` for capacity out of service |
| `vcenter.cluster.cpu.limit`         | `MHz`                         | Total CPU of every ESXi host in the cluster, regardless of host state                                                                                         |
| `vcenter.cluster.host.count`        | `{hosts}`                     | ESXi hosts in the cluster, fanned out by `effective` (`"true"` / `"false"`). A host is not effective while in maintenance mode, disconnected, or unresponsive |
| `vcenter.cluster.memory.effective`  | `By`                          | Memory the cluster can actually allocate to VMs — excludes maintenance-mode / unresponsive hosts and ESXi's own reserved memory                                |
| `vcenter.cluster.memory.limit`      | `By`                          | Total physical memory of every ESXi host in the cluster                                                                                                      |
| `vcenter.cluster.vm.count`          | `{virtual_machines}`          | Virtual machines in the cluster, fanned out by `power_state`. Sum for the total; filter `power_state = on` for running VMs                                    |
| `vcenter.cluster.vm_template.count` | `{virtual_machine_templates}` | Virtual machine templates in the cluster                                                                                                                     |

### Host (ESXi)

| Metric                                   | Unit          | Description                                                                                                                                                       |
| ---------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vcenter.host.cpu.capacity`              | `MHz`         | Total CPU capacity of the ESXi host (cores × clock) — the denominator for `vcenter.host.cpu.usage`                                                                |
| `vcenter.host.cpu.reserved`              | `MHz`         | CPU reserved for virtual machines, fanned out by `cpu_reservation_type` (`total` / `used`). `used` approaching `total` means new reservations will fail admission control |
| `vcenter.host.cpu.usage`                 | `MHz`         | CPU currently consumed on the host across every VM and the hypervisor itself                                                                                      |
| `vcenter.host.cpu.utilization`           | `%`           | CPU utilization of the host as a percentage (0–100) of its capacity                                                                                               |
| `vcenter.host.disk.latency.avg`          | `ms`          | Average disk latency (device + kernel time), fanned out by `direction` (`read` / `write`) and `object` (disk device). Requires performance counter level 2         |
| `vcenter.host.disk.latency.max`          | `ms`          | Highest latency observed across every disk the host uses, per `object`, over the latest 20 s interval. Requires performance counter level 3                        |
| `vcenter.host.disk.throughput`           | `{KiBy/s}`    | Kilobytes per second read from or written to the host's disks, by `direction` and `object`. Requires performance counter level 4                                  |
| `vcenter.host.memory.active`             | `MiBy`        | Memory the host's powered-on VMs are actively touching. _Off by default_ — enable `vcenter.host.memory.active` in the agent config                                |
| `vcenter.host.memory.ballooned`          | `MiBy`        | Guest memory reclaimed from the host's VMs by the balloon driver; above 0 means host memory pressure. _Off by default_                                            |
| `vcenter.host.memory.capacity`           | `MiBy`        | Total physical memory of the host — the denominator for `vcenter.host.memory.usage`. Off by default upstream; the shipped agent config enables it                 |
| `vcenter.host.memory.granted`            | `MiBy`        | Machine memory granted to the powered-on VMs on the host. _Off by default_                                                                                        |
| `vcenter.host.memory.usage`              | `MiBy`        | Memory currently consumed on the host, including the hypervisor's own overhead                                                                                    |
| `vcenter.host.memory.utilization`        | `%`           | Memory utilization of the host as a percentage (0–100) of its physical capacity                                                                                   |
| `vcenter.host.network.packet.drop.rate`  | `{packets/s}` | Packets per second dropped on each physical NIC, by `direction` (`transmitted` / `received`) and `object` (e.g. `vmnic0`) — an oversubscribed uplink or a failing NIC |
| `vcenter.host.network.packet.error.rate` | `{errors/s}`  | Packet errors per second on the host's physical NICs, by `direction` and `object` — almost always a cable, SFP, or switch-port fault                             |
| `vcenter.host.network.packet.rate`       | `{packets/s}` | Packets per second transmitted or received on each physical NIC, by `direction` and `object`                                                                     |
| `vcenter.host.network.throughput`        | `{KiBy/s}`    | Kilobytes per second transmitted or received by the host, by `direction` and `object`                                                                            |
| `vcenter.host.network.usage`             | `{KiBy/s}`    | Combined transmit + receive rate across the host's NICs, per `object`                                                                                             |

### Virtual Machine

| Metric                                     | Unit          | Description                                                                                                                                                                   |
| ------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vcenter.vm.cpu.readiness`                 | `%`           | Percentage of time the VM was ready to run but could not be scheduled on a physical CPU (CPU ready). Above 5% the guest feels sluggish; above 10% the host is oversubscribed. Powered-on VMs only |
| `vcenter.vm.cpu.time`                      | `%`           | Time the VM's vCPUs spent in each state, by `cpu_state` (`idle` / `ready` / `wait`) and `object` (vCPU). _Off by default_ — enable `vcenter.vm.cpu.time`                        |
| `vcenter.vm.cpu.usage`                     | `MHz`         | CPU consumed by the VM. Powered-on VMs only — its presence is how OneUptime infers a VM's power state                                                                          |
| `vcenter.vm.cpu.utilization`               | `%`           | CPU utilization of the VM as a percentage (0–100) of its configured vCPUs. Powered-on VMs only                                                                                 |
| `vcenter.vm.disk.latency.avg`              | `ms`          | Average disk latency, by `direction` (`read` / `write`), `disk_type` (`virtual` / `physical`), and `object` (virtual disk). Requires performance counter level 2                |
| `vcenter.vm.disk.latency.max`              | `ms`          | Highest total latency (device + kernel time) the VM saw on any disk over a 20 s interval, per `object`                                                                         |
| `vcenter.vm.disk.throughput`               | `{KiBy/s}`    | Kilobytes per second read from or written to the VM's disks, by `direction` and `object`. Requires performance counter level 2                                                  |
| `vcenter.vm.disk.usage`                    | `By`          | Datastore space consumed by the VM's files, fanned out by `disk_state` (`used` / `available`). Also emitted for VM templates. Filter `disk_state = used` for the committed size |
| `vcenter.vm.disk.utilization`              | `%`           | Percentage (0–100) of the VM's provisioned storage that is committed on the datastore — a thin-provisioned VM approaching 100% is about to claim its full size                  |
| `vcenter.vm.memory.ballooned`              | `MiBy`        | Guest memory reclaimed from the VM by the balloon driver (VMware Tools). Above 0 means the ESXi host is short of memory                                                        |
| `vcenter.vm.memory.granted`                | `MiBy`        | Machine memory granted to the VM by the host. _Off by default_ — enable `vcenter.vm.memory.granted`                                                                            |
| `vcenter.vm.memory.swapped`                | `MiBy`        | Memory granted to the VM from the host's swap file — the last resort after ballooning and compression; any value above 0 means the VM is paying disk latency for RAM           |
| `vcenter.vm.memory.swapped_ssd`            | `KiBy`        | Memory of the VM swapped to the host's flash swap cache — less painful than the swap file, but still memory pressure                                                           |
| `vcenter.vm.memory.usage`                  | `MiBy`        | Memory actively used by the VM's guest. Emitted for powered-on and powered-off VMs alike (0 when off)                                                                          |
| `vcenter.vm.memory.utilization`            | `%`           | Memory utilization of the VM as a percentage (0–100) of its configured memory                                                                                                  |
| `vcenter.vm.network.broadcast.packet.rate` | `{packets/s}` | Broadcast packets per second per vNIC, by `direction` and `object`. _Off by default_                                                                                           |
| `vcenter.vm.network.multicast.packet.rate` | `{packets/s}` | Multicast packets per second per vNIC, by `direction` and `object`. _Off by default_                                                                                           |
| `vcenter.vm.network.packet.drop.rate`      | `{packets/s}` | Packets per second dropped by each vNIC, by `direction` and `object`. Receive-side drops usually mean the guest is not draining its ring buffer fast enough                   |
| `vcenter.vm.network.packet.rate`           | `{packets/s}` | Packets per second transmitted or received by each vNIC, by `direction` and `object`                                                                                          |
| `vcenter.vm.network.throughput`            | `By/s`        | Bytes per second transmitted or received over the VM's network, by `direction` and `object`                                                                                   |
| `vcenter.vm.network.usage`                 | `{KiBy/s}`    | Combined transmit + receive rate of the VM, per `object`                                                                                                                       |

### Datastore

| Metric                               | Unit | Description                                                                                                                                  |
| ------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `vcenter.datastore.disk.usage`       | `By` | Space on the datastore, fanned out by `disk_state` (`used` / `available`). used + available is the datastore's capacity                     |
| `vcenter.datastore.disk.utilization` | `%`  | Percentage (0–100) of the datastore's capacity in use. A full datastore pauses every VM writing to it, so alert well before 100%             |

### Resource Pool

| Metric                                   | Unit       | Description                                                                                                                                                              |
| ---------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vcenter.resource_pool.cpu.shares`       | `{shares}` | CPU shares configured on the pool — its relative priority against sibling pools when the parent is contended                                                             |
| `vcenter.resource_pool.cpu.usage`        | `MHz`      | CPU consumed by every VM in the pool (and its child pools)                                                                                                               |
| `vcenter.resource_pool.memory.ballooned` | `MiBy`     | Memory reclaimed by the balloon driver across every VM in the pool                                                                                                       |
| `vcenter.resource_pool.memory.granted`   | `MiBy`     | Host memory granted to the pool's VMs, fanned out by `type` (`private` / `shared` — shared pages are deduplicated by transparent page sharing)                            |
| `vcenter.resource_pool.memory.shares`    | `{shares}` | Memory shares configured on the pool                                                                                                                                     |
| `vcenter.resource_pool.memory.swapped`   | `MiBy`     | Memory granted to the pool's VMs from the ESXi hosts' swap space — any value above 0 means at least one VM in the pool is being host-swapped                              |
| `vcenter.resource_pool.memory.usage`     | `MiBy`     | Memory used by the pool, fanned out by `type` (`guest` / `host` / `overhead`) on recent collector builds; older builds emit a single untyped series. Filter `type = guest` |

### vSAN

Only emitted for vSAN-enabled clusters, the hosts in them, and the VMs on a vSAN datastore. Latencies are in **microseconds** (`us`), unlike the millisecond host and VM disk latencies:

| Metric                              | Unit              | Description                                                                                                                                     |
| ----------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `vcenter.cluster.vsan.congestions`  | `{congestions/s}` | Congestion events per second raised against I/O from every vSAN client in the cluster — vSAN's own back-pressure signal                        |
| `vcenter.cluster.vsan.latency.avg`  | `us`              | Average latency the cluster sees when accessing vSAN storage, by `type` (`read` / `write`). 20 000 µs = 20 ms                                   |
| `vcenter.cluster.vsan.operations`   | `{operations/s}`  | vSAN I/O operations per second across the cluster, by `type` (`read` / `write` / `unmap`)                                                       |
| `vcenter.cluster.vsan.throughput`   | `By/s`            | vSAN throughput of the cluster, by `direction` (`read` / `write`)                                                                               |
| `vcenter.host.vsan.cache.hit_rate`  | `%`               | Percentage of the host's vSAN read I/O served from its local client cache over the latest 5 min interval — a falling rate means reads hit the capacity tier |
| `vcenter.host.vsan.congestions`     | `{congestions/s}` | Congestion events per second raised against vSAN I/O from the host                                                                              |
| `vcenter.host.vsan.latency.avg`     | `us`              | Average latency the host sees when accessing vSAN storage, by `type`                                                                            |
| `vcenter.host.vsan.operations`      | `{operations/s}`  | vSAN I/O operations per second issued by the host, by `type`                                                                                    |
| `vcenter.host.vsan.throughput`      | `By/s`            | vSAN throughput of the host, by `direction`                                                                                                     |
| `vcenter.vm.vsan.latency.avg`       | `us`              | Average latency the VM sees when accessing vSAN storage, by `type`                                                                              |
| `vcenter.vm.vsan.operations`        | `{operations/s}`  | vSAN I/O operations per second issued by the VM, by `type`                                                                                      |
| `vcenter.vm.vsan.throughput`        | `By/s`            | vSAN throughput of the VM, by `direction`                                                                                                       |

> VM power state is not a metric. The receiver emits `vcenter.vm.cpu.*` only for powered-on VMs, so OneUptime infers **Powered on** / **Powered off** per VM from whether CPU datapoints arrived in the same collection as the VM's memory and disk datapoints — the vCenter Virtual Machines page shows the result. To alert on powered-off hosts or on the number of running VMs, use the `power_state` attribute on `vcenter.datacenter.host.count`, `vcenter.datacenter.vm.count`, or `vcenter.cluster.vm.count` instead.

## Monitoring Criteria

### What Gets Evaluated

These monitors always evaluate the **Metric Value** — the value of the configured metric query or formula. The criteria form has no Filter Type selector; it shows **Metric**, **Aggregation**, **Condition**, and **Threshold**.

### Aggregation Types

| Aggregation   | Description                        |
| ------------- | ---------------------------------- |
| Average       | Average value over the time window |
| Sum           | Sum of all values                  |
| Maximum Value | Highest value in the time window   |
| Minimum Value | Lowest value in the time window    |
| All Values    | All values must match the criteria |
| Any Value     | At least one value must match      |

### Conditions

Static thresholds — compared against the **Threshold** you enter:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**

Baseline anomaly detection — no threshold; the form shows **Sensitivity** and **Baseline Window** instead, and compares each sample to the same-hour-of-week baseline built from that window:

- **Anomalously High** — Value rises above the expected range
- **Anomalously Low** — Value falls below the expected range
- **Anomalous** — Value leaves the expected range in either direction

Anomaly conditions stay in a "Learning" state and produce no alerts until at least the chosen Baseline Window of metric history exists.

### Criteria Examples

- **A host is saturated** — `vcenter.host.cpu.utilization`, Average, grouped by `resource.vcenter.host.name`, **Greater Than** `90` over the past 5 minutes.
- **A datastore is filling up** — `vcenter.datastore.disk.utilization`, Average, grouped by `resource.vcenter.datastore.name`, **Greater Than** `80`.
- **A cluster lost a host** — `vcenter.cluster.host.count` filtered to `effective = false`, Maximum, grouped by `resource.vcenter.cluster.name`, **Greater Than** `0`.
- **Fewer VMs are running than expected** — `vcenter.cluster.vm.count` filtered to `power_state = on` and `resource.vcenter.cluster.name = Production`, Sum, **Less Than** the number you expect.
- **A VM is being host-swapped** — `vcenter.vm.memory.swapped`, Maximum, grouped by `resource.vcenter.vm.name`, **Greater Than** `0`.

## Pre-built Alert Templates

OneUptime ships 23 templates for common VMware monitoring scenarios. Each builds a complete monitor — a metric query, attribute filters, a group-by on the object's own identity attribute, a fire criteria, and an auto-recover criteria — that you can edit after applying. Thresholds are starting points. Templates evaluate over the past 5 minutes unless the table says otherwise, and a criteria must hold for **every** minute of its window before it fires:

| Template                      | Category        | Severity | Watches                                                                                              | Fires when                                                                                                                                                  |
| ----------------------------- | --------------- | -------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host CPU Saturation           | Host            | Warning  | `vcenter.host.cpu.utilization`, Avg per `resource.vcenter.host.name`                                 | > 90% — every VM on the host competes for cores and shows CPU ready time                                                                                    |
| Host Memory Saturation        | Host            | Warning  | `vcenter.host.memory.utilization`, Avg per host                                                      | > 90% — the host starts reclaiming memory through ballooning, compression, and swapping                                                                     |
| Host Disk Latency High        | Host            | Warning  | `vcenter.host.disk.latency.max`, Max per host                                                        | > 50 ms — every VM whose disks sit on the affected path waits on storage. Requires performance counter level 3                                              |
| Host Network Packet Errors    | Host            | Warning  | `vcenter.host.network.packet.error.rate`, Max per host                                               | > 0 — almost always a cable, SFP, or switch-port fault; recovers at 0                                                                                      |
| Host Network Packet Drops     | Host            | Warning  | `vcenter.host.network.packet.drop.rate`, Max per host                                                | > 0 — an oversubscribed uplink or overflowing NIC ring buffers; recovers at 0                                                                              |
| VM CPU Saturation             | Virtual Machine | Warning  | `vcenter.vm.cpu.utilization`, Avg per `resource.vcenter.vm.name`, **past 15 minutes**                | > 90% of the VM's vCPUs every minute of the 15-minute window — a VM is entitled to spend its allocation, so only one that never comes down pages            |
| VM CPU Ready Contention       | Virtual Machine | Warning  | `vcenter.vm.cpu.readiness`, Avg per VM                                                               | > 10% — the VM wanted to run but the host had no physical core for it; invisible from inside the guest                                                      |
| VM Memory Saturation          | Virtual Machine | Warning  | `vcenter.vm.memory.utilization`, Avg per VM                                                          | > 90% of configured memory — the guest is about to page internally                                                                                          |
| VM Memory Ballooning          | Virtual Machine | Warning  | `vcenter.vm.memory.ballooned`, Max per VM                                                            | > 0 — the host is short of memory and taking it back from this guest; recovers at 0                                                                         |
| VM Memory Swapping            | Virtual Machine | Critical | `vcenter.vm.memory.swapped`, Max per VM                                                              | > 0 — host-level swapping, the last resort after ballooning and compression; recovers at 0                                                                  |
| VM Disk Latency High          | Virtual Machine | Warning  | `vcenter.vm.disk.latency.max`, Max per VM                                                            | > 50 ms — applications inside the guest time out on I/O                                                                                                     |
| VM Disk Usage High            | Virtual Machine | Warning  | `vcenter.vm.disk.utilization`, Avg per VM                                                            | > 90% of provisioned storage committed — a thin-provisioned VM is about to claim its full size from the datastore                                            |
| Datastore Capacity Warning    | Datastore       | Warning  | `vcenter.datastore.disk.utilization`, Avg per `resource.vcenter.datastore.name`                      | > 80% — early warning; thin disks and snapshots consume the remaining 20% quickly                                                                           |
| Datastore Capacity Critical   | Datastore       | Critical | `vcenter.datastore.disk.utilization`, Avg per datastore                                              | > 90% — a datastore that fills up pauses every VM with a disk on it                                                                                         |
| Cluster Host Not Effective    | Cluster         | Critical | `vcenter.cluster.host.count` filtered to `effective = false`, Max per `resource.vcenter.cluster.name` | > 0 — a host is in maintenance mode, disconnected, or unresponsive; the cluster runs with less capacity than it was sized for; recovers at 0                |
| Datacenter Hosts Unhealthy    | Datacenter      | Critical | `vcenter.datacenter.host.count` filtered to `status = red`, Max per `resource.vcenter.datacenter.name` | > 0 — a host has a triggered critical alarm (hardware sensor, lost storage path, HA agent error); recovers at 0                                            |
| Datacenter Hosts Degraded     | Datacenter      | Warning  | `vcenter.datacenter.host.count` filtered to `status = yellow`, Max per datacenter                    | > 0 — a host has a triggered warning-level alarm; recovers at 0                                                                                             |
| Datacenter Hosts Powered Off  | Datacenter      | Warning  | `vcenter.datacenter.host.count` filtered to `power_state = off`, Max per datacenter                  | > 0 — a host is powered off (crashed, lost power, or fenced by DPM); recovers at 0                                                                           |
| Datacenter VMs Unhealthy      | Datacenter      | Warning  | `vcenter.datacenter.vm.count` filtered to `status = red`, Max per datacenter                         | > 0 — a VM has a triggered critical alarm (failed HA restart, lost datastore, Tools heartbeat lost); recovers at 0                                          |
| Datacenter Clusters Unhealthy | Datacenter      | Critical | `vcenter.datacenter.cluster.count` filtered to `status = red`, Max per datacenter                    | > 0 — a cluster-level critical alarm (insufficient HA failover resources, HA master election failed, vSAN health critical); recovers at 0                    |
| vSAN Latency High             | vSAN            | Warning  | `vcenter.cluster.vsan.latency.avg`, Avg per cluster                                                  | > 20 000 µs (20 ms) — a cluster-wide storage slowdown for every VM on the vSAN datastore. Silent on clusters without vSAN                                    |
| vSAN Congestion               | vSAN            | Warning  | `vcenter.cluster.vsan.congestions`, Max per cluster                                                  | > 0 — a disk group cannot keep up and vSAN is throttling client I/O; recovers at 0                                                                         |
| Resource Pool Memory Swapped  | Cluster         | Warning  | `vcenter.resource_pool.memory.swapped`, Max per `resource.vcenter.resource_pool.inventory_path`      | > 0 — the pool's VMs are drawing memory from host swap, usually because the pool's memory limit or shares are too low; recovers at 0                        |

> Notes on the choices baked in: utilization templates use **Avg** because the receiver already reports true 0–100 percentages (one series per object), so the per-minute average is the sustained utilization regardless of how many collections land in the minute; latency templates use **Max** because the metric is itself the worst latency across the object's disks, so the worst sample is the honest value; count and state-style templates (packet errors, ballooning, swapping, red / yellow status, non-effective hosts, congestion) use **Max** so a single collection showing the condition trips the threshold. Every template groups by the object's own identity attribute (`resource.vcenter.host.name`, `resource.vcenter.vm.name`, `resource.vcenter.datastore.name`, `resource.vcenter.cluster.name`, `resource.vcenter.datacenter.name`, `resource.vcenter.resource_pool.inventory_path`), so one incident fires per affected object and the alert names it. Thresholds written in a unit (`%`, `ms`, `us`) are pinned to that unit, so they keep their meaning whatever unit the display layer chooses to render.

## Setup Requirements

To use VMware monitoring, you need to:

1. Install the OneUptime VMware Agent on a machine that can reach vCenter over HTTPS — see the [VMware Agent installation guide](/docs/telemetry/vmware). The required read-only vSphere user is a two-command `govc` snippet (also in the guide)
2. Pass `ONEUPTIME_URL`, `ONEUPTIME_TELEMETRY_INGESTION_KEY`, `VMWARE_VCENTER_NAME`, `VCENTER_ENDPOINT`, `VCENTER_USERNAME`, and `VCENTER_PASSWORD` as environment variables
3. Wait for the vCenter to auto-register (about one collection interval — 2 minutes by default — after the agent starts)

## Terraform

The [OneUptime Terraform provider](/docs/terraform/monitor-steps) carries a VMware monitor step's configuration in the `vmware_monitor` escape-hatch attribute — the raw JSON of the `vmwareMonitor` sub-config (`vcenterIdentifier`, `resourceFilters`, `metricViewConfig`, `rollingTime`), written with `jsonencode()`:

```hcl
monitor_steps = [{
  vmware_monitor = jsonencode({
    vcenterIdentifier = "prod-vcenter"
    resourceFilters   = { clusterName = "Production" }
    rollingTime       = "Past 5 Minutes"
    metricViewConfig = {
      queryConfigs = [{
        metricAliasData = { metricVariable = "host_cpu", title = "Host CPU", description = "", legend = "" }
        metricQueryData = {
          filterData = {
            metricName     = "vcenter.host.cpu.utilization"
            attributes     = {}
            aggegationType = "Avg"
            aggregateBy    = {}
          }
          groupByAttributeKeys = ["resource.vcenter.host.name"]
        }
      }]
      formulaConfigs = []
    }
  })
  criteria = [ /* ... */ ]
}]
```

`vcenterIdentifier` is the vCenter's `vmware.vcenter.name` (the `VMWARE_VCENTER_NAME` the agent was started with), not its OneUptime id.

## Troubleshooting

### The vCenter does not appear in the monitor's vCenter picker

The vCenter registers itself from the agent's telemetry. Check the agent is running and shipping (see [Verify the Installation](/docs/telemetry/vmware)), that `VMWARE_VCENTER_NAME` is set, and that at least one collection interval has passed — nothing is exported until the first full inventory walk completes.

### Hosts have metrics but VMs, datastores, or clusters do not

The read-only vSphere user was granted the role without **Propagate to children**, or on a narrower object than the vCenter root. Objects the user cannot see are silently absent from the metrics. Fix the permission on the top-level vCenter object with propagation enabled.

### Incidents are not firing for "Host CPU Saturation"

The template evaluates the **Avg** of `vcenter.host.cpu.utilization` grouped by `resource.vcenter.host.name`, so each host is checked independently. If you built a custom query instead, make sure it groups by the identity attribute with the `resource.` prefix — the bare `vcenter.host.name` matches nothing, and an ungrouped average across all hosts is diluted by idle ones and rarely crosses the threshold.

### The vSAN templates never fire

`vcenter.cluster.vsan.*`, `vcenter.host.vsan.*`, and `vcenter.vm.vsan.*` are only emitted for vSAN-enabled clusters, the hosts in them, and VMs on a vSAN datastore. On environments without vSAN the series do not exist and the templates stay silent by design.

### A criteria filtered on `effective` matches nothing

The receiver's boolean `effective` attribute is stored as the string `"true"` / `"false"`. Filter with the string, not a boolean.

### Disk latency or throughput metrics are missing

`vcenter.host.disk.latency.avg` and `vcenter.vm.disk.*` need vCenter performance counter **level 2**, `vcenter.host.disk.latency.max` needs **level 3**, and `vcenter.host.disk.throughput` needs **level 4**. Raise the statistics level for the 5-minute interval under _vCenter → Configure → General → Statistics_ if the counters you need are missing.

### A 1-minute window shows no data

The agent polls vCenter every `VCENTER_COLLECTION_INTERVAL` (2 minutes by default, longer on large inventories), so a 1-minute rolling window may contain no sample. Use a 5-minute window or longer.
