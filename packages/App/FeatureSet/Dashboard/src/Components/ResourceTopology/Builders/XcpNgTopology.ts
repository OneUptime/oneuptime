import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import XcpNgResourceKind from "Common/Types/XcpNg/XcpNgResourceKind";
import {
  XCP_NG_ID_ATTRIBUTE,
  XcpNgHostPowerState,
  XcpNgLabel,
  XcpNgVmPowerState,
} from "Common/Types/XcpNg/XcpNgTelemetry";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  StorageUsage,
  StorageUsageLevel,
} from "Common/Utils/Storage/StorageUsage";
import PageMap from "../../../Utils/PageMap";
import {
  ResourceTopologyFact,
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyNodeInput,
  ResourceTopologyRelation,
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
import {
  getXcpNgAllocationPercent,
  getXcpNgStorageUsage,
  isXcpNgControlDomain,
  isXcpNgHostDisabled,
  isXcpNgHostOffline,
  isXcpNgStorageOverAllocated,
  isXcpNgVmStoppedAfterRunning,
} from "../../../Pages/XcpNg/Utils/XcpNgHealth";
import {
  XCP_NG_METRIC_STALE_MS,
  getXcpNgDisplayName,
} from "../../../Pages/XcpNg/Utils/XcpNgResourceUtils";

/*
 * AN XCP-NG POOL'S TOPOLOGY: the pool, its hosts, and on each host the VMs
 * it runs and its local storage repositories; the storage repositories every
 * host shares sit on the pool itself. A VM uses the storage repositories its
 * virtual disks are on: a relation across the tree, read from the pool's
 * virtual disks (a VDI names its repository and its VM).
 *
 * Health follows the pool's Overview (Needs attention, whose rules are
 * Pages/XcpNg/Utils/XcpNgHealth): a host halted or not responding and a
 * storage repository more than 95% full are critical; a disabled host, a VM
 * halted or paused after running in the last day, and a storage repository
 * more than 90% full or allocated past its size need attention. A VM halted
 * and left off, or suspended, is off - someone's choice, never a problem. A
 * host's control domain is the host's own and is not drawn.
 */

export const XCP_NG_ROOT_ID: string = "pool";

export interface XcpNgTopologyInput {
  pool: { id: string; name: string; lastSeenAt?: Date | null | undefined };
  rows: Array<XcpNgResource>;
  issues?: Array<OpenIssueRecord> | undefined;
  now: Date;
  truncations?: Array<ResourceTopologyTruncation> | undefined;
}

export function xcpNgHostNodeId(externalId: string): string {
  return `host:${externalId.toLowerCase()}`;
}

export function xcpNgVmNodeId(externalId: string): string {
  return `vm:${externalId.toLowerCase()}`;
}

export function xcpNgStorageNodeId(externalId: string): string {
  return `sr:${externalId.toLowerCase()}`;
}

function text(
  value: string,
  values?: Record<string, string> | undefined,
): ResourceTopologyText {
  return values ? { text: value, values: values } : { text: value };
}

function routeParam(externalId: string): string {
  return encodeURIComponent(externalId);
}

interface Assessment {
  health: ResourceTopologyHealth;
  status?: ResourceTopologyText | undefined;
  reasons: Array<ResourceTopologyText>;
  facts: Array<ResourceTopologyFact>;
}

// A running part's latest CPU and memory, when they are fresh.
function metricFacts(
  row: XcpNgResource,
  now: Date,
): Array<ResourceTopologyFact> {
  if (
    row.isUp !== true ||
    !isRecent(row.metricsUpdatedAt, now, XCP_NG_METRIC_STALE_MS)
  ) {
    return [];
  }

  const facts: Array<ResourceTopologyFact> = [];
  const cpu: number | null = toFiniteNumber(row.latestCpuPercent);
  const memory: number | null = toFiniteNumber(row.latestMemoryPercent);

  if (cpu !== null) {
    facts.push({
      label: translationKey("CPU"),
      value: formatTopologyPercent(cpu),
    });
  }

  if (memory !== null) {
    facts.push({
      label: translationKey("Memory"),
      value: formatTopologyPercent(memory),
    });
  }

  return facts;
}

function assessHost(row: XcpNgResource, now: Date): Assessment {
  const facts: Array<ResourceTopologyFact> = metricFacts(row, now);

  if (isXcpNgHostOffline(row)) {
    const isUnknown: boolean = row.powerState === XcpNgHostPowerState.Unknown;
    return {
      health: "critical",
      status: text(
        isUnknown ? translationKey("Not responding") : translationKey("Halted"),
      ),
      reasons: [
        text(
          isUnknown
            ? translationKey("The pool lost touch with this host.")
            : translationKey("The host is halted: its VMs are down with it."),
        ),
      ],
      facts: facts,
    };
  }

  if (isXcpNgHostDisabled(row)) {
    return {
      health: "warning",
      status: text(translationKey("Disabled")),
      reasons: [
        text(
          translationKey(
            "The host is disabled: XAPI starts no VM on it until it is enabled.",
          ),
        ),
      ],
      facts: facts,
    };
  }

  if (row.isUp === true) {
    return {
      health: "healthy",
      status: text(translationKey("Running")),
      reasons: [],
      facts: facts,
    };
  }

  return {
    health: "unknown",
    status: text(translationKey("No data yet")),
    reasons: [],
    facts: facts,
  };
}

function assessVm(row: XcpNgResource, now: Date): Assessment {
  const facts: Array<ResourceTopologyFact> = metricFacts(row, now);

  if (isXcpNgVmStoppedAfterRunning(row, now)) {
    const isPaused: boolean = row.powerState === XcpNgVmPowerState.Paused;
    return {
      health: "warning",
      status: text(
        isPaused ? translationKey("Paused") : translationKey("Halted"),
      ),
      reasons: [
        text(
          isPaused
            ? translationKey("Paused after running in the last 24 hours.")
            : translationKey("Halted after running in the last 24 hours."),
        ),
      ],
      facts: [],
    };
  }

  switch (row.powerState) {
    case XcpNgVmPowerState.Running:
      return {
        health: "healthy",
        status: text(translationKey("Running")),
        reasons: [],
        facts: facts,
      };
    case XcpNgVmPowerState.Halted:
      return {
        health: "off",
        status: text(translationKey("Halted")),
        reasons: [],
        facts: [],
      };
    case XcpNgVmPowerState.Paused:
      return {
        health: "off",
        status: text(translationKey("Paused")),
        reasons: [],
        facts: [],
      };
    case XcpNgVmPowerState.Suspended:
      return {
        health: "off",
        status: text(translationKey("Suspended")),
        reasons: [],
        facts: [],
      };
    default:
      break;
  }

  return {
    health: row.isUp === true ? "healthy" : "unknown",
    status:
      row.isUp === true
        ? text(translationKey("Running"))
        : text(translationKey("No data yet")),
    reasons: [],
    facts: facts,
  };
}

function assessStorage(row: XcpNgResource): Assessment {
  const usage: StorageUsage | null = getXcpNgStorageUsage(row);
  const facts: Array<ResourceTopologyFact> = [];
  const size: number | null = toFiniteNumber(row.maxDiskBytes);

  if (size !== null && size > 0) {
    facts.push({
      label: translationKey("Size"),
      value: formatTopologyBytes(size),
    });
  }

  if (!usage) {
    return {
      health: "unknown",
      status: text(translationKey("No data yet")),
      reasons: [],
      facts: facts,
    };
  }

  const reasons: Array<ResourceTopologyText> = [];
  let health: ResourceTopologyHealth = "healthy";

  if (usage.level !== StorageUsageLevel.Normal) {
    health =
      usage.level === StorageUsageLevel.Critical ? "critical" : "warning";
    reasons.push(
      text(translationKey("{{percent}} of the storage repository is used"), {
        percent: formatTopologyPercent(usage.usedPercent, 1),
      }),
    );
  }

  if (isXcpNgStorageOverAllocated(row)) {
    health = health === "critical" ? health : "warning";
    reasons.push(
      text(
        translationKey(
          "Its disks are allocated {{percent}} of its size: they can fill it as they grow.",
        ),
        {
          percent: formatTopologyPercent(getXcpNgAllocationPercent(row) || 0),
        },
      ),
    );
  }

  return {
    health: health,
    status: text(translationKey("{{percent}} used"), {
      percent: formatTopologyPercent(usage.usedPercent, 1),
    }),
    reasons: reasons,
    facts: facts,
  };
}

export function buildXcpNgTopology(
  input: XcpNgTopologyInput,
): ResourceTopologyGraph {
  const poolId: string = input.pool.id;
  const reporting: boolean =
    isRecent(input.pool.lastSeenAt, input.now, XCP_NG_METRIC_STALE_MS) ||
    input.rows.some((row: XcpNgResource): boolean => {
      return isRecent(row.lastSeenAt, input.now, XCP_NG_METRIC_STALE_MS);
    });

  const nodes: Array<ResourceTopologyNodeInput> = [
    {
      id: XCP_NG_ROOT_ID,
      parentId: null,
      kind: "xcp_ng.pool",
      name: input.pool.name || "XCP-ng",
      health: reporting
        ? "healthy"
        : input.pool.lastSeenAt
          ? "warning"
          : "unknown",
      status: reporting
        ? text(translationKey("Reporting"))
        : input.pool.lastSeenAt
          ? text(translationKey("Not reporting"))
          : text(translationKey("No data yet")),
      reasons:
        !reporting && input.pool.lastSeenAt
          ? [text(translationKey("Xen Orchestra stopped reporting this pool."))]
          : [],
      link: { page: PageMap.XCP_NG_POOL_VIEW, modelId: poolId },
    },
  ];

  const hostIds: Set<string> = new Set<string>();
  const vmIds: Set<string> = new Set<string>();
  const storageIds: Set<string> = new Set<string>();

  // The hosts first: what the VMs and local storage hang from.
  for (const row of input.rows) {
    if (row.kind !== XcpNgResourceKind.Host || !row.externalId) {
      continue;
    }
    const id: string = xcpNgHostNodeId(row.externalId);
    const assessment: Assessment = assessHost(row, input.now);
    hostIds.add(id);
    nodes.push({
      id: id,
      parentId: XCP_NG_ROOT_ID,
      kind: "xcp_ng.host",
      name: getXcpNgDisplayName(row),
      health: assessment.health,
      status: assessment.status,
      reasons: assessment.reasons,
      facts: assessment.facts,
      keywords: [row.externalId],
      link: {
        page: PageMap.XCP_NG_POOL_VIEW_HOST_DETAIL,
        modelId: poolId,
        subModelId: routeParam(row.externalId),
      },
    });
  }

  // A part on a host the pool still reports hangs from it; else from the pool.
  const parentOf: (row: XcpNgResource) => string = (
    row: XcpNgResource,
  ): string => {
    const hostId: string = row.parentHostExternalId
      ? xcpNgHostNodeId(row.parentHostExternalId)
      : "";
    return hostId && hostIds.has(hostId) ? hostId : XCP_NG_ROOT_ID;
  };

  for (const row of input.rows) {
    if (!row.externalId) {
      continue;
    }

    if (row.kind === XcpNgResourceKind.VM) {
      // A control domain is its host's own.
      if (isXcpNgControlDomain(row)) {
        continue;
      }
      const id: string = xcpNgVmNodeId(row.externalId);
      const assessment: Assessment = assessVm(row, input.now);
      vmIds.add(id);
      nodes.push({
        id: id,
        parentId: parentOf(row),
        kind: "xcp_ng.vm",
        name: getXcpNgDisplayName(row),
        health: assessment.health,
        status: assessment.status,
        reasons: assessment.reasons,
        facts: assessment.facts,
        context: row.parentHostName || undefined,
        keywords: [row.externalId],
        link: {
          page: PageMap.XCP_NG_POOL_VIEW_VM_DETAIL,
          modelId: poolId,
          subModelId: routeParam(row.externalId),
        },
      });
    } else if (row.kind === XcpNgResourceKind.StorageRepository) {
      const id: string = xcpNgStorageNodeId(row.externalId);
      const assessment: Assessment = assessStorage(row);
      storageIds.add(id);
      nodes.push({
        id: id,
        // Shared by every host: on the pool. Local: on its host.
        parentId: row.isShared === true ? XCP_NG_ROOT_ID : parentOf(row),
        kind: "xcp_ng.sr",
        name: getXcpNgDisplayName(row),
        health: assessment.health,
        status: assessment.status,
        reasons: assessment.reasons,
        facts: assessment.facts,
        context:
          row.isShared === true ? undefined : row.parentHostName || undefined,
        keywords: [row.externalId, ...(row.srType ? [row.srType] : [])],
        link: {
          page: PageMap.XCP_NG_POOL_VIEW_STORAGE_DETAIL,
          modelId: poolId,
          subModelId: routeParam(row.externalId),
        },
      });
    }
  }

  /*
   * A VM uses the storage repositories its virtual disks are on: one
   * relation per VM and repository, however many disks it has there.
   */
  const relations: Array<ResourceTopologyRelation> = [];
  const related: Set<string> = new Set<string>();
  for (const row of input.rows) {
    if (
      row.kind !== XcpNgResourceKind.VDI ||
      !row.vmExternalId ||
      !row.storageRepositoryExternalId
    ) {
      continue;
    }
    const from: string = xcpNgVmNodeId(row.vmExternalId);
    const to: string = xcpNgStorageNodeId(row.storageRepositoryExternalId);
    const key: string = `${from}>${to}`;
    if (!vmIds.has(from) || !storageIds.has(to) || related.has(key)) {
      continue;
    }
    related.add(key);
    relations.push({
      from: from,
      to: to,
      label: translationKey("Uses"),
      inverseLabel: translationKey("Used by"),
    });
  }

  /*
   * The shipped templates group by xcp_ng.id, the object's XAPI UUID; a
   * person's own monitor may group by Xen Orchestra's labels instead: uuid
   * (a host or a VM), sr_uuid (a storage repository).
   */
  const locate: (record: OpenIssueRecord) => string | null = (
    record: OpenIssueRecord,
  ): string | null => {
    for (const label of [
      XCP_NG_ID_ATTRIBUTE,
      XcpNgLabel.Uuid,
      XcpNgLabel.SrUuid,
    ]) {
      const value: string | null = readSeriesLabel(record.seriesLabels, label);
      if (!value) {
        continue;
      }
      const uuid: string = value.toLowerCase();
      for (const candidate of [
        xcpNgHostNodeId(uuid),
        xcpNgVmNodeId(uuid),
        xcpNgStorageNodeId(uuid),
      ]) {
        if (
          hostIds.has(candidate) ||
          vmIds.has(candidate) ||
          storageIds.has(candidate)
        ) {
          return candidate;
        }
      }
    }
    return null;
  };

  return buildResourceTopologyGraph({
    rootId: XCP_NG_ROOT_ID,
    nodes: nodes,
    relations: relations,
    issues: attachOpenIssues({
      records: input.issues || [],
      rootId: XCP_NG_ROOT_ID,
      locate: locate,
    }),
    truncations: input.truncations,
  });
}
