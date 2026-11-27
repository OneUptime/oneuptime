import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../../Utils/PageMap";
import {
  ResourceTopologyFact,
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyLinkTarget,
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
import { storageArrayPlatformKind } from "../ResourceTopologyKinds";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
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
 * other components. A kind only the array's platform has is a part too,
 * worded by its platform: an ONTAP cluster's SVMs hold their volumes and
 * LUNs (whose group is the SVM's name), beside its aggregates and
 * SnapMirror relationships.
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

/*
 * A part of a kind only its platform has opens its own page, where the
 * platform draws one (StorageArrayKindPage.part).
 */
function ownPartLink(
  row: StorageArrayResource,
  arrayId: string,
  storageSystem: string | null | undefined,
): ResourceTopologyLinkTarget | null {
  if (
    !row.kind ||
    !row.externalId ||
    !StorageArrayPlatformRegistry.getKindDefinition(row.kind, storageSystem) ||
    !StorageArrayPlatformRegistry.getKindPage(storageSystem, row.kind)?.part
  ) {
    return null;
  }
  return {
    page: PageMap.STORAGE_ARRAY_VIEW_INVENTORY_PART,
    modelId: arrayId,
    subModelId: encodeURIComponent(row.kind),
    partId: encodeURIComponent(row.externalId),
  };
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

  /*
   * The parts of a kind only the array's platform has, by name: a part
   * whose group is one of them sits under it (an ONTAP volume under its
   * SVM) rather than under a group of its own.
   */
  const ownKindIds: Map<string, string> = new Map<string, string>();
  const isOwnKind: (kind: string) => boolean = (kind: string): boolean => {
    return Boolean(
      StorageArrayPlatformRegistry.getKindDefinition(
        kind,
        input.array.storageSystem,
      ),
    );
  };

  for (const row of input.rows) {
    if (row.kind === "Pod" && row.externalId) {
      podIds.set(row.externalId, `pod:${row.externalId}`);
    }
    if (row.kind && row.externalId && isOwnKind(row.kind)) {
      const ownId: string = `${row.kind.toLowerCase()}:${row.externalId}`;
      const ownName: string = row.name || row.externalId;
      if (!ownKindIds.has(ownName)) {
        ownKindIds.set(ownName, ownId);
      }
    }
  }

  // The part a row's group names, when it is a part of the map itself.
  const ownGroupOf: (row: StorageArrayResource) => string | undefined = (
    row: StorageArrayResource,
  ): string | undefined => {
    if (!row.groupName) {
      return undefined;
    }
    const groupId: string | undefined = ownKindIds.get(row.groupName);
    const selfId: string = `${(row.kind || "").toLowerCase()}:${row.externalId}`;
    return groupId && groupId !== selfId ? groupId : undefined;
  };

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
            ownGroupOf(row) ||
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
          if (!isOwnKind(row.kind)) {
            continue;
          }
          // A kind only its platform has: under the part its group names.
          kind = storageArrayPlatformKind(row.kind);
          parentId = ownGroupOf(row) || STORAGE_ARRAY_ROOT_ID;
          break;
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
        : ownPartLink(row, arrayId, input.array.storageSystem),
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
