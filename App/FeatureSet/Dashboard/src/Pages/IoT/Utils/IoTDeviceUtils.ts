import IoTDeviceModel from "Common/Models/DatabaseModels/IoTDevice";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";

/*
 * Shared helpers for the IoT fleet list/detail pages. The pages read the
 * IoTDevice Postgres inventory table (populated by the OTel metrics
 * ingest path from the device/gateway OTLP push stream) instead of
 * groupBy-ing over ClickHouse metric data — same architecture as the
 * Proxmox pages (Pages/Proxmox/Utils/ProxmoxResourceUtils.ts).
 */

/*
 * Latest metric values older than this are treated as "no data" by the
 * list views so cells don't lie about a device that's fallen off the
 * metric stream. Matches the cleanup worker's stale-device cutoff.
 */
export const METRIC_STALE_MS: number = 15 * 60 * 1000;

export type IoTDeviceKind = "Device" | "Sensor" | "Gateway";

/*
 * Every kind the ingest path writes (IoTDeviceService's Device |
 * Sensor | Gateway contract) — drives the kind filter dropdown on the
 * fleet Devices table.
 */
export const IOT_DEVICE_KINDS: Array<IoTDeviceKind> = [
  "Device",
  "Sensor",
  "Gateway",
];

/*
 * True when the latest-metric mirror columns (battery / signal /
 * temperature / cpu / memory) are fresh enough to display as live
 * numbers. Rows whose metricsUpdatedAt is older than METRIC_STALE_MS
 * (or missing entirely) must render the mirrors as stale — same
 * contract as the at-risk list on the fleet overview.
 */
export function areLatestMetricsFresh(row: IoTDeviceModel): boolean {
  if (!row.metricsUpdatedAt) {
    return false;
  }
  return (
    Date.now() - new Date(row.metricsUpdatedAt as Date).getTime() <=
    METRIC_STALE_MS
  );
}

/*
 * Tooltip text for stale metric cells — says when the mirrors were
 * last updated so the muted em-dash doesn't read as "never reported".
 */
export function staleMetricsTitle(row: IoTDeviceModel): string {
  if (!row.metricsUpdatedAt) {
    return "Stale — metrics have not been reported recently.";
  }
  return `Stale — metrics last updated ${OneUptimeDate.fromNow(
    new Date(row.metricsUpdatedAt as Date),
  )}.`;
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
 * The detail-route param is the device `externalId` verbatim (the
 * `device.id` datapoint label). It can contain characters that are
 * unsafe in a URL path segment, so it must travel through the URL
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
 * Display name for a device: prefer the human name from the
 * iot_device_info series; fall back to the externalId verbatim
 * (the `device.id` label).
 */
export function displayNameForDevice(row: IoTDeviceModel): string {
  if (row.name) {
    return row.name;
  }
  return row.externalId || "";
}

/*
 * Display status for a device. Lifecycle state wins over the raw isUp
 * flag: isUp is the last device-REPORTED up/down, state is the
 * lifecycle truth (a silent device is Offline/Stale even though its
 * last report said up). Legacy rows (state null) fall back to isUp.
 */
export function displayStatusForDevice(row: IoTDeviceModel): string {
  const state: string | undefined = row.state as string | undefined;
  if (
    state === "Online" ||
    state === "Offline" ||
    state === "Stale" ||
    state === "Retired"
  ) {
    return state;
  }
  if (row.isUp === undefined || row.isUp === null) {
    return "";
  }
  return row.isUp ? "Online" : "Offline";
}

const INVENTORY_SELECT: Record<string, boolean> = {
  kind: true,
  externalId: true,
  name: true,
  deviceType: true,
  firmwareVersion: true,
  isUp: true,
  uptimeSeconds: true,
  latestCpuPercent: true,
  latestMemoryBytes: true,
  maxMemoryBytes: true,
  latestMemoryPercent: true,
  latestBatteryPercent: true,
  latestSignalStrengthDbm: true,
  latestTemperatureCelsius: true,
  metricsUpdatedAt: true,
  lastSeenAt: true,
  state: true,
  stateChangedAt: true,
  isArchived: true,
};

/**
 * Fetch all IoTDevice inventory rows for a fleet, optionally filtered to
 * one kind. This is the authoritative "what exists in the fleet right
 * now" source — the same rows the sidebar badge counts and the overview
 * cards are computed from, so the pages can never drift from the badges.
 */
export async function fetchIoTInventoryRows(options: {
  iotFleetId: ObjectID;
  kind?: IoTDeviceKind | undefined;
}): Promise<Array<IoTDeviceModel>> {
  const query: Record<string, unknown> = {
    iotFleetId: options.iotFleetId,
  };
  if (options.kind) {
    query["kind"] = options.kind;
  }

  const result: ListResult<IoTDeviceModel> =
    await ModelAPI.getList<IoTDeviceModel>({
      modelType: IoTDeviceModel,
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
 * Fetch a single inventory row by its externalId (the detail-route
 * param). Returns null when the device has been pruned or never
 * reported.
 */
export async function fetchIoTInventoryRow(options: {
  iotFleetId: ObjectID;
  externalId: string;
}): Promise<IoTDeviceModel | null> {
  const result: ListResult<IoTDeviceModel> =
    await ModelAPI.getList<IoTDeviceModel>({
      modelType: IoTDeviceModel,
      query: {
        iotFleetId: options.iotFleetId,
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
  IOT_DEVICE_KINDS,
  areLatestMetricsFresh,
  staleMetricsTitle,
  formatBytes,
  formatPercent,
  formatUptime,
  formatBytesForChart,
  routeParamFromExternalId,
  externalIdFromRouteParam,
  displayNameForDevice,
  displayStatusForDevice,
  fetchIoTInventoryRows,
  fetchIoTInventoryRow,
};
