import { JSONValue } from "../../../../../Types/JSON";
import StorageArrayResourceKind from "../../../../../Types/StorageArray/StorageArrayResourceKind";
import { StorageArrayOpenProblemSeries } from "../../../../../Types/StorageArray/StorageArrayPlatform";
import NetAppOntapPlatform from "../../../../../Types/StorageArray/Platforms/NetApp/ONTAP/OntapPlatform";
import {
  ONTAP_FSX_CLUSTER_NAME,
  ONTAP_FSX_OS_NAME,
  ONTAP_OS_NAME,
  OntapKind,
} from "../../../../../Types/StorageArray/Platforms/NetApp/NetApp";
import {
  StorageArrayExtractor,
  StorageArrayResourceBufferEntry,
  StorageArraySeries,
  StorageArraySnapshotBufferEntry,
  markStorageArrayKindComplete,
} from "../StorageArrayExtractor";

/*
 * NETAPP ONTAP: one netapp_* datapoint of NetApp Harvest's into the
 * cluster's inventory and snapshot (#11001).
 *
 * Harvest serves every object it read on one endpoint, and labels every
 * series with the `cluster` it came from. What a series means is
 * Harvest 26.11's, per its documentation
 * (netapp.github.io/harvest/26.11/ontap-metrics) and its templates
 * (conf/rest/9.12.0, conf/keyperf/9.15.0, conf/restperf/9.12.0):
 *
 *   - <object>_labels: value 1, the object's identity and state in labels
 *     (a volume's state and type, an aggregate's disk type, a node's model
 *     and version);
 *   - <object>_new_status: Harvest's 1 for healthy (online, up, running)
 *     and 0 for anything else;
 *   - the Rest collector's sizes in bytes; KeyPerf's and RestPerf's
 *     latencies in microseconds per operation, *_ops per second, *_data in
 *     bytes per second;
 *   - netapp_health_*_alerts: one series per problem ONTAP reports open,
 *     value 1 (0 once, the poll after it clears);
 *   - netapp_metadata_*: Harvest's own, which say which objects it read.
 *
 * Which kinds a batch lists in full is Harvest's to say, object by object:
 * an object its Rest collector polled has a metadata_collector_instances
 * series, and one with nothing to list goes to standby with the reason "no
 * instances" (metadata_component_status 1). Only then is the kind's count
 * written, so an object Harvest has not polled yet (it just started) or
 * could not read (Amazon FSx refuses the disk APIs to fsxadmin) never
 * counts 0.
 *
 * What the series say together (a node's state from its health and its
 * failed parts, the cluster's capacity summed over its aggregates, the
 * SVMs ONTAP keeps for itself) is worked out once the batch is folded:
 * finishOntapBatch.
 */

// Harvest's objects, as its collectors' metadata name them: "Rest:Volume".
type HarvestObject = string;

/*
 * The objects whose complete list makes a kind's, by kind. A kind several
 * objects feed is complete only when every one of them is: a cluster's
 * Hardware rows are its shelves (Shelf) and its nodes' sensors (Sensor).
 */
const KIND_SOURCES: ReadonlyArray<[string, ReadonlyArray<HarvestObject>]> = [
  [StorageArrayResourceKind.Volume, ["Rest:Volume"]],
  [OntapKind.Lun, ["Rest:Lun"]],
  [OntapKind.Aggregate, ["Rest:Aggregate"]],
  [OntapKind.Svm, ["Rest:SVM"]],
  [OntapKind.SnapMirror, ["Rest:SnapMirror"]],
  [StorageArrayResourceKind.Controller, ["Rest:Node"]],
  [StorageArrayResourceKind.Drive, ["Rest:Disk"]],
  [StorageArrayResourceKind.Hardware, ["Rest:Shelf", "Rest:Sensor"]],
  [StorageArrayResourceKind.NetworkInterface, ["Rest:NetPort", "Rest:FCP"]],
];

// The open problems' list is complete once Harvest's Health object ran.
const OPEN_PROBLEMS_SOURCE: HarvestObject = "Rest:Health";

/*
 * The SVMs ONTAP keeps for itself (the cluster's admin SVM, each node's,
 * the cluster network's): no one's data is in them.
 */
const SYSTEM_SVM_TYPES: ReadonlyArray<string> = ["admin", "node", "system"];

// The component types of a cluster's Hardware rows.
export const ONTAP_COMPONENT_TYPES: {
  shelf: string;
  powerSupply: string;
  fan: string;
  temperatureSensor: string;
  voltageSensor: string;
  currentSensor: string;
  module: string;
  sensor: string;
} = {
  shelf: "Shelf",
  powerSupply: "Power Supply",
  fan: "Fan",
  temperatureSensor: "Temperature Sensor",
  voltageSensor: "Voltage Sensor",
  currentSensor: "Current Sensor",
  module: "Module",
  sensor: "Sensor",
};

/*
 * What Amazon FSx for NetApp ONTAP refuses whoever asks (disks, shelves,
 * the nodes' sensors, Fibre Channel ports: AWS runs that hardware), so a
 * kind such an object feeds is complete without it on an FSx file system.
 * On any other cluster an object Harvest could not read leaves its kinds
 * incomplete: their last count stands.
 */
const FSX_ABSENT_OBJECTS: ReadonlyArray<HarvestObject> = [
  "Rest:Disk",
  "Rest:Shelf",
  "Rest:Sensor",
  "Rest:FCP",
];

// The kinds a batch can complete, and the Harvest objects each needs.
export const ONTAP_KIND_SOURCES: ReadonlyArray<
  [string, ReadonlyArray<HarvestObject>]
> = KIND_SOURCES;

// What one batch remembers between its datapoints, for finishOntapBatch.
interface OntapBatch {
  listedObjects: Set<HarvestObject>;
}

const batches: WeakMap<StorageArraySnapshotBufferEntry, OntapBatch> =
  new WeakMap();

function getBatch(array: StorageArraySnapshotBufferEntry): OntapBatch {
  let batch: OntapBatch | undefined = batches.get(array);
  if (!batch) {
    batch = { listedObjects: new Set<HarvestObject>() };
    batches.set(array, batch);
  }
  return batch;
}

const OPEN_PROBLEMS: ReadonlyMap<string, StorageArrayOpenProblemSeries> =
  new Map<string, StorageArrayOpenProblemSeries>(
    (NetAppOntapPlatform.overview.openProblems || []).map(
      (
        problem: StorageArrayOpenProblemSeries,
      ): [string, StorageArrayOpenProblemSeries] => {
        return [problem.metricName, problem];
      },
    ),
  );

function nonNegative(value: number): number {
  return Math.max(0, value);
}

function wholeBytes(value: number): number {
  return Math.max(0, Math.trunc(value));
}

// "NetApp Release 9.16.1P3: Tue Oct 21 ..." -> "9.16.1P3".
export function parseOntapVersion(full: string | null): string | null {
  if (!full) {
    return null;
  }
  const match: RegExpMatchArray | null = full.match(
    /Release\s+([0-9][0-9A-Za-z.]*)/,
  );
  if (match && match[1]) {
    return match[1];
  }
  // A release written bare, such as 9.16.1P3.
  const bareRelease: RegExp = /^[0-9][0-9A-Za-z.]*$/;
  const bare: string = full.trim();
  return bareRelease.test(bare) ? bare : null;
}

// Whether a cluster's name is an Amazon FSx for NetApp ONTAP file system's.
export function isFsxClusterName(name: string | null | undefined): boolean {
  return Boolean(name && ONTAP_FSX_CLUSTER_NAME.test(name.trim()));
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

// ---------------- Harvest's own: which objects it listed ----------------

function markListed(series: StorageArraySeries, object: HarvestObject): void {
  const batch: OntapBatch = getBatch(series.array);
  batch.listedObjects.add(object);
  if (object === OPEN_PROBLEMS_SOURCE) {
    series.array.sawAlerts = true;
  }
}

/*
 * The kinds whose every source Harvest listed in this batch: their count
 * is written (0 for one with nothing). Worked out once the batch is
 * folded, when the cluster's name says whether it is an FSx file system:
 * Harvest's metadata series, which say what it listed, carry no cluster.
 */
function markCompleteKinds(array: StorageArraySnapshotBufferEntry): void {
  const batch: OntapBatch | undefined = batches.get(array);
  if (!batch) {
    return;
  }
  const isFsx: boolean = isFsxClusterName(array.reportedName);
  for (const [kind, sources] of KIND_SOURCES) {
    const needed: Array<HarvestObject> = sources.filter(
      (source: HarvestObject): boolean => {
        return !isFsx || !FSX_ABSENT_OBJECTS.includes(source);
      },
    );
    if (
      needed.every((source: HarvestObject): boolean => {
        return batch.listedObjects.has(source);
      })
    ) {
      markStorageArrayKindComplete(array, kind);
    }
  }
}

function readCollectorInstances(series: StorageArraySeries): void {
  const collector: string | null = series.label("collector");
  const object: string | null = series.label("object");
  const task: string | null = series.label("task");
  if (!collector || !object || (task && task !== "data")) {
    return;
  }
  markListed(series, `${collector}:${object}`);
}

function readComponentStatus(series: StorageArraySeries): void {
  if (series.label("type") !== "collector") {
    return;
  }
  const collector: string | null = series.label("name");
  const object: string | null = series.label("target");
  const reason: string = (series.label("reason") || "").toLowerCase();
  // Standby with nothing to list: a cluster with no LUNs, no SnapMirror.
  if (
    collector &&
    object &&
    series.value === 1 &&
    reason.includes("no instances")
  ) {
    markListed(series, `${collector}:${object}`);
  }
}

// ---------------- The open problems ONTAP reports ----------------

function readOpenProblem(
  series: StorageArraySeries,
  problem: StorageArrayOpenProblemSeries,
): void {
  // The poll after a problem clears exports it once more, as 0.
  if (series.value < 1) {
    return;
  }
  const array: StorageArraySnapshotBufferEntry = series.array;
  const key: string = [
    problem.metricName,
    ...problem.keyLabels.map((label: string): string => {
      return series.label(label) || "";
    }),
  ].join("|");
  array.openAlertKeys.add(key);
  const severity: string = (
    (problem.severityLabel && series.label(problem.severityLabel)) ||
    ""
  ).toLowerCase();
  if (problem.criticalSeverities.includes(severity)) {
    array.criticalAlertKeys.add(key);
  } else {
    array.warningAlertKeys.add(key);
  }

  // A node that cannot take over its partner says why on its row.
  if (problem.metricName === "netapp_health_ha_alerts") {
    const node: string | null = series.label("node");
    if (node) {
      fold(
        series,
        StorageArrayResourceKind.Controller,
        node,
        (row: StorageArrayResourceBufferEntry) => {
          row.name = node;
          row.details["takeoverPossible"] = false;
          const state: string | null = series.label("state_description");
          if (state) {
            row.details["haState"] = state;
          }
        },
      );
    }
  }
}

// ---------------- Nodes ----------------

function readNode(series: StorageArraySeries): void {
  const node: string | null = series.label("node");
  if (!node) {
    return;
  }
  const metricName: string = series.metricName;
  fold(
    series,
    StorageArrayResourceKind.Controller,
    node,
    (row: StorageArrayResourceBufferEntry) => {
      row.name = node;
      row.componentType = "Node";
      if (metricName === "netapp_node_labels") {
        row.model = series.label("model");
        row.firmwareVersion = parseOntapVersion(series.label("version"));
        const partner: string | null = series.label("ha_partner");
        if (partner) {
          row.details["haPartner"] = partner;
        }
        const serial: string | null = series.label("serial");
        if (serial) {
          row.details["serial"] = serial;
        }
        const location: string | null = series.label("location");
        if (location) {
          row.details["location"] = location;
        }
        const warnings: string | null = series.label("warnings");
        if (warnings) {
          row.details["warnings"] = warnings;
        }
        const array: StorageArraySnapshotBufferEntry = series.array;
        array.osVersion = array.osVersion || row.firmwareVersion;
      } else if (metricName === "netapp_node_new_status") {
        row.details["healthy"] = series.value >= 1;
      } else if (metricName === "netapp_node_avg_processor_busy") {
        row.details["cpuBusyPercent"] = nonNegative(series.value);
      } else if (metricName === "netapp_node_failed_fan") {
        row.details["failedFans"] = wholeBytes(series.value);
      } else if (metricName === "netapp_node_failed_power") {
        row.details["failedPowerSupplies"] = wholeBytes(series.value);
      } else if (metricName === "netapp_node_uptime") {
        row.details["uptimeSeconds"] = wholeBytes(series.value);
      }
    },
  );
}

// ---------------- Aggregates ----------------

function readAggregate(series: StorageArraySeries): void {
  const aggr: string | null = series.label("aggr");
  if (!aggr) {
    return;
  }
  const metricName: string = series.metricName;
  fold(
    series,
    OntapKind.Aggregate,
    aggr,
    (row: StorageArrayResourceBufferEntry) => {
      row.name = aggr;
      row.groupName = series.label("node");
      switch (metricName) {
        case "netapp_aggr_labels": {
          // ONTAP names a disk type in lowercase (ssd, fsas): as on its disks.
          row.componentType = series.label("type")?.toUpperCase() || null;
          const state: string | null = series.label("state");
          if (state) {
            row.details["state"] = state.toLowerCase();
          }
          const encrypted: string | null = series.label("is_encrypted");
          if (encrypted) {
            row.details["isEncrypted"] = encrypted === "true";
          }
          return;
        }
        case "netapp_aggr_new_status":
          row.details["online"] = series.value >= 1;
          return;
        case "netapp_aggr_space_total":
          row.capacityBytes = wholeBytes(series.value);
          return;
        case "netapp_aggr_space_used":
          row.usedBytes = wholeBytes(series.value);
          return;
        case "netapp_aggr_space_available":
          row.details["availableBytes"] = wholeBytes(series.value);
          return;
        case "netapp_aggr_inode_used_percent":
          row.details["inodeUsedPercent"] = nonNegative(series.value);
          return;
        case "netapp_aggr_logical_used_wo_snapshots_flexclones":
          row.details["logicalUsedBytes"] = wholeBytes(series.value);
          return;
        case "netapp_aggr_physical_used_wo_snapshots_flexclones":
          row.details["physicalUsedBytes"] = wholeBytes(series.value);
          return;
        case "netapp_aggr_read_latency":
          row.readLatencyUsec = nonNegative(series.value);
          return;
        case "netapp_aggr_write_latency":
          row.writeLatencyUsec = nonNegative(series.value);
          return;
        case "netapp_aggr_read_ops":
          row.readIops = nonNegative(series.value);
          return;
        case "netapp_aggr_write_ops":
          row.writeIops = nonNegative(series.value);
          return;
        case "netapp_aggr_read_data":
          row.readBytesPerSec = nonNegative(series.value);
          return;
        case "netapp_aggr_write_data":
          row.writeBytesPerSec = nonNegative(series.value);
          return;
        default:
          return;
      }
    },
  );
}

// ---------------- SVMs ----------------

function readSvm(series: StorageArraySeries): void {
  const svm: string | null = series.label("svm");
  if (!svm) {
    return;
  }
  const metricName: string = series.metricName;
  fold(series, OntapKind.Svm, svm, (row: StorageArrayResourceBufferEntry) => {
    row.name = svm;
    switch (metricName) {
      case "netapp_svm_labels": {
        const type: string | null = series.label("type");
        row.componentType = type;
        if (type) {
          row.details["svmType"] = type.toLowerCase();
        }
        const state: string | null = series.label("state");
        if (state) {
          row.details["state"] = state.toLowerCase();
        }
        const protocols: Array<string> = [];
        if (series.label("nfs_protocol_enabled") === "true") {
          protocols.push("NFS");
        }
        if (series.label("cifs_protocol_enabled") === "true") {
          protocols.push("SMB");
        }
        if (series.label("iscsi_service_enabled") === "true") {
          protocols.push("iSCSI");
        }
        if (protocols.length > 0) {
          row.details["protocols"] = protocols.join(", ");
        }
        return;
      }
      case "netapp_svm_new_status":
        row.details["running"] = series.value >= 1;
        return;
      case "netapp_svm_vol_read_latency":
        row.readLatencyUsec = nonNegative(series.value);
        return;
      case "netapp_svm_vol_write_latency":
        row.writeLatencyUsec = nonNegative(series.value);
        return;
      case "netapp_svm_vol_read_ops":
        row.readIops = nonNegative(series.value);
        return;
      case "netapp_svm_vol_write_ops":
        row.writeIops = nonNegative(series.value);
        return;
      case "netapp_svm_vol_read_data":
        row.readBytesPerSec = nonNegative(series.value);
        return;
      case "netapp_svm_vol_write_data":
        row.writeBytesPerSec = nonNegative(series.value);
        return;
      default:
        return;
    }
  });
}

// ---------------- Volumes ----------------

// "aggr1_n01" or, for a FlexGroup, "aggr1_n01,aggr1_n02".
function firstOf(list: string | null): string | null {
  if (!list) {
    return null;
  }
  return list.split(",")[0]?.trim() || null;
}

function readVolume(series: StorageArraySeries): void {
  const volume: string | null = series.label("volume");
  const svm: string | null = series.label("svm");
  if (!volume || !svm) {
    return;
  }
  const metricName: string = series.metricName;
  fold(
    series,
    StorageArrayResourceKind.Volume,
    `${svm}:${volume}`,
    (row: StorageArrayResourceBufferEntry) => {
      row.name = volume;
      row.groupName = svm;
      const aggregate: string | null = series.label("aggr");
      if (aggregate) {
        row.details["aggregate"] = aggregate;
      }
      const node: string | null = firstOf(series.label("node"));
      if (node) {
        row.details["node"] = node;
      }
      const style: string | null = series.label("style");
      if (style) {
        row.details["style"] = style;
      }
      switch (metricName) {
        case "netapp_volume_labels": {
          row.componentType = series.label("type");
          const state: string | null = series.label("state");
          if (state) {
            row.details["state"] = state.toLowerCase();
          }
          const junction: string | null = series.label("junction_path");
          if (junction) {
            row.details["junctionPath"] = junction;
          }
          const policy: string | null = series.label("snapshot_policy");
          if (policy) {
            row.details["snapshotPolicy"] = policy;
          }
          const svmRoot: string | null = series.label("svm_root");
          if (svmRoot) {
            row.details["svmRoot"] = svmRoot === "true" || svmRoot === "Yes";
          }
          return;
        }
        case "netapp_volume_new_status":
          row.details["online"] = series.value >= 1;
          return;
        case "netapp_volume_size_total":
          row.capacityBytes = wholeBytes(series.value);
          return;
        case "netapp_volume_size_used":
          row.usedBytes = wholeBytes(series.value);
          return;
        case "netapp_volume_size_available":
          row.details["availableBytes"] = wholeBytes(series.value);
          return;
        case "netapp_volume_size_used_percent":
          row.details["usedPercent"] = nonNegative(series.value);
          return;
        case "netapp_volume_snapshots_size_used":
          row.details["snapshotUsedBytes"] = wholeBytes(series.value);
          return;
        case "netapp_volume_sis_total_saved_percent": {
          /*
           * The share deduplication and compression save: 60% saved is
           * 2.5:1. A volume saving nothing reads 1:1.
           */
          const saved: number = Math.min(99.99, nonNegative(series.value));
          row.dataReductionRatio = 100 / (100 - saved);
          return;
        }
        case "netapp_volume_read_latency":
          row.readLatencyUsec = nonNegative(series.value);
          return;
        case "netapp_volume_write_latency":
          row.writeLatencyUsec = nonNegative(series.value);
          return;
        case "netapp_volume_read_ops":
          row.readIops = nonNegative(series.value);
          return;
        case "netapp_volume_write_ops":
          row.writeIops = nonNegative(series.value);
          return;
        case "netapp_volume_read_data":
          row.readBytesPerSec = nonNegative(series.value);
          return;
        case "netapp_volume_write_data":
          row.writeBytesPerSec = nonNegative(series.value);
          return;
        default:
          return;
      }
    },
  );
}

// ---------------- LUNs ----------------

function readLun(series: StorageArraySeries): void {
  const lun: string | null = series.label("lun");
  const volume: string | null = series.label("volume");
  const svm: string | null = series.label("svm");
  if (!lun || !volume || !svm) {
    return;
  }
  const metricName: string = series.metricName;
  /*
   * KeyPerf names a LUN by its volume and its own name only, the Rest
   * collector by its qtree too: keyed by the first two, so both are one
   * row, and named with its qtree by the Rest collector's series.
   */
  fold(
    series,
    OntapKind.Lun,
    `${svm}:/vol/${volume}/${lun}`,
    (row: StorageArrayResourceBufferEntry) => {
      row.groupName = svm;
      row.details["lun"] = lun;
      row.details["volume"] = volume;
      const node: string | null = series.label("node");
      if (node) {
        row.details["node"] = node;
      }
      const isRest: boolean =
        metricName === "netapp_lun_labels" ||
        metricName === "netapp_lun_new_status" ||
        metricName === "netapp_lun_size" ||
        metricName === "netapp_lun_size_used";
      if (isRest) {
        const qtree: string | null = series.label("qtree");
        if (qtree) {
          row.details["qtree"] = qtree;
        }
        row.name = qtree
          ? `/vol/${volume}/${qtree}/${lun}`
          : `/vol/${volume}/${lun}`;
      }
      switch (metricName) {
        case "netapp_lun_labels": {
          const state: string | null = series.label("state");
          if (state) {
            row.details["state"] = state.toLowerCase();
          }
          const serial: string | null = series.label("serial_hex");
          if (serial) {
            row.details["serialHex"] = serial;
          }
          return;
        }
        case "netapp_lun_new_status":
          row.details["online"] = series.value >= 1;
          return;
        case "netapp_lun_size":
          row.capacityBytes = wholeBytes(series.value);
          return;
        case "netapp_lun_size_used":
          row.usedBytes = wholeBytes(series.value);
          return;
        case "netapp_lun_avg_read_latency":
          row.readLatencyUsec = nonNegative(series.value);
          return;
        case "netapp_lun_avg_write_latency":
          row.writeLatencyUsec = nonNegative(series.value);
          return;
        case "netapp_lun_read_ops":
          row.readIops = nonNegative(series.value);
          return;
        case "netapp_lun_write_ops":
          row.writeIops = nonNegative(series.value);
          return;
        case "netapp_lun_read_data":
          row.readBytesPerSec = nonNegative(series.value);
          return;
        case "netapp_lun_write_data":
          row.writeBytesPerSec = nonNegative(series.value);
          return;
        default:
          return;
      }
    },
  );
}

// ---------------- Disks ----------------

// "1.0.7" -> shelf 1.0, bay 7; a disk named otherwise has none.
export function parseDiskPlace(
  disk: string,
): { shelf: string; bay: string } | null {
  const match: RegExpMatchArray | null = disk.match(
    /^(\d+\.\d+)\.(\d+)(?:\.P\d+)?$/,
  );
  return match ? { shelf: match[1]!, bay: match[2]! } : null;
}

function readDisk(series: StorageArraySeries): void {
  const disk: string | null = series.label("disk");
  if (!disk) {
    return;
  }
  const metricName: string = series.metricName;
  fold(
    series,
    StorageArrayResourceKind.Drive,
    disk,
    (row: StorageArrayResourceBufferEntry) => {
      row.name = disk;
      if (metricName === "netapp_disk_labels") {
        row.model = series.label("model");
        row.componentType = series.label("type");
        const container: string | null = series.label("container_type");
        if (container) {
          row.details["containerType"] = container.toLowerCase();
        }
        /*
         * Harvest's `shelf` label is the shelf's UID; a disk's name is its
         * stack, shelf and bay (1.0.7: shelf 1.0, bay 7), as the Shelves
         * table names shelves.
         */
        const place: { shelf: string; bay: string } | null =
          parseDiskPlace(disk);
        const bay: string | null =
          series.label("shelf_bay") || place?.bay || null;
        if (place) {
          row.groupName = place.shelf;
        }
        if (place || bay) {
          row.details["shelfBay"] = [place?.shelf, bay]
            .filter(Boolean)
            .join(" / ");
        }
        const owner: string | null =
          series.label("owner_node") || series.label("node");
        if (owner) {
          row.details["ownerNode"] = owner;
        }
        const outage: string | null = series.label("outage");
        if (outage) {
          row.details["outage"] = outage;
        }
        const serial: string | null = series.label("serial_number");
        if (serial) {
          row.details["serial"] = serial;
        }
      } else if (metricName === "netapp_disk_new_status") {
        row.details["healthy"] = series.value >= 1;
      } else if (metricName === "netapp_disk_usable_size") {
        row.capacityBytes = wholeBytes(series.value);
      }
    },
  );
}

// ---------------- Shelves, their parts, the nodes' sensors ----------------

const SHELF_PARTS: ReadonlyArray<{
  family: string;
  idLabel: string;
  type: string;
  noun: string;
}> = [
  {
    family: "psu",
    idLabel: "psu_id",
    type: ONTAP_COMPONENT_TYPES.powerSupply,
    noun: "PSU",
  },
  {
    family: "fan",
    idLabel: "fan_id",
    type: ONTAP_COMPONENT_TYPES.fan,
    noun: "Fan",
  },
  {
    family: "temperature",
    idLabel: "sensor_id",
    type: ONTAP_COMPONENT_TYPES.temperatureSensor,
    noun: "Temperature",
  },
  {
    family: "voltage",
    idLabel: "sensor_id",
    type: ONTAP_COMPONENT_TYPES.voltageSensor,
    noun: "Voltage",
  },
  {
    family: "module",
    idLabel: "module_id",
    type: ONTAP_COMPONENT_TYPES.module,
    noun: "Module",
  },
  // A shelf's current sensors are Harvest's shelf_sensor.
  {
    family: "sensor",
    idLabel: "sensor_id",
    type: ONTAP_COMPONENT_TYPES.currentSensor,
    noun: "Current",
  },
];

function readShelf(series: StorageArraySeries): void {
  const shelf: string | null = series.label("shelf");
  if (!shelf) {
    return;
  }
  const metricName: string = series.metricName;

  // A shelf part: netapp_shelf_<family>_status / _labels / _reading.
  for (const part of SHELF_PARTS) {
    const prefix: string = `netapp_shelf_${part.family}_`;
    if (!metricName.startsWith(prefix)) {
      continue;
    }
    const id: string | null = series.label(part.idLabel);
    if (!id) {
      return;
    }
    const name: string = `${shelf} ${part.noun} ${id}`;
    fold(
      series,
      StorageArrayResourceKind.Hardware,
      name,
      (row: StorageArrayResourceBufferEntry) => {
        row.name = name;
        row.componentType = part.type;
        row.groupName = shelf;
        const location: string | null = series.label("location");
        if (location) {
          row.details["location"] = location;
        }
        if (metricName.endsWith("_labels")) {
          const status: string | null = series.label("status");
          if (status) {
            row.details["partStatus"] = status.toLowerCase();
          }
          const serial: string | null = series.label("serial");
          if (serial) {
            row.details["serial"] = serial;
          }
          const partType: string | null = series.label("type");
          if (partType) {
            row.model = partType;
          }
        } else if (metricName.endsWith("_status")) {
          row.details["normal"] = series.value >= 1;
        } else if (metricName === "netapp_shelf_temperature_reading") {
          row.temperatureCelsius = series.value;
        } else if (metricName.endsWith("_reading")) {
          row.details["reading"] = String(Math.round(series.value * 100) / 100);
        } else if (metricName === "netapp_shelf_fan_rpm") {
          row.details["rpm"] = nonNegative(series.value);
        }
      },
    );
    return;
  }

  fold(
    series,
    StorageArrayResourceKind.Hardware,
    shelf,
    (row: StorageArrayResourceBufferEntry) => {
      row.name = shelf;
      row.componentType = ONTAP_COMPONENT_TYPES.shelf;
      if (metricName === "netapp_shelf_labels") {
        row.model = series.label("model");
        const state: string | null = series.label("state");
        if (state) {
          row.details["state"] = state.toLowerCase();
        }
        const moduleType: string | null = series.label("module_type");
        if (moduleType) {
          row.details["moduleType"] = moduleType.toUpperCase();
        }
        const serial: string | null = series.label("serial_number");
        if (serial) {
          row.details["serial"] = serial;
        }
      } else if (metricName === "netapp_shelf_new_status") {
        row.details["online"] = series.value >= 1;
      } else if (metricName === "netapp_shelf_disk_count") {
        row.details["diskCount"] = wholeBytes(series.value);
      }
    },
  );
}

/*
 * A node sensor's threshold state as one word the status lists know: the
 * REST API spells it crit_low, the CLI crit-low, another release
 * critical_high, so any critical state is critical and any warning a
 * warning; normal stays normal and anything else is its own word.
 */
export function getSensorStatus(state: string): string {
  const word: string = state.trim().toLowerCase();
  if (word === "normal" || word === "ok") {
    return "normal";
  }
  if (word.includes("crit")) {
    return "critical";
  }
  /*
   * Past a warning line: the shared word for a part that needs a look.
   * "warning" is an alert's severity, which a FlashArray's Active Alerts
   * draws as a status (#11001: Pure's pages are as they were).
   */
  if (word.includes("warn")) {
    return "degraded";
  }
  if (word.includes("fail") || word.includes("fault")) {
    return "failed";
  }
  return word;
}

function readSensor(series: StorageArraySeries): void {
  const sensor: string | null = series.label("sensor");
  const node: string | null = series.label("node");
  if (!sensor || !node) {
    return;
  }
  const name: string = `${node} ${sensor}`;
  const metricName: string = series.metricName;
  fold(
    series,
    StorageArrayResourceKind.Hardware,
    name,
    (row: StorageArrayResourceBufferEntry) => {
      row.name = name;
      row.componentType = ONTAP_COMPONENT_TYPES.sensor;
      row.groupName = node;
      const type: string | null = series.label("type");
      if (type) {
        row.details["sensorType"] = type;
      }
      if (metricName === "netapp_environment_sensor_status") {
        // Harvest's 1 is a threshold state of normal; its label says which.
        const state: string | null =
          series.label("threshold_state") || series.label("discrete_state");
        row.status = state
          ? getSensorStatus(state)
          : series.value >= 1
            ? "normal"
            : null;
        if (state && row.status !== "normal") {
          row.details["thresholdState"] = state;
        }
      } else if (metricName === "netapp_environment_sensor_threshold_value") {
        const unit: string | null = series.label("unit");
        const value: string = String(Math.round(series.value * 100) / 100);
        row.details["reading"] = unit ? `${value} ${unit}` : value;
      }
    },
  );
}

// ---------------- Ports ----------------

function readEthernetPort(series: StorageArraySeries): void {
  const node: string | null = series.label("node");
  // NetPort names a port `port`; RestPerf's nic_common names it `nic`.
  const port: string | null = series.label("port") || series.label("nic");
  if (!node || !port) {
    return;
  }
  const metricName: string = series.metricName;
  const name: string = `${node}:${port}`;
  fold(
    series,
    StorageArrayResourceKind.NetworkInterface,
    name,
    (row: StorageArrayResourceBufferEntry) => {
      row.name = name;
      row.componentType = "Ethernet";
      row.groupName = node;
      switch (metricName) {
        case "netapp_net_port_status": {
          const adminUp: string | null = series.label("admin_up");
          const up: boolean = series.value >= 1;
          row.status = up ? "up" : adminUp === "false" ? "disabled" : "down";
          // op_speed is in Mb/s ("10000"), auto or nothing while down.
          const speed: number = Number(series.label("op_speed"));
          if (Number.isFinite(speed) && speed > 0) {
            row.details["speedBytesPerSec"] = (speed * 1000 * 1000) / 8;
          }
          const role: string | null = series.label("role");
          if (role) {
            row.details["services"] = role;
          }
          // physical, vlan or if_group (a LAG of physical ports).
          const portType: string | null = series.label("port_type");
          if (portType) {
            row.details["portType"] = portType;
          }
          return;
        }
        case "netapp_nic_rx_bytes":
          row.details["receivedBytesPerSec"] = nonNegative(series.value);
          return;
        case "netapp_nic_tx_bytes":
          row.details["transmittedBytesPerSec"] = nonNegative(series.value);
          return;
        case "netapp_nic_util_percent":
          row.details["utilizationPercent"] = nonNegative(series.value);
          return;
        case "netapp_nic_rx_total_errors":
          row.details["receiveErrors"] = nonNegative(series.value);
          return;
        case "netapp_nic_tx_total_errors":
          row.details["transmitErrors"] = nonNegative(series.value);
          return;
        default:
          return;
      }
    },
  );
}

// "32Gb" or "auto" (RestPerf's speed label) -> bytes per second.
function fcSpeedBytesPerSec(speed: string | null): number | null {
  const match: RegExpMatchArray | null = (speed || "").match(
    /^([0-9.]+)\s*(G|M)?b/i,
  );
  if (!match || !match[1]) {
    return null;
  }
  const value: number = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  const scale: number = (match[2] || "G").toUpperCase() === "M" ? 1e6 : 1e9;
  return (value * scale) / 8;
}

function readFcPort(series: StorageArraySeries): void {
  const node: string | null = series.label("node");
  const port: string | null = series.label("port");
  if (!node || !port) {
    return;
  }
  const metricName: string = series.metricName;
  const name: string = `${node}:${port}`;
  fold(
    series,
    StorageArrayResourceKind.NetworkInterface,
    name,
    (row: StorageArrayResourceBufferEntry) => {
      row.name = name;
      row.componentType = "Fibre Channel";
      row.groupName = node;
      const speed: number | null = fcSpeedBytesPerSec(series.label("speed"));
      if (speed !== null) {
        row.details["speedBytesPerSec"] = speed;
      }
      switch (metricName) {
        case "netapp_fcp_labels": {
          const state: string | null = series.label("state");
          const enabled: string | null = series.label("enabled");
          if (state) {
            row.status =
              state.toLowerCase() === "offlined_by_user" || enabled === "false"
                ? "disabled"
                : state.toLowerCase();
          }
          const fabric: string | null = series.label("fabric_name");
          if (fabric) {
            row.details["fabric"] = fabric;
          }
          row.details["services"] = "FC";
          return;
        }
        // The hosts' writes arrive through the port, their reads leave it.
        case "netapp_fcp_write_data":
          row.details["receivedBytesPerSec"] = nonNegative(series.value);
          return;
        case "netapp_fcp_read_data":
          row.details["transmittedBytesPerSec"] = nonNegative(series.value);
          return;
        case "netapp_fcp_util_percent":
          row.details["utilizationPercent"] = nonNegative(series.value);
          return;
        case "netapp_fcp_link_failure":
          row.details["linkFailures"] = nonNegative(series.value);
          return;
        default:
          return;
      }
    },
  );
}

// ---------------- SnapMirror ----------------

function readSnapMirror(series: StorageArraySeries): void {
  const id: string | null = series.label("relationship_id");
  const destination: string | null = series.label("destination_location");
  if (!id || !destination) {
    return;
  }
  const metricName: string = series.metricName;
  fold(
    series,
    OntapKind.SnapMirror,
    id,
    (row: StorageArrayResourceBufferEntry) => {
      row.name = destination;
      const source: string | null = series.label("source_location");
      if (source) {
        row.details["source"] = source;
      }
      const sourceCluster: string | null = series.label("source_cluster");
      if (sourceCluster) {
        row.details["sourceCluster"] = sourceCluster;
      }
      switch (metricName) {
        case "netapp_snapmirror_labels": {
          const healthy: string | null = series.label("healthy");
          row.status =
            healthy === "true"
              ? "healthy"
              : healthy === "false"
                ? "unhealthy"
                : null;
          row.statusDetail =
            healthy === "false" ? series.label("unhealthy_reason") : null;
          const schedule: string | null = series.label("schedule");
          if (schedule) {
            row.details["schedule"] = schedule;
          }
          for (const [label, key] of [
            ["relationship_state", "relationshipState"],
            ["relationship_status", "relationshipStatus"],
            ["policy_type", "policyType"],
            ["relationship_type", "relationshipType"],
          ] as Array<[string, string]>) {
            const value: string | null = series.label(label);
            if (value) {
              row.details[key] = value;
            }
          }
          return;
        }
        case "netapp_snapmirror_lag_time":
          row.replicationLagMs = nonNegative(series.value) * 1000;
          return;
        case "netapp_snapmirror_schedule_seconds":
          row.details["scheduleSeconds"] = nonNegative(series.value);
          return;
        case "netapp_snapmirror_last_transfer_size":
          row.details["lastTransferSizeBytes"] = wholeBytes(series.value);
          return;
        case "netapp_snapmirror_last_transfer_duration":
          row.details["lastTransferDurationSeconds"] = nonNegative(
            series.value,
          );
          return;
        default:
          return;
      }
    },
  );
}

// ---------------- One datapoint ----------------

function extractOntapSeries(series: StorageArraySeries): void {
  const metricName: string = series.metricName;
  const array: StorageArraySnapshotBufferEntry = series.array;

  // Every series names its cluster.
  const cluster: string | null = series.label("cluster");
  if (cluster && !array.reportedName) {
    array.reportedName = cluster;
    array.osName = isFsxClusterName(cluster)
      ? ONTAP_FSX_OS_NAME
      : ONTAP_OS_NAME;
  }

  if (metricName === "netapp_metadata_collector_instances") {
    readCollectorInstances(series);
    return;
  }
  if (metricName === "netapp_metadata_component_status") {
    readComponentStatus(series);
    return;
  }

  const problem: StorageArrayOpenProblemSeries | undefined =
    OPEN_PROBLEMS.get(metricName);
  if (problem) {
    readOpenProblem(series, problem);
    return;
  }

  if (metricName === "netapp_cluster_new_status") {
    return;
  }
  if (metricName.startsWith("netapp_cluster_")) {
    // KeyPerf keys the cluster by its uuid.
    array.systemId = array.systemId || series.label("uuid");
    return;
  }
  if (metricName.startsWith("netapp_node_")) {
    readNode(series);
    return;
  }
  if (metricName.startsWith("netapp_aggr_")) {
    readAggregate(series);
    return;
  }
  if (metricName.startsWith("netapp_svm_")) {
    readSvm(series);
    return;
  }
  if (metricName.startsWith("netapp_volume_")) {
    readVolume(series);
    return;
  }
  if (metricName.startsWith("netapp_lun_")) {
    readLun(series);
    return;
  }
  if (metricName.startsWith("netapp_disk_")) {
    readDisk(series);
    return;
  }
  if (metricName.startsWith("netapp_shelf_")) {
    readShelf(series);
    return;
  }
  if (metricName.startsWith("netapp_environment_sensor_")) {
    readSensor(series);
    return;
  }
  if (
    metricName.startsWith("netapp_net_port_") ||
    metricName.startsWith("netapp_nic_")
  ) {
    readEthernetPort(series);
    return;
  }
  if (metricName.startsWith("netapp_fcp_")) {
    readFcPort(series);
    return;
  }
  if (metricName.startsWith("netapp_snapmirror_")) {
    readSnapMirror(series);
  }
}

// ---------------- What the batch says together ----------------

function detail(row: StorageArrayResourceBufferEntry, key: string): JSONValue {
  return row.details[key];
}

function numberDetail(
  row: StorageArrayResourceBufferEntry,
  key: string,
): number | null {
  const value: JSONValue = detail(row, key);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringDetail(
  row: StorageArrayResourceBufferEntry,
  key: string,
): string | null {
  const value: JSONValue = detail(row, key);
  return typeof value === "string" && value ? value : null;
}

/*
 * A node's state: unhealthy when ONTAP says so, degraded while a fan or
 * power supply of it has failed, healthy otherwise.
 */
function finishNode(row: StorageArrayResourceBufferEntry): void {
  const healthy: JSONValue = detail(row, "healthy");
  if (healthy === undefined) {
    return;
  }
  if (healthy === false) {
    row.status = "unhealthy";
    return;
  }
  const failed: number =
    (numberDetail(row, "failedFans") || 0) +
    (numberDetail(row, "failedPowerSupplies") || 0);
  row.status = failed > 0 ? "degraded" : "healthy";
  const problems: string | null = getNodeProblems(
    stringDetail(row, "warnings"),
  );
  if (failed > 0 && problems) {
    row.statusDetail = problems;
    row.details["statusReason"] = problems;
  }
}

/*
 * What is wrong with a node, from the warnings label Harvest joins with
 * "; " out of its failed fans' message, its failed power supplies' message
 * and its over-temperature state: ONTAP words each even when all is well
 * ("There are no failed fans.", "normal"), so those are left out.
 */
export function getNodeProblems(warnings: string | null): string | null {
  if (!warnings) {
    return null;
  }
  const problems: Array<string> = warnings
    .split(";")
    .map((part: string): string => {
      return part.trim();
    })
    .filter((part: string): boolean => {
      const lower: string = part.toLowerCase();
      return (
        part !== "" &&
        lower !== "normal" &&
        lower !== "false" &&
        !lower.startsWith("there are no failed")
      );
    });
  return problems.length > 0 ? problems.join("; ") : null;
}

/*
 * An object's state: the word ONTAP wrote (its labels' state), else what
 * Harvest's number says.
 */
function finishState(
  row: StorageArrayResourceBufferEntry,
  flag: string,
  up: string,
  down: string,
): void {
  const state: string | null = stringDetail(row, "state");
  if (state) {
    row.status = state;
    return;
  }
  const value: JSONValue = detail(row, flag);
  if (value === true) {
    row.status = up;
  } else if (value === false) {
    row.status = down;
  }
}

function finishDisk(row: StorageArrayResourceBufferEntry): void {
  const container: string | null = stringDetail(row, "containerType");
  const healthy: JSONValue = detail(row, "healthy");
  if (container === "broken" || healthy === false) {
    row.status = "broken";
    row.statusDetail = stringDetail(row, "outage");
    if (row.statusDetail) {
      row.details["statusReason"] = row.statusDetail;
    }
    return;
  }
  if (container === "unassigned" || container === "spare") {
    row.status = container;
    return;
  }
  if (container || healthy === true) {
    row.status = "healthy";
  }
}

// A node sensor past its threshold says its reading, as ONTAP states it.
function finishSensor(row: StorageArrayResourceBufferEntry): void {
  const state: string | null = stringDetail(row, "thresholdState");
  if (!state) {
    return;
  }
  const reading: string | null = stringDetail(row, "reading");
  row.details["statusReason"] = reading ? `${state}, ${reading}` : state;
}

function finishSnapMirror(row: StorageArrayResourceBufferEntry): void {
  if (row.status === "unhealthy" && row.statusDetail) {
    row.details["statusReason"] = row.statusDetail;
  }
}

function finishShelfPart(row: StorageArrayResourceBufferEntry): void {
  const status: string | null = stringDetail(row, "partStatus");
  if (status) {
    row.status = status;
    return;
  }
  const normal: JSONValue = detail(row, "normal");
  if (normal === true) {
    row.status = "normal";
  } else if (normal === false) {
    row.status = "error";
  }
}

function finishPort(row: StorageArrayResourceBufferEntry): void {
  const received: number = numberDetail(row, "receiveErrors") || 0;
  const transmitted: number = numberDetail(row, "transmitErrors") || 0;
  const linkFailures: number = numberDetail(row, "linkFailures") || 0;
  /*
   * Harvest counts errors since its previous poll (one minute): per
   * second, as the shared Errors column reads them.
   */
  if (
    detail(row, "receiveErrors") !== undefined ||
    detail(row, "transmitErrors") !== undefined ||
    detail(row, "linkFailures") !== undefined
  ) {
    row.details["errorsPerSec"] = (received + transmitted + linkFailures) / 60;
  }
}

/*
 * The cluster's capacity is its data aggregates' (Harvest leaves out root
 * aggregates), summed: their size, their used space, and their data
 * reduction (logical over physical, snapshots and FlexClones not counted).
 */
function finishCapacity(
  rows: Array<StorageArrayResourceBufferEntry>,
  array: StorageArraySnapshotBufferEntry,
): void {
  let capacity: number = 0;
  let used: number = 0;
  let logical: number = 0;
  let physical: number = 0;
  let sawCapacity: boolean = false;
  let sawUsed: boolean = false;
  for (const row of rows) {
    if (row.kind !== OntapKind.Aggregate) {
      continue;
    }
    if (row.capacityBytes !== null) {
      capacity += row.capacityBytes;
      sawCapacity = true;
    }
    if (row.usedBytes !== null) {
      used += row.usedBytes;
      sawUsed = true;
    }
    const rowLogical: number | null = numberDetail(row, "logicalUsedBytes");
    const rowPhysical: number | null = numberDetail(row, "physicalUsedBytes");
    if (rowLogical !== null && rowPhysical !== null && rowPhysical > 0) {
      logical += rowLogical;
      physical += rowPhysical;
      row.dataReductionRatio = rowLogical / rowPhysical;
    }
  }
  if (sawCapacity) {
    array.capacityBytes = capacity;
    if (sawUsed) {
      array.emptyBytes = Math.max(0, capacity - used);
      array.utilizationPercent = capacity > 0 ? (used / capacity) * 100 : 0;
    }
  }
  if (physical > 0) {
    array.dataReductionRatio = logical / physical;
  }
}

export function finishOntapBatch(data: {
  rows: Array<StorageArrayResourceBufferEntry>;
  array: StorageArraySnapshotBufferEntry;
}): Array<StorageArrayResourceBufferEntry> {
  const rows: Array<StorageArrayResourceBufferEntry> = data.rows.filter(
    (row: StorageArrayResourceBufferEntry): boolean => {
      // The SVMs ONTAP keeps for itself hold no one's data.
      if (row.kind === OntapKind.Svm) {
        const type: string | null = stringDetail(row, "svmType");
        return !type || !SYSTEM_SVM_TYPES.includes(type);
      }
      return true;
    },
  );

  for (const row of rows) {
    switch (row.kind) {
      case StorageArrayResourceKind.Controller:
        finishNode(row);
        break;
      case OntapKind.Aggregate:
        finishState(row, "online", "online", "offline");
        break;
      case OntapKind.Svm:
        finishState(row, "running", "running", "stopped");
        break;
      case StorageArrayResourceKind.Volume:
        finishState(row, "online", "online", "offline");
        break;
      case OntapKind.Lun:
        finishState(row, "online", "online", "offline");
        break;
      case StorageArrayResourceKind.Drive:
        finishDisk(row);
        break;
      case StorageArrayResourceKind.Hardware:
        if (row.componentType === ONTAP_COMPONENT_TYPES.shelf) {
          finishState(row, "online", "online", "offline");
        } else if (row.componentType === ONTAP_COMPONENT_TYPES.sensor) {
          finishSensor(row);
        } else {
          finishShelfPart(row);
        }
        break;
      case OntapKind.SnapMirror:
        finishSnapMirror(row);
        break;
      case StorageArrayResourceKind.NetworkInterface:
        finishPort(row);
        break;
      default:
        break;
    }
  }

  finishCapacity(rows, data.array);
  markCompleteKinds(data.array);
  return rows;
}

const OntapExtractor: StorageArrayExtractor = {
  storageSystem: NetAppOntapPlatform.storageSystem,
  extract: extractOntapSeries,
  finishBatch: finishOntapBatch,
};

export default OntapExtractor;
