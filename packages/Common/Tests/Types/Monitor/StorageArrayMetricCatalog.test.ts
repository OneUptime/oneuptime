import {
  StorageArrayMetricCategory,
  StorageArrayMetricDefinition,
  getAllStorageArrayMetricCategories,
  getAllStorageArrayMetrics,
  getStorageArrayMetric,
  getStorageArrayMetricById,
  getStorageArrayMetricByMetricName,
  getStorageArrayMetricsByCategory,
  getStorageArrayMetricsForSystem,
  getStorageArrayObjectLabel,
} from "../../../Types/Monitor/StorageArrayMetricCatalog";
import { StorageArrayResourceScope } from "../../../Types/Monitor/MonitorStepStorageArrayMonitor";
import { STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES } from "../../../Server/Utils/Telemetry/StorageArraySnapshotScan";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import StorageSystemUtil from "../../../Types/StorageArray/StorageSystemUtil";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  CapturedSeries,
  parseOpenMetrics,
} from "../../Helpers/StorageArray/OpenMetricsCapture";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The storage array metric catalog drives the monitor form's metric picker,
 * the resource filters and the one-click templates. Pure's series carry
 * read, write, queue, SAN and QoS figures on ONE metric name, told apart
 * only by a label, so an entry is only correct if its pinned labels are
 * real and its object label is one the series carries.
 *
 * PURE_SERIES below is transcribed from the exporters' prometheus.NewDesc
 * calls (pure-fa-openmetrics-exporter, which Purity//FA's native endpoint
 * mirrors, and pure-fb-openmetrics-exporter): label name -> the values the
 * exporter emits, or null for a free-form label (an object's name).
 */

type SeriesLabels = Record<string, Array<string> | null>;

const FA_LATENCY_DIMENSIONS: Array<string> = [
  "queue_usec_per_mirrored_write_op",
  "queue_usec_per_read_op",
  "queue_usec_per_write_op",
  "san_usec_per_mirrored_write_op",
  "san_usec_per_read_op",
  "san_usec_per_write_op",
  "service_usec_per_mirrored_write_op",
  "service_usec_per_read_op",
  "service_usec_per_write_op",
  "qos_rate_limit_usec_per_mirrored_write_op",
  "qos_rate_limit_usec_per_read_op",
  "qos_rate_limit_usec_per_write_op",
  "usec_per_mirrored_write_op",
  "usec_per_read_op",
  "usec_per_write_op",
  "service_usec_per_read_op_cache_reduction",
];
const FA_IOPS_DIMENSIONS: Array<string> = [
  "mirrored_writes_per_sec",
  "reads_per_sec",
  "writes_per_sec",
  "others_per_sec",
];
const FA_BANDWIDTH_DIMENSIONS: Array<string> = [
  "mirrored_write_bytes_per_sec",
  "read_bytes_per_sec",
  "write_bytes_per_sec",
];
const FA_SPACE: Array<string> = [
  "shared",
  "snapshots",
  "system",
  "thin_provisioning",
  "total_physical",
  "total_provisioned",
  "total_reduction",
  "unique",
  "virtual",
  "replication",
  "shared_effective",
  "snapshots_effective",
  "unique_effective",
  "total_effective",
];
const FB_LATENCY_DIMENSIONS: Array<string> = [
  "usec_per_other_op",
  "usec_per_read_op",
  "usec_per_write_op",
];
const FB_IOPS_DIMENSIONS: Array<string> = [
  "others_per_sec",
  "reads_per_sec",
  "writes_per_sec",
];
const FB_BANDWIDTH_DIMENSIONS: Array<string> = [
  "read_bytes_per_sec",
  "write_bytes_per_sec",
];
const FB_SPACE: Array<string> = [
  "snapshots",
  "total_physical",
  "unique",
  "virtual",
  "total_provisioned",
  "available_provisioned",
  "available_ratio",
  "destroyed",
  "destroyed_virtual",
  "shared",
];
const FB_PROTOCOLS: Array<string> = ["all", "HTTP", "SMB", "NFS", "S3"];
const REPLICA_LINK: SeriesLabels = {
  remote: null,
  local_pod: null,
  remote_pod: null,
  direction: null,
  status: null,
};

const PURE_SERIES: Record<string, SeriesLabels> = {
  purefa_alerts_open: {
    category: ["array", "hardware", "software"],
    code: null,
    component_type: null,
    created: null,
    issue: null,
    name: null,
    severity: ["info", "warning", "critical", "hidden"],
    summary: null,
  },
  purefa_array_space_bytes: { space: [...FA_SPACE, "capacity", "empty"] },
  purefa_array_space_utilization: {},
  purefa_array_space_data_reduction_ratio: {},
  purefa_array_performance_latency_usec: {
    dimension: [
      ...FA_LATENCY_DIMENSIONS,
      "local_queue_usec_per_op",
      "usec_per_other_op",
    ],
  },
  purefa_array_performance_throughput_iops: { dimension: FA_IOPS_DIMENSIONS },
  purefa_array_performance_bandwidth_bytes: {
    dimension: FA_BANDWIDTH_DIMENSIONS,
  },
  purefa_array_performance_average_bytes: {
    dimension: [
      "bytes_per_mirrored_write",
      "bytes_per_op",
      "bytes_per_read",
      "bytes_per_write",
    ],
  },
  purefa_array_performance_queue_depth_ops: {},
  purefa_volume_performance_latency_usec: {
    naa_id: null,
    name: null,
    dimension: FA_LATENCY_DIMENSIONS,
  },
  purefa_volume_performance_throughput_iops: {
    naa_id: null,
    name: null,
    dimension: FA_IOPS_DIMENSIONS,
  },
  purefa_volume_performance_bandwidth_bytes: {
    naa_id: null,
    name: null,
    dimension: FA_BANDWIDTH_DIMENSIONS,
  },
  purefa_volume_space_bytes: {
    naa_id: null,
    name: null,
    pod: null,
    volume_group: null,
    space: FA_SPACE,
  },
  purefa_volume_space_data_reduction_ratio: {
    naa_id: null,
    name: null,
    pod: null,
    volume_group: null,
  },
  purefa_host_connectivity_info: {
    host: null,
    details: null,
    status: ["unused", "critical", "healthy"],
  },
  purefa_host_performance_latency_usec: {
    host: null,
    dimension: FA_LATENCY_DIMENSIONS,
  },
  purefa_host_performance_throughput_iops: {
    host: null,
    dimension: FA_IOPS_DIMENSIONS,
  },
  purefa_pod_replica_links_lag_max_msec: REPLICA_LINK,
  purefa_pod_replica_links_lag_average_msec: REPLICA_LINK,
  purefa_pod_performance_replication_bandwidth_bytes: {
    dimension: ["continuous", "resync", "sync", "periodic"],
    direction: ["from_remote", "to_remote", "total"],
    name: null,
  },
  purefa_pod_performance_latency_usec: {
    name: null,
    dimension: [...FA_LATENCY_DIMENSIONS, "usec_per_other_op"],
  },
  purefa_hw_component_status: {
    component_name: null,
    component_type: null,
    component_status: [
      "ok",
      "critical",
      "degraded",
      "device_off",
      "identifying",
      "not_installed",
      "unknown",
    ],
  },
  purefa_hw_component_temperature_celsius: {
    component_name: null,
    component_type: null,
  },
  purefa_drive_capacity_bytes: {
    component_name: null,
    component_type: null,
    component_status: [
      "empty",
      "failed",
      "healthy",
      "identifying",
      "missing",
      "recovering",
      "unadmitted",
      "unhealthy",
      "unrecognized",
      "updating",
    ],
    component_protocol: null,
  },
  purefa_network_interface_performance_errors: {
    name: null,
    type: ["eth", "fc"],
    dimension: [
      "other_errors_per_sec",
      "received_crc_errors_per_sec",
      "received_frame_errors_per_sec",
      "received_link_failures_per_sec",
      "received_loss_of_signal_per_sec",
      "received_loss_of_sync_per_sec",
      "total_errors_per_sec",
      "transmitted_carrier_errors_per_sec",
      "transmitted_dropped_errors_per_sec",
      "transmitted_invalid_words_per_sec",
    ],
  },
  purefb_alerts_open: {
    action: null,
    code: null,
    component_name: null,
    component_type: null,
    created: null,
    kburl: null,
    severity: ["info", "warning", "critical"],
    summary: null,
  },
  purefb_hardware_health: { type: null, name: null, index: null, slot: null },
  purefb_array_space_utilization: {
    type: ["array", "file-system", "object-store"],
  },
  purefb_array_space_bytes: {
    type: ["array", "file-system", "object-store"],
    space: [...FB_SPACE, "capacity", "empty"],
  },
  purefb_array_space_data_reduction_ratio: {
    type: ["array", "file-system", "object-store"],
  },
  purefb_array_performance_latency_usec: {
    protocol: FB_PROTOCOLS,
    dimension: FB_LATENCY_DIMENSIONS,
  },
  purefb_array_performance_throughput_iops: {
    protocol: FB_PROTOCOLS,
    dimension: FB_IOPS_DIMENSIONS,
  },
  purefb_array_performance_bandwidth_bytes: {
    protocol: FB_PROTOCOLS,
    dimension: FB_BANDWIDTH_DIMENSIONS,
  },
  purefb_file_systems_performance_latency_usec: {
    name: null,
    dimension: FB_LATENCY_DIMENSIONS,
  },
  purefb_file_systems_space_bytes: {
    name: null,
    nfspolicy: null,
    nfs: null,
    smb: null,
    space: [...FB_SPACE, "provisioned"],
  },
  purefb_buckets_performance_latency_usec: {
    name: null,
    dimension: FB_LATENCY_DIMENSIONS,
  },
  purefb_buckets_space_bytes: {
    name: null,
    account: null,
    space: [...FB_SPACE, "object_count"],
  },
  purefb_buckets_object_count: { name: null, account: null },
};

/*
 * Dell PowerStore's series, label by label, as Dell's exporter
 * (powerstore-metrics-exporter v1.0.3) answered every path the agent scrapes
 * (packages/Common/Tests/Fixtures/DellPowerStoreExporter: the recordings),
 * and the two percents the agent divides out of them, which keep the
 * labels of the series they are divided from. Dell's labels name objects,
 * so every value is free-form.
 */
function readPowerStoreSeries(): Record<string, SeriesLabels> {
  const directory: string = path.join(
    __dirname,
    "../../Fixtures/DellPowerStoreExporter/v1.0.3/bulk",
  );
  const series: Record<string, SeriesLabels> = {};
  for (const file of fs.readdirSync(directory)) {
    for (const one of parseOpenMetrics(
      fs.readFileSync(path.join(directory, file), "utf8"),
    )) {
      const labels: SeriesLabels = series[one.name] || {};
      for (const key of Object.keys((one as CapturedSeries).labels)) {
        labels[key] = null;
      }
      series[one.name] = labels;
    }
  }
  series["powerstore_cap_physical_used_percent"] = {
    ...series["powerstore_cap_last_physical_used"]!,
  };
  series["powerstore_filesystem_logical_used_percent"] = {
    ...series["powerstore_filesystem_logical_used"]!,
  };
  return series;
}

const POWERSTORE_SERIES: Record<string, SeriesLabels> = readPowerStoreSeries();

/*
 * Dell PowerMax (#11004): the labels the probe writes on each series it
 * reads from Unisphere (Probe/Utils/StorageArray/Dell/PowerMax/
 * PowerMaxOtlpBuilder.ts), which the probe's PowerMaxIngestContract holds
 * it to.
 */
const PM_STORAGE_GROUP: SeriesLabels = { storage_group: null };
const PM_SRP: SeriesLabels = { srp: null };
const PM_DIRECTOR: SeriesLabels = { director: null, component: null };
const PM_PORT: SeriesLabels = {
  port_id: null,
  component: null,
  director: null,
  port: null,
};
const PM_SRDF_GROUP: SeriesLabels = { srdf_group: null, srdf_label: null };
const POWERMAX_SERIES: Record<string, SeriesLabels> = {
  powermax_alert_open: {
    alert_id: null,
    severity: ["critical", "warning"],
    alert_type: null,
    object: null,
    object_type: null,
    description: null,
    created: null,
  },
  powermax_array_health_score: { health_metric: null },
  powermax_array_performance_collection: { realtime: ["true", "false"] },
  powermax_array_capacity_used_percent: {},
  powermax_array_capacity_usable_bytes: {},
  powermax_array_capacity_used_bytes: {},
  powermax_array_capacity_subscribed_bytes: {},
  powermax_array_data_reduction_ratio: {},
  powermax_srp_capacity_used_percent: PM_SRP,
  powermax_srp_capacity_used_bytes: PM_SRP,
  powermax_srp_response_time_usec: PM_SRP,
  powermax_array_response_time_usec: { operation: ["read", "write"] },
  powermax_array_read_iops: {},
  powermax_array_write_iops: {},
  powermax_array_read_throughput_bytes: {},
  powermax_array_write_throughput_bytes: {},
  powermax_array_cache_hit_percent: {},
  powermax_array_write_pending_percent: {},
  powermax_array_frontend_busy_percent: {},
  powermax_array_backend_busy_percent: {},
  powermax_array_srdf_busy_percent: {},
  powermax_storage_group_response_time_usec: PM_STORAGE_GROUP,
  powermax_storage_group_read_response_time_usec: PM_STORAGE_GROUP,
  powermax_storage_group_write_response_time_usec: PM_STORAGE_GROUP,
  powermax_storage_group_iops: PM_STORAGE_GROUP,
  powermax_storage_group_throughput_bytes: PM_STORAGE_GROUP,
  powermax_storage_group_used_bytes: PM_STORAGE_GROUP,
  powermax_storage_group_host_io_limit_exceeded_percent: PM_STORAGE_GROUP,
  powermax_storage_group_realtime_read_response_time_usec: PM_STORAGE_GROUP,
  powermax_storage_group_realtime_write_response_time_usec: PM_STORAGE_GROUP,
  powermax_storage_group_realtime_iops: PM_STORAGE_GROUP,
  powermax_storage_group_realtime_throughput_bytes: PM_STORAGE_GROUP,
  powermax_volume_response_time_usec: { volume: null },
  powermax_volume_iops: { volume: null },
  powermax_volume_used_bytes: { volume: null, volume_name: null },
  powermax_director_offline: { ...PM_DIRECTOR, role: null, status: null },
  powermax_director_busy_percent: PM_DIRECTOR,
  powermax_port_offline: { ...PM_PORT, protocol: null, status: null },
  powermax_port_busy_percent: PM_PORT,
  powermax_port_read_throughput_bytes: PM_PORT,
  powermax_port_rx_power_milliwatts: PM_PORT,
  powermax_srdf_group_not_healthy: {
    ...PM_SRDF_GROUP,
    state: null,
    remote_symmetrix_id: null,
  },
  powermax_srdf_group_lag_seconds: PM_SRDF_GROUP,
  powermax_srdf_group_throughput_bytes: PM_SRDF_GROUP,
  powermax_srdf_group_response_time_usec: PM_SRDF_GROUP,
};

// Every shipped platform's series.
const SERIES: Record<string, SeriesLabels> = {
  ...PURE_SERIES,
  ...POWERSTORE_SERIES,
  ...POWERMAX_SERIES,
};

const ALL_METRICS: Array<StorageArrayMetricDefinition> =
  getAllStorageArrayMetrics();

const FA: StorageSystem = StorageSystem.PureStorageFlashArray;
const FB: StorageSystem = StorageSystem.PureStorageFlashBlade;
const PS: StorageSystem = StorageSystem.DellPowerStore;
// Read by a probe from Unisphere (#11004).
const PM: StorageSystem = StorageSystem.DellPowerMax;

// Each platform's catalog ids and series names start with these.
const PREFIXES: Record<string, { id: string; series: string }> = {
  [FA]: { id: "purefa-", series: "purefa_" },
  [FB]: { id: "purefb-", series: "purefb_" },
  [PS]: { id: "powerstore-", series: "powerstore_" },
  [PM]: { id: "powermax-", series: "powermax_" },
};

function onlySystem(metric: StorageArrayMetricDefinition): StorageSystem {
  expect(metric.storageSystems).toHaveLength(1);
  return metric.storageSystems[0]!;
}

function pinned(metric: StorageArrayMetricDefinition): Record<string, string> {
  return metric.attributes || {};
}

describe("StorageArrayMetricCatalog - every entry", () => {
  const validAggregations: Array<string> = Object.values(AggregationType);
  const validScopes: Array<string> = Object.values(StorageArrayResourceScope);

  test("returns a non-empty catalog", () => {
    expect(Array.isArray(ALL_METRICS)).toBe(true);
    expect(ALL_METRICS.length).toBeGreaterThan(40);
  });

  test("every metric definition has all required non-empty fields", () => {
    for (const metric of ALL_METRICS) {
      expect(typeof metric.id).toBe("string");
      expect(metric.id.length).toBeGreaterThan(0);
      expect(metric.friendlyName.trim().length).toBeGreaterThan(0);
      expect(metric.description.trim().length).toBeGreaterThan(20);
      expect(metric.metricName.length).toBeGreaterThan(0);
      expect(metric.category.length).toBeGreaterThan(0);
      expect(metric.storageSystems.length).toBeGreaterThan(0);
    }
  });

  test("ids are unique and carry their platform's prefix", () => {
    const ids: Array<string> = ALL_METRICS.map(
      (m: StorageArrayMetricDefinition) => {
        return m.id;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);

    for (const metric of ALL_METRICS) {
      const prefix: string = PREFIXES[onlySystem(metric)]!.id;
      expect(metric.id).toMatch(/^[a-z]+-[a-z0-9-]+$/);
      expect(metric.id.startsWith(prefix)).toBe(true);
    }
  });

  test("each entry belongs to exactly the platform its metric name's prefix says", () => {
    for (const metric of ALL_METRICS) {
      expect(StorageSystemUtil.isKnownSystem(onlySystem(metric))).toBe(true);
      expect(StorageSystemUtil.fromMetricName(metric.metricName)).toBe(
        onlySystem(metric),
      );
    }
  });

  test("every metric name is one the snapshot scan or its platform's exporter knows", () => {
    for (const metric of ALL_METRICS) {
      expect(
        SERIES[metric.metricName] !== undefined ||
          STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES.has(metric.metricName),
      ).toBe(true);
      // Every catalog metric is documented here, label by label.
      expect({
        metric: metric.id,
        documented: SERIES[metric.metricName] !== undefined,
      }).toEqual({ metric: metric.id, documented: true });
    }
  });

  test("every pinned attribute is a label the series carries, with a value the exporter emits", () => {
    for (const metric of ALL_METRICS) {
      const labels: SeriesLabels = SERIES[metric.metricName]!;
      for (const [key, value] of Object.entries(pinned(metric))) {
        // Datapoint labels are stored bare in ClickHouse.
        expect(key.startsWith("resource.")).toBe(false);
        expect(typeof value).toBe("string");
        expect(Object.keys(labels)).toContain(key);
        const allowed: Array<string> | null | undefined = labels[key];
        if (allowed) {
          expect({ metric: metric.id, key, value }).toEqual({
            metric: metric.id,
            key,
            value: allowed.includes(value) ? value : `<not emitted: ${value}>`,
          });
        }
      }
    }
  });

  test("each (metric, pinned attributes) pair is catalogued once", () => {
    const signatures: Array<string> = ALL_METRICS.map(
      (m: StorageArrayMetricDefinition) => {
        return `${m.metricName}|${JSON.stringify(
          Object.entries(pinned(m)).sort(),
        )}`;
      },
    );
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  test("entries sharing a metric name each pin the label that tells them apart, and agree on scope and object label", () => {
    const byName: Map<string, Array<StorageArrayMetricDefinition>> = new Map();
    for (const metric of ALL_METRICS) {
      byName.set(metric.metricName, [
        ...(byName.get(metric.metricName) || []),
        metric,
      ]);
    }

    for (const group of byName.values()) {
      if (group.length < 2) {
        continue;
      }
      for (const metric of group) {
        expect(Object.keys(pinned(metric)).length).toBeGreaterThan(0);
        expect(metric.defaultResourceScope).toBe(
          group[0]!.defaultResourceScope,
        );
        expect(metric.objectLabel).toBe(group[0]!.objectLabel);
      }
    }
  });

  test("performance families always pin their dimension", () => {
    /*
     * Pure puts read, write, mirrored, queue, SAN and QoS figures on one
     * metric name. An unpinned latency aggregates a 200µs read with a 4ms
     * queue figure.
     */
    const performanceFamily: RegExp =
      /_performance_(latency_usec|throughput_iops|bandwidth_bytes|average_bytes|errors)$/;
    for (const metric of ALL_METRICS) {
      if (performanceFamily.test(metric.metricName)) {
        expect(pinned(metric)["dimension"]).toBeDefined();
      }
    }
  });

  test("pod replication bandwidth pins direction=total, so a direction is never read as the whole", () => {
    /*
     * One series per replication type and per direction: from_remote,
     * to_remote, and their total. Unpinned, the Max of the twelve was
     * sometimes one direction and sometimes the total.
     */
    const bandwidth: StorageArrayMetricDefinition | undefined =
      getStorageArrayMetricById("purefa-pod-replication-bandwidth");

    expect(bandwidth).toBeDefined();
    expect(pinned(bandwidth!)).toEqual({ direction: "total" });
    expect(bandwidth!.defaultAggregation).toBe(MetricsAggregationType.Max);
  });

  test("FlashBlade array performance pins protocol=all, so protocols are never double counted", () => {
    for (const metric of ALL_METRICS) {
      if (metric.metricName.startsWith("purefb_array_performance_")) {
        expect(pinned(metric)["protocol"]).toBe("all");
      }
    }
  });

  test("FlashBlade array space pins type=array; the file-system and object-store rows are subsets", () => {
    for (const metric of ALL_METRICS) {
      if (metric.metricName.startsWith("purefb_array_space_")) {
        expect(pinned(metric)["type"]).toBe("array");
      }
    }
  });

  test("space families pin the space they mean", () => {
    for (const metric of ALL_METRICS) {
      if (metric.metricName.endsWith("_space_bytes")) {
        expect(pinned(metric)["space"]).toBeDefined();
      }
    }
  });

  test("every pinned value is spelled out in the description", () => {
    // The picker shows the description; it must say what the filter is.
    for (const metric of ALL_METRICS) {
      for (const value of Object.values(pinned(metric))) {
        expect({
          id: metric.id,
          mentions: metric.description.includes(value),
        }).toEqual({ id: metric.id, mentions: true });
      }
    }
  });

  test("every metric uses a valid aggregation type, and never Sum", () => {
    /*
     * Every Pure value is a gauge the array computes itself; summing a
     * gauge across the scrapes of a one-minute bucket multiplies it.
     */
    for (const metric of ALL_METRICS) {
      expect(validAggregations).toContain(metric.defaultAggregation);
      expect(metric.defaultAggregation).not.toBe(AggregationType.Sum);
    }
  });

  test("free-space and health metrics default to Min; data reduction and I/O size to Avg", () => {
    for (const metric of ALL_METRICS) {
      const space: string | undefined = pinned(metric)["space"];
      if (
        space === "empty" ||
        space === "available_ratio" ||
        metric.metricName === "purefb_hardware_health"
      ) {
        expect(metric.defaultAggregation).toBe(AggregationType.Min);
      }
      if (
        metric.metricName.endsWith("_data_reduction_ratio") ||
        metric.metricName.endsWith("_average_bytes")
      ) {
        expect(metric.defaultAggregation).toBe(AggregationType.Avg);
      }
      if (metric.metricName.endsWith("_latency_usec")) {
        expect(metric.defaultAggregation).toBe(AggregationType.Max);
      }
    }
  });

  test("every metric uses a valid resource scope", () => {
    for (const metric of ALL_METRICS) {
      expect(validScopes).toContain(metric.defaultResourceScope);
    }
  });

  /*
   * Dell's names say what they measure in words rather than units: its
   * latencies are microseconds, its space bytes, its rates per second.
   */
  const powerStoreUnit: (name: string) => string = (name: string): string => {
    if (name.endsWith("_latency")) {
      return "µs";
    }
    if (name.endsWith("_iops")) {
      return "ops/s";
    }
    if (
      name.endsWith("_bandwidth") ||
      name.endsWith("_bytes_rx_ps") ||
      name.endsWith("_bytes_tx_ps")
    ) {
      return "bytes/s";
    }
    if (name.endsWith("_count_ps") || name.endsWith("_error_ps")) {
      return "errors/s";
    }
    if (
      name.endsWith("_percent") ||
      name.endsWith("_cpu_utilization") ||
      name === "powerstore_wear_metrics_by_drive"
    ) {
      return "%";
    }
    if (
      name.endsWith("_data_reduction") ||
      name.endsWith("_efficiency_ratio")
    ) {
      return "ratio";
    }
    const bytesSuffix: RegExp = /_(size|used|provisioned|total)$/;
    if (bytesSuffix.test(name)) {
      return "bytes";
    }
    // States (1 while healthy) and the cluster's identity.
    return "count";
  };

  test("units follow the metric name's own unit suffix", () => {
    const expectedUnit: (
      metric: StorageArrayMetricDefinition,
    ) => string | undefined = (
      metric: StorageArrayMetricDefinition,
    ): string | undefined => {
      const name: string = metric.metricName;
      if (name.startsWith(PREFIXES[PS]!.series)) {
        return powerStoreUnit(name);
      }
      // PowerMax's series name their units (#11004).
      if (name.startsWith(PREFIXES[PM]!.series)) {
        const suffixes: Array<[string, string]> = [
          ["_usec", "µs"],
          ["_iops", "ops/s"],
          ["_throughput_bytes", "bytes/s"],
          ["_percent", "%"],
          ["_seconds", "s"],
          ["_milliwatts", "mW"],
          ["_ratio", "ratio"],
          ["_health_score", "score"],
          ["_bytes", "bytes"],
        ];
        for (const [suffix, unit] of suffixes) {
          if (name.endsWith(suffix)) {
            return unit;
          }
        }
        // Alerts, objects in a bad state, a 0-or-1 flag: how many.
        return "count";
      }
      if (name.endsWith("_latency_usec")) {
        return "µs";
      }
      if (name.endsWith("_msec")) {
        return "ms";
      }
      if (name.endsWith("_celsius")) {
        return "°C";
      }
      if (name.endsWith("_throughput_iops")) {
        return "ops/s";
      }
      if (name.endsWith("_bandwidth_bytes")) {
        return "bytes/s";
      }
      if (name.endsWith("_performance_errors")) {
        return "errors/s";
      }
      if (name.endsWith("_queue_depth_ops")) {
        return "ops";
      }
      if (name.endsWith("_utilization")) {
        return "%";
      }
      if (name.endsWith("_data_reduction_ratio")) {
        return "ratio";
      }
      if (name.endsWith("_space_bytes")) {
        return pinned(metric)["space"] === "available_ratio"
          ? "ratio"
          : "bytes";
      }
      if (name.endsWith("_bytes")) {
        return "bytes";
      }
      if (name === "purefb_hardware_health") {
        // 1 healthy, 2 unused, 0 unhealthy: a state code, not a quantity.
        return undefined;
      }
      return "count";
    };

    for (const metric of ALL_METRICS) {
      expect({ id: metric.id, unit: metric.unit }).toEqual({
        id: metric.id,
        unit: expectedUnit(metric),
      });
    }
  });
});

describe("StorageArrayMetricCatalog - categories", () => {
  const categories: Array<StorageArrayMetricCategory> =
    getAllStorageArrayMetricCategories();

  test("declares the design's nine categories, in picker order", () => {
    expect(categories).toEqual([
      "Array Health",
      "Capacity",
      "Performance",
      "Volumes",
      "Hosts",
      "Replication",
      "Hardware",
      "File Systems",
      "Buckets",
    ]);
    expect(new Set(categories).size).toBe(categories.length);
  });

  test("every metric category is a declared category", () => {
    for (const metric of ALL_METRICS) {
      expect(categories).toContain(metric.category);
    }
  });

  test("getStorageArrayMetricsByCategory partitions the catalog", () => {
    let total: number = 0;
    for (const category of categories) {
      const metrics: Array<StorageArrayMetricDefinition> =
        getStorageArrayMetricsByCategory(category);
      expect(metrics.length).toBeGreaterThan(0);
      for (const metric of metrics) {
        expect(metric.category).toBe(category);
      }
      total += metrics.length;
    }
    expect(total).toBe(ALL_METRICS.length);
  });

  test("platform-specific categories hold only the metrics of the platforms that have the objects", () => {
    const platformsOf: Partial<
      Record<StorageArrayMetricCategory, Array<StorageSystem>>
    > = {
      Volumes: [FA, PS, PM],
      Hosts: [FA],
      Replication: [FA, PS, PM],
      "File Systems": [FB, PS],
      Buckets: [FB],
    };
    for (const [category, systems] of Object.entries(platformsOf)) {
      for (const metric of getStorageArrayMetricsByCategory(
        category as StorageArrayMetricCategory,
      )) {
        expect({ metric: metric.id, system: onlySystem(metric) }).toEqual({
          metric: metric.id,
          system: systems!.includes(onlySystem(metric))
            ? onlySystem(metric)
            : `<one of ${systems!.join(", ")}>`,
        });
      }
    }
  });

  test("every platform covers alerts, capacity, performance and hardware", () => {
    for (const system of [FA, FB, PS, PM]) {
      const covered: Set<string> = new Set(
        getStorageArrayMetricsForSystem(system).map(
          (m: StorageArrayMetricDefinition) => {
            return m.category;
          },
        ),
      );
      for (const category of [
        "Array Health",
        "Capacity",
        "Performance",
        "Hardware",
      ]) {
        expect(covered.has(category)).toBe(true);
      }
    }
  });
});

describe("StorageArrayMetricCatalog - lookups", () => {
  test("getStorageArrayMetricById round-trips every metric", () => {
    for (const metric of ALL_METRICS) {
      expect(getStorageArrayMetricById(metric.id)).toBe(metric);
    }
  });

  test("getStorageArrayMetricById returns undefined for an unknown id", () => {
    expect(getStorageArrayMetricById("does-not-exist")).toBeUndefined();
    expect(getStorageArrayMetricById("")).toBeUndefined();
    expect(getStorageArrayMetricById("ceph-health-status")).toBeUndefined();
  });

  test("getStorageArrayMetricByMetricName returns the FIRST entry for the name", () => {
    for (const metric of ALL_METRICS) {
      const first: StorageArrayMetricDefinition | undefined = ALL_METRICS.find(
        (m: StorageArrayMetricDefinition) => {
          return m.metricName === metric.metricName;
        },
      );
      expect(getStorageArrayMetricByMetricName(metric.metricName)).toBe(first);
    }
    expect(
      getStorageArrayMetricByMetricName("purefa_array_performance_latency_usec")
        ?.id,
    ).toBe("purefa-array-read-latency");
  });

  test("getStorageArrayMetricByMetricName returns undefined for an unknown name", () => {
    expect(getStorageArrayMetricByMetricName("purefa_nope")).toBeUndefined();
    expect(getStorageArrayMetricByMetricName("")).toBeUndefined();
  });

  test("known metrics are present", () => {
    for (const metricName of [
      "purefa_alerts_open",
      "purefa_array_space_utilization",
      "purefa_hw_component_status",
      "purefa_drive_capacity_bytes",
      "purefa_host_connectivity_info",
      "purefa_pod_replica_links_lag_max_msec",
      "purefb_alerts_open",
      "purefb_hardware_health",
      "purefb_array_space_utilization",
      "purefb_file_systems_space_bytes",
    ]) {
      expect(getStorageArrayMetricByMetricName(metricName)).toBeDefined();
    }
  });
});

describe("StorageArrayMetricCatalog - getStorageArrayMetric (filter-aware lookup)", () => {
  test("every entry is found by its own metric name and pinned attributes", () => {
    for (const metric of ALL_METRICS) {
      expect(getStorageArrayMetric(metric.metricName, pinned(metric))).toBe(
        metric,
      );
    }
  });

  test("the dimension filter picks write latency over the first (read) entry", () => {
    expect(
      getStorageArrayMetric("purefa_array_performance_latency_usec", {
        dimension: "usec_per_write_op",
      })?.id,
    ).toBe("purefa-array-write-latency");
    expect(
      getStorageArrayMetric("purefa_volume_space_bytes", {
        space: "total_physical",
      })?.id,
    ).toBe("purefa-volume-physical");
  });

  test("labels the entry does not pin never stand in the way", () => {
    expect(
      getStorageArrayMetric("purefa_volume_performance_latency_usec", {
        dimension: "usec_per_write_op",
        name: "vmfs-prod-01",
        naa_id: "naa.624a9370",
      })?.id,
    ).toBe("purefa-volume-write-latency");
  });

  test("every label an entry pins must match: FlashBlade needs dimension AND protocol", () => {
    expect(
      getStorageArrayMetric("purefb_array_performance_latency_usec", {
        dimension: "usec_per_write_op",
        protocol: "all",
      })?.id,
    ).toBe("purefb-array-write-latency");
    // A per-protocol query is not the "all protocols" entry: first-entry fallback.
    expect(
      getStorageArrayMetric("purefb_array_performance_latency_usec", {
        dimension: "usec_per_write_op",
        protocol: "NFS",
      })?.id,
    ).toBe("purefb-array-read-latency");
  });

  test("with no filters, or filters that match nothing, it falls back to the first entry for the name", () => {
    expect(getStorageArrayMetric("purefa_array_space_bytes")?.id).toBe(
      "purefa-array-space-capacity",
    );
    expect(getStorageArrayMetric("purefa_array_space_bytes", {})?.id).toBe(
      "purefa-array-space-capacity",
    );
    expect(
      getStorageArrayMetric("purefa_array_space_bytes", {
        space: "thin_provisioning",
      })?.id,
    ).toBe("purefa-array-space-capacity");
  });

  test("an unpinned entry matches whatever the query filters", () => {
    expect(
      getStorageArrayMetric("purefa_alerts_open", { severity: "critical" })?.id,
    ).toBe("purefa-alerts-open");
    expect(getStorageArrayMetric("purefa_alerts_open")?.id).toBe(
      "purefa-alerts-open",
    );
  });

  test("non-string filter values are compared as strings and never throw", () => {
    expect(
      getStorageArrayMetric("purefb_array_space_bytes", {
        type: "array",
        space: { value: "empty" } as unknown as string,
      })?.id,
    ).toBe("purefb-array-space-empty");
    expect(
      getStorageArrayMetric("purefa_array_space_bytes", {
        space: 42,
      })?.id,
    ).toBe("purefa-array-space-capacity");
  });

  test("an unknown metric name has no entry", () => {
    expect(getStorageArrayMetric("purefa_nope", {})).toBeUndefined();
    expect(getStorageArrayMetric("")).toBeUndefined();
  });
});

describe("StorageArrayMetricCatalog - per-platform picker", () => {
  test("each platform sees only its own metrics: a FlashArray FlashArray's, a FlashBlade FlashBlade's, a PowerStore PowerStore's, a PowerMax PowerMax's", () => {
    let total: number = 0;
    for (const system of [FA, FB, PS, PM]) {
      const metrics: Array<StorageArrayMetricDefinition> =
        getStorageArrayMetricsForSystem(system);
      expect(metrics.length).toBeGreaterThan(0);
      for (const metric of metrics) {
        expect(metric.storageSystems).toContain(system);
        expect(metric.metricName.startsWith(PREFIXES[system]!.series)).toBe(
          true,
        );
      }
      total += metrics.length;
    }
    expect(total).toBe(ALL_METRICS.length);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["the empty string", ""],
    ["an unknown platform", "netapp.ontap"],
    ["an alias rather than the canonical value", "purefa"],
  ])(
    "%s gets the whole catalog, so the picker is never empty",
    (_: string, system: string | null | undefined) => {
      expect(getStorageArrayMetricsForSystem(system)).toEqual(ALL_METRICS);
    },
  );
});

describe("StorageArrayMetricCatalog - object labels (resource filters and per-object group-by)", () => {
  test.each([
    [StorageArrayResourceScope.Array, FA, null],
    [StorageArrayResourceScope.Array, FB, null],
    [StorageArrayResourceScope.Volume, FA, "name"],
    [StorageArrayResourceScope.Host, FA, "host"],
    [StorageArrayResourceScope.Pod, FA, "name"],
    [StorageArrayResourceScope.Hardware, FA, "component_name"],
    [StorageArrayResourceScope.Hardware, FB, "name"],
    [StorageArrayResourceScope.FileSystem, FB, "name"],
    [StorageArrayResourceScope.Bucket, FB, "name"],
    [StorageArrayResourceScope.Array, PS, null],
    [StorageArrayResourceScope.Volume, PS, "name"],
    [StorageArrayResourceScope.Hardware, PS, "name"],
    [StorageArrayResourceScope.FileSystem, PS, "name"],
  ])(
    "%s on %s is named by %p",
    (
      scope: StorageArrayResourceScope,
      system: StorageSystem,
      expected: string | null,
    ) => {
      expect(getStorageArrayObjectLabel(scope, system)).toBe(expected);
    },
  );

  test("hardware on a platform not yet known falls back to FlashArray's component_name", () => {
    expect(
      getStorageArrayObjectLabel(StorageArrayResourceScope.Hardware, null),
    ).toBe("component_name");
    expect(
      getStorageArrayObjectLabel(StorageArrayResourceScope.Hardware, undefined),
    ).toBe("component_name");
  });

  test("REGRESSION: replica link series name their pod `local_pod`", () => {
    /*
     * A podName filter on the replica-lag metric used to equality-filter
     * `name`, which purefa_pod_replica_links_* never carry: the monitor saw
     * no data at all.
     */
    for (const metricName of [
      "purefa_pod_replica_links_lag_max_msec",
      "purefa_pod_replica_links_lag_average_msec",
    ]) {
      expect(
        getStorageArrayObjectLabel(
          StorageArrayResourceScope.Pod,
          FA,
          metricName,
        ),
      ).toBe("local_pod");
    }
    // Other pod series keep `name`.
    expect(
      getStorageArrayObjectLabel(
        StorageArrayResourceScope.Pod,
        FA,
        "purefa_pod_performance_latency_usec",
      ),
    ).toBe("name");
  });

  test("REGRESSION: network interface series name the interface `name`, not `component_name`", () => {
    expect(
      getStorageArrayObjectLabel(
        StorageArrayResourceScope.Hardware,
        FA,
        "purefa_network_interface_performance_errors",
      ),
    ).toBe("name");
    expect(
      getStorageArrayObjectLabel(
        StorageArrayResourceScope.Hardware,
        FA,
        "purefa_hw_component_status",
      ),
    ).toBe("component_name");
  });

  test("a metric's own object label applies only to its own scope", () => {
    /*
     * The worker resolves EVERY configured filter against every query. A
     * volume filter on a replica-link query must not be rewritten onto the
     * pod's `local_pod` label.
     */
    expect(
      getStorageArrayObjectLabel(
        StorageArrayResourceScope.Volume,
        FA,
        "purefa_pod_replica_links_lag_max_msec",
      ),
    ).toBe("name");
    expect(
      getStorageArrayObjectLabel(
        StorageArrayResourceScope.Host,
        FA,
        "purefa_network_interface_performance_errors",
      ),
    ).toBe("host");
  });

  test("an unknown or missing metric name falls back to the scope's label", () => {
    for (const metricName of [undefined, "", "purefa_nope"]) {
      expect(
        getStorageArrayObjectLabel(
          StorageArrayResourceScope.Host,
          FA,
          metricName,
        ),
      ).toBe("host");
    }
  });

  test("every per-object metric's object label is a label its series carries", () => {
    /*
     * The invariant behind every resource filter and per-object template:
     * filtering or grouping by a label the series does not carry matches
     * nothing (or collapses every object into one series).
     */
    for (const metric of ALL_METRICS) {
      const label: string | null = getStorageArrayObjectLabel(
        metric.defaultResourceScope,
        onlySystem(metric),
        metric.metricName,
      );
      if (
        metric.defaultResourceScope === StorageArrayResourceScope.Array &&
        !metric.objectLabel
      ) {
        expect(label).toBeNull();
        continue;
      }
      /*
       * An object of its own scope, or a part of the array no scope
       * names, by an object label of its own (a PowerStore appliance or
       * NAS server, a PowerMax storage group, pool or SRDF group, #11004):
       * its charts and monitors split by that label.
       */
      expect({ id: metric.id, label }).toEqual({
        id: metric.id,
        label:
          label && Object.keys(SERIES[metric.metricName]!).includes(label)
            ? label
            : "<a label the series carries>",
      });
    }
  });

  test("objectLabel is only set where it differs from the scope's own label", () => {
    for (const metric of ALL_METRICS) {
      if (!metric.objectLabel) {
        continue;
      }
      expect(metric.objectLabel).not.toBe(
        getStorageArrayObjectLabel(
          metric.defaultResourceScope,
          onlySystem(metric),
        ),
      );
    }
  });
});
