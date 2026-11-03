import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import StorageSystem from "Common/Types/StorageArray/StorageSystem";
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
import {
  OpenIssueRecord,
  readSeriesLabel,
  sameName,
} from "../../../Components/ResourceTopology/ResourceTopologyIssues";
import { ResourceTopologyHealth } from "../../../Components/ResourceTopology/ResourceTopologyModel";

/*
 * WHAT ON A STORAGE ARRAY NEEDS SOMEONE, AND HOW BAD IT IS.
 *
 * One set of rules for every page that says it: the array's Overview (its
 * health pill and Needs attention card), a volume's, a host's, a file
 * system's and a bucket's own page, the Hosts, Replication and File Systems
 * lists and the Topology. They read what the Pure Storage exporters report:
 * the inventory the ingest keeps (StorageArrayResource - each part's status
 * as the array writes it, a host's connectivity, a pod's replication lag),
 * the array's own snapshot (StorageArray - its open alert counts and how
 * full it is) and, where the inventory has no column for it, the latest
 * reading of the array's latency and of each FlashBlade file system's
 * available space.
 *
 *   Critical - broken, or about to be:
 *     an alert the array raised itself with critical severity; the array
 *     past 90% of its usable capacity (close to refusing writes); a hardware
 *     component, drive, controller or network interface the array reports
 *     critical, failed, missing or unhealthy (redundancy is gone until it is
 *     replaced), or a pod whose replica link it reports unhealthy.
 *   Warning - needs a look soon:
 *     an alert the array raised with warning severity; the array past 80%
 *     of its usable capacity; its average read or write latency past 5 ms
 *     (a FlashArray) or its read latency past 10 ms (a FlashBlade); a part
 *     the array reports degraded, unknown, unrecognized or not ready; a host
 *     that no longer reaches the array through both controllers; a pod whose
 *     replica link is more than a minute behind; a FlashBlade file system
 *     with less than 10% of its provisioned size left.
 *
 * Every line is the one its alert template fires at
 * (Common/Types/Monitor/StorageArrayAlertTemplates): Critical and Warning
 * Array Alert, Capacity Above 80% and 90%, High Read and Write Latency,
 * Hardware Component Failed and Degraded, Drive Failed, Hardware Component
 * Unhealthy, Host Lost Redundant Paths, Replication Lag Above 1 Minute and
 * File System Near Full. A status the array writes and these rules do not
 * know (a new word in a new Purity release) is shown as the array writes
 * it, in grey: never a problem by itself.
 *
 * A volume, a bucket and a directory have no rule of their own: no template
 * watches one. Whether the array as a whole is slow or full says it.
 *
 * The words are English, marked as keys of the Dashboard's locales and
 * looked up where they are drawn. The array's own words - an alert's
 * summary, a component's name, Single Controller - are shown as the array
 * writes them, in every language.
 *
 * React-free (no Route building: pages hand in routeFor), so App tests can
 * read it.
 */

// The Capacity Above 80% and Capacity Above 90% alerts' lines.
export const STORAGE_ARRAY_CAPACITY_WARNING_PERCENT: number = 80;
export const STORAGE_ARRAY_CAPACITY_CRITICAL_PERCENT: number = 90;

// The FlashArray's High Read and High Write Latency alerts' line (5 ms).
export const FLASHARRAY_LATENCY_WARNING_USEC: number = 5000;

// The FlashBlade's High Read Latency alert's line (10 ms).
export const FLASHBLADE_READ_LATENCY_WARNING_USEC: number = 10000;

// The Replication Lag Above 1 Minute alert's line.
export const STORAGE_ARRAY_REPLICATION_LAG_WARNING_MS: number = 60 * 1000;

/*
 * The File System Near Full alert's line: less than this share of a file
 * system's provisioned size still available.
 */
export const FILE_SYSTEM_NEAR_FULL_AVAILABLE_RATIO: number = 0.1;

/*
 * The statuses the array writes, by what they mean - the same lists the
 * ingest decides the array's own health by
 * (Common/Server/Utils/Telemetry/StorageArraySnapshotScan.ts).
 */
const CRITICAL_STATUSES: ReadonlyArray<string> = [
  "critical",
  "failed",
  "missing",
  "unhealthy",
];
const WARNING_STATUSES: ReadonlyArray<string> = [
  "degraded",
  "unknown",
  "unrecognized",
  "not ready",
];
const HEALTHY_STATUSES: ReadonlyArray<string> = [
  "ok",
  "healthy",
  "ready",
  "enabled",
  "online",
  "replicating",
];

/*
 * The array's status words as each language says them. A word the array
 * writes and this list lacks is drawn as the array writes it - a replica
 * link's Replicating, Baselining or Paused among them, as its tooltip
 * names them.
 */
const STATUS_WORDS: Record<string, string> = {
  ok: translationKey("OK"),
  healthy: translationKey("Healthy"),
  ready: translationKey("Ready"),
  enabled: translationKey("Enabled"),
  online: translationKey("Online"),
  critical: translationKey("Critical"),
  failed: translationKey("Failed"),
  missing: translationKey("Missing"),
  unhealthy: translationKey("Unhealthy"),
  degraded: translationKey("Degraded"),
  unknown: translationKey("Unknown"),
  unrecognized: translationKey("Unrecognized"),
  "not ready": translationKey("Not Ready"),
  not_installed: translationKey("Not Installed"),
  device_off: translationKey("Device Off"),
  identifying: translationKey("Identifying"),
  empty: translationKey("Empty"),
  unused: translationKey("Unused"),
  disabled: translationKey("Disabled"),
};

// Why a part needs attention, by the status the array reports for it.
const STATUS_REASONS: Record<string, string> = {
  critical: translationKey("Reports critical"),
  failed: translationKey("Reports failed"),
  missing: translationKey("Reports missing"),
  unhealthy: translationKey("Reports unhealthy"),
  degraded: translationKey("Reports degraded"),
  unknown: translationKey("Reports unknown"),
  unrecognized: translationKey("Reports unrecognized"),
  "not ready": translationKey("Reports not ready"),
};

// The part kinds the rules read, as the inventory writes them.
export type StorageArrayPartKind =
  | "Volume"
  | "Host"
  | "Pod"
  | "Hardware"
  | "Drive"
  | "Controller"
  | "NetworkInterface"
  | "Directory"
  | "FileSystem"
  | "Bucket";

// The array's own row in Needs attention.
export const STORAGE_ARRAY_ATTENTION_KEY: string = "Array";

export const STORAGE_ARRAY_KIND_ARRAY: string = translationKey("Storage Array");
export const STORAGE_ARRAY_KIND_LABELS: Record<StorageArrayPartKind, string> = {
  Volume: translationKey("Volume"),
  Host: translationKey("Host"),
  Pod: translationKey("Pod"),
  Hardware: translationKey("Hardware Component"),
  Drive: translationKey("Drive"),
  Controller: translationKey("Controller"),
  NetworkInterface: translationKey("Network Interface"),
  Directory: translationKey("Directory"),
  FileSystem: translationKey("File System"),
  Bucket: translationKey("Bucket"),
};

// Needs attention: the array first, then its parts, the hardware first.
export const STORAGE_ARRAY_ATTENTION_KIND_ORDER: Array<string> = [
  STORAGE_ARRAY_KIND_ARRAY,
  STORAGE_ARRAY_KIND_LABELS.Hardware,
  STORAGE_ARRAY_KIND_LABELS.Drive,
  STORAGE_ARRAY_KIND_LABELS.Controller,
  STORAGE_ARRAY_KIND_LABELS.NetworkInterface,
  STORAGE_ARRAY_KIND_LABELS.Host,
  STORAGE_ARRAY_KIND_LABELS.Pod,
  STORAGE_ARRAY_KIND_LABELS.FileSystem,
];

const KIND_ICONS: Record<StorageArrayPartKind, IconProp> = {
  Volume: IconProp.Disc,
  Host: IconProp.Server,
  Pod: IconProp.Refresh,
  Hardware: IconProp.CPUChip,
  Drive: IconProp.Database,
  Controller: IconProp.CPUChip,
  NetworkInterface: IconProp.Signal,
  Directory: IconProp.Folder,
  FileSystem: IconProp.Folder,
  Bucket: IconProp.Cube,
};

// The kinds whose state is the status the array writes for them.
const STATUS_KINDS: ReadonlyArray<string> = [
  "Hardware",
  "Drive",
  "Controller",
  "NetworkInterface",
  "Pod",
];

// The kinds a status of the array's can make a problem of.
export const STORAGE_ARRAY_HARDWARE_KINDS: ReadonlyArray<StorageArrayPartKind> =
  ["Hardware", "Drive", "Controller", "NetworkInterface"];

// Statuses
const STATUS_AVAILABLE: string = translationKey("Available");
const STATUS_NEAR_FULL: string = translationKey("Near full");
const STATUS_HOST_REDUNDANT: string = translationKey("Redundant paths");
const STATUS_HOST_LOST_PATHS: string = translationKey("Lost redundant paths");
const STATUS_AS_WRITTEN: string = "{{status}}";

// Reasons
const REASON_PATHS_SINGLE_CONTROLLER: string = translationKey(
  "Reaches the array through one controller only",
);
const REASON_PATHS_UNEVEN: string = translationKey(
  "Its paths to the two controllers are uneven",
);
const REASON_PATHS_NONE: string = translationKey("No path to the array");
const REASON_PATHS_LOST: string = translationKey(
  "No longer reaches the array through both controllers",
);
const REASON_LAG: string = translationKey("Replication {{lag}} behind");
const REASON_FILE_SYSTEM_FULL: string = translationKey(
  "{{percent}} of its provisioned size used",
);
const REASON_CRITICAL_ALERTS: { one: string; other: string } = {
  one: translationKey("{{count}} critical alert open"),
  other: translationKey("{{count}} critical alerts open"),
};
const REASON_WARNING_ALERTS: { one: string; other: string } = {
  one: translationKey("{{count}} warning alert open"),
  other: translationKey("{{count}} warning alerts open"),
};
const REASON_CAPACITY: string = translationKey(
  "{{percent}} of usable capacity used",
);
const REASON_READ_LATENCY: string = translationKey("Read latency {{latency}}");
const REASON_WRITE_LATENCY: string = translationKey(
  "Write latency {{latency}}",
);

export interface StorageArrayAssessment {
  severity: ResourceAttentionSeverity | null;
  // The part's state in a word, coloured by how it is doing.
  status: ResourcePartStatus;
  // Why it needs attention, most urgent first; empty when it does not.
  reasons: Array<ResourceAttentionText>;
}

/*
 * What the rules read of an inventory row: its kind and status as the
 * array writes them, a host's connectivity details and a pod's lag.
 */
export type StorageArrayPartRow = Pick<
  StorageArrayResource,
  | "kind"
  | "externalId"
  | "name"
  | "status"
  | "statusDetail"
  | "replicationLagMs"
  | "metricsUpdatedAt"
>;

/*
 * What the rules read beside the inventory: a FlashBlade file system's
 * latest available share of its provisioned size (purefb_file_systems_
 * space_bytes, space available_ratio), null where none came.
 */
export interface StorageArrayPartReadings {
  availableRatio?: number | null | undefined;
}

export function toStorageArrayNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStatus(status: string | null | undefined): string {
  return (status || "").trim().toLowerCase();
}

/*
 * A status word as the reader's language says it: the key of a word the
 * rules know, else the array's word made readable ("not_installed" -> "Not
 * Installed"), drawn as written.
 */
export function getStorageArrayStatusWord(status: string | null | undefined): {
  label: string;
  values?: Record<string, string> | undefined;
} {
  const normalized: string = normalizeStatus(status);
  const known: string | undefined = STATUS_WORDS[normalized];
  if (known) {
    return { label: known };
  }
  return {
    label: STATUS_AS_WRITTEN,
    values: { status: formatStorageArrayStatus(normalized) },
  };
}

// "not_installed" -> "Not Installed", "ok" -> "OK".
export function formatStorageArrayStatus(
  status: string | null | undefined,
): string {
  const normalized: string = normalizeStatus(status);
  if (!normalized) {
    return "";
  }
  if (normalized === "ok") {
    return "OK";
  }
  return normalized
    .split(/[\s_-]+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .map((word: string): string => {
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function toneOf(severity: ResourceAttentionSeverity | null): ResourcePartTone {
  if (severity === ResourceAttentionSeverity.Critical) {
    return "danger";
  }
  if (severity === ResourceAttentionSeverity.Warning) {
    return "warning";
  }
  return "positive";
}

// 61000 -> "1 min 1 s", 4200 -> "4.2 s".
export function formatStorageArrayLag(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} ms`;
  }
  const seconds: number = milliseconds / 1000;
  if (seconds < 60) {
    const rounded: number = Math.round(seconds * 10) / 10;
    return `${rounded} s`;
  }
  const minutes: number = Math.floor(seconds / 60);
  const rest: number = Math.round(seconds - minutes * 60);
  return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`;
}

// 5400 -> "5.4 ms", 850 -> "850 µs".
export function formatStorageArrayLatency(usec: number): string {
  if (usec >= 1000) {
    const milliseconds: number = Math.round(usec / 100) / 10;
    return `${milliseconds} ms`;
  }
  return `${Math.round(usec)} µs`;
}

// 92.4 -> "92.4%", 91 -> "91%".
export function formatStorageArrayPercent(percent: number): string {
  const rounded: number = Math.round(percent * 10) / 10;
  return `${rounded}%`;
}

/*
 * A part the array reports a status for: its word, and how bad it is by
 * the lists above.
 */
function assessStatusPart(
  row: StorageArrayPartRow,
): StorageArrayAssessment | null {
  const normalized: string = normalizeStatus(row.status);
  if (!normalized) {
    return null;
  }
  const word: { label: string; values?: Record<string, string> | undefined } =
    getStorageArrayStatusWord(normalized);

  let severity: ResourceAttentionSeverity | null = null;
  let tone: ResourcePartTone = "neutral";
  if (CRITICAL_STATUSES.includes(normalized)) {
    severity = ResourceAttentionSeverity.Critical;
    tone = "danger";
  } else if (WARNING_STATUSES.includes(normalized)) {
    severity = ResourceAttentionSeverity.Warning;
    tone = "warning";
  } else if (HEALTHY_STATUSES.includes(normalized)) {
    tone = "positive";
  }

  const reason: string | undefined = STATUS_REASONS[normalized];
  return {
    severity: severity,
    status: { label: word.label, values: word.values, tone: tone },
    reasons: severity && reason ? [{ text: reason }] : [],
  };
}

/*
 * A host as the array sees it (purefa_host_connectivity_info): critical
 * when it no longer reaches the array through both controllers - the Host
 * Lost Redundant Paths alert, a warning: the host keeps working until its
 * remaining path fails.
 */
function assessHost(row: StorageArrayPartRow): StorageArrayAssessment {
  const normalized: string = normalizeStatus(row.status);
  if (normalized === "critical") {
    const detail: string = normalizeStatus(row.statusDetail);
    const reason: string =
      detail === "single controller"
        ? REASON_PATHS_SINGLE_CONTROLLER
        : detail === "uneven"
          ? REASON_PATHS_UNEVEN
          : detail === "none"
            ? REASON_PATHS_NONE
            : REASON_PATHS_LOST;
    return {
      severity: ResourceAttentionSeverity.Warning,
      status: { label: STATUS_HOST_LOST_PATHS, tone: "warning" },
      reasons: [{ text: reason }],
    };
  }
  if (normalized === "healthy") {
    return {
      severity: null,
      status: { label: STATUS_HOST_REDUNDANT, tone: "positive" },
      reasons: [],
    };
  }
  // Any other word reads as the array's statuses do: Unused in grey.
  const fromStatus: StorageArrayAssessment | null = assessStatusPart(row);
  if (fromStatus) {
    return fromStatus;
  }
  return {
    severity: null,
    status: { label: STATUS_AVAILABLE, tone: "neutral" },
    reasons: [],
  };
}

/*
 * A part by the rules. readings carries what the inventory has no column
 * for (a FlashBlade file system's available share).
 */
export function assessStorageArrayPart(
  row: StorageArrayPartRow,
  readings: StorageArrayPartReadings = {},
): StorageArrayAssessment {
  const kind: string = row.kind || "";

  if (kind === "Host") {
    return assessHost(row);
  }

  if (STATUS_KINDS.includes(kind)) {
    const fromStatus: StorageArrayAssessment | null = assessStatusPart(row);
    const assessment: StorageArrayAssessment = fromStatus || {
      severity: null,
      status: { label: STATUS_AVAILABLE, tone: "neutral" },
      reasons: [],
    };

    // A pod's worst replica link: more than a minute behind is a warning.
    if (kind === "Pod") {
      const lag: number | null = toStorageArrayNumber(row.replicationLagMs);
      if (lag !== null && lag > STORAGE_ARRAY_REPLICATION_LAG_WARNING_MS) {
        const severity: ResourceAttentionSeverity =
          mergeResourceAttentionSeverity(
            [assessment.severity, ResourceAttentionSeverity.Warning].filter(
              (value: ResourceAttentionSeverity | null): boolean => {
                return value !== null;
              },
            ) as Array<ResourceAttentionSeverity>,
          ) as ResourceAttentionSeverity;
        return {
          severity: severity,
          status: {
            ...assessment.status,
            tone:
              assessment.status.tone === "danger"
                ? "danger"
                : toneOf(ResourceAttentionSeverity.Warning),
          },
          reasons: [
            ...assessment.reasons,
            {
              text: REASON_LAG,
              values: { lag: formatStorageArrayLag(lag) },
            },
          ],
        };
      }
    }
    return assessment;
  }

  if (kind === "FileSystem") {
    const available: number | null = toStorageArrayNumber(
      readings.availableRatio,
    );
    if (
      available !== null &&
      available < FILE_SYSTEM_NEAR_FULL_AVAILABLE_RATIO
    ) {
      return {
        severity: ResourceAttentionSeverity.Warning,
        status: { label: STATUS_NEAR_FULL, tone: "warning" },
        reasons: [
          {
            text: REASON_FILE_SYSTEM_FULL,
            values: {
              percent: formatStorageArrayPercent(
                Math.max(0, Math.min(100, (1 - available) * 100)),
              ),
            },
          },
        ],
      };
    }
  }

  return {
    severity: null,
    status: { label: STATUS_AVAILABLE, tone: "positive" },
    reasons: [],
  };
}

/*
 * The array itself: what it reads in its own snapshot (its open alerts by
 * severity, how full it is) and its latest latency.
 */
export interface StorageArrayState {
  storageSystem?: string | null | undefined;
  criticalAlertCount?: number | null | undefined;
  warningAlertCount?: number | null | undefined;
  capacityUsedPercent?: number | null | undefined;
  // The latest average latency, µs per operation; null where none came.
  readLatencyUsec?: number | null | undefined;
  writeLatencyUsec?: number | null | undefined;
}

export function assessStorageArray(
  state: StorageArrayState,
): StorageArrayAssessment {
  const reasons: Array<{
    severity: ResourceAttentionSeverity;
    text: ResourceAttentionText;
  }> = [];

  const critical: number = toStorageArrayNumber(state.criticalAlertCount) || 0;
  if (critical > 0) {
    reasons.push({
      severity: ResourceAttentionSeverity.Critical,
      text: {
        text: REASON_CRITICAL_ALERTS.other,
        plural: { one: REASON_CRITICAL_ALERTS.one, count: critical },
      },
    });
  }

  const capacity: number | null = toStorageArrayNumber(
    state.capacityUsedPercent,
  );
  if (capacity !== null && capacity > STORAGE_ARRAY_CAPACITY_WARNING_PERCENT) {
    reasons.push({
      severity:
        capacity > STORAGE_ARRAY_CAPACITY_CRITICAL_PERCENT
          ? ResourceAttentionSeverity.Critical
          : ResourceAttentionSeverity.Warning,
      text: {
        text: REASON_CAPACITY,
        values: { percent: formatStorageArrayPercent(capacity) },
      },
    });
  }

  const warning: number = toStorageArrayNumber(state.warningAlertCount) || 0;
  if (warning > 0) {
    reasons.push({
      severity: ResourceAttentionSeverity.Warning,
      text: {
        text: REASON_WARNING_ALERTS.other,
        plural: { one: REASON_WARNING_ALERTS.one, count: warning },
      },
    });
  }

  const isFlashBlade: boolean =
    state.storageSystem === StorageSystem.PureStorageFlashBlade;
  const readLine: number = isFlashBlade
    ? FLASHBLADE_READ_LATENCY_WARNING_USEC
    : FLASHARRAY_LATENCY_WARNING_USEC;
  const read: number | null = toStorageArrayNumber(state.readLatencyUsec);
  if (read !== null && read > readLine) {
    reasons.push({
      severity: ResourceAttentionSeverity.Warning,
      text: {
        text: REASON_READ_LATENCY,
        values: { latency: formatStorageArrayLatency(read) },
      },
    });
  }
  // A FlashBlade's alert watches its reads only.
  const write: number | null = isFlashBlade
    ? null
    : toStorageArrayNumber(state.writeLatencyUsec);
  if (write !== null && write > FLASHARRAY_LATENCY_WARNING_USEC) {
    reasons.push({
      severity: ResourceAttentionSeverity.Warning,
      text: {
        text: REASON_WRITE_LATENCY,
        values: { latency: formatStorageArrayLatency(write) },
      },
    });
  }

  // The most urgent first, each in the order above.
  const ordered: Array<{
    severity: ResourceAttentionSeverity;
    text: ResourceAttentionText;
  }> = [
    ...reasons.filter(
      (reason: { severity: ResourceAttentionSeverity }): boolean => {
        return reason.severity === ResourceAttentionSeverity.Critical;
      },
    ),
    ...reasons.filter(
      (reason: { severity: ResourceAttentionSeverity }): boolean => {
        return reason.severity === ResourceAttentionSeverity.Warning;
      },
    ),
  ];

  const severity: ResourceAttentionSeverity | null =
    mergeResourceAttentionSeverity(
      ordered.map((reason: { severity: ResourceAttentionSeverity }) => {
        return reason.severity;
      }),
    );

  return {
    severity: severity,
    status: {
      label:
        severity === ResourceAttentionSeverity.Critical
          ? translationKey("Critical")
          : severity === ResourceAttentionSeverity.Warning
            ? translationKey("Warning")
            : translationKey("OK"),
      tone: toneOf(severity),
    },
    reasons: ordered.map(
      (reason: { text: ResourceAttentionText }): ResourceAttentionText => {
        return reason.text;
      },
    ),
  };
}

export function isStorageArrayPartKind(
  kind: string | null | undefined,
): kind is StorageArrayPartKind {
  return Boolean(kind && kind in KIND_ICONS);
}

export function getStorageArrayPartName(row: StorageArrayPartRow): string {
  return row.name || row.externalId || "";
}

// A part's row in Needs attention, stable across reloads.
export function getStorageArrayAttentionKey(
  row: Pick<StorageArrayPartRow, "kind" | "externalId" | "name">,
): string {
  return `${row.kind || ""}:${row.externalId || row.name || ""}`;
}

/*
 * Needs attention: the array's row (its alerts, how full and how slow it
 * is), then each part with why, the most urgent first. routeFor gives a
 * part's own page, or the list it is on.
 */
// Which of a physical part's rows names it: the drive in a bay, not the bay.
const HARDWARE_KIND_SPECIFICITY: ReadonlyArray<StorageArrayPartKind> = [
  "Drive",
  "Controller",
  "NetworkInterface",
  "Hardware",
];

export function getStorageArrayAttentionItems(data: {
  arrayName: string;
  array: StorageArrayState;
  parts: Array<StorageArrayPartRow>;
  readingsFor?:
    | ((row: StorageArrayPartRow) => StorageArrayPartReadings)
    | undefined;
  routeFor?: ((row: StorageArrayPartRow) => Route | undefined) | undefined;
}): Array<ResourceAttentionItem> {
  const items: Array<ResourceAttentionItem> = [];

  const array: StorageArrayAssessment = assessStorageArray(data.array);
  if (array.severity) {
    items.push({
      key: STORAGE_ARRAY_ATTENTION_KEY,
      kind: STORAGE_ARRAY_KIND_ARRAY,
      icon: IconProp.Database,
      name: data.arrayName,
      severity: array.severity,
      reasons: array.reasons,
    });
  }

  /*
   * One physical part can be several rows under one name: a failed
   * FlashArray drive is its bay (Hardware, critical) and the drive in it
   * (Drive, failed); a controller is a Hardware and a Controller row. Each
   * is one row here - the part the ingest counts once
   * (StorageArraySnapshotScan) - named by its most specific kind, whose
   * reasons say why. The other rows' reasons join only when they are the
   * more urgent: a failed drive's bay reporting critical says nothing the
   * drive's "Reports failed" does not, but a degraded drive in a bay the
   * array calls critical is critical for the bay's reason.
   */
  const hardwareByName: Map<string, ResourceAttentionItem> = new Map();
  const hardwareKindOf: Map<string, StorageArrayPartKind> = new Map();

  for (const row of data.parts) {
    if (!isStorageArrayPartKind(row.kind)) {
      continue;
    }
    const assessment: StorageArrayAssessment = assessStorageArrayPart(
      row,
      data.readingsFor ? data.readingsFor(row) : {},
    );
    if (!assessment.severity) {
      continue;
    }
    const item: ResourceAttentionItem = {
      key: getStorageArrayAttentionKey(row),
      kind: STORAGE_ARRAY_KIND_LABELS[row.kind],
      icon: KIND_ICONS[row.kind],
      name: getStorageArrayPartName(row),
      severity: assessment.severity,
      reasons: assessment.reasons,
      route: data.routeFor ? data.routeFor(row) : undefined,
    };

    if (!STORAGE_ARRAY_HARDWARE_KINDS.includes(row.kind)) {
      items.push(item);
      continue;
    }

    const physical: string = item.name.trim().toLowerCase();
    const earlier: ResourceAttentionItem | undefined =
      hardwareByName.get(physical);
    const earlierKind: StorageArrayPartKind | undefined =
      hardwareKindOf.get(physical);
    if (!earlier || !earlierKind) {
      hardwareByName.set(physical, item);
      hardwareKindOf.set(physical, row.kind);
      items.push(item);
      continue;
    }

    // The more specific kind names the part; its reasons come first.
    const thisIsSpecific: boolean =
      HARDWARE_KIND_SPECIFICITY.indexOf(row.kind) <
      HARDWARE_KIND_SPECIFICITY.indexOf(earlierKind);
    const first: ResourceAttentionItem = thisIsSpecific ? item : earlier;
    const second: ResourceAttentionItem = thisIsSpecific ? earlier : item;
    const severity: ResourceAttentionSeverity =
      mergeResourceAttentionSeverity([earlier.severity, item.severity]) ||
      earlier.severity;
    const reasons: Array<ResourceAttentionText> = [...first.reasons];
    const secondIsMoreUrgent: boolean =
      second.severity === severity && first.severity !== severity;
    for (const reason of secondIsMoreUrgent ? second.reasons : []) {
      const seen: boolean = reasons.some(
        (kept: ResourceAttentionText): boolean => {
          return (
            kept.text === reason.text &&
            JSON.stringify(kept.values || {}) ===
              JSON.stringify(reason.values || {})
          );
        },
      );
      if (!seen) {
        reasons.push(reason);
      }
    }
    Object.assign(earlier, {
      key: first.key,
      kind: first.kind,
      icon: first.icon,
      severity: severity,
      reasons: reasons,
      route: first.route || second.route,
    });
    if (thisIsSpecific) {
      hardwareKindOf.set(physical, row.kind);
    }
  }

  return sortResourceAttention(items, STORAGE_ARRAY_ATTENTION_KIND_ORDER);
}

export function getStorageArrayHealth(
  items: Array<ResourceAttentionItem>,
): ResourceHealth {
  return getResourceAttentionHealth(items);
}

// A list row's why: the reasons the rules give, as a status cell draws them.
export function getStorageArrayStatusReasons(
  assessment: StorageArrayAssessment,
): Array<ResourceAttentionText> {
  return assessment.reasons;
}

// The Topology's colour for a part or the array, by the same rules.
export function getStorageArrayTopologyHealth(
  assessment: StorageArrayAssessment,
): ResourceTopologyHealth {
  if (assessment.severity === ResourceAttentionSeverity.Critical) {
    return "critical";
  }
  if (assessment.severity === ResourceAttentionSeverity.Warning) {
    return "warning";
  }
  return "healthy";
}

/*
 * Whether an open incident or alert is about this part, by the label its
 * series names the part with: a hardware component's or drive's
 * component_name, a host's host, a pod's local_pod, a FlashBlade part's or
 * file system's name. An alert of the array's own (a summary) or about its
 * capacity or latency names no part.
 */
export function isStorageArrayIssueAbout(
  record: Pick<OpenIssueRecord, "seriesLabels">,
  row: Pick<StorageArrayResource, "kind" | "externalId" | "name">,
): boolean {
  const names: Array<string> = [row.externalId || "", row.name || ""].filter(
    (name: string): boolean => {
      return name.length > 0;
    },
  );
  if (names.length === 0) {
    return false;
  }
  const label: string | null =
    row.kind === "Host"
      ? readSeriesLabel(record.seriesLabels, "host")
      : row.kind === "Pod"
        ? readSeriesLabel(record.seriesLabels, "local_pod")
        : readSeriesLabel(record.seriesLabels, "component_name") ||
          readSeriesLabel(record.seriesLabels, "name");
  if (!label) {
    return false;
  }
  return names.some((name: string): boolean => {
    return sameName(label, name);
  });
}
