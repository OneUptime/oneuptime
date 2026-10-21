import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
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
  sameName,
} from "../ResourceTopologyIssues";
import {
  formatTopologyBytes,
  formatTopologyPercent,
  isRecent,
  toFiniteNumber,
} from "../ResourceTopologyFormat";

/*
 * A Proxmox VE cluster's topology: its nodes, and on each node its virtual
 * machines, its containers and its storage; storage shared by every node
 * sits on the cluster itself.
 *
 * Health follows the cluster's Overview ("Needs attention"): an offline
 * node, or an HA resource in error or fenced, is critical; a guest that is
 * stopped although it starts on boot, a guest no backup job covers, and a
 * storage more than 85% full need attention. A guest stopped on purpose is
 * off, never a problem.
 */

export const PROXMOX_ROOT_ID: string = "cluster";
export const PROXMOX_STORAGE_NEAR_FULL_PERCENT: number = 85;
export const PROXMOX_STALE_MS: number = 15 * 60 * 1000;

export interface ProxmoxTopologyInput {
  cluster: { id: string; name: string; lastSeenAt?: Date | null | undefined };
  rows: Array<ProxmoxResource>;
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

function routeParam(externalId: string): string {
  return encodeURIComponent(externalId);
}

interface Assessment {
  health: ResourceTopologyHealth;
  status?: ResourceTopologyText | undefined;
  reasons: Array<ResourceTopologyText>;
  facts: Array<ResourceTopologyFact>;
}

function metricFacts(
  row: ProxmoxResource,
  now: Date,
): Array<ResourceTopologyFact> {
  if (!isRecent(row.metricsUpdatedAt, now, PROXMOX_STALE_MS)) {
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

function haCritical(row: ProxmoxResource): boolean {
  return row.haState === "error" || row.haState === "fence";
}

function assessNode(row: ProxmoxResource, now: Date): Assessment {
  const facts: Array<ResourceTopologyFact> = metricFacts(row, now);

  if (row.isUp === false) {
    return {
      health: "critical",
      status: text(translationKey("Offline")),
      reasons: [text(translationKey("The node is offline."))],
      facts: facts,
    };
  }

  if (haCritical(row)) {
    return {
      health: "critical",
      status: text(translationKey("HA state: {{state}}"), {
        state: row.haState || "",
      }),
      reasons: [],
      facts: facts,
    };
  }

  return {
    health: row.isUp === true ? "healthy" : "unknown",
    status:
      row.isUp === true
        ? text(translationKey("Online"))
        : text(translationKey("No data yet")),
    reasons: [],
    facts: facts,
  };
}

function assessGuest(row: ProxmoxResource, now: Date): Assessment {
  const facts: Array<ResourceTopologyFact> = metricFacts(row, now);
  const reasons: Array<ResourceTopologyText> = [];
  let health: ResourceTopologyHealth =
    row.isUp === true ? "healthy" : row.isUp === false ? "off" : "unknown";

  if (haCritical(row)) {
    health = "critical";
    reasons.push(
      text(translationKey("HA state: {{state}}"), { state: row.haState || "" }),
    );
  }

  if (row.onboot && row.isUp === false) {
    health = health === "critical" ? health : "warning";
    reasons.push(text(translationKey("Stopped but configured to start on boot")));
  }

  if (row.isBackedUp === false) {
    // A coverage gap, not a failed backup: amber, never red.
    health = health === "critical" ? health : "warning";
    reasons.push(text(translationKey("Not covered by any backup job")));
  }

  return {
    health: health,
    status:
      row.isUp === true
        ? text(translationKey("Running"))
        : row.isUp === false
          ? text(translationKey("Stopped"))
          : text(translationKey("No data yet")),
    reasons: reasons,
    facts: facts,
  };
}

function assessStorage(row: ProxmoxResource): Assessment {
  const used: number | null = toFiniteNumber(row.latestDiskBytes);
  const total: number | null = toFiniteNumber(row.maxDiskBytes);

  if (used === null || total === null || total <= 0) {
    return {
      health: row.isUp === false ? "critical" : "unknown",
      status:
        row.isUp === false
          ? text(translationKey("Offline"))
          : text(translationKey("No data yet")),
      reasons: [],
      facts: [],
    };
  }

  const percent: number = (used / total) * 100;
  const full: boolean = percent > PROXMOX_STORAGE_NEAR_FULL_PERCENT;

  return {
    health: row.isUp === false ? "critical" : full ? "warning" : "healthy",
    status: text(translationKey("{{percent}} used"), {
      percent: formatTopologyPercent(percent, 1),
    }),
    reasons: full
      ? [
          text(translationKey("{{percent}} of the storage is used"), {
            percent: formatTopologyPercent(percent, 1),
          }),
        ]
      : [],
    facts: [
      {
        label: translationKey("Used"),
        value: formatTopologyPercent(percent),
        tone: full ? "warning" : undefined,
      },
      { label: translationKey("Capacity"), value: formatTopologyBytes(total) },
    ],
  };
}

export function buildProxmoxTopology(
  input: ProxmoxTopologyInput,
): ResourceTopologyGraph {
  const clusterId: string = input.cluster.id;
  const reporting: boolean =
    isRecent(input.cluster.lastSeenAt, input.now, PROXMOX_STALE_MS) ||
    input.rows.some((row: ProxmoxResource): boolean => {
      return isRecent(row.lastSeenAt, input.now, PROXMOX_STALE_MS);
    });
  const nodes: Array<ResourceTopologyNodeInput> = [
    {
      id: PROXMOX_ROOT_ID,
      parentId: null,
      kind: "proxmox.cluster",
      name: input.cluster.name || "Proxmox",
      health: reporting
        ? "healthy"
        : input.cluster.lastSeenAt
          ? "warning"
          : "unknown",
      status: reporting
        ? text(translationKey("Reporting"))
        : input.cluster.lastSeenAt
          ? text(translationKey("Not reporting"))
          : text(translationKey("No data yet")),
      link: { page: PageMap.PROXMOX_CLUSTER_VIEW, modelId: clusterId },
    },
  ];

  const nodeIds: Map<string, string> = new Map<string, string>();
  const guestsByVmid: Map<string, string> = new Map<string, string>();
  const storageIds: Map<string, string> = new Map<string, string>();

  for (const row of input.rows) {
    if (row.kind === "Node" && row.externalId) {
      const id: string = `node:${row.externalId}`;
      const assessment: Assessment = assessNode(row, input.now);
      nodeIds.set((row.name || "").toLowerCase(), id);
      nodes.push({
        id: id,
        parentId: PROXMOX_ROOT_ID,
        kind: "proxmox.node",
        name: row.name || row.externalId,
        health: assessment.health,
        status: assessment.status,
        reasons: assessment.reasons,
        facts: assessment.facts,
        link: {
          page: PageMap.PROXMOX_CLUSTER_VIEW_NODE_DETAIL,
          modelId: clusterId,
          subModelId: routeParam(row.externalId),
        },
      });
    }
  }

  const parentNode: (row: ProxmoxResource) => string = (
    row: ProxmoxResource,
  ): string => {
    return (
      nodeIds.get((row.parentNodeName || "").toLowerCase()) || PROXMOX_ROOT_ID
    );
  };

  for (const row of input.rows) {
    if (!row.externalId) {
      continue;
    }

    if (row.kind === "Guest") {
      const id: string = `guest:${row.externalId}`;
      const assessment: Assessment = assessGuest(row, input.now);
      const isContainer: boolean = (row.guestType || "").toLowerCase() === "lxc";

      if (row.vmid !== null && row.vmid !== undefined) {
        guestsByVmid.set(String(row.vmid), id);
      }

      nodes.push({
        id: id,
        parentId: parentNode(row),
        kind: isContainer ? "proxmox.lxc" : "proxmox.vm",
        name: row.name || row.externalId,
        health: assessment.health,
        status: assessment.status,
        reasons: assessment.reasons,
        facts: assessment.facts,
        context: row.parentNodeName || undefined,
        keywords:
          row.vmid !== null && row.vmid !== undefined ? [String(row.vmid)] : [],
        link: {
          page: PageMap.PROXMOX_CLUSTER_VIEW_GUEST_DETAIL,
          modelId: clusterId,
          subModelId: routeParam(row.externalId),
        },
      });
    } else if (row.kind === "Storage") {
      const id: string = `storage:${row.externalId}`;
      const assessment: Assessment = assessStorage(row);
      storageIds.set(`${row.parentNodeName || ""}/${row.name || ""}`.toLowerCase(), id);
      nodes.push({
        id: id,
        parentId: parentNode(row),
        kind: "proxmox.storage",
        name: row.name || row.externalId,
        health: assessment.health,
        status: assessment.status,
        reasons: assessment.reasons,
        facts: assessment.facts,
        context: row.parentNodeName || undefined,
        link: {
          page: PageMap.PROXMOX_CLUSTER_VIEW_STORAGE_DETAIL,
          modelId: clusterId,
          subModelId: routeParam(row.externalId),
        },
      });
    }
  }

  /*
   * pve-exporter names what a series is about in one `id` label
   * ("qemu/100", "lxc/101", "node/pve1", "storage/pve1/local"); a user's own
   * monitor may group by the parts instead.
   */
  const locate: (record: OpenIssueRecord) => string | null = (
    record: OpenIssueRecord,
  ): string | null => {
    const objectId: string =
      readSeriesLabel(record.seriesLabels, "id") ||
      readSeriesLabel(record.seriesLabels, "pve.id") ||
      "";
    const [type, ...rest] = objectId.split("/");
    const value: string = rest.join("/");

    if ((type === "qemu" || type === "lxc") && guestsByVmid.has(value)) {
      return guestsByVmid.get(value)!;
    }

    if (type === "node" && nodeIds.has(value.toLowerCase())) {
      return nodeIds.get(value.toLowerCase())!;
    }

    if (type === "storage") {
      const id: string | undefined = storageIds.get(value.toLowerCase());

      if (id) {
        return id;
      }
    }

    const vmid: string | null = readSeriesLabel(record.seriesLabels, "vmid");

    if (vmid && guestsByVmid.has(vmid)) {
      return guestsByVmid.get(vmid)!;
    }

    const node: string | null =
      readSeriesLabel(record.seriesLabels, "proxmox.node.name") ||
      readSeriesLabel(record.seriesLabels, "node");

    if (node) {
      for (const [name, id] of nodeIds) {
        if (sameName(name, node)) {
          return id;
        }
      }
    }

    return null;
  };

  return buildResourceTopologyGraph({
    rootId: PROXMOX_ROOT_ID,
    nodes: nodes,
    issues: attachOpenIssues({
      records: input.issues || [],
      rootId: PROXMOX_ROOT_ID,
      locate: locate,
    }),
    truncations: input.truncations,
  });
}
