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

const KIND_HOST: string = translationKey("Host");
const KIND_VM: string = translationKey("VM");
const KIND_STORAGE_REPOSITORY: string = translationKey("Storage repository");

// The order Needs attention lists the kinds in, at one severity.
export const XCP_NG_ATTENTION_KIND_ORDER: Array<string> = [
  KIND_HOST,
  KIND_STORAGE_REPOSITORY,
  KIND_VM,
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

export function assessXcpNgVm(row: XcpNgResource, now: Date): XcpNgAssessment {
  if (!isXcpNgVmStoppedAfterRunning(row, now)) {
    return { severity: null, reasons: [] };
  }
  return {
    severity: ResourceAttentionSeverity.Warning,
    reasons: [
      {
        text:
          row.powerState === XcpNgVmPowerState.Paused
            ? REASON_PAUSED_AFTER_RUNNING
            : REASON_HALTED_AFTER_RUNNING,
      },
    ],
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
): XcpNgAssessment {
  const kind: XcpNgPartKind | null = getXcpNgPartKind(row);
  if (kind === "Host") {
    return assessXcpNgHost(row);
  }
  if (kind === "VM") {
    return assessXcpNgVm(row, now);
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

/*
 * Everything in the pool that needs attention, most urgent first: its
 * hosts, its storage repositories and its VMs, by their rules.
 */
export function getXcpNgAttentionItems(data: {
  rows: Array<XcpNgResource>;
  routeFor: XcpNgRouteFor;
  now: Date;
}): Array<ResourceAttentionItem> {
  const items: Array<ResourceAttentionItem> = [];

  for (const row of data.rows) {
    const kind: XcpNgPartKind | null = getXcpNgPartKind(row);
    if (!kind || isXcpNgControlDomain(row)) {
      continue;
    }
    const assessment: XcpNgAssessment = assessXcpNgResource(row, data.now);
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
  | { kind: "storageOverAllocated" };

const FACT_HOST: string = translationKey("Host");
const SINCE_LAST_RUNNING: string = translationKey("Last running {{time}}");

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

    const assessment: XcpNgAssessment = assessXcpNgResource(row, data.now);
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
