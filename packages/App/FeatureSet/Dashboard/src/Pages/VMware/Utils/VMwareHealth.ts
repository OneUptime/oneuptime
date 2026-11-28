import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  StorageReadingValue,
  StorageUsage,
  StorageUsageThresholds,
  getStorageUsage,
} from "Common/Utils/Storage/StorageUsage";
import {
  DEFAULT_VMWARE_HEALTH_RULES,
  KIBIBYTE,
  MEBIBYTE,
  VMwareHealthRuleKey,
  VMwareHealthRules,
  getVMwareHealthEvaluationMinutes,
  isPastVMwareHealthThreshold,
} from "Common/Types/VMware/VMwareHealthRules";
import {
  VMwareHealthRuleBook,
  getVMwareHealthRulesForPart,
} from "Common/Types/VMware/VMwareHealthRuleOverrides";
import {
  VMwareHealthReading,
  VMwareHealthReadingField,
  VMwareHeldReading,
  hasVMwareReadingHeldFor,
  readVMwareHealthReadings,
} from "Common/Types/VMware/VMwareHealthReadings";
import { VMwareSwapRateSource } from "Common/Types/VMware/VMwareSwapRates";
import {
  ResourceAttentionFact,
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
 *     host is swapping out to disk now.
 *   Warning - needs a look soon:
 *     a host whose CPU or memory is more than 90% busy; a host with a
 *     warning (yellow) alarm; a host vCenter reports no usage for, when
 *     vCenter does not say whether it is down or powered off; a cluster
 *     with hosts that are not effective (in maintenance mode, disconnected
 *     or not responding) or without the memory to lose a host; a datastore
 *     more than 80% full; a VM the host takes memory back from (ballooning)
 *     or that waits for a free CPU (CPU ready over 10%); a VM reading
 *     swapped memory back faster than 1 MiB/s, or holding more than 1 GiB
 *     of it from earlier; a VM with a critical alarm; a resource pool whose
 *     memory the host is swapping out.
 *
 * SWAPPED MEMORY IS NOT SWAPPING (#11157). vcenter.vm.memory.swapped is how
 * much of a VM's memory sits in the host's swap file, and ESXi leaves a page
 * there until the guest touches it: a VM keeps a few MiB "swapped" for weeks
 * after the pressure that put them there has gone. Only the host swapping
 * memory out now is real memory pressure, and critical. The rates
 * (memorySwapOutBytesPerSecond, memorySwapInBytesPerSecond) are vSphere's
 * own where a probe collects the vCenter, and otherwise worked out at ingest
 * from how fast the amount grew or shrank since the previous report - the
 * VMware agent's receiver has no swap rate (#11468). The row says which
 * (memorySwapRateSource), and a VM's page says it too.
 *
 * Every threshold is one a project can change on VMware > Settings > Health
 * Rules (Common/Types/VMware/VMwareHealthRules), or turn off; each function
 * below takes the project's rules, these defaults where it is not handed
 * them. Each default is the level its alert template fires at
 * (Common/Types/Monitor/VMwareAlertTemplates), so a part on this list is one
 * its alert would page about.
 *
 * A page hands its rules as the project's rule book (#11469): the project's
 * rules and the overrides of its vCenters, clusters, hosts and VMs. Each
 * function resolves the rules of the part it judges
 * (getVMwareHealthRulesForPart): its VM's, host's, cluster's or vCenter's
 * where they have their own, rule by rule, the most specific winning. And a
 * group of rules can wait "for at least N minutes": the part is marked only
 * once every report for that long was past the threshold, by the readings
 * ingest keeps on its row (VMwareHealthReadings), and Needs attention says
 * when it began.
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

// The defaults of the thresholds below (VMwareHealthRules).
export const VMWARE_DATASTORE_WARNING_PERCENT: number =
  DEFAULT_VMWARE_HEALTH_RULES.datastoreWarningPercent;
export const VMWARE_DATASTORE_CRITICAL_PERCENT: number =
  DEFAULT_VMWARE_HEALTH_RULES.datastoreCriticalPercent;

/*
 * A rule's level as a line a bar or a tile can draw: a rule turned off
 * draws no line, never one at 0.
 */
export function getVMwareThresholdLine(threshold: number | null): number {
  return threshold === null ? Number.POSITIVE_INFINITY : threshold;
}

/*
 * Where a datastore's bar turns amber and red, and the vCenter's total
 * across its datastores: the levels its rules flag a datastore at, and that
 * mark the vCenter Degraded and Unhealthy. Past the line, as Needs attention
 * flags it.
 */
export function getVMwareDatastoreUsageThresholds(
  rules: VMwareHealthRules = DEFAULT_VMWARE_HEALTH_RULES,
): StorageUsageThresholds {
  // Resolved for the datastore, or the vCenter, the bar is of (#11469).
  return {
    warningPercent: getVMwareThresholdLine(rules.datastoreWarningPercent),
    criticalPercent: getVMwareThresholdLine(rules.datastoreCriticalPercent),
    isPastLineOnly: true,
  };
}

export const VMWARE_DATASTORE_USAGE_THRESHOLDS: StorageUsageThresholds =
  getVMwareDatastoreUsageThresholds();

/*
 * A VM's datastore space against what is provisioned for it has no line: a
 * thick-provisioned disk takes all of it from the start, so a full bar is
 * how such a VM always reads, never a problem by itself. Its bar stays calm;
 * the datastore filling up is what the rules watch (#9646).
 */
export const VMWARE_VM_STORAGE_USAGE_THRESHOLDS: StorageUsageThresholds = {
  warningPercent: Number.POSITIVE_INFINITY,
  criticalPercent: Number.POSITIVE_INFINITY,
};

/*
 * A VM's storage as its list's bar reads it: the datastore space its files
 * take (vcenter.vm.disk.usage, used) of all that is provisioned for it (used
 * plus what its disks may still grow into). Null when vSphere reported none.
 */
export function getVMwareVmStorageUsage(data: {
  usedBytes: StorageReadingValue;
  provisionedBytes: StorageReadingValue;
}): StorageUsage | null {
  return getStorageUsage(
    { capacity: data.provisionedBytes, used: data.usedBytes },
    VMWARE_VM_STORAGE_USAGE_THRESHOLDS,
  );
}

/*
 * A vCenter's storage: the used and capacity of every datastore it reports,
 * added up (VMwareVCenter's datastore totals), at the datastores' levels.
 */
export function getVMwareVCenterStorageUsage(data: {
  datastoreUsedBytes: StorageReadingValue;
  datastoreCapacityBytes: StorageReadingValue;
  // The vCenter's own rules (resolved for it, #11469).
  rules?: VMwareHealthRules | undefined;
}): StorageUsage | null {
  return getStorageUsage(
    { capacity: data.datastoreCapacityBytes, used: data.datastoreUsedBytes },
    getVMwareDatastoreUsageThresholds(data.rules),
  );
}
export const VMWARE_HOST_SATURATION_PERCENT: number =
  DEFAULT_VMWARE_HEALTH_RULES.hostCpuWarningPercent;
export const VMWARE_CPU_READY_WARNING_PERCENT: number =
  DEFAULT_VMWARE_HEALTH_RULES.vmCpuReadyWarningPercent;

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
  /*
   * When the earliest of the findings that waited for their period began to
   * hold (#11469); none for findings judged on the latest report.
   */
  since?: Date | undefined;
}

/*
 * The rules a judgement is handed: the project's rule book, which it
 * resolves for the part (VMwareHealthRuleOverrides), or rules already
 * resolved.
 */
export type VMwareHealthRulesInput = VMwareHealthRules | VMwareHealthRuleBook;

// The rules a part is judged by.
export function getVMwareRulesOf(
  rules: VMwareHealthRulesInput | null | undefined,
  part: VMwareResource,
): VMwareHealthRules {
  return getVMwareHealthRulesForPart(rules, part);
}

// Whether one rule marks a part, and since when when it waited.
interface VMwareRuleCheck {
  isPast: boolean;
  since: Date | null;
}

/*
 * One rule, its period and all (#11469): the latest reading past the
 * threshold, and - when the rule's group waits - every reading for that
 * long past it too. Both in the reading's own unit.
 */
function checkVMwareRule(data: {
  rules: VMwareHealthRules;
  key: VMwareHealthRuleKey;
  reading: number | null;
  threshold: number | null;
  readings: Array<VMwareHealthReading>;
  field: VMwareHealthReadingField;
}): VMwareRuleCheck {
  if (!isPastVMwareHealthThreshold(data.reading, data.threshold)) {
    return { isPast: false, since: null };
  }
  const minutes: number = getVMwareHealthEvaluationMinutes(
    data.rules,
    data.key,
  );
  if (minutes <= 0) {
    return { isPast: true, since: null };
  }
  const held: VMwareHeldReading = hasVMwareReadingHeldFor({
    readings: data.readings,
    field: data.field,
    threshold: data.threshold,
    minutes: minutes,
  });
  return { isPast: held.isHeld, since: held.isHeld ? held.since : null };
}

// The earliest of the times rules began to hold, if any did.
function earliestOf(dates: Array<Date | null>): Date | undefined {
  let earliest: Date | undefined = undefined;
  for (const date of dates) {
    if (date && (!earliest || date.getTime() < earliest.getTime())) {
      earliest = date;
    }
  }
  return earliest;
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
// When a rule that waits began to hold (#11469): "Began 12 minutes ago".
export const SINCE_RULE_BEGAN: string = translationKey("Began {{time}}");
const REASON_CPU_AT: string = translationKey("CPU at {{percent}}");
const REASON_MEMORY_AT: string = translationKey("Memory at {{percent}}");
const REASON_PERCENT_FULL: string = translationKey("{{percent}} full");
const REASON_SWAPPED: string = translationKey(
  "{{amount}} of memory swapped by the host",
);
const REASON_SWAPPING_OUT: string = translationKey(
  "Host swapping memory out at {{rate}}",
);
const REASON_SWAPPING_IN: string = translationKey(
  "Reading swapped memory back at {{rate}}",
);
const REASON_SWAPPED_EARLIER: string = translationKey(
  "{{amount}} swapped earlier, none swapping now",
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
    return `${Math.round(bytes)}\u00A0B`;
  }
  const units: Array<string> = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value: number = bytes / 1024;
  let index: number = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)}\u00A0${units[index]}`;
}

// "3.1 MiB/s": a rate of memory moved, as a reason says it.
export function formatVMwareReasonRate(bytesPerSecond: number): string {
  return `${formatVMwareReasonBytes(bytesPerSecond)}/s`;
}

/*
 * How a VM's or a resource pool's swapped memory moves now (#11157): out to
 * the host's swap file, back in, neither, or not known yet - worked out, the
 * rates need two reports to compare
 * (VMwareResourceService.bulkUpdateLatestMetrics) - and where the rates came
 * from (#11468): vSphere's own counters, or worked out between two reports.
 */
export interface VMwareSwapActivity {
  swappedBytes: number | null;
  swapOutBytesPerSecond: number | null;
  swapInBytesPerSecond: number | null;
  // Whether anything is known to move: false while both rates are 0.
  isKnownIdle: boolean;
  // Null while no rate is known, or for a row from before #11468.
  source: VMwareSwapRateSource | null;
}

export function getVMwareSwapRateSource(
  value: unknown,
): VMwareSwapRateSource | null {
  return value === VMwareSwapRateSource.VSphere ||
    value === VMwareSwapRateSource.Derived
    ? (value as VMwareSwapRateSource)
    : null;
}

export function getVMwareSwapActivity(
  row: Pick<
    VMwareResource,
    | "memorySwappedBytes"
    | "memorySwapOutBytesPerSecond"
    | "memorySwapInBytesPerSecond"
    | "memorySwapRateSource"
  >,
): VMwareSwapActivity {
  const swapOut: number | null = toVMwareNumber(
    row.memorySwapOutBytesPerSecond,
  );
  const swapIn: number | null = toVMwareNumber(row.memorySwapInBytesPerSecond);
  return {
    swappedBytes: toVMwareNumber(row.memorySwappedBytes),
    swapOutBytesPerSecond: swapOut,
    swapInBytesPerSecond: swapIn,
    isKnownIdle: swapOut === 0 && swapIn === 0,
    source:
      swapOut === null && swapIn === null
        ? null
        : getVMwareSwapRateSource(row.memorySwapRateSource),
  };
}

// A rule's KiB/s threshold in bytes per second; off stays off.
function kibPerSecond(threshold: number | null): number | null {
  return threshold === null ? null : threshold * KIBIBYTE;
}

// A rule's MiB threshold in bytes; off stays off.
function mebibytes(threshold: number | null): number | null {
  return threshold === null ? null : threshold * MEBIBYTE;
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
  rules?: VMwareHealthRulesInput | undefined;
}): VMwareAssessment {
  const rules: VMwareHealthRules = getVMwareRulesOf(data.rules, data.host);
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
  const sinces: Array<Date | null> = [];
  const cpu: number | null = toVMwareNumber(data.host.latestCpuPercent);
  const memory: number | null = toVMwareNumber(data.host.latestMemoryPercent);
  const readings: Array<VMwareHealthReading> = readVMwareHealthReadings(
    data.host.healthReadings,
  );

  const cpuCheck: VMwareRuleCheck = checkVMwareRule({
    rules,
    key: "hostCpuWarningPercent",
    reading: cpu,
    threshold: rules.hostCpuWarningPercent,
    readings,
    field: "cpu",
  });
  if (cpuCheck.isPast) {
    reasons.push({
      text: REASON_CPU_AT,
      values: { percent: formatVMwareReasonPercent(cpu!) },
    });
    sinces.push(cpuCheck.since);
  }
  const memoryCheck: VMwareRuleCheck = checkVMwareRule({
    rules,
    key: "hostMemoryWarningPercent",
    reading: memory,
    threshold: rules.hostMemoryWarningPercent,
    readings,
    field: "mem",
  });
  if (memoryCheck.isPast) {
    reasons.push({
      text: REASON_MEMORY_AT,
      values: { percent: formatVMwareReasonPercent(memory!) },
    });
    sinces.push(memoryCheck.since);
  }

  return {
    severity: reasons.length > 0 ? ResourceAttentionSeverity.Warning : null,
    reasons: reasons,
    since: earliestOf(sinces),
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

/*
 * What a VM's swapped memory says (#11157), one finding at most, the most
 * urgent first:
 *
 *   - the host swapping its memory out now, faster than the rule's rate:
 *     real memory pressure, critical - the host has run out of ways to give
 *     the guest memory, and the guest pays disk latency for RAM;
 *   - the guest reading swapped memory back, faster than its rate: slow
 *     while it lasts, a warning - touching a few old pages is not;
 *   - memory left in the swap file, more than its amount: a warning, said
 *     as left from earlier when nothing moves now. A few MiB ESXi kept
 *     after the pressure went is no finding at all.
 */
export function assessVMwareSwappedMemory(data: {
  activity: VMwareSwapActivity;
  // Resolved for the VM.
  rules: VMwareHealthRules;
  // The VM's last readings, for a rule that waits (#11469).
  readings?: Array<VMwareHealthReading> | undefined;
}): VMwareAssessment {
  const activity: VMwareSwapActivity = data.activity;
  const rules: VMwareHealthRules = data.rules;
  const readings: Array<VMwareHealthReading> = data.readings || [];

  const swapOut: VMwareRuleCheck = checkVMwareRule({
    rules,
    key: "vmSwapOutCriticalKibPerSecond",
    reading: activity.swapOutBytesPerSecond,
    threshold: kibPerSecond(rules.vmSwapOutCriticalKibPerSecond),
    readings,
    field: "so",
  });
  if (swapOut.isPast) {
    return {
      severity: ResourceAttentionSeverity.Critical,
      reasons: [
        {
          text: REASON_SWAPPING_OUT,
          values: {
            rate: formatVMwareReasonRate(activity.swapOutBytesPerSecond!),
          },
        },
      ],
      since: swapOut.since || undefined,
    };
  }
  const swapIn: VMwareRuleCheck = checkVMwareRule({
    rules,
    key: "vmSwapInWarningKibPerSecond",
    reading: activity.swapInBytesPerSecond,
    threshold: kibPerSecond(rules.vmSwapInWarningKibPerSecond),
    readings,
    field: "si",
  });
  if (swapIn.isPast) {
    return {
      severity: ResourceAttentionSeverity.Warning,
      reasons: [
        {
          text: REASON_SWAPPING_IN,
          values: {
            rate: formatVMwareReasonRate(activity.swapInBytesPerSecond!),
          },
        },
      ],
      since: swapIn.since || undefined,
    };
  }
  const swapped: VMwareRuleCheck = checkVMwareRule({
    rules,
    key: "vmSwappedWarningMebibytes",
    reading: activity.swappedBytes,
    threshold: mebibytes(rules.vmSwappedWarningMebibytes),
    readings,
    field: "sw",
  });
  if (swapped.isPast) {
    return {
      severity: ResourceAttentionSeverity.Warning,
      reasons: [
        {
          text: activity.isKnownIdle ? REASON_SWAPPED_EARLIER : REASON_SWAPPED,
          values: {
            amount: formatVMwareReasonBytes(activity.swappedBytes!),
          },
        },
      ],
      since: swapped.since || undefined,
    };
  }
  return { severity: null, reasons: [] };
}

export function assessVMwareVirtualMachine(data: {
  vm: VMwareResource;
  now: Date;
  // The hosts and datacenters the page has: a VM on a host vCenter lost is not judged.
  hosts?: Array<VMwareResource> | undefined;
  datacenters?: Array<VMwareResource> | undefined;
  rules?: VMwareHealthRulesInput | undefined;
}): VMwareAssessment {
  const vm: VMwareResource = data.vm;
  const rules: VMwareHealthRules = getVMwareRulesOf(data.rules, vm);
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
  const sinces: Array<Date | null> = [];
  const ballooned: number | null = toVMwareNumber(vm.memoryBalloonedBytes);
  const ready: number | null = toVMwareNumber(vm.cpuReadinessPercent);
  const readings: Array<VMwareHealthReading> = readVMwareHealthReadings(
    vm.healthReadings,
  );

  const swap: VMwareAssessment = assessVMwareSwappedMemory({
    activity: getVMwareSwapActivity(vm),
    rules,
    readings,
  });
  if (swap.severity) {
    reasons.push(...swap.reasons);
    severities.push(swap.severity);
    sinces.push(swap.since || null);
  }
  const balloonCheck: VMwareRuleCheck = checkVMwareRule({
    rules,
    key: "vmBalloonedWarningMebibytes",
    reading: ballooned,
    threshold: mebibytes(rules.vmBalloonedWarningMebibytes),
    readings,
    field: "bl",
  });
  if (balloonCheck.isPast) {
    reasons.push({
      text: REASON_BALLOONED,
      values: { amount: formatVMwareReasonBytes(ballooned!) },
    });
    severities.push(ResourceAttentionSeverity.Warning);
    sinces.push(balloonCheck.since);
  }
  const readyCheck: VMwareRuleCheck = checkVMwareRule({
    rules,
    key: "vmCpuReadyWarningPercent",
    reading: ready,
    threshold: rules.vmCpuReadyWarningPercent,
    readings,
    field: "rd",
  });
  if (readyCheck.isPast) {
    reasons.push({
      text: REASON_CPU_READY,
      values: { percent: formatVMwareReasonPercent(ready!) },
    });
    severities.push(ResourceAttentionSeverity.Warning);
    sinces.push(readyCheck.since);
  }

  return {
    severity: mergeResourceAttentionSeverity(severities),
    reasons: reasons,
    since: earliestOf(sinces),
  };
}

export function assessVMwareDatastore(data: {
  datastore: VMwareResource;
  now: Date;
  rules?: VMwareHealthRulesInput | undefined;
}): VMwareAssessment {
  const rules: VMwareHealthRules = getVMwareRulesOf(
    data.rules,
    data.datastore,
  );
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
  const readings: Array<VMwareHealthReading> = readVMwareHealthReadings(
    data.datastore.healthReadings,
  );
  const critical: VMwareRuleCheck = checkVMwareRule({
    rules,
    key: "datastoreCriticalPercent",
    reading: percent,
    threshold: rules.datastoreCriticalPercent,
    readings,
    field: "disk",
  });
  if (critical.isPast) {
    return {
      severity: ResourceAttentionSeverity.Critical,
      reasons: [reason],
      since: critical.since || undefined,
    };
  }
  const warning: VMwareRuleCheck = checkVMwareRule({
    rules,
    key: "datastoreWarningPercent",
    reading: percent,
    threshold: rules.datastoreWarningPercent,
    readings,
    field: "disk",
  });
  if (warning.isPast) {
    return {
      severity: ResourceAttentionSeverity.Warning,
      reasons: [reason],
      since: warning.since || undefined,
    };
  }
  return { severity: null, reasons: [] };
}

/*
 * A resource pool's swapped memory is what its VMs hold in the host's swap
 * file, each of which says it on its own row. The pool says only that the
 * host is swapping its memory out now; memory left from earlier is no
 * finding of the pool's (#11157).
 */
export function assessVMwareResourcePool(data: {
  pool: VMwareResource;
  now: Date;
  rules?: VMwareHealthRulesInput | undefined;
}): VMwareAssessment {
  const rules: VMwareHealthRules = getVMwareRulesOf(data.rules, data.pool);
  if (!hasFreshVMwareReadings(data.pool, data.now)) {
    return { severity: null, reasons: [] };
  }
  const swapOut: number | null = toVMwareNumber(
    data.pool.memorySwapOutBytesPerSecond,
  );
  const check: VMwareRuleCheck = checkVMwareRule({
    rules,
    key: "resourcePoolSwapOutWarningKibPerSecond",
    reading: swapOut,
    threshold: kibPerSecond(rules.resourcePoolSwapOutWarningKibPerSecond),
    readings: readVMwareHealthReadings(data.pool.healthReadings),
    field: "so",
  });
  if (check.isPast) {
    return {
      severity: ResourceAttentionSeverity.Warning,
      reasons: [
        {
          text: REASON_SWAPPING_OUT,
          values: { rate: formatVMwareReasonRate(swapOut!) },
        },
      ],
      since: check.since || undefined,
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
 * Why a cluster's Host failure has no answer (getVMwareClusterHeadroom is
 * null), so its tile says why under its dash instead of a bare "—".
 */
export enum VMwareClusterHeadroomGap {
  // Its newest reading is older than VMWARE_READINGS_STALE_MS: its hero says so.
  NotReporting = "not-reporting",
  // A host is not effective - in maintenance mode, not responding or off.
  HostNotEffective = "host-not-effective",
  // Fewer than two hosts run: none is left to restart the VMs on.
  TooFewRunningHosts = "too-few-running-hosts",
  // vCenter does not report the memory size of a running host.
  MemorySizeUnknown = "memory-size-unknown",
}

/*
 * The words under a Host failure tile with no answer, English, looked up in
 * the reader's language. Not reporting has none: the cluster's hero says it.
 */
export const VMWARE_CLUSTER_HEADROOM_GAP_WORDS: Readonly<
  Record<VMwareClusterHeadroomGap, string | null>
> = {
  [VMwareClusterHeadroomGap.NotReporting]: null,
  [VMwareClusterHeadroomGap.HostNotEffective]: translationKey(
    "Not known while a host is not effective",
  ),
  [VMwareClusterHeadroomGap.TooFewRunningHosts]: translationKey(
    "Needs at least two running hosts",
  ),
  [VMwareClusterHeadroomGap.MemorySizeUnknown]: translationKey(
    "A host's memory size is not reported",
  ),
};

/*
 * What a cluster's headroom is worked out from, or why there is nothing to
 * work it out from: hosts that are not effective (a host in maintenance
 * mode still reports its memory but runs no VMs, so the sum would count
 * room that is not there - the not-effective hosts are a finding of their
 * own), fewer than two running hosts, or a running host whose memory size
 * vCenter does not report.
 */
function readVMwareClusterHeadroom(data: {
  cluster: VMwareResource;
  hosts: Array<VMwareResource>;
  datacenters: Array<VMwareResource>;
  now: Date;
}): { headroom: VMwareClusterHeadroom } | { gap: VMwareClusterHeadroomGap } {
  const total: number | null = toVMwareNumber(data.cluster.hostCount);
  const effective: number | null = toVMwareNumber(
    data.cluster.effectiveHostCount,
  );
  if (total !== null && effective !== null && effective < total) {
    return { gap: VMwareClusterHeadroomGap.HostNotEffective };
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
    return { gap: VMwareClusterHeadroomGap.TooFewRunningHosts };
  }

  let used: number = 0;
  let capacity: number = 0;
  let largest: number = 0;
  for (const host of running) {
    const memory: number | null = toVMwareNumber(host.latestMemoryBytes);
    const size: number | null = toVMwareNumber(host.maxMemoryBytes);
    if (memory === null || size === null || size <= 0) {
      return { gap: VMwareClusterHeadroomGap.MemorySizeUnknown };
    }
    used += memory;
    capacity += size;
    largest = Math.max(largest, size);
  }

  const remaining: number = capacity - largest;
  return {
    headroom: {
      runningHostCount: running.length,
      usedMemoryBytes: used,
      capacityMemoryBytes: capacity,
      largestHostMemoryBytes: largest,
      remainingMemoryBytes: remaining,
      canLoseAHost: used <= remaining,
    },
  };
}

/*
 * Whether the cluster could lose its largest running host (see
 * VMwareClusterHeadroom). Null when there is nothing to work it out from
 * (readVMwareClusterHeadroom; getVMwareClusterHeadroomGap says why).
 */
export function getVMwareClusterHeadroom(data: {
  cluster: VMwareResource;
  hosts: Array<VMwareResource>;
  datacenters: Array<VMwareResource>;
  now: Date;
}): VMwareClusterHeadroom | null {
  const reading:
    | { headroom: VMwareClusterHeadroom }
    | { gap: VMwareClusterHeadroomGap } = readVMwareClusterHeadroom(data);
  return "headroom" in reading ? reading.headroom : null;
}

/*
 * Why getVMwareClusterHeadroom has no answer for the cluster, or null when
 * it has one. A cluster that has not reported for a while is not judged.
 */
export function getVMwareClusterHeadroomGap(data: {
  cluster: VMwareResource;
  hosts: Array<VMwareResource>;
  datacenters: Array<VMwareResource>;
  now: Date;
}): VMwareClusterHeadroomGap | null {
  if (!hasFreshVMwareReadings(data.cluster, data.now)) {
    return VMwareClusterHeadroomGap.NotReporting;
  }
  const reading:
    | { headroom: VMwareClusterHeadroom }
    | { gap: VMwareClusterHeadroomGap } = readVMwareClusterHeadroom(data);
  return "gap" in reading ? reading.gap : null;
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
  rules?: VMwareHealthRulesInput | undefined;
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
  rules?: VMwareHealthRulesInput | undefined;
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
  rules?: VMwareHealthRulesInput | undefined;
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
  /*
   * The project's health rules (VMware > Settings > Health Rules) and their
   * overrides: each part is judged by its own.
   */
  rules?: VMwareHealthRulesInput | undefined;
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
          rules: data.rules,
        });
        break;
      case VMwareResourceKind.VirtualMachine:
        assessment = assessVMwareVirtualMachine({
          vm: row,
          now: data.now,
          hosts: hosts,
          datacenters: datacenters,
          rules: data.rules,
        });
        break;
      case VMwareResourceKind.Datastore:
        assessment = assessVMwareDatastore({
          datastore: row,
          now: data.now,
          rules: data.rules,
        });
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
        assessment = assessVMwareResourcePool({
          pool: row,
          now: data.now,
          rules: data.rules,
        });
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
      // A rule that waited says when it began to hold (#11469).
      ...(assessment.since
        ? { since: { at: assessment.since, template: SINCE_RULE_BEGAN } }
        : {}),
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

/*
 * ---------------------------------------------------------------------------
 * What the Overview's counts open
 * ---------------------------------------------------------------------------
 *
 * "2/3 ESXi hosts connected" says one host is out of reach, never which or
 * why (#9594). Beside it, a count of the hosts in each state that needs
 * attention - not responding (vCenter cannot reach it), or reporting no
 * usage (vCenter's counts cannot tell whether it is not responding, off or
 * in standby) - opens exactly those hosts: why, by the same rules as Needs
 * attention, their cluster and datacenter, each a step from its page. A
 * host off or in standby is someone's choice, or DPM's: no count.
 */
export type VMwareHostProblemState =
  | VMwareHostState.NotResponding
  | VMwareHostState.NoUsage;

// The states the hero counts, the most urgent first.
export const VMWARE_HOST_PROBLEM_STATES: Array<VMwareHostProblemState> = [
  VMwareHostState.NotResponding,
  VMwareHostState.NoUsage,
];

const FACT_CLUSTER: string = translationKey("Cluster");
const FACT_DATACENTER: string = translationKey("Datacenter");

export function getVMwareHostProblemItems(data: {
  // The inventory as the Overview read it: its hosts, clusters, datacenters.
  rows: Array<VMwareResource>;
  state: VMwareHostProblemState;
  now: Date;
  routeFor: VMwareRouteFor;
  rules?: VMwareHealthRulesInput | undefined;
}): Array<ResourceAttentionItem> {
  const ofKind: (kind: VMwareResourceKind) => Array<VMwareResource> = (
    kind: VMwareResourceKind,
  ): Array<VMwareResource> => {
    return data.rows.filter((row: VMwareResource): boolean => {
      return row.kind === kind;
    });
  };
  const datacenters: Array<VMwareResource> = ofKind(
    VMwareResourceKind.Datacenter,
  );
  const clustersByName: Map<string, VMwareResource> = new Map();
  for (const cluster of ofKind(VMwareResourceKind.Cluster)) {
    if (cluster.name) {
      clustersByName.set(cluster.name, cluster);
    }
  }

  const items: Array<ResourceAttentionItem> = [];
  for (const host of ofKind(VMwareResourceKind.Host)) {
    const datacenter: VMwareResource | null = findVMwareDatacenter(
      datacenters,
      host.datacenterName,
    );
    const state: VMwareHostState = getVMwareHostState({
      host: host,
      datacenter: datacenter,
      now: data.now,
    });
    if (state !== data.state) {
      continue;
    }
    const assessment: VMwareAssessment = assessVMwareHost({
      host: host,
      datacenter: datacenter,
      now: data.now,
      rules: data.rules,
    });
    const externalId: string = host.externalId || "";
    const cluster: VMwareResource | undefined = host.clusterName
      ? clustersByName.get(host.clusterName)
      : undefined;

    // Which one it is: where it sits, its cluster a step from its page.
    const facts: Array<ResourceAttentionFact> = [];
    if (host.clusterName) {
      facts.push({
        key: "cluster",
        label: FACT_CLUSTER,
        value: host.clusterName,
        route: cluster?.externalId
          ? data.routeFor(VMwareResourceKind.Cluster, cluster.externalId)
          : undefined,
      });
    }
    if (host.datacenterName) {
      facts.push({
        key: "datacenter",
        label: FACT_DATACENTER,
        value: host.datacenterName,
      });
    }

    items.push({
      key: getVMwareAttentionKey(VMwareResourceKind.Host, externalId),
      kind: KIND_HOST,
      icon: getVMwareKindIcon(VMwareResourceKind.Host),
      name: getVMwareDisplayName(host),
      severity: assessment.severity || ResourceAttentionSeverity.Warning,
      reasons: assessment.reasons,
      route: externalId
        ? data.routeFor(VMwareResourceKind.Host, externalId)
        : undefined,
      facts: facts,
    });
  }

  return sortResourceAttention(items, VMWARE_ATTENTION_KIND_ORDER);
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
