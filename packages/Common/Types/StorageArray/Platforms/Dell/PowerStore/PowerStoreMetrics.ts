import { StorageArrayResourceScope } from "../../../../Monitor/MonitorStepStorageArrayMonitor";
import MetricsAggregationType from "../../../../Metrics/MetricsAggregationType";
import { translationKey } from "../../../../Translator";
import StorageSystem from "../../../StorageSystem";
import { StorageArrayMetricDefinition } from "../../../StorageArrayPlatform";

/*
 * The Dell PowerStore metric catalog: what a PowerStore monitor's metric
 * picker offers, the unit each is read in, and the charts' labels.
 *
 * Every name and label is Dell's powerstore-metrics-exporter v1.0.3's
 * (collector/generalCollector), except the two used percents, which the
 * agent's collector works out from the exporter's used and total
 * (otel-collector-config.powerstore.yaml). The exporter reads PowerStore's
 * five-minute performance samples, so every value is a per-second rate or
 * an average PowerStore computed itself - latencies in microseconds per
 * operation - and no rate math is needed. Capacity comes from PowerStore's
 * daily space rollup (the exporter asks for One_Day), so it moves once a
 * day; PowerStore's own capacity alerts arrive as they happen, by syslog.
 *
 * Every series carries the exporter's `IP` label (the cluster's address)
 * and the label that names its object: `appliance_id` on an appliance's,
 * `name` on a volume's, volume group's, hardware part's, NAS server's or
 * file system's state and space series, and, on the performance series of
 * the same objects, a label of its own that holds the object's name
 * (`volume_id`, `volume_group_id`, `nas_id`, `fc_port_id`, `eth_port_id`).
 * Group by that label to fire one incident per object.
 *
 * The 0/1 states are the exporter's: 1 while the object is Healthy, Ready,
 * Started or up, 0 in any other state (which one, it does not say). A
 * node's is fixed up by the agent to mean the same (its exporter writes 0
 * for every node and puts the state in a `state` label).
 *
 * Ids are stored on dashboards and monitors: never change one.
 */
const PS: Array<StorageSystem> = [StorageSystem.DellPowerStore];

const POWERSTORE_METRICS: Array<StorageArrayMetricDefinition> = [
  // ---------------- PowerStore: array health ----------------
  {
    id: "powerstore-cluster-state",
    friendlyName: translationKey("Cluster State"),
    description: translationKey(
      "1 while the PowerStore cluster is Configured (formed and serving), 0 in any other state: Configuring, Expanding, Removing, Clustering_Failed or Unconfigured.",
    ),
    metricName: "powerstore_cluster",
    category: "Array Health",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Array,
    unit: "count",
  },

  // ---------------- PowerStore: capacity, per appliance ----------------
  {
    id: "powerstore-appliance-used-percent",
    friendlyName: translationKey("Capacity Used (%)"),
    description: translationKey(
      "Share of each appliance's physical capacity in use, in percent: its physical used over its physical total, from PowerStore's daily space rollup. PowerStore raises its own capacity alerts from 70%. Group by appliance_id.",
    ),
    metricName: "powerstore_cap_physical_used_percent",
    category: "Capacity",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "appliance_id",
    unit: "%",
  },
  {
    id: "powerstore-appliance-physical-total",
    friendlyName: translationKey("Physical Capacity"),
    description: translationKey(
      "Usable physical capacity of each appliance in bytes.",
    ),
    metricName: "powerstore_cap_last_physical_total",
    category: "Capacity",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "appliance_id",
    unit: "bytes",
  },
  {
    id: "powerstore-appliance-physical-used",
    friendlyName: translationKey("Physical Capacity Used"),
    description: translationKey(
      "Physical capacity each appliance uses in bytes, after deduplication and compression. Trend it to forecast when an appliance fills up.",
    ),
    metricName: "powerstore_cap_last_physical_used",
    category: "Capacity",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "appliance_id",
    unit: "bytes",
  },
  {
    id: "powerstore-appliance-provisioned",
    friendlyName: translationKey("Provisioned Capacity"),
    description: translationKey(
      "Logical capacity provisioned on each appliance in bytes: the size of every volume, file system and vVol it holds, which can be far above its physical capacity.",
    ),
    metricName: "powerstore_cap_last_logical_provisioned",
    category: "Capacity",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "appliance_id",
    unit: "bytes",
  },
  {
    id: "powerstore-appliance-logical-used",
    friendlyName: translationKey("Logical Capacity Used"),
    description: translationKey(
      "Data hosts have written to each appliance in bytes, before deduplication and compression.",
    ),
    metricName: "powerstore_cap_last_logical_used",
    category: "Capacity",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "appliance_id",
    unit: "bytes",
  },
  {
    id: "powerstore-appliance-data-reduction",
    friendlyName: translationKey("Data Reduction Ratio"),
    description: translationKey(
      "Deduplication and compression on each appliance, for example 3.4 for 3.4:1. A sustained drop means newly written data reduces poorly: encrypted or already-compressed data.",
    ),
    metricName: "powerstore_cap_last_data_reduction",
    category: "Capacity",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "appliance_id",
    unit: "ratio",
  },
  {
    id: "powerstore-appliance-efficiency",
    friendlyName: translationKey("Efficiency Ratio"),
    description: translationKey(
      "Overall efficiency of each appliance: data reduction together with the savings of snapshots and thin provisioning.",
    ),
    metricName: "powerstore_cap_last_efficiency_ratio",
    category: "Capacity",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "appliance_id",
    unit: "ratio",
  },

  // ---------------- PowerStore: performance, per appliance ----------------
  {
    id: "powerstore-appliance-read-latency",
    friendlyName: translationKey("Read Latency"),
    description: translationKey(
      "Average latency of a read on each appliance, in microseconds, over PowerStore's latest five-minute sample. PowerStore reads typically complete well under 1 ms.",
    ),
    metricName: "powerstore_perf_avg_read_latency",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "appliance_id",
    unit: "µs",
  },
  {
    id: "powerstore-appliance-write-latency",
    friendlyName: translationKey("Write Latency"),
    description: translationKey(
      "Average latency of a write on each appliance, in microseconds.",
    ),
    metricName: "powerstore_perf_avg_write_latency",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "appliance_id",
    unit: "µs",
  },
  {
    id: "powerstore-appliance-read-iops",
    friendlyName: translationKey("Read IOPS"),
    description: translationKey(
      "Read operations per second on each appliance.",
    ),
    metricName: "powerstore_perf_avg_read_iops",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "appliance_id",
    unit: "ops/s",
  },
  {
    id: "powerstore-appliance-write-iops",
    friendlyName: translationKey("Write IOPS"),
    description: translationKey(
      "Write operations per second on each appliance.",
    ),
    metricName: "powerstore_perf_avg_write_iops",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "appliance_id",
    unit: "ops/s",
  },
  {
    id: "powerstore-appliance-read-bandwidth",
    friendlyName: translationKey("Read Bandwidth"),
    description: translationKey("Bytes read per second on each appliance."),
    metricName: "powerstore_perf_avg_read_bandwidth",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "appliance_id",
    unit: "bytes/s",
  },
  {
    id: "powerstore-appliance-write-bandwidth",
    friendlyName: translationKey("Write Bandwidth"),
    description: translationKey("Bytes written per second on each appliance."),
    metricName: "powerstore_perf_avg_write_bandwidth",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "appliance_id",
    unit: "bytes/s",
  },
  {
    id: "powerstore-appliance-cpu-utilization",
    friendlyName: translationKey("I/O CPU Utilization"),
    description: translationKey(
      "Share of the CPU cores each appliance dedicates to storage I/O that is busy, in percent. Sustained high values mean the appliance is near the load it can serve.",
    ),
    metricName: "powerstore_perf_avg_io_workload_cpu_utilization",
    category: "Performance",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "appliance_id",
    unit: "%",
  },

  // ---------------- PowerStore: volumes ----------------
  {
    id: "powerstore-volume-ready",
    friendlyName: translationKey("Volume Ready"),
    description: translationKey(
      "1 while a volume is Ready, 0 while it is Initializing, Offline or being destroyed. Group by name to find the volume hosts cannot reach.",
    ),
    metricName: "powerstore_volume_state",
    category: "Volumes",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    unit: "count",
  },
  {
    id: "powerstore-volume-size",
    friendlyName: translationKey("Volume Size"),
    description: translationKey(
      "Size of each volume as hosts see it, in bytes.",
    ),
    metricName: "powerstore_volume_size",
    category: "Volumes",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    unit: "bytes",
  },
  {
    id: "powerstore-volume-logical-used",
    friendlyName: translationKey("Volume Logical Used"),
    description: translationKey(
      "Data hosts have written to each volume in bytes, before deduplication and compression.",
    ),
    metricName: "powerstore_volume_logical_used",
    category: "Volumes",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    unit: "bytes",
  },
  {
    id: "powerstore-volume-read-latency",
    friendlyName: translationKey("Volume Read Latency"),
    description: translationKey(
      "Average read latency of each volume in microseconds. Group by volume_id, which holds the volume's name, to find the slow volume.",
    ),
    metricName: "powerstore_metricVolume_avg_read_latency",
    category: "Volumes",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    objectLabel: "volume_id",
    unit: "µs",
  },
  {
    id: "powerstore-volume-write-latency",
    friendlyName: translationKey("Volume Write Latency"),
    description: translationKey(
      "Average write latency of each volume in microseconds.",
    ),
    metricName: "powerstore_metricVolume_avg_write_latency",
    category: "Volumes",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    objectLabel: "volume_id",
    unit: "µs",
  },
  {
    id: "powerstore-volume-read-iops",
    friendlyName: translationKey("Volume Read IOPS"),
    description: translationKey("Read operations per second of each volume."),
    metricName: "powerstore_metricVolume_avg_read_iops",
    category: "Volumes",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    objectLabel: "volume_id",
    unit: "ops/s",
  },
  {
    id: "powerstore-volume-write-iops",
    friendlyName: translationKey("Volume Write IOPS"),
    description: translationKey("Write operations per second of each volume."),
    metricName: "powerstore_metricVolume_avg_write_iops",
    category: "Volumes",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    objectLabel: "volume_id",
    unit: "ops/s",
  },
  {
    id: "powerstore-volume-read-bandwidth",
    friendlyName: translationKey("Volume Read Bandwidth"),
    description: translationKey("Bytes read per second from each volume."),
    metricName: "powerstore_metricVolume_avg_read_bandwidth",
    category: "Volumes",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    objectLabel: "volume_id",
    unit: "bytes/s",
  },
  {
    id: "powerstore-volume-write-bandwidth",
    friendlyName: translationKey("Volume Write Bandwidth"),
    description: translationKey("Bytes written per second to each volume."),
    metricName: "powerstore_metricVolume_avg_write_bandwidth",
    category: "Volumes",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Volume,
    objectLabel: "volume_id",
    unit: "bytes/s",
  },

  // ---------------- PowerStore: volume groups ----------------
  {
    id: "powerstore-volume-group-provisioned",
    friendlyName: translationKey("Volume Group Provisioned"),
    description: translationKey(
      "Capacity provisioned to each volume group's volumes, in bytes. Group by name.",
    ),
    metricName: "powerstore_volumegroup_logical_provisioned",
    category: "Volumes",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "name",
    unit: "bytes",
  },
  {
    id: "powerstore-volume-group-logical-used",
    friendlyName: translationKey("Volume Group Logical Used"),
    description: translationKey(
      "Data hosts have written to each volume group's volumes in bytes, before deduplication and compression.",
    ),
    metricName: "powerstore_volumegroup_logical_used",
    category: "Volumes",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "name",
    unit: "bytes",
  },
  {
    id: "powerstore-volume-group-read-latency",
    friendlyName: translationKey("Volume Group Read Latency"),
    description: translationKey(
      "Average read latency across each volume group's volumes, in microseconds. Group by volume_group_id, which holds the group's name.",
    ),
    metricName: "powerstore_metricVg_avg_read_latency",
    category: "Volumes",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "volume_group_id",
    unit: "µs",
  },
  {
    id: "powerstore-volume-group-write-latency",
    friendlyName: translationKey("Volume Group Write Latency"),
    description: translationKey(
      "Average write latency across each volume group's volumes, in microseconds.",
    ),
    metricName: "powerstore_metricVg_avg_write_latency",
    category: "Volumes",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "volume_group_id",
    unit: "µs",
  },
  {
    id: "powerstore-volume-group-iops",
    friendlyName: translationKey("Volume Group IOPS"),
    description: translationKey(
      "Read and write operations per second across each volume group's volumes.",
    ),
    metricName: "powerstore_metricVg_avg_total_iops",
    category: "Volumes",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "volume_group_id",
    unit: "ops/s",
  },

  // ---------------- PowerStore: hardware ----------------
  {
    id: "powerstore-node-healthy",
    friendlyName: translationKey("Node Healthy"),
    description: translationKey(
      "1 while a node of an appliance is Healthy, 0 in any other state, which its state label names (Failed, Disconnected, Initializing...). Group by name and appliance_id.",
    ),
    metricName: "powerstore_hardware_node_state",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "count",
  },
  {
    id: "powerstore-drive-healthy",
    friendlyName: translationKey("Drive Healthy"),
    description: translationKey(
      "1 while a drive is Healthy, 0 when it has failed, been removed or is not ready. Group by name to fire one incident per drive.",
    ),
    metricName: "powerstore_hardware_Drive_state",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "count",
  },
  {
    id: "powerstore-drive-endurance",
    friendlyName: translationKey("Drive Endurance Remaining"),
    description: translationKey(
      "Share of each drive's write endurance left, in percent. A drive near 0 is close to the end of its life: plan its replacement.",
    ),
    metricName: "powerstore_wear_metrics_by_drive",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "%",
  },
  {
    id: "powerstore-fan-healthy",
    friendlyName: translationKey("Fan Healthy"),
    description: translationKey(
      "1 while a node's fan module is Healthy, 0 when it has failed or been removed.",
    ),
    metricName: "powerstore_hardware_Fan_state",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "count",
  },
  {
    id: "powerstore-power-supply-healthy",
    friendlyName: translationKey("Power Supply Healthy"),
    description: translationKey(
      "1 while a node's power supply is Healthy, 0 when it has failed, lost input power or been disconnected.",
    ),
    metricName: "powerstore_hardware_Power_Supply_state",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "count",
  },
  {
    id: "powerstore-battery-healthy",
    friendlyName: translationKey("Battery Healthy"),
    description: translationKey(
      "1 while a node's battery backup module is Healthy, 0 when it has faulted or been disconnected.",
    ),
    metricName: "powerstore_hardware_Battery_state",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    unit: "count",
  },

  // ---------------- PowerStore: front-end ports ----------------
  {
    id: "powerstore-fc-port-link-up",
    friendlyName: translationKey("Fibre Channel Port Link Up"),
    description: translationKey(
      "1 while a Fibre Channel port's link is up, 0 while it is down, which a port nothing is cabled to always is. Group by fc_port_id, which holds the port's name.",
    ),
    metricName: "powerstore_fc_port_is_link_up",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    objectLabel: "fc_port_id",
    unit: "count",
  },
  {
    id: "powerstore-eth-port-link-up",
    friendlyName: translationKey("Ethernet Port Link Up"),
    description: translationKey(
      "1 while an Ethernet port's link is up, 0 while it is down. Group by eth_port_id, which holds the port's name.",
    ),
    metricName: "powerstore_eth_port_is_link_up",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    objectLabel: "eth_port_id",
    unit: "count",
  },
  {
    id: "powerstore-fc-port-read-latency",
    friendlyName: translationKey("Fibre Channel Port Read Latency"),
    description: translationKey(
      "Average latency of a read through each Fibre Channel port, in microseconds.",
    ),
    metricName: "powerstore_metricFcPort_avg_read_latency",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    objectLabel: "fc_port_id",
    unit: "µs",
  },
  {
    id: "powerstore-fc-port-write-latency",
    friendlyName: translationKey("Fibre Channel Port Write Latency"),
    description: translationKey(
      "Average latency of a write through each Fibre Channel port, in microseconds.",
    ),
    metricName: "powerstore_metricFcPort_avg_write_latency",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    objectLabel: "fc_port_id",
    unit: "µs",
  },
  {
    id: "powerstore-fc-port-iops",
    friendlyName: translationKey("Fibre Channel Port IOPS"),
    description: translationKey(
      "Read and write operations per second through each Fibre Channel port.",
    ),
    metricName: "powerstore_metricFcPort_avg_total_iops",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    objectLabel: "fc_port_id",
    unit: "ops/s",
  },
  {
    id: "powerstore-fc-port-bandwidth",
    friendlyName: translationKey("Fibre Channel Port Bandwidth"),
    description: translationKey(
      "Bytes read and written per second through each Fibre Channel port.",
    ),
    metricName: "powerstore_metricFcPort_avg_total_bandwidth",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    objectLabel: "fc_port_id",
    unit: "bytes/s",
  },
  {
    id: "powerstore-fc-port-crc-errors",
    friendlyName: translationKey("Fibre Channel Port CRC Errors"),
    description: translationKey(
      "Frames with an invalid CRC received per second on each Fibre Channel port. Sustained errors usually mean a bad cable, optic or switch port.",
    ),
    metricName: "powerstore_metricFcPort_avg_invalid_crc_count_ps",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    objectLabel: "fc_port_id",
    unit: "errors/s",
  },
  {
    id: "powerstore-fc-port-link-failures",
    friendlyName: translationKey("Fibre Channel Port Link Failures"),
    description: translationKey(
      "Link failures per second on each Fibre Channel port. Any is worth a look at the port's cable, optic and switch.",
    ),
    metricName: "powerstore_metricFcPort_avg_link_failure_count_ps",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    objectLabel: "fc_port_id",
    unit: "errors/s",
  },
  {
    id: "powerstore-eth-port-received",
    friendlyName: translationKey("Ethernet Port Received"),
    description: translationKey(
      "Bytes received per second on each Ethernet port.",
    ),
    metricName: "powerstore_metricEthPort_avg_bytes_rx_ps",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    objectLabel: "eth_port_id",
    unit: "bytes/s",
  },
  {
    id: "powerstore-eth-port-transmitted",
    friendlyName: translationKey("Ethernet Port Transmitted"),
    description: translationKey(
      "Bytes transmitted per second on each Ethernet port.",
    ),
    metricName: "powerstore_metricEthPort_avg_bytes_tx_ps",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    objectLabel: "eth_port_id",
    unit: "bytes/s",
  },
  {
    id: "powerstore-eth-port-crc-errors",
    friendlyName: translationKey("Ethernet Port CRC Errors"),
    description: translationKey(
      "Packets received with a CRC error per second on each Ethernet port. Sustained errors usually mean a bad cable, optic or switch port.",
    ),
    metricName: "powerstore_metricEthPort_avg_pkt_rx_crc_error_ps",
    category: "Hardware",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Hardware,
    objectLabel: "eth_port_id",
    unit: "errors/s",
  },

  // ---------------- PowerStore: replication (Metro) ----------------
  {
    id: "powerstore-metro-witness-state",
    friendlyName: translationKey("Metro Witness State"),
    description: translationKey(
      "State of each Metro witness: 0 OK, 1 partially connected, 2 disconnected, 3 being deleted, 4 initializing. Above 0, a Metro session may not fail over on its own.",
    ),
    metricName: "powerstore_metro_witness_status",
    category: "Replication",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "name",
    unit: "count",
  },

  // ---------------- PowerStore: NAS servers ----------------
  {
    id: "powerstore-nas-server-started",
    friendlyName: translationKey("NAS Server Started"),
    description: translationKey(
      "1 while a NAS server is Started, 0 while it is Stopped, Starting, Stopping, failed over or Degraded (running without its backup node). Group by name.",
    ),
    metricName: "powerstore_nas_server_operational_status",
    category: "File Systems",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "name",
    unit: "count",
  },
  {
    id: "powerstore-nas-server-read-latency",
    friendlyName: translationKey("NAS Server Read Latency"),
    description: translationKey(
      "Average latency of a read served by each NAS server, in microseconds. Group by nas_id, which holds the server's name.",
    ),
    metricName: "powerstore_metricNas_avg_read_latency",
    category: "File Systems",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "nas_id",
    unit: "µs",
  },
  {
    id: "powerstore-nas-server-write-latency",
    friendlyName: translationKey("NAS Server Write Latency"),
    description: translationKey(
      "Average latency of a write served by each NAS server, in microseconds.",
    ),
    metricName: "powerstore_metricNas_avg_write_latency",
    category: "File Systems",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "nas_id",
    unit: "µs",
  },
  {
    id: "powerstore-nas-server-iops",
    friendlyName: translationKey("NAS Server IOPS"),
    description: translationKey(
      "Read and write operations per second served by each NAS server.",
    ),
    metricName: "powerstore_metricNas_avg_total_iops",
    category: "File Systems",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.Array,
    objectLabel: "nas_id",
    unit: "ops/s",
  },

  // ---------------- PowerStore: file systems ----------------
  {
    id: "powerstore-file-system-used-percent",
    friendlyName: translationKey("File System Used (%)"),
    description: translationKey(
      "Share of each file system's size in use, in percent: its logical used over its provisioned size. Group by name.",
    ),
    metricName: "powerstore_filesystem_logical_used_percent",
    category: "File Systems",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.FileSystem,
    unit: "%",
  },
  {
    id: "powerstore-file-system-provisioned",
    friendlyName: translationKey("File System Size"),
    description: translationKey(
      "Size of each file system as clients see it, in bytes.",
    ),
    metricName: "powerstore_filesystem_logical_provisioned",
    category: "File Systems",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.FileSystem,
    unit: "bytes",
  },
  {
    id: "powerstore-file-system-used",
    friendlyName: translationKey("File System Used"),
    description: translationKey(
      "Data clients have written to each file system, in bytes.",
    ),
    metricName: "powerstore_filesystem_logical_used",
    category: "File Systems",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.FileSystem,
    unit: "bytes",
  },
  {
    id: "powerstore-file-system-read-latency",
    friendlyName: translationKey("File System Read Latency"),
    description: translationKey(
      "Average latency of a read from each file system, in microseconds. Group by name.",
    ),
    metricName: "powerstore_metricFilesystem_avg_read_latency",
    category: "File Systems",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.FileSystem,
    unit: "µs",
  },
  {
    id: "powerstore-file-system-write-latency",
    friendlyName: translationKey("File System Write Latency"),
    description: translationKey(
      "Average latency of a write to each file system, in microseconds.",
    ),
    metricName: "powerstore_metricFilesystem_avg_write_latency",
    category: "File Systems",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.FileSystem,
    unit: "µs",
  },
  {
    id: "powerstore-file-system-read-iops",
    friendlyName: translationKey("File System Read IOPS"),
    description: translationKey(
      "Read operations per second of each file system.",
    ),
    metricName: "powerstore_metricFilesystem_avg_read_iops",
    category: "File Systems",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.FileSystem,
    unit: "ops/s",
  },
  {
    id: "powerstore-file-system-write-iops",
    friendlyName: translationKey("File System Write IOPS"),
    description: translationKey(
      "Write operations per second of each file system.",
    ),
    metricName: "powerstore_metricFilesystem_avg_write_iops",
    category: "File Systems",
    storageSystems: PS,
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: StorageArrayResourceScope.FileSystem,
    unit: "ops/s",
  },
];

export default POWERSTORE_METRICS;
