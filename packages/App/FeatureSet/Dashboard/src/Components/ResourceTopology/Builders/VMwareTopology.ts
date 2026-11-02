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
import {
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../ResourcePart/ResourceAttention";
import { ResourcePartStatus } from "../../ResourcePart/ResourcePartTypes";
import {
  VMWARE_CPU_READY_WARNING_PERCENT as RULES_CPU_READY_WARNING_PERCENT,
  VMWARE_DATASTORE_CRITICAL_PERCENT as RULES_DATASTORE_CRITICAL_PERCENT,
  VMWARE_DATASTORE_WARNING_PERCENT as RULES_DATASTORE_WARNING_PERCENT,
  VMWARE_HOST_SATURATION_PERCENT as RULES_HOST_SATURATION_PERCENT,
  VMWARE_READINGS_STALE_MS,
  VMwareAssessment,
  VMwareDatacenterFinding,
  VMwareHostState,
  assessVMwareClusterWithHosts,
  assessVMwareDatastore,
  assessVMwareHost,
  assessVMwareVirtualMachine,
  findVMwareDatacenter,
  getVMwareDatacenterFindings,
  getVMwareDatastoreStatus,
  getVMwareHostState,
  getVMwareHostStatus,
  getVMwareVirtualMachineStatus,
  isVMwareHostRunning,
  mergeVMwareSeverities,
} from "../../../Pages/VMware/Utils/VMwareHealth";

/*
 * A vCenter's topology: vCenter > datacenter > cluster > ESXi host > virtual
 * machine, with each datacenter's datastores and each cluster's (or
 * standalone host's) resource pools beside them — the inventory the
 * vCenter's Hosts, Virtual Machines, Datastores and Clusters pages list,
 * read from the same VMwareResource rows, so the map and the lists always
 * agree.
 *
 * Health is the vCenter's one set of rules (Pages/VMware/Utils/VMwareHealth),
 * so a part is red or amber on the map for exactly the reason its page, its
 * list and the Overview's Needs attention give: an ESXi host vCenter cannot
 * reach is critical, one powered off or in standby is off, a busy one needs
 * attention; a VM the host swaps is critical, one ballooned or waiting for a
 * CPU needs attention; a datastore past 90% is critical and past 80% needs
 * attention; a cluster with a host that is not responding is critical, one
 * running with hosts that are not effective, or without the memory to lose
 * a host, needs attention; a datacenter's own alarm counts say what no part
 * of it does.
 */

// The rules' "Not reporting" age, and the lists' "stale" age.
export const VMWARE_TOPOLOGY_STALE_MS: number = VMWARE_READINGS_STALE_MS;

export const VMWARE_DATASTORE_WARNING_PERCENT: number =
  RULES_DATASTORE_WARNING_PERCENT;
export const VMWARE_DATASTORE_CRITICAL_PERCENT: number =
  RULES_DATASTORE_CRITICAL_PERCENT;
export const VMWARE_CPU_READY_WARNING_PERCENT: number =
  RULES_CPU_READY_WARNING_PERCENT;
export const VMWARE_HOST_SATURATION_PERCENT: number =
  RULES_HOST_SATURATION_PERCENT;

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

interface Assessment {
  health: ResourceTopologyHealth;
  status?: ResourceTopologyText | undefined;
  reasons: Array<ResourceTopologyText>;
  facts: Array<ResourceTopologyFact>;
}

// A rule's words as the map draws them: a count's form picked by its count.
function toTopologyText(value: ResourceAttentionText): ResourceTopologyText {
  if (value.plural) {
    return {
      text: value.plural.count === 1 ? value.plural.one : value.text,
      values: { ...(value.values || {}), count: String(value.plural.count) },
    };
  }
  return value.values ? text(value.text, value.values) : text(value.text);
}

function toTopologyStatus(status: ResourcePartStatus): ResourceTopologyText {
  return status.values ? text(status.label, status.values) : text(status.label);
}

function healthOf(
  severity: ResourceAttentionSeverity | null,
): ResourceTopologyHealth {
  if (severity === ResourceAttentionSeverity.Critical) {
    return "critical";
  }
  if (severity === ResourceAttentionSeverity.Warning) {
    return "warning";
  }
  return "healthy";
}

// The context the rules read beside a part: its datacenters and hosts.
interface VMwareTopologyContext {
  datacenters: Array<VMwareResource>;
  hosts: Array<VMwareResource>;
  now: Date;
}

function assessDatacenter(
  row: VMwareResource | null,
  context: VMwareTopologyContext,
): Assessment {
  if (!row) {
    return { health: "unknown", reasons: [], facts: [] };
  }
  const findings: Array<VMwareDatacenterFinding> = getVMwareDatacenterFindings(
    {
      datacenter: row,
      hosts: context.hosts,
      now: context.now,
    },
  );
  const reasons: Array<ResourceTopologyText> = [];
  for (const finding of findings) {
    for (const reason of finding.reasons) {
      reasons.push(toTopologyText(reason));
    }
  }
  return {
    health: healthOf(
      mergeVMwareSeverities(
        findings.map(
          (
            finding: VMwareDatacenterFinding,
          ): ResourceAttentionSeverity | null => {
            return finding.severity;
          },
        ),
      ),
    ),
    reasons: reasons,
    facts: [],
  };
}

function assessCluster(
  row: VMwareResource | null,
  context: VMwareTopologyContext,
): Assessment {
  if (!row) {
    return { health: "unknown", reasons: [], facts: [] };
  }
  const facts: Array<ResourceTopologyFact> = [];
  const total: number | null = toFiniteNumber(row.hostCount);
  const effective: number | null = toFiniteNumber(row.effectiveHostCount);

  if (total !== null && effective !== null) {
    facts.push({
      label: translationKey("Effective hosts"),
      value: `${effective}/${total}`,
      tone: effective < total ? "warning" : undefined,
    });
  }

  if (!isRecent(row.metricsUpdatedAt, context.now, VMWARE_TOPOLOGY_STALE_MS)) {
    return { health: "unknown", reasons: [], facts: facts };
  }

  const assessment: VMwareAssessment = assessVMwareClusterWithHosts({
    cluster: row,
    hosts: context.hosts,
    datacenters: context.datacenters,
    now: context.now,
  });

  return {
    health: healthOf(assessment.severity),
    reasons: assessment.reasons.map(toTopologyText),
    facts: facts,
  };
}

function usageFacts(row: VMwareResource): Array<ResourceTopologyFact> {
  const facts: Array<ResourceTopologyFact> = [];
  const cpu: number | null = toFiniteNumber(row.latestCpuPercent);
  const memory: number | null = toFiniteNumber(row.latestMemoryPercent);

  if (cpu !== null) {
    facts.push({
      label: translationKey("CPU"),
      value: formatTopologyPercent(cpu),
      tone: cpu > VMWARE_HOST_SATURATION_PERCENT ? "warning" : undefined,
    });
  }
  if (memory !== null) {
    facts.push({
      label: translationKey("Memory"),
      value: formatTopologyPercent(memory),
      tone: memory > VMWARE_HOST_SATURATION_PERCENT ? "warning" : undefined,
    });
  }
  return facts;
}

function assessHost(
  row: VMwareResource,
  context: VMwareTopologyContext,
): Assessment {
  const datacenter: VMwareResource | null = findVMwareDatacenter(
    context.datacenters,
    row.datacenterName,
  );
  const state: VMwareHostState = getVMwareHostState({
    host: row,
    datacenter: datacenter,
    now: context.now,
  });
  const status: ResourceTopologyText = toTopologyStatus(
    getVMwareHostStatus({ host: row, datacenter: datacenter, now: context.now }),
  );
  const assessment: VMwareAssessment = assessVMwareHost({
    host: row,
    datacenter: datacenter,
    now: context.now,
  });

  if (
    state === VMwareHostState.PoweredOff ||
    state === VMwareHostState.Standby ||
    state === VMwareHostState.PoweredOffOrStandby
  ) {
    return { health: "off", status: status, reasons: [], facts: [] };
  }
  if (
    state === VMwareHostState.NoDataYet ||
    state === VMwareHostState.NotReporting
  ) {
    return { health: "unknown", status: status, reasons: [], facts: [] };
  }

  return {
    health: healthOf(assessment.severity),
    status: status,
    reasons: assessment.reasons.map(toTopologyText),
    facts: isVMwareHostRunning(state) ? usageFacts(row) : [],
  };
}

function assessVirtualMachine(
  row: VMwareResource,
  context: VMwareTopologyContext,
): Assessment {
  const status: ResourceTopologyText = toTopologyStatus(
    getVMwareVirtualMachineStatus({ vm: row, now: context.now }),
  );

  if (row.isTemplate || row.isPoweredOn === false) {
    return { health: "off", status: status, reasons: [], facts: [] };
  }

  if (
    row.isPoweredOn !== true ||
    !isRecent(row.metricsUpdatedAt, context.now, VMWARE_TOPOLOGY_STALE_MS)
  ) {
    return { health: "unknown", status: status, reasons: [], facts: [] };
  }

  const assessment: VMwareAssessment = assessVMwareVirtualMachine({
    vm: row,
    now: context.now,
  });

  return {
    health: healthOf(assessment.severity),
    status: status,
    reasons: assessment.reasons.map(toTopologyText),
    facts: usageFacts(row).map(
      (fact: ResourceTopologyFact): ResourceTopologyFact => {
        // A VM's own CPU and memory are its business: drawn, never toned.
        return { label: fact.label, value: fact.value };
      },
    ),
  };
}

function assessDatastore(
  row: VMwareResource,
  context: VMwareTopologyContext,
): Assessment {
  const facts: Array<ResourceTopologyFact> = [];
  const capacity: number | null = toFiniteNumber(row.maxDiskBytes);
  if (capacity !== null) {
    facts.push({
      label: translationKey("Capacity"),
      value: formatTopologyBytes(capacity),
    });
  }

  const status: ResourcePartStatus = getVMwareDatastoreStatus({
    datastore: row,
    now: context.now,
  });
  if (!status.values) {
    // No size reported yet, or not reported lately: nothing to judge.
    return {
      health: "unknown",
      status: toTopologyStatus(status),
      reasons: [],
      facts: facts,
    };
  }

  const assessment: VMwareAssessment = assessVMwareDatastore({
    datastore: row,
    now: context.now,
  });

  return {
    health: healthOf(assessment.severity),
    status: toTopologyStatus(status),
    reasons: assessment.reasons.map(toTopologyText),
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

  const context: VMwareTopologyContext = {
    datacenters: rowsOf(VMwareResourceKind.Datacenter),
    hosts: rowsOf(VMwareResourceKind.Host),
    now: input.now,
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
    const assessment: Assessment = assessDatacenter(null, context);
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
    const assessment: Assessment = assessDatacenter(row, context);
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
  const clusterLookup: (dc: string | undefined, cluster: string) => string = (
    dc: string | undefined,
    cluster: string,
  ): string => {
    return `${dc || ""}/${cluster}`;
  };

  for (const row of rowsOf(VMwareResourceKind.Cluster)) {
    const name: string = row.clusterName || displayName(row);
    const id: string = nodeIdFor("vmware.cluster", row.externalId!);
    const assessment: Assessment = assessCluster(row, context);
    clusterIds.set(clusterLookup(row.datacenterName, name), id);
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

    const key: string = clusterLookup(dc, cluster);
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
    const assessment: Assessment = assessHost(row, context);
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
    const assessment: Assessment = assessVirtualMachine(row, context);
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
    const assessment: Assessment = assessDatastore(row, context);
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

        if (
          sameName(clusterName, cluster) &&
          (!dc || sameName(clusterDc, dc))
        ) {
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

  if (input.totalRows !== undefined && input.totalRows > input.rows.length) {
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
