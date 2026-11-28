import { StorageArrayUnitRule } from "../../../StorageArrayPlatform";

/*
 * THE UNITS OF NETAPP HARVEST'S SERIES (#11001).
 *
 * Harvest's Prometheus exporter writes HELP and TYPE lines but no UNIT
 * lines, so every netapp_* series reaches OneUptime with no unit, and a
 * latency would chart as a bare 850. Harvest's own documentation
 * (netapp.github.io/harvest/26.11/ontap-metrics) gives each counter's unit,
 * and they follow its names: KeyPerf's and RestPerf's latencies are
 * microseconds per operation (`microsec`), their *_ops are operations per
 * second (`per_sec`), their *_data bytes per second (`b_per_sec`), and the
 * Rest collector's sizes and spaces are bytes. These rules say so, first
 * match wins: the ingest records the unit for a series that declared none
 * (StorageArrayMetricUnitUtil), so the Metrics explorer, the charts and the
 * monitors read the same, and the catalog's units agree with them
 * (OntapUnits.test.ts holds every catalog entry to its rule).
 *
 * Units are spelled as the storage array catalogs spell them.
 */
export const ONTAP_UNIT_RULES: ReadonlyArray<StorageArrayUnitRule> = [
  // Harvest's own bookkeeping, and the label-only series (always 1).
  { pattern: "^netapp_metadata_", unit: "" },
  { pattern: "_labels$", unit: "" },
  // State as a number: 1 healthy (up, online, normal), 0 not.
  { pattern: "_new_status$", unit: "" },
  { pattern: "_status$", unit: "" },
  // One series per open problem, or per EMS event, value 1.
  { pattern: "^netapp_health_.*_alerts$", unit: "count" },
  { pattern: "^netapp_ems_events$", unit: "count" },
  // A disk's average I/O latency is the one the API gives in milliseconds.
  { pattern: "^netapp_disk_stats_average_latency$", unit: "ms" },
  // Latency per operation, from KeyPerf and RestPerf.
  { pattern: "_latency$", unit: "µs" },
  // Operations per second.
  { pattern: "_ops$", unit: "ops/s" },
  // Throughput, and a port's traffic.
  { pattern: "_data$", unit: "bytes/s" },
  { pattern: "^netapp_nic_(rx|tx)_bytes$", unit: "bytes/s" },
  // Shares, utilization and a node's CPU.
  { pattern: "_percent$", unit: "%" },
  { pattern: "_busy$", unit: "%" },
  /*
   * Durations ONTAP gives in seconds: a relationship's lag, its last
   * transfer, how long a node has been up, a relationship's schedule.
   */
  {
    pattern:
      "^netapp_snapmirror_(lag_time|last_transfer_duration|schedule_seconds)$",
    unit: "s",
  },
  { pattern: "^netapp_node_uptime$", unit: "s" },
  { pattern: "^netapp_disk_power_on_hours$", unit: "h" },
  // Moments, as Unix seconds.
  { pattern: "_timestamp$", unit: "s" },
  // Counts of things, and errors counted per poll.
  { pattern: "_count$", unit: "count" },
  { pattern: "^netapp_node_failed_(fan|power)$", unit: "count" },
  { pattern: "_errors$", unit: "count" },
  {
    pattern:
      "^netapp_fcp_(link_failure|loss_of_signal|loss_of_sync|invalid_crc)$",
    unit: "count",
  },
  { pattern: "^netapp_cluster_subsystem_outstanding_alerts$", unit: "count" },
  // A shelf's readings.
  { pattern: "^netapp_shelf_fan_rpm$", unit: "rpm" },
  { pattern: "^netapp_shelf_temperature_reading$", unit: "°C" },
  { pattern: "^netapp_(shelf|environment_sensor)_power$", unit: "W" },
  // Space, sizes and transfers, in bytes.
  {
    pattern: "^netapp_snapmirror_(last_transfer_size|total_transfer_bytes)$",
    unit: "bytes",
  },
  { pattern: "_(space|size)(_[a-z_]+)?$", unit: "bytes" },
  {
    pattern: "^netapp_aggr_(logical|physical)_used_wo_snapshots(_flexclones)?$",
    unit: "bytes",
  },
  {
    pattern:
      "^netapp_aggr_(efficiency_savings|total_logical_used|total_physical_used)",
    unit: "bytes",
  },
];
