import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import {
  XCP_NG_HA_HOST_FAILED_TEMPLATE_ID,
  XCP_NG_PBD_PLUG_FAILED_TEMPLATE_ID,
  XCP_NG_SR_GC_NO_SPACE_TEMPLATE_ID,
  XCP_NG_VM_CRASHED_TEMPLATE_ID,
} from "Common/Types/Monitor/XcpNgEventAlertTemplates";
import XcpNgResourceKind from "Common/Types/XcpNg/XcpNgResourceKind";
import {
  XcpNgHostPowerState,
  XcpNgVmPowerState,
} from "Common/Types/XcpNg/XcpNgTelemetry";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  StorageUsage,
  StorageUsageLevel,
} from "Common/Utils/Storage/StorageUsage";
import {
  ResourcePartBadge,
  ResourcePartStatus,
  ResourcePartTone,
} from "../../../Components/ResourcePart/ResourcePartTypes";
import {
  getXcpNgStorageUsage,
  isXcpNgControlDomain,
  isXcpNgHostOffline,
  isXcpNgStorageOverAllocated,
  isXcpNgVmDiskRepository,
  isXcpNgVmStoppedAfterRunning,
} from "./XcpNgHealth";
import {
  getXcpNgDisplayName,
  isXcpNgReadingFresh,
  toXcpNgNumber,
} from "./XcpNgResourceUtils";

/*
 * WHAT AN XCP-NG HOST, VM OR STORAGE REPOSITORY IS, IN THE WORDS ITS PAGES USE.
 *
 * The state a part's page and the lists show, its badges (a disabled host, a
 * control domain, a shared repository), its tags, a storage repository's
 * type and what it holds, a VM's memory as far as Xen Orchestra can see it,
 * the pool's hosts, VMs and storage counted, what a host holds, and the
 * busiest VMs and hosts. XcpNgHealth says what needs attention; this says
 * what a part is.
 *
 * A state someone chose is grey, never red (Docs/ux/README.md#side-menus): a
 * host disabled for maintenance, a VM suspended. A VM halted on purpose is
 * grey too; one that stopped after running in the last day is amber, as
 * Needs attention lists it.
 *
 * Words are English, marked with translationKey() and looked up in the
 * reader's language where they are drawn. React-free, so App tests can read
 * it.
 */

const STATUS_RUNNING: string = translationKey("Running");
const STATUS_HALTED: string = translationKey("Halted");
const STATUS_PAUSED: string = translationKey("Paused");
const STATUS_SUSPENDED: string = translationKey("Suspended");
const STATUS_UNKNOWN: string = translationKey("Unknown");
const STATUS_STORAGE_USED: string = translationKey("{{percent}} used");
const STATUS_OVER_PROVISIONED: string = translationKey("Over-provisioned");

const BADGE_DISABLED: string = translationKey("Disabled");
const BADGE_CONTROL_DOMAIN: string = translationKey("Control domain");
const BADGE_SHARED: string = translationKey("Shared");
const BADGE_LOCAL: string = translationKey("Local");

/*
 * The recommended alerts that watch each kind of part, in the order a
 * part's Alerts card lists them. Each is one monitor on the pool that fires
 * for any part that crosses it (ResourcePartAlertsCard), grouped by the
 * part's UUID (xcp_ng.id).
 */
export const XCP_NG_HOST_ALERT_TEMPLATE_IDS: Array<string> = [
  "xcp-ng-host-offline",
  "xcp-ng-host-disabled",
  "xcp-ng-host-restarted",
  "xcp-ng-host-high-cpu",
  "xcp-ng-host-high-memory",
  // What XAPI says of a host, read by a probe (#10997).
  XCP_NG_HA_HOST_FAILED_TEMPLATE_ID,
];

export const XCP_NG_VM_ALERT_TEMPLATE_IDS: Array<string> = [
  "xcp-ng-vm-stopped",
  "xcp-ng-vm-cpu-starved",
  // A crash XAPI wrote, and a backup Xen Orchestra did not make (#10997).
  XCP_NG_VM_CRASHED_TEMPLATE_ID,
  "xcp-ng-vm-not-backed-up",
];

export const XCP_NG_STORAGE_ALERT_TEMPLATE_IDS: Array<string> = [
  "xcp-ng-sr-near-full",
  "xcp-ng-sr-slow",
  // What XAPI says of a storage repository (#10997).
  XCP_NG_PBD_PLUG_FAILED_TEMPLATE_ID,
  XCP_NG_SR_GC_NO_SPACE_TEMPLATE_ID,
];

/*
 * The state a host shows, as Xen Orchestra reports it - Running, Halted or
 * Unknown - or null before it reported one. Halted and Unknown are red: the
 * host's VMs are down with it, or the pool lost touch with it. A disabled
 * host keeps its state and wears a grey Disabled badge of its own
 * (getXcpNgPartBadges): disabling one is someone's choice.
 */
export function getXcpNgHostStatus(
  row: Pick<XcpNgResource, "kind" | "powerState" | "isUp">,
): ResourcePartStatus | null {
  if (row.powerState === XcpNgHostPowerState.Running) {
    return { label: STATUS_RUNNING, tone: "positive" };
  }
  if (row.powerState === XcpNgHostPowerState.Halted) {
    return { label: STATUS_HALTED, tone: "danger" };
  }
  if (row.powerState === XcpNgHostPowerState.Unknown) {
    return { label: STATUS_UNKNOWN, tone: "danger" };
  }
  if (row.isUp === true) {
    return { label: STATUS_RUNNING, tone: "positive" };
  }
  if (row.isUp === false && isXcpNgHostOffline(row)) {
    return { label: STATUS_HALTED, tone: "danger" };
  }
  return null;
}

/*
 * The state a VM shows: Running, Halted, Paused or Suspended, as Xen
 * Orchestra reports it. Suspended is someone's choice, and so is a VM
 * halted or paused and left off: grey. Halted or Paused after running in
 * the last day is amber, as Needs attention says of it. A control domain
 * has no status series of its own: it is Running while it reports metrics.
 */
export function getXcpNgVmStatus(
  row: Pick<
    XcpNgResource,
    "kind" | "powerState" | "isUp" | "isControlDomain" | "lastRunningAt"
  >,
  now: Date,
): ResourcePartStatus | null {
  const stoppedTone: ResourcePartTone = isXcpNgVmStoppedAfterRunning(row, now)
    ? "warning"
    : "neutral";
  switch (row.powerState) {
    case XcpNgVmPowerState.Running:
      return { label: STATUS_RUNNING, tone: "positive" };
    case XcpNgVmPowerState.Halted:
      return { label: STATUS_HALTED, tone: stoppedTone };
    case XcpNgVmPowerState.Paused:
      return { label: STATUS_PAUSED, tone: stoppedTone };
    case XcpNgVmPowerState.Suspended:
      return { label: STATUS_SUSPENDED, tone: "neutral" };
    default:
      break;
  }
  if (row.isUp === true) {
    return { label: STATUS_RUNNING, tone: "positive" };
  }
  return null;
}

/*
 * A storage repository has no power state: its state is how full it is,
 * at the pool's lines - green below them, amber nearly full, red full - and
 * amber while it is allocated past its size. Null for one with no size to
 * fill (an ISO library).
 */
export function getXcpNgStorageStatus(
  row: Pick<
    XcpNgResource,
    | "kind"
    | "latestDiskBytes"
    | "maxDiskBytes"
    | "virtualAllocationBytes"
    | "contentType"
  >,
): ResourcePartStatus | null {
  const usage: StorageUsage | null = getXcpNgStorageUsage(row);
  if (!usage) {
    return null;
  }
  const percent: string = `${Math.floor(usage.usedPercent)}%`;
  if (usage.level === StorageUsageLevel.Critical) {
    return {
      label: STATUS_STORAGE_USED,
      values: { percent: percent },
      tone: "danger",
    };
  }
  if (usage.level === StorageUsageLevel.Warning) {
    return {
      label: STATUS_STORAGE_USED,
      values: { percent: percent },
      tone: "warning",
    };
  }
  if (isXcpNgStorageOverAllocated(row)) {
    return { label: STATUS_OVER_PROVISIONED, tone: "warning" };
  }
  return {
    label: STATUS_STORAGE_USED,
    values: { percent: percent },
    tone: "positive",
  };
}

export function getXcpNgPartStatus(
  row: XcpNgResource,
  now: Date,
): ResourcePartStatus | null {
  if (row.kind === XcpNgResourceKind.Host) {
    return getXcpNgHostStatus(row);
  }
  if (row.kind === XcpNgResourceKind.VM) {
    return getXcpNgVmStatus(row, now);
  }
  if (row.kind === XcpNgResourceKind.StorageRepository) {
    return getXcpNgStorageStatus(row);
  }
  return null;
}

/*
 * The grey badges beside a part's state: a host someone disabled, a VM that
 * is a host's control domain, a storage repository shared by the pool or
 * local to one host. Facts, never alarms.
 */
export function getXcpNgPartBadges(
  row: Pick<
    XcpNgResource,
    "kind" | "isEnabled" | "isControlDomain" | "isShared"
  >,
): Array<ResourcePartBadge> {
  const badges: Array<ResourcePartBadge> = [];
  if (row.kind === XcpNgResourceKind.Host && row.isEnabled === false) {
    badges.push({ key: "disabled", label: BADGE_DISABLED, tone: "neutral" });
  }
  if (isXcpNgControlDomain(row)) {
    badges.push({
      key: "control-domain",
      label: BADGE_CONTROL_DOMAIN,
      tone: "neutral",
    });
  }
  if (
    row.kind === XcpNgResourceKind.StorageRepository &&
    row.isShared !== null &&
    row.isShared !== undefined
  ) {
    badges.push({
      key: "shared",
      label: row.isShared ? BADGE_SHARED : BADGE_LOCAL,
      tone: "neutral",
    });
  }
  return badges;
}

/*
 * The tags Xen Orchestra sends with an object: comma-separated and sorted
 * (its tags label). Each once, in order, at most XCP_NG_MAX_TAGS.
 */
export const XCP_NG_MAX_TAGS: number = 20;

export function parseXcpNgTags(tags: string | null | undefined): Array<string> {
  if (!tags) {
    return [];
  }
  const seen: Set<string> = new Set();
  const result: Array<string> = [];
  for (const piece of tags.split(",")) {
    const tag: string = piece.trim();
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    result.push(tag);
    if (result.length >= XCP_NG_MAX_TAGS) {
      break;
    }
  }
  return result;
}

/*
 * A storage repository's type as Xen Orchestra and XCP-ng's documentation
 * name it (XAPI's sr_type "lvmoiscsi" is iSCSI, "linstor" is XOSTOR).
 * Names of storage technologies, the same in every language; a type this
 * list does not know reads as XAPI reports it.
 */
const STORAGE_TYPE_LABELS: Record<string, string> = {
  cephfs: "CephFS",
  ext: "EXT (local)",
  file: "File",
  glusterfs: "GlusterFS",
  hba: "HBA",
  iscsi: "iSCSI",
  iso: "ISO",
  largeblock: "Large block",
  linstor: "XOSTOR",
  lvm: "LVM (local)",
  lvmofcoe: "FCoE (LVM)",
  lvmohba: "HBA (LVM)",
  lvmoiscsi: "iSCSI (LVM)",
  moosefs: "MooseFS",
  nfs: "NFS",
  smb: "SMB",
  udev: "udev",
  xfs: "XFS",
  zfs: "ZFS",
};

export function getXcpNgStorageTypeLabel(
  srType: string | null | undefined,
): string {
  const type: string = (srType || "").trim();
  return STORAGE_TYPE_LABELS[type.toLowerCase()] || type;
}

/*
 * What a storage repository holds, as XAPI's content_type says it: VM disks
 * ("user"), an ISO library or removable media. Another value reads as
 * reported.
 */
const CONTENT_TYPE_WORDS: Record<string, string> = {
  user: translationKey("VM disks"),
  iso: translationKey("ISO library"),
  disk: translationKey("Removable media"),
};

export function getXcpNgContentTypeWord(
  contentType: string | null | undefined,
): string {
  const type: string = (contentType || "").trim();
  return CONTENT_TYPE_WORDS[type.toLowerCase()] || type;
}

/*
 * ---------------------------------------------------------------------------
 * A VM's memory, as far as Xen Orchestra can see it
 * ---------------------------------------------------------------------------
 *
 * Xen Orchestra reports the memory a VM was given (xcp_vm_memory_bytes) and,
 * only while the VM's guest tools run, what its guest has free
 * (xcp_vm_memory_internal_free_bytes). Memory in use is the one less the
 * other; without the guest tools nothing says it, and a page says so - the
 * memory the VM was given, with why - never a 100% that reads as full.
 */
export interface XcpNgVmMemory {
  // What its guest uses, or null without the guest tools.
  inUseBytes: number | null;
  // What it was given, or null before Xen Orchestra reported it.
  givenBytes: number | null;
  percent: number | null;
}

export function getXcpNgVmMemory(
  row: Pick<
    XcpNgResource,
    "latestMemoryBytes" | "maxMemoryBytes" | "latestMemoryPercent"
  >,
): XcpNgVmMemory {
  const given: number | null = toXcpNgNumber(row.maxMemoryBytes);
  const inUse: number | null = toXcpNgNumber(row.latestMemoryBytes);
  return {
    inUseBytes: inUse,
    givenBytes: given !== null && given > 0 ? given : null,
    percent: getXcpNgMemoryPercent(row),
  };
}

// The share of a host's or VM's memory in use, from its row, or null.
export function getXcpNgMemoryPercent(
  row: Pick<
    XcpNgResource,
    "latestMemoryBytes" | "maxMemoryBytes" | "latestMemoryPercent"
  >,
): number | null {
  const percent: number | null = toXcpNgNumber(row.latestMemoryPercent);
  if (percent !== null) {
    return percent;
  }
  const used: number | null = toXcpNgNumber(row.latestMemoryBytes);
  const total: number | null = toXcpNgNumber(row.maxMemoryBytes);
  if (used === null || total === null || total <= 0) {
    return null;
  }
  return (used / total) * 100;
}

/*
 * ---------------------------------------------------------------------------
 * The pool's parts counted
 * ---------------------------------------------------------------------------
 */
export interface XcpNgHostSummary {
  total: number;
  running: number;
  offline: number;
  disabled: number;
}

export function summarizeXcpNgHosts(
  rows: Array<XcpNgResource>,
): XcpNgHostSummary {
  const summary: XcpNgHostSummary = {
    total: 0,
    running: 0,
    offline: 0,
    disabled: 0,
  };
  for (const row of rows) {
    if (row.kind !== XcpNgResourceKind.Host) {
      continue;
    }
    summary.total++;
    if (row.isUp === true) {
      summary.running++;
    }
    if (isXcpNgHostOffline(row)) {
      summary.offline++;
    }
    if (row.isEnabled === false) {
      summary.disabled++;
    }
  }
  return summary;
}

export interface XcpNgVmSummary {
  // VMs, control domains left out: what "VMs" counts everywhere.
  total: number;
  running: number;
  halted: number;
  paused: number;
  suspended: number;
  // A host's own control domains, counted apart.
  controlDomains: number;
}

export function summarizeXcpNgVms(rows: Array<XcpNgResource>): XcpNgVmSummary {
  const summary: XcpNgVmSummary = {
    total: 0,
    running: 0,
    halted: 0,
    paused: 0,
    suspended: 0,
    controlDomains: 0,
  };
  for (const row of rows) {
    if (row.kind !== XcpNgResourceKind.VM) {
      continue;
    }
    if (isXcpNgControlDomain(row)) {
      summary.controlDomains++;
      continue;
    }
    summary.total++;
    if (row.isUp === true) {
      summary.running++;
    }
    if (row.powerState === XcpNgVmPowerState.Halted) {
      summary.halted++;
    } else if (row.powerState === XcpNgVmPowerState.Paused) {
      summary.paused++;
    } else if (row.powerState === XcpNgVmPowerState.Suspended) {
      summary.suspended++;
    }
  }
  return summary;
}

/*
 * The pool's storage for VM disks: the size of the repositories that hold
 * them and what is used on them, ISO libraries and removable media left
 * out - the figures the pool's row keeps (storageCapacityBytes,
 * storageUsedBytes), worked out from the same rows.
 */
export interface XcpNgStorageSummary {
  repositories: number;
  vmDiskRepositories: number;
  capacityBytes: number;
  usedBytes: number;
}

export function summarizeXcpNgStorage(
  rows: Array<XcpNgResource>,
): XcpNgStorageSummary {
  const summary: XcpNgStorageSummary = {
    repositories: 0,
    vmDiskRepositories: 0,
    capacityBytes: 0,
    usedBytes: 0,
  };
  for (const row of rows) {
    if (row.kind !== XcpNgResourceKind.StorageRepository) {
      continue;
    }
    summary.repositories++;
    if (!isXcpNgVmDiskRepository(row)) {
      continue;
    }
    summary.vmDiskRepositories++;
    summary.capacityBytes += toXcpNgNumber(row.maxDiskBytes) || 0;
    summary.usedBytes += toXcpNgNumber(row.latestDiskBytes) || 0;
  }
  return summary;
}

/*
 * What one host holds: the VMs it runs (by name, its control domain apart)
 * and its local storage repositories.
 */
export interface XcpNgRowsOnHost {
  vms: Array<XcpNgResource>;
  controlDomain: XcpNgResource | null;
  storageRepositories: Array<XcpNgResource>;
}

export function getXcpNgRowsOnHost(
  rows: Array<XcpNgResource>,
  hostExternalId: string,
): XcpNgRowsOnHost {
  const result: XcpNgRowsOnHost = {
    vms: [],
    controlDomain: null,
    storageRepositories: [],
  };
  if (!hostExternalId) {
    return result;
  }
  for (const row of rows) {
    if (row.parentHostExternalId !== hostExternalId) {
      continue;
    }
    if (row.kind === XcpNgResourceKind.VM) {
      if (isXcpNgControlDomain(row)) {
        result.controlDomain = row;
      } else {
        result.vms.push(row);
      }
    } else if (row.kind === XcpNgResourceKind.StorageRepository) {
      result.storageRepositories.push(row);
    }
  }
  result.vms = sortXcpNgByName(result.vms);
  result.storageRepositories = sortXcpNgByName(result.storageRepositories);
  return result;
}

/*
 * By name, as people read numbers in names (web-2 before web-10); the UUID
 * settles a tie, so two VMs named alike keep one order across reloads.
 */
export function sortXcpNgByName(
  rows: Array<XcpNgResource>,
): Array<XcpNgResource> {
  return [...rows].sort((a: XcpNgResource, b: XcpNgResource): number => {
    const byName: number = getXcpNgDisplayName(a).localeCompare(
      getXcpNgDisplayName(b),
      undefined,
      { numeric: true, sensitivity: "base" },
    );
    if (byName !== 0) {
      return byName;
    }
    return (a.externalId || "").localeCompare(b.externalId || "");
  });
}

/*
 * The pool's hosts at a glance: the ones that are down first (Halted, or a
 * state the pool cannot tell), then the disabled ones, then the rest, each
 * group by name.
 */
export function sortXcpNgHostsForGlance(
  rows: Array<XcpNgResource>,
): Array<XcpNgResource> {
  const rank: (row: XcpNgResource) => number = (row: XcpNgResource): number => {
    if (isXcpNgHostOffline(row)) {
      return 0;
    }
    if (row.isEnabled === false) {
      return 1;
    }
    return 2;
  };
  return sortXcpNgByName(rows).sort(
    (a: XcpNgResource, b: XcpNgResource): number => {
      return rank(a) - rank(b);
    },
  );
}

/*
 * The pool's storage repositories at a glance: those that hold VM disks
 * before ISO libraries and removable media, the fullest first, then by
 * name - so the one about to fill is the first a reader sees.
 */
export function sortXcpNgStorageForGlance(
  rows: Array<XcpNgResource>,
): Array<XcpNgResource> {
  const usedPercent: (row: XcpNgResource) => number = (
    row: XcpNgResource,
  ): number => {
    const usage: StorageUsage | null = getXcpNgStorageUsage(row);
    return usage ? usage.usedPercent : -1;
  };
  return sortXcpNgByName(rows).sort(
    (a: XcpNgResource, b: XcpNgResource): number => {
      const holdsDisks: number =
        Number(isXcpNgVmDiskRepository(b)) - Number(isXcpNgVmDiskRepository(a));
      if (holdsDisks !== 0) {
        return holdsDisks;
      }
      return usedPercent(b) - usedPercent(a);
    },
  );
}

/*
 * ---------------------------------------------------------------------------
 * The busiest VMs and hosts
 * ---------------------------------------------------------------------------
 *
 * A running part's latest CPU and memory, ranked - never a reading older
 * than `staleMs` (a list must not rank a VM by a reading from an hour ago)
 * and never a control domain, which is its host's own.
 */
export interface XcpNgBusyPart {
  row: XcpNgResource;
  cpuPercent: number | null;
  memoryPercent: number | null;
  memoryBytes: number | null;
}

export type XcpNgBusyRanking = "cpu" | "memory";

export function getXcpNgBusiestParts(data: {
  rows: Array<XcpNgResource>;
  kind: XcpNgResourceKind.Host | XcpNgResourceKind.VM;
  now: Date;
  staleMs: number;
  limit: number;
  rankBy?: XcpNgBusyRanking | undefined;
}): Array<XcpNgBusyPart> {
  const rankBy: XcpNgBusyRanking = data.rankBy || "cpu";
  const busy: Array<XcpNgBusyPart> = [];
  for (const row of data.rows) {
    if (
      row.kind !== data.kind ||
      isXcpNgControlDomain(row) ||
      row.isUp !== true ||
      !isXcpNgReadingFresh(row, data.now, data.staleMs)
    ) {
      continue;
    }
    const part: XcpNgBusyPart = {
      row: row,
      cpuPercent: toXcpNgNumber(row.latestCpuPercent),
      memoryPercent: getXcpNgMemoryPercent(row),
      memoryBytes: toXcpNgNumber(row.latestMemoryBytes),
    };
    const ranked: number | null =
      rankBy === "cpu" ? part.cpuPercent : part.memoryPercent;
    if (ranked === null) {
      continue;
    }
    busy.push(part);
  }
  return busy
    .sort((a: XcpNgBusyPart, b: XcpNgBusyPart): number => {
      const first: number =
        rankBy === "cpu"
          ? (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)
          : (b.memoryPercent ?? -1) - (a.memoryPercent ?? -1);
      if (first !== 0) {
        return first;
      }
      const second: number =
        rankBy === "cpu"
          ? (b.memoryPercent ?? -1) - (a.memoryPercent ?? -1)
          : (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1);
      if (second !== 0) {
        return second;
      }
      return getXcpNgDisplayName(a.row).localeCompare(
        getXcpNgDisplayName(b.row),
        undefined,
        { numeric: true, sensitivity: "base" },
      );
    })
    .slice(0, data.limit);
}
