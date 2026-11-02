import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
  ResourceHealth,
  getResourceAttentionHealth,
  mergeResourceAttentionSeverity,
  sortResourceAttention,
} from "../../../Components/ResourcePart/ResourceAttention";
import {
  ResourcePartStatus,
  ResourcePartTone,
} from "../../../Components/ResourcePart/ResourcePartTypes";
import { OpenIssueRecord } from "../../../Components/ResourceTopology/ResourceTopologyIssues";
import { VMWARE_METRIC_STALE_MS } from "./VMwareHostData";

/*
 * WHAT IN A VCENTER NEEDS SOMEONE, AND HOW BAD IT IS.
 *
 * One set of rules for every page that says it: the vCenter's Overview (its
 * health pill and Needs attention card), the page of each ESXi host, virtual
 * machine, datastore and cluster, the lists' Status column and the Topology.
 * They read the inventory the ingest keeps (VMwareResource): what vCenter
 * last reported about each object, through the VMware agent's collector or
 * a probe, which send the same data.
 *
 *   Critical - broken, or about to be:
 *     an ESXi host vCenter cannot reach (not responding); a host, a cluster
 *     or a datastore beyond that with a critical (red) alarm in vCenter's
 *     own roll-up; a datastore more than 90% full; a VM whose memory the
 *     host swaps to disk.
 *   Warning - needs a look soon:
 *     a host whose CPU or memory is more than 90% busy; a host with a
 *     warning (yellow) alarm; a host vCenter reports no usage for, when
 *     vCenter does not say whether it is down or powered off; a cluster
 *     with hosts that are not effective (in maintenance mode, disconnected
 *     or not responding) or without the memory to lose a host; a datastore
 *     more than 80% full; a VM the host takes memory back from (ballooning)
 *     or that waits for a free CPU (CPU ready over 10%); a VM with a
 *     critical alarm; a resource pool whose memory the host swaps.
 *
 * Every threshold is the one its alert template fires at
 * (Common/Types/Monitor/VMwareAlertTemplates), so a part on this list is
 * one its alert would page about.
 *
 * WHERE A HOST'S STATE COMES FROM. vCenter reports a host's CPU and memory
 * use only while the host is connected: for a host that crashed, lost power
 * or its management network, was disconnected, powered off or put in
 * standby, it reports none, and the receiver (like the probe) writes 0 MHz
 * and 0 MiB. A running ESXi host never uses no memory at all. Which of
 * those it is, vCenter says per datacenter only - how many of its hosts it
 * has lost contact with (power state "unknown"), how many are in standby,
 * how many powered off - so a host with no usage is "Not responding" when
 * its datacenter has lost contact with a host and has none powered off or
 * in standby, "Powered off" or "In standby" in the opposite case, and "No
 * usage reported" (a warning) when its datacenter's counts cannot tell.
 *
 * A VM on a host vCenter cannot reach is Disconnected, as vSphere says it:
 * vCenter does not know what it is doing (it may well run on, its host's
 * management network down), and its numbers are no readings - the host is
 * what needs attention.
 *
 * What is never a problem by itself: a powered-off VM or host (someone did
 * it, on purpose), a template, a host in standby (vSphere DPM saves power),
 * a part vCenter has not reported for a while (it was removed from the
 * inventory; the vCenter's own connection says when everything stopped).
 *
 * Words are English, marked with translationKey() and looked up in the
 * reader's language where they are drawn. React-free, so App tests can
 * read it.
 */

export const VMWARE_DATASTORE_WARNING_PERCENT: number = 80;
export const VMWARE_DATASTORE_CRITICAL_PERCENT: number = 90;
export const VMWARE_HOST_SATURATION_PERCENT: number = 90;
export const VMWARE_CPU_READY_WARNING_PERCENT: number = 10;

// A part whose newest reading is older than this is not judged.
export const VMWARE_READINGS_STALE_MS: number = VMWARE_METRIC_STALE_MS;

export enum VMwareHostState {
  // vCenter reports the host's CPU and memory use: it is up and connected.
  Connected = "connected",
  // vCenter has lost contact with it (power state unknown).
  NotResponding = "not-responding",
  PoweredOff = "powered-off",
  Standby = "standby",
  // No usage; its datacenter has hosts powered off and in standby both.
  PoweredOffOrStandby = "powered-off-or-standby",
  // No usage, and its datacenter's counts cannot say why.
  NoUsage = "no-usage",
  // Its newest reading is older than VMWARE_READINGS_STALE_MS.
  NotReporting = "not-reporting",
  // In the inventory, but no reading arrived for it yet.
  NoDataYet = "no-data-yet",
}

export interface VMwareAssessment {
  severity: ResourceAttentionSeverity | null;
  reasons: Array<ResourceAttentionText>;
}

/*
 * What a datacenter's own counts say needs a look, in three groups - its
 * hosts, its VMs, its clusters - each a row of its own in Needs attention,
 * one step from the list where the parts it counts are.
 */
export type VMwareDatacenterGroup = "hosts" | "virtual-machines" | "clusters";

export interface VMwareDatacenterFinding extends VMwareAssessment {
  group: VMwareDatacenterGroup;
}

/*
 * Whether a cluster's running hosts could take the load of its largest one:
 * vSphere HA restarts a failed host's VMs on the hosts left, and when they
 * use more memory than those hosts have, some may not fit.
 */
export interface VMwareClusterHeadroom {
  runningHostCount: number;
  usedMemoryBytes: number;
  capacityMemoryBytes: number;
  largestHostMemoryBytes: number;
  // The memory the cluster would have with its largest host gone.
  remainingMemoryBytes: number;
  canLoseAHost: boolean;
}

// Where an item of Needs attention leads: a part's page, or a list.
export type VMwareRouteFor = (
  kind: VMwareResourceKind,
  externalId: string,
) => Route | undefined;

export type VMwareListRouteFor = (
  kind: VMwareResourceKind,
) => Route | undefined;

const REASON_NO_USAGE: string = translationKey("No CPU or memory use reported");
const REASON_CPU_AT: string = translationKey("CPU at {{percent}}");
const REASON_MEMORY_AT: string = translationKey("Memory at {{percent}}");
const REASON_PERCENT_FULL: string = translationKey("{{percent}} full");
const REASON_SWAPPED: string = translationKey(
  "{{amount}} of memory swapped by the host",
);
const REASON_BALLOONED: string = translationKey(
  "{{amount}} of memory ballooned",
);
const REASON_CPU_READY: string = translationKey("CPU ready {{percent}}");
const REASON_CANNOT_LOSE_A_HOST: string = translationKey(
  "Not enough memory to lose a host",
);
const REASON_HOSTS_NOT_EFFECTIVE: { one: string; other: string } = {
  one: translationKey("{{count}} host not effective"),
  other: translationKey("{{count}} hosts not effective"),
};
const REASON_HOSTS_NOT_RESPONDING: { one: string; other: string } = {
  one: translationKey("{{count}} host not responding"),
  other: translationKey("{{count}} hosts not responding"),
};
const REASON_HOSTS_CRITICAL_ALARM: { one: string; other: string } = {
  one: translationKey("{{count}} host with a critical alarm"),
  other: translationKey("{{count}} hosts with a critical alarm"),
};
const REASON_HOSTS_WARNING_ALARM: { one: string; other: string } = {
  one: translationKey("{{count}} host with a warning alarm"),
  other: translationKey("{{count}} hosts with a warning alarm"),
};
const REASON_VMS_CRITICAL_ALARM: { one: string; other: string } = {
  one: translationKey("{{count}} VM with a critical alarm"),
  other: translationKey("{{count}} VMs with a critical alarm"),
};
const REASON_CLUSTERS_CRITICAL_ALARM: { one: string; other: string } = {
  one: translationKey("{{count}} cluster with a critical alarm"),
  other: translationKey("{{count}} clusters with a critical alarm"),
};

const STATUS_CONNECTED: string = translationKey("Connected");
const STATUS_NOT_RESPONDING: string = translationKey("Not responding");
const STATUS_POWERED_OFF: string = translationKey("Powered off");
const STATUS_STANDBY: string = translationKey("In standby");
const STATUS_POWERED_OFF_OR_STANDBY: string = translationKey(
  "Powered off or in standby",
);
const STATUS_NO_USAGE: string = translationKey("No usage reported");
const STATUS_NOT_REPORTING: string = translationKey("Not reporting");
const STATUS_NO_DATA_YET: string = translationKey("No data yet");
const STATUS_RUNNING: string = translationKey("Running");
const STATUS_DISCONNECTED: string = translationKey("Disconnected");
const STATUS_TEMPLATE: string = translationKey("Template");
const STATUS_PERCENT_USED: string = translationKey("{{percent}} used");
const STATUS_HEALTHY: string = translationKey("Healthy");
const STATUS_DEGRADED: string = translationKey("Degraded");
const STATUS_UNHEALTHY: string = translationKey("Unhealthy");

const DESCRIPTION_NOT_RESPONDING: string = translationKey(
  "vCenter has lost contact with this host: it crashed, lost power or its management network, or was disconnected.",
);
const DESCRIPTION_POWERED_OFF: string = translationKey(
  "Someone powered this host off through vCenter.",
);
const DESCRIPTION_STANDBY: string = translationKey(
  "vSphere DPM put this host in standby to save power. It wakes when the cluster needs it.",
);
const DESCRIPTION_POWERED_OFF_OR_STANDBY: string = translationKey(
  "vCenter reports no CPU or memory use on this host, and its datacenter has hosts powered off and in standby.",
);
const DESCRIPTION_NO_USAGE: string = translationKey(
  "vCenter reports no CPU or memory use on this host: it is not responding, powered off or in standby.",
);
const DESCRIPTION_NOT_REPORTING: string = translationKey(
  "vCenter has not reported this for more than 15 minutes.",
);
const DESCRIPTION_VM_DISCONNECTED: string = translationKey(
  "vCenter cannot reach the ESXi host this VM runs on, so it does not know what the VM is doing.",
);

const KIND_DATACENTER: string = translationKey("Datacenter");
const KIND_CLUSTER: string = translationKey("Cluster");
const KIND_HOST: string = translationKey("ESXi host");
const KIND_DATASTORE: string = translationKey("Datastore");
const KIND_VIRTUAL_MACHINE: string = translationKey("VM");
const KIND_RESOURCE_POOL: string = translationKey("Resource pool");

// The order Needs attention lists the kinds in, at one severity.
export const VMWARE_ATTENTION_KIND_ORDER: Array<string> = [
  KIND_DATACENTER,
  KIND_CLUSTER,
  KIND_HOST,
  KIND_DATASTORE,
  KIND_VIRTUAL_MACHINE,
  KIND_RESOURCE_POOL,
];

// A number from a column that may be null, a string (a bigint) or garbage.
export function toVMwareNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number: number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// A date from a column that may be null or an ISO string off the wire.
export function toVMwareDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

// Whether the part's newest reading is recent enough to judge.
export function hasFreshVMwareReadings(
  row: Pick<VMwareResource, "metricsUpdatedAt">,
  now: Date,
): boolean {
  const updatedAt: Date | null = toVMwareDate(row.metricsUpdatedAt);
  if (!updatedAt) {
    return false;
  }
  return now.getTime() - updatedAt.getTime() <= VMWARE_READINGS_STALE_MS;
}

// The part's name as vCenter knows it: its name, else its id's last part.
export function getVMwareDisplayName(
  row: Pick<VMwareResource, "name" | "externalId">,
): string {
  if (row.name) {
    return row.name;
  }
  const externalId: string = row.externalId || "";
  const slashIndex: number = externalId.lastIndexOf("/");
  return slashIndex >= 0 ? externalId.substring(slashIndex + 1) : externalId;
}

// A host's name as its metrics name it (vcenter.host.name).
export function getVMwareHostName(
  row: Pick<VMwareResource, "hostName" | "name" | "externalId">,
): string {
  return row.hostName || getVMwareDisplayName(row);
}

// A cluster's name as its metrics name it (vcenter.cluster.name).
export function getVMwareClusterName(
  row: Pick<VMwareResource, "clusterName" | "name" | "externalId">,
): string {
  return row.clusterName || getVMwareDisplayName(row);
}

// The share of a datastore that is used, or null when it reports no size.
export function getVMwareDatastorePercent(
  row: Pick<
    VMwareResource,
    "latestDiskPercent" | "latestDiskBytes" | "maxDiskBytes"
  >,
): number | null {
  const reported: number | null = toVMwareNumber(row.latestDiskPercent);
  if (reported !== null) {
    return reported;
  }
  const used: number | null = toVMwareNumber(row.latestDiskBytes);
  const total: number | null = toVMwareNumber(row.maxDiskBytes);
  if (used === null || total === null || total <= 0) {
    return null;
  }
  return (used / total) * 100;
}

// "91%": a share as a reason says it, rounded to a whole percent.
export function formatVMwareReasonPercent(percent: number): string {
  return `${Math.round(percent)}%`;
}

// "1.5 GiB": an amount of memory as a reason says it.
export function formatVMwareReasonBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units: Array<string> = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value: number = bytes / 1024;
  let index: number = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

function sameName(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/*
 * Whether vCenter reports no use at all for a host: no memory (a running
 * ESXi host always uses some) and no CPU. The host is then not connected,
 * or not running.
 */
export function reportsNoVMwareHostUsage(
  row: Pick<VMwareResource, "latestMemoryBytes" | "latestCpuMhz">,
): boolean {
  const memory: number | null = toVMwareNumber(row.latestMemoryBytes);
  const cpu: number | null = toVMwareNumber(row.latestCpuMhz);
  return memory === 0 && (cpu === null || cpu === 0);
}

// The datacenter a part sits in, from the datacenters' rows.
export function findVMwareDatacenter(
  datacenters: Array<VMwareResource>,
  datacenterName: string | null | undefined,
): VMwareResource | null {
  if (!datacenterName) {
    return null;
  }
  return (
    datacenters.find((row: VMwareResource): boolean => {
      return (
        row.kind === VMwareResourceKind.Datacenter &&
        sameName(getVMwareDisplayName(row), datacenterName)
      );
    }) || null
  );
}

/*
 * What vCenter's counts for a datacenter say about its hosts that report no
 * usage (see the header): which state such a host is in.
 */
function getNoUsageHostState(
  datacenter: VMwareResource | null,
  now: Date,
): VMwareHostState {
  // Counts from an older collection than the host's say nothing about it.
  if (!datacenter || !hasFreshVMwareReadings(datacenter, now)) {
    return VMwareHostState.NoUsage;
  }
  const total: number | null = toVMwareNumber(datacenter.hostCount);
  const poweredOn: number | null = toVMwareNumber(
    datacenter.poweredOnHostCount,
  );
  const notResponding: number | null = toVMwareNumber(
    datacenter.notRespondingHostCount,
  );
  const standby: number | null = toVMwareNumber(datacenter.standbyHostCount);
  if (
    total === null ||
    poweredOn === null ||
    notResponding === null ||
    standby === null
  ) {
    return VMwareHostState.NoUsage;
  }
  const poweredOff: number = Math.max(
    0,
    total - poweredOn - notResponding - standby,
  );
  const offOrStandby: number = poweredOff + standby;

  if (notResponding > 0 && offOrStandby === 0) {
    return VMwareHostState.NotResponding;
  }
  if (notResponding === 0 && offOrStandby > 0) {
    if (standby === 0) {
      return VMwareHostState.PoweredOff;
    }
    if (poweredOff === 0) {
      return VMwareHostState.Standby;
    }
    return VMwareHostState.PoweredOffOrStandby;
  }
  return VMwareHostState.NoUsage;
}

export function getVMwareHostState(data: {
  host: VMwareResource;
  datacenter: VMwareResource | null;
  now: Date;
}): VMwareHostState {
  if (!toVMwareDate(data.host.metricsUpdatedAt)) {
    return VMwareHostState.NoDataYet;
  }
  if (!hasFreshVMwareReadings(data.host, data.now)) {
    return VMwareHostState.NotReporting;
  }
  if (reportsNoVMwareHostUsage(data.host)) {
    return getNoUsageHostState(data.datacenter, data.now);
  }
  return VMwareHostState.Connected;
}

// Whether a host in this state runs workloads and reports how busy it is.
export function isVMwareHostRunning(state: VMwareHostState): boolean {
  return state === VMwareHostState.Connected;
}

/*
 * Whether vCenter's latest report says nothing about how busy a host is: it
 * is not responding, off or in standby, and the 0% CPU and memory it reports
 * (on its VMs too) are no reading, never an idle host. A host that has not
 * reported for a while, or not yet, is not one: what it last sent is still
 * what it last used.
 */
export function reportsNoVMwareHostLoad(state: VMwareHostState): boolean {
  return (
    state === VMwareHostState.NotResponding ||
    state === VMwareHostState.PoweredOff ||
    state === VMwareHostState.Standby ||
    state === VMwareHostState.PoweredOffOrStandby ||
    state === VMwareHostState.NoUsage
  );
}

/*
 * Whether vCenter knows which of a host's VMs are running. Not on a host it
 * has lost contact with: it repeats each VM's last power state while the VM
 * may have stopped with the host, or run on with only its management network
 * down - so a page says how many VMs the host has, never how many run. Nor on
 * a host whose state it does not say. A host powered off or in standby has
 * its VMs off (DPM moves the running ones away first), as vCenter reports.
 */
export function knowsVMwareHostVirtualMachineStates(
  state: VMwareHostState,
): boolean {
  return (
    state !== VMwareHostState.NotResponding && state !== VMwareHostState.NoUsage
  );
}

export function assessVMwareHost(data: {
  host: VMwareResource;
  datacenter: VMwareResource | null;
  now: Date;
}): VMwareAssessment {
  const state: VMwareHostState = getVMwareHostState(data);

  if (state === VMwareHostState.NotResponding) {
    return {
      severity: ResourceAttentionSeverity.Critical,
      reasons: [{ text: STATUS_NOT_RESPONDING }],
    };
  }
  if (state === VMwareHostState.NoUsage) {
    return {
      severity: ResourceAttentionSeverity.Warning,
      reasons: [{ text: REASON_NO_USAGE }],
    };
  }
  if (state !== VMwareHostState.Connected) {
    return { severity: null, reasons: [] };
  }

  const reasons: Array<ResourceAttentionText> = [];
  const cpu: number | null = toVMwareNumber(data.host.latestCpuPercent);
  const memory: number | null = toVMwareNumber(data.host.latestMemoryPercent);

  if (cpu !== null && cpu > VMWARE_HOST_SATURATION_PERCENT) {
    reasons.push({
      text: REASON_CPU_AT,
      values: { percent: formatVMwareReasonPercent(cpu) },
    });
  }
  if (memory !== null && memory > VMWARE_HOST_SATURATION_PERCENT) {
    reasons.push({
      text: REASON_MEMORY_AT,
      values: { percent: formatVMwareReasonPercent(memory) },
    });
  }

  return {
    severity: reasons.length > 0 ? ResourceAttentionSeverity.Warning : null,
    reasons: reasons,
  };
}

// The ESXi host a VM runs on, from the hosts' rows.
export function findVMwareHostOfVirtualMachine(
  hosts: Array<VMwareResource>,
  vm: Pick<VMwareResource, "hostName" | "datacenterName">,
): VMwareResource | null {
  if (!vm.hostName) {
    return null;
  }
  return (
    hosts.find((host: VMwareResource): boolean => {
      return (
        host.kind === VMwareResourceKind.Host &&
        sameName(getVMwareHostName(host), vm.hostName) &&
        (!vm.datacenterName ||
          !host.datacenterName ||
          sameName(host.datacenterName, vm.datacenterName))
      );
    }) || null
  );
}

/*
 * Whether vCenter has lost contact with the host a VM runs on (see the
 * header): judged when the page has the host's row and its datacenter's.
 */
export function isVMwareVirtualMachineDisconnected(data: {
  vm: VMwareResource;
  hosts?: Array<VMwareResource> | undefined;
  datacenters?: Array<VMwareResource> | undefined;
  now: Date;
}): boolean {
  const host: VMwareResource | null = findVMwareHostOfVirtualMachine(
    data.hosts || [],
    data.vm,
  );
  if (!host) {
    return false;
  }
  return (
    getVMwareHostState({
      host: host,
      datacenter: findVMwareDatacenter(
        data.datacenters || [],
        host.datacenterName,
      ),
      now: data.now,
    }) === VMwareHostState.NotResponding
  );
}

export function assessVMwareVirtualMachine(data: {
  vm: VMwareResource;
  now: Date;
  // The hosts and datacenters the page has: a VM on a host vCenter lost is not judged.
  hosts?: Array<VMwareResource> | undefined;
  datacenters?: Array<VMwareResource> | undefined;
}): VMwareAssessment {
  const vm: VMwareResource = data.vm;
  if (
    vm.isTemplate === true ||
    vm.isPoweredOn !== true ||
    !hasFreshVMwareReadings(vm, data.now) ||
    isVMwareVirtualMachineDisconnected(data)
  ) {
    return { severity: null, reasons: [] };
  }

  const reasons: Array<ResourceAttentionText> = [];
  const severities: Array<ResourceAttentionSeverity> = [];
  const swapped: number | null = toVMwareNumber(vm.memorySwappedBytes);
  const ballooned: number | null = toVMwareNumber(vm.memoryBalloonedBytes);
  const ready: number | null = toVMwareNumber(vm.cpuReadinessPercent);

  if (swapped !== null && swapped > 0) {
    // The guest pages through the hypervisor's disk: everything in it crawls.
    reasons.push({
      text: REASON_SWAPPED,
      values: { amount: formatVMwareReasonBytes(swapped) },
    });
    severities.push(ResourceAttentionSeverity.Critical);
  }
  if (ballooned !== null && ballooned > 0) {
    reasons.push({
      text: REASON_BALLOONED,
      values: { amount: formatVMwareReasonBytes(ballooned) },
    });
    severities.push(ResourceAttentionSeverity.Warning);
  }
  if (ready !== null && ready > VMWARE_CPU_READY_WARNING_PERCENT) {
    reasons.push({
      text: REASON_CPU_READY,
      values: { percent: formatVMwareReasonPercent(ready) },
    });
    severities.push(ResourceAttentionSeverity.Warning);
  }

  return {
    severity: mergeResourceAttentionSeverity(severities),
    reasons: reasons,
  };
}

export function assessVMwareDatastore(data: {
  datastore: VMwareResource;
  now: Date;
}): VMwareAssessment {
  if (!hasFreshVMwareReadings(data.datastore, data.now)) {
    return { severity: null, reasons: [] };
  }
  const percent: number | null = getVMwareDatastorePercent(data.datastore);
  if (percent === null) {
    return { severity: null, reasons: [] };
  }
  const reason: ResourceAttentionText = {
    text: REASON_PERCENT_FULL,
    values: { percent: formatVMwareReasonPercent(percent) },
  };
  if (percent > VMWARE_DATASTORE_CRITICAL_PERCENT) {
    return { severity: ResourceAttentionSeverity.Critical, reasons: [reason] };
  }
  if (percent > VMWARE_DATASTORE_WARNING_PERCENT) {
    return { severity: ResourceAttentionSeverity.Warning, reasons: [reason] };
  }
  return { severity: null, reasons: [] };
}

export function assessVMwareResourcePool(data: {
  pool: VMwareResource;
  now: Date;
}): VMwareAssessment {
  if (!hasFreshVMwareReadings(data.pool, data.now)) {
    return { severity: null, reasons: [] };
  }
  const swapped: number | null = toVMwareNumber(data.pool.memorySwappedBytes);
  if (swapped !== null && swapped > 0) {
    return {
      severity: ResourceAttentionSeverity.Warning,
      reasons: [
        {
          text: REASON_SWAPPED,
          values: { amount: formatVMwareReasonBytes(swapped) },
        },
      ],
    };
  }
  return { severity: null, reasons: [] };
}

// The hosts a cluster holds: same datacenter, same cluster name.
export function getVMwareHostsOfCluster(
  rows: Array<VMwareResource>,
  cluster: VMwareResource,
): Array<VMwareResource> {
  const clusterName: string = getVMwareClusterName(cluster);
  return rows.filter((row: VMwareResource): boolean => {
    return (
      row.kind === VMwareResourceKind.Host &&
      sameName(row.clusterName, clusterName) &&
      (!cluster.datacenterName ||
        !row.datacenterName ||
        sameName(row.datacenterName, cluster.datacenterName))
    );
  });
}

/*
 * Whether the cluster could lose its largest running host (see
 * VMwareClusterHeadroom). Null when there is nothing to work it out from:
 * fewer than two running hosts, a running host whose memory size vCenter
 * does not report, or hosts that are not effective (a host in maintenance
 * mode still reports its memory but runs no VMs, so the sum would count
 * room that is not there - the not-effective hosts are a finding of their
 * own).
 */
export function getVMwareClusterHeadroom(data: {
  cluster: VMwareResource;
  hosts: Array<VMwareResource>;
  datacenters: Array<VMwareResource>;
  now: Date;
}): VMwareClusterHeadroom | null {
  const total: number | null = toVMwareNumber(data.cluster.hostCount);
  const effective: number | null = toVMwareNumber(
    data.cluster.effectiveHostCount,
  );
  if (total !== null && effective !== null && effective < total) {
    return null;
  }

  const running: Array<VMwareResource> = data.hosts.filter(
    (host: VMwareResource): boolean => {
      return isVMwareHostRunning(
        getVMwareHostState({
          host: host,
          datacenter: findVMwareDatacenter(
            data.datacenters,
            host.datacenterName,
          ),
          now: data.now,
        }),
      );
    },
  );
  if (running.length < 2) {
    return null;
  }

  let used: number = 0;
  let capacity: number = 0;
  let largest: number = 0;
  for (const host of running) {
    const memory: number | null = toVMwareNumber(host.latestMemoryBytes);
    const size: number | null = toVMwareNumber(host.maxMemoryBytes);
    if (memory === null || size === null || size <= 0) {
      return null;
    }
    used += memory;
    capacity += size;
    largest = Math.max(largest, size);
  }

  const remaining: number = capacity - largest;
  return {
    runningHostCount: running.length,
    usedMemoryBytes: used,
    capacityMemoryBytes: capacity,
    largestHostMemoryBytes: largest,
    remainingMemoryBytes: remaining,
    canLoseAHost: used <= remaining,
  };
}

/*
 * How many of a cluster's hosts are not effective for a reason no host of
 * its own says: vCenter counts a host that is not responding, powered off
 * or in standby as not effective, and those say so on their own rows
 * (planned, or critical by themselves). What is left is a host that is up
 * and connected, yet not one DRS and HA place VMs on - in maintenance mode,
 * most often.
 */
export function getVMwareClusterUnexplainedNotEffective(data: {
  cluster: VMwareResource;
  hosts: Array<VMwareResource>;
  datacenters: Array<VMwareResource>;
  now: Date;
}): number {
  const total: number | null = toVMwareNumber(data.cluster.hostCount);
  const effective: number | null = toVMwareNumber(
    data.cluster.effectiveHostCount,
  );
  if (total === null || effective === null || effective >= total) {
    return 0;
  }
  const notRunning: number = getVMwareHostsOfCluster(
    data.hosts,
    data.cluster,
  ).filter((host: VMwareResource): boolean => {
    const state: VMwareHostState = getVMwareHostState({
      host: host,
      datacenter: findVMwareDatacenter(data.datacenters, host.datacenterName),
      now: data.now,
    });
    return (
      state === VMwareHostState.NotResponding ||
      state === VMwareHostState.PoweredOff ||
      state === VMwareHostState.Standby ||
      state === VMwareHostState.PoweredOffOrStandby ||
      state === VMwareHostState.NoUsage
    );
  }).length;
  return Math.max(0, total - effective - notRunning);
}

export function assessVMwareCluster(data: {
  cluster: VMwareResource;
  hosts: Array<VMwareResource>;
  datacenters: Array<VMwareResource>;
  now: Date;
}): VMwareAssessment {
  if (!hasFreshVMwareReadings(data.cluster, data.now)) {
    return { severity: null, reasons: [] };
  }
  const reasons: Array<ResourceAttentionText> = [];
  const notEffective: number = getVMwareClusterUnexplainedNotEffective(data);

  if (notEffective > 0) {
    reasons.push({
      text: REASON_HOSTS_NOT_EFFECTIVE.other,
      values: { count: String(notEffective) },
      plural: { one: REASON_HOSTS_NOT_EFFECTIVE.one, count: notEffective },
    });
  }

  const headroom: VMwareClusterHeadroom | null = getVMwareClusterHeadroom({
    cluster: data.cluster,
    hosts: getVMwareHostsOfCluster(data.hosts, data.cluster),
    datacenters: data.datacenters,
    now: data.now,
  });
  if (headroom && !headroom.canLoseAHost) {
    reasons.push({ text: REASON_CANNOT_LOSE_A_HOST });
  }

  return {
    severity: reasons.length > 0 ? ResourceAttentionSeverity.Warning : null,
    reasons: reasons,
  };
}

/*
 * A cluster as its status and its row in a list say it: its own findings,
 * and the hosts of its own vCenter cannot reach - a host that is not
 * responding makes its cluster Unhealthy, though Needs attention lists the
 * host, not the cluster, for it. A busy host is the host's own to say: DRS
 * balances a cluster's hosts, and one at 92% CPU is not a cluster in
 * trouble.
 */
export function assessVMwareClusterWithHosts(data: {
  cluster: VMwareResource;
  hosts: Array<VMwareResource>;
  datacenters: Array<VMwareResource>;
  now: Date;
}): VMwareAssessment {
  const own: VMwareAssessment = assessVMwareCluster(data);
  if (!hasFreshVMwareReadings(data.cluster, data.now)) {
    return own;
  }
  const notResponding: number = getVMwareHostsOfCluster(
    data.hosts,
    data.cluster,
  ).filter((host: VMwareResource): boolean => {
    return (
      getVMwareHostState({
        host: host,
        datacenter: findVMwareDatacenter(data.datacenters, host.datacenterName),
        now: data.now,
      }) === VMwareHostState.NotResponding
    );
  }).length;

  if (notResponding === 0) {
    return own;
  }

  const severities: Array<ResourceAttentionSeverity> = [
    ResourceAttentionSeverity.Critical,
  ];
  if (own.severity) {
    severities.push(own.severity);
  }
  return {
    severity: mergeResourceAttentionSeverity(severities),
    reasons: [
      {
        text: REASON_HOSTS_NOT_RESPONDING.other,
        values: { count: String(notResponding) },
        plural: { one: REASON_HOSTS_NOT_RESPONDING.one, count: notResponding },
      },
      ...own.reasons,
    ],
  };
}

/*
 * What a datacenter's counts say beyond what its hosts' own rows say: hosts
 * vCenter lost contact with that no host row names (a host row with no
 * usage says it itself), hosts with a critical alarm for another reason
 * (a host vCenter cannot reach has its critical "connection" alarm), hosts
 * with a warning alarm, VMs and clusters with a critical alarm.
 */
export function getVMwareDatacenterFindings(data: {
  datacenter: VMwareResource;
  hosts: Array<VMwareResource>;
  now: Date;
}): Array<VMwareDatacenterFinding> {
  const datacenter: VMwareResource = data.datacenter;
  if (!hasFreshVMwareReadings(datacenter, data.now)) {
    return [];
  }

  const count: (value: unknown) => number = (value: unknown): number => {
    return Math.max(0, Math.trunc(toVMwareNumber(value) ?? 0));
  };

  const name: string = getVMwareDisplayName(datacenter);
  const namedNotResponding: number = data.hosts.filter(
    (host: VMwareResource): boolean => {
      return (
        host.kind === VMwareResourceKind.Host &&
        sameName(host.datacenterName, name) &&
        getVMwareHostState({
          host: host,
          datacenter: datacenter,
          now: data.now,
        }) === VMwareHostState.NotResponding
      );
    },
  ).length;

  const notResponding: number = count(datacenter.notRespondingHostCount);
  const unnamedNotResponding: number = Math.max(
    0,
    notResponding - namedNotResponding,
  );
  const otherCriticalHosts: number = Math.max(
    0,
    count(datacenter.criticalHostCount) - notResponding,
  );
  const warningHosts: number = count(datacenter.warningHostCount);
  const criticalVms: number = count(datacenter.criticalVmCount);
  const criticalClusters: number = count(datacenter.criticalClusterCount);

  const plural: (
    template: { one: string; other: string },
    value: number,
  ) => ResourceAttentionText = (
    template: { one: string; other: string },
    value: number,
  ): ResourceAttentionText => {
    return {
      text: template.other,
      values: { count: String(value) },
      plural: { one: template.one, count: value },
    };
  };

  const findings: Array<VMwareDatacenterFinding> = [];

  const hostReasons: Array<ResourceAttentionText> = [];
  const hostSeverities: Array<ResourceAttentionSeverity> = [];
  if (unnamedNotResponding > 0) {
    hostReasons.push(plural(REASON_HOSTS_NOT_RESPONDING, unnamedNotResponding));
    hostSeverities.push(ResourceAttentionSeverity.Critical);
  }
  if (otherCriticalHosts > 0) {
    hostReasons.push(plural(REASON_HOSTS_CRITICAL_ALARM, otherCriticalHosts));
    hostSeverities.push(ResourceAttentionSeverity.Critical);
  }
  if (warningHosts > 0) {
    hostReasons.push(plural(REASON_HOSTS_WARNING_ALARM, warningHosts));
    hostSeverities.push(ResourceAttentionSeverity.Warning);
  }
  if (hostReasons.length > 0) {
    findings.push({
      group: "hosts",
      severity: mergeResourceAttentionSeverity(hostSeverities),
      reasons: hostReasons,
    });
  }

  if (criticalVms > 0) {
    findings.push({
      group: "virtual-machines",
      severity: ResourceAttentionSeverity.Warning,
      reasons: [plural(REASON_VMS_CRITICAL_ALARM, criticalVms)],
    });
  }

  if (criticalClusters > 0) {
    findings.push({
      group: "clusters",
      severity: ResourceAttentionSeverity.Critical,
      reasons: [plural(REASON_CLUSTERS_CRITICAL_ALARM, criticalClusters)],
    });
  }

  return findings;
}

// ---- What each part shows ---------------------------------------------------

function toneOf(severity: ResourceAttentionSeverity | null): ResourcePartTone {
  if (severity === ResourceAttentionSeverity.Critical) {
    return "danger";
  }
  if (severity === ResourceAttentionSeverity.Warning) {
    return "warning";
  }
  return "positive";
}

function notReportingStatus(): ResourcePartStatus {
  return {
    label: STATUS_NOT_REPORTING,
    tone: "neutral",
    description: DESCRIPTION_NOT_REPORTING,
  };
}

function noDataYetStatus(): ResourcePartStatus {
  return { label: STATUS_NO_DATA_YET, tone: "neutral" };
}

export function getVMwareHostStatus(data: {
  host: VMwareResource;
  datacenter: VMwareResource | null;
  now: Date;
}): ResourcePartStatus {
  const state: VMwareHostState = getVMwareHostState(data);
  switch (state) {
    case VMwareHostState.NoDataYet:
      return noDataYetStatus();
    case VMwareHostState.NotReporting:
      return notReportingStatus();
    case VMwareHostState.NotResponding:
      return {
        label: STATUS_NOT_RESPONDING,
        tone: "danger",
        description: DESCRIPTION_NOT_RESPONDING,
      };
    case VMwareHostState.PoweredOff:
      return {
        label: STATUS_POWERED_OFF,
        tone: "neutral",
        description: DESCRIPTION_POWERED_OFF,
      };
    case VMwareHostState.Standby:
      return {
        label: STATUS_STANDBY,
        tone: "neutral",
        description: DESCRIPTION_STANDBY,
      };
    case VMwareHostState.PoweredOffOrStandby:
      return {
        label: STATUS_POWERED_OFF_OR_STANDBY,
        tone: "neutral",
        description: DESCRIPTION_POWERED_OFF_OR_STANDBY,
      };
    case VMwareHostState.NoUsage:
      return {
        label: STATUS_NO_USAGE,
        tone: "warning",
        description: DESCRIPTION_NO_USAGE,
      };
    default:
      return {
        label: STATUS_CONNECTED,
        tone: toneOf(assessVMwareHost(data).severity),
      };
  }
}

export function getVMwareVirtualMachineStatus(data: {
  vm: VMwareResource;
  now: Date;
  // The hosts and datacenters the page has: what tells a disconnected VM.
  hosts?: Array<VMwareResource> | undefined;
  datacenters?: Array<VMwareResource> | undefined;
}): ResourcePartStatus {
  const vm: VMwareResource = data.vm;
  if (vm.isTemplate === true) {
    return { label: STATUS_TEMPLATE, tone: "neutral" };
  }
  if (!toVMwareDate(vm.metricsUpdatedAt)) {
    return noDataYetStatus();
  }
  if (!hasFreshVMwareReadings(vm, data.now)) {
    return notReportingStatus();
  }
  if (isVMwareVirtualMachineDisconnected(data)) {
    return {
      label: STATUS_DISCONNECTED,
      tone: "neutral",
      description: DESCRIPTION_VM_DISCONNECTED,
    };
  }
  if (vm.isPoweredOn === false) {
    return { label: STATUS_POWERED_OFF, tone: "neutral" };
  }
  if (vm.isPoweredOn !== true) {
    return noDataYetStatus();
  }
  return {
    label: STATUS_RUNNING,
    tone: toneOf(assessVMwareVirtualMachine(data).severity),
  };
}

export function getVMwareDatastoreStatus(data: {
  datastore: VMwareResource;
  now: Date;
}): ResourcePartStatus {
  if (!toVMwareDate(data.datastore.metricsUpdatedAt)) {
    return noDataYetStatus();
  }
  if (!hasFreshVMwareReadings(data.datastore, data.now)) {
    return notReportingStatus();
  }
  const percent: number | null = getVMwareDatastorePercent(data.datastore);
  if (percent === null) {
    return noDataYetStatus();
  }
  return {
    label: STATUS_PERCENT_USED,
    values: { percent: formatVMwareReasonPercent(percent) },
    tone: toneOf(assessVMwareDatastore(data).severity),
  };
}

export function getVMwareClusterStatus(data: {
  cluster: VMwareResource;
  hosts: Array<VMwareResource>;
  datacenters: Array<VMwareResource>;
  now: Date;
}): ResourcePartStatus {
  if (!toVMwareDate(data.cluster.metricsUpdatedAt)) {
    return noDataYetStatus();
  }
  if (!hasFreshVMwareReadings(data.cluster, data.now)) {
    return notReportingStatus();
  }
  const severity: ResourceAttentionSeverity | null =
    assessVMwareClusterWithHosts(data).severity;
  if (severity === ResourceAttentionSeverity.Critical) {
    return { label: STATUS_UNHEALTHY, tone: "danger" };
  }
  if (severity === ResourceAttentionSeverity.Warning) {
    return { label: STATUS_DEGRADED, tone: "warning" };
  }
  return { label: STATUS_HEALTHY, tone: "positive" };
}

// ---- Needs attention ---------------------------------------------------------

function kindWordOf(kind: VMwareResourceKind): string {
  switch (kind) {
    case VMwareResourceKind.Datacenter:
      return KIND_DATACENTER;
    case VMwareResourceKind.Cluster:
      return KIND_CLUSTER;
    case VMwareResourceKind.Host:
      return KIND_HOST;
    case VMwareResourceKind.Datastore:
      return KIND_DATASTORE;
    case VMwareResourceKind.ResourcePool:
      return KIND_RESOURCE_POOL;
    default:
      return KIND_VIRTUAL_MACHINE;
  }
}

export function getVMwareKindIcon(kind: VMwareResourceKind): IconProp {
  switch (kind) {
    case VMwareResourceKind.Datacenter:
      return IconProp.Folder;
    case VMwareResourceKind.Cluster:
      return IconProp.SquareStack;
    case VMwareResourceKind.Host:
      return IconProp.ServerStack;
    case VMwareResourceKind.Datastore:
      return IconProp.Database;
    case VMwareResourceKind.ResourcePool:
      return IconProp.Layers;
    default:
      return IconProp.Cube;
  }
}

// Under the name: where the part sits, which tells two of one name apart.
function detailOf(row: VMwareResource): string | undefined {
  switch (row.kind) {
    case VMwareResourceKind.VirtualMachine:
      return row.hostName || undefined;
    case VMwareResourceKind.Host:
      return row.clusterName || row.datacenterName || undefined;
    case VMwareResourceKind.ResourcePool:
      return row.clusterName || row.hostName || undefined;
    case VMwareResourceKind.Cluster:
    case VMwareResourceKind.Datastore:
      return row.datacenterName || undefined;
    default:
      return undefined;
  }
}

// The key of a part's row in Needs attention ("Host:host/dc1/esx01").
export function getVMwareAttentionKey(
  kind: VMwareResourceKind,
  externalId: string,
): string {
  return `${kind}:${externalId}`;
}

const DATACENTER_GROUP_LIST_KINDS: Record<
  VMwareDatacenterGroup,
  VMwareResourceKind
> = {
  hosts: VMwareResourceKind.Host,
  "virtual-machines": VMwareResourceKind.VirtualMachine,
  clusters: VMwareResourceKind.Cluster,
};

/*
 * Everything in the vCenter that needs attention, most urgent first: each
 * part by its rules, and each datacenter's counts that no part's row says.
 * `rows` is the inventory as a page read it: a page that reads only some
 * VMs (the ones that may need attention) hands those. `contextRows` are
 * read to judge the listed ones - a host's datacenter, a cluster's hosts -
 * without being listed themselves: a cluster's page lists the cluster and
 * what is in it, not its datacenter.
 */
export function getVMwareAttentionItems(data: {
  rows: Array<VMwareResource>;
  contextRows?: Array<VMwareResource> | undefined;
  now: Date;
  routeFor: VMwareRouteFor;
  listRouteFor?: VMwareListRouteFor | undefined;
}): Array<ResourceAttentionItem> {
  const items: Array<ResourceAttentionItem> = [];
  const known: Array<VMwareResource> = [
    ...data.rows,
    ...(data.contextRows || []),
  ];
  const datacenters: Array<VMwareResource> = known.filter(
    (row: VMwareResource): boolean => {
      return row.kind === VMwareResourceKind.Datacenter;
    },
  );
  const hosts: Array<VMwareResource> = known.filter(
    (row: VMwareResource): boolean => {
      return row.kind === VMwareResourceKind.Host;
    },
  );

  for (const row of data.rows) {
    const kind: VMwareResourceKind = row.kind as VMwareResourceKind;
    const externalId: string = row.externalId || "";

    if (kind === VMwareResourceKind.Datacenter) {
      for (const finding of getVMwareDatacenterFindings({
        datacenter: row,
        hosts: hosts,
        now: data.now,
      })) {
        if (!finding.severity) {
          continue;
        }
        items.push({
          key: `${getVMwareAttentionKey(kind, externalId)}:${finding.group}`,
          kind: KIND_DATACENTER,
          icon: getVMwareKindIcon(kind),
          name: getVMwareDisplayName(row),
          severity: finding.severity,
          reasons: finding.reasons,
          route: data.listRouteFor
            ? data.listRouteFor(DATACENTER_GROUP_LIST_KINDS[finding.group])
            : undefined,
        });
      }
      continue;
    }

    let assessment: VMwareAssessment;
    switch (kind) {
      case VMwareResourceKind.Host:
        assessment = assessVMwareHost({
          host: row,
          datacenter: findVMwareDatacenter(datacenters, row.datacenterName),
          now: data.now,
        });
        break;
      case VMwareResourceKind.VirtualMachine:
        assessment = assessVMwareVirtualMachine({
          vm: row,
          now: data.now,
          hosts: hosts,
          datacenters: datacenters,
        });
        break;
      case VMwareResourceKind.Datastore:
        assessment = assessVMwareDatastore({ datastore: row, now: data.now });
        break;
      case VMwareResourceKind.Cluster:
        assessment = assessVMwareCluster({
          cluster: row,
          hosts: hosts,
          datacenters: datacenters,
          now: data.now,
        });
        break;
      case VMwareResourceKind.ResourcePool:
        assessment = assessVMwareResourcePool({ pool: row, now: data.now });
        break;
      default:
        continue;
    }

    if (!assessment.severity) {
      continue;
    }

    items.push({
      key: getVMwareAttentionKey(kind, externalId),
      kind: kindWordOf(kind),
      icon: getVMwareKindIcon(kind),
      name: getVMwareDisplayName(row),
      detail: detailOf(row),
      severity: assessment.severity,
      reasons: assessment.reasons,
      route:
        kind === VMwareResourceKind.ResourcePool
          ? data.listRouteFor
            ? data.listRouteFor(kind)
            : undefined
          : externalId
            ? data.routeFor(kind, externalId)
            : undefined,
    });
  }

  return sortResourceAttention(items, VMWARE_ATTENTION_KIND_ORDER);
}

export function getVMwareHealth(
  items: Array<ResourceAttentionItem>,
): ResourceHealth {
  return getResourceAttentionHealth(items);
}

// The worst of several findings' severities, none counting as nothing.
export function mergeVMwareSeverities(
  severities: Array<ResourceAttentionSeverity | null>,
): ResourceAttentionSeverity | null {
  return mergeResourceAttentionSeverity(
    severities.filter(
      (
        severity: ResourceAttentionSeverity | null,
      ): severity is ResourceAttentionSeverity => {
        return severity !== null;
      },
    ),
  );
}

// ---- Which part an open incident or alert is about ---------------------------

function readLabel(labels: JSONObject | null, key: string): string | null {
  if (!labels || typeof labels !== "object") {
    return null;
  }
  for (const candidate of [key, `resource.${key}`]) {
    const value: unknown = (labels as Record<string, unknown>)[candidate];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/*
 * Whether an open record is about this part, read from its series labels:
 * a VMware template groups by the object's identity attribute
 * (VMwareGroupByKey - resource.vcenter.host.name, .vm.name, .datastore.name,
 * .cluster.name), and a person's own monitor may group by more of them.
 *
 * A record about a part inside this one is about this one too: a host's
 * page lists what is open on it and on the VMs it runs, a cluster's what is
 * open on it, its hosts and the VMs in it. A template's labels name only
 * the part it groups by (a host alert, the host), so a page hands in the
 * parts it holds (`members`: a host's VMs, a cluster's hosts and VMs) and a
 * record naming one of them counts; a person's own monitor that groups by
 * the cluster or the host as well is matched on those labels directly.
 */
export function isVMwareIssueAbout(
  record: Pick<OpenIssueRecord, "seriesLabels">,
  row: VMwareResource,
  members?: Array<VMwareResource> | undefined,
): boolean {
  if (isVMwareIssueAboutRow(record.seriesLabels, row)) {
    return true;
  }
  return (members || []).some((member: VMwareResource): boolean => {
    return member !== row && isVMwareIssueAboutRow(record.seriesLabels, member);
  });
}

function isVMwareIssueAboutRow(
  labels: JSONObject | null,
  row: VMwareResource,
): boolean {
  const datacenter: string | null = readLabel(
    labels,
    "vcenter.datacenter.name",
  );
  if (
    datacenter &&
    row.datacenterName &&
    !sameName(datacenter, row.datacenterName)
  ) {
    return false;
  }

  const vmId: string | null =
    readLabel(labels, "vcenter.vm.id") ||
    readLabel(labels, "vcenter.vm_template.id");
  const vmName: string | null =
    readLabel(labels, "vcenter.vm.name") ||
    readLabel(labels, "vcenter.vm_template.name");
  const hostName: string | null = readLabel(labels, "vcenter.host.name");
  const datastoreName: string | null = readLabel(
    labels,
    "vcenter.datastore.name",
  );
  const clusterName: string | null = readLabel(labels, "vcenter.cluster.name");

  switch (row.kind) {
    case VMwareResourceKind.VirtualMachine:
      if (vmId && row.vmInstanceUuid) {
        return sameName(vmId, row.vmInstanceUuid);
      }
      return sameName(vmName, getVMwareDisplayName(row));
    case VMwareResourceKind.Host:
      return sameName(hostName, getVMwareHostName(row));
    case VMwareResourceKind.Datastore:
      return sameName(datastoreName, getVMwareDisplayName(row));
    case VMwareResourceKind.Cluster:
      return sameName(clusterName, getVMwareClusterName(row));
    default:
      return false;
  }
}
