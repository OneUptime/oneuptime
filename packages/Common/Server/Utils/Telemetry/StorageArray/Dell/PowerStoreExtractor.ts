import { JSONObject } from "../../../../../Types/JSON";
import lookupTable from "../../../../../Utils/LookupTable";
import StorageArrayResourceKind from "../../../../../Types/StorageArray/StorageArrayResourceKind";
import DellPowerStorePlatform, {
  POWERSTORE_KIND,
} from "../../../../../Types/StorageArray/Platforms/Dell/PowerStore/PowerStorePlatform";
import {
  SCRAPE_ENDPOINT_LABEL,
  StorageArrayExtractor,
  StorageArrayResourceBufferEntry,
  StorageArraySeries,
  StorageArraySnapshotBufferEntry,
  markScrapedEndpoint,
  markStorageArrayKindComplete,
} from "../StorageArrayExtractor";

/*
 * DELL POWERSTORE: one powerstore_* datapoint of Dell's
 * powerstore-metrics-exporter (v1.0.3) into the cluster's inventory and
 * snapshot.
 *
 * Its families, by the path the agent reads each from
 * (/metrics/<cluster>/<path>):
 *
 *   - cluster: powerstore_cluster, the cluster's name, id and state (and
 *     the Metro series, which stay in ClickHouse for the charts);
 *   - appliance: each appliance's service tag (powerstore_appliance) and
 *     performance (powerstore_perf_*);
 *   - capacity: each appliance's space (powerstore_cap_last_*), which sums
 *     to the cluster's;
 *   - hardware: each node's state and each drive, fan, power supply and
 *     battery's (powerstore_hardware_*), a drive's size and wear;
 *   - port: each Fibre Channel and Ethernet port's link, speed and
 *     performance;
 *   - volume, volumeGroup, nas and file: each volume's, volume group's, NAS
 *     server's and file system's state, space and performance.
 *
 * Every series of an object marks its kind complete for the batch, so its
 * count is written (StorageArraySnapshotScan's derive). A kind with no
 * object at all sends no series, so a cluster that never had a NAS server
 * has no count for them rather than a 0.
 *
 * PowerStore names a part (a node, drive, fan, port) within its appliance,
 * so a part's row is keyed `<appliance>/<name>` and its group is the
 * appliance; a volume, volume group, NAS server and file system are named
 * once per cluster and keyed by name.
 *
 * The exporter's states are 1 for Healthy (Ready, Started, link up) and 0
 * for any other state it does not name; a node names its state in its
 * `state` label. The values are PowerStore's own five-minute averages and
 * daily space rollups, so nothing here is a rate.
 */

const PLATFORM: typeof DellPowerStorePlatform = DellPowerStorePlatform;

// What the batch has seen across series, per array: built once per batch.
interface BatchState {
  // Each appliance's space, to sum into the cluster's.
  applianceSpace: Map<
    string,
    {
      total: number | null;
      used: number | null;
      dataPhysicalUsed: number | null;
      dataReduction: number | null;
    }
  >;
  // Each port's error rates by metric, summed into its errorsPerSec.
  portErrors: Map<string, Map<string, number>>;
  // The appliances each volume group spans.
  volumeGroupAppliances: Map<string, Set<string>>;
}

const BATCH_STATE: WeakMap<StorageArraySnapshotBufferEntry, BatchState> =
  new WeakMap();

function batchState(array: StorageArraySnapshotBufferEntry): BatchState {
  let state: BatchState | undefined = BATCH_STATE.get(array);
  if (!state) {
    state = {
      applianceSpace: new Map(),
      portErrors: new Map(),
      volumeGroupAppliances: new Map(),
    };
    BATCH_STATE.set(array, state);
  }
  return state;
}

function nonNegative(value: number): number {
  return Math.max(0, value);
}

function wholeBytes(value: number): number {
  return Math.max(0, Math.trunc(value));
}

function stateWord(value: number, words: { on: string; off: string }): string {
  return value >= 1 ? words.on : words.off;
}

const HEALTHY: { on: string; off: string } = {
  on: "healthy",
  off: "unhealthy",
};

// A part's row key: PowerStore names a part within its appliance.
function partKey(applianceId: string | null, name: string): string {
  return applianceId ? `${applianceId}/${name}` : name;
}

/*
 * One object's row: marks its kind complete (and the endpoint the series
 * came from), names it, and folds what `apply` sets. A row named null keeps
 * the name another series gave it (the fold and the upsert keep the first
 * name they see); with none, the pages show its key.
 */
function foldObject(
  series: StorageArraySeries,
  data: {
    kind: string;
    externalId: string;
    name: string | null;
    groupName?: string | null | undefined;
    apply: (row: StorageArrayResourceBufferEntry) => void;
  },
): void {
  markStorageArrayKindComplete(series.array, data.kind);
  markScrapedEndpoint(
    series.array,
    series.label(SCRAPE_ENDPOINT_LABEL),
    PLATFORM,
  );
  const row: StorageArrayResourceBufferEntry = series.newResource(
    data.kind,
    data.externalId,
  );
  row.name = data.name;
  if (data.groupName) {
    row.groupName = data.groupName;
  }
  data.apply(row);
  series.fold(row);
}

function setDetail(
  row: StorageArrayResourceBufferEntry,
  key: string,
  value: JSONObject[string],
): void {
  row.details[key] = value;
}

/*
 * The performance series of a volume, volume group, NAS server or file
 * system, by the suffix after its family: latency, operations and
 * bandwidth into the row's columns, the average I/O size into its details.
 */
const OBJECT_PERFORMANCE: Record<
  string,
  (row: StorageArrayResourceBufferEntry, value: number) => void
> = {
  avg_read_latency: (row: StorageArrayResourceBufferEntry, value: number) => {
    row.readLatencyUsec = nonNegative(value);
  },
  avg_write_latency: (row: StorageArrayResourceBufferEntry, value: number) => {
    row.writeLatencyUsec = nonNegative(value);
  },
  avg_read_iops: (row: StorageArrayResourceBufferEntry, value: number) => {
    row.readIops = nonNegative(value);
  },
  avg_write_iops: (row: StorageArrayResourceBufferEntry, value: number) => {
    row.writeIops = nonNegative(value);
  },
  avg_read_bandwidth: (row: StorageArrayResourceBufferEntry, value: number) => {
    row.readBytesPerSec = nonNegative(value);
  },
  avg_write_bandwidth: (
    row: StorageArrayResourceBufferEntry,
    value: number,
  ) => {
    row.writeBytesPerSec = nonNegative(value);
  },
  avg_io_size: (row: StorageArrayResourceBufferEntry, value: number) => {
    setDetail(row, "averageIoSizeBytes", nonNegative(value));
  },
};

function performanceApplier(
  metricName: string,
  prefix: string,
): ((row: StorageArrayResourceBufferEntry, value: number) => void) | null {
  const suffix: string = metricName.slice(prefix.length);
  return Object.prototype.hasOwnProperty.call(OBJECT_PERFORMANCE, suffix)
    ? OBJECT_PERFORMANCE[suffix]!
    : null;
}

// ---------------------------------------------------------------- cluster

function readCluster(series: StorageArraySeries): void {
  const array: StorageArraySnapshotBufferEntry = series.array;
  array.reportedName = array.reportedName || series.label("name");
  array.systemId = array.systemId || series.label("global_id");
  array.osName = array.osName || "PowerStoreOS";
  markScrapedEndpoint(array, series.label(SCRAPE_ENDPOINT_LABEL), PLATFORM);
}

// ------------------------------------------------------------- appliances

/*
 * Each table here is read by the metric name a scrape carried: a Map
 * (lookupTable) answers only for the names it lists, never for one every
 * object inherits ("constructor", "__proto__").
 */
const APPLIANCE_PERFORMANCE: ReadonlyMap<
  string,
  (row: StorageArrayResourceBufferEntry, value: number) => void
> = lookupTable<(row: StorageArrayResourceBufferEntry, value: number) => void>({
  powerstore_perf_avg_read_latency: (
    row: StorageArrayResourceBufferEntry,
    value: number,
  ) => {
    row.readLatencyUsec = nonNegative(value);
  },
  powerstore_perf_avg_write_latency: (
    row: StorageArrayResourceBufferEntry,
    value: number,
  ) => {
    row.writeLatencyUsec = nonNegative(value);
  },
  powerstore_perf_avg_latency: (
    row: StorageArrayResourceBufferEntry,
    value: number,
  ) => {
    setDetail(row, "averageLatencyUsec", nonNegative(value));
  },
  powerstore_perf_avg_read_iops: (
    row: StorageArrayResourceBufferEntry,
    value: number,
  ) => {
    row.readIops = nonNegative(value);
  },
  powerstore_perf_avg_write_iops: (
    row: StorageArrayResourceBufferEntry,
    value: number,
  ) => {
    row.writeIops = nonNegative(value);
  },
  powerstore_perf_avg_total_iops: (
    row: StorageArrayResourceBufferEntry,
    value: number,
  ) => {
    setDetail(row, "totalIops", nonNegative(value));
  },
  powerstore_perf_avg_read_bandwidth: (
    row: StorageArrayResourceBufferEntry,
    value: number,
  ) => {
    row.readBytesPerSec = nonNegative(value);
  },
  powerstore_perf_avg_write_bandwidth: (
    row: StorageArrayResourceBufferEntry,
    value: number,
  ) => {
    row.writeBytesPerSec = nonNegative(value);
  },
  powerstore_perf_avg_total_bandwidth: (
    row: StorageArrayResourceBufferEntry,
    value: number,
  ) => {
    setDetail(row, "totalBytesPerSec", nonNegative(value));
  },
  powerstore_perf_avg_io_workload_cpu_utilization: (
    row: StorageArrayResourceBufferEntry,
    value: number,
  ) => {
    setDetail(row, "ioCpuUtilizationPercent", nonNegative(value));
  },
  powerstore_perf_avg_io_size: (
    row: StorageArrayResourceBufferEntry,
    value: number,
  ) => {
    setDetail(row, "averageIoSizeBytes", nonNegative(value));
  },
});

// The cluster's space: the sum of its appliances' (and their data reduction).
function updateClusterSpace(series: StorageArraySeries): void {
  const state: BatchState = batchState(series.array);
  let total: number = 0;
  let used: number = 0;
  let appliancesWithTotal: number = 0;
  let appliancesWithBoth: number = 0;
  let weightedReduction: number = 0;
  let reductionWeight: number = 0;
  let reductionSum: number = 0;
  let reductionCount: number = 0;
  let everyReductionWeighted: boolean = true;
  for (const space of state.applianceSpace.values()) {
    if (space.total !== null) {
      total += space.total;
      appliancesWithTotal++;
      if (space.used !== null) {
        used += space.used;
        appliancesWithBoth++;
      }
    }
    if (space.dataReduction !== null) {
      reductionSum += space.dataReduction;
      reductionCount++;
      if (space.dataPhysicalUsed !== null && space.dataPhysicalUsed > 0) {
        weightedReduction += space.dataReduction * space.dataPhysicalUsed;
        reductionWeight += space.dataPhysicalUsed;
      } else {
        everyReductionWeighted = false;
      }
    }
  }
  const array: StorageArraySnapshotBufferEntry = series.array;
  if (appliancesWithTotal > 0) {
    array.capacityBytes = total;
    // Only when every appliance with a total said what it uses.
    array.emptyBytes =
      appliancesWithBoth === appliancesWithTotal
        ? Math.max(0, total - used)
        : null;
  }
  if (reductionCount > 0) {
    array.dataReductionRatio =
      everyReductionWeighted && reductionWeight > 0
        ? weightedReduction / reductionWeight
        : reductionSum / reductionCount;
  }
}

function readApplianceSpace(series: StorageArraySeries): void {
  const applianceId: string | null = series.label("appliance_id");
  if (!applianceId) {
    return;
  }
  const value: number = series.value;
  const state: BatchState = batchState(series.array);
  const space: {
    total: number | null;
    used: number | null;
    dataPhysicalUsed: number | null;
    dataReduction: number | null;
  } = state.applianceSpace.get(applianceId) || {
    total: null,
    used: null,
    dataPhysicalUsed: null,
    dataReduction: null,
  };
  state.applianceSpace.set(applianceId, space);

  foldObject(series, {
    kind: POWERSTORE_KIND.Appliance,
    externalId: applianceId,
    // The capacity path names no appliance: the appliance path does.
    name: null,
    apply: (row: StorageArrayResourceBufferEntry): void => {
      switch (series.metricName) {
        case "powerstore_cap_last_physical_total":
          row.capacityBytes = wholeBytes(value);
          space.total = wholeBytes(value);
          break;
        case "powerstore_cap_last_physical_used":
          row.usedBytes = wholeBytes(value);
          space.used = wholeBytes(value);
          break;
        case "powerstore_cap_last_data_physical_used":
          setDetail(row, "dataPhysicalUsedBytes", wholeBytes(value));
          space.dataPhysicalUsed = wholeBytes(value);
          break;
        case "powerstore_cap_last_data_reduction":
          row.dataReductionRatio = nonNegative(value);
          space.dataReduction = nonNegative(value);
          break;
        case "powerstore_cap_last_logical_provisioned":
          setDetail(row, "logicalProvisionedBytes", wholeBytes(value));
          break;
        case "powerstore_cap_last_logical_used":
          setDetail(row, "logicalUsedBytes", wholeBytes(value));
          break;
        case "powerstore_cap_last_efficiency_ratio":
          setDetail(row, "efficiencyRatio", nonNegative(value));
          break;
        case "powerstore_cap_last_snapshot_savings":
          setDetail(row, "snapshotSavings", nonNegative(value));
          break;
        case "powerstore_cap_last_thin_savings":
          setDetail(row, "thinSavings", nonNegative(value));
          break;
        default:
          break;
      }
    },
  });
  updateClusterSpace(series);
}

function readAppliance(series: StorageArraySeries): void {
  const applianceId: string | null = series.label("appliance_id");
  if (!applianceId) {
    return;
  }
  if (series.metricName === "powerstore_appliance") {
    foldObject(series, {
      kind: POWERSTORE_KIND.Appliance,
      externalId: applianceId,
      name: null,
      apply: (row: StorageArrayResourceBufferEntry): void => {
        const serviceTag: string | null = series.label("service_tag");
        if (serviceTag) {
          setDetail(row, "serviceTag", serviceTag);
        }
      },
    });
    return;
  }
  const apply:
    | ((row: StorageArrayResourceBufferEntry, value: number) => void)
    | undefined = APPLIANCE_PERFORMANCE.get(series.metricName);
  if (!apply) {
    return;
  }
  foldObject(series, {
    kind: POWERSTORE_KIND.Appliance,
    externalId: applianceId,
    name: series.label("appliance_name"),
    apply: (row: StorageArrayResourceBufferEntry): void => {
      apply(row, series.value);
    },
  });
}

// --------------------------------------------------------------- hardware

const PART_TYPES: ReadonlyMap<string, string> = lookupTable<string>({
  powerstore_hardware_Fan_state: "Fan",
  powerstore_hardware_Power_Supply_state: "Power Supply",
  powerstore_hardware_Battery_state: "Battery",
});

/*
 * A drive's type as PowerStore's REST API words it: NVMe_SSD is an NVMe
 * SSD, SAS_SSD a SAS one; the bus is the protocol.
 */
function driveType(raw: string | null): {
  type: string | null;
  protocol: string | null;
} {
  if (!raw) {
    return { type: null, protocol: null };
  }
  const typePattern: RegExp = /^(NVMe|SAS)_(.+)$/;
  const match: RegExpExecArray | null = typePattern.exec(raw);
  return {
    type: raw.replace(/_/g, " "),
    protocol: match ? match[1]! : null,
  };
}

function readHardware(series: StorageArraySeries): void {
  const name: string | null = series.label("name");
  if (!name) {
    return;
  }
  const applianceId: string | null = series.label("appliance_id");
  const metricName: string = series.metricName;
  const value: number = series.value;

  if (metricName === "powerstore_hardware_node_state") {
    foldObject(series, {
      kind: StorageArrayResourceKind.Hardware,
      externalId: partKey(applianceId, name),
      name,
      groupName: applianceId,
      apply: (row: StorageArrayResourceBufferEntry): void => {
        row.componentType = "Node";
        // The state label is the node's lifecycle state, whatever the value.
        const state: string | null = series.label("state");
        row.status = state ? state.toLowerCase() : stateWord(value, HEALTHY);
        const serialNumber: string | null = series.label("serial_number");
        if (serialNumber) {
          setDetail(row, "serialNumber", serialNumber);
        }
      },
    });
    return;
  }

  const partType: string | undefined = PART_TYPES.get(metricName);
  if (partType) {
    foldObject(series, {
      kind: StorageArrayResourceKind.Hardware,
      externalId: partKey(applianceId, name),
      name,
      groupName: applianceId,
      apply: (row: StorageArrayResourceBufferEntry): void => {
        row.componentType = partType;
        row.status = stateWord(value, HEALTHY);
      },
    });
    return;
  }

  if (
    metricName === "powerstore_hardware_Drive_state" ||
    metricName === "powerstore_hardware_drive_size" ||
    metricName === "powerstore_wear_metrics_by_drive"
  ) {
    foldObject(series, {
      kind: StorageArrayResourceKind.Drive,
      externalId: partKey(applianceId, name),
      name,
      groupName: applianceId,
      apply: (row: StorageArrayResourceBufferEntry): void => {
        if (metricName === "powerstore_hardware_Drive_state") {
          row.status = stateWord(value, HEALTHY);
        } else if (metricName === "powerstore_hardware_drive_size") {
          row.capacityBytes = wholeBytes(value);
          const type: { type: string | null; protocol: string | null } =
            driveType(series.label("drive_type"));
          row.componentType = type.type;
          if (type.protocol) {
            setDetail(row, "protocol", type.protocol);
          }
        } else {
          setDetail(row, "enduranceRemainingPercent", nonNegative(value));
        }
      },
    });
  }
}

// ------------------------------------------------------------------ ports

const FC_ERROR_DETAILS: ReadonlyMap<string, string> = lookupTable<string>({
  powerstore_metricFcPort_avg_invalid_crc_count_ps: "crcErrorsPerSec",
  powerstore_metricFcPort_avg_link_failure_count_ps: "linkFailuresPerSec",
  powerstore_metricFcPort_avg_loss_of_signal_count_ps: "lossOfSignalPerSec",
  powerstore_metricFcPort_avg_loss_of_sync_count_ps: "lossOfSyncPerSec",
  powerstore_metricFcPort_avg_invalid_tx_word_count_ps: "invalidTxWordsPerSec",
  powerstore_metricFcPort_avg_prim_seq_prot_err_count_ps:
    "primitiveSequenceErrorsPerSec",
  powerstore_metricFcPort_avg_dumped_frames_ps: "dumpedFramesPerSec",
});

const ETH_ERROR_DETAILS: ReadonlyMap<string, string> = lookupTable<string>({
  powerstore_metricEthPort_avg_pkt_rx_crc_error_ps: "crcErrorsPerSec",
  powerstore_metricEthPort_avg_pkt_rx_no_buffer_error_ps:
    "noBufferErrorsPerSec",
  powerstore_metricEthPort_avg_pkt_tx_error_ps: "transmitErrorsPerSec",
});

// A port's errors per second: every error rate of it the batch carried.
function addPortError(
  series: StorageArraySeries,
  key: string,
  metricName: string,
  value: number,
): number {
  const state: BatchState = batchState(series.array);
  let errors: Map<string, number> | undefined = state.portErrors.get(key);
  if (!errors) {
    errors = new Map();
    state.portErrors.set(key, errors);
  }
  errors.set(metricName, nonNegative(value));
  let sum: number = 0;
  for (const rate of errors.values()) {
    sum += rate;
  }
  return sum;
}

function readPort(series: StorageArraySeries): void {
  const metricName: string = series.metricName;
  const isFibreChannel: boolean =
    metricName.startsWith("powerstore_fc_port_") ||
    metricName.startsWith("powerstore_metricFcPort_");
  const name: string | null = series.label(
    isFibreChannel ? "fc_port_id" : "eth_port_id",
  );
  if (!name) {
    return;
  }
  const applianceId: string | null = series.label("appliance_id");
  const key: string = partKey(applianceId, name);
  const value: number = series.value;

  const errorDetail: string | undefined = isFibreChannel
    ? FC_ERROR_DETAILS.get(metricName)
    : ETH_ERROR_DETAILS.get(metricName);

  const apply: ((row: StorageArrayResourceBufferEntry) => void) | null = (():
    | ((row: StorageArrayResourceBufferEntry) => void)
    | null => {
    if (
      metricName === "powerstore_fc_port_is_link_up" ||
      metricName === "powerstore_eth_port_is_link_up"
    ) {
      return (row: StorageArrayResourceBufferEntry): void => {
        row.status = stateWord(value, { on: "up", off: "down" });
      };
    }
    if (
      metricName === "powerstore_fc_port_current_speed" ||
      metricName === "powerstore_eth_port_current_speed"
    ) {
      // In Gbit/s; 0 for a port without a link.
      return (row: StorageArrayResourceBufferEntry): void => {
        if (value > 0) {
          setDetail(row, "speedGbps", value);
          setDetail(row, "speedBytesPerSec", (value * 1e9) / 8);
        }
      };
    }
    if (errorDetail) {
      return (row: StorageArrayResourceBufferEntry): void => {
        setDetail(row, errorDetail, nonNegative(value));
        setDetail(
          row,
          "errorsPerSec",
          addPortError(series, key, metricName, value),
        );
      };
    }
    switch (metricName) {
      case "powerstore_metricFcPort_avg_read_latency":
        return (row: StorageArrayResourceBufferEntry): void => {
          row.readLatencyUsec = nonNegative(value);
        };
      case "powerstore_metricFcPort_avg_write_latency":
        return (row: StorageArrayResourceBufferEntry): void => {
          row.writeLatencyUsec = nonNegative(value);
        };
      case "powerstore_metricFcPort_avg_total_iops":
        return (row: StorageArrayResourceBufferEntry): void => {
          setDetail(row, "totalIops", nonNegative(value));
        };
      case "powerstore_metricFcPort_avg_total_bandwidth":
        return (row: StorageArrayResourceBufferEntry): void => {
          setDetail(row, "totalBytesPerSec", nonNegative(value));
        };
      case "powerstore_metricEthPort_avg_bytes_rx_ps":
        return (row: StorageArrayResourceBufferEntry): void => {
          setDetail(row, "receivedBytesPerSec", nonNegative(value));
        };
      case "powerstore_metricEthPort_avg_bytes_tx_ps":
        return (row: StorageArrayResourceBufferEntry): void => {
          setDetail(row, "transmittedBytesPerSec", nonNegative(value));
        };
      default:
        return null;
    }
  })();
  if (!apply) {
    return;
  }

  foldObject(series, {
    kind: StorageArrayResourceKind.NetworkInterface,
    externalId: key,
    name,
    groupName: applianceId,
    apply: (row: StorageArrayResourceBufferEntry): void => {
      row.componentType = isFibreChannel ? "Fibre Channel" : "Ethernet";
      apply(row);
    },
  });
}

// --------------------------------------------- volumes, groups, files

function readVolume(series: StorageArraySeries): void {
  const metricName: string = series.metricName;
  const isPerformance: boolean = metricName.startsWith(
    "powerstore_metricVolume_",
  );
  const name: string | null = series.label(
    isPerformance ? "volume_id" : "name",
  );
  if (!name) {
    return;
  }
  const value: number = series.value;
  let apply: ((row: StorageArrayResourceBufferEntry) => void) | null = null;
  if (isPerformance) {
    const applier:
      | ((row: StorageArrayResourceBufferEntry, value: number) => void)
      | null = performanceApplier(metricName, "powerstore_metricVolume_");
    if (applier) {
      apply = (row: StorageArrayResourceBufferEntry): void => {
        applier(row, value);
      };
    }
  } else if (metricName === "powerstore_volume_state") {
    apply = (row: StorageArrayResourceBufferEntry): void => {
      row.status = stateWord(value, { on: "ready", off: "not ready" });
    };
  } else if (metricName === "powerstore_volume_size") {
    apply = (row: StorageArrayResourceBufferEntry): void => {
      row.capacityBytes = wholeBytes(value);
    };
  } else if (metricName === "powerstore_volume_logical_used") {
    apply = (row: StorageArrayResourceBufferEntry): void => {
      row.usedBytes = wholeBytes(value);
    };
  }
  if (!apply) {
    return;
  }
  foldObject(series, {
    kind: StorageArrayResourceKind.Volume,
    externalId: name,
    name,
    groupName: series.label("appliance_id"),
    apply,
  });
}

function readVolumeGroup(series: StorageArraySeries): void {
  const metricName: string = series.metricName;
  const isPerformance: boolean = metricName.startsWith("powerstore_metricVg_");
  const name: string | null = series.label(
    isPerformance ? "volume_group_id" : "name",
  );
  if (!name) {
    return;
  }
  const value: number = series.value;
  let apply: ((row: StorageArrayResourceBufferEntry) => void) | null = null;
  if (isPerformance) {
    const applier:
      | ((row: StorageArrayResourceBufferEntry, value: number) => void)
      | null = performanceApplier(metricName, "powerstore_metricVg_");
    if (applier) {
      apply = (row: StorageArrayResourceBufferEntry): void => {
        applier(row, value);
      };
    }
  } else if (
    metricName === "powerstore_volumegroup_logical_provisioned" ||
    metricName === "powerstore_volumegroup_logical_used"
  ) {
    /*
     * One series per appliance the group spans, each with the group's
     * whole figure: the group's appliances are listed, not summed.
     */
    const applianceId: string | null = series.label("appliance_id");
    const state: BatchState = batchState(series.array);
    let appliances: Set<string> | undefined =
      state.volumeGroupAppliances.get(name);
    if (!appliances) {
      appliances = new Set();
      state.volumeGroupAppliances.set(name, appliances);
    }
    if (applianceId) {
      appliances.add(applianceId);
    }
    const spanned: string = Array.from(appliances).sort().join(", ");
    apply = (row: StorageArrayResourceBufferEntry): void => {
      if (metricName === "powerstore_volumegroup_logical_provisioned") {
        row.capacityBytes = wholeBytes(value);
      } else {
        row.usedBytes = wholeBytes(value);
      }
      if (spanned) {
        setDetail(row, "appliances", spanned);
      }
    };
  }
  if (!apply) {
    return;
  }
  foldObject(series, {
    kind: POWERSTORE_KIND.VolumeGroup,
    externalId: name,
    name,
    apply,
  });
}

function readNasServer(series: StorageArraySeries): void {
  const metricName: string = series.metricName;
  const isPerformance: boolean = metricName.startsWith("powerstore_metricNas_");
  const name: string | null = series.label(isPerformance ? "nas_id" : "name");
  if (!name) {
    return;
  }
  const value: number = series.value;
  let apply: ((row: StorageArrayResourceBufferEntry) => void) | null = null;
  if (isPerformance) {
    const applier:
      | ((row: StorageArrayResourceBufferEntry, value: number) => void)
      | null = performanceApplier(metricName, "powerstore_metricNas_");
    if (applier) {
      apply = (row: StorageArrayResourceBufferEntry): void => {
        applier(row, value);
      };
    }
  } else if (metricName === "powerstore_nas_server_operational_status") {
    apply = (row: StorageArrayResourceBufferEntry): void => {
      row.status = stateWord(value, { on: "started", off: "not started" });
    };
  }
  if (!apply) {
    return;
  }
  foldObject(series, {
    kind: POWERSTORE_KIND.NasServer,
    externalId: name,
    name,
    apply,
  });
}

function readFileSystem(series: StorageArraySeries): void {
  const metricName: string = series.metricName;
  const name: string | null = series.label("name");
  if (!name) {
    return;
  }
  const value: number = series.value;
  let apply: ((row: StorageArrayResourceBufferEntry) => void) | null = null;
  if (metricName.startsWith("powerstore_metricFilesystem_")) {
    const applier:
      | ((row: StorageArrayResourceBufferEntry, value: number) => void)
      | null = performanceApplier(metricName, "powerstore_metricFilesystem_");
    if (applier) {
      apply = (row: StorageArrayResourceBufferEntry): void => {
        applier(row, value);
      };
    }
  } else if (metricName === "powerstore_filesystem_logical_provisioned") {
    apply = (row: StorageArrayResourceBufferEntry): void => {
      row.capacityBytes = wholeBytes(value);
    };
  } else if (metricName === "powerstore_filesystem_logical_used") {
    apply = (row: StorageArrayResourceBufferEntry): void => {
      row.usedBytes = wholeBytes(value);
    };
  } else if (metricName === "powerstore_filesystem_thin_savings") {
    apply = (row: StorageArrayResourceBufferEntry): void => {
      setDetail(row, "thinSavings", nonNegative(value));
    };
  }
  if (!apply) {
    return;
  }
  foldObject(series, {
    kind: StorageArrayResourceKind.FileSystem,
    externalId: name,
    name,
    apply,
  });
}

function extractPowerStoreSeries(series: StorageArraySeries): void {
  const metricName: string = series.metricName;

  if (metricName === "powerstore_cluster") {
    readCluster(series);
    return;
  }
  if (
    metricName === "powerstore_appliance" ||
    metricName.startsWith("powerstore_perf_")
  ) {
    readAppliance(series);
    return;
  }
  if (metricName.startsWith("powerstore_cap_last_")) {
    readApplianceSpace(series);
    return;
  }
  if (
    metricName.startsWith("powerstore_hardware_") ||
    metricName === "powerstore_wear_metrics_by_drive"
  ) {
    readHardware(series);
    return;
  }
  if (
    metricName.startsWith("powerstore_fc_port_") ||
    metricName.startsWith("powerstore_eth_port_") ||
    metricName.startsWith("powerstore_metricFcPort_") ||
    metricName.startsWith("powerstore_metricEthPort_")
  ) {
    readPort(series);
    return;
  }
  if (
    metricName.startsWith("powerstore_volumegroup_") ||
    metricName.startsWith("powerstore_metricVg_")
  ) {
    readVolumeGroup(series);
    return;
  }
  if (
    metricName.startsWith("powerstore_volume_") ||
    metricName.startsWith("powerstore_metricVolume_")
  ) {
    readVolume(series);
    return;
  }
  if (
    metricName.startsWith("powerstore_nas_server_") ||
    metricName.startsWith("powerstore_metricNas_")
  ) {
    readNasServer(series);
    return;
  }
  if (
    metricName.startsWith("powerstore_filesystem_") ||
    metricName.startsWith("powerstore_metricFilesystem_")
  ) {
    readFileSystem(series);
  }
}

const PowerStoreExtractor: StorageArrayExtractor = {
  storageSystem: DellPowerStorePlatform.storageSystem,
  extract: extractPowerStoreSeries,
};

export default PowerStoreExtractor;
