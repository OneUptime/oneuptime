import { StorageArrayPlatform } from "../../../../../Types/StorageArray/StorageArrayPlatform";
import {
  SCRAPE_ENDPOINT_LABEL,
  StorageArrayResourceBufferEntry,
  StorageArraySeries,
  markScrapedEndpoint,
} from "../StorageArrayExtractor";

/*
 * What Pure Storage's FlashArray and FlashBlade series share: the semantic
 * conventions of Pure's exporters (FlashArray series come from Purity//FA's
 * native OpenMetrics endpoint or the deprecated pure-fa-openmetrics-exporter
 * - same names and labels - FlashBlade series from
 * pure-fb-openmetrics-exporter). Every value is a gauge the array computes
 * itself (usec_per_read_op, reads_per_sec, read_bytes_per_sec), so no rate
 * math happens here. Identity lives in datapoint labels (`name`, `host`,
 * `component_name`), exactly like ceph-mgr's `ceph_daemon`.
 */

export function lowerOrNull(value: string | null): string | null {
  return value ? value.toLowerCase() : null;
}

export type PurePerformanceFamily = "latency" | "iops" | "bandwidth";

export function getPurePerformanceFamily(
  metricName: string,
): PurePerformanceFamily | null {
  if (metricName.endsWith("_performance_latency_usec")) {
    return "latency";
  }
  if (metricName.endsWith("_performance_throughput_iops")) {
    return "iops";
  }
  if (metricName.endsWith("_performance_bandwidth_bytes")) {
    return "bandwidth";
  }
  return null;
}

/*
 * The three performance families every object kind shares - latency, IOPS
 * and bandwidth - keyed by the `dimension` label. Only the read / write
 * dimensions land in columns; the breakdowns (queue_usec_per_*, san_usec_*,
 * mirrored writes) stay in ClickHouse for the charts.
 */
export function applyPurePerformanceDimension(
  patch: StorageArrayResourceBufferEntry,
  family: PurePerformanceFamily,
  dimension: string | null,
  value: number,
): boolean {
  if (!dimension) {
    return false;
  }
  const positive: number = Math.max(0, value);
  if (family === "latency") {
    if (dimension === "usec_per_read_op") {
      patch.readLatencyUsec = positive;
      return true;
    }
    if (dimension === "usec_per_write_op") {
      patch.writeLatencyUsec = positive;
      return true;
    }
    return false;
  }
  if (family === "iops") {
    if (dimension === "reads_per_sec") {
      patch.readIops = positive;
      return true;
    }
    if (dimension === "writes_per_sec") {
      patch.writeIops = positive;
      return true;
    }
    return false;
  }
  if (dimension === "read_bytes_per_sec") {
    patch.readBytesPerSec = positive;
    return true;
  }
  if (dimension === "write_bytes_per_sec") {
    patch.writeBytesPerSec = positive;
    return true;
  }
  return false;
}

// A series of a performance family, read into its row's columns.
export function applyPurePerformance(
  series: StorageArraySeries,
  patch: StorageArrayResourceBufferEntry,
): void {
  const family: PurePerformanceFamily | null = getPurePerformanceFamily(
    series.metricName,
  );
  if (family) {
    applyPurePerformanceDimension(
      patch,
      family,
      series.label("dimension"),
      series.value,
    );
  }
}

/*
 * The space families: FlashArray objects report `space` dimensions
 * total_provisioned (the size a host sees) and total_physical (what the
 * object occupies after data reduction); FlashBlade file systems and
 * buckets report the same two names.
 */
export function applyPureSpaceDimension(
  patch: StorageArrayResourceBufferEntry,
  space: string | null,
  value: number,
): boolean {
  if (space === "total_provisioned") {
    patch.capacityBytes = Math.max(0, Math.trunc(value));
    return true;
  }
  if (space === "total_physical") {
    patch.usedBytes = Math.max(0, Math.trunc(value));
    return true;
  }
  return false;
}

// One open alert, however many scrapes of the array endpoint a batch holds.
function alertKey(series: StorageArraySeries): string {
  return [
    "code",
    "name",
    "component_name",
    "component_type",
    "created",
    "summary",
  ]
    .map((label: string) => {
      return series.label(label) || "";
    })
    .join("|");
}

/*
 * purefa_info / purefb_info: the array's own name, system id, OS and
 * version (first-non-null-wins across the batch), and the endpoint the
 * series was scraped from. Array-level: never an inventory row.
 */
export function readPureInfo(
  series: StorageArraySeries,
  platform: StorageArrayPlatform,
): void {
  const array: StorageArraySeries["array"] = series.array;
  array.reportedName = array.reportedName || series.label("array_name");
  array.systemId = array.systemId || series.label("system_id");
  array.osName = array.osName || series.label("os");
  array.osVersion = array.osVersion || series.label("version");
  markScrapedEndpoint(array, series.label(SCRAPE_ENDPOINT_LABEL), platform);
}

/*
 * purefa_alerts_open / purefb_alerts_open: one series per open alert,
 * value 1, with its severity in a label. Hidden alerts are the array's own
 * internal bookkeeping.
 */
export function readPureOpenAlert(series: StorageArraySeries): void {
  const array: StorageArraySeries["array"] = series.array;
  array.sawAlerts = true;
  const severity: string | null = lowerOrNull(series.label("severity"));
  if (severity === "hidden") {
    return;
  }
  const key: string = alertKey(series);
  array.openAlertKeys.add(key);
  if (severity === "critical") {
    array.criticalAlertKeys.add(key);
  } else if (severity === "warning") {
    array.warningAlertKeys.add(key);
  }
}

// The array's capacity, by its `space` dimension; its endpoint was scraped.
export function readPureArraySpaceBytes(series: StorageArraySeries): void {
  const array: StorageArraySeries["array"] = series.array;
  // The array endpoint was scraped: its alert list is complete.
  array.sawAlerts = true;
  const space: string | null = series.label("space");
  if (space === "capacity") {
    array.capacityBytes = Math.max(0, series.value);
  } else if (space === "empty") {
    array.emptyBytes = Math.max(0, series.value);
  }
}

export function readPureArraySpaceUtilization(
  series: StorageArraySeries,
): void {
  series.array.sawAlerts = true;
  series.array.utilizationPercent = Math.max(0, series.value);
}

export function readPureArrayDataReductionRatio(
  series: StorageArraySeries,
): void {
  series.array.dataReductionRatio = Math.max(0, series.value);
}
