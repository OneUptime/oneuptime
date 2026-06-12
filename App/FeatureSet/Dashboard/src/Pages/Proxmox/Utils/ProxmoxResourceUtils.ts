import ProxmoxResourceModel from "Common/Models/DatabaseModels/ProxmoxResource";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { InfrastructureResource } from "../../../Components/Infrastructure/ResourceTable";

/*
 * Shared helpers for the Proxmox list/detail pages. The pages read the
 * ProxmoxResource Postgres inventory table (populated by the OTel
 * metrics ingest path from the pve-exporter scrape stream) instead of
 * groupBy-ing over ClickHouse metric data — same architecture as the
 * Kubernetes pages (Pages/Kubernetes/Utils/KubernetesResourceUtils.ts).
 */

/*
 * Latest metric values older than this are treated as "no data" by the
 * list views so bars don't lie about a resource that's fallen off the
 * metric stream. Matches the cleanup worker's stale-resource cutoff
 * (PVE_INVENTORY_STALE_MINUTES default).
 */
export const METRIC_STALE_MS: number = 15 * 60 * 1000;

export type ProxmoxResourceKind = "Node" | "Guest" | "Storage";

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

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return "";
  }
  if (seconds <= 0) {
    return "";
  }
  const days: number = Math.floor(seconds / 86400);
  const hours: number = Math.floor((seconds % 86400) / 3600);
  const minutes: number = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatBytesForChart(value: number): string {
  return formatBytes(value);
}

/*
 * The detail-route param is the pve `externalId` verbatim (`node/pve1`,
 * `qemu/100`, `storage/local`, or `storage/<node>/<storage>` on
 * pve-exporter >= 3.x). It contains slashes, so it must travel through
 * the URL percent-encoded as a single path segment. Always pair these
 * two helpers — RouteUtil.populateRouteParams inserts the value raw.
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
 * Display name for a resource: prefer the human name from the *_info
 * series; fall back to the part of the externalId after the first
 * slash (`pve1`, `100`, `local`).
 */
export function displayNameForResource(row: ProxmoxResourceModel): string {
  if (row.name) {
    return row.name;
  }
  const externalId: string = row.externalId || "";
  const slashIndex: number = externalId.indexOf("/");
  if (slashIndex >= 0) {
    return externalId.substring(slashIndex + 1);
  }
  return externalId;
}

/*
 * Kind-specific display status: Node → Online/Offline, Guest →
 * Running/Stopped, Storage → Available/Unavailable. Empty until the
 * first pve_up datapoint lands. "Stopped" deliberately renders as the
 * neutral gray pill (planned shutdown is not an error) while
 * Offline/Unavailable render red — see
 * Components/Infrastructure/ResourceTable.getStatusBadgeClass.
 */
export function displayStatusForResource(row: ProxmoxResourceModel): string {
  if (row.isUp === undefined || row.isUp === null) {
    return "";
  }
  switch (row.kind) {
    case "Node":
      return row.isUp ? "Online" : "Offline";
    case "Guest":
      return row.isUp ? "Running" : "Stopped";
    case "Storage":
      return row.isUp ? "Available" : "Unavailable";
    default:
      return row.isUp ? "Up" : "Down";
  }
}

const INVENTORY_SELECT: Record<string, boolean> = {
  kind: true,
  externalId: true,
  name: true,
  vmid: true,
  guestType: true,
  parentNodeName: true,
  isUp: true,
  haState: true,
  onboot: true,
  uptimeSeconds: true,
  latestCpuPercent: true,
  latestMemoryBytes: true,
  maxMemoryBytes: true,
  latestMemoryPercent: true,
  latestDiskBytes: true,
  maxDiskBytes: true,
  metricsUpdatedAt: true,
  lastSeenAt: true,
};

/**
 * Fetch all ProxmoxResource inventory rows for a cluster, optionally
 * filtered to one kind. This is the authoritative "what exists in the
 * cluster right now" source — the same rows the sidebar badge counts
 * and the overview cards are computed from, so the pages can never
 * drift from the badges.
 */
export async function fetchProxmoxInventoryRows(options: {
  proxmoxClusterId: ObjectID;
  kind?: ProxmoxResourceKind | undefined;
}): Promise<Array<ProxmoxResourceModel>> {
  const query: Record<string, unknown> = {
    proxmoxClusterId: options.proxmoxClusterId,
  };
  if (options.kind) {
    query["kind"] = options.kind;
  }

  const result: ListResult<ProxmoxResourceModel> =
    await ModelAPI.getList<ProxmoxResourceModel>({
      modelType: ProxmoxResourceModel,
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

/**
 * Map an inventory row to the product-neutral view-model consumed by
 * Components/Infrastructure/ResourceTable. Latest CPU/memory values
 * older than METRIC_STALE_MS render as N/A rather than stale numbers
 * (K8s fetchInventoryResources contract).
 *
 * `namespace` carries the generic group dimension — the parent node
 * name for guests/storages (render via groupColumnTitle="Node"); empty
 * for nodes (pass showGroupColumn={false}).
 */
export function toInfrastructureResource(
  row: ProxmoxResourceModel,
): InfrastructureResource {
  const now: number = Date.now();

  let cpu: number | null = null;
  let mem: number | null = null;
  if (row.metricsUpdatedAt) {
    const ageMs: number =
      now - new Date(row.metricsUpdatedAt as Date).getTime();
    if (ageMs <= METRIC_STALE_MS) {
      if (row.latestCpuPercent !== null && row.latestCpuPercent !== undefined) {
        cpu = Number(row.latestCpuPercent);
      }
      if (
        row.latestMemoryBytes !== null &&
        row.latestMemoryBytes !== undefined
      ) {
        mem = Number(row.latestMemoryBytes);
      }
    }
  }

  const additionalAttributes: Record<string, string> = {
    externalId: row.externalId || "",
  };
  if (row.vmid !== null && row.vmid !== undefined) {
    additionalAttributes["vmid"] = String(row.vmid);
  }
  if (row.guestType) {
    additionalAttributes["guestType"] = row.guestType;
  }
  if (row.haState) {
    additionalAttributes["haState"] = row.haState;
  }
  if (row.latestDiskBytes !== null && row.latestDiskBytes !== undefined) {
    additionalAttributes["diskBytes"] = String(row.latestDiskBytes);
  }
  if (row.maxDiskBytes !== null && row.maxDiskBytes !== undefined) {
    additionalAttributes["maxDiskBytes"] = String(row.maxDiskBytes);
  }

  return {
    name: displayNameForResource(row),
    namespace: row.parentNodeName || "",
    cpuUtilization: cpu,
    memoryUsageBytes: mem,
    memoryLimitBytes:
      row.maxMemoryBytes !== null && row.maxMemoryBytes !== undefined
        ? Number(row.maxMemoryBytes)
        : null,
    status: displayStatusForResource(row),
    age: formatUptime(row.uptimeSeconds),
    additionalAttributes: additionalAttributes,
  };
}

/**
 * Fetch + map in one call, K8s-style: an optional `transform` lets the
 * page enrich the view-model from the raw row (best-effort; a throwing
 * transform never drops the row).
 */
export async function fetchProxmoxInventoryResources(options: {
  proxmoxClusterId: ObjectID;
  kind: ProxmoxResourceKind;
  transform?: (
    resource: InfrastructureResource,
    row: ProxmoxResourceModel,
  ) => void;
}): Promise<Array<InfrastructureResource>> {
  const rows: Array<ProxmoxResourceModel> = await fetchProxmoxInventoryRows({
    proxmoxClusterId: options.proxmoxClusterId,
    kind: options.kind,
  });

  return rows.map((row: ProxmoxResourceModel): InfrastructureResource => {
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
 * param). Returns null when the resource has been pruned or never
 * reported.
 */
export async function fetchProxmoxInventoryRow(options: {
  proxmoxClusterId: ObjectID;
  kind: ProxmoxResourceKind;
  externalId: string;
}): Promise<ProxmoxResourceModel | null> {
  const result: ListResult<ProxmoxResourceModel> =
    await ModelAPI.getList<ProxmoxResourceModel>({
      modelType: ProxmoxResourceModel,
      query: {
        proxmoxClusterId: options.proxmoxClusterId,
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

export default {
  METRIC_STALE_MS,
  formatBytes,
  formatPercent,
  formatUptime,
  formatBytesForChart,
  routeParamFromExternalId,
  externalIdFromRouteParam,
  displayNameForResource,
  displayStatusForResource,
  fetchProxmoxInventoryRows,
  fetchProxmoxInventoryResources,
  fetchProxmoxInventoryRow,
  toInfrastructureResource,
};
