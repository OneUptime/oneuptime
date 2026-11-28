import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import XcpNgResourceKind from "Common/Types/XcpNg/XcpNgResourceKind";
import {
  XCP_NG_ID_ATTRIBUTE,
  XCP_NG_VM_RAN_RECENTLY_HOURS,
  XcpNgHostPowerState,
  XcpNgLabel,
  XcpNgVmPowerState,
} from "Common/Types/XcpNg/XcpNgTelemetry";
import { XCP_NG_SR_NEAR_FULL_PERCENT as SR_NEAR_FULL_ALERT_PERCENT } from "Common/Types/Monitor/XcpNgAlertTemplates";
import {
  XcpNgBackupStatus,
  XcpNgEventLogAttribute,
  XcpNgEventReadProblems,
} from "Common/Types/XcpNg/XcpNgPoolEvents";
import {
  XcpNgEventSource,
  XcpNgPoolBackupRunSummary,
} from "Common/Types/XcpNg/XcpNgPoolEventState";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  StorageUsage,
  StorageUsageLevel,
  StorageUsageThresholds,
  formatStorageBytes,
  getStorageUsage,
} from "Common/Utils/Storage/StorageUsage";
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
import { OpenIssueRecord } from "../../../Components/ResourceTopology/ResourceTopologyIssues";
import {
  getXcpNgDisplayName,
  toXcpNgDate,
  toXcpNgNumber,
} from "./XcpNgResourceUtils";
import {
  XcpNgHaSummary,
  getXcpNgBackupJobs,
  getXcpNgBackupsWatchedSince,
  getXcpNgEventReadProblems,
  getXcpNgEventReadStatus,
  getXcpNgNewestRun,
  getXcpNgVmBackupStatus,
  isXcpNgHaAtRisk,
  isXcpNgJobFailing,
  isXcpNgVmBackupLate,
  isXcpNgVmLastBackupFailed,
  summarizeXcpNgHa,
} from "./XcpNgEventFacts";

/*
 * WHAT IN AN XCP-NG POOL NEEDS SOMEONE, AND HOW BAD IT IS.
 *
 * One set of rules for every page that says it: the pool's Overview (its
 * health pill, its counts and its Needs attention card), a host's, a VM's
 * and a storage repository's own page, the lists and the Topology. They
 * read the inventory the ingest keeps from what Xen Orchestra reports
 * (XcpNgResource), and they say what the pool's alert templates say
 * (XcpNgAlertTemplates), so a page never calls healthy what an alert fires
 * on, nor the other way round.
 *
 *   Critical - broken, or about to be:
 *     a host Halted, or in a state Xen Orchestra cannot tell (Unknown); a
 *     storage repository more than 95% full, where VMs stop writing.
 *   Warning - needs a look soon:
 *     a host disabled (in maintenance mode or being evacuated: XAPI starts
 *     no VM on it); a VM Halted or Paused that ran in the last 24 hours; a
 *     storage repository more than 90% full (where its alert fires), or
 *     allocated past its size (thin provisioning that can fill it).
 *
 * And what a probe reads beyond the metrics (#10997), by the alerts' rules
 * (XcpNgEventFacts): HA on but unable to survive one more host failure
 * (Critical, as the HA alert); a VM whose last backup failed, or whose
 * backup is overdue (Warning, as VM Not Backed Up); a backup job with none
 * of the pool's VMs in it, a pool metadata backup, whose last run failed;
 * and alarms or backups the probe could not read, which would leave their
 * alerts silent.
 *
 * A VM someone suspended chose to: it is never "stopped". A VM nobody saw
 * running for a day was switched off on purpose, as the VM Stopped alert
 * reads it (xcp_ng.vm.stopped_after_running). A control domain (dom0) is
 * its host's own: it is left out of every VM rule. A virtual disk is read
 * through its storage repository and its VM, never on its own.
 *
 * React-free (no Route building: pages hand in routeFor), so App tests can
 * read it.
 */

export type XcpNgPartKind = "Host" | "VM" | "StorageRepository";

// Where the Storage Repository Near Full alert fires, and Needs attention warns.
export const XCP_NG_SR_NEAR_FULL_PERCENT: number = SR_NEAR_FULL_ALERT_PERCENT;

// Where a storage repository is about to stop VMs writing: critical.
export const XCP_NG_SR_FULL_PERCENT: number = 95;

/*
 * Where the shared storage bar turns amber and red, and the rules call a
 * storage repository nearly full and full. Only past a line, as the alert
 * reads it ("more than 90%"): a repository at exactly 90% has not crossed it.
 */
export const XCP_NG_STORAGE_USAGE_THRESHOLDS: StorageUsageThresholds = {
  warningPercent: XCP_NG_SR_NEAR_FULL_PERCENT,
  criticalPercent: XCP_NG_SR_FULL_PERCENT,
  isPastLineOnly: true,
};

// How long a VM's last Running reading makes its stop worth a look.
export const XCP_NG_VM_RAN_RECENTLY_MS: number =
  XCP_NG_VM_RAN_RECENTLY_HOURS * 60 * 60 * 1000;

/*
 * What a storage repository holds that is not a VM's disk: an ISO library
 * and removable media. Their size is not VM capacity (an ISO library
 * reports 0, removable media a disc's), so the pool's storage figures and
 * the fullness rules leave them out, as the pool's counts do
 * (XcpNgResourceService.getInventorySummary).
 */
const NOT_VM_DISK_CONTENT: ReadonlySet<string> = new Set<string>([
  "iso",
  "disk",
]);

export interface XcpNgAssessment {
  severity: ResourceAttentionSeverity | null;
  reasons: Array<ResourceAttentionText>;
}

export type XcpNgRouteFor = (
  kind: XcpNgPartKind,
  externalId: string,
) => Route | undefined;

const REASON_HALTED: string = translationKey("Halted");
const REASON_NOT_RESPONDING: string = translationKey("Not responding");
const REASON_OFFLINE: string = translationKey("Offline");
const REASON_DISABLED: string = translationKey("Disabled");
const REASON_HALTED_AFTER_RUNNING: string = translationKey(
  "Halted after running",
);
const REASON_PAUSED_AFTER_RUNNING: string = translationKey(
  "Paused after running",
);
const REASON_PERCENT_FULL: string = translationKey("{{percent}} full");
const REASON_OVER_ALLOCATED: string = translationKey(
  "{{allocated}} allocated of {{size}}",
);
const REASON_BACKUP_FAILED: string = translationKey("Last backup failed");
const REASON_BACKUP_INTERRUPTED: string = translationKey(
  "Last backup interrupted",
);
const REASON_BACKUP_LATE: string = translationKey("Backup overdue");
const REASON_HA_AT_RISK: string = translationKey(
  "HA cannot tolerate a host failure",
);
const REASON_JOB_FAILED: string = translationKey("Last run failed");
const REASON_ALARMS_NOT_READ: string = translationKey("Alarms not read");
const REASON_BACKUPS_NOT_READ: string = translationKey("Backups not read");

const KIND_HOST: string = translationKey("Host");
const KIND_VM: string = translationKey("VM");
const KIND_STORAGE_REPOSITORY: string = translationKey("Storage repository");
const KIND_POOL: string = translationKey("Pool");
const KIND_BACKUP_JOB: string = translationKey("Backup job");
const KIND_XEN_ORCHESTRA: string = translationKey("Xen Orchestra");
const KIND_XAPI: string = translationKey("XAPI");

// The order Needs attention lists the kinds in, at one severity.
export const XCP_NG_ATTENTION_KIND_ORDER: Array<string> = [
  KIND_POOL,
  KIND_HOST,
  KIND_STORAGE_REPOSITORY,
  KIND_VM,
  KIND_BACKUP_JOB,
  KIND_XEN_ORCHESTRA,
  KIND_XAPI,
];

export const XCP_NG_PART_ICONS: Record<XcpNgPartKind, IconProp> = {
  Host: IconProp.ServerStack,
  VM: IconProp.Cube,
  StorageRepository: IconProp.Database,
};

export function getXcpNgPartKindWord(kind: XcpNgPartKind): string {
  if (kind === "Host") {
    return KIND_HOST;
  }
  if (kind === "VM") {
    return KIND_VM;
  }
  return KIND_STORAGE_REPOSITORY;
}

// The page kind a row is, or null for a virtual disk or an unknown kind.
export function getXcpNgPartKind(
  row: Pick<XcpNgResource, "kind">,
): XcpNgPartKind | null {
  if (row.kind === XcpNgResourceKind.Host) {
    return "Host";
  }
  if (row.kind === XcpNgResourceKind.VM) {
    return "VM";
  }
  if (row.kind === XcpNgResourceKind.StorageRepository) {
    return "StorageRepository";
  }
  return null;
}

export function isXcpNgControlDomain(
  row: Pick<XcpNgResource, "kind" | "isControlDomain">,
): boolean {
  return row.kind === XcpNgResourceKind.VM && row.isControlDomain === true;
}

/*
 * A host that is not running: Halted, in a state Xen Orchestra cannot tell
 * (Unknown: XAPI lost touch with it), or reported down. A host that has not
 * reported its state yet is not one.
 */
export function isXcpNgHostOffline(
  row: Pick<XcpNgResource, "kind" | "isUp" | "powerState">,
): boolean {
  if (row.kind !== XcpNgResourceKind.Host) {
    return false;
  }
  return (
    row.powerState === XcpNgHostPowerState.Halted ||
    row.powerState === XcpNgHostPowerState.Unknown ||
    (row.isUp === false && row.powerState !== XcpNgHostPowerState.Running)
  );
}

// A host XAPI starts no VM on: in maintenance mode or being evacuated.
export function isXcpNgHostDisabled(
  row: Pick<XcpNgResource, "kind" | "isEnabled">,
): boolean {
  return row.kind === XcpNgResourceKind.Host && row.isEnabled === false;
}

/*
 * A VM that is Halted or Paused although it was running within the last
 * day: what the VM Stopped alert fires on. Suspended is someone's choice
 * and never counts; nor does a control domain.
 */
export function isXcpNgVmStoppedAfterRunning(
  row: Pick<
    XcpNgResource,
    "kind" | "isControlDomain" | "powerState" | "lastRunningAt"
  >,
  now: Date,
): boolean {
  if (row.kind !== XcpNgResourceKind.VM || row.isControlDomain === true) {
    return false;
  }
  if (
    row.powerState !== XcpNgVmPowerState.Halted &&
    row.powerState !== XcpNgVmPowerState.Paused
  ) {
    return false;
  }
  const lastRunningAt: Date | null = toXcpNgDate(row.lastRunningAt);
  if (!lastRunningAt) {
    return false;
  }
  const age: number = now.getTime() - lastRunningAt.getTime();
  return age >= 0 && age <= XCP_NG_VM_RAN_RECENTLY_MS;
}

/*
 * A storage repository that holds VM disks: not an ISO library or
 * removable media, and with a size to fill.
 */
export function isXcpNgVmDiskRepository(
  row: Pick<XcpNgResource, "kind" | "contentType" | "maxDiskBytes">,
): boolean {
  if (row.kind !== XcpNgResourceKind.StorageRepository) {
    return false;
  }
  const size: number | null = toXcpNgNumber(row.maxDiskBytes);
  return (
    !NOT_VM_DISK_CONTENT.has((row.contentType || "").trim().toLowerCase()) &&
    size !== null &&
    size > 0
  );
}

/*
 * How full a storage repository is, as the shared storage bar reads it:
 * what XAPI reports used (physical usage) of its size (physical size), at
 * the pool's own lines. Null when it reports no size - an ISO library, a
 * repository Xen Orchestra has not measured - which a page says in words,
 * never 0%.
 */
export function getXcpNgStorageUsage(
  row: Pick<XcpNgResource, "kind" | "latestDiskBytes" | "maxDiskBytes">,
): StorageUsage | null {
  if (row.kind !== XcpNgResourceKind.StorageRepository) {
    return null;
  }
  return getStorageUsage(
    { capacity: row.maxDiskBytes, used: row.latestDiskBytes },
    XCP_NG_STORAGE_USAGE_THRESHOLDS,
  );
}

// The share of a storage repository that is used, or null without a size.
export function getXcpNgStoragePercent(
  row: Pick<XcpNgResource, "kind" | "latestDiskBytes" | "maxDiskBytes">,
): number | null {
  const usage: StorageUsage | null = getXcpNgStorageUsage(row);
  return usage ? usage.usedPercent : null;
}

/*
 * The virtual size of every disk on a storage repository, as a share of its
 * size: above 100% it is thin-provisioned past what it can hold. Null
 * without both readings.
 */
export function getXcpNgAllocationPercent(
  row: Pick<XcpNgResource, "kind" | "virtualAllocationBytes" | "maxDiskBytes">,
): number | null {
  if (row.kind !== XcpNgResourceKind.StorageRepository) {
    return null;
  }
  const allocated: number | null = toXcpNgNumber(row.virtualAllocationBytes);
  const size: number | null = toXcpNgNumber(row.maxDiskBytes);
  if (allocated === null || size === null || size <= 0) {
    return null;
  }
  return (allocated / size) * 100;
}

export function isXcpNgStorageOverAllocated(
  row: Pick<XcpNgResource, "kind" | "virtualAllocationBytes" | "maxDiskBytes">,
): boolean {
  const percent: number | null = getXcpNgAllocationPercent(row);
  return percent !== null && percent > 100;
}

function formatPercentForReason(percent: number): string {
  // Rounded down, as the bar writes it: 89.9% never reads as a full 90%.
  return `${Math.floor(percent)}%`;
}

// A size in an English reason; the sentence writes it in its own digits.
function formatBytesForReason(bytes: number): string {
  return formatStorageBytes(bytes, "en");
}

// Why a host is offline, in Xen Orchestra's words for its state.
function offlineReason(
  row: Pick<XcpNgResource, "powerState">,
): ResourceAttentionText {
  if (row.powerState === XcpNgHostPowerState.Halted) {
    return { text: REASON_HALTED };
  }
  if (row.powerState === XcpNgHostPowerState.Unknown) {
    return { text: REASON_NOT_RESPONDING };
  }
  return { text: REASON_OFFLINE };
}

export function assessXcpNgHost(row: XcpNgResource): XcpNgAssessment {
  const reasons: Array<ResourceAttentionText> = [];
  const severities: Array<ResourceAttentionSeverity> = [];
  if (isXcpNgHostOffline(row)) {
    reasons.push(offlineReason(row));
    severities.push(ResourceAttentionSeverity.Critical);
  }
  if (isXcpNgHostDisabled(row)) {
    reasons.push({ text: REASON_DISABLED });
    severities.push(ResourceAttentionSeverity.Warning);
  }
  return {
    severity: mergeResourceAttentionSeverity(severities),
    reasons: reasons,
  };
}

/*
 * What a VM's backup rules need of its pool: when its backups were first
 * read, from which a VM with no good backup on record is counted overdue.
 * Without it, only a VM whose last good backup is on record can be.
 */
export interface XcpNgBackupContext {
  watchedSince: Date | null;
}

export function getXcpNgBackupContext(
  pool: Pick<XcpNgPool, "eventReadStatus"> | null | undefined,
): XcpNgBackupContext {
  return { watchedSince: pool ? getXcpNgBackupsWatchedSince(pool) : null };
}

export function assessXcpNgVm(
  row: XcpNgResource,
  now: Date,
  backups?: XcpNgBackupContext | undefined,
): XcpNgAssessment {
  const reasons: Array<ResourceAttentionText> = [];

  if (isXcpNgVmStoppedAfterRunning(row, now)) {
    reasons.push({
      text:
        row.powerState === XcpNgVmPowerState.Paused
          ? REASON_PAUSED_AFTER_RUNNING
          : REASON_HALTED_AFTER_RUNNING,
    });
  }

  if (isXcpNgVmLastBackupFailed(row)) {
    reasons.push({
      text:
        getXcpNgVmBackupStatus(row) === XcpNgBackupStatus.Interrupted
          ? REASON_BACKUP_INTERRUPTED
          : REASON_BACKUP_FAILED,
    });
  }

  if (
    isXcpNgVmBackupLate({
      row: row,
      watchedSince: backups?.watchedSince || null,
      now: now,
    })
  ) {
    reasons.push({ text: REASON_BACKUP_LATE });
  }

  return {
    severity: reasons.length > 0 ? ResourceAttentionSeverity.Warning : null,
    reasons: reasons,
  };
}

export function assessXcpNgStorage(row: XcpNgResource): XcpNgAssessment {
  const reasons: Array<ResourceAttentionText> = [];
  const severities: Array<ResourceAttentionSeverity> = [];

  const usage: StorageUsage | null = getXcpNgStorageUsage(row);
  if (usage && usage.level !== StorageUsageLevel.Normal) {
    reasons.push({
      text: REASON_PERCENT_FULL,
      values: { percent: formatPercentForReason(usage.usedPercent) },
    });
    severities.push(
      usage.level === StorageUsageLevel.Critical
        ? ResourceAttentionSeverity.Critical
        : ResourceAttentionSeverity.Warning,
    );
  }

  if (isXcpNgStorageOverAllocated(row)) {
    reasons.push({
      text: REASON_OVER_ALLOCATED,
      values: {
        allocated: formatBytesForReason(
          toXcpNgNumber(row.virtualAllocationBytes) || 0,
        ),
        size: formatBytesForReason(toXcpNgNumber(row.maxDiskBytes) || 0),
      },
    });
    severities.push(ResourceAttentionSeverity.Warning);
  }

  return {
    severity: mergeResourceAttentionSeverity(severities),
    reasons: reasons,
  };
}

export function assessXcpNgResource(
  row: XcpNgResource,
  now: Date,
  backups?: XcpNgBackupContext | undefined,
): XcpNgAssessment {
  const kind: XcpNgPartKind | null = getXcpNgPartKind(row);
  if (kind === "Host") {
    return assessXcpNgHost(row);
  }
  if (kind === "VM") {
    return assessXcpNgVm(row, now, backups);
  }
  if (kind === "StorageRepository") {
    return assessXcpNgStorage(row);
  }
  return { severity: null, reasons: [] };
}

/*
 * A storage repository's id under its name says which one it is when two
 * share a name ("Local storage" on every host); a host's and a VM's name
 * says it already.
 */
function detailOf(kind: XcpNgPartKind, row: XcpNgResource): string | undefined {
  if (kind === "StorageRepository") {
    return row.parentHostName || undefined;
  }
  return undefined;
}

type AttentionPool = Pick<
  XcpNgPool,
  | "name"
  | "xenOrchestraName"
  | "isHaEnabled"
  | "haHostFailuresToTolerate"
  | "haPlanExistsFor"
  | "isHaOvercommitted"
  | "masterHostExternalId"
  | "backupJobs"
  | "eventReadStatus"
>;

const EXPLANATION_HA_AT_RISK: string = translationKey(
  "If one more host fails, HA cannot restart every protected VM on the hosts left. Bring a host back or enable it, or free memory on the others.",
);

/*
 * What the pool itself needs, besides its parts: HA that cannot survive a
 * host failure, a backup job with none of its VMs (a metadata backup)
 * whose last run failed, and alarms or backups a probe could not read.
 */
export function getXcpNgPoolAttentionItems(data: {
  pool: AttentionPool;
  rows: Array<XcpNgResource>;
  translator?: Translator | undefined;
}): Array<ResourceAttentionItem> {
  const items: Array<ResourceAttentionItem> = [];
  const poolName: string = (data.pool.name || "").trim();

  const ha: XcpNgHaSummary = summarizeXcpNgHa({
    pool: data.pool,
    rows: data.rows,
  });
  if (isXcpNgHaAtRisk(ha)) {
    const item: ResourceAttentionItem = {
      key: "Pool:ha",
      kind: KIND_POOL,
      icon: IconProp.XcpNg,
      name: poolName || KIND_POOL,
      severity: ResourceAttentionSeverity.Critical,
      reasons: [{ text: REASON_HA_AT_RISK }],
    };
    if (data.translator) {
      item.explanation =
        data.translator.translateText(EXPLANATION_HA_AT_RISK) ||
        EXPLANATION_HA_AT_RISK;
    }
    items.push(item);
  }

  for (const job of getXcpNgBackupJobs(data.pool)) {
    if ((toXcpNgNumber(job.vmCount) || 0) > 0 || !isXcpNgJobFailing(job)) {
      continue;
    }
    const run: XcpNgPoolBackupRunSummary | null = getXcpNgNewestRun(job);
    const item: ResourceAttentionItem = {
      key: `BackupJob:${job.jobId}`,
      kind: KIND_BACKUP_JOB,
      icon: IconProp.Archive,
      name: job.name,
      severity: ResourceAttentionSeverity.Warning,
      reasons: [{ text: REASON_JOB_FAILED }],
    };
    if (run?.error) {
      item.message = run.error;
    }
    items.push(item);
  }

  const problems: XcpNgEventReadProblems = getXcpNgEventReadProblems(data.pool);
  const isXapi: boolean =
    getXcpNgEventReadStatus(data.pool)?.source === XcpNgEventSource.Xapi;
  const readerName: string = isXapi
    ? poolName || KIND_POOL
    : (data.pool.xenOrchestraName || "").trim() || KIND_XEN_ORCHESTRA;
  const readerKind: string = isXapi ? KIND_XAPI : KIND_XEN_ORCHESTRA;

  if (problems.messages) {
    items.push({
      key: "Reading:messages",
      kind: readerKind,
      icon: IconProp.Signal,
      name: readerName,
      severity: ResourceAttentionSeverity.Warning,
      reasons: [{ text: REASON_ALARMS_NOT_READ }],
      message: problems.messages,
    });
  }
  // The same words as the alarms' say both: one item, not two.
  if (problems.backups && problems.backups !== problems.messages) {
    items.push({
      key: "Reading:backups",
      kind: readerKind,
      icon: IconProp.Signal,
      name: readerName,
      severity: ResourceAttentionSeverity.Warning,
      reasons: [{ text: REASON_BACKUPS_NOT_READ }],
      message: problems.backups,
    });
  }

  return items;
}

/*
 * Everything in the pool that needs attention, most urgent first: the
 * pool's own (with its row), its hosts, its storage repositories and its
 * VMs, by their rules.
 */
export function getXcpNgAttentionItems(data: {
  rows: Array<XcpNgResource>;
  routeFor: XcpNgRouteFor;
  now: Date;
  pool?: AttentionPool | null | undefined;
  translator?: Translator | undefined;
  /*
   * A part's page, which lists the part's own items, not the pool's: the
   * pool's backups for its VMs' backup rules alone.
   */
  backups?: XcpNgBackupContext | undefined;
}): Array<ResourceAttentionItem> {
  const items: Array<ResourceAttentionItem> = data.pool
    ? getXcpNgPoolAttentionItems({
        pool: data.pool,
        rows: data.rows,
        translator: data.translator,
      })
    : [];
  const backups: XcpNgBackupContext =
    data.backups || getXcpNgBackupContext(data.pool);

  for (const row of data.rows) {
    const kind: XcpNgPartKind | null = getXcpNgPartKind(row);
    if (!kind || isXcpNgControlDomain(row)) {
      continue;
    }
    const assessment: XcpNgAssessment = assessXcpNgResource(
      row,
      data.now,
      backups,
    );
    if (!assessment.severity) {
      continue;
    }
    const externalId: string = row.externalId || "";
    items.push({
      key: `${kind}:${externalId}`,
      kind: getXcpNgPartKindWord(kind),
      icon: XCP_NG_PART_ICONS[kind],
      name: getXcpNgDisplayName(row),
      detail: detailOf(kind, row),
      severity: assessment.severity,
      reasons: assessment.reasons,
      route: externalId ? data.routeFor(kind, externalId) : undefined,
    });
  }

  return sortResourceAttention(items, XCP_NG_ATTENTION_KIND_ORDER);
}

export function getXcpNgPoolHealth(
  items: Array<ResourceAttentionItem>,
): ResourceHealth {
  return getResourceAttentionHealth(items);
}

/*
 * ---------------------------------------------------------------------------
 * What the Overview's counts open
 * ---------------------------------------------------------------------------
 *
 * The Overview counts what is wrong - hosts offline, hosts disabled, VMs
 * stopped after running, storage repositories filling up or allocated past
 * their size - and each count opens exactly those parts: why (the count's
 * own reason first, then whatever else the rules say), where each one is
 * (a VM's host, a local repository's host, each a step from its page), and
 * since when (#9594). By the same rules as Needs attention, so a part reads
 * the same in both.
 */
export type XcpNgProblem =
  | { kind: "hostsOffline" }
  | { kind: "hostsDisabled" }
  | { kind: "vmsStopped" }
  | { kind: "storageFull" }
  | { kind: "storageOverAllocated" }
  // A VM whose last backup failed or was interrupted.
  | { kind: "vmsBackupFailed" }
  // A VM whose backup is overdue: the VM Not Backed Up alert's.
  | { kind: "vmsBackupLate"; watchedSince: Date | null };

const FACT_HOST: string = translationKey("Host");
const FACT_BACKUP_JOB: string = translationKey("Backup job");
const SINCE_LAST_RUNNING: string = translationKey("Last running {{time}}");
const SINCE_LAST_BACKUP: string = translationKey("Last backup {{time}}");
const SINCE_LAST_GOOD_BACKUP: string = translationKey(
  "Last good backup {{time}}",
);

/*
 * What each count's parts mean and what to do about them: whole sentences
 * in English, looked up where they are drawn.
 */
const EXPLANATION_HOST_DISABLED: string = translationKey(
  "XAPI starts no VM on a disabled host: it is in maintenance mode or being evacuated. Enable it in Xen Orchestra once the work on it is done.",
);
const EXPLANATION_HOST_UNKNOWN: string = translationKey(
  "The pool cannot tell whether this host runs: it lost touch with it. Its VMs may still be running, or may have stopped with it.",
);
const EXPLANATION_VM_STOPPED: string = translationKey(
  "It was running in the last 24 hours. A VM someone shut down on purpose leaves this list a day after it stopped.",
);
const EXPLANATION_STORAGE_FULL: string = translationKey(
  "When it fills, VMs with disks on it stop writing, and snapshots, and the backups that take them, fail.",
);
const EXPLANATION_OVER_ALLOCATED: string = translationKey(
  "Its disks are thin-provisioned past its size: they can fill it as they grow, though it is not full yet.",
);
const EXPLANATION_BACKUP_FAILED: string = translationKey(
  "Its last backup did not complete. Xen Orchestra's words for why are under its name; run the job again from Xen Orchestra once it is fixed.",
);
const EXPLANATION_BACKUP_LATE: string = translationKey(
  "It has not had a good backup since its jobs last should have run, and the grace past that. A VM a scheduled job backs up should never be here.",
);

/*
 * Whether a row is one the count counts - the very test the Overview's
 * count is worked out by, so the dialog lists what the number said.
 */
export function isXcpNgProblemRow(
  row: XcpNgResource,
  problem: XcpNgProblem,
  now: Date,
): boolean {
  switch (problem.kind) {
    case "hostsOffline":
      return isXcpNgHostOffline(row);
    case "hostsDisabled":
      return isXcpNgHostDisabled(row);
    case "vmsStopped":
      return isXcpNgVmStoppedAfterRunning(row, now);
    case "storageFull": {
      const usage: StorageUsage | null = getXcpNgStorageUsage(row);
      return Boolean(usage && usage.level !== StorageUsageLevel.Normal);
    }
    case "storageOverAllocated":
      return isXcpNgStorageOverAllocated(row);
    case "vmsBackupFailed":
      return isXcpNgVmLastBackupFailed(row);
    case "vmsBackupLate":
      return isXcpNgVmBackupLate({
        row: row,
        watchedSince: problem.watchedSince,
        now: now,
      });
    default:
      return false;
  }
}

function sameReason(
  a: ResourceAttentionText,
  b: ResourceAttentionText,
): boolean {
  return (
    a.text === b.text &&
    JSON.stringify(a.values || {}) === JSON.stringify(b.values || {})
  );
}

// The count's own reason, which leads the part's reasons in its dialog.
function problemReasonOf(
  row: XcpNgResource,
  problem: XcpNgProblem,
  assessment: XcpNgAssessment,
): ResourceAttentionText | null {
  switch (problem.kind) {
    case "hostsOffline":
      return offlineReason(row);
    case "hostsDisabled":
      return { text: REASON_DISABLED };
    case "storageFull":
      return (
        assessment.reasons.find((reason: ResourceAttentionText): boolean => {
          return reason.text === REASON_PERCENT_FULL;
        }) || null
      );
    case "storageOverAllocated":
      return (
        assessment.reasons.find((reason: ResourceAttentionText): boolean => {
          return reason.text === REASON_OVER_ALLOCATED;
        }) || null
      );
    case "vmsBackupFailed":
      return {
        text:
          getXcpNgVmBackupStatus(row) === XcpNgBackupStatus.Interrupted
            ? REASON_BACKUP_INTERRUPTED
            : REASON_BACKUP_FAILED,
      };
    case "vmsBackupLate":
      return { text: REASON_BACKUP_LATE };
    case "vmsStopped":
    default:
      return assessment.reasons[0] || null;
  }
}

function explanationOf(
  row: XcpNgResource,
  problem: XcpNgProblem,
): string | null {
  switch (problem.kind) {
    case "hostsOffline":
      return row.powerState === XcpNgHostPowerState.Unknown
        ? EXPLANATION_HOST_UNKNOWN
        : null;
    case "hostsDisabled":
      return EXPLANATION_HOST_DISABLED;
    case "vmsStopped":
      return EXPLANATION_VM_STOPPED;
    case "storageFull":
      return EXPLANATION_STORAGE_FULL;
    case "storageOverAllocated":
      return EXPLANATION_OVER_ALLOCATED;
    case "vmsBackupFailed":
      return EXPLANATION_BACKUP_FAILED;
    case "vmsBackupLate":
      return EXPLANATION_BACKUP_LATE;
    default:
      return null;
  }
}

export function getXcpNgProblemItems(data: {
  rows: Array<XcpNgResource>;
  problem: XcpNgProblem;
  routeFor: XcpNgRouteFor;
  now: Date;
  // A part not reported for longer than this says when it last was.
  staleMs: number;
  /*
   * Words each part's explanation in the reader's language: what a
   * disabled host means, why a VM that stopped is listed. A list that
   * draws no explanation leaves it out.
   */
  translator?: Translator | undefined;
  // The pool's backups, for a VM's backup reasons beside the count's own.
  backups?: XcpNgBackupContext | undefined;
}): Array<ResourceAttentionItem> {
  const hostsById: Map<string, XcpNgResource> = new Map();
  for (const row of data.rows) {
    if (row.kind === XcpNgResourceKind.Host && row.externalId) {
      hostsById.set(row.externalId, row);
    }
  }

  const items: Array<ResourceAttentionItem> = [];

  for (const row of data.rows) {
    const kind: XcpNgPartKind | null = getXcpNgPartKind(row);
    if (
      !kind ||
      isXcpNgControlDomain(row) ||
      !isXcpNgProblemRow(row, data.problem, data.now)
    ) {
      continue;
    }

    const assessment: XcpNgAssessment = assessXcpNgResource(
      row,
      data.now,
      data.problem.kind === "vmsBackupLate"
        ? { watchedSince: data.problem.watchedSince }
        : data.backups,
    );
    const first: ResourceAttentionText | null = problemReasonOf(
      row,
      data.problem,
      assessment,
    );
    const externalId: string = row.externalId || "";

    const item: ResourceAttentionItem = {
      key: `${kind}:${externalId}`,
      kind: getXcpNgPartKindWord(kind),
      icon: XCP_NG_PART_ICONS[kind],
      name: getXcpNgDisplayName(row),
      detail: detailOf(kind, row),
      severity: assessment.severity || ResourceAttentionSeverity.Warning,
      // The count's own reason first, then the rest of what the rules say.
      reasons: first
        ? [
            first,
            ...assessment.reasons.filter(
              (reason: ResourceAttentionText): boolean => {
                return !sameReason(reason, first);
              },
            ),
          ]
        : assessment.reasons,
      route: externalId ? data.routeFor(kind, externalId) : undefined,
    };

    // Which host a VM or a local storage repository is on, a step away.
    if ((kind === "VM" || kind === "StorageRepository") && row.parentHostName) {
      const host: XcpNgResource | undefined = row.parentHostExternalId
        ? hostsById.get(row.parentHostExternalId)
        : undefined;
      const fact: ResourceAttentionFact = {
        key: "host",
        label: FACT_HOST,
        value: row.parentHostName,
        route: host?.externalId
          ? data.routeFor("Host", host.externalId)
          : undefined,
      };
      item.facts = [fact];
    }

    // A VM's backup: which job, when it last ran, and Xen Orchestra's words.
    if (
      data.problem.kind === "vmsBackupFailed" ||
      data.problem.kind === "vmsBackupLate"
    ) {
      const jobName: string = (row.lastBackupJobName || "").trim();
      if (jobName) {
        item.facts = [
          ...(item.facts || []),
          { key: "backup-job", label: FACT_BACKUP_JOB, value: jobName },
        ];
      }
      const lastGoodAt: Date | null = toXcpNgDate(row.lastSuccessfulBackupAt);
      const lastAt: Date | null = toXcpNgDate(row.lastBackupAt);
      if (data.problem.kind === "vmsBackupLate" && lastGoodAt) {
        item.since = { at: lastGoodAt, template: SINCE_LAST_GOOD_BACKUP };
      } else if (lastAt) {
        item.since = { at: lastAt, template: SINCE_LAST_BACKUP };
      }
      const error: string = (row.lastBackupError || "").trim();
      if (error && data.problem.kind === "vmsBackupFailed") {
        item.message = error;
      }
    }

    // When a VM that stopped was last running.
    if (data.problem.kind === "vmsStopped") {
      const lastRunningAt: Date | null = toXcpNgDate(row.lastRunningAt);
      if (lastRunningAt) {
        item.since = { at: lastRunningAt, template: SINCE_LAST_RUNNING };
      }
    }

    /*
     * A host that has stopped being reported says when it last was; one
     * Xen Orchestra still reports as Halted is reported now, which says
     * nothing.
     */
    if (data.problem.kind === "hostsOffline") {
      const seenAt: Date | null = toXcpNgDate(row.lastSeenAt);
      if (seenAt && data.now.getTime() - seenAt.getTime() > data.staleMs) {
        item.lastReportAt = seenAt;
      }
    }

    const explanation: string | null = explanationOf(row, data.problem);
    if (explanation && data.translator) {
      item.explanation =
        data.translator.translateText(explanation) || explanation;
    }

    items.push(item);
  }

  return sortResourceAttention(items, XCP_NG_ATTENTION_KIND_ORDER);
}

/*
 * ---------------------------------------------------------------------------
 * Which part an open incident or alert is about
 * ---------------------------------------------------------------------------
 *
 * The shipped templates group by xcp_ng.id (the object's XAPI UUID, which
 * ingest stamps on every datapoint), so a record's series labels name the
 * host, VM or storage repository it fired for. A person's own monitor may
 * group by Xen Orchestra's labels instead: uuid (a host or a VM), sr_uuid
 * (a storage repository) or vdi_uuid (a virtual disk, read as its
 * repository's never).
 */
const ISSUE_ID_LABELS: ReadonlyArray<string> = [
  XCP_NG_ID_ATTRIBUTE,
  XcpNgLabel.Uuid,
  XcpNgLabel.SrUuid,
  /*
   * An alert on what XAPI said - a VM that crashed, storage that failed to
   * plug (XcpNgEventAlertTemplates) - names the object it is about.
   */
  XcpNgEventLogAttribute.ObjectUuid,
];

function readLabel(labels: JSONObject | null, key: string): string | null {
  if (!labels) {
    return null;
  }
  for (const candidate of [key, `resource.${key}`]) {
    const value: unknown = (labels as Record<string, unknown>)[candidate];
    if (typeof value === "string" && value.trim()) {
      return value.trim().toLowerCase();
    }
  }
  return null;
}

// The UUID an open record's series names, or null when it names none.
export function getXcpNgIssueTargetId(
  record: Pick<OpenIssueRecord, "seriesLabels">,
): string | null {
  for (const label of ISSUE_ID_LABELS) {
    const value: string | null = readLabel(record.seriesLabels, label);
    if (value) {
      return value;
    }
  }
  return null;
}

// Whether an open record is about this host, VM or storage repository.
export function isXcpNgIssueAbout(
  record: Pick<OpenIssueRecord, "seriesLabels">,
  row: Pick<XcpNgResource, "externalId">,
): boolean {
  const target: string | null = getXcpNgIssueTargetId(record);
  const externalId: string = (row.externalId || "").trim().toLowerCase();
  return Boolean(target && externalId && target === externalId);
}
