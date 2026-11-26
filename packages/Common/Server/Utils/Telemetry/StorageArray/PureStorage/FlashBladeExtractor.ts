import StorageArrayResourceKind from "../../../../../Types/StorageArray/StorageArrayResourceKind";
import PureStorageFlashBladePlatform from "../../../../../Types/StorageArray/Platforms/PureStorage/FlashBlade/FlashBladePlatform";
import {
  StorageArrayExtractor,
  StorageArrayResourceBufferEntry,
  StorageArraySeries,
  markStorageArrayKindComplete,
} from "../StorageArrayExtractor";
import {
  applyPurePerformance,
  applyPureSpaceDimension,
  readPureArrayDataReductionRatio,
  readPureArraySpaceBytes,
  readPureArraySpaceUtilization,
  readPureInfo,
  readPureOpenAlert,
} from "./PureStorageSeries";

/*
 * PURE STORAGE FLASHBLADE: one purefb_* datapoint into the array's
 * inventory and snapshot.
 *
 * Its families, by the endpoint the agent reads them from through Pure's
 * exporter: /metrics/array (identity, capacity, data reduction, open
 * alerts, hardware health), /metrics/filesystems and /metrics/objectstore
 * (each file system's and bucket's space, data reduction and performance).
 */

/*
 * The array-wide space families report array, file-system and object-store
 * rows; only the whole-array row describes the array.
 */
function isArrayRow(series: StorageArraySeries): boolean {
  return series.label("type") === "array";
}

function readHardwareHealth(series: StorageArraySeries): void {
  const componentName: string | null = series.label("name");
  if (!componentName) {
    return;
  }
  markStorageArrayKindComplete(series.array, StorageArrayResourceKind.Hardware);
  const patch: StorageArrayResourceBufferEntry = series.newResource(
    StorageArrayResourceKind.Hardware,
    componentName,
  );
  patch.name = componentName;
  patch.componentType = series.label("type");
  // The exporter maps healthy -> 1, unused -> 2 and anything else -> 0.
  patch.status =
    series.value === 1
      ? "healthy"
      : series.value === 2
        ? "unused"
        : "unhealthy";
  const slot: string | null = series.label("slot");
  if (slot) {
    patch.details["slot"] = slot;
  }
  series.fold(patch);
}

function readFileSystem(series: StorageArraySeries): void {
  const metricName: string = series.metricName;
  const fileSystemName: string | null = series.label("name");
  if (!fileSystemName) {
    return;
  }
  markStorageArrayKindComplete(
    series.array,
    StorageArrayResourceKind.FileSystem,
  );
  const patch: StorageArrayResourceBufferEntry = series.newResource(
    StorageArrayResourceKind.FileSystem,
    fileSystemName,
  );
  patch.name = fileSystemName;
  const nfs: string | null = series.label("nfs");
  if (nfs) {
    patch.details["nfs"] = nfs;
  }
  const smb: string | null = series.label("smb");
  if (smb) {
    patch.details["smb"] = smb;
  }
  const nfsPolicy: string | null = series.label("nfspolicy");
  if (nfsPolicy) {
    patch.details["nfsPolicy"] = nfsPolicy;
  }
  if (metricName === "purefb_file_systems_space_bytes") {
    const space: string | null = series.label("space");
    if (
      !applyPureSpaceDimension(patch, space, series.value) &&
      space === "provisioned"
    ) {
      // `provisioned` is the configured size; total_provisioned wins when both arrive.
      patch.details["provisionedBytes"] = Math.max(0, Math.trunc(series.value));
    }
  } else if (metricName === "purefb_file_systems_space_data_reduction_ratio") {
    patch.dataReductionRatio = Math.max(0, series.value);
  } else {
    applyPurePerformance(series, patch);
  }
  series.fold(patch);
}

function readBucket(series: StorageArraySeries): void {
  const metricName: string = series.metricName;
  const bucketName: string | null = series.label("name");
  if (!bucketName) {
    return;
  }
  markStorageArrayKindComplete(series.array, StorageArrayResourceKind.Bucket);
  const patch: StorageArrayResourceBufferEntry = series.newResource(
    StorageArrayResourceKind.Bucket,
    bucketName,
  );
  patch.name = bucketName;
  patch.groupName = series.label("account");
  if (metricName === "purefb_buckets_space_bytes") {
    const space: string | null = series.label("space");
    // A bucket's size is its quota (below); what it holds is total_physical.
    if (space === "total_physical") {
      patch.usedBytes = Math.max(0, Math.trunc(series.value));
    } else if (space === "virtual") {
      patch.details["virtualBytes"] = Math.max(0, Math.trunc(series.value));
    }
  } else if (metricName === "purefb_buckets_quota_space_bytes") {
    patch.capacityBytes = Math.max(0, Math.trunc(series.value));
    const hardLimit: string | null = series.label("hard_limit_enabled");
    if (hardLimit) {
      patch.details["hardLimitEnabled"] = hardLimit === "true";
    }
  } else if (metricName === "purefb_buckets_space_data_reduction_ratio") {
    patch.dataReductionRatio = Math.max(0, series.value);
  } else if (metricName === "purefb_buckets_object_count") {
    patch.details["objectCount"] = Math.max(0, Math.trunc(series.value));
  } else {
    applyPurePerformance(series, patch);
  }
  series.fold(patch);
}

function extractFlashBladeSeries(series: StorageArraySeries): void {
  const metricName: string = series.metricName;

  // ---------------- Array-level series (no inventory row) ----------------

  if (metricName === "purefb_info") {
    readPureInfo(series, PureStorageFlashBladePlatform);
    return;
  }
  if (metricName === "purefb_alerts_open") {
    readPureOpenAlert(series);
    return;
  }
  if (metricName === "purefb_array_space_bytes") {
    if (isArrayRow(series)) {
      readPureArraySpaceBytes(series);
    }
    return;
  }
  if (metricName === "purefb_array_space_utilization") {
    if (isArrayRow(series)) {
      readPureArraySpaceUtilization(series);
    }
    return;
  }
  if (metricName === "purefb_array_space_data_reduction_ratio") {
    if (isArrayRow(series)) {
      readPureArrayDataReductionRatio(series);
    }
    return;
  }

  // ---------------- Inventory ----------------

  if (metricName === "purefb_hardware_health") {
    readHardwareHealth(series);
    return;
  }
  if (metricName.startsWith("purefb_file_systems_")) {
    readFileSystem(series);
    return;
  }
  if (metricName.startsWith("purefb_buckets_")) {
    readBucket(series);
  }
}

const FlashBladeExtractor: StorageArrayExtractor = {
  storageSystem: PureStorageFlashBladePlatform.storageSystem,
  extract: extractFlashBladeSeries,
};

export default FlashBladeExtractor;
