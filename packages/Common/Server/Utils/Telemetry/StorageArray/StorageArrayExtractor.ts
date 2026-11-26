import { JSONArray, JSONObject } from "../../../../Types/JSON";
import StorageArrayResourceKind from "../../../../Types/StorageArray/StorageArrayResourceKind";
import { StorageArrayPlatform } from "../../../../Types/StorageArray/StorageArrayPlatform";

/*
 * ONE PLATFORM'S EXTRACTOR: HOW ONE OF ITS DATAPOINTS BECOMES INVENTORY ROWS
 * AND SNAPSHOT STATE (#11000).
 *
 * The scan (StorageArraySnapshotScan) owns everything that is the same for
 * every platform: it reads the datapoint (a staleness marker or a value that
 * is not a finite number is skipped), picks the platform it belongs to
 * (StorageArrayExtractors.resolve), and folds and derives what the
 * extractors produce. An extractor owns only its platform's metric names
 * and labels: which object a series names, which column a value fills, which
 * kind's complete list a batch carried.
 *
 * Writing one for a new platform: implement StorageArrayExtractor in
 * StorageArray/<Vendor>/, read each metric its platform lists in
 * StorageArrayPlatform.snapshotMetricNames, and add it to
 * StorageArrayExtractors.ts. For each series:
 *
 *   - an object it names: series.newResource(kind, its name), fill the
 *     columns the series carries, series.fold(row) - the scan merges every
 *     series of one object (identity first-non-null-wins, metrics
 *     newest-observedAt-wins);
 *   - a series that lists every object of a kind (an endpoint's inventory):
 *     markStorageArrayKindComplete(series.array, kind), so the kind's count
 *     is written - and written 0 once its last object is deleted;
 *   - the array itself (its name, capacity, open alerts) on series.array;
 *   - a host's connection to a volume: recordHostVolumeConnection.
 *
 * This module imports nothing from the scan or the extractors, so an
 * extractor can import it without closing an import cycle.
 */

/*
 * One object of an array (volume, host, pod, hardware component, ...)
 * folded across a batch. Same merge semantics as CephResourceBufferEntry.
 */
export interface StorageArrayResourceBufferEntry {
  kind: string;
  externalId: string;
  name: string | null;
  status: string | null;
  statusDetail: string | null;
  componentType: string | null;
  model: string | null;
  firmwareVersion: string | null;
  groupName: string | null;
  capacityBytes: number | null;
  usedBytes: number | null;
  dataReductionRatio: number | null;
  readLatencyUsec: number | null;
  writeLatencyUsec: number | null;
  readIops: number | null;
  writeIops: number | null;
  readBytesPerSec: number | null;
  writeBytesPerSec: number | null;
  temperatureCelsius: number | null;
  replicationLagMs: number | null;
  connectionCount: number | null;
  details: JSONObject;
  observedAt: Date;
  /*
   * True for a Volume row getStorageArrayResourceRows synthesized from a
   * host's connections alone: it exists to carry connectionCount to a
   * volume the batch never reported through its own series, so it is
   * upserted (every other column COALESCEs) but never counted - a volume
   * count comes only from the volumes' own series.
   */
  fromConnectionsOnly?: boolean | undefined;
}

// Per-array snapshot state - same saw* contract as the Ceph cluster buffer.
export interface StorageArraySnapshotBufferEntry {
  // The platform of the series the batch carried.
  storageSystem: string | null;
  reportedName: string | null;
  systemId: string | null;
  osName: string | null;
  osVersion: string | null;
  /*
   * The batch carried an open-alert series, or the array endpoint itself
   * (its space series, or a `scrape_endpoint` label naming it). An array
   * with no open alerts exports no open-alert series at all, so seeing the
   * array endpoint is what lets the counts fall back to 0.
   */
  sawAlerts: boolean;
  // Alert identity keys, so a batch that holds two scrapes counts each once.
  openAlertKeys: Set<string>;
  criticalAlertKeys: Set<string>;
  warningAlertKeys: Set<string>;
  capacityBytes: number | null;
  emptyBytes: number | null;
  utilizationPercent: number | null;
  dataReductionRatio: number | null;
  /*
   * The kinds whose complete list the batch carried: their count in
   * StorageArray.countsByKind is written, 0 for a kind with no object.
   * markStorageArrayKindComplete sets it, and the saw* flag below of a kind
   * that has one.
   */
  completeKinds: Set<string>;
  /*
   * The kinds the StorageArray row keeps a column for, and the hardware
   * health reads (the derive's never-zero-on-a-partial-batch contract).
   */
  sawHardware: boolean;
  sawDrives: boolean;
  sawControllers: boolean;
  sawVolumes: boolean;
  sawHosts: boolean;
  sawPods: boolean;
  sawFileSystems: boolean;
  sawBuckets: boolean;
  // Each host's connected volumes, and each volume's hosts.
  volumesByHost: Map<string, Set<string>>;
  hostsByVolume: Map<string, Set<string>>;
  connectionsObservedAt: Date | null;
}

/*
 * One datapoint of a metric, read: what an extractor is handed. Its value
 * is a finite number and its time a valid Date; the scan has skipped
 * everything else.
 */
export interface StorageArraySeries {
  metricName: string;
  value: number;
  observedAt: Date;
  // A datapoint label, trimmed; null when absent or blank.
  label: (key: string) => string | null;
  // The datapoint's raw attributes, to key an object by several labels.
  attributes: JSONArray;
  // What the batch says about the array itself.
  array: StorageArraySnapshotBufferEntry;
  // An empty inventory row of `kind`, named `externalId`, seen now.
  newResource: (
    kind: string,
    externalId: string,
  ) => StorageArrayResourceBufferEntry;
  // Merge a row into the batch's inventory of the array.
  fold: (patch: StorageArrayResourceBufferEntry) => void;
}

export interface StorageArrayExtractor {
  // The platform it reads for: its StorageArrayPlatform.storageSystem.
  storageSystem: string;
  extract: (series: StorageArraySeries) => void;
}

export function emptyStorageArrayResourceEntry(
  kind: string,
  externalId: string,
  observedAt: Date,
): StorageArrayResourceBufferEntry {
  return {
    kind,
    externalId,
    name: null,
    status: null,
    statusDetail: null,
    componentType: null,
    model: null,
    firmwareVersion: null,
    groupName: null,
    capacityBytes: null,
    usedBytes: null,
    dataReductionRatio: null,
    readLatencyUsec: null,
    writeLatencyUsec: null,
    readIops: null,
    writeIops: null,
    readBytesPerSec: null,
    writeBytesPerSec: null,
    temperatureCelsius: null,
    replicationLagMs: null,
    connectionCount: null,
    details: {},
    observedAt,
  };
}

export function getOrCreateStorageArraySnapshot(
  buffer: Map<string, StorageArraySnapshotBufferEntry>,
  arrayIdStr: string,
): StorageArraySnapshotBufferEntry {
  let entry: StorageArraySnapshotBufferEntry | undefined =
    buffer.get(arrayIdStr);
  if (!entry) {
    entry = {
      storageSystem: null,
      reportedName: null,
      systemId: null,
      osName: null,
      osVersion: null,
      sawAlerts: false,
      openAlertKeys: new Set(),
      criticalAlertKeys: new Set(),
      warningAlertKeys: new Set(),
      capacityBytes: null,
      emptyBytes: null,
      utilizationPercent: null,
      dataReductionRatio: null,
      completeKinds: new Set(),
      sawHardware: false,
      sawDrives: false,
      sawControllers: false,
      sawVolumes: false,
      sawHosts: false,
      sawPods: false,
      sawFileSystems: false,
      sawBuckets: false,
      volumesByHost: new Map(),
      hostsByVolume: new Map(),
      connectionsObservedAt: null,
    };
    buffer.set(arrayIdStr, entry);
  }
  return entry;
}

/*
 * The batch carried the complete list of `kind`: its count is written, and
 * the snapshot's column flag of a kind that has one is set with it.
 */
export function markStorageArrayKindComplete(
  array: StorageArraySnapshotBufferEntry,
  kind: string,
): void {
  array.completeKinds.add(kind);
  switch (kind) {
    case StorageArrayResourceKind.Volume:
      array.sawVolumes = true;
      return;
    case StorageArrayResourceKind.Host:
      array.sawHosts = true;
      return;
    case StorageArrayResourceKind.Pod:
      array.sawPods = true;
      return;
    case StorageArrayResourceKind.FileSystem:
      array.sawFileSystems = true;
      return;
    case StorageArrayResourceKind.Bucket:
      array.sawBuckets = true;
      return;
    case StorageArrayResourceKind.Hardware:
      array.sawHardware = true;
      return;
    case StorageArrayResourceKind.Drive:
      array.sawDrives = true;
      return;
    case StorageArrayResourceKind.Controller:
      array.sawControllers = true;
      return;
    default:
      return;
  }
}

/*
 * A host's connection to a volume (a LUN mapping). A host with no volume
 * connected still counts, as zero.
 */
export function recordHostVolumeConnection(
  array: StorageArraySnapshotBufferEntry,
  data: { host: string; volume: string | null; observedAt: Date },
): void {
  if (data.volume) {
    addToSet(array.volumesByHost, data.host, data.volume);
    addToSet(array.hostsByVolume, data.volume, data.host);
  } else if (!array.volumesByHost.has(data.host)) {
    array.volumesByHost.set(data.host, new Set());
  }
  if (
    !array.connectionsObservedAt ||
    data.observedAt > array.connectionsObservedAt
  ) {
    array.connectionsObservedAt = data.observedAt;
  }
}

function addToSet(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  let set: Set<string> | undefined = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

/*
 * The OneUptime Storage Array Agent labels every series with the scrape job
 * that read it (static_configs labels: `scrape_endpoint: volumes`). An
 * extractor reads it off the identity series every endpoint exports, which
 * says which kinds the batch is the COMPLETE list of - how an array whose
 * last volume was just deleted reports 0 instead of keeping the old count
 * forever. Custom collector configs without the label fall back to
 * inferring it from the series a batch carried.
 */
export const SCRAPE_ENDPOINT_LABEL: string = "scrape_endpoint";

/*
 * What a `scrape_endpoint` value says about a batch of `platform`: the kinds
 * its endpoint lists (StorageArrayPlatform.scrapeEndpoints) are complete;
 * `array` (and `all` or `metrics`, one job scraping everything) means the
 * array's own endpoint was read, so its open alerts are complete too. `all`
 * completes only the kinds the platform's endpoints list, never a kind the
 * platform does not report.
 */
export function markScrapedEndpoint(
  array: StorageArraySnapshotBufferEntry,
  endpoint: string | null,
  platform: StorageArrayPlatform,
): void {
  if (!endpoint) {
    return;
  }
  const value: string = endpoint.trim().toLowerCase();
  const all: boolean = value === "all" || value === "metrics";
  if (all || value === "array") {
    array.sawAlerts = true;
  }
  for (const [name, kinds] of Object.entries(platform.scrapeEndpoints)) {
    if (all || value === name) {
      for (const kind of kinds) {
        markStorageArrayKindComplete(array, kind);
      }
    }
  }
}
