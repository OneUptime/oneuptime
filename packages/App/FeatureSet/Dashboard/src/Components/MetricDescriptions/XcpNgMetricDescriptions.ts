/*
 * What each number on the XCP-ng pages means, in plain words. Shown in the
 * (i) tooltip beside a tile, chart, summary field or column title.
 *
 * Each text describes what the page actually reads, not what the title
 * might suggest:
 *   - counts, the Storage tile, the list columns and a part's tiles come
 *     from the pool's latest inventory (XcpNgPool's counts and the
 *     XcpNgResource rows), which every scrape of Xen Orchestra refreshes,
 *     and ignore the time picker;
 *   - a host's CPU is Xen Orchestra's average over all of the host's CPU
 *     threads (xcp_host_cpu_average); a VM's is its share of the vCPUs it
 *     was given (xcp_vm_cpu_usage);
 *   - a host's memory in use is its total less its free memory, dom0's
 *     share included; a VM's needs its guest tools, which tell XAPI how
 *     much memory the guest leaves free, and is unknown without them;
 *   - a storage repository's space is XAPI's own (xcp_sr_physical_*),
 *     counted once for an SR every host shares;
 *   - a host's load is its control domain's (xcp_host_load_average), and
 *     its power the DCMI or IPMI sensor's, which not every host has;
 *   - control domains (dom0) and templates are never counted as VMs.
 * Change the fetch, change the words.
 */

import { translationKey } from "Common/UI/Utils/TranslateTemplate";

export type XcpNgMetric =
  // Pool overview - tiles.
  | "hostAvailability"
  | "vmsRunning"
  | "storageUsed"
  // Pool overview - hero and cards.
  | "poolInventoryCounts"
  | "topVmsByCpu"
  | "topVmsByMemory"
  // Host detail.
  | "hostStatus"
  | "hostEnabled"
  | "hostUptime"
  | "hostCpu"
  | "hostMemory"
  | "hostLoad"
  | "hostRunningVcpus"
  | "hostPower"
  // VM detail.
  | "vmStatus"
  | "vmUptime"
  | "vmCpu"
  | "vmMemory"
  // Storage repository detail.
  | "storageRepositoryUsed"
  | "storageRepositoryAllocated"
  | "storageRepositoryShared"
  // Hosts list.
  | "hostsTableStatus"
  | "hostsTableCpu"
  | "hostsTableMemory"
  | "hostsTableUptime"
  // VMs list.
  | "vmsTableStatus"
  | "vmsTableCpu"
  | "vmsTableMemory"
  | "vmsTableUptime"
  // Storage list.
  | "storageTableUsed";

export const XCP_NG_METRIC_DESCRIPTIONS: Record<XcpNgMetric, string> = {
  // Pool overview - tiles.
  hostAvailability: translationKey(
    "Hosts that Xen Orchestra reports as running, out of all the hosts in the pool, from its latest report rather than the selected time range. A host in maintenance mode is still running and counts here; it is shown as Disabled.",
  ),
  vmsRunning: translationKey(
    "Running VMs out of all the VMs in the pool, from Xen Orchestra's latest report. Control domains (dom0, the management VM on each host) and templates are left out.",
  ),
  storageUsed: translationKey(
    "Space used on the pool's storage repositories that hold VM disks, out of their combined size, as XAPI reports it, from the latest report. ISO libraries and removable media are left out; a storage repository every host shares is counted once.",
  ),

  // Pool overview - hero and cards.
  poolInventoryCounts: translationKey(
    "Hosts running out of all hosts, VMs running out of all VMs (control domains and templates left out), and storage repositories, from Xen Orchestra's latest report rather than the selected time range.",
  ),
  topVmsByCpu: translationKey(
    "The VMs using the most CPU at their latest report, each as a share of the vCPUs it was given, so a busy VM with 2 vCPUs can rank above a quieter one with 16.",
  ),
  topVmsByMemory: translationKey(
    "The VMs using the most memory at their latest report, as their guest tools report it, with a bar for each VM's use as a share of its memory. A VM without guest tools reports no memory in use and is left out.",
  ),

  // Host detail.
  hostStatus: translationKey(
    "Running, Halted or Unknown, as Xen Orchestra last reported this host. Unknown means the pool master could not reach it; every VM it ran is down unless HA restarted it on another host.",
  ),
  hostEnabled: translationKey(
    "Whether XAPI may start VMs on this host. A disabled host is in maintenance mode or being evacuated, so it takes no new VMs and the pool has one host less to fail over to.",
  ),
  hostUptime: translationKey(
    "How long this host had been running since it last booted, as of Xen Orchestra's latest report.",
  ),
  hostCpu: translationKey(
    "How busy this host's processors were at its latest report, averaged over all of its CPU threads, so 100% means every thread was busy.",
  ),
  hostMemory: translationKey(
    "Memory in use on this host, its total memory less what is free, compared with its total memory, at its latest report. It includes what the control domain (dom0) uses.",
  ),
  hostLoad: translationKey(
    "The load average of this host's control domain (dom0, the management VM that runs XAPI): how many of its tasks were running or waiting for a CPU on average, at its latest report.",
  ),
  hostRunningVcpus: translationKey(
    "The vCPUs (virtual processors) of the VMs running on this host, added up, at its latest report. More vCPUs than the host has CPU threads means they take turns.",
  ),
  hostPower: translationKey(
    "Power this host draws, in watts, read from its DCMI or IPMI sensor at its latest report. A host without such a sensor shows a dash.",
  ),

  // VM detail.
  vmStatus: translationKey(
    "Running, Halted, Paused or Suspended, as Xen Orchestra last reported this VM. A VM someone suspended is not an alert; one that halts after running is.",
  ),
  vmUptime: translationKey(
    "How long this VM had been running since it last started, as of Xen Orchestra's latest report. A VM that is not running shows a dash.",
  ),
  vmCpu: translationKey(
    "How busy this VM was at its latest report, as a share of the vCPUs it was given: 100% means every vCPU was busy.",
  ),
  vmMemory: translationKey(
    "Memory this VM's guest uses compared with the memory the VM was given, at its latest report. Only a guest running its guest tools reports what it uses; without them this shows the memory the VM was given.",
  ),

  // Storage repository detail.
  storageRepositoryUsed: translationKey(
    "Space used on this storage repository compared with its size, as XAPI reports it, at the latest report. The Storage Repository Near Full alert template fires above 90%.",
  ),
  storageRepositoryAllocated: translationKey(
    "Space the virtual disks on this storage repository were given, added up. A thin-provisioned storage repository can give out more than its size, and fills up as the disks use their space.",
  ),
  storageRepositoryShared: translationKey(
    "Shared storage, such as NFS or iSCSI, is one storage repository that every host in the pool uses; local storage belongs to a single host.",
  ),

  // Hosts list.
  hostsTableStatus: translationKey(
    "Running, Halted or Unknown, as Xen Orchestra last reported each host, and Disabled when it is in maintenance mode, where XAPI starts no VM on it.",
  ),
  hostsTableCpu: translationKey(
    "How busy each host's processors are, averaged over all of its CPU threads, at its latest report.",
  ),
  hostsTableMemory: translationKey(
    "Memory in use on each host compared with its total memory, at its latest report, including what its control domain (dom0) uses.",
  ),
  hostsTableUptime: translationKey(
    "How long each host has been running since it last booted (its uptime), not how long it has been in the pool.",
  ),

  // VMs list.
  vmsTableStatus: translationKey(
    "Running, Halted, Paused or Suspended, as Xen Orchestra last reported each VM. Control domains are hidden unless you show them; templates are not listed.",
  ),
  vmsTableCpu: translationKey(
    "How busy each VM is, as a share of the vCPUs it was given, at its latest report.",
  ),
  vmsTableMemory: translationKey(
    "Memory each VM's guest uses compared with the memory the VM was given, at its latest report. A VM without guest tools reports none: the column shows the memory it was given, with no bar.",
  ),
  vmsTableUptime: translationKey(
    "How long each running VM has been running since it last started (its uptime); for one that is not running, when it was last seen running.",
  ),

  // Storage list.
  storageTableUsed: translationKey(
    "Space used on each storage repository compared with its size, as XAPI reports it, at the latest report.",
  ),
};
