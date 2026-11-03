import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../../Utils/PageMap";
import {
  ResourceTopologyFact,
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyNodeInput,
  ResourceTopologyText,
  ResourceTopologyTruncation,
  buildResourceTopologyGraph,
} from "../ResourceTopologyModel";
import {
  OpenIssueRecord,
  attachOpenIssues,
  readSeriesLabel,
} from "../ResourceTopologyIssues";
import {
  formatTopologyBytes,
  formatTopologyPercent,
  isRecent,
  toFiniteNumber,
} from "../ResourceTopologyFormat";
import { healthOfStatusWord } from "../ResourceTopologyStatusWords";
import {
  StorageArrayAssessment,
  assessStorageArray,
  assessStorageArrayPart,
  getStorageArrayTopologyHealth,
} from "../../../Pages/StorageArray/Utils/StorageArrayHealth";

/*
 * A storage array's topology: its host groups and the hosts in them, its
 * pods and volume groups and the volumes in them, its file systems,
 * directories and buckets, and — in one Hardware group, so the array's
 * structure reads first — its controllers, drives, network interfaces and
 * other components.
 *
 * Health is the rules' (Pages/StorageArray/Utils/StorageArrayHealth), as
 * the array's Overview, its lists and a part's page say it: a part the
 * array reports critical, failed, missing or unhealthy is critical;
 * degraded, unknown, unrecognized or not ready, a host that lost a path and
 * a pod more than a minute behind need attention; the array itself by its
 * open alerts and how full it is. A word the rules do not know reads by
 * the shared status words.
 */

export const STORAGE_ARRAY_ROOT_ID: string = "array";
export const STORAGE_ARRAY_HARDWARE_ID: string = "section:hardware";
export const STORAGE_ARRAY_STALE_MS: number = 15 * 60 * 1000;

/* Mirrors StorageArrayResourceUtils (a parity test holds them equal). */
export const STORAGE_ARRAY_CRITICAL_STATUSES: ReadonlyArray<string> = [
  "critical",
  "failed",
  "missing",
  "unhealthy",
];

export const STORAGE_ARRAY_WARNING_STATUSES: ReadonlyArray<string> = [
  "degraded",
  "unknown",
  "unrecognized",
  "not ready",
];

export const STORAGE_ARRAY_HEALTHY_STATUSES: ReadonlyArray<string> = [
  "ok",
  "healthy",
  "ready",
  "enabled",
  "online",
  "replicating",
];

const HARDWARE_KINDS: Record<string, string> = {
  Controller: "storage.controller",
  Drive: "storage.drive",
  NetworkInterface: "storage.port",
  Hardware: "storage.hardware",
};

const DETAIL_PAGES: Record<string, PageMap> = {
  Volume: PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL,
  Host: PageMap.STORAGE_ARRAY_VIEW_HOST_DETAIL,
  FileSystem: PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL,
  Bucket: PageMap.STORAGE_ARRAY_VIEW_BUCKET_DETAIL,
};

export interface StorageArrayTopologyInput {
  array: {
    id: string;
    name: string;
    lastSeenAt?: Date | null | undefined;
    openAlertCount?: number | null | undefined;
    criticalAlertCount?: number | null | undefined;
    warningAlertCount?: number | null | undefined;
    capacityUsedPercent?: number | null | undefined;
    storageSystem?: string | null | undefined;
  };
  rows: Array<StorageArrayResource>;
  issues?: Array<OpenIssueRecord> | undefined;
  now: Date;
  truncations?: Array<ResourceTopologyTruncation> | undefined;
}

function text(
  value: string,
  values?: Record<string, string> | undefined,
): ResourceTopologyText {
  return values ? { text: value, values: values } : { text: value };
}

export function storageArrayStatusHealth(
  status: string | null | undefined,
): ResourceTopologyHealth | null {
  const normalized: string = (status || "").trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (STORAGE_ARRAY_CRITICAL_STATUSES.includes(normalized)) {
    return "critical";
  }

  if (STORAGE_ARRAY_WARNING_STATUSES.includes(normalized)) {
    return "warning";
  }

  if (STORAGE_ARRAY_HEALTHY_STATUSES.includes(normalized)) {
    return "healthy";
  }

  return healthOfStatusWord(normalized);
}

function capacityFacts(row: StorageArrayResource): Array<ResourceTopologyFact> {
  const capacity: number | null = toFiniteNumber(row.capacityBytes);
  const used: number | null = toFiniteNumber(row.usedBytes);
  const facts: Array<ResourceTopologyFact> = [];

  if (capacity !== null && used !== null && capacity > 0) {
    facts.push({
      label: translationKey("Used"),
      value: formatTopologyPercent((used / capacity) * 100),
    });
  }

  if (capacity !== null) {
    facts.push({
      label: translationKey("Capacity"),
      value: formatTopologyBytes(capacity),
    });
  }

  return facts;
}

export function buildStorageArrayTopology(
  input: StorageArrayTopologyInput,
): ResourceTopologyGraph {
  const arrayId: string = input.array.id;
  const reporting: boolean =
    isRecent(input.array.lastSeenAt, input.now, STORAGE_ARRAY_STALE_MS) ||
    input.rows.some((row: StorageArrayResource): boolean => {
      return isRecent(row.lastSeenAt, input.now, STORAGE_ARRAY_STALE_MS);
    });
  // The array by the rules: its open alerts and how full it is.
  const arrayAssessment: StorageArrayAssessment = assessStorageArray({
    storageSystem: input.array.storageSystem,
    criticalAlertCount: input.array.criticalAlertCount,
    warningAlertCount: input.array.warningAlertCount,
    capacityUsedPercent: input.array.capacityUsedPercent,
  });

  const nodes: Array<ResourceTopologyNodeInput> = [
    {
      id: STORAGE_ARRAY_ROOT_ID,
      parentId: null,
      kind: "storage.array",
      name: input.array.name || "Storage Array",
      health: !reporting
        ? input.array.lastSeenAt
          ? "warning"
          : "unknown"
        : getStorageArrayTopologyHealth(arrayAssessment),
      status: !reporting
        ? input.array.lastSeenAt
          ? text(translationKey("Not reporting"))
          : text(translationKey("No data yet"))
        : text(translationKey("Reporting")),
      reasons: reporting ? arrayAssessment.reasons : [],
      link: { page: PageMap.STORAGE_ARRAY_VIEW, modelId: arrayId },
    },
  ];

  const ids: Map<string, string> = new Map<string, string>();
  const podIds: Map<string, string> = new Map<string, string>();
  const groupIds: Map<string, string> = new Map<string, string>();
  let hasHardware: boolean = false;

  const ensureGroup: (kind: string, name: string) => string = (
    kind: string,
    name: string,
  ): string => {
    const key: string = `${kind}:${name}`;

    if (!groupIds.has(key)) {
      groupIds.set(key, `group:${key}`);
      nodes.push({
        id: `group:${key}`,
        parentId: STORAGE_ARRAY_ROOT_ID,
        kind: kind,
        name: name,
        health: "healthy",
      });
    }

    return groupIds.get(key)!;
  };

  for (const row of input.rows) {
    if (row.kind === "Pod" && row.externalId) {
      podIds.set(row.externalId, `pod:${row.externalId}`);
    }
  }

  for (const row of input.rows) {
    if (!row.kind || !row.externalId) {
      continue;
    }

    const id: string = `${row.kind.toLowerCase()}:${row.externalId}`;
    const name: string = row.name || row.externalId;
    const assessment: StorageArrayAssessment = assessStorageArrayPart(row);
    const hardwareKind: string | undefined = HARDWARE_KINDS[row.kind];
    /*
     * By the rules; a part they have no word on reads by its own status
     * word, and a hardware part with none is unknown.
     */
    const health: ResourceTopologyHealth = assessment.severity
      ? getStorageArrayTopologyHealth(assessment)
      : assessment.status.tone === "positive"
        ? "healthy"
        : storageArrayStatusHealth(row.status) ||
          (hardwareKind ? "unknown" : "healthy");
    let parentId: string = STORAGE_ARRAY_ROOT_ID;
    let kind: string = "";

    switch (row.kind) {
      case "Host":
        kind = "storage.host";
        parentId = row.groupName
          ? ensureGroup("storage.hostgroup", row.groupName)
          : STORAGE_ARRAY_ROOT_ID;
        break;
      case "Pod":
        kind = "storage.pod";
        break;
      case "Volume":
        kind = "storage.volume";
        parentId = row.groupName
          ? podIds.get(row.groupName) ||
            ensureGroup("storage.volumegroup", row.groupName)
          : STORAGE_ARRAY_ROOT_ID;
        break;
      case "FileSystem":
        kind = "storage.filesystem";
        break;
      case "Directory":
        kind = "storage.directory";
        break;
      case "Bucket":
        kind = "storage.bucket";
        break;
      default:
        if (!hardwareKind) {
          continue;
        }
        kind = hardwareKind;
        parentId = STORAGE_ARRAY_HARDWARE_ID;
        hasHardware = true;
    }

    ids.set(`${row.kind}:${row.externalId}`.toLowerCase(), id);
    ids.set(`${row.kind}:${name}`.toLowerCase(), id);

    const page: PageMap | undefined = DETAIL_PAGES[row.kind];

    nodes.push({
      id: id,
      parentId: parentId,
      kind: kind,
      name: name,
      health: health,
      status:
        row.status || assessment.severity
          ? text(assessment.status.label, assessment.status.values)
          : undefined,
      reasons: assessment.reasons,
      facts: capacityFacts(row),
      context: row.groupName || row.componentType || undefined,
      keywords: [row.model || "", row.componentType || ""].filter(
        (keyword: string): boolean => {
          return keyword.length > 0;
        },
      ),
      link: page
        ? {
            page: page,
            modelId: arrayId,
            subModelId: encodeURIComponent(row.externalId),
          }
        : null,
    });
  }

  if (hasHardware) {
    nodes.push({
      id: STORAGE_ARRAY_HARDWARE_ID,
      parentId: STORAGE_ARRAY_ROOT_ID,
      kind: "section",
      isSection: true,
      name: translationKey("Hardware"),
      health: "healthy",
    });
  }

  // name (volumes, pods, directories, FlashBlade objects), host, component_name.
  const locate: (record: OpenIssueRecord) => string | null = (
    record: OpenIssueRecord,
  ): string | null => {
    const candidates: Array<[string, Array<string>]> = [
      ["host", ["Host"]],
      [
        "component_name",
        ["Controller", "Drive", "NetworkInterface", "Hardware"],
      ],
      ["local_pod", ["Pod"]],
      ["name", ["Volume", "Pod", "Directory", "FileSystem", "Bucket"]],
    ];

    for (const [label, kinds] of candidates) {
      const value: string | null = readSeriesLabel(record.seriesLabels, label);

      if (!value) {
        continue;
      }

      for (const kind of kinds) {
        const id: string | undefined = ids.get(
          `${kind}:${value}`.toLowerCase(),
        );

        if (id) {
          return id;
        }
      }
    }

    return null;
  };

  return buildResourceTopologyGraph({
    rootId: STORAGE_ARRAY_ROOT_ID,
    nodes: nodes,
    issues: attachOpenIssues({
      records: input.issues || [],
      rootId: STORAGE_ARRAY_ROOT_ID,
      locate: locate,
    }),
    truncations: input.truncations,
  });
}
