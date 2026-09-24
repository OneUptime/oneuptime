/*
 * What each number on the VMware (vCenter) pages means, in plain words.
 * Shown in the (i) tooltip beside a tile, chart, summary field or column.
 *
 * Each text describes what the page actually computes, not what the title
 * might suggest. Three things differ from tile to tile and are called out:
 *
 *   - the time window: the Host CPU / Host Memory / VM CPU Ready tiles
 *     average only the last 5 minutes of the selected range (falling back
 *     to the whole range), the charts cover the whole range, and everything
 *     read from the inventory (counts, top-5 lists, detail pages, tables)
 *     is the latest report and ignores the time picker;
 *   - staleness: tables and top-5 lists hide CPU / memory older than 15
 *     minutes, detail pages and some columns show the last value however
 *     old it is;
 *   - power state is inferred from which VMs send CPU data, so a suspended
 *     VM reads as powered off, and a powered-off VM keeps its last CPU
 *     reading.
 *
 * Change the fetch, change the words.
 */

export type VMwareMetric =
  // Overview (Pages/VMware/View/Index.tsx): hero count chips.
  | "overviewInventoryCounts"
  // Overview: golden tiles.
  | "overviewHostEffectiveness"
  | "overviewHostCpu"
  | "overviewHostMemory"
  | "overviewDatastores"
  | "overviewVmCpuReady"
  | "overviewVirtualMachines"
  // Overview: golden chart cards.
  | "overviewHostCpuChart"
  | "overviewHostMemoryChart"
  | "overviewDatastoreUsedChart"
  | "overviewVmCpuReadyChart"
  // Overview: summary strip.
  | "overviewVCenterHealth"
  | "overviewDatacenterCount"
  | "overviewClusterCount"
  | "overviewHostCount"
  | "overviewVirtualMachineCount"
  | "overviewDatastoreCount"
  | "overviewResourcePoolCount"
  | "overviewAgentStatus"
  // Overview: Top Resource Consumers sections.
  | "topHostsByCpu"
  | "topHostsByMemory"
  | "topDatastoresByUtilization"
  | "topVmsByCpuReady"
  // ESXi host detail.
  | "hostCpu"
  | "hostCpuCapacity"
  | "hostMemory"
  // Virtual machine detail.
  | "vmPowerState"
  | "vmCpu"
  | "vmCpuReady"
  | "vmMemory"
  | "vmMemoryBallooned"
  | "vmMemorySwapped"
  | "vmDisk"
  // Datastore detail.
  | "datastoreUsed"
  | "datastoreCapacity"
  | "datastoreFree"
  | "datastoreUsedPercent"
  | "datastoreGrowthForecast"
  // Cluster detail.
  | "clusterHosts"
  | "clusterVirtualMachines"
  | "clusterTemplates"
  | "clusterCpu"
  | "clusterMemory"
  // Hosts list.
  | "hostListCpu"
  | "hostListMemory"
  | "hostListCpuCapacity"
  // Virtual machines list.
  | "vmListStatus"
  | "vmListPowerState"
  | "vmListCpuReady"
  | "vmListCpu"
  | "vmListMemory"
  | "vmListAge"
  // Datastores list.
  | "datastoreListUsedCapacity"
  // Clusters list.
  | "clusterListHosts"
  | "clusterListVirtualMachines"
  | "clusterListTemplates"
  | "clusterListEffectiveCpu"
  | "clusterListEffectiveMemory"
  // Resource pools list.
  | "resourcePoolListCpu"
  | "resourcePoolListMemory"
  | "resourcePoolListBalloonedSwapped";

export const VMWARE_METRIC_DESCRIPTIONS: Record<VMwareMetric, string> = {
  // ---- Overview: hero count chips ---------------------------------------
  overviewInventoryCounts:
    "How many datacenters, clusters, ESXi hosts, VMs (powered on out of all, templates excluded) and datastores this vCenter has, from the latest inventory rather than the selected range. A kind with none is left out.",

  // ---- Overview: golden tiles -------------------------------------------
  overviewHostEffectiveness:
    "Clustered ESXi hosts that can run VMs, out of all hosts in clusters, from the latest inventory rather than the selected range. A host in maintenance mode or not responding is not effective, and standalone hosts are not counted.",
  overviewHostCpu:
    "Share of the combined CPU capacity of all ESXi hosts in use, with bigger hosts counting for more. Averaged over the last 5 minutes of the selected range (the whole range if those minutes have no data); the chart below covers the whole range.",
  overviewHostMemory:
    "Share of the combined RAM of all ESXi hosts in use, averaged over the last 5 minutes of the selected range (the whole range if those minutes have no data). The line below shows used and total RAM at the latest point.",
  overviewDatastores:
    "How full your fullest datastore is (used space as a share of capacity) at its latest report, however old, named below; until the inventory loads, the fullest over the last 5 minutes of the range. Amber from 80%, red from 90%: the levels that mark the vCenter Degraded and Unhealthy.",
  overviewVmCpuReady:
    "CPU Ready is the share of time a VM was ready to run but had to wait for a physical CPU. This is the average across powered-on VMs over the last 5 minutes of the selected range (the whole range if those minutes have no data), with the busiest VM below; amber from 5%, red from 10%.",
  overviewVirtualMachines:
    "Powered-on VMs out of all VMs, templates excluded, from the latest inventory; a VM that is off is not treated as a fault. Power state is inferred from which VMs send CPU data, so a suspended VM counts as off.",

  // ---- Overview: golden chart cards -------------------------------------
  overviewHostCpuChart:
    "CPU in use across all ESXi hosts at each point of the selected range, as a share of their combined CPU capacity. Hosts with more CPU count for more.",
  overviewHostMemoryChart:
    "RAM in use across all ESXi hosts at each point of the selected range, as a share of their combined RAM.",
  overviewDatastoreUsedChart:
    "Used space added up across all datastores at each point of the selected range, in bytes.",
  overviewVmCpuReadyChart:
    "CPU Ready over the selected range: Avg is the average across powered-on VMs and Max the highest single VM at each point. It is the share of time VMs waited for a physical CPU; above 10% they are noticeably slowed.",

  // ---- Overview: summary strip ------------------------------------------
  overviewVCenterHealth:
    "Unhealthy if a clustered host is in maintenance mode or not responding, a datastore is at least 90% full, or a VM is swapped to disk; Degraded if a datastore is at least 80% full, a VM is ballooned or above 10% CPU Ready, or hosts are powered off. Unknown while the agent is disconnected.",
  overviewDatacenterCount:
    "Number of vSphere datacenters in this vCenter, from the latest inventory. A datacenter is the top-level folder that holds hosts, clusters, VMs and datastores.",
  overviewClusterCount:
    "Number of vSphere clusters: groups of ESXi hosts that pool their CPU and memory. Clustered hosts in maintenance mode or not responding are counted in red beside the number.",
  overviewHostCount:
    "Number of ESXi hosts (the physical servers that run your VMs) in this vCenter, from the latest inventory, including standalone hosts that are not in a cluster.",
  overviewVirtualMachineCount:
    "Powered-on VMs out of all VMs in this vCenter, templates excluded, from the latest inventory. Only the total is shown until the agent has reported power state.",
  overviewDatastoreCount:
    "Number of datastores, plus used space against total capacity added up across all of them. The bar turns amber at 80% and red at 90% of the combined capacity.",
  overviewResourcePoolCount:
    "Number of resource pools, which group VMs so they can share and cap CPU and memory. Includes the built-in root pool that every cluster and standalone host has.",
  overviewAgentStatus:
    "Whether the OneUptime VMware agent is sending data for this vCenter. While it is disconnected the numbers on this page stop updating and may be out of date.",

  // ---- Overview: Top Resource Consumers ---------------------------------
  topHostsByCpu:
    "The 5 ESXi hosts using the largest share of their CPU capacity, from the latest inventory rather than the selected range. Hosts with no data in the last 15 minutes are left out.",
  topHostsByMemory:
    "The 5 ESXi hosts using the most RAM, in bytes, from the latest inventory, leaving out hosts with no data in the last 15 minutes. The bar shows the share of each host's RAM in use (or, if that is not reported, its usage compared with the top host's).",
  topDatastoresByUtilization:
    "The 5 fullest datastores, by used space as a share of capacity. Each value is the datastore's latest report, however old, not the selected range.",
  topVmsByCpuReady:
    "The 5 powered-on VMs that spent the most time waiting for a physical CPU (CPU Ready), from the latest inventory, leaving out VMs with no data in the last 15 minutes. Above 10% a VM is slowed by busy hosts.",

  // ---- ESXi host detail -------------------------------------------------
  hostCpu:
    "Share of this host's CPU capacity in use, then the amount in use and the host's total in MHz or GHz. This is the latest report, however old (Metrics Updated shows when it arrived).",
  hostCpuCapacity:
    "Total CPU capacity of this host, all cores added together, in MHz or GHz. Shown in place of CPU usage when the host has not reported how busy it is.",
  hostMemory:
    "RAM in use on this host against its total RAM, with the share in use, from the latest report. When the host does not report its total, it is worked out from usage and utilization.",

  // ---- Virtual machine detail -------------------------------------------
  vmPowerState:
    "Whether this VM is on, inferred from whether it sent CPU data in the latest collection: a VM that is off or suspended sends none, so both show as Powered off. Templates never run and show Template.",
  vmCpu:
    "Share of this VM's configured virtual CPU capacity in use, with the amount in MHz or GHz, from the latest report. CPU is only reported while the VM is on, so a VM that is now off shows its last reading.",
  vmCpuReady:
    "Share of time this VM was ready to run but had to wait for a physical CPU, from its latest report (for a VM that is now off, its last reading). Above 10% it is flagged as CPU contention: the host is too busy and the VM is slowed down.",
  vmMemory:
    "Memory the VM's operating system is actively using, as estimated by ESXi, against the memory configured for the VM, with the share in use, from the latest report.",
  vmMemoryBallooned:
    "Memory ESXi took back from this VM through the balloon driver in VMware Tools because the host was short of RAM. Only shown when above zero; it is a sign of host memory pressure.",
  vmMemorySwapped:
    "Memory of this VM that ESXi moved to disk because the host ran out of RAM, shown only when above zero. Swapping slows the VM badly and marks the vCenter Unhealthy.",
  vmDisk:
    "Datastore space this VM's files take up now, against the total provisioned for it (used space plus what its disks may still grow into), with the share used, from the latest report.",

  // ---- Datastore detail -------------------------------------------------
  datastoreUsed:
    "Space taken up on this datastore by VM disks, snapshots and other files, from the latest report.",
  datastoreCapacity:
    "Total size of this datastore, worked out as used space plus free space from the latest report.",
  datastoreFree:
    "Space still free on this datastore: its capacity minus the used space, from the latest report.",
  datastoreUsedPercent:
    "Used space as a share of this datastore's capacity, from the latest report. Flagged amber from 80% and red from 90%, the levels that mark the vCenter Degraded and Unhealthy.",
  datastoreGrowthForecast:
    "Days until this datastore is full if it keeps growing at the rate seen over the last 24 hours, using a straight-line fit. Shown only when usage is growing and would fill within a year, or as Full now once it is full.",

  // ---- Cluster detail ---------------------------------------------------
  clusterHosts:
    "Hosts in this cluster that can run VMs (effective), out of all its hosts, from the latest report. A host in maintenance mode or not responding is not effective and is flagged in red.",
  clusterVirtualMachines:
    "Powered-on VMs out of all VMs in this cluster, as counted by vCenter itself at the latest report.",
  clusterTemplates:
    "VM templates in this cluster: master copies used to create new VMs. Templates are never powered on, so they use no CPU or memory.",
  clusterCpu:
    "CPU capacity available to run VMs (effective) against the cluster's total CPU capacity, in MHz or GHz, from the latest report. Hosts in maintenance mode or not responding are left out of effective.",
  clusterMemory:
    "Memory available to run VMs (effective) against the cluster's total memory, from the latest report. Hosts in maintenance mode or not responding are left out of effective.",

  // ---- Hosts list -------------------------------------------------------
  hostListCpu:
    "Share of each host's CPU capacity in use, from its latest report. N/A when the host has sent no data in the last 15 minutes.",
  hostListMemory:
    "RAM in use on each host against its total RAM, with a bar for the share in use, from its latest report. N/A when the host has sent no data in the last 15 minutes.",
  hostListCpuCapacity:
    "Total CPU capacity of each host: the speed of all its CPU cores added together, in MHz or GHz.",

  // ---- Virtual machines list --------------------------------------------
  vmListStatus:
    "Running, Powered off or Template: the same inferred power state as the Power State column, shown as a colored label you can filter on.",
  vmListPowerState:
    "Powered on, Powered off or Template, inferred from whether the VM sent CPU data in the latest collection, so a suspended VM shows as Powered off. A dash means the VM has not been collected yet.",
  vmListCpuReady:
    "Share of time the VM was ready to run but waited for a physical CPU, from its last report, however old; above about 10% busy hosts are slowing it down. A VM that is now off keeps its last reading.",
  vmListCpu:
    "Share of the VM's configured virtual CPU capacity in use, from its latest report; N/A when nothing arrived in the last 15 minutes. CPU is only reported while a VM is on, so a powered-off VM may show its last reading.",
  vmListMemory:
    "Memory the VM's operating system is actively using, as estimated by ESXi, against its configured memory, from its latest report. N/A when nothing arrived in the last 15 minutes.",
  vmListAge:
    "The VMware agent does not report when a VM was created or started, so this column is empty for every virtual machine.",

  // ---- Datastores list --------------------------------------------------
  datastoreListUsedCapacity:
    "Space used on each datastore against its total capacity (used plus free), with the share used, from its latest report, however old.",

  // ---- Clusters list ----------------------------------------------------
  clusterListHosts:
    "Hosts in the cluster that can run VMs, out of all its hosts, from its latest report. A host in maintenance mode or not responding counts toward the total but is not effective.",
  clusterListVirtualMachines:
    "Powered-on VMs out of all VMs in the cluster, as counted by vCenter itself at its latest report.",
  clusterListTemplates:
    "VM templates in the cluster: master copies used to create new VMs, which are never powered on.",
  clusterListEffectiveCpu:
    "CPU capacity the cluster can use to run VMs, out of its total CPU capacity, in MHz or GHz, from its latest report. Hosts in maintenance mode or not responding do not count toward the effective figure.",
  clusterListEffectiveMemory:
    "Memory the cluster can use to run VMs, out of its total memory, from its latest report. Hosts in maintenance mode or not responding do not count toward the effective figure.",

  // ---- Resource pools list ----------------------------------------------
  resourcePoolListCpu:
    "CPU in use by the virtual machines in this resource pool, in MHz or GHz, from its last report, however old.",
  resourcePoolListMemory:
    "Guest memory the VMs in this pool are actively using, as estimated by ESXi, from its latest report. N/A when the pool has sent no data in the last 15 minutes.",
  resourcePoolListBalloonedSwapped:
    "Memory ESXi took back from this pool's VMs through the balloon driver, then memory it moved to disk swap, from the last report. Above zero means a host is short of RAM; swapping slows VMs badly.",
};
