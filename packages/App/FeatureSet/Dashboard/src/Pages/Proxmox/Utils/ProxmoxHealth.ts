import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ProxmoxGuestStopCause,
  getProxmoxGuestStopCause,
} from "Common/Utils/Proxmox/ProxmoxGuestPowerTask";
import {
  StorageUsage,
  StorageUsageLevel,
  StorageUsageThresholds,
  getStorageUsage,
} from "Common/Utils/Storage/StorageUsage";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionSince,
  ResourceAttentionText,
  ResourceHealth,
  getResourceAttentionHealth,
  mergeResourceAttentionSeverity,
  sortResourceAttention,
} from "../../../Components/ResourcePart/ResourceAttention";
import { ResourcePartBadge } from "../../../Components/ResourcePart/ResourcePartTypes";
import { OpenIssueRecord } from "../../../Components/ResourceTopology/ResourceTopologyIssues";
import { getProxmoxLockBadge } from "./ProxmoxPartFacts";

/*
 * WHAT ON A PROXMOX VE CLUSTER NEEDS SOMEONE, AND HOW BAD IT IS.
 *
 * One set of rules for every page that says it: the cluster's Overview (its
 * health pill and Needs attention card), a node's, a guest's and a
 * storage's own page, the lists and the Topology. They read the inventory
 * the agent keeps (ProxmoxResource) and, for replication, the jobs the
 * Overview reads from the exporter's series.
 *
 *   Critical - broken, or about to be:
 *     a node offline; a node or guest HA fenced or in error; a storage no
 *     longer available, or more than 95% full; a node's or a container's
 *     root disk more than 95% full; the cluster not quorate.
 *   Warning - needs a look soon:
 *     a guest stopped although it starts on boot; a guest in no backup job;
 *     a guest whose last backup failed; a storage, or a node's or a
 *     container's root disk, more than 85% full; a replication job failing.
 *
 * A template never runs and is never "stopped": it is left out of every
 * rule a running guest is held to. A lock is not a problem by itself - a
 * backup holds one every night - so it is a guest's badge, and the Backup
 * Running Too Long alert is what says one is stuck.
 *
 * React-free (no Route building: pages hand in routeFor), so App tests can
 * read it.
 */

export const PROXMOX_STORAGE_NEAR_FULL_PERCENT: number = 85;
export const PROXMOX_STORAGE_FULL_PERCENT: number = 95;

/*
 * Where the shared storage bar turns amber and red, and the rules below
 * call a disk nearly full and full: a storage, a node's root filesystem and
 * a container's root disk alike. Only past a line, as the rules read it: a
 * storage at exactly 85% has not crossed it.
 */
export const PROXMOX_STORAGE_USAGE_THRESHOLDS: StorageUsageThresholds = {
  warningPercent: PROXMOX_STORAGE_NEAR_FULL_PERCENT,
  criticalPercent: PROXMOX_STORAGE_FULL_PERCENT,
  isPastLineOnly: true,
};

export type ProxmoxPartKind = "Node" | "Guest" | "Storage";

export interface ProxmoxAssessment {
  severity: ResourceAttentionSeverity | null;
  reasons: Array<ResourceAttentionText>;
}

// A replication job as the Overview reads it from pve_replication_*.
export interface ProxmoxReplicationJobState {
  jobId: string;
  guestVmid: string;
  failedSyncs: number | null;
}

export type ProxmoxRouteFor = (
  kind: ProxmoxPartKind,
  externalId: string,
) => Route | undefined;

const REASON_OFFLINE: string = translationKey("Offline");
const REASON_HA_STATE: string = translationKey("HA state: {{state}}");
const REASON_STOPPED_ON_BOOT: string = translationKey(
  "Stopped, but starts on boot",
);
const REASON_NO_BACKUP_JOB: string = translationKey("In no backup job");
const REASON_BACKUP_FAILED: string = translationKey("Last backup failed");
const REASON_UNAVAILABLE: string = translationKey("Unavailable");
const REASON_PERCENT_FULL: string = translationKey("{{percent}} full");
const REASON_ROOT_DISK_FULL: string = translationKey(
  "Root disk {{percent}} full",
);
const REASON_FAILED_SYNCS: { one: string; other: string } = {
  one: "{{count}} failed sync",
  other: "{{count}} failed syncs",
};
const REASON_NOT_QUORATE: string = translationKey("Not quorate");

const KIND_NODE: string = translationKey("Node");
const KIND_GUEST: string = translationKey("Guest");
const KIND_STORAGE: string = translationKey("Storage");
const KIND_REPLICATION: string = translationKey("Replication job");
const KIND_CLUSTER: string = translationKey("Cluster");

// The order Needs attention lists the kinds in, at one severity.
export const PROXMOX_ATTENTION_KIND_ORDER: Array<string> = [
  KIND_CLUSTER,
  KIND_NODE,
  KIND_STORAGE,
  KIND_GUEST,
  KIND_REPLICATION,
];

// HA states that mean HA gave up on a resource or cut a node off.
const HA_CRITICAL_STATES: ReadonlySet<string> = new Set(["error", "fence"]);

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number: number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function isProxmoxTemplate(row: ProxmoxResource): boolean {
  return row.kind === "Guest" && row.isTemplate === true;
}

// The share of a storage that is used, or null when it reports no size.
export function getProxmoxStoragePercent(row: ProxmoxResource): number | null {
  const used: number | null = finite(row.latestDiskBytes);
  const total: number | null = finite(row.maxDiskBytes);
  if (used === null || total === null || total <= 0) {
    return null;
  }
  return (used / total) * 100;
}

function formatPercentForReason(percent: number): string {
  return `${Math.round(percent)}%`;
}

/*
 * How full a node's root filesystem or a guest's root disk is, as the
 * shared storage bar reads it: what Proxmox VE reports used (disk) of its
 * size (maxdisk), at Proxmox's own lines. Null when it reported nothing to
 * measure: a QEMU VM's root image reads 0 used, since Proxmox cannot see
 * inside the guest, and a stopped container's 0 too - a page says so in
 * words, never 0%. A storage has its own bar (its list's Used column).
 */
export function getProxmoxDiskUsage(
  row: Pick<
    ProxmoxResource,
    "kind" | "latestDiskBytes" | "maxDiskBytes" | "isTemplate"
  >,
): StorageUsage | null {
  if (row.kind !== "Node" && row.kind !== "Guest") {
    return null;
  }
  if (row.kind === "Guest" && row.isTemplate === true) {
    return null;
  }
  const used: number | null = finite(row.latestDiskBytes);
  if (used === null || used <= 0) {
    return null;
  }
  return getStorageUsage(
    { capacity: row.maxDiskBytes, used: used },
    PROXMOX_STORAGE_USAGE_THRESHOLDS,
  );
}

// A node's or a container's root disk past Proxmox's lines, with why.
function rootDiskFinding(row: ProxmoxResource): {
  severity: ResourceAttentionSeverity;
  reason: ResourceAttentionText;
} | null {
  const usage: StorageUsage | null = getProxmoxDiskUsage(row);
  if (!usage || usage.level === StorageUsageLevel.Normal) {
    return null;
  }
  return {
    severity:
      usage.level === StorageUsageLevel.Critical
        ? ResourceAttentionSeverity.Critical
        : ResourceAttentionSeverity.Warning,
    reason: {
      text: REASON_ROOT_DISK_FULL,
      values: { percent: formatPercentForReason(usage.usedPercent) },
    },
  };
}

function haReason(row: ProxmoxResource): ResourceAttentionText | null {
  if (row.haState && HA_CRITICAL_STATES.has(row.haState)) {
    return { text: REASON_HA_STATE, values: { state: row.haState } };
  }
  return null;
}

export function assessProxmoxNode(row: ProxmoxResource): ProxmoxAssessment {
  const reasons: Array<ResourceAttentionText> = [];
  const severities: Array<ResourceAttentionSeverity> = [];
  if (row.isUp === false) {
    reasons.push({ text: REASON_OFFLINE });
    severities.push(ResourceAttentionSeverity.Critical);
  }
  const ha: ResourceAttentionText | null = haReason(row);
  if (ha) {
    reasons.push(ha);
    severities.push(ResourceAttentionSeverity.Critical);
  }
  // An offline node's last reading is no reading of its disk now.
  if (row.isUp !== false) {
    const disk: {
      severity: ResourceAttentionSeverity;
      reason: ResourceAttentionText;
    } | null = rootDiskFinding(row);
    if (disk) {
      reasons.push(disk.reason);
      severities.push(disk.severity);
    }
  }
  return {
    severity: mergeResourceAttentionSeverity(severities),
    reasons: reasons,
  };
}

export function assessProxmoxGuest(row: ProxmoxResource): ProxmoxAssessment {
  const reasons: Array<ResourceAttentionText> = [];
  const severities: Array<ResourceAttentionSeverity> = [];

  const ha: ResourceAttentionText | null = haReason(row);
  if (ha) {
    reasons.push(ha);
    severities.push(ResourceAttentionSeverity.Critical);
  }

  if (!isProxmoxTemplate(row)) {
    if (row.onboot === true && row.isUp === false) {
      reasons.push({ text: REASON_STOPPED_ON_BOOT });
      severities.push(ResourceAttentionSeverity.Warning);
    }
    if (row.isBackedUp === false) {
      // A coverage gap, not a failed backup.
      reasons.push({ text: REASON_NO_BACKUP_JOB });
      severities.push(ResourceAttentionSeverity.Warning);
    }
    if (row.lastBackupStatus === "failed") {
      reasons.push({ text: REASON_BACKUP_FAILED });
      severities.push(ResourceAttentionSeverity.Warning);
    }
    /*
     * A container's root disk filling up: services inside it start to
     * fail (the Container Root Disk Near Full alert's concern). A VM's is
     * never read here - Proxmox cannot see inside it.
     */
    const disk: {
      severity: ResourceAttentionSeverity;
      reason: ResourceAttentionText;
    } | null = rootDiskFinding(row);
    if (disk) {
      reasons.push(disk.reason);
      severities.push(disk.severity);
    }
  }

  return {
    severity: mergeResourceAttentionSeverity(severities),
    reasons: reasons,
  };
}

export function assessProxmoxStorage(row: ProxmoxResource): ProxmoxAssessment {
  if (row.isUp === false) {
    return {
      severity: ResourceAttentionSeverity.Critical,
      reasons: [{ text: REASON_UNAVAILABLE }],
    };
  }
  const percent: number | null = getProxmoxStoragePercent(row);
  if (percent !== null && percent > PROXMOX_STORAGE_FULL_PERCENT) {
    return {
      severity: ResourceAttentionSeverity.Critical,
      reasons: [
        {
          text: REASON_PERCENT_FULL,
          values: { percent: formatPercentForReason(percent) },
        },
      ],
    };
  }
  if (percent !== null && percent > PROXMOX_STORAGE_NEAR_FULL_PERCENT) {
    return {
      severity: ResourceAttentionSeverity.Warning,
      reasons: [
        {
          text: REASON_PERCENT_FULL,
          values: { percent: formatPercentForReason(percent) },
        },
      ],
    };
  }
  return { severity: null, reasons: [] };
}

export function assessProxmoxResource(row: ProxmoxResource): ProxmoxAssessment {
  if (row.kind === "Node") {
    return assessProxmoxNode(row);
  }
  if (row.kind === "Guest") {
    return assessProxmoxGuest(row);
  }
  if (row.kind === "Storage") {
    return assessProxmoxStorage(row);
  }
  return { severity: null, reasons: [] };
}

// The part's name as people know it: the info series' name, else its id's tail.
export function getProxmoxDisplayName(row: ProxmoxResource): string {
  if (row.name) {
    return row.name;
  }
  const externalId: string = row.externalId || "";
  const slashIndex: number = externalId.indexOf("/");
  return slashIndex >= 0 ? externalId.substring(slashIndex + 1) : externalId;
}

function iconOf(kind: ProxmoxPartKind): IconProp {
  if (kind === "Node") {
    return IconProp.ServerStack;
  }
  if (kind === "Storage") {
    return IconProp.Database;
  }
  return IconProp.Cube;
}

function kindWordOf(kind: ProxmoxPartKind): string {
  if (kind === "Node") {
    return KIND_NODE;
  }
  if (kind === "Storage") {
    return KIND_STORAGE;
  }
  return KIND_GUEST;
}

/*
 * Everything on the cluster that needs attention, most urgent first: its
 * parts by their rules, its failing replication jobs, and the cluster
 * itself when it reports it has lost quorum. Rows are the inventory;
 * `replicationJobs` null when the Overview read none.
 */
export function getProxmoxAttentionItems(data: {
  rows: Array<ProxmoxResource>;
  replicationJobs?: Array<ProxmoxReplicationJobState> | null | undefined;
  isQuorate?: boolean | null | undefined;
  clusterName?: string | undefined;
  routeFor: ProxmoxRouteFor;
}): Array<ResourceAttentionItem> {
  const items: Array<ResourceAttentionItem> = [];
  const guestsByVmid: Map<string, ProxmoxResource> = new Map();

  if (data.isQuorate === false) {
    items.push({
      key: "cluster",
      kind: KIND_CLUSTER,
      icon: IconProp.ServerStack,
      name: data.clusterName || "",
      severity: ResourceAttentionSeverity.Critical,
      reasons: [{ text: REASON_NOT_QUORATE }],
    });
  }

  for (const row of data.rows) {
    const kind: ProxmoxPartKind | null =
      row.kind === "Node" || row.kind === "Guest" || row.kind === "Storage"
        ? row.kind
        : null;
    if (!kind) {
      continue;
    }
    if (kind === "Guest" && row.vmid !== null && row.vmid !== undefined) {
      guestsByVmid.set(String(row.vmid), row);
    }
    const assessment: ProxmoxAssessment = assessProxmoxResource(row);
    if (!assessment.severity) {
      continue;
    }
    const externalId: string = row.externalId || "";
    items.push({
      key: `${kind}:${externalId}`,
      kind: kindWordOf(kind),
      icon: iconOf(kind),
      name: getProxmoxDisplayName(row),
      /*
       * A guest's id says its VMID ("qemu/104") and a storage's its node
       * ("storage/pve3/local"); a node's only repeats its name.
       */
      detail: kind === "Node" ? undefined : externalId,
      severity: assessment.severity,
      reasons: assessment.reasons,
      route: externalId ? data.routeFor(kind, externalId) : undefined,
    });
  }

  for (const job of data.replicationJobs || []) {
    const failed: number = job.failedSyncs ?? 0;
    if (failed <= 0) {
      continue;
    }
    const guest: ProxmoxResource | undefined = guestsByVmid.get(job.guestVmid);
    items.push({
      key: `Replication:${job.jobId}`,
      kind: KIND_REPLICATION,
      icon: IconProp.ArrowPath,
      name: guest
        ? `${job.jobId} (${getProxmoxDisplayName(guest)})`
        : job.jobId,
      detail: guest?.externalId || undefined,
      severity: ResourceAttentionSeverity.Warning,
      reasons: [
        {
          text: REASON_FAILED_SYNCS.other,
          plural: { one: REASON_FAILED_SYNCS.one, count: failed },
        },
      ],
      route:
        guest?.externalId !== undefined && guest.externalId
          ? data.routeFor("Guest", guest.externalId)
          : undefined,
    });
  }

  return sortResourceAttention(items, PROXMOX_ATTENTION_KIND_ORDER);
}

export function getProxmoxClusterHealth(
  items: Array<ResourceAttentionItem>,
): ResourceHealth {
  return getResourceAttentionHealth(items);
}

/*
 * ---------------------------------------------------------------------------
 * What the Overview's counts open
 * ---------------------------------------------------------------------------
 *
 * The Overview counts what is wrong - nodes offline, HA resources in error
 * or fence, guests whose last backup failed or that no backup job includes
 * - and each count opens exactly those parts, why (the count's own reason
 * first, then whatever else the rules say), which node a guest is on and
 * when its backup failed, each a step from its page (#9594). By the same
 * rules as Needs attention, so a part reads the same in both.
 */
export type ProxmoxProblem =
  | { kind: "nodesOffline" }
  | { kind: "haState"; state: string }
  | { kind: "backupFailed" }
  | { kind: "noBackupJob" }
  /*
   * Guests "8/10 guests running" leaves out that should be running: stopped
   * although they start on boot, or HA gave up on them (error) or cut their
   * node off (fence). A guest someone stopped and left off is not one.
   */
  | { kind: "guestsStopped" };

const FACT_NODE: string = translationKey("Node");
// When a guest's last backup failed: "Failed 2 hours ago".
const SINCE_BACKUP_FAILED: string = translationKey("Failed {{time}}");
/*
 * Why a guest that should run is not running, where the inventory says:
 * the node it is on is offline (the guest went with it).
 */
const REASON_NODE_OFFLINE: string = translationKey("Its node is offline");

function isHaCritical(row: ProxmoxResource): boolean {
  return Boolean(row.haState && HA_CRITICAL_STATES.has(row.haState));
}

/*
 * Whether a row is one the count counts - the very test the Overview's
 * summary counts it by, so the dialog lists what the number said.
 */
export function isProxmoxProblemRow(
  row: ProxmoxResource,
  problem: ProxmoxProblem,
): boolean {
  switch (problem.kind) {
    case "nodesOffline":
      return row.kind === "Node" && row.isUp === false;
    case "haState":
      return Boolean(row.haState) && row.haState === problem.state;
    case "backupFailed":
      return (
        row.kind === "Guest" &&
        !isProxmoxTemplate(row) &&
        row.lastBackupStatus === "failed"
      );
    case "noBackupJob":
      return (
        row.kind === "Guest" &&
        !isProxmoxTemplate(row) &&
        row.isBackedUp === false
      );
    case "guestsStopped":
      /*
       * Not counted running (isUp true is what "8/10 running" counts), and
       * flagged by the rules for it: stopped though it starts on boot, or
       * in an HA state HA gave up in.
       */
      return (
        row.kind === "Guest" &&
        !isProxmoxTemplate(row) &&
        row.isUp !== true &&
        ((row.onboot === true && row.isUp === false) || isHaCritical(row))
      );
    default:
      return false;
  }
}

function problemReasonOf(
  row: ProxmoxResource,
  problem: ProxmoxProblem,
): ResourceAttentionText {
  switch (problem.kind) {
    case "nodesOffline":
      return { text: REASON_OFFLINE };
    case "haState":
      return { text: REASON_HA_STATE, values: { state: row.haState || "" } };
    case "backupFailed":
      return { text: REASON_BACKUP_FAILED };
    case "guestsStopped":
      // HA's verdict says more than the stop it led to.
      return isHaCritical(row)
        ? { text: REASON_HA_STATE, values: { state: row.haState || "" } }
        : { text: REASON_STOPPED_ON_BOOT };
    case "noBackupJob":
    default:
      return { text: REASON_NO_BACKUP_JOB };
  }
}

/*
 * Why a guest that should run is not, where the inventory can tell: its
 * node is offline, or a task holds it (a backup that stops it while it
 * runs, a migration) in Proxmox's lock, worded as the guest's page words it.
 */
function guestStoppedCauses(
  row: ProxmoxResource,
  nodesByName: Map<string, ProxmoxResource>,
): Array<ResourceAttentionText> {
  const causes: Array<ResourceAttentionText> = [];
  const node: ProxmoxResource | undefined = row.parentNodeName
    ? nodesByName.get(row.parentNodeName)
    : undefined;
  if (node && node.isUp === false) {
    causes.push({ text: REASON_NODE_OFFLINE });
  }
  const lock: ResourcePartBadge | null = getProxmoxLockBadge(row.lockState);
  if (lock) {
    causes.push(
      lock.values
        ? { text: lock.label, values: lock.values }
        : { text: lock.label },
    );
  }
  return causes;
}

/*
 * ---------------------------------------------------------------------------
 * Who or what stopped a guest that should be running, and when (#10017)
 * ---------------------------------------------------------------------------
 *
 * From the guest's last power task in the cluster's task log - the last
 * task that started, stopped, shut down, hibernated or restored it - as the
 * Proxmox AI agent reads it for each stopped guest every few minutes
 * (Common/Utils/Proxmox/ProxmoxGuestPowerTask) and the ingest keeps it on
 * the guest's row (ProxmoxResource.lastPowerTask*), cleared once a scrape
 * sees the guest running. A reading more than a day old is left out: the
 * agent reads far more often, so one that old means it stopped reading, and
 * a later task may say otherwise.
 */
export const PROXMOX_POWER_TASK_STALE_MS: number = 24 * 60 * 60 * 1000;

const SINCE_STOPPED_BY: string = translationKey("Stopped by {{user}} {{time}}");
const SINCE_SHUT_DOWN_BY: string = translationKey(
  "Shut down by {{user}} {{time}}",
);
const SINCE_STOPPED_THROUGH_HA_BY: string = translationKey(
  "Stopped through HA by {{user}} {{time}}",
);
const SINCE_HIBERNATED_BY: string = translationKey(
  "Hibernated by {{user}} {{time}}",
);
const SINCE_RESTORED_BY: string = translationKey(
  "Restored from a backup by {{user}} {{time}}",
);
const SINCE_START_FAILED: string = translationKey("Last start failed {{time}}");
const SINCE_LAST_STARTED: string = translationKey("Last started {{time}}");

/*
 * Its last start went well and no task stopped it after: Proxmox did not
 * stop it. Someone shut it down from inside, or it crashed (its process
 * died, or the host's OOM killer took it).
 */
const EXPLANATION_STOPPED_WITHOUT_TASK: string = translationKey(
  "No Proxmox task stopped it since it last started: it was shut down from inside, or it crashed.",
);

/*
 * What HA's state means, as Proxmox VE's HA manager documents it: in error,
 * HA tried to start or move it and gave up, and only someone disabling it,
 * fixing the cause and starting it again brings it back; in fence, its node
 * is outside the quorate part of the cluster, and HA recovers it on another
 * node once that node is fenced.
 */
const EXPLANATION_HA_ERROR: string = translationKey(
  "HA could not start it and stopped trying. Set its HA state to disabled, fix what keeps it from starting, then set it to started.",
);
const EXPLANATION_HA_FENCE: string = translationKey(
  "Its node is outside the quorate part of the cluster. Once that node is fenced, HA starts it on another node.",
);

export interface ProxmoxGuestStopFacts {
  // "Stopped by alice@pve 2 hours ago", "Last start failed 10 minutes ago".
  since: ResourceAttentionSince | null;
  // A whole sentence, in English: looked up where it is drawn.
  explanation: string | null;
  // Proxmox's own words for why its last start failed, as it wrote them.
  message: string | null;
}

function dateOf(value: Date | string | undefined | null): Date | null {
  if (!value) {
    return null;
  }
  const date: Date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/*
 * What the task log says about a stopped guest: who or what stopped it and
 * when, or that its last start failed and why, or that nothing in Proxmox
 * stopped it. Null for a guest that runs, one the agent has not read (or
 * not for a day), or a task this does not word.
 */
export function getProxmoxGuestStopFacts(
  row: ProxmoxResource,
  now: Date,
): ProxmoxGuestStopFacts | null {
  if (row.kind !== "Guest" || row.isUp === true || !row.lastPowerTaskType) {
    return null;
  }
  const at: Date | null = dateOf(row.lastPowerTaskAt);
  const readAt: Date | null = dateOf(row.powerTaskReadAt);
  if (
    !at ||
    !readAt ||
    now.getTime() - readAt.getTime() > PROXMOX_POWER_TASK_STALE_MS
  ) {
    return null;
  }

  const user: string = (row.lastPowerTaskUser || "").trim();
  const byUser: (template: string) => ProxmoxGuestStopFacts | null = (
    template: string,
  ): ProxmoxGuestStopFacts | null => {
    return user
      ? {
          since: { at: at, template: template, values: { user: user } },
          explanation: null,
          message: null,
        }
      : null;
  };

  switch (
    getProxmoxGuestStopCause({
      type: row.lastPowerTaskType,
      status: row.lastPowerTaskStatus || "",
    })
  ) {
    case ProxmoxGuestStopCause.StoppedBy:
      return byUser(SINCE_STOPPED_BY);
    case ProxmoxGuestStopCause.ShutDownBy:
      return byUser(SINCE_SHUT_DOWN_BY);
    case ProxmoxGuestStopCause.StoppedThroughHaBy:
      return byUser(SINCE_STOPPED_THROUGH_HA_BY);
    case ProxmoxGuestStopCause.HibernatedBy:
      return byUser(SINCE_HIBERNATED_BY);
    case ProxmoxGuestStopCause.RestoredBy:
      return byUser(SINCE_RESTORED_BY);
    case ProxmoxGuestStopCause.StartFailed:
      return {
        since: { at: at, template: SINCE_START_FAILED },
        explanation: null,
        message: (row.lastPowerTaskStatus || "").trim() || null,
      };
    case ProxmoxGuestStopCause.StoppedWithoutTask:
      return {
        since: { at: at, template: SINCE_LAST_STARTED },
        explanation: EXPLANATION_STOPPED_WITHOUT_TASK,
        message: null,
      };
    default:
      return null;
  }
}

// What HA's error or fence state means for a guest, in English.
function haExplanationOf(row: ProxmoxResource): string | null {
  if (row.kind !== "Guest") {
    return null;
  }
  if (row.haState === "error") {
    return EXPLANATION_HA_ERROR;
  }
  if (row.haState === "fence") {
    return EXPLANATION_HA_FENCE;
  }
  return null;
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

export function getProxmoxProblemItems(data: {
  rows: Array<ProxmoxResource>;
  problem: ProxmoxProblem;
  routeFor: ProxmoxRouteFor;
  now: Date;
  // A row older than this has stopped being reported: when it last was says so.
  staleMs: number;
  /*
   * Words a row's explanation in the reader's language - what HA's state
   * means, that nothing in Proxmox stopped a guest. A list that draws no
   * explanation (the Backups card's) leaves it out.
   */
  translator?: Translator | undefined;
}): Array<ResourceAttentionItem> {
  const nodesByName: Map<string, ProxmoxResource> = new Map();
  for (const row of data.rows) {
    if (row.kind === "Node" && row.name) {
      nodesByName.set(row.name, row);
    }
  }

  const items: Array<ResourceAttentionItem> = [];

  for (const row of data.rows) {
    const kind: ProxmoxPartKind | null =
      row.kind === "Node" || row.kind === "Guest" || row.kind === "Storage"
        ? row.kind
        : null;
    if (!kind || !isProxmoxProblemRow(row, data.problem)) {
      continue;
    }

    const assessment: ProxmoxAssessment = assessProxmoxResource(row);
    const first: ResourceAttentionText = problemReasonOf(row, data.problem);
    const externalId: string = row.externalId || "";
    // Why a guest that should run is not, right after the count's reason.
    const causes: Array<ResourceAttentionText> =
      data.problem.kind === "guestsStopped"
        ? guestStoppedCauses(row, nodesByName)
        : [];

    const item: ResourceAttentionItem = {
      key: `${kind}:${externalId}`,
      kind: kindWordOf(kind),
      icon: iconOf(kind),
      name: getProxmoxDisplayName(row),
      detail: kind === "Node" ? undefined : externalId,
      severity: assessment.severity || ResourceAttentionSeverity.Warning,
      // The count's own reason first, then the rest of what the rules say.
      reasons: [
        first,
        ...causes,
        ...assessment.reasons.filter((reason: ResourceAttentionText) => {
          return !sameReason(reason, first);
        }),
      ],
      route: externalId ? data.routeFor(kind, externalId) : undefined,
    };

    // Which node a guest runs on, a step from the node's page.
    if (kind === "Guest" && row.parentNodeName) {
      const node: ProxmoxResource | undefined = nodesByName.get(
        row.parentNodeName,
      );
      item.facts = [
        {
          key: "node",
          label: FACT_NODE,
          value: row.parentNodeName,
          route: node?.externalId
            ? data.routeFor("Node", node.externalId)
            : undefined,
        },
      ];
    }

    if (data.problem.kind === "backupFailed" && row.lastBackupAt) {
      const failedAt: Date = new Date(row.lastBackupAt);
      if (Number.isFinite(failedAt.getTime())) {
        item.since = { at: failedAt, template: SINCE_BACKUP_FAILED };
      }
    }

    /*
     * A guest that should be running, or one HA gave up on: who or what
     * stopped it and when, from its task log (#10017), and what HA's state
     * means and what to do.
     */
    if (
      kind === "Guest" &&
      (data.problem.kind === "guestsStopped" ||
        (data.problem.kind === "haState" && isHaCritical(row)))
    ) {
      const facts: ProxmoxGuestStopFacts | null = getProxmoxGuestStopFacts(
        row,
        data.now,
      );
      if (facts?.since) {
        item.since = facts.since;
      }
      if (facts?.message) {
        item.message = facts.message;
      }
      const explanation: string | null =
        haExplanationOf(row) || facts?.explanation || null;
      if (explanation && data.translator) {
        item.explanation =
          data.translator.translateText(explanation) || explanation;
      }
    }

    /*
     * A node that has stopped being reported says when it last was; one
     * its siblings still report as down is reported now, which says
     * nothing.
     */
    if (data.problem.kind === "nodesOffline" && row.lastSeenAt) {
      const seenAt: Date = new Date(row.lastSeenAt);
      if (
        Number.isFinite(seenAt.getTime()) &&
        data.now.getTime() - seenAt.getTime() > data.staleMs
      ) {
        item.lastReportAt = seenAt;
      }
    }

    items.push(item);
  }

  return sortResourceAttention(items, PROXMOX_ATTENTION_KIND_ORDER);
}

/*
 * ---------------------------------------------------------------------------
 * Which part an open incident or alert is about
 * ---------------------------------------------------------------------------
 *
 * The shipped templates group by pve-exporter's `id` label ("node/pve1",
 * "qemu/100", "lxc/101", "storage/pve1/local"); a person's own monitor may
 * group by `pve.id` or the node and vmid labels instead. Replication jobs'
 * ids ("100-0") name no part.
 */
export interface ProxmoxIssueTarget {
  kind: ProxmoxPartKind;
  // "node/pve1", "qemu/100" (the guest's type may be unknown: vmid alone).
  externalId: string | null;
  vmid: string | null;
  nodeName: string | null;
}

function readLabel(labels: JSONObject | null, key: string): string | null {
  if (!labels) {
    return null;
  }
  for (const candidate of [key, `resource.${key}`]) {
    const value: unknown = (labels as Record<string, unknown>)[candidate];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

export function getProxmoxIssueTarget(
  record: Pick<OpenIssueRecord, "seriesLabels">,
): ProxmoxIssueTarget | null {
  const labels: JSONObject | null = record.seriesLabels;
  const objectId: string = readLabel(labels, "id") || "";
  const slashIndex: number = objectId.indexOf("/");

  if (slashIndex > 0) {
    const type: string = objectId.substring(0, slashIndex);
    const rest: string = objectId.substring(slashIndex + 1);
    if (type === "node" && rest) {
      return {
        kind: "Node",
        externalId: objectId,
        vmid: null,
        nodeName: rest,
      };
    }
    if ((type === "qemu" || type === "lxc") && rest) {
      return {
        kind: "Guest",
        externalId: objectId,
        vmid: rest,
        nodeName: null,
      };
    }
    if (type === "storage" && rest) {
      return {
        kind: "Storage",
        externalId: objectId,
        vmid: null,
        nodeName: rest.includes("/")
          ? rest.substring(0, rest.indexOf("/"))
          : null,
      };
    }
  }

  const vmid: string | null = readLabel(labels, "vmid");
  if (vmid) {
    return { kind: "Guest", externalId: null, vmid: vmid, nodeName: null };
  }

  const node: string | null =
    readLabel(labels, "proxmox.node.name") || readLabel(labels, "node");
  if (node) {
    return {
      kind: "Node",
      externalId: `node/${node}`,
      vmid: null,
      nodeName: node,
    };
  }

  return null;
}

// Whether an open record is about this part (a node, guest or storage row).
export function isProxmoxIssueAbout(
  record: Pick<OpenIssueRecord, "seriesLabels">,
  row: Pick<ProxmoxResource, "kind" | "externalId" | "vmid" | "name">,
): boolean {
  const target: ProxmoxIssueTarget | null = getProxmoxIssueTarget(record);
  if (!target || target.kind !== row.kind) {
    return false;
  }
  if (target.kind === "Guest") {
    if (target.externalId && row.externalId) {
      return target.externalId === row.externalId;
    }
    return (
      target.vmid !== null &&
      row.vmid !== null &&
      row.vmid !== undefined &&
      target.vmid === String(row.vmid)
    );
  }
  if (target.kind === "Node") {
    const nodeName: string = (row.externalId || "").startsWith("node/")
      ? (row.externalId || "").substring("node/".length)
      : row.name || "";
    return (
      target.nodeName !== null &&
      target.nodeName.toLowerCase() === nodeName.toLowerCase()
    );
  }
  return target.externalId !== null && target.externalId === row.externalId;
}
