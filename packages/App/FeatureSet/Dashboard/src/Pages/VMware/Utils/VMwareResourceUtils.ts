import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import { InfrastructureResource } from "../../../Components/Infrastructure/ResourceTable";

/*
 * Shared helpers for the VMware list/detail pages. The pages read the
 * VMwareResource Postgres inventory table (populated by the OTel metrics
 * ingest path from the collector's `vcenter` receiver stream) instead of
 * groupBy-ing over ClickHouse metric data — same architecture as the
 * Proxmox pages (Pages/Proxmox/Utils/ProxmoxResourceUtils.ts) and the
 * Kubernetes pages.
 */

/*
 * Latest metric values older than this are treated as "no data" by the
 * list views so bars don't lie about an object that's fallen off the
 * metric stream. Matches the cleanup worker's stale-resource cutoff
 * (VMWARE_INVENTORY_STALE_MINUTES default).
 */
export const METRIC_STALE_MS: number = 15 * 60 * 1000;

export { VMwareResourceKind };

/** Human-readable singular label per inventory kind. */
export function kindLabel(kind: string | undefined | null): string {
  switch (kind) {
    case VMwareResourceKind.Datacenter:
      return "Datacenter";
    case VMwareResourceKind.Cluster:
      return "Cluster";
    case VMwareResourceKind.Host:
      return "ESXi Host";
    case VMwareResourceKind.VirtualMachine:
      return "Virtual Machine";
    case VMwareResourceKind.Datastore:
      return "Datastore";
    case VMwareResourceKind.ResourcePool:
      return "Resource Pool";
    default:
      return kind || "Resource";
  }
}

/** Human-readable plural label per inventory kind. */
export function kindPluralLabel(kind: string | undefined | null): string {
  switch (kind) {
    case VMwareResourceKind.Datacenter:
      return "Datacenters";
    case VMwareResourceKind.Cluster:
      return "Clusters";
    case VMwareResourceKind.Host:
      return "ESXi Hosts";
    case VMwareResourceKind.VirtualMachine:
      return "Virtual Machines";
    case VMwareResourceKind.Datastore:
      return "Datastores";
    case VMwareResourceKind.ResourcePool:
      return "Resource Pools";
    default:
      return kind || "Resources";
  }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return "—";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units: Array<string> = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value: number = bytes / 1024;
  let idx: number = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[idx]}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

/*
 * CPU usage / capacity / limits come off the vcenter receiver in MHz.
 * Render GHz once the value is large enough to read comfortably.
 */
export function formatMhz(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(value >= 100000 ? 0 : 2)} GHz`;
  }
  return `${Math.round(value)} MHz`;
}

export function formatBytesForChart(value: number): string {
  return formatBytes(value);
}

/*
 * The detail-route param is the inventory `externalId` verbatim
 * (`host/<dc>/<host>`, `vm/<instance-uuid>`, `datastore/<dc>/<name>`,
 * `cluster/<dc>/<cluster>`). It contains slashes, and vSphere object
 * names may contain spaces, so it must travel through the URL
 * percent-encoded as a single path segment. Always pair these two
 * helpers — RouteUtil.populateRouteParams inserts the value raw.
 */
export function routeParamFromExternalId(externalId: string): string {
  return encodeURIComponent(externalId);
}

export function externalIdFromRouteParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

/*
 * Display name for a resource: prefer the vSphere object name; fall back
 * to the last path segment of the externalId (`esx01.example.com`,
 * `datastore1`, the instance UUID for a VM).
 */
export function displayNameForResource(row: VMwareResourceModel): string {
  if (row.name) {
    return row.name;
  }
  const externalId: string = row.externalId || "";
  const slashIndex: number = externalId.lastIndexOf("/");
  if (slashIndex >= 0) {
    return externalId.substring(slashIndex + 1);
  }
  return externalId;
}

/*
 * Power-state label for a VM row. The vcenter receiver emits
 * `vcenter.vm.cpu.*` only for powered-on VMs, so ingest infers
 * `isPoweredOn` per scrape; it does not distinguish "off" from
 * "suspended", hence the single "Powered off" label. Templates never
 * run, so they render as "Template" rather than a power state.
 */
export function powerStateLabelForVM(row: VMwareResourceModel): string {
  if (row.isTemplate) {
    return "Template";
  }
  if (row.isPoweredOn === true) {
    return "Powered on";
  }
  if (row.isPoweredOn === false) {
    return "Powered off";
  }
  return "";
}

/*
 * Kind-specific display status for the shared ResourceTable status
 * pill. Only VMs have a state the receiver lets us infer — "Running"
 * hits ResourceTable.getStatusBadgeClass's green branch, "Powered off"
 * deliberately renders as the neutral gray pill (a planned shutdown is
 * not an error), "Template" is gray too. Hosts, datastores, clusters and
 * resource pools have no per-object state in the receiver's output (a
 * non-goal — the datacenter/cluster count metrics carry host health),
 * so their pages hide the status column.
 */
export function displayStatusForResource(row: VMwareResourceModel): string {
  if (row.kind !== VMwareResourceKind.VirtualMachine) {
    return "";
  }
  if (row.isTemplate) {
    return "Template";
  }
  if (row.isPoweredOn === true) {
    return "Running";
  }
  if (row.isPoweredOn === false) {
    return "Powered off";
  }
  return "";
}

const INVENTORY_SELECT: Record<string, boolean> = {
  kind: true,
  externalId: true,
  name: true,
  datacenterName: true,
  clusterName: true,
  hostName: true,
  resourcePoolName: true,
  resourcePoolPath: true,
  virtualAppName: true,
  vmInstanceUuid: true,
  isTemplate: true,
  isPoweredOn: true,
  latestCpuPercent: true,
  latestCpuMhz: true,
  cpuCapacityMhz: true,
  cpuEffectiveMhz: true,
  latestMemoryBytes: true,
  maxMemoryBytes: true,
  memoryEffectiveBytes: true,
  latestMemoryPercent: true,
  latestDiskBytes: true,
  maxDiskBytes: true,
  latestDiskPercent: true,
  cpuReadinessPercent: true,
  memoryBalloonedBytes: true,
  memorySwappedBytes: true,
  hostCount: true,
  effectiveHostCount: true,
  poweredOnHostCount: true,
  vmCount: true,
  poweredOnVmCount: true,
  vmTemplateCount: true,
  datastoreCount: true,
  clusterCount: true,
  metricsUpdatedAt: true,
  lastSeenAt: true,
};

/**
 * Fetch all VMwareResource inventory rows for a vCenter, optionally
 * filtered to one kind. This is the authoritative "what exists in this
 * vCenter right now" source — the same rows the sidebar badge counts
 * and the overview cards are computed from, so the pages can never
 * drift from the badges.
 */
export async function fetchVMwareInventoryRows(options: {
  vmwareVCenterId: ObjectID;
  kind?: VMwareResourceKind | undefined;
}): Promise<Array<VMwareResourceModel>> {
  const query: Record<string, unknown> = {
    vmwareVCenterId: options.vmwareVCenterId,
  };
  if (options.kind) {
    query["kind"] = options.kind;
  }

  const result: ListResult<VMwareResourceModel> =
    await ModelAPI.getList<VMwareResourceModel>({
      modelType: VMwareResourceModel,
      query: query,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      select: INVENTORY_SELECT,
      sort: {
        externalId: SortOrder.Ascending,
      },
    });

  return result.data;
}

/*
 * Whether the row's latest metric snapshot is fresh enough to show as a
 * live value (see METRIC_STALE_MS).
 */
export function hasFreshMetrics(row: VMwareResourceModel): boolean {
  if (!row.metricsUpdatedAt) {
    return false;
  }
  const ageMs: number =
    Date.now() - new Date(row.metricsUpdatedAt as Date).getTime();
  return Number.isFinite(ageMs) && ageMs <= METRIC_STALE_MS;
}

function toNumberOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n: number = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map an inventory row to the product-neutral view-model consumed by
 * Components/Infrastructure/ResourceTable. Latest CPU/memory values
 * older than METRIC_STALE_MS render as N/A rather than stale numbers
 * (K8s fetchInventoryResources contract).
 *
 * `namespace` carries the generic group dimension: the parent ESXi host
 * for VMs, the datacenter for hosts / datastores / clusters, and the
 * owning cluster (or host, for standalone-host pools) for resource
 * pools. Pass showGroupColumn={false} when the page does not want it.
 */
export function toInfrastructureResource(
  row: VMwareResourceModel,
): InfrastructureResource {
  let cpu: number | null = null;
  let mem: number | null = null;
  if (hasFreshMetrics(row)) {
    cpu = toNumberOrNull(row.latestCpuPercent);
    mem = toNumberOrNull(row.latestMemoryBytes);
  }

  const additionalAttributes: Record<string, string> = {
    externalId: row.externalId || "",
    kind: row.kind || "",
  };
  if (row.datacenterName) {
    additionalAttributes["datacenterName"] = row.datacenterName;
  }
  if (row.clusterName) {
    additionalAttributes["clusterName"] = row.clusterName;
  }
  if (row.hostName) {
    additionalAttributes["hostName"] = row.hostName;
  }
  if (row.resourcePoolName) {
    additionalAttributes["resourcePoolName"] = row.resourcePoolName;
  }
  if (row.resourcePoolPath) {
    additionalAttributes["resourcePoolPath"] = row.resourcePoolPath;
  }
  if (row.virtualAppName) {
    additionalAttributes["virtualAppName"] = row.virtualAppName;
  }
  if (row.vmInstanceUuid) {
    additionalAttributes["vmInstanceUuid"] = row.vmInstanceUuid;
  }
  if (row.isTemplate !== null && row.isTemplate !== undefined) {
    additionalAttributes["isTemplate"] = row.isTemplate ? "true" : "false";
  }
  /*
   * Tri-state on purpose: unset means the receiver has not shipped a
   * scrape for this VM yet (or the row is a template), which must render
   * as "unknown", never as "powered off".
   */
  if (row.isPoweredOn !== null && row.isPoweredOn !== undefined) {
    additionalAttributes["poweredOn"] = row.isPoweredOn ? "true" : "false";
  }
  const powerState: string = powerStateLabelForVM(row);
  if (powerState) {
    additionalAttributes["powerState"] = powerState;
  }
  if (row.latestCpuMhz !== null && row.latestCpuMhz !== undefined) {
    additionalAttributes["cpuMhz"] = String(row.latestCpuMhz);
  }
  if (row.cpuCapacityMhz !== null && row.cpuCapacityMhz !== undefined) {
    additionalAttributes["cpuCapacityMhz"] = String(row.cpuCapacityMhz);
  }
  if (row.cpuEffectiveMhz !== null && row.cpuEffectiveMhz !== undefined) {
    additionalAttributes["cpuEffectiveMhz"] = String(row.cpuEffectiveMhz);
  }
  if (
    row.memoryEffectiveBytes !== null &&
    row.memoryEffectiveBytes !== undefined
  ) {
    additionalAttributes["memoryEffectiveBytes"] = String(
      row.memoryEffectiveBytes,
    );
  }
  if (row.latestDiskBytes !== null && row.latestDiskBytes !== undefined) {
    additionalAttributes["diskBytes"] = String(row.latestDiskBytes);
  }
  if (row.maxDiskBytes !== null && row.maxDiskBytes !== undefined) {
    additionalAttributes["maxDiskBytes"] = String(row.maxDiskBytes);
  }
  if (row.latestDiskPercent !== null && row.latestDiskPercent !== undefined) {
    additionalAttributes["diskPercent"] = String(row.latestDiskPercent);
  }
  if (
    row.cpuReadinessPercent !== null &&
    row.cpuReadinessPercent !== undefined
  ) {
    additionalAttributes["cpuReadinessPercent"] = String(
      row.cpuReadinessPercent,
    );
  }
  if (
    row.memoryBalloonedBytes !== null &&
    row.memoryBalloonedBytes !== undefined
  ) {
    additionalAttributes["memoryBalloonedBytes"] = String(
      row.memoryBalloonedBytes,
    );
  }
  if (row.memorySwappedBytes !== null && row.memorySwappedBytes !== undefined) {
    additionalAttributes["memorySwappedBytes"] = String(row.memorySwappedBytes);
  }
  const countColumns: Array<[keyof VMwareResourceModel & string, string]> = [
    ["hostCount", "hostCount"],
    ["effectiveHostCount", "effectiveHostCount"],
    ["poweredOnHostCount", "poweredOnHostCount"],
    ["vmCount", "vmCount"],
    ["poweredOnVmCount", "poweredOnVmCount"],
    ["vmTemplateCount", "vmTemplateCount"],
    ["datastoreCount", "datastoreCount"],
    ["clusterCount", "clusterCount"],
  ];
  for (const [column, key] of countColumns) {
    const value: unknown = row[column];
    if (value !== null && value !== undefined) {
      additionalAttributes[key] = String(value);
    }
  }

  let groupName: string = "";
  switch (row.kind) {
    case VMwareResourceKind.VirtualMachine:
      groupName = row.hostName || "";
      break;
    case VMwareResourceKind.ResourcePool:
      groupName = row.clusterName || row.hostName || "";
      break;
    default:
      groupName = row.datacenterName || "";
  }

  return {
    name: displayNameForResource(row),
    namespace: groupName,
    cpuUtilization: cpu,
    memoryUsageBytes: mem,
    memoryLimitBytes: toNumberOrNull(row.maxMemoryBytes),
    status: displayStatusForResource(row),
    // The receiver reports no uptime / boot time — leave the age column empty.
    age: "",
    additionalAttributes: additionalAttributes,
  };
}

/**
 * Fetch + map in one call, K8s-style: an optional `transform` lets the
 * page enrich the view-model from the raw row (best-effort; a throwing
 * transform never drops the row).
 */
export async function fetchVMwareInventoryResources(options: {
  vmwareVCenterId: ObjectID;
  kind: VMwareResourceKind;
  transform?: (
    resource: InfrastructureResource,
    row: VMwareResourceModel,
  ) => void;
}): Promise<Array<InfrastructureResource>> {
  const rows: Array<VMwareResourceModel> = await fetchVMwareInventoryRows({
    vmwareVCenterId: options.vmwareVCenterId,
    kind: options.kind,
  });

  return rows.map((row: VMwareResourceModel): InfrastructureResource => {
    const resource: InfrastructureResource = toInfrastructureResource(row);
    if (options.transform) {
      try {
        options.transform(resource, row);
      } catch {
        // transform is best-effort enrichment; don't drop the row.
      }
    }
    return resource;
  });
}

/**
 * Fetch a single inventory row by its externalId (the detail-route
 * param). Returns null when the object has been pruned or never
 * reported.
 */
export async function fetchVMwareInventoryRow(options: {
  vmwareVCenterId: ObjectID;
  kind: VMwareResourceKind;
  externalId: string;
}): Promise<VMwareResourceModel | null> {
  const result: ListResult<VMwareResourceModel> =
    await ModelAPI.getList<VMwareResourceModel>({
      modelType: VMwareResourceModel,
      query: {
        vmwareVCenterId: options.vmwareVCenterId,
        kind: options.kind,
        externalId: options.externalId,
      },
      skip: 0,
      limit: 1,
      select: INVENTORY_SELECT,
      sort: {
        externalId: SortOrder.Ascending,
      },
    });

  return result.data[0] || null;
}

/*
 * ClickHouse attribute filter that pins a chart to exactly one vSphere
 * object. Identity lives in RESOURCE attributes for the vcenter receiver
 * (unlike Proxmox, whose identity rides datapoint labels), so every key
 * is `resource.`-prefixed. The vCenter name is always included — the
 * same object name can exist in two vCenters of one project.
 */
export function identityAttributesForResource(
  vcenterName: string,
  row: VMwareResourceModel,
): Record<string, string> {
  const attributes: Record<string, string> = {
    "resource.vmware.vcenter.name": vcenterName,
  };
  switch (row.kind) {
    case VMwareResourceKind.Host:
      if (row.datacenterName) {
        attributes["resource.vcenter.datacenter.name"] = row.datacenterName;
      }
      if (row.hostName || row.name) {
        attributes["resource.vcenter.host.name"] = row.hostName || row.name!;
      }
      break;
    case VMwareResourceKind.VirtualMachine:
      if (row.vmInstanceUuid) {
        attributes[
          row.isTemplate
            ? "resource.vcenter.vm_template.id"
            : "resource.vcenter.vm.id"
        ] = row.vmInstanceUuid;
      } else if (row.name) {
        attributes[
          row.isTemplate
            ? "resource.vcenter.vm_template.name"
            : "resource.vcenter.vm.name"
        ] = row.name;
      }
      break;
    case VMwareResourceKind.Datastore:
      if (row.datacenterName) {
        attributes["resource.vcenter.datacenter.name"] = row.datacenterName;
      }
      if (row.name) {
        attributes["resource.vcenter.datastore.name"] = row.name;
      }
      break;
    case VMwareResourceKind.Cluster:
      if (row.datacenterName) {
        attributes["resource.vcenter.datacenter.name"] = row.datacenterName;
      }
      if (row.clusterName || row.name) {
        attributes["resource.vcenter.cluster.name"] =
          row.clusterName || row.name!;
      }
      break;
    case VMwareResourceKind.ResourcePool:
      if (row.resourcePoolPath) {
        attributes["resource.vcenter.resource_pool.inventory_path"] =
          row.resourcePoolPath;
      }
      break;
    case VMwareResourceKind.Datacenter:
      if (row.name) {
        attributes["resource.vcenter.datacenter.name"] = row.name;
      }
      break;
    default:
      break;
  }
  return attributes;
}

export default {
  METRIC_STALE_MS,
  kindLabel,
  kindPluralLabel,
  formatBytes,
  formatPercent,
  formatMhz,
  formatBytesForChart,
  routeParamFromExternalId,
  externalIdFromRouteParam,
  displayNameForResource,
  displayStatusForResource,
  powerStateLabelForVM,
  hasFreshMetrics,
  fetchVMwareInventoryRows,
  fetchVMwareInventoryResources,
  fetchVMwareInventoryRow,
  toInfrastructureResource,
  identityAttributesForResource,
};
