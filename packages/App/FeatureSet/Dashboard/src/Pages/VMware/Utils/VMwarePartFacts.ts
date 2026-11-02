import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import { VMWARE_HOST_NOT_RESPONDING_TEMPLATE_ID } from "Common/Types/Monitor/VMwareAlertTemplates";
import { ResourceAttentionSeverity } from "../../../Components/ResourcePart/ResourceAttention";
import {
  VMwareHostState,
  assessVMwareHost,
  findVMwareDatacenter,
  getVMwareClusterName,
  getVMwareDisplayName,
  getVMwareHostState,
  getVMwareHostsOfCluster,
  hasFreshVMwareReadings,
  isVMwareHostRunning,
  toVMwareNumber,
} from "./VMwareHealth";

/*
 * WHAT AN ESXI HOST, A VIRTUAL MACHINE, A DATASTORE OR A CLUSTER IS, IN THE
 * NUMBERS ITS PAGES SHOW.
 *
 * The alerts that watch each kind of part, a cluster's hosts and VMs and how
 * much of its capacity they use, and the order a list of hosts is read in.
 * VMwareHealth says what needs attention; this says what a part is.
 * React-free, so App tests can read it.
 */

/*
 * The recommended alerts that watch each kind of part, in the order a
 * part's alerts card lists them. Each is one monitor on the vCenter that
 * fires for any part of that kind that crosses it (ResourcePartAlertsCard).
 */
export const VMWARE_HOST_ALERT_TEMPLATE_IDS: Array<string> = [
  VMWARE_HOST_NOT_RESPONDING_TEMPLATE_ID,
  "vmware-host-cpu-saturation",
  "vmware-host-memory-saturation",
  "vmware-host-disk-latency-high",
  "vmware-host-network-packet-errors",
  "vmware-host-network-packet-drops",
];

export const VMWARE_VIRTUAL_MACHINE_ALERT_TEMPLATE_IDS: Array<string> = [
  "vmware-vm-memory-swapping",
  "vmware-vm-memory-ballooning",
  "vmware-vm-cpu-ready-contention",
  "vmware-vm-cpu-saturation",
  "vmware-vm-memory-saturation",
  "vmware-vm-disk-latency-high",
  "vmware-vm-disk-usage-high",
];

export const VMWARE_DATASTORE_ALERT_TEMPLATE_IDS: Array<string> = [
  "vmware-datastore-capacity-critical",
  "vmware-datastore-capacity-warning",
];

export const VMWARE_CLUSTER_ALERT_TEMPLATE_IDS: Array<string> = [
  "vmware-cluster-host-not-effective",
  "vmware-vsan-latency-high",
  "vmware-vsan-congestion",
];

function sameName(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// The VMs (templates included) that run in a cluster.
export function getVMwareVirtualMachinesOfCluster(
  rows: Array<VMwareResource>,
  cluster: VMwareResource,
): Array<VMwareResource> {
  const clusterName: string = getVMwareClusterName(cluster);
  return rows.filter((row: VMwareResource): boolean => {
    return (
      row.kind === VMwareResourceKind.VirtualMachine &&
      sameName(row.clusterName, clusterName) &&
      (!cluster.datacenterName ||
        !row.datacenterName ||
        sameName(row.datacenterName, cluster.datacenterName))
    );
  });
}

// The VMs (templates included) on one ESXi host.
export function getVMwareVirtualMachinesOfHost(
  rows: Array<VMwareResource>,
  host: VMwareResource,
): Array<VMwareResource> {
  const hostName: string = host.hostName || getVMwareDisplayName(host);
  return rows.filter((row: VMwareResource): boolean => {
    return (
      row.kind === VMwareResourceKind.VirtualMachine &&
      sameName(row.hostName, hostName) &&
      (!host.datacenterName ||
        !row.datacenterName ||
        sameName(row.datacenterName, host.datacenterName))
    );
  });
}

/*
 * How much of a cluster's capacity its running hosts use: the CPU (MHz) and
 * memory its hosts report, against what the cluster can give its VMs
 * (vcenter.cluster.cpu.effective / .memory.effective - the hosts that are
 * not effective left out). Null where nothing reports the number.
 */
export interface VMwareClusterUsage {
  cpuUsedMhz: number | null;
  cpuEffectiveMhz: number | null;
  cpuPercent: number | null;
  memoryUsedBytes: number | null;
  memoryEffectiveBytes: number | null;
  memoryPercent: number | null;
}

export function getVMwareClusterUsage(data: {
  cluster: VMwareResource;
  hosts: Array<VMwareResource>;
  datacenters: Array<VMwareResource>;
  now: Date;
}): VMwareClusterUsage {
  let cpuUsed: number | null = null;
  let memoryUsed: number | null = null;

  for (const host of getVMwareHostsOfCluster(data.hosts, data.cluster)) {
    const state: VMwareHostState = getVMwareHostState({
      host: host,
      datacenter: findVMwareDatacenter(data.datacenters, host.datacenterName),
      now: data.now,
    });
    if (!isVMwareHostRunning(state)) {
      continue;
    }
    const cpu: number | null = toVMwareNumber(host.latestCpuMhz);
    const memory: number | null = toVMwareNumber(host.latestMemoryBytes);
    if (cpu !== null) {
      cpuUsed = (cpuUsed ?? 0) + cpu;
    }
    if (memory !== null) {
      memoryUsed = (memoryUsed ?? 0) + memory;
    }
  }

  const fresh: boolean = hasFreshVMwareReadings(data.cluster, data.now);
  const cpuEffective: number | null = fresh
    ? toVMwareNumber(data.cluster.cpuEffectiveMhz)
    : null;
  const memoryEffective: number | null = fresh
    ? toVMwareNumber(data.cluster.memoryEffectiveBytes)
    : null;

  return {
    cpuUsedMhz: cpuUsed,
    cpuEffectiveMhz: cpuEffective,
    cpuPercent:
      cpuUsed !== null && cpuEffective !== null && cpuEffective > 0
        ? (cpuUsed / cpuEffective) * 100
        : null,
    memoryUsedBytes: memoryUsed,
    memoryEffectiveBytes: memoryEffective,
    memoryPercent:
      memoryUsed !== null && memoryEffective !== null && memoryEffective > 0
        ? (memoryUsed / memoryEffective) * 100
        : null,
  };
}

const SEVERITY_RANK: Record<string, number> = {
  [ResourceAttentionSeverity.Critical]: 0,
  [ResourceAttentionSeverity.Warning]: 1,
};

// Not running, but nothing wrong: after the hosts that need attention.
const QUIET_STATES: ReadonlySet<VMwareHostState> = new Set([
  VMwareHostState.PoweredOff,
  VMwareHostState.Standby,
  VMwareHostState.PoweredOffOrStandby,
  VMwareHostState.NotReporting,
  VMwareHostState.NoDataYet,
]);

/*
 * ESXi hosts in the order a glance reads them: the ones that need attention
 * first (not responding before a busy one), then the running ones, then the
 * ones that are off or say nothing, each group by name as people number
 * hosts (esx2 before esx10).
 */
export function sortVMwareHostsForGlance(data: {
  hosts: Array<VMwareResource>;
  datacenters: Array<VMwareResource>;
  now: Date;
}): Array<VMwareResource> {
  const rankOf: (host: VMwareResource) => number = (
    host: VMwareResource,
  ): number => {
    const datacenter: VMwareResource | null = findVMwareDatacenter(
      data.datacenters,
      host.datacenterName,
    );
    const severity: ResourceAttentionSeverity | null = assessVMwareHost({
      host: host,
      datacenter: datacenter,
      now: data.now,
    }).severity;
    if (severity) {
      return SEVERITY_RANK[severity] ?? 1;
    }
    const state: VMwareHostState = getVMwareHostState({
      host: host,
      datacenter: datacenter,
      now: data.now,
    });
    return QUIET_STATES.has(state) ? 3 : 2;
  };

  return data.hosts
    .map((host: VMwareResource): { host: VMwareResource; rank: number } => {
      return { host: host, rank: rankOf(host) };
    })
    .sort(
      (
        a: { host: VMwareResource; rank: number },
        b: { host: VMwareResource; rank: number },
      ): number => {
        if (a.rank !== b.rank) {
          return a.rank - b.rank;
        }
        return getVMwareDisplayName(a.host).localeCompare(
          getVMwareDisplayName(b.host),
          undefined,
          { numeric: true, sensitivity: "base" },
        );
      },
    )
    .map((entry: { host: VMwareResource; rank: number }): VMwareResource => {
      return entry.host;
    });
}

/*
 * A host's CPU and memory as a glance shows them: the latest reading of a
 * running host, nothing for one that is not (its 0% would read as an idle
 * host, not a down one).
 */
export interface VMwareHostLoad {
  cpuPercent: number | null;
  memoryPercent: number | null;
}

export function getVMwareHostLoad(data: {
  host: VMwareResource;
  datacenter: VMwareResource | null;
  now: Date;
}): VMwareHostLoad {
  if (!isVMwareHostRunning(getVMwareHostState(data))) {
    return { cpuPercent: null, memoryPercent: null };
  }
  return {
    cpuPercent: toVMwareNumber(data.host.latestCpuPercent),
    memoryPercent: toVMwareNumber(data.host.latestMemoryPercent),
  };
}
