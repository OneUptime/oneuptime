import StorageArrayResourceKind from "../../../../../Types/StorageArray/StorageArrayResourceKind";
import PowerMaxPlatform from "../../../../../Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxPlatform";
import {
  POWERMAX_LABELS,
  POWERMAX_METRICS,
  POWERMAX_PORT_KIND,
  PowerMaxKind,
} from "../../../../../Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxSeries";
import {
  StorageArrayExtractor,
  StorageArrayResourceBufferEntry,
  StorageArraySeries,
  markScrapedEndpoint,
} from "../StorageArrayExtractor";

/*
 * DELL POWERMAX: one powermax_* datapoint into the array's inventory and
 * snapshot.
 *
 * A probe reads each array behind a Unisphere for PowerMax every five
 * minutes and sends it as one batch (packages/Probe/Utils/StorageArray/
 * Dell/PowerMax): the array's identity, capacity and open alerts, and every
 * storage group, volume, storage resource pool, director, port and SRDF
 * group it listed, each with its 5-minute performance. A kind the batch
 * listed in full has a powermax_inventory_listed series naming its
 * endpoint, so its count is written even when it has no object left; a
 * kind a collection could not read has none, and its count stays as it was.
 *
 * The names and labels are PowerMaxSeries', the probe's too.
 */

const L: typeof POWERMAX_LABELS = POWERMAX_LABELS;
const M: typeof POWERMAX_METRICS = POWERMAX_METRICS;

function lowerOrNull(value: string | null): string | null {
  return value ? value.toLowerCase() : null;
}

/*
 * The operating system a microcode family is: 5977 is HYPERMAX OS (VMAX3
 * and VMAX All Flash), every later family PowerMaxOS.
 */
export function getPowerMaxOsName(microcode: string | null): string {
  return microcode && microcode.startsWith("5977")
    ? "HYPERMAX OS"
    : "PowerMaxOS";
}

function fold(
  series: StorageArraySeries,
  kind: string,
  externalId: string,
  apply: (row: StorageArrayResourceBufferEntry) => void,
): void {
  const row: StorageArrayResourceBufferEntry = series.newResource(
    kind,
    externalId,
  );
  apply(row);
  series.fold(row);
}

// A non-negative finite value, or null.
function nonNegative(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function readArray(series: StorageArraySeries): boolean {
  const array: StorageArraySeries["array"] = series.array;

  switch (series.metricName) {
    case M.arrayInfo: {
      const symmetrixId: string | null = series.label(L.symmetrixId);
      const microcode: string | null = series.label(L.microcode);
      array.systemId = array.systemId || symmetrixId;
      array.reportedName = array.reportedName || symmetrixId;
      array.osName = array.osName || getPowerMaxOsName(microcode);
      array.osVersion = array.osVersion || microcode;
      return true;
    }
    case M.inventoryListed:
      markScrapedEndpoint(
        array,
        series.label(L.scrapeEndpoint),
        PowerMaxPlatform,
      );
      return true;
    case M.arrayUsableBytes:
      array.capacityBytes = nonNegative(series.value);
      return true;
    case M.arrayUsedBytes:
      if (array.capacityBytes !== null && series.value >= 0) {
        array.emptyBytes = Math.max(0, array.capacityBytes - series.value);
      }
      return true;
    case M.arrayUsedPercent:
      array.utilizationPercent = nonNegative(series.value);
      return true;
    case M.arrayDataReductionRatio:
      array.dataReductionRatio = nonNegative(series.value);
      return true;
    case M.alertOpen: {
      array.sawAlerts = true;
      const key: string =
        series.label(L.alertId) ||
        `${series.label(L.object) || ""}|${series.label(L.description) || ""}`;
      array.openAlertKeys.add(key);
      const severity: string | null = lowerOrNull(series.label(L.severity));
      if (severity === "critical") {
        array.criticalAlertKeys.add(key);
      } else if (severity === "warning") {
        array.warningAlertKeys.add(key);
      }
      return true;
    }
    default:
      return false;
  }
}

function readStorageGroup(series: StorageArraySeries): boolean {
  const name: string | null = series.label(L.storageGroup);
  if (!name) {
    return series.metricName.startsWith("powermax_storage_group_");
  }

  const apply: ((row: StorageArrayResourceBufferEntry) => void) | null = (():
    | ((row: StorageArrayResourceBufferEntry) => void)
    | null => {
    switch (series.metricName) {
      case M.storageGroupInfo:
        return (row: StorageArrayResourceBufferEntry): void => {
          row.componentType = series.label(L.storageGroupType);
          row.groupName = series.label(L.srp);
          // The worst SRDF state of its pairs, when it is replicated.
          row.status = lowerOrNull(series.label(L.state));
          row.statusDetail = series.label(L.mode);
          const serviceLevel: string | null = series.label(L.serviceLevel);
          if (serviceLevel) {
            row.details["serviceLevel"] = serviceLevel;
          }
          row.details["realtime"] = series.label(L.realtime) === "true";
        };
      case M.storageGroupCapacityBytes:
        return (row: StorageArrayResourceBufferEntry): void => {
          row.capacityBytes = nonNegative(series.value);
        };
      case M.storageGroupUsedBytes:
        return (row: StorageArrayResourceBufferEntry): void => {
          row.usedBytes = nonNegative(series.value);
        };
      case M.storageGroupDataReductionRatio:
        return (row: StorageArrayResourceBufferEntry): void => {
          row.dataReductionRatio = nonNegative(series.value);
        };
      case M.storageGroupReadResponseTime:
        return (row: StorageArrayResourceBufferEntry): void => {
          row.readLatencyUsec = nonNegative(series.value);
        };
      case M.storageGroupWriteResponseTime:
        return (row: StorageArrayResourceBufferEntry): void => {
          row.writeLatencyUsec = nonNegative(series.value);
        };
      case M.storageGroupReadIops:
        return (row: StorageArrayResourceBufferEntry): void => {
          row.readIops = nonNegative(series.value);
        };
      case M.storageGroupWriteIops:
        return (row: StorageArrayResourceBufferEntry): void => {
          row.writeIops = nonNegative(series.value);
        };
      case M.storageGroupReadThroughput:
        return (row: StorageArrayResourceBufferEntry): void => {
          row.readBytesPerSec = nonNegative(series.value);
        };
      case M.storageGroupWriteThroughput:
        return (row: StorageArrayResourceBufferEntry): void => {
          row.writeBytesPerSec = nonNegative(series.value);
        };
      default:
        return null;
    }
  })();

  if (!apply) {
    return series.metricName.startsWith("powermax_storage_group_");
  }

  fold(
    series,
    PowerMaxKind.StorageGroup,
    name,
    (row: StorageArrayResourceBufferEntry) => {
      row.name = name;
      apply(row);
    },
  );
  return true;
}

function readVolume(series: StorageArraySeries): boolean {
  if (!series.metricName.startsWith("powermax_volume_")) {
    return false;
  }
  const volume: string | null = series.label(L.volume);
  if (!volume) {
    return true;
  }

  fold(
    series,
    StorageArrayResourceKind.Volume,
    volume,
    (row: StorageArrayResourceBufferEntry) => {
      const niceName: string | null = series.label(L.volumeName);
      row.name = niceName ? `${niceName} (${volume})` : volume;
      switch (series.metricName) {
        case M.volumeInfo:
          row.status = lowerOrNull(series.label(L.status));
          row.componentType = series.label(L.emulation);
          row.groupName = series.label(L.storageGroup);
          return;
        case M.volumeCapacityBytes:
          row.capacityBytes = nonNegative(series.value);
          return;
        case M.volumeUsedBytes:
          row.usedBytes = nonNegative(series.value);
          return;
        case M.volumeReadResponseTime:
          row.readLatencyUsec = nonNegative(series.value);
          return;
        case M.volumeWriteResponseTime:
          row.writeLatencyUsec = nonNegative(series.value);
          return;
        default:
          return;
      }
    },
  );
  return true;
}

function readStorageResourcePool(series: StorageArraySeries): boolean {
  if (!series.metricName.startsWith("powermax_srp_")) {
    return false;
  }
  const srp: string | null = series.label(L.srp);
  if (!srp) {
    return true;
  }

  fold(
    series,
    PowerMaxKind.StorageResourcePool,
    srp,
    (row: StorageArrayResourceBufferEntry) => {
      row.name = srp;
      switch (series.metricName) {
        case M.srpInfo:
          row.componentType = series.label(L.emulation);
          return;
        case M.srpUsableBytes:
          row.capacityBytes = nonNegative(series.value);
          return;
        case M.srpUsedBytes:
          row.usedBytes = nonNegative(series.value);
          return;
        case M.srpDataReductionRatio:
          row.dataReductionRatio = nonNegative(series.value);
          return;
        default:
          return;
      }
    },
  );
  return true;
}

function readDirector(series: StorageArraySeries): boolean {
  if (series.metricName !== M.directorInfo) {
    return series.metricName.startsWith("powermax_director_");
  }
  const director: string | null = series.label(L.director);
  if (!director) {
    return true;
  }

  fold(
    series,
    PowerMaxKind.Director,
    director,
    (row: StorageArrayResourceBufferEntry) => {
      row.name = director;
      row.status = lowerOrNull(series.label(L.status));
      row.componentType = series.label(L.directorType);
      const role: string | null = series.label(L.role);
      if (role) {
        row.details["role"] = role;
      }
      const engine: string | null = series.label(L.engine);
      if (engine) {
        row.details["engine"] = engine;
      }
      const slot: string | null = series.label(L.slot);
      if (slot) {
        row.details["slot"] = slot;
      }
    },
  );
  return true;
}

function readPort(series: StorageArraySeries): boolean {
  if (!series.metricName.startsWith("powermax_port_")) {
    return false;
  }
  const portId: string | null = series.label(L.portId);
  if (!portId) {
    return true;
  }

  fold(
    series,
    POWERMAX_PORT_KIND,
    portId,
    (row: StorageArrayResourceBufferEntry) => {
      row.name = portId;
      switch (series.metricName) {
        case M.portInfo: {
          row.status = lowerOrNull(series.label(L.status));
          row.componentType = series.label(L.protocol);
          const director: string | null = series.label(L.director);
          if (director) {
            row.details["services"] = director;
          }
          row.details["inUse"] = series.label(L.inUse) === "true";
          return;
        }
        case M.portSpeedBytes:
          row.details["speedBytesPerSec"] = nonNegative(series.value);
          return;
        // A host's read leaves the array through the port; its write arrives.
        case M.portReadThroughput:
          row.details["transmittedBytesPerSec"] = nonNegative(series.value);
          return;
        case M.portWriteThroughput:
          row.details["receivedBytesPerSec"] = nonNegative(series.value);
          return;
        default:
          return;
      }
    },
  );
  return true;
}

function readSrdfGroup(series: StorageArraySeries): boolean {
  if (!series.metricName.startsWith("powermax_srdf_group_")) {
    return false;
  }
  const group: string | null = series.label(L.srdfGroup);
  if (!group) {
    return true;
  }

  fold(
    series,
    PowerMaxKind.SrdfGroup,
    group,
    (row: StorageArrayResourceBufferEntry) => {
      const label: string | null = series.label(L.srdfLabel);
      row.name = label ? `${group} ${label}` : group;
      switch (series.metricName) {
        case M.srdfGroupInfo: {
          row.status = lowerOrNull(series.label(L.state));
          row.statusDetail = series.label(L.mode);
          row.groupName = series.label(L.remoteSymmetrixId);
          const remoteGroup: string | null = series.label(L.remoteSrdfGroup);
          if (remoteGroup) {
            row.details["remoteSrdfGroup"] = remoteGroup;
          }
          return;
        }
        case M.srdfGroupLagSeconds: {
          const lag: number | null = nonNegative(series.value);
          row.replicationLagMs = lag === null ? null : Math.round(lag * 1000);
          return;
        }
        case M.srdfGroupCapacityBytes:
          row.capacityBytes = nonNegative(series.value);
          return;
        default:
          return;
      }
    },
  );
  return true;
}

const PowerMaxExtractor: StorageArrayExtractor = {
  storageSystem: PowerMaxPlatform.storageSystem,
  extract: (series: StorageArraySeries): void => {
    // The first reader that knows the series' family takes it.
    if (readArray(series)) {
      return;
    }
    if (readStorageGroup(series)) {
      return;
    }
    if (readVolume(series)) {
      return;
    }
    if (readStorageResourcePool(series)) {
      return;
    }
    if (readDirector(series)) {
      return;
    }
    if (readPort(series)) {
      return;
    }
    readSrdfGroup(series);
  },
};

export default PowerMaxExtractor;
