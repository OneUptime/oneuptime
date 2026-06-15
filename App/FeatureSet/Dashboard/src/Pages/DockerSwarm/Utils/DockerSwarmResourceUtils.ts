import DockerSwarmResourceModel from "Common/Models/DatabaseModels/DockerSwarmResource";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import EntityType from "Common/Types/Telemetry/EntityType";
import { computeEntityKey } from "Common/Utils/Telemetry/EntityKey";
import { InfrastructureResource } from "../../../Components/Infrastructure/ResourceTable";

/*
 * Shared helpers for the Docker Swarm list/detail pages. The pages read
 * the DockerSwarmResource Postgres inventory table (populated by the OTel
 * ingest path from the OneUptime Docker Swarm agent's inventory poller +
 * docker_stats receiver) instead of grouping over ClickHouse telemetry —
 * same architecture as the Proxmox pages
 * (Pages/Proxmox/Utils/ProxmoxResourceUtils.ts).
 */

/*
 * Latest metric values older than this are treated as "no data" by the
 * list views so bars don't lie about a resource that's fallen off the
 * metric stream. Matches the ingest cleanup worker's stale-resource
 * cutoff ("now - 15min").
 */
export const METRIC_STALE_MS: number = 15 * 60 * 1000;

export type DockerSwarmResourceKind =
  | "Node"
  | "Service"
  | "Task"
  | "Stack"
  | "Network"
  | "Secret"
  | "Config"
  | "Volume";

/**
 * Read-side entity key for a Docker Swarm cluster, mirroring the
 * ingest-side resolver (identity attribute `docker.swarm.cluster.name`,
 * matching the DockerSwarmCluster row's `name`). The analog of
 * `keyForProxmoxCluster` in Common/Utils/Telemetry/EntityKey — kept local
 * to the Dashboard so the Metrics/Logs pages can scope by `entityKeys`.
 */
export function keyForDockerSwarmCluster(
  projectId: string,
  clusterName: string,
): string {
  return computeEntityKey({
    projectId,
    entityType: EntityType.DockerSwarmCluster,
    identifyingAttributes: { "docker.swarm.cluster.name": clusterName },
  });
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

export function formatBytesForChart(value: number): string {
  return formatBytes(value);
}

/*
 * The detail-route param is the `externalId` verbatim (`node/<id>`,
 * `service/<id>`, `task/<id>`, `stack/<name>`, `network/<id>`,
 * `volume/<name>@<nodeId>`). It can contain slashes / `@`, so it must
 * travel through the URL percent-encoded as a single path segment.
 * Always pair these two helpers — RouteUtil.populateRouteParams inserts
 * the value raw.
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
 * Display name for a resource: prefer the human name; fall back to the
 * part of the externalId after the first slash (`<id>`, `<name>`).
 */
export function displayNameForResource(row: DockerSwarmResourceModel): string {
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
 * Helper to read a string-ish value out of the kind-specific attributes
 * JSON without exploding on the loose JSONObject typing.
 */
export function attributeString(
  row: DockerSwarmResourceModel,
  key: string,
): string {
  const attributes: Record<string, unknown> =
    (row.attributes as Record<string, unknown>) || {};
  const value: unknown = attributes[key];
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

/*
 * Kind-aware display status. Prefer the explicit `state` word from the
 * snapshot; fall back to the readiness boolean. Empty when neither is
 * reported. "running"/"ready" render green, "failed"/"down" red via
 * Components/Infrastructure/ResourceTable.getStatusBadgeClass.
 */
export function displayStatusForResource(
  row: DockerSwarmResourceModel,
): string {
  if (row.state) {
    return row.state;
  }
  if (row.isReady === true) {
    return "Ready";
  }
  if (row.isReady === false) {
    return "Not Ready";
  }
  return "";
}

/*
 * Replicas badge for a Service: "running/desired" (e.g. "3/3"). Global
 * services have no desired count, so just the running count is shown.
 */
export function formatReplicas(row: DockerSwarmResourceModel): string {
  const running: number | null =
    row.runningReplicas !== null && row.runningReplicas !== undefined
      ? Number(row.runningReplicas)
      : null;
  const desired: number | null =
    row.desiredReplicas !== null && row.desiredReplicas !== undefined
      ? Number(row.desiredReplicas)
      : null;
  if (running === null && desired === null) {
    return "—";
  }
  if (desired === null) {
    return `${running ?? 0}`;
  }
  return `${running ?? 0}/${desired}`;
}

const INVENTORY_SELECT: Record<string, boolean> = {
  kind: true,
  externalId: true,
  name: true,
  state: true,
  role: true,
  serviceMode: true,
  desiredReplicas: true,
  runningReplicas: true,
  image: true,
  stackName: true,
  serviceName: true,
  nodeHostname: true,
  driver: true,
  isReady: true,
  attributes: true,
  latestCpuPercent: true,
  latestMemoryBytes: true,
  maxMemoryBytes: true,
  latestMemoryPercent: true,
  metricsUpdatedAt: true,
  lastSeenAt: true,
};

/**
 * Fetch all DockerSwarmResource inventory rows for a cluster, optionally
 * filtered to one kind. This is the authoritative "what exists in the
 * cluster right now" source — the same rows the sidebar badge counts and
 * the overview cards are computed from, so the pages can never drift from
 * the badges.
 */
export async function fetchDockerSwarmInventoryRows(options: {
  dockerSwarmClusterId: ObjectID;
  kind?: DockerSwarmResourceKind | undefined;
}): Promise<Array<DockerSwarmResourceModel>> {
  const query: Record<string, unknown> = {
    dockerSwarmClusterId: options.dockerSwarmClusterId,
  };
  if (options.kind) {
    query["kind"] = options.kind;
  }

  const result: ListResult<DockerSwarmResourceModel> =
    await ModelAPI.getList<DockerSwarmResourceModel>({
      modelType: DockerSwarmResourceModel,
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
 * Components/Infrastructure/ResourceTable. Latest CPU/memory values older
 * than METRIC_STALE_MS render as N/A rather than stale numbers.
 *
 * `namespace` carries the generic group dimension — the parent stack name
 * for services, the node hostname for tasks/volumes (render via
 * groupColumnTitle); empty for kinds without a grouping (pass
 * showGroupColumn={false}).
 */
export function toInfrastructureResource(
  row: DockerSwarmResourceModel,
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
  if (row.role) {
    additionalAttributes["role"] = row.role;
  }
  if (row.serviceMode) {
    additionalAttributes["serviceMode"] = row.serviceMode;
  }
  if (row.image) {
    additionalAttributes["image"] = row.image;
  }
  if (row.stackName) {
    additionalAttributes["stackName"] = row.stackName;
  }
  if (row.serviceName) {
    additionalAttributes["serviceName"] = row.serviceName;
  }
  if (row.nodeHostname) {
    additionalAttributes["nodeHostname"] = row.nodeHostname;
  }
  if (row.driver) {
    additionalAttributes["driver"] = row.driver;
  }
  additionalAttributes["replicas"] = formatReplicas(row);
  if (row.isReady !== null && row.isReady !== undefined) {
    additionalAttributes["isReady"] = row.isReady ? "true" : "false";
  }

  // Surface a few common attributes-JSON keys for the column getters.
  for (const key of [
    "availability",
    "managerStatus",
    "engineVersion",
    "scope",
    "createdAt",
    "mountpoint",
    "serviceCount",
  ]) {
    const value: string = attributeString(row, key);
    if (value) {
      additionalAttributes[key] = value;
    }
  }

  /*
   * Grouping dimension: services group by stack, tasks group by their
   * scheduled node, volumes by node; everything else has no group.
   */
  let namespace: string = "";
  if (row.kind === "Service" || row.kind === "Task") {
    namespace = row.stackName || "";
  }
  if (row.kind === "Task" || row.kind === "Volume") {
    namespace = row.nodeHostname || namespace;
  }

  return {
    name: displayNameForResource(row),
    namespace: namespace,
    cpuUtilization: cpu,
    memoryUsageBytes: mem,
    memoryLimitBytes:
      row.maxMemoryBytes !== null && row.maxMemoryBytes !== undefined
        ? Number(row.maxMemoryBytes)
        : null,
    status: displayStatusForResource(row),
    age: "",
    additionalAttributes: additionalAttributes,
  };
}

/**
 * Fetch + map in one call: an optional `transform` lets the page enrich
 * the view-model from the raw row (best-effort; a throwing transform never
 * drops the row).
 */
export async function fetchDockerSwarmInventoryResources(options: {
  dockerSwarmClusterId: ObjectID;
  kind: DockerSwarmResourceKind;
  transform?: (
    resource: InfrastructureResource,
    row: DockerSwarmResourceModel,
  ) => void;
}): Promise<Array<InfrastructureResource>> {
  const rows: Array<DockerSwarmResourceModel> =
    await fetchDockerSwarmInventoryRows({
      dockerSwarmClusterId: options.dockerSwarmClusterId,
      kind: options.kind,
    });

  return rows.map((row: DockerSwarmResourceModel): InfrastructureResource => {
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
 * Fetch a single inventory row by its externalId (the detail-route param).
 * Returns null when the resource has been pruned or never reported.
 */
export async function fetchDockerSwarmInventoryRow(options: {
  dockerSwarmClusterId: ObjectID;
  kind: DockerSwarmResourceKind;
  externalId: string;
}): Promise<DockerSwarmResourceModel | null> {
  const result: ListResult<DockerSwarmResourceModel> =
    await ModelAPI.getList<DockerSwarmResourceModel>({
      modelType: DockerSwarmResourceModel,
      query: {
        dockerSwarmClusterId: options.dockerSwarmClusterId,
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
  keyForDockerSwarmCluster,
  formatBytes,
  formatPercent,
  formatBytesForChart,
  routeParamFromExternalId,
  externalIdFromRouteParam,
  displayNameForResource,
  displayStatusForResource,
  formatReplicas,
  attributeString,
  fetchDockerSwarmInventoryRows,
  fetchDockerSwarmInventoryResources,
  fetchDockerSwarmInventoryRow,
  toInfrastructureResource,
};
