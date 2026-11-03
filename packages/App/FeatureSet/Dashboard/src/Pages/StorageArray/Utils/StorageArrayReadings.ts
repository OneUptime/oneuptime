import Metric from "Common/Models/AnalyticsModels/Metric";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import StorageSystem from "Common/Types/StorageArray/StorageSystem";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { STORAGE_ARRAY_ATTRIBUTE } from "./StorageArrayResourceUtils";

/*
 * What the storage array pages read from the array's metrics where the
 * inventory has no column: the array's latest average read and write
 * latency (the High Read and Write Latency alerts' series) and each
 * FlashBlade file system's available share of its provisioned size (the
 * File System Near Full alert's). Each is the newest reading per series in
 * the last 10 minutes: the agent scrapes the array every minute.
 */

export const STORAGE_ARRAY_LATEST_WINDOW_MINUTES: number = 10;

// The newest readings of a metric this read takes; newest first.
export const STORAGE_ARRAY_LATEST_READINGS_LIMIT: number = 1000;

export type StorageArrayLatestPerLabel = Map<
  string,
  { value: number; attrs: Record<string, unknown> }
>;

/*
 * The newest reading of a metric per value of one of its labels (`name`,
 * `dimension`), among the series that carry the attributes given.
 */
export async function loadStorageArrayLatestPerLabel(data: {
  arrayName: string;
  metricName: string;
  labelAttribute: string;
  attributes?: Record<string, string> | undefined;
}): Promise<StorageArrayLatestPerLabel> {
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveMinutes(
    endDate,
    -STORAGE_ARRAY_LATEST_WINDOW_MINUTES,
  );

  /*
   * `any`-typed, as the pages' own reads: the attributes filter with the
   * generic select is a TS2589 deep instantiation otherwise.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const request: any = {
    modelType: Metric,
    query: {
      projectId: ProjectUtil.getCurrentProjectId()!.toString(),
      name: data.metricName,
      time: new InBetween<Date>(startDate, endDate),
      attributes: {
        [STORAGE_ARRAY_ATTRIBUTE]: data.arrayName,
        ...(data.attributes || {}),
      },
    },
    limit: STORAGE_ARRAY_LATEST_READINGS_LIMIT,
    skip: 0,
    select: {
      time: true,
      value: true,
      attributes: true,
    },
    sort: {
      time: SortOrder.Descending,
    },
    requestOptions: {},
  };

  const result: ListResult<Metric> =
    await AnalyticsModelAPI.getList<Metric>(request);

  // Newest first, so the first reading per label value is its newest.
  const perKey: StorageArrayLatestPerLabel = new Map();
  for (const metric of result.data) {
    const attrs: Record<string, unknown> =
      (metric.attributes as Record<string, unknown>) || {};
    const key: string = String(attrs[data.labelAttribute] ?? "");
    if (!key || perKey.has(key)) {
      continue;
    }
    const value: number = Number(metric.value);
    if (Number.isFinite(value)) {
      perKey.set(key, { value: value, attrs: attrs });
    }
  }
  return perKey;
}

export interface StorageArrayLatencyReadings {
  // Average µs per read and per write operation; null where none came.
  readUsec: number | null;
  writeUsec: number | null;
}

/*
 * The array's latest average latency, as its latency alerts read it: a
 * FlashArray's purefa_array_performance_latency_usec, a FlashBlade's
 * purefb_array_performance_latency_usec across all protocols.
 */
export async function loadStorageArrayLatency(data: {
  arrayName: string;
  storageSystem: string | null | undefined;
}): Promise<StorageArrayLatencyReadings> {
  const isFlashBlade: boolean =
    data.storageSystem === StorageSystem.PureStorageFlashBlade;
  const perDimension: StorageArrayLatestPerLabel =
    await loadStorageArrayLatestPerLabel({
      arrayName: data.arrayName,
      metricName: isFlashBlade
        ? "purefb_array_performance_latency_usec"
        : "purefa_array_performance_latency_usec",
      labelAttribute: "dimension",
      attributes: isFlashBlade ? { protocol: "all" } : undefined,
    });
  return {
    readUsec: perDimension.get("usec_per_read_op")?.value ?? null,
    writeUsec: perDimension.get("usec_per_write_op")?.value ?? null,
  };
}

/*
 * Each FlashBlade file system's latest available share of its provisioned
 * size, by its name (purefb_file_systems_space_bytes, space
 * available_ratio).
 */
export async function loadFileSystemAvailableRatios(
  arrayName: string,
): Promise<Map<string, number>> {
  const perName: StorageArrayLatestPerLabel =
    await loadStorageArrayLatestPerLabel({
      arrayName: arrayName,
      metricName: "purefb_file_systems_space_bytes",
      labelAttribute: "name",
      attributes: { space: "available_ratio" },
    });
  const ratios: Map<string, number> = new Map();
  for (const [name, entry] of perName.entries()) {
    ratios.set(name, entry.value);
  }
  return ratios;
}
