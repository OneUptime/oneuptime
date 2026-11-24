import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import XcpNgResourceKind from "Common/Types/XcpNg/XcpNgResourceKind";
import {
  XCP_NG_ID_ATTRIBUTE,
  XCP_NG_POOL_ID_ATTRIBUTE,
  XCP_NG_SCOPE_ATTRIBUTE,
  XcpNgScope,
  XcpNgTelemetryUtil,
} from "Common/Types/XcpNg/XcpNgTelemetry";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import { formatStorageBytes } from "Common/Utils/Storage/StorageUsage";
import {
  getGlobalTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { formatCompactDuration } from "../../../Utils/Milliseconds";

/*
 * THE GROUND THE XCP-NG POOL PAGES STAND ON.
 *
 * The pool's pages read the XcpNgResource inventory (its hosts, VMs, storage
 * repositories and virtual disks, written by the ingest from what Xen
 * Orchestra's OpenMetrics plugin reports) through ModelAPI, as the Proxmox
 * pages read ProxmoxResource, and draw its charts from the series Xen
 * Orchestra sends. This module holds what every page needs for that: the
 * numbers and dates as a column holds them, the figures written in the
 * reader's digits, an object's name and route, the filter that picks one
 * object's series, and the inventory reads.
 *
 * React-free, so App tests can read it. What a part IS (its status, its
 * badges) is XcpNgPartFacts; what needs attention is XcpNgHealth.
 */

/*
 * A latest reading older than this is no reading of now: the lists, the
 * busiest-VMs ranking and the topology draw no CPU or memory for it rather
 * than a number from an hour ago. A part's own page shows its last reading
 * whatever its age, with when it reported in its hero. Fifteen minutes, as
 * a pool turns Disconnected after (XcpNgPoolService.markDisconnectedPools).
 */
export const XCP_NG_METRIC_STALE_MS: number = 15 * 60 * 1000;

/*
 * The pool's identity on every series, as the XCP-ng Agent stamps it: the
 * resource attribute xcp_ng.pool.id, `resource.`-prefixed where it is stored.
 */
export const XCP_NG_POOL_RESOURCE_ATTRIBUTE: string = `resource.${XCP_NG_POOL_ID_ATTRIBUTE}`;

// A number from a column that may be null, a string (a bigint) or garbage.
export function toXcpNgNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number: number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

// A date from a column that may be null or an ISO string off the wire.
export function toXcpNgDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date: Date =
    value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}

/*
 * Whether a row's latest readings (CPU, memory, used space) are recent
 * enough to draw as now: written within `staleMs` of `now`.
 */
export function isXcpNgReadingFresh(
  row: Pick<XcpNgResource, "metricsUpdatedAt">,
  now: Date,
  staleMs: number = XCP_NG_METRIC_STALE_MS,
): boolean {
  const updatedAt: Date | null = toXcpNgDate(row.metricsUpdatedAt);
  return Boolean(updatedAt && now.getTime() - updatedAt.getTime() <= staleMs);
}

/*
 * An amount of storage or memory in binary units ("36.2 GiB"), in the
 * reader's digits and decimal sign, the number held to its unit: the shared
 * storage writing every list and bar uses (formatStorageBytes). The empty
 * mark for no reading, which a page draws as the quiet dash.
 */
export function formatXcpNgBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return EMPTY_VALUE_MARK;
  }
  return formatStorageBytes(bytes);
}

/*
 * English, for a chart's value axis and tooltip: the metric chart writes it
 * in the reader's digits itself (writeFigureInLanguage).
 */
export function formatXcpNgBytesForChart(value: number): string {
  return formatStorageBytes(value, "en");
}

// "85.4%", "۸۵٫۴٪", "85,4 %": a share, in the reader's figures.
export function formatXcpNgPercent(
  value: number | null | undefined,
  decimals: number = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EMPTY_VALUE_MARK;
  }
  return formatReaderFigure(value, { decimals: decimals, isPercent: true });
}

/*
 * A host's power draw: "241 W", the figure in the reader's digits and held
 * to its unit by a no-break space.
 */
export function formatXcpNgWatts(watts: number | null | undefined): string {
  if (watts === null || watts === undefined || !Number.isFinite(watts)) {
    return EMPTY_VALUE_MARK;
  }
  return `${formatReaderFigure(Math.round(watts), { decimals: 0 })}\u00A0W`;
}

// A load average: "2.48", in the reader's digits.
export function formatXcpNgLoad(load: number | null | undefined): string {
  if (load === null || load === undefined || !Number.isFinite(load)) {
    return EMPTY_VALUE_MARK;
  }
  return formatReaderFigure(load, { decimals: 2 });
}

/*
 * How long a host or VM has been up: "3d 4h", "4h 12m", "12m" in English,
 * the reader's short units and digits in their language (#8455). Empty for
 * no reading, or none above zero.
 */
export function formatXcpNgUptime(
  seconds: number | null | undefined,
  translator: Translator = getGlobalTranslator(),
): string {
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
    return formatCompactDuration(translator, { days, hours });
  }
  if (hours > 0) {
    return formatCompactDuration(translator, { hours, minutes });
  }
  return formatCompactDuration(translator, { minutes: Math.max(1, minutes) });
}

/*
 * A detail page's route parameter is the object's XAPI UUID, verbatim. A
 * UUID needs no escaping, but the value comes from a label someone else's
 * software wrote, so it still travels as one percent-encoded path segment:
 * always pair these two (RouteUtil.populateRouteParams inserts it raw).
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

// The first block of a UUID: enough to tell two nameless objects apart.
export function getXcpNgShortId(uuid: string | null | undefined): string {
  return XcpNgTelemetryUtil.getShortIdentifier(uuid || "");
}

/*
 * An object's name as Xen Orchestra reports it (host_name, vm_name, sr_name,
 * vdi_name), or the start of its UUID when it has none: XAPI lets a name
 * label be empty, and a page must still say which one it is.
 */
export function getXcpNgDisplayName(
  row: Pick<XcpNgResource, "name" | "externalId"> | null | undefined,
  externalId?: string | undefined,
): string {
  const name: string = (row?.name || "").trim();
  if (name) {
    return name;
  }
  return getXcpNgShortId(row?.externalId || externalId || "");
}

/*
 * The series of one object of the pool: the pool's own (its UUID, the
 * resource attribute), of the object's kind (xcp_ng.scope) and the object
 * itself (xcp_ng.id, its UUID) - the attributes ingest stamps on every
 * datapoint, whichever of Xen Orchestra's labels (uuid, sr_uuid, vdi_uuid)
 * named it.
 */
export function getXcpNgObjectAttributes(data: {
  poolIdentifier: string;
  scope: XcpNgScope;
  externalId: string;
}): Record<string, string> {
  return {
    [XCP_NG_POOL_RESOURCE_ATTRIBUTE]: data.poolIdentifier,
    [XCP_NG_SCOPE_ATTRIBUTE]: data.scope,
    [XCP_NG_ID_ATTRIBUTE]: data.externalId,
  };
}

/*
 * The unit a chart draws a catalog unit in (XcpNgMetricCatalog): a ratio
 * from 0 to 1 as a percent (the query multiplies it by 100 once), seconds
 * as "s", a count as no unit, and the rest as the catalog writes them
 * ("bytes", "bytes/s", "ops/s", "W"), which the chart's ValueFormatter
 * scales and writes.
 */
export function getXcpNgChartUnit(unit: string | undefined): string {
  if (!unit || unit === "count") {
    return "";
  }
  if (unit === "ratio") {
    return "%";
  }
  if (unit === "seconds") {
    return "s";
  }
  /*
   * A count per second the catalog writes whole ("{errors/s}") keeps its
   * slash on the chart: "3 errors/s", never the braces.
   */
  const annotatedRate: RegExpMatchArray | null =
    unit.match(/^\{([^{}/]+)\/s\}$/);
  if (annotatedRate) {
    return `{${annotatedRate[1]}}/s`;
  }
  return unit;
}

// A ratio from 0 to 1, drawn as a percent.
export function xcpNgRatioToPercent(value: number): number {
  return value * 100;
}

/*
 * The columns the pages read, every kind's: one select, so the lists, the
 * detail pages and the Overview can never disagree about a row.
 */
export const XCP_NG_INVENTORY_SELECT: Record<string, boolean> = {
  _id: true,
  kind: true,
  externalId: true,
  name: true,
  powerState: true,
  isUp: true,
  isEnabled: true,
  isControlDomain: true,
  parentHostExternalId: true,
  parentHostName: true,
  storageRepositoryExternalId: true,
  storageRepositoryName: true,
  vmExternalId: true,
  vmName: true,
  uptimeSeconds: true,
  lastRunningAt: true,
  latestCpuPercent: true,
  cpuCount: true,
  runningVcpuCount: true,
  loadAverage: true,
  latestMemoryBytes: true,
  maxMemoryBytes: true,
  latestMemoryPercent: true,
  latestDiskBytes: true,
  maxDiskBytes: true,
  latestDiskPercent: true,
  virtualAllocationBytes: true,
  srType: true,
  contentType: true,
  isShared: true,
  powerWatts: true,
  tags: true,
  metricsUpdatedAt: true,
  lastSeenAt: true,
};

async function listRows(
  query: Record<string, unknown>,
  limit: number = LIMIT_PER_PROJECT,
): Promise<Array<XcpNgResource>> {
  const result: ListResult<XcpNgResource> =
    await ModelAPI.getList<XcpNgResource>({
      modelType: XcpNgResource,
      query: query,
      skip: 0,
      limit: limit,
      select: XCP_NG_INVENTORY_SELECT,
      sort: {
        name: SortOrder.Ascending,
      },
    });
  return result.data;
}

/**
 * Every inventory row of a pool, or those of one kind: what exists in the
 * pool now, the same rows the side menu's counts are recounted from, so a
 * page can never disagree with its badge.
 */
export async function fetchXcpNgInventoryRows(options: {
  xcpNgPoolId: ObjectID;
  kind?: XcpNgResourceKind | undefined;
}): Promise<Array<XcpNgResource>> {
  const query: Record<string, unknown> = {
    xcpNgPoolId: options.xcpNgPoolId,
  };
  if (options.kind) {
    query["kind"] = options.kind;
  }
  return listRows(query);
}

/**
 * One object by its UUID (the detail route's parameter), or null when the
 * pool no longer reports it or never did.
 */
export async function fetchXcpNgInventoryRow(options: {
  xcpNgPoolId: ObjectID;
  kind: XcpNgResourceKind;
  externalId: string;
}): Promise<XcpNgResource | null> {
  const rows: Array<XcpNgResource> = await listRows(
    {
      xcpNgPoolId: options.xcpNgPoolId,
      kind: options.kind,
      externalId: options.externalId,
    },
    1,
  );
  return rows[0] || null;
}

/**
 * What one host holds, in one read: the VMs it runs (control domain
 * included) and its local storage repositories - every row that names it
 * as its host.
 */
export async function fetchXcpNgRowsOnHost(options: {
  xcpNgPoolId: ObjectID;
  hostExternalId: string;
}): Promise<Array<XcpNgResource>> {
  if (!options.hostExternalId) {
    return [];
  }
  return listRows({
    xcpNgPoolId: options.xcpNgPoolId,
    parentHostExternalId: options.hostExternalId,
  });
}

/**
 * A VM's virtual disks, or a storage repository's: the VDI rows that name
 * it.
 */
export async function fetchXcpNgVirtualDisks(options: {
  xcpNgPoolId: ObjectID;
  vmExternalId?: string | undefined;
  storageRepositoryExternalId?: string | undefined;
}): Promise<Array<XcpNgResource>> {
  const query: Record<string, unknown> = {
    xcpNgPoolId: options.xcpNgPoolId,
    kind: XcpNgResourceKind.VDI,
  };
  if (options.vmExternalId) {
    query["vmExternalId"] = options.vmExternalId;
  }
  if (options.storageRepositoryExternalId) {
    query["storageRepositoryExternalId"] = options.storageRepositoryExternalId;
  }
  if (!options.vmExternalId && !options.storageRepositoryExternalId) {
    return [];
  }
  return listRows(query);
}
