import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
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
import { OpenIssueRecord } from "../../../Components/ResourceTopology/ResourceTopologyIssues";

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
 *     longer available, or more than 95% full; the cluster not quorate.
 *   Warning - needs a look soon:
 *     a guest stopped although it starts on boot; a guest in no backup job;
 *     a guest whose last backup failed; a storage more than 85% full; a
 *     replication job failing.
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

function haReason(row: ProxmoxResource): ResourceAttentionText | null {
  if (row.haState && HA_CRITICAL_STATES.has(row.haState)) {
    return { text: REASON_HA_STATE, values: { state: row.haState } };
  }
  return null;
}

export function assessProxmoxNode(row: ProxmoxResource): ProxmoxAssessment {
  const reasons: Array<ResourceAttentionText> = [];
  if (row.isUp === false) {
    reasons.push({ text: REASON_OFFLINE });
  }
  const ha: ResourceAttentionText | null = haReason(row);
  if (ha) {
    reasons.push(ha);
  }
  return {
    severity: reasons.length > 0 ? ResourceAttentionSeverity.Critical : null,
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
