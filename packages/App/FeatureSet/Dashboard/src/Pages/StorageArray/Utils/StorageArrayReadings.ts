import Metric from "Common/Models/AnalyticsModels/Metric";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
import {
  StorageArrayLatencyReading,
  StorageArrayLatestReading,
  StorageArrayPlatform,
} from "Common/Types/StorageArray/StorageArrayPlatform";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { STORAGE_ARRAY_ATTRIBUTE } from "./StorageArrayResourceUtils";

/*
 * What the storage array pages read from the array's metrics where the
 * inventory has no column: the array's latest average read and write
 * latency (the High Read and Write Latency alerts' series) and each file
 * system's available share of its provisioned size (the File System Near
 * Full alert's), as the array's platform defines them
 * (StorageArrayPlatform.overview). Each is the newest reading per series in
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
 * The array's latest average latency, as its latency alerts read it (its
 * platform's overview.latency; an array whose platform is not known reads
 * as the default platform). Nothing for a platform without one.
 */
export async function loadStorageArrayLatency(data: {
  arrayName: string;
  storageSystem: string | null | undefined;
}): Promise<StorageArrayLatencyReadings> {
  const latency: StorageArrayLatencyReading | undefined =
    StorageArrayPlatformRegistry.getPlatformOrDefault(data.storageSystem)
      .overview.latency;
  if (!latency) {
    return { readUsec: null, writeUsec: null };
  }
  /*
   * Read and write latency each on a metric of their own (an ONTAP
   * cluster's): the newest reading of each for this array.
   */
  if (latency.readMetricName || latency.writeMetricName) {
    const newest: (
      metricName: string | undefined,
    ) => Promise<number | null> = async (
      metricName: string | undefined,
    ): Promise<number | null> => {
      if (!metricName) {
        return null;
      }
      const perArray: StorageArrayLatestPerLabel =
        await loadStorageArrayLatestPerLabel({
          arrayName: data.arrayName,
          metricName: metricName,
          labelAttribute: STORAGE_ARRAY_ATTRIBUTE,
        });
      return perArray.get(data.arrayName)?.value ?? null;
    };
    const [readUsec, writeUsec]: [number | null, number | null] =
      await Promise.all([
        newest(latency.readMetricName),
        newest(latency.writeMetricName),
      ]);
    return { readUsec: readUsec, writeUsec: writeUsec };
  }
  if (
    !latency.metricName ||
    !latency.dimensionLabel ||
    !latency.readDimension ||
    !latency.writeDimension
  ) {
    return { readUsec: null, writeUsec: null };
  }
  const readDimension: string = latency.readDimension;
  const writeDimension: string = latency.writeDimension;
  const perDimension: StorageArrayLatestPerLabel =
    await loadStorageArrayLatestPerLabel({
      arrayName: data.arrayName,
      metricName: latency.metricName,
      labelAttribute: latency.dimensionLabel,
      attributes: latency.attributes,
    });
  return {
    readUsec: perDimension.get(readDimension)?.value ?? null,
    writeUsec: perDimension.get(writeDimension)?.value ?? null,
  };
}

/*
 * Where an array's file systems' free share is read
 * (overview.fileSystemFreeSpace): its platform's, or - when the platform
 * is not given - the first platform's that has one.
 */
function getFileSystemFreeSpaceReading(
  storageSystem: string | null | undefined,
): StorageArrayLatestReading | undefined {
  const platform: StorageArrayPlatform | null =
    StorageArrayPlatformRegistry.getPlatform(storageSystem);
  if (platform) {
    return platform.overview.fileSystemFreeSpace;
  }
  return StorageArrayPlatformRegistry.getPlatforms().find(
    (candidate: StorageArrayPlatform): boolean => {
      return Boolean(candidate.overview.fileSystemFreeSpace);
    },
  )?.overview.fileSystemFreeSpace;
}

/*
 * Each file system's latest available share of its provisioned size, 0 to
 * 1, by its name (the File System Near Full alert's reading). Empty for a
 * platform that reports none.
 */
export async function loadFileSystemAvailableRatios(
  arrayName: string,
  storageSystem?: string | null | undefined,
): Promise<Map<string, number>> {
  const reading: StorageArrayLatestReading | undefined =
    getFileSystemFreeSpaceReading(storageSystem);
  if (!reading) {
    return new Map();
  }
  const perName: StorageArrayLatestPerLabel =
    await loadStorageArrayLatestPerLabel({
      arrayName: arrayName,
      metricName: reading.metricName,
      labelAttribute: reading.labelAttribute,
      attributes: reading.attributes,
    });
  const ratios: Map<string, number> = new Map();
  for (const [name, entry] of perName.entries()) {
    ratios.set(name, entry.value);
  }
  return ratios;
}
