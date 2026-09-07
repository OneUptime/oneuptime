import VMwareSource from "Common/Models/DatabaseModels/VMwareSource";
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

export const VMWARE_STALE_MS: number = 6 * 60 * 1000;
export const SOURCE_ATTRIBUTE: string = "resource.oneuptime.vmware.source.id";
export const RESOURCE_ATTRIBUTE: string =
  "resource.oneuptime.vmware.resource.id";

export function isFresh(
  value: Date | undefined | null,
  now: number = Date.now(),
  maxAge: number = VMWARE_STALE_MS,
): boolean {
  if (!value) {
    return false;
  }
  const timestamp: number = new Date(value).getTime();
  return (
    Number.isFinite(timestamp) &&
    timestamp <= now + 60000 &&
    now - timestamp <= maxAge
  );
}

export function sourceStatus(
  source: VMwareSource,
  now: number = Date.now(),
): string {
  if (source.isArchived) {
    return "Archived";
  }
  if (!source.lastCollectionAt) {
    return "Waiting for data";
  }
  if (!isFresh(source.lastCollectionAt, now, collectionFreshnessMs(source))) {
    return "Collection stale";
  }
  if (source.metrics?.["oneuptime.vmware.source.up"] === 0) {
    return "Collection failed";
  }
  if (source.metrics?.["oneuptime.vmware.source.inventory.complete"] === 0) {
    return "Partial inventory";
  }
  if (
    !isFresh(
      source.lastSuccessfulCollectionAt,
      now,
      collectionFreshnessMs(source),
    )
  ) {
    return "Waiting for successful collection";
  }
  if (
    source.metrics?.["oneuptime.vmware.source.up"] !== 1 ||
    source.metrics?.["oneuptime.vmware.source.inventory.complete"] !== 1
  ) {
    return "Waiting for collection status";
  }
  return "Connected";
}

export function resourceStatus(
  resource: VMwareResource,
  source: VMwareSource,
  now: number = Date.now(),
): string {
  if (resource.isArchived) {
    return "Archived";
  }
  if (sourceStatus(source, now) !== "Connected") {
    return "Unknown · stale data";
  }
  if (resource.metadata?.["oneuptime.vmware.resource.retired"] === true) {
    return "Retired";
  }
  if (resource.metadata?.["oneuptime.vmware.resource.observed"] === false) {
    return "Not observed";
  }
  if (!isFresh(resource.lastSeenAt, now, collectionFreshnessMs(source))) {
    return "Unknown · stale data";
  }
  const maintenance: boolean =
    resource.maintenanceMode ??
    resource.metadata?.["oneuptime.vmware.host.maintenance"] === true;
  if (maintenance) {
    return "Maintenance";
  }
  const connection: unknown =
    resource.metadata?.["oneuptime.vmware.resource.connection_state"];
  if (connection === "disconnected" || connection === "notResponding") {
    return "Disconnected";
  }
  const power: unknown =
    resource.metadata?.["oneuptime.vmware.resource.power_state"];
  if (power === "poweredOff") {
    return resource.expectedRunning ??
      resource.metadata?.["oneuptime.vmware.vm.expected_running"] === true
      ? "Expected running · powered off"
      : "Powered off";
  }
  if (power === "suspended") {
    return resource.expectedRunning ??
      resource.metadata?.["oneuptime.vmware.vm.expected_running"] === true
      ? "Expected running · suspended"
      : "Suspended";
  }
  if (power === "standBy") {
    return "Standby";
  }
  if (connection === "inaccessible" || connection === "orphaned") {
    return "Inaccessible";
  }
  if (resource.metadata?.["oneuptime.vmware.resource.state"] === "critical") {
    return "Critical health";
  }
  if (resource.metadata?.["oneuptime.vmware.resource.state"] === "warning") {
    return "Warning health";
  }
  if (power === "poweredOn") {
    return "Running";
  }
  if (connection === "connected") {
    return "Connected";
  }
  if (resource.metadata?.["oneuptime.vmware.resource.state"] === "healthy") {
    return "Healthy";
  }
  return "Unknown state";
}

export function metricValue(
  resource: VMwareResource,
  key: string,
  source: VMwareSource,
  now: number = Date.now(),
): number | null {
  if (
    sourceStatus(source, now) !== "Connected" ||
    !isFresh(resource.lastSeenAt, now, collectionFreshnessMs(source)) ||
    resource.metadata?.["oneuptime.vmware.resource.observed"] === false ||
    resource.metadata?.["oneuptime.vmware.resource.retired"] === true
  ) {
    return null;
  }
  const value: unknown = resource.metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export function resourceTypeLabel(value: string | undefined): string {
  return (
    (
      {
        host: "ESXi host",
        vm: "Virtual machine",
        datastore: "Datastore",
        cluster: "Cluster",
      } as Record<string, string>
    )[value || ""] || "Resource"
  );
}

export function sourceRoute(sourceId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.VMWARE_SOURCE_VIEW] as Route,
    { modelId: new ObjectID(sourceId) },
  );
}

export function resourceRoute(sourceId: string, resourceId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.VMWARE_RESOURCE_VIEW] as Route,
    { modelId: new ObjectID(sourceId), subModelId: new ObjectID(resourceId) },
  );
}

export function monitorRoute(
  sourceIdentifier?: string,
  resourceIdentifier?: string,
  resourceType?: string,
): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_CREATE] as Route,
  );
  const params: URLSearchParams = new URLSearchParams({
    monitorType: "VMware",
  });
  if (sourceIdentifier) {
    params.set("vmwareSource", sourceIdentifier);
  }
  if (resourceIdentifier) {
    params.set("vmwareResource", resourceIdentifier);
  }
  if (resourceType) {
    params.set("vmwareResourceType", resourceType);
  }
  return new Route(`${route.toString()}?${params.toString()}`);
}

export function metricQuery(
  sourceIdentifier: string,
  metricName: string,
  title: string,
  resourceIdentifier?: string,
): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: metricName.replace(/\./g, "_"),
      title,
      description: title,
      legend: title,
      legendUnit: metricName.endsWith("utilization") ? "%" : undefined,
    },
    metricQueryData: {
      filterData: {
        metricName,
        aggegationType: MetricsAggregationType.Avg,
        attributes: {
          [SOURCE_ATTRIBUTE]: sourceIdentifier,
          ...(resourceIdentifier
            ? { [RESOURCE_ATTRIBUTE]: resourceIdentifier }
            : {}),
        },
      },
      ...(resourceIdentifier
        ? {}
        : { groupByAttributeKeys: [RESOURCE_ATTRIBUTE], topN: 10 }),
    },
  };
}

export function sourceKindLabel(kind: string | undefined): string {
  return kind === "vcenter"
    ? "vCenter"
    : kind === "esxi"
      ? "Standalone ESXi"
      : "VMware vSphere";
}

export function collectionFreshnessMs(source: VMwareSource): number {
  const interval: number = source.collectionIntervalSeconds || 120;
  return (
    3 *
    Math.max(30, Number.isFinite(interval) && interval > 0 ? interval : 120) *
    1000
  );
}
