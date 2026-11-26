import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the rest of the numbers on an XCP-ng pool's pages mean, in plain
 * words, for the (i) beside them: the ones the shared catalog
 * (Components/MetricDescriptions/XcpNgMetricDescriptions, whose words the
 * tiles, lists and part pages use first) has no entry for - the hero's
 * connection and health, the busiest hosts, a host's VMs, a VM's vCPUs,
 * tags and power, and a storage repository's columns and virtual disks.
 *
 * Each text says what the page reads, as the catalog's do: the latest
 * inventory, as Xen Orchestra last reported it, never a time range.
 */

export type XcpNgPageDescription =
  | "connection"
  | "poolHealth"
  | "topHostsByCpu"
  | "topHostsByMemory"
  | "hostVms"
  | "hostsTableVcpus"
  | "hostsTablePower"
  | "vmVcpus"
  | "vmTags"
  | "vmPower"
  | "storageFree"
  | "storageType"
  | "storageContent"
  | "storageVirtualDisks"
  | "storageTableAllocated"
  | "virtualDiskSize"
  | "virtualDiskUsed";

export const XCP_NG_PAGE_DESCRIPTIONS: Record<XcpNgPageDescription, string> = {
  connection: translationKey(
    "Connected while Xen Orchestra reports this pool to the XCP-ng Agent, which reads it every minute. Disconnected 15 minutes after its last report: Xen Orchestra stopped reporting this pool, as it does when it loses its connection to the pool, or the agent stopped.",
  ),
  poolHealth: translationKey(
    "Worked out from the pool's latest inventory. Unhealthy while a host is halted or not responding, or a storage repository is more than 95% full. Degraded while a host is disabled, a VM that ran in the last 24 hours is halted or paused, or a storage repository is more than 90% full or allocated past its size.",
  ),
  topHostsByCpu: translationKey(
    "The running hosts using the most CPU at their latest report, averaged over each host's CPU threads. A host that has not reported for 15 minutes is left out.",
  ),
  topHostsByMemory: translationKey(
    "The running hosts using the most memory at their latest report, as a share of each host's memory. Memory given to a VM counts as in use.",
  ),
  hostVms: translationKey(
    "The VMs running on the host, of all the VMs it last ran. Its control domain (dom0) is left out.",
  ),
  hostsTableVcpus: translationKey(
    "The vCPUs of the VMs running on each host, added up, against the host's CPU threads. More vCPUs than threads means the VMs take turns.",
  ),
  hostsTablePower: translationKey(
    "The power each host draws, in watts, from its DCMI or IPMI sensor at its latest report. A host without such a sensor reports none.",
  ),
  vmVcpus: translationKey("The vCPUs (virtual processors) each VM was given."),
  vmTags: translationKey("The tags each VM has in Xen Orchestra."),
  vmPower: translationKey(
    "Xen Orchestra's estimate of this VM's share of its host's power draw, in watts.",
  ),
  storageFree: translationKey(
    "Space left on each storage repository: its size less what is used.",
  ),
  storageType: translationKey(
    "How the storage repository stores its disks, as XAPI names its type: NFS, iSCSI, LVM, EXT, XOSTOR and others.",
  ),
  storageContent: translationKey(
    "What the storage repository holds: VM disks, an ISO library or removable media.",
  ),
  storageVirtualDisks: translationKey(
    "The virtual disks on the storage repository, snapshots left out.",
  ),
  storageTableAllocated: translationKey(
    "The virtual size of every disk on each storage repository, added up, against its size. Past its size, it is thin-provisioned beyond what it holds, and its disks can fill it as they grow.",
  ),
  virtualDiskSize: translationKey(
    "The disk's virtual size: how big it is to its VM.",
  ),
  virtualDiskUsed: translationKey(
    "The space the disk takes on its storage repository. A thin-provisioned disk takes less than its size until it fills.",
  ),
};
