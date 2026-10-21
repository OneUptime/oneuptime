import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import VMwareCollectionStatus from "Common/Types/VMware/VMwareCollectionStatus";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
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
 * A vCenter's topology: vCenter > datacenter > cluster > ESXi host > virtual
 * machine, with each datacenter's datastores and each cluster's (or
 * standalone host's) resource pools beside them — the inventory the
 * vCenter's Hosts, Virtual Machines, Datastores and Clusters pages list,
 * read from the same VMwareResource rows, so the map and the lists always
 * agree.
 *
 * Health follows the vCenter's Overview ("Needs attention") and the host
 * page, so a part is red or amber on the map for exactly the reason those
 * pages give:
 *
 *   - a cluster with hosts that are not effective (maintenance mode or
 *     unresponsive) is critical; a datacenter with hosts powered off or in
 *     standby needs attention;
 *   - a host vCenter stopped reporting needs attention, as does one past
 *     90% CPU or memory (the Host CPU / Memory Saturation templates);
 *   - a virtual machine the host swaps is critical; one that is ballooned
 *     or waits for a CPU (CPU ready over 10%) needs attention; a powered-off
 *     VM and a template are off, never a problem;
 *   - a datastore 90% full is critical, 80% needs attention (the Datastore
 *     Capacity templates).
 */

// The host page's "Not reporting" age, and the lists' "stale" age.
export const VMWARE_TOPOLOGY_STALE_MS: number = 15 * 60 * 1000;

export const VMWARE_DATASTORE_WARNING_PERCENT: number = 80;
export const VMWARE_DATASTORE_CRITICAL_PERCENT: number = 90;
export const VMWARE_CPU_READY_WARNING_PERCENT: number = 10;
export const VMWARE_HOST_SATURATION_PERCENT: number = 90;

export const VMWARE_ROOT_ID: string = "vcenter";

export interface VMwareTopologyVCenter {
  id: string;
  name: string;
  lastSeenAt?: Date | null | undefined;
  collectionStatus?: VMwareCollectionStatus | null | undefined;
}

export interface VMwareTopologyInput {
  vcenter: VMwareTopologyVCenter;
  rows: Array<VMwareResource>;
  issues?: Array<OpenIssueRecord> | undefined;
  now: Date;
  /* Rows in the inventory, when more were there than were read. */
  totalRows?: number | undefined;
}

/* `vcenter.vm.id` for a VM, `vcenter.host.name` for a host, ...: the URL id. */
export function vmwareRouteParam(externalId: string): string {
  return encodeURIComponent(externalId);
}

function text(
  value: string,
  values?: Record<string, string> | undefined,
): ResourceTopologyText {
  return values ? { text: value, values: values } : { text: value };
}

function nodeIdFor(kind: string, externalId: string): string {
  return `${kind}:${externalId}`;
}

function displayName(row: VMwareResource): string {
  if (row.name) {
    return row.name;
  }

  const externalId: string = row.externalId || "";
  const slash: number = externalId.lastIndexOf("/");

  return slash >= 0 ? externalId.substring(slash + 1) : externalId;
}

function percentOf(row: VMwareResource): number | null {
  const reported: number | null = toFiniteNumber(row.latestDiskPercent);

  if (reported !== null) {
    return reported;
  }

  const used: number | null = toFiniteNumber(row.latestDiskBytes);
  const total: number | null = toFiniteNumber(row.maxDiskBytes);

  return used !== null && total !== null && total > 0
    ? (used / total) * 100
    : null;
}

interface Assessment {
  health: ResourceTopologyHealth;
  status?: ResourceTopologyText | undefined;
  reasons: Array<ResourceTopologyText>;
  facts: Array<ResourceTopologyFact>;
}

function assessDatacenter(row: VMwareResource | null): Assessment {
  const reasons: Array<ResourceTopologyText> = [];
  let health: ResourceTopologyHealth = row ? "healthy" : "unknown";
  const hosts: number | null = toFiniteNumber(row?.hostCount);
  const hostsOn: number | null = toFiniteNumber(row?.poweredOnHostCount);

  if (hosts !== null && hostsOn !== null && hostsOn < hosts) {
    health = "warning";
    reasons.push(
      text(translationKey("Hosts powered off or in standby: {{count}}"), {
        count: String(hosts - hostsOn),
      }),
    );
  }

  return { health: health, reasons: reasons, facts: [] };
}

function assessCluster(row: VMwareResource | null): Assessment {
  const reasons: Array<ResourceTopologyText> = [];
  const facts: Array<ResourceTopologyFact> = [];
  let health: ResourceTopologyHealth = row ? "healthy" : "unknown";
  const total: number | null = toFiniteNumber(row?.hostCount);
  const effective: number | null = toFiniteNumber(row?.effectiveHostCount);

  if (total !== null && effective !== null) {
    facts.push({
      label: translationKey("Effective hosts"),
      value: `${effective}/${total}`,
      tone: effective < total ? "critical" : undefined,
    });

    if (effective < total) {
      health = "critical";
      reasons.push(
        text(
          translationKey(
            "Hosts not effective (maintenance mode or unresponsive): {{count}}",
          ),
          { count: String(total - effective) },
        ),
      );
    }
  }

  return { health: health, reasons: reasons, facts: facts };
}

function assessHost(row: VMwareResource, now: Date): Assessment {
  const reasons: Array<ResourceTopologyText> = [];
  const facts: Array<ResourceTopologyFact> = [];

  if (!row.metricsUpdatedAt) {
    return {
      health: "unknown",
      status: text(translationKey("No data yet")),
      reasons: [],
      facts: [],
    };
  }

  if (!isRecent(row.metricsUpdatedAt, now, VMWARE_TOPOLOGY_STALE_MS)) {
    return {
      health: "warning",
      status: text(translationKey("Not reporting")),
      reasons: [
        text(
          translationKey(
            "vCenter has sent no metrics for this host for more than 15 minutes.",
          ),
        ),
      ],
      facts: [],
    };
  }

  let health: ResourceTopologyHealth = "healthy";
  const cpu: number | null = toFiniteNumber(row.latestCpuPercent);
  const memory: number | null = toFiniteNumber(row.latestMemoryPercent);

  if (cpu !== null) {
    const hot: boolean = cpu > VMWARE_HOST_SATURATION_PERCENT;
    facts.push({
      label: translationKey("CPU"),
      value: formatTopologyPercent(cpu),
      tone: hot ? "warning" : undefined,
    });

    if (hot) {
      health = "warning";
      reasons.push(
        text(translationKey("CPU at {{percent}}"), {
          percent: formatTopologyPercent(cpu, 1),
        }),
      );
    }
  }

  if (memory !== null) {
    const hot: boolean = memory > VMWARE_HOST_SATURATION_PERCENT;
    facts.push({
      label: translationKey("Memory"),
      value: formatTopologyPercent(memory),
      tone: hot ? "warning" : undefined,
    });

    if (hot) {
      health = "warning";
      reasons.push(
        text(translationKey("Memory at {{percent}}"), {
          percent: formatTopologyPercent(memory, 1),
        }),
      );
    }
  }

  return {
    health: health,
    status: text(translationKey("Reporting")),
    reasons: reasons,
    facts: facts,
  };
}

function assessVirtualMachine(row: VMwareResource, now: Date): Assessment {
  if (row.isTemplate) {
    return {
      health: "off",
      status: text(translationKey("Template")),
      reasons: [],
      facts: [],
    };
  }

  if (row.isPoweredOn === false) {
    return {
      health: "off",
      status: text(translationKey("Powered off")),
      reasons: [],
      facts: [],
    };
  }

  if (row.isPoweredOn !== true) {
    return {
      health: "unknown",
      status: text(translationKey("No data yet")),
      reasons: [],
      facts: [],
    };
  }

  const fresh: boolean = isRecent(
    row.metricsUpdatedAt,
    now,
    VMWARE_TOPOLOGY_STALE_MS,
  );

  if (!fresh) {
    return {
      health: "unknown",
      status: text(translationKey("Not reporting")),
      reasons: [],
      facts: [],
    };
  }

  const reasons: Array<ResourceTopologyText> = [];
  const facts: Array<ResourceTopologyFact> = [];
  let health: ResourceTopologyHealth = "healthy";

  const swapped: number | null = toFiniteNumber(row.memorySwappedBytes);
  const ballooned: number | null = toFiniteNumber(row.memoryBalloonedBytes);
  const ready: number | null = toFiniteNumber(row.cpuReadinessPercent);
  const cpu: number | null = toFiniteNumber(row.latestCpuPercent);
  const memory: number | null = toFiniteNumber(row.latestMemoryPercent);

  if (swapped !== null && swapped > 0) {
    health = "critical";
    reasons.push(
      text(translationKey("{{amount}} of memory swapped by the host"), {
        amount: formatTopologyBytes(swapped),
      }),
    );
  }

  if (ballooned !== null && ballooned > 0) {
    health = health === "critical" ? health : "warning";
    reasons.push(
      text(translationKey("{{amount}} of memory ballooned"), {
        amount: formatTopologyBytes(ballooned),
      }),
    );
  }

  if (ready !== null && ready > VMWARE_CPU_READY_WARNING_PERCENT) {
    health = health === "critical" ? health : "warning";
    reasons.push(
      text(translationKey("CPU ready {{percent}} (host CPU contention)"), {
        percent: formatTopologyPercent(ready, 1),
      }),
    );
  }

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

  return {
    health: health,
    status: text(translationKey("Running")),
    reasons: reasons,
    facts: facts,
  };
}

function assessDatastore(row: VMwareResource): Assessment {
  const percent: number | null = percentOf(row);
  const facts: Array<ResourceTopologyFact> = [];
  const capacity: number | null = toFiniteNumber(row.maxDiskBytes);

  if (percent === null) {
    return {
      health: "unknown",
      status: text(translationKey("No data yet")),
      reasons: [],
      facts: [],
    };
  }

  const health: ResourceTopologyHealth =
    percent >= VMWARE_DATASTORE_CRITICAL_PERCENT
      ? "critical"
      : percent >= VMWARE_DATASTORE_WARNING_PERCENT
        ? "warning"
        : "healthy";

  facts.push({
    label: translationKey("Used"),
    value: formatTopologyPercent(percent),
    tone:
      health === "critical"
        ? "critical"
        : health === "warning"
          ? "warning"
          : undefined,
  });

  if (capacity !== null) {
    facts.push({
      label: translationKey("Capacity"),
      value: formatTopologyBytes(capacity),
    });
  }

  return {
    health: health,
    status: text(translationKey("{{percent}} used"), {
      percent: formatTopologyPercent(percent, 1),
    }),
    reasons:
      health === "healthy"
        ? []
        : [
            text(translationKey("{{percent}} of the datastore is used"), {
              percent: formatTopologyPercent(percent, 1),
            }),
          ],
    facts: facts,
  };
}

function assessVCenter(
  vcenter: VMwareTopologyVCenter,
  rows: Array<VMwareResource>,
  now: Date,
): Assessment {
  if (vcenter.collectionStatus === VMwareCollectionStatus.Failed) {
    return {
      health: "critical",
      status: text(translationKey("Collection failing")),
      reasons: [
        text(
          translationKey(
            "OneUptime could not collect this vCenter's inventory the last time it tried. Its Overview says why.",
          ),
        ),
      ],
      facts: [],
    };
  }

  const reporting: boolean =
    isRecent(vcenter.lastSeenAt, now, VMWARE_TOPOLOGY_STALE_MS) ||
    rows.some((row: VMwareResource): boolean => {
      return isRecent(row.metricsUpdatedAt, now, VMWARE_TOPOLOGY_STALE_MS);
    });

  if (reporting) {
    return {
      health: "healthy",
      status: text(translationKey("Reporting")),
      reasons: [],
      facts: [],
    };
  }

  if (!vcenter.lastSeenAt && rows.length === 0) {
    return {
      health: "unknown",
      status: text(translationKey("No data yet")),
      reasons: [],
      facts: [],
    };
  }

  return {
    health: "warning",
    status: text(translationKey("Not reporting")),
    reasons: [
      text(
        translationKey(
          "Nothing has arrived from this vCenter for more than 15 minutes.",
        ),
      ),
    ],
    facts: [],
  };
}

export function buildVMwareTopology(
  input: VMwareTopologyInput,
): ResourceTopologyGraph {
  const vcenterId: string = input.vcenter.id;
  const nodes: Array<ResourceTopologyNodeInput> = [];
  const rowsByKind: Map<string, Array<VMwareResource>> = new Map<
    string,
    Array<VMwareResource>
  >();

  for (const row of input.rows) {
    if (!row.kind || !row.externalId) {
      continue;
    }

    const list: Array<VMwareResource> = rowsByKind.get(row.kind) || [];
    list.push(row);
    rowsByKind.set(row.kind, list);
  }

  const rowsOf: (kind: VMwareResourceKind) => Array<VMwareResource> = (
    kind: VMwareResourceKind,
  ): Array<VMwareResource> => {
    return rowsByKind.get(kind) || [];
  };

  const root: Assessment = assessVCenter(input.vcenter, input.rows, input.now);
  nodes.push({
    id: VMWARE_ROOT_ID,
    parentId: null,
    kind: "vmware.vcenter",
    name: input.vcenter.name || "vCenter",
    health: root.health,
    status: root.status,
    reasons: root.reasons,
    link: { page: PageMap.VMWARE_VCENTER_VIEW, modelId: vcenterId },
  });

  // Datacenters: from their rows, or from what says it lives in one.
  const datacenterIds: Map<string, string> = new Map<string, string>();
  const ensureDatacenter: (name: string | undefined) => string = (
    name: string | undefined,
  ): string => {
    if (!name) {
      return VMWARE_ROOT_ID;
    }

    const existing: string | undefined = datacenterIds.get(name);

    if (existing) {
      return existing;
    }

    const id: string = nodeIdFor("vmware.datacenter", `datacenter/${name}`);
    const assessment: Assessment = assessDatacenter(null);
    datacenterIds.set(name, id);
    nodes.push({
      id: id,
      parentId: VMWARE_ROOT_ID,
      kind: "vmware.datacenter",
      name: name,
      health: assessment.health,
      reasons: assessment.reasons,
    });

    return id;
  };

  for (const row of rowsOf(VMwareResourceKind.Datacenter)) {
    const name: string = displayName(row);

    if (datacenterIds.has(name)) {
      continue;
    }

    const id: string = nodeIdFor("vmware.datacenter", `datacenter/${name}`);
    const assessment: Assessment = assessDatacenter(row);
    datacenterIds.set(name, id);
    nodes.push({
      id: id,
      parentId: VMWARE_ROOT_ID,
      kind: "vmware.datacenter",
      name: name,
      health: assessment.health,
      reasons: assessment.reasons,
      facts: assessment.facts,
    });
  }

  // Clusters, under their datacenter.
  const clusterIds: Map<string, string> = new Map<string, string>();
  const clusterKey: (dc: string | undefined, cluster: string) => string = (
    dc: string | undefined,
    cluster: string,
  ): string => {
    return `${dc || ""}/${cluster}`;
  };

  for (const row of rowsOf(VMwareResourceKind.Cluster)) {
    const name: string = row.clusterName || displayName(row);
    const id: string = nodeIdFor("vmware.cluster", row.externalId!);
    const assessment: Assessment = assessCluster(row);
    clusterIds.set(clusterKey(row.datacenterName, name), id);
    nodes.push({
      id: id,
      parentId: ensureDatacenter(row.datacenterName),
      kind: "vmware.cluster",
      name: name,
      health: assessment.health,
      reasons: assessment.reasons,
      facts: assessment.facts,
      context: row.datacenterName || undefined,
      link: {
        page: PageMap.VMWARE_VCENTER_VIEW_CLUSTER_DETAIL,
        modelId: vcenterId,
        subModelId: vmwareRouteParam(row.externalId!),
      },
    });
  }

  const ensureCluster: (
    dc: string | undefined,
    cluster: string | undefined,
  ) => string = (
    dc: string | undefined,
    cluster: string | undefined,
  ): string => {
    if (!cluster) {
      return ensureDatacenter(dc);
    }

    const key: string = clusterKey(dc, cluster);
    const existing: string | undefined = clusterIds.get(key);

    if (existing) {
      return existing;
    }

    const id: string = nodeIdFor(
      "vmware.cluster",
      `cluster/${dc || ""}/${cluster}`,
    );
    clusterIds.set(key, id);
    nodes.push({
      id: id,
      parentId: ensureDatacenter(dc),
      kind: "vmware.cluster",
      name: cluster,
      health: "unknown",
      context: dc || undefined,
    });

    return id;
  };

  // ESXi hosts, under their cluster or (standalone) their datacenter.
  const hostIds: Map<string, string> = new Map<string, string>();
  const hostsByName: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  const hostKey: (dc: string | undefined, host: string) => string = (
    dc: string | undefined,
    host: string,
  ): string => {
    return `${dc || ""}/${host}`;
  };

  for (const row of rowsOf(VMwareResourceKind.Host)) {
    const name: string = row.hostName || displayName(row);
    const id: string = nodeIdFor("vmware.host", row.externalId!);
    const assessment: Assessment = assessHost(row, input.now);
    hostIds.set(hostKey(row.datacenterName, name), id);
    hostsByName.set(name.toLowerCase(), [
      ...(hostsByName.get(name.toLowerCase()) || []),
      id,
    ]);
    nodes.push({
      id: id,
      parentId: ensureCluster(row.datacenterName, row.clusterName),
      kind: "vmware.host",
      name: name,
      health: assessment.health,
      status: assessment.status,
      reasons: assessment.reasons,
      facts: assessment.facts,
      context: row.clusterName || row.datacenterName || undefined,
      link: {
        page: PageMap.VMWARE_VCENTER_VIEW_HOST_DETAIL,
        modelId: vcenterId,
        subModelId: vmwareRouteParam(row.externalId!),
      },
    });
  }

  const findHost: (
    dc: string | undefined,
    host: string | undefined,
  ) => string | null = (
    dc: string | undefined,
    host: string | undefined,
  ): string | null => {
    if (!host) {
      return null;
    }

    const exact: string | undefined = hostIds.get(hostKey(dc, host));

    if (exact) {
      return exact;
    }

    const byName: Array<string> = hostsByName.get(host.toLowerCase()) || [];

    return byName.length === 1 ? byName[0]! : null;
  };

  // Virtual machines and templates, on the host they run on.
  const vmsById: Map<string, string> = new Map<string, string>();
  const vmsByName: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();

  for (const row of rowsOf(VMwareResourceKind.VirtualMachine)) {
    const name: string = displayName(row);
    const id: string = nodeIdFor("vmware.vm", row.externalId!);
    const assessment: Assessment = assessVirtualMachine(row, input.now);
    const host: string | null = findHost(row.datacenterName, row.hostName);

    if (row.vmInstanceUuid) {
      vmsById.set(row.vmInstanceUuid.toLowerCase(), id);
    }

    vmsByName.set(name.toLowerCase(), [
      ...(vmsByName.get(name.toLowerCase()) || []),
      id,
    ]);

    nodes.push({
      id: id,
      parentId: host || ensureCluster(row.datacenterName, row.clusterName),
      kind: row.isTemplate ? "vmware.template" : "vmware.vm",
      name: name,
      health: assessment.health,
      status: assessment.status,
      reasons: assessment.reasons,
      facts: assessment.facts,
      context: row.hostName || row.clusterName || undefined,
      keywords: [
        row.vmInstanceUuid || "",
        row.resourcePoolName || "",
        row.virtualAppName || "",
      ].filter((keyword: string): boolean => {
        return keyword.length > 0;
      }),
      link: {
        page: PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL,
        modelId: vcenterId,
        subModelId: vmwareRouteParam(row.externalId!),
      },
    });
  }

  // Datastores, in their datacenter.
  const datastoreIds: Map<string, string> = new Map<string, string>();

  for (const row of rowsOf(VMwareResourceKind.Datastore)) {
    const name: string = displayName(row);
    const id: string = nodeIdFor("vmware.datastore", row.externalId!);
    const assessment: Assessment = assessDatastore(row);
    datastoreIds.set(`${row.datacenterName || ""}/${name}`.toLowerCase(), id);
    nodes.push({
      id: id,
      parentId: ensureDatacenter(row.datacenterName),
      kind: "vmware.datastore",
      name: name,
      health: assessment.health,
      status: assessment.status,
      reasons: assessment.reasons,
      facts: assessment.facts,
      context: row.datacenterName || undefined,
      link: {
        page: PageMap.VMWARE_VCENTER_VIEW_DATASTORE_DETAIL,
        modelId: vcenterId,
        subModelId: vmwareRouteParam(row.externalId!),
      },
    });
  }

  // Resource pools, on the cluster (or standalone host) that owns them.
  const poolIds: Map<string, string> = new Map<string, string>();

  for (const row of rowsOf(VMwareResourceKind.ResourcePool)) {
    const name: string = row.resourcePoolName || displayName(row);
    const id: string = nodeIdFor("vmware.resourcepool", row.externalId!);
    const owner: string =
      (row.clusterName
        ? ensureCluster(row.datacenterName, row.clusterName)
        : findHost(row.datacenterName, row.hostName)) ||
      ensureDatacenter(row.datacenterName);

    if (row.resourcePoolPath) {
      poolIds.set(row.resourcePoolPath.toLowerCase(), id);
    }

    poolIds.set(name.toLowerCase(), id);
    nodes.push({
      id: id,
      parentId: owner,
      kind: "vmware.resourcepool",
      name: name,
      health: "healthy",
      context: row.clusterName || row.hostName || undefined,
      keywords: row.resourcePoolPath ? [row.resourcePoolPath] : [],
      link: {
        page: PageMap.VMWARE_VCENTER_VIEW_RESOURCE_POOLS,
        modelId: vcenterId,
      },
    });
  }

  /*
   * An open incident or alert is about the most specific part its labels
   * name: a VM, then a host, a datastore, a cluster, a resource pool, a
   * datacenter — or else the vCenter itself.
   */
  const locate: (record: OpenIssueRecord) => string | null = (
    record: OpenIssueRecord,
  ): string | null => {
    const labels: OpenIssueRecord["seriesLabels"] = record.seriesLabels;
    const dc: string | null = readSeriesLabel(
      labels,
      "vcenter.datacenter.name",
    );
    const vmId: string | null =
      readSeriesLabel(labels, "vcenter.vm.id") ||
      readSeriesLabel(labels, "vcenter.vm_template.id");

    if (vmId && vmsById.has(vmId.toLowerCase())) {
      return vmsById.get(vmId.toLowerCase())!;
    }

    const vmName: string | null =
      readSeriesLabel(labels, "vcenter.vm.name") ||
      readSeriesLabel(labels, "vcenter.vm_template.name");

    if (vmName) {
      const candidates: Array<string> =
        vmsByName.get(vmName.toLowerCase()) || [];

      if (candidates.length === 1) {
        return candidates[0]!;
      }
    }

    const host: string | null = readSeriesLabel(labels, "vcenter.host.name");
    const hostId: string | null = findHost(dc || undefined, host || undefined);

    if (hostId) {
      return hostId;
    }

    const datastore: string | null = readSeriesLabel(
      labels,
      "vcenter.datastore.name",
    );

    if (datastore) {
      const exact: string | undefined = datastoreIds.get(
        `${dc || ""}/${datastore}`.toLowerCase(),
      );

      if (exact) {
        return exact;
      }

      for (const [key, id] of datastoreIds) {
        if (sameName(key.substring(key.lastIndexOf("/") + 1), datastore)) {
          return id;
        }
      }
    }

    const cluster: string | null = readSeriesLabel(
      labels,
      "vcenter.cluster.name",
    );

    if (cluster) {
      for (const [key, id] of clusterIds) {
        const [clusterDc, clusterName] = [
          key.substring(0, key.lastIndexOf("/")),
          key.substring(key.lastIndexOf("/") + 1),
        ];

        if (sameName(clusterName, cluster) && (!dc || sameName(clusterDc, dc))) {
          return id;
        }
      }
    }

    const pool: string | null =
      readSeriesLabel(labels, "vcenter.resource_pool.inventory_path") ||
      readSeriesLabel(labels, "vcenter.resource_pool.name");

    if (pool && poolIds.has(pool.toLowerCase())) {
      return poolIds.get(pool.toLowerCase())!;
    }

    if (dc && datacenterIds.has(dc)) {
      return datacenterIds.get(dc)!;
    }

    return null;
  };

  const truncations: Array<ResourceTopologyTruncation> = [];

  if (
    input.totalRows !== undefined &&
    input.totalRows > input.rows.length
  ) {
    truncations.push({
      kind: "vmware.vcenter",
      shown: input.rows.length,
      total: input.totalRows,
    });
  }

  return buildResourceTopologyGraph({
    rootId: VMWARE_ROOT_ID,
    nodes: nodes,
    issues: attachOpenIssues({
      records: input.issues || [],
      rootId: VMWARE_ROOT_ID,
      locate: locate,
    }),
    truncations: truncations,
  });
}
