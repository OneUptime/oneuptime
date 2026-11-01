import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
import {
  PROXMOX_BACKUP_JOB_FAILED_TEMPLATE_ID,
  PROXMOX_NODE_FENCED_TEMPLATE_ID,
} from "Common/Types/Monitor/ProxmoxNotificationAlertTemplates";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourcePartBadge,
  ResourcePartStatus,
  ResourcePartTone,
} from "../../../Components/ResourcePart/ResourcePartTypes";
import { isProxmoxTemplate } from "./ProxmoxHealth";

/*
 * WHAT A PROXMOX VE NODE, GUEST OR STORAGE IS, IN THE WORDS ITS PAGES USE.
 *
 * The status a part's page and the lists show, its badges (HA, a lock, a
 * template), its tags, a guest's kind ("VM", "Container"), a guest's last
 * backup, a cluster's guests and backups counted, and the parts on a node.
 * ProxmoxHealth says what needs attention; this says what a part is.
 *
 * Words are English, marked with translationKey() and looked up in the
 * reader's language where they are drawn. React-free, so App tests can
 * read it.
 */

const STATUS_ONLINE: string = translationKey("Online");
const STATUS_OFFLINE: string = translationKey("Offline");
const STATUS_RUNNING: string = translationKey("Running");
const STATUS_STOPPED: string = translationKey("Stopped");
const STATUS_TEMPLATE: string = translationKey("Template");
const STATUS_AVAILABLE: string = translationKey("Available");
const STATUS_UNAVAILABLE: string = translationKey("Unavailable");

const GUEST_KIND_VM: string = translationKey("VM");
const GUEST_KIND_CONTAINER: string = translationKey("Container");

// A node's pve externalId is "node/<name>".
export const PROXMOX_NODE_ID_PREFIX: string = "node/";

/*
 * The recommended alerts that watch each kind of part, in the order a
 * part's Alerts card lists them. Each is one monitor on the cluster that
 * fires for any part that crosses it (ResourcePartAlertsCard).
 */
export const PROXMOX_NODE_ALERT_TEMPLATE_IDS: Array<string> = [
  "pve-node-offline",
  "pve-node-restarted",
  "pve-node-high-cpu",
  "pve-node-high-memory",
  PROXMOX_NODE_FENCED_TEMPLATE_ID,
];

export const PROXMOX_STORAGE_ALERT_TEMPLATE_IDS: Array<string> = [
  "pve-storage-unavailable",
  "pve-storage-near-full",
];

// A container's alerts add its root disk; a VM reports no disk use to watch.
export function getProxmoxGuestAlertTemplateIds(
  row: Pick<ProxmoxResource, "guestType"> | null,
): Array<string> {
  return [
    "pve-guest-down",
    "pve-guest-high-cpu",
    ...(row?.guestType === "lxc" ? ["pve-lxc-disk-near-full"] : []),
    "pve-ha-state-error",
    "pve-guest-not-backed-up",
    PROXMOX_BACKUP_JOB_FAILED_TEMPLATE_ID,
    "pve-backup-running-too-long",
    "pve-replication-failing",
  ];
}

// A number from a column that may be null, a string (a bigint) or garbage.
export function toProxmoxNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number: number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// A date from a column that may be null or an ISO string off the wire.
export function toProxmoxDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

// "pve1" from a node's row or its id ("node/pve1"); its name otherwise.
export function getProxmoxNodeName(
  row: Pick<ProxmoxResource, "externalId" | "name"> | null,
  externalId?: string | undefined,
): string {
  const id: string = row?.externalId || externalId || "";
  if (id.startsWith(PROXMOX_NODE_ID_PREFIX)) {
    return id.substring(PROXMOX_NODE_ID_PREFIX.length);
  }
  return row?.name || "";
}

/*
 * The status a part shows, or null before Proxmox reported one. A
 * template never runs, so it is a Template, not Stopped; a stopped guest
 * is not an error unless it starts on boot.
 */
export function getProxmoxPartStatus(
  row: ProxmoxResource,
): ResourcePartStatus | null {
  if (isProxmoxTemplate(row)) {
    return { label: STATUS_TEMPLATE, tone: "neutral" };
  }
  if (row.isUp === null || row.isUp === undefined) {
    return null;
  }
  if (row.kind === "Node") {
    return row.isUp
      ? { label: STATUS_ONLINE, tone: "positive" }
      : { label: STATUS_OFFLINE, tone: "danger" };
  }
  if (row.kind === "Storage") {
    return row.isUp
      ? { label: STATUS_AVAILABLE, tone: "positive" }
      : { label: STATUS_UNAVAILABLE, tone: "danger" };
  }
  if (row.isUp) {
    return { label: STATUS_RUNNING, tone: "positive" };
  }
  return {
    label: STATUS_STOPPED,
    tone: row.onboot === true ? "warning" : "neutral",
  };
}

// "VM" for a QEMU guest, "Container" for an LXC one, "" when unknown.
export function getProxmoxGuestKind(
  row: Pick<ProxmoxResource, "guestType" | "externalId">,
): string {
  const type: string =
    row.guestType ||
    (row.externalId || "").substring(0, (row.externalId || "").indexOf("/"));
  if (type === "qemu") {
    return GUEST_KIND_VM;
  }
  if (type === "lxc") {
    return GUEST_KIND_CONTAINER;
  }
  return "";
}

/*
 * The tags a guest carries, as Proxmox VE writes them: ";"-separated in its
 * configuration (a "," or a space is accepted on input). Each once, in
 * order.
 */
export const PROXMOX_MAX_TAGS: number = 20;

export function parseProxmoxTags(
  tags: string | null | undefined,
): Array<string> {
  if (!tags) {
    return [];
  }
  const seen: Set<string> = new Set();
  const result: Array<string> = [];
  for (const piece of tags.split(/[;,\s]+/)) {
    const tag: string = piece.trim();
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    result.push(tag);
    if (result.length >= PROXMOX_MAX_TAGS) {
      break;
    }
  }
  return result;
}

/*
 * What a lock on a guest means, as a badge: Proxmox VE locks a guest while
 * a task changes it - a backup every night, a migration, a snapshot. A lock
 * is a state, not a problem (Backup Running Too Long says when one is
 * stuck), so the badge is neutral.
 */
const LOCK_WORDS: Record<string, string> = {
  backup: translationKey("Backup running"),
  clone: translationKey("Cloning"),
  create: translationKey("Being created"),
  migrate: translationKey("Migrating"),
  rollback: translationKey("Rolling back"),
  snapshot: translationKey("Taking a snapshot"),
  "snapshot-delete": translationKey("Deleting a snapshot"),
  suspended: translationKey("Suspended"),
  suspending: translationKey("Suspending"),
};

const LOCK_OTHER: string = translationKey("Locked: {{lock}}");
const HA_BADGE: string = translationKey("HA: {{state}}");
const HA_PROBLEM_STATES: ReadonlySet<string> = new Set(["error", "fence"]);
const HA_NORMAL_STATES: ReadonlySet<string> = new Set(["started", "online"]);

export function getProxmoxLockBadge(
  lockState: string | null | undefined,
): ResourcePartBadge | null {
  const lock: string = (lockState || "").trim();
  if (!lock) {
    return null;
  }
  const word: string | undefined = LOCK_WORDS[lock];
  return word
    ? { key: "lock", label: word, tone: "neutral" }
    : {
        key: "lock",
        label: LOCK_OTHER,
        values: { lock: lock },
        tone: "neutral",
      };
}

export function getProxmoxHaBadge(
  haState: string | null | undefined,
): ResourcePartBadge | null {
  const state: string = (haState || "").trim();
  if (!state) {
    return null;
  }
  const tone: ResourcePartTone = HA_PROBLEM_STATES.has(state)
    ? "danger"
    : HA_NORMAL_STATES.has(state)
      ? "positive"
      : "neutral";
  return { key: "ha", label: HA_BADGE, values: { state: state }, tone: tone };
}

/*
 * A storage's type as Proxmox VE's own UI names it ("zfspool" is ZFS), and
 * what it may hold. Unknown types stay as Proxmox reports them.
 */
const STORAGE_TYPE_LABELS: Record<string, string> = {
  btrfs: "BTRFS",
  cephfs: "CephFS",
  cifs: "SMB/CIFS",
  dir: translationKey("Directory"),
  esxi: "ESXi",
  glusterfs: "GlusterFS",
  iscsi: "iSCSI",
  iscsidirect: "iSCSI (direct)",
  lvm: "LVM",
  lvmthin: "LVM-Thin",
  nfs: "NFS",
  pbs: "Proxmox Backup Server",
  rbd: "RBD (Ceph)",
  zfs: "ZFS over iSCSI",
  zfspool: "ZFS",
};

export function getProxmoxStorageTypeLabel(
  storageType: string | null | undefined,
): string {
  const type: string = (storageType || "").trim();
  return STORAGE_TYPE_LABELS[type] || type;
}

const STORAGE_CONTENT_WORDS: Record<string, string> = {
  images: translationKey("Disk images"),
  rootdir: translationKey("Container disks"),
  iso: translationKey("ISO images"),
  vztmpl: translationKey("Container templates"),
  backup: translationKey("Backups"),
  snippets: translationKey("Snippets"),
  import: translationKey("Imports"),
};

// "images,rootdir" -> ["Disk images", "Container disks"], each once, in order.
export function getProxmoxStorageContentWords(
  content: string | null | undefined,
): Array<string> {
  const words: Array<string> = [];
  for (const piece of (content || "").split(",")) {
    const key: string = piece.trim();
    if (!key) {
      continue;
    }
    const word: string = STORAGE_CONTENT_WORDS[key] || key;
    if (!words.includes(word)) {
      words.push(word);
    }
  }
  return words;
}

/*
 * ---------------------------------------------------------------------------
 * A guest's backups
 * ---------------------------------------------------------------------------
 *
 * Two sources, which say different things: the exporter says whether a
 * backup job includes the guest (isBackedUp), and Proxmox VE's own
 * notifications say how each backup went (lastBackup*), once the cluster
 * sends them (Common/Utils/Proxmox/ProxmoxNotifications).
 */
export type ProxmoxBackupState =
  // Its last backup failed.
  | "failed"
  // Its last backup succeeded.
  | "ok"
  // A job includes it, and no result has arrived yet.
  | "no-result"
  // No backup job includes it.
  | "not-in-job"
  // Nothing reported either way.
  | "unknown";

export interface ProxmoxGuestBackup {
  state: ProxmoxBackupState;
  // Whether a backup job includes it; null before the exporter said.
  isInJob: boolean | null;
  lastBackupAt: Date | null;
  lastSuccessfulBackupAt: Date | null;
  bytes: number | null;
  durationSeconds: number | null;
}

export function getProxmoxGuestBackup(
  row: ProxmoxResource,
): ProxmoxGuestBackup {
  const isInJob: boolean | null =
    row.isBackedUp === null || row.isBackedUp === undefined
      ? null
      : row.isBackedUp === true;

  let state: ProxmoxBackupState = "unknown";
  if (row.lastBackupStatus === "failed") {
    state = "failed";
  } else if (row.lastBackupStatus === "ok") {
    state = "ok";
  } else if (isInJob === true) {
    state = "no-result";
  } else if (isInJob === false) {
    state = "not-in-job";
  }

  return {
    state: state,
    isInJob: isInJob,
    lastBackupAt: toProxmoxDate(row.lastBackupAt),
    lastSuccessfulBackupAt: toProxmoxDate(row.lastSuccessfulBackupAt),
    bytes: toProxmoxNumber(row.lastBackupBytes),
    durationSeconds: toProxmoxNumber(row.lastBackupDurationSeconds),
  };
}

export interface ProxmoxBackupSummary {
  // Guests, templates left out: a template is backed up like any guest, but never runs.
  guests: number;
  // Guests the exporter said something about, and how many a job includes.
  coverageKnown: number;
  inJob: number;
  notInJob: number;
  // Guests with a backup result from the notifications.
  withResult: number;
  ok: number;
  failed: number;
  // The newest backup any guest had, whatever its result.
  newestBackupAt: Date | null;
}

export function summarizeProxmoxBackups(
  rows: Array<ProxmoxResource>,
): ProxmoxBackupSummary {
  const summary: ProxmoxBackupSummary = {
    guests: 0,
    coverageKnown: 0,
    inJob: 0,
    notInJob: 0,
    withResult: 0,
    ok: 0,
    failed: 0,
    newestBackupAt: null,
  };

  for (const row of rows) {
    if (row.kind !== "Guest" || isProxmoxTemplate(row)) {
      continue;
    }
    summary.guests++;
    const backup: ProxmoxGuestBackup = getProxmoxGuestBackup(row);
    if (backup.isInJob !== null) {
      summary.coverageKnown++;
      if (backup.isInJob) {
        summary.inJob++;
      } else {
        summary.notInJob++;
      }
    }
    if (backup.state === "ok" || backup.state === "failed") {
      summary.withResult++;
      if (backup.state === "ok") {
        summary.ok++;
      } else {
        summary.failed++;
      }
    }
    if (
      backup.lastBackupAt &&
      (!summary.newestBackupAt ||
        backup.lastBackupAt.getTime() > summary.newestBackupAt.getTime())
    ) {
      summary.newestBackupAt = backup.lastBackupAt;
    }
  }

  return summary;
}

/*
 * ---------------------------------------------------------------------------
 * Guests counted, and the parts on one node
 * ---------------------------------------------------------------------------
 */
export interface ProxmoxGuestSummary {
  // Guests that can run: templates left out.
  total: number;
  running: number;
  stopped: number;
  templates: number;
  vms: number;
  containers: number;
}

export function summarizeProxmoxGuests(
  rows: Array<ProxmoxResource>,
): ProxmoxGuestSummary {
  const summary: ProxmoxGuestSummary = {
    total: 0,
    running: 0,
    stopped: 0,
    templates: 0,
    vms: 0,
    containers: 0,
  };
  for (const row of rows) {
    if (row.kind !== "Guest") {
      continue;
    }
    if (isProxmoxTemplate(row)) {
      summary.templates++;
      continue;
    }
    summary.total++;
    if (row.isUp === true) {
      summary.running++;
    } else if (row.isUp === false) {
      summary.stopped++;
    }
    const kind: string = getProxmoxGuestKind(row);
    if (kind === GUEST_KIND_VM) {
      summary.vms++;
    } else if (kind === GUEST_KIND_CONTAINER) {
      summary.containers++;
    }
  }
  return summary;
}

// The guests and storage a node reports (storage shared by nodes is listed per node).
export function getProxmoxRowsOnNode(
  rows: Array<ProxmoxResource>,
  nodeName: string,
): { guests: Array<ProxmoxResource>; storage: Array<ProxmoxResource> } {
  const guests: Array<ProxmoxResource> = [];
  const storage: Array<ProxmoxResource> = [];
  if (!nodeName) {
    return { guests: guests, storage: storage };
  }
  for (const row of rows) {
    if (row.parentNodeName !== nodeName) {
      continue;
    }
    if (row.kind === "Guest") {
      guests.push(row);
    } else if (row.kind === "Storage") {
      storage.push(row);
    }
  }
  return { guests: guests, storage: storage };
}

/*
 * Guests as people number them: by VMID, then by name. The inventory
 * sorts by id ("lxc/101" before "qemu/100"), which reads as no order at all.
 */
export function sortProxmoxGuests(
  rows: Array<ProxmoxResource>,
): Array<ProxmoxResource> {
  return [...rows].sort((a: ProxmoxResource, b: ProxmoxResource): number => {
    const aId: number | null = toProxmoxNumber(a.vmid);
    const bId: number | null = toProxmoxNumber(b.vmid);
    if (aId !== null && bId !== null && aId !== bId) {
      return aId - bId;
    }
    if (aId === null && bId !== null) {
      return 1;
    }
    if (aId !== null && bId === null) {
      return -1;
    }
    return (a.name || a.externalId || "").localeCompare(
      b.name || b.externalId || "",
      undefined,
      { numeric: true, sensitivity: "base" },
    );
  });
}

/*
 * A running guest's latest CPU and memory, or null for each when it has not
 * reported within `staleMs` (a list must not rank a guest by a reading from
 * an hour ago).
 */
export interface ProxmoxBusyGuest {
  row: ProxmoxResource;
  cpuPercent: number | null;
  memoryPercent: number | null;
  memoryBytes: number | null;
}

export function getProxmoxBusiestGuests(data: {
  rows: Array<ProxmoxResource>;
  now: Date;
  staleMs: number;
  limit: number;
}): Array<ProxmoxBusyGuest> {
  const busy: Array<ProxmoxBusyGuest> = [];
  for (const row of data.rows) {
    if (row.kind !== "Guest" || isProxmoxTemplate(row) || row.isUp !== true) {
      continue;
    }
    const updatedAt: Date | null = toProxmoxDate(row.metricsUpdatedAt);
    if (!updatedAt || data.now.getTime() - updatedAt.getTime() > data.staleMs) {
      continue;
    }
    busy.push({
      row: row,
      cpuPercent: toProxmoxNumber(row.latestCpuPercent),
      memoryPercent: toProxmoxNumber(row.latestMemoryPercent),
      memoryBytes: toProxmoxNumber(row.latestMemoryBytes),
    });
  }
  return busy
    .sort((a: ProxmoxBusyGuest, b: ProxmoxBusyGuest): number => {
      const cpu: number = (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1);
      if (cpu !== 0) {
        return cpu;
      }
      return (b.memoryPercent ?? -1) - (a.memoryPercent ?? -1);
    })
    .slice(0, data.limit);
}

// How long a task took: "45s", "3m 32s", "1h 5m". Empty for no reading.
export function formatProxmoxDuration(
  seconds: number | null | undefined,
): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return "";
  }
  const whole: number = Math.max(0, Math.round(seconds));
  if (whole < 60) {
    return `${whole}s`;
  }
  const hours: number = Math.floor(whole / 3600);
  const minutes: number = Math.floor((whole % 3600) / 60);
  const rest: number = whole % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${rest}s`;
}

// The share of a part's memory in use, from its row, or null.
export function getProxmoxMemoryPercent(row: ProxmoxResource): number | null {
  const percent: number | null = toProxmoxNumber(row.latestMemoryPercent);
  if (percent !== null) {
    return percent;
  }
  const used: number | null = toProxmoxNumber(row.latestMemoryBytes);
  const total: number | null = toProxmoxNumber(row.maxMemoryBytes);
  if (used === null || total === null || total <= 0) {
    return null;
  }
  return (used / total) * 100;
}

// The share of a part's disk in use (a node's root disk, a container's), or null.
export function getProxmoxDiskPercent(row: ProxmoxResource): number | null {
  const used: number | null = toProxmoxNumber(row.latestDiskBytes);
  const total: number | null = toProxmoxNumber(row.maxDiskBytes);
  if (used === null || total === null || total <= 0) {
    return null;
  }
  return (used / total) * 100;
}
