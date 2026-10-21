import StorageArrayResourceModel from "Common/Models/DatabaseModels/StorageArrayResource";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import Includes from "Common/Types/BaseDatabase/Includes";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import { StatusBadgeType } from "Common/UI/Components/StatusBadge/StatusBadge";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import {
  StorageArrayMetricDefinition,
  getStorageArrayMetricById,
} from "Common/Types/Monitor/StorageArrayMetricCatalog";

/*
 * Shared helpers for the Storage Array list/detail pages. The pages read
 * the StorageArrayResource Postgres inventory table (populated by the OTel
 * metrics ingest path from the array's OpenMetrics scrape) instead of
 * groupBy-ing over ClickHouse metric data — same architecture as the Ceph
 * pages (Pages/Ceph/Utils/CephResourceUtils.ts). Every rate the arrays
 * report is already a per-second gauge (reads_per_sec, usec_per_read_op),
 * so no rate math happens anywhere on these pages.
 */

// The resource attribute every storage array series is scoped by.
export const STORAGE_ARRAY_ATTRIBUTE: string = "resource.storage.array.name";

/*
 * Latest metric values older than this are treated as "no data" so a list
 * never shows numbers for an object that has fallen off the scrape. Matches
 * the cleanup worker's stale-resource cutoff
 * (STORAGE_ARRAY_INVENTORY_STALE_MINUTES default).
 */
export const METRIC_STALE_MS: number = 15 * 60 * 1000;

/*
 * The shipped FlashArray config scrapes /metrics/directories every 30
 * minutes (directory space is expensive for the array to compute), so a
 * directory's values stay current for longer — the same 90-minute cutoff
 * the cleanup worker uses for them.
 */
export const SLOW_SCRAPE_METRIC_STALE_MS: number = 90 * 60 * 1000;

export function getMetricStaleMs(kind: string | null | undefined): number {
  return kind === StorageArrayResourceKind.Directory
    ? SLOW_SCRAPE_METRIC_STALE_MS
    : METRIC_STALE_MS;
}

/*
 * Statuses that mean an object needs a person, lowercased as ingest writes
 * them. They mirror the ingest's own lists
 * (Common/Server/Utils/Telemetry/StorageArraySnapshotScan.ts): critical,
 * failed, missing and unhealthy (a FlashBlade component reporting 0) are
 * critical; degraded, unknown, unrecognized and not ready need attention.
 * not_installed, device_off, identifying, empty, unused and disabled are
 * fine. StorageArrayResourceStatus.test.ts keeps the two in step.
 */
export const CRITICAL_RESOURCE_STATUSES: ReadonlyArray<string> = [
  "critical",
  "failed",
  "missing",
  "unhealthy",
];

export const WARNING_RESOURCE_STATUSES: ReadonlyArray<string> = [
  "degraded",
  "unknown",
  "unrecognized",
  "not ready",
];

export const UNHEALTHY_RESOURCE_STATUSES: ReadonlyArray<string> = [
  ...CRITICAL_RESOURCE_STATUSES,
  ...WARNING_RESOURCE_STATUSES,
];

/*
 * Statuses that read as healthy: hardware `ok`, drives and hosts
 * `healthy`, controllers `ready`, network interfaces `enabled`, replica
 * links `replicating`, pod mediators `online`.
 */
export const HEALTHY_RESOURCE_STATUSES: ReadonlyArray<string> = [
  "ok",
  "healthy",
  "ready",
  "enabled",
  "online",
  "replicating",
];

function normalizeStatus(status: string | null | undefined): string {
  return (status || "").trim().toLowerCase();
}

export function isCriticalResourceStatus(
  status: string | null | undefined,
): boolean {
  return CRITICAL_RESOURCE_STATUSES.includes(normalizeStatus(status));
}

export function isUnhealthyResourceStatus(
  status: string | null | undefined,
): boolean {
  return UNHEALTHY_RESOURCE_STATUSES.includes(normalizeStatus(status));
}

export function getResourceStatusBadgeType(
  status: string | null | undefined,
): StatusBadgeType {
  const normalized: string = normalizeStatus(status);
  if (CRITICAL_RESOURCE_STATUSES.includes(normalized)) {
    return StatusBadgeType.Danger;
  }
  if (WARNING_RESOURCE_STATUSES.includes(normalized)) {
    return StatusBadgeType.Warning;
  }
  if (HEALTHY_RESOURCE_STATUSES.includes(normalized)) {
    return StatusBadgeType.Success;
  }
  return StatusBadgeType.Neutral;
}

/*
 * A status as the array reports it, made readable: `not_installed` ->
 * "Not Installed", `device_off` -> "Device Off", `ok` -> "OK".
 */
export function formatStatusLabel(status: string | null | undefined): string {
  const normalized: string = normalizeStatus(status);
  if (!normalized) {
    return "";
  }
  if (normalized === "ok") {
    return "OK";
  }
  return normalized
    .split(/[\s_-]+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .map((word: string): string => {
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return "—";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units: Array<string> = ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
  let value: number = bytes / 1024;
  let idx: number = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[idx]}`;
}

export function formatBytesPerSec(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${formatBytes(value)}/s`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return Math.round(value).toString();
}

// Operations per second: "1.2K/s".
export function formatIops(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (value < 10 && value > 0) {
    return `${value.toFixed(1)}/s`;
  }
  return `${formatCount(value)}/s`;
}

/*
 * Pure reports latency in microseconds per operation. Below a millisecond
 * it reads best in µs (a FlashArray read is usually 150–500 µs); above,
 * in ms.
 */
export function formatLatencyUsec(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (value < 1000) {
    return `${Math.round(value)} µs`;
  }
  return `${(value / 1000).toFixed(value >= 100_000 ? 0 : 2)} ms`;
}

// Replication lag arrives in milliseconds.
export function formatDurationMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  const seconds: number = value / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes: number = seconds / 60;
  if (minutes < 60) {
    return `${minutes.toFixed(1)} min`;
  }
  return `${(minutes / 60).toFixed(1)} h`;
}

// Data reduction as Pure writes it: 4.2 -> "4.2:1".
export function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}:1`;
}

export function formatTemperature(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${Math.round(value)} °C`;
}

export function formatLastSeen(date: Date | undefined | null): string {
  if (!date) {
    return "—";
  }
  return OneUptimeDate.fromNow(new Date(date));
}

/*
 * The detail-route param is the inventory `externalId` verbatim — the
 * object's own name on the array. FlashArray volume names contain `/`
 * (volume groups: `vg1/vol1`) and `::` (pods: `pod1::vol1`), so it must
 * travel through the URL percent-encoded as one path segment. Always pair
 * these two helpers — RouteUtil.populateRouteParams inserts the value raw.
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

export function displayNameForResource(row: StorageArrayResourceModel): string {
  return row.name || row.externalId || "";
}

// One value out of the row's vendor-extras JSON.
export function getDetail(
  row: StorageArrayResourceModel,
  key: string,
): JSONValue | undefined {
  const details: JSONObject | undefined = row.details as JSONObject | undefined;
  if (!details || typeof details !== "object") {
    return undefined;
  }
  return details[key];
}

export function getDetailNumber(
  row: StorageArrayResourceModel,
  key: string,
): number | null {
  const value: JSONValue | undefined = getDetail(row, key);
  const parsed: number = Number(value);
  if (value === null || value === undefined || !Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

export function getDetailString(
  row: StorageArrayResourceModel,
  key: string,
): string {
  const value: JSONValue | undefined = getDetail(row, key);
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

/**
 * Stale-cutoff numeric read: returns null (render "—") when the row's
 * metric mirror hasn't been refreshed within its kind's cutoff.
 */
export function freshMetricValue(
  row: StorageArrayResourceModel,
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!row.metricsUpdatedAt) {
    return null;
  }
  const ageMs: number =
    Date.now() - new Date(row.metricsUpdatedAt as Date).getTime();
  if (ageMs > getMetricStaleMs(row.kind)) {
    return null;
  }
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/*
 * A FlashBlade file system's size: total_provisioned when the exporter
 * sends it (capacityBytes), else its configured `provisioned` size, which
 * ingest keeps in details.
 */
export function getFileSystemProvisionedBytes(
  row: StorageArrayResourceModel,
): number | null {
  const provisioned: number | null = freshMetricValue(row, row.capacityBytes);
  if (provisioned !== null) {
    return provisioned;
  }
  return getDetailNumber(row, "provisionedBytes");
}

/*
 * The protocols a FlashBlade file system is shared over, from the `nfs`
 * and `smb` labels the exporter puts on its series ("true", "false", or a
 * version list such as "v3,v4.1").
 */
export function getFileSystemProtocols(
  row: StorageArrayResourceModel,
): Array<string> {
  const protocols: Array<string> = [];
  for (const [key, label] of [
    ["nfs", "NFS"],
    ["smb", "SMB"],
  ] as Array<[string, string]>) {
    const value: string = getDetailString(row, key).trim().toLowerCase();
    if (!value || value === "false" || value === "0" || value === "disabled") {
      continue;
    }
    protocols.push(
      value === "true" || value === "enabled" ? label : `${label} ${value}`,
    );
  }
  return protocols;
}

// Physical space used as a share of the provisioned size.
export function usedPercentOf(
  usedBytes: number | null,
  capacityBytes: number | null,
): number | null {
  if (usedBytes === null || capacityBytes === null || capacityBytes <= 0) {
    return null;
  }
  return (usedBytes / capacityBytes) * 100;
}

export const INVENTORY_SELECT: Record<string, boolean> = {
  kind: true,
  externalId: true,
  name: true,
  status: true,
  statusDetail: true,
  componentType: true,
  model: true,
  firmwareVersion: true,
  groupName: true,
  capacityBytes: true,
  usedBytes: true,
  dataReductionRatio: true,
  readLatencyUsec: true,
  writeLatencyUsec: true,
  readIops: true,
  writeIops: true,
  readBytesPerSec: true,
  writeBytesPerSec: true,
  temperatureCelsius: true,
  replicationLagMs: true,
  connectionCount: true,
  details: true,
  metricsUpdatedAt: true,
  lastSeenAt: true,
  createdAt: true,
};

/**
 * Fetch StorageArrayResource inventory rows of the given kinds for an
 * array — the authoritative "what exists right now" source, kept in
 * lockstep with the sidebar badge counts (single-source rule).
 */
export async function fetchStorageArrayResources(options: {
  storageArrayId: ObjectID;
  kinds: Array<StorageArrayResourceKind>;
}): Promise<Array<StorageArrayResourceModel>> {
  if (options.kinds.length === 0) {
    return [];
  }

  const result: ListResult<StorageArrayResourceModel> =
    await ModelAPI.getList<StorageArrayResourceModel>({
      modelType: StorageArrayResourceModel,
      query: {
        storageArrayId: options.storageArrayId,
        kind: new Includes(options.kinds),
      },
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
 * One inventory row by its kind and externalId (a detail page's route
 * param), or null when the array no longer reports it.
 */
export async function fetchStorageArrayResource(options: {
  storageArrayId: ObjectID;
  kind: StorageArrayResourceKind;
  externalId: string;
}): Promise<StorageArrayResourceModel | null> {
  const result: ListResult<StorageArrayResourceModel> =
    await ModelAPI.getList<StorageArrayResourceModel>({
      modelType: StorageArrayResourceModel,
      query: {
        storageArrayId: options.storageArrayId,
        kind: options.kind,
        externalId: options.externalId,
      },
      skip: 0,
      limit: 1,
      select: INVENTORY_SELECT,
      sort: {},
    });

  return result.data[0] || null;
}

/*
 * A catalog unit as a chart axis unit: ValueFormatter scales "bytes",
 * "bytes/s", "µs" and "ms"; a ratio or a count has no unit to show.
 */
export function getChartUnit(unit: string | undefined): string {
  if (!unit || unit === "ratio" || unit === "count") {
    return "";
  }
  return unit;
}

/*
 * A chart query for one StorageArrayMetricCatalog entry on one array: the
 * entry's own label filters (its `dimension`, `space` or `type`), the
 * array's identity attribute, and any per-object filter (`name` for a
 * volume, `host` for a host). Undefined when the catalog has no such
 * entry.
 */
export function buildCatalogQuery(data: {
  metricId: string;
  arrayName: string;
  objectFilters?: Record<string, string> | undefined;
  groupByAttributeKeys?: Array<string> | undefined;
  legend?: string | undefined;
  overlayWithPreviousQuery?: boolean | undefined;
}): MetricQueryConfigData | undefined {
  const metric: StorageArrayMetricDefinition | undefined =
    getStorageArrayMetricById(data.metricId);

  if (!metric) {
    return undefined;
  }

  return {
    metricAliasData: {
      metricVariable: metric.id.replace(/-/g, "_"),
      title: metric.friendlyName,
      description: metric.description,
      legend: data.legend || metric.friendlyName,
      legendUnit: getChartUnit(metric.unit),
    },
    metricQueryData: {
      filterData: {
        metricName: metric.metricName,
        attributes: {
          ...(metric.attributes || {}),
          [STORAGE_ARRAY_ATTRIBUTE]: data.arrayName,
          ...(data.objectFilters || {}),
        },
        aggegationType: metric.defaultAggregation,
        aggregateBy: {},
      },
      ...(data.groupByAttributeKeys && data.groupByAttributeKeys.length > 0
        ? { groupByAttributeKeys: data.groupByAttributeKeys }
        : {}),
    },
    ...(data.overlayWithPreviousQuery
      ? { overlayWithPreviousQuery: true }
      : {}),
  };
}

/*
 * Catalog queries in order, skipping ids the catalog does not have, so a
 * renamed catalog entry drops a chart rather than crashing the page.
 */
export function buildCatalogQueries(
  queries: Array<Parameters<typeof buildCatalogQuery>[0]>,
): Array<MetricQueryConfigData> {
  const result: Array<MetricQueryConfigData> = [];
  for (const query of queries) {
    const built: MetricQueryConfigData | undefined = buildCatalogQuery(query);
    if (built) {
      result.push(built);
    }
  }
  return result;
}

export default {
  STORAGE_ARRAY_ATTRIBUTE,
  METRIC_STALE_MS,
  SLOW_SCRAPE_METRIC_STALE_MS,
  getMetricStaleMs,
  isCriticalResourceStatus,
  isUnhealthyResourceStatus,
  getResourceStatusBadgeType,
  formatStatusLabel,
  formatBytes,
  formatBytesPerSec,
  formatPercent,
  formatCount,
  formatIops,
  formatLatencyUsec,
  formatDurationMs,
  formatRatio,
  formatTemperature,
  formatLastSeen,
  routeParamFromExternalId,
  externalIdFromRouteParam,
  displayNameForResource,
  getDetail,
  getDetailNumber,
  getDetailString,
  freshMetricValue,
  getFileSystemProvisionedBytes,
  getFileSystemProtocols,
  usedPercentOf,
  INVENTORY_SELECT,
  fetchStorageArrayResources,
  fetchStorageArrayResource,
  getChartUnit,
  buildCatalogQuery,
  buildCatalogQueries,
};
