import {
  SCRAPE_ENDPOINT_LABEL,
  STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES,
  StorageArrayHealthStatus,
  StorageArrayResourceBufferEntry,
  StorageArraySnapshotBufferEntry,
  StorageArraySnapshotDerivedExtras,
  bufferStorageArraySnapshotMetric,
  deriveStorageArraySnapshotExtras,
  emptyStorageArrayResourceEntry,
  foldStorageArrayResourceSnapshot,
  getConnectedVolumeNames,
  getVolumeConnectionCounts,
  getOrCreateStorageArraySnapshot,
  getStorageArrayResourceRows,
  isCriticalComponentStatus,
  isUnhealthyComponentStatus,
  resolveStorageArraySystem,
} from "../../../../Server/Utils/Telemetry/StorageArraySnapshotScan";
import logger from "../../../../Server/Utils/Logger";
import StorageArrayResourceKind from "../../../../Types/StorageArray/StorageArrayResourceKind";
import StorageSystem from "../../../../Types/StorageArray/StorageSystem";
import { JSONObject } from "../../../../Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The storage array snapshot scan, fed with synthetic OTLP datapoints in the
 * exact JSON shape the prometheus receiver emits through the OTLP decode
 * (asDouble / asInt + timeUnixNano + a raw key/stringValue attribute array).
 *
 * Every series below carries ONLY label names Pure's exporters declare for
 * it (pure-fa-openmetrics-exporter / pure-fb-openmetrics-exporter, which the
 * native Purity//FA endpoint mirrors) — dp() refuses anything else — plus
 * the agent's own `scrape_endpoint` label. Locks in:
 *
 *   - identity from purefa_info / purefb_info, the platform from the prefix,
 *   - capacity / used / percent / data-reduction derivation and rounding,
 *   - alert counting (hidden excluded, de-duplicated, 0 when the array
 *     endpoint was seen with no alert series),
 *   - the scrape_endpoint contract (a complete endpoint drops its count to
 *     0; a partial batch never zeroes a count),
 *   - every inventory kind's column mapping, the connection counts, the
 *     worst-replica-link rule, and the fold's merge semantics,
 *   - malformed datapoints skipped safely.
 */

const ARRAY: string = "5a7e0000-0000-4000-8000-000000000001";
const OTHER_ARRAY: string = "5a7e0000-0000-4000-8000-000000000002";

// 2023-11-14T22:13:20.000Z — an arbitrary fixed scrape instant.
const BASE_MS: number = 1700000000000;

const MIB: number = 1024 * 1024;
const TIB: number = 1024 * 1024 * 1024 * 1024;

type LabelMap = Record<string, string>;

const PERF_FA_VOLUME: Array<string> = ["naa_id", "name", "dimension"];
const SPACE_FA_VOLUME: Array<string> = [
  "naa_id",
  "name",
  "pod",
  "volume_group",
];

/*
 * The label names of every family the scan reads, exactly as the exporters'
 * prometheus.NewDesc calls declare them.
 */
const PURE_LABELS: Record<string, Array<string>> = {
  purefa_info: [
    "array_name",
    "os",
    "subscription_type",
    "system_id",
    "version",
  ],
  purefa_alerts_open: [
    "category",
    "code",
    "component_type",
    "created",
    "issue",
    "name",
    "severity",
    "summary",
  ],
  purefa_array_space_bytes: ["space"],
  purefa_array_space_utilization: [],
  purefa_array_space_data_reduction_ratio: [],
  purefa_hw_component_status: [
    "component_name",
    "component_type",
    "component_status",
  ],
  purefa_hw_component_temperature_celsius: ["component_name", "component_type"],
  purefa_drive_capacity_bytes: [
    "component_name",
    "component_type",
    "component_status",
    "component_protocol",
  ],
  purefa_hw_controller_info: [
    "mode",
    "model",
    "name",
    "status",
    "type",
    "version",
  ],
  purefa_network_interface_speed_bandwidth_bytes: [
    "enabled",
    "ethsubtype",
    "name",
    "services",
    "type",
  ],
  purefa_network_interface_performance_bandwidth_bytes: [
    "name",
    "dimension",
    "type",
  ],
  purefa_network_interface_performance_errors: ["name", "dimension", "type"],
  purefa_volume_space_bytes: [...SPACE_FA_VOLUME, "space"],
  purefa_volume_space_data_reduction_ratio: SPACE_FA_VOLUME,
  purefa_volume_performance_latency_usec: PERF_FA_VOLUME,
  purefa_volume_performance_throughput_iops: PERF_FA_VOLUME,
  purefa_volume_performance_bandwidth_bytes: PERF_FA_VOLUME,
  purefa_volume_qos_iops_limit: SPACE_FA_VOLUME,
  purefa_volume_qos_bandwidth_bytes_per_sec_limit: SPACE_FA_VOLUME,
  purefa_host_connectivity_info: ["host", "details", "status"],
  purefa_host_connections_info: ["host", "hostgroup", "volume"],
  purefa_host_space_bytes: ["host", "space"],
  purefa_host_space_data_reduction_ratio: ["host"],
  purefa_host_performance_latency_usec: ["host", "dimension"],
  purefa_host_performance_throughput_iops: ["host", "dimension"],
  purefa_host_performance_bandwidth_bytes: ["host", "dimension"],
  purefa_pod_space_bytes: ["name", "space"],
  purefa_pod_space_data_reduction_ratio: ["name"],
  purefa_pod_performance_latency_usec: ["name", "dimension"],
  purefa_pod_performance_throughput_iops: ["name", "dimension"],
  purefa_pod_performance_bandwidth_bytes: ["name", "dimension"],
  purefa_pod_replica_links_lag_max_msec: [
    "remote",
    "local_pod",
    "remote_pod",
    "direction",
    "status",
  ],
  purefa_pod_replica_links_lag_average_msec: [
    "remote",
    "local_pod",
    "remote_pod",
    "direction",
    "status",
  ],
  purefa_pod_mediator_status: ["array", "mediator", "pod", "status"],
  purefa_directory_space_bytes: ["name", "space"],
  purefa_directory_space_data_reduction_ratio: ["name"],
  purefa_directory_performance_latency_usec: ["name", "dimension"],
  purefa_directory_performance_throughput_iops: ["name", "dimension"],
  purefa_directory_performance_bandwidth_bytes: ["name", "dimension"],
  purefb_info: ["array_name", "system_id", "os", "version"],
  purefb_alerts_open: [
    "action",
    "code",
    "component_name",
    "component_type",
    "created",
    "kburl",
    "severity",
    "summary",
  ],
  purefb_array_space_bytes: ["type", "space"],
  purefb_array_space_utilization: ["type"],
  purefb_array_space_data_reduction_ratio: ["type"],
  purefb_hardware_health: ["type", "name", "index", "slot"],
  purefb_file_systems_space_bytes: ["name", "nfspolicy", "nfs", "smb", "space"],
  purefb_file_systems_space_data_reduction_ratio: [
    "name",
    "nfspolicy",
    "nfs",
    "smb",
  ],
  purefb_file_systems_performance_latency_usec: ["name", "dimension"],
  purefb_file_systems_performance_throughput_iops: ["name", "dimension"],
  purefb_file_systems_performance_bandwidth_bytes: ["name", "dimension"],
  purefb_buckets_space_bytes: ["name", "account", "space"],
  purefb_buckets_quota_space_bytes: ["name", "account", "hard_limit_enabled"],
  purefb_buckets_space_data_reduction_ratio: ["name", "account"],
  purefb_buckets_object_count: ["name", "account"],
  purefb_buckets_performance_latency_usec: ["name", "dimension"],
  purefb_buckets_performance_throughput_iops: ["name", "dimension"],
  purefb_buckets_performance_bandwidth_bytes: ["name", "dimension"],
  /*
   * Real Pure families the scan deliberately does NOT allow-list (they are
   * chart-only and live in ClickHouse alone). Here so the defense-in-depth
   * tests can feed them through dp().
   */
  purefa_array_performance_latency_usec: ["dimension"],
  purefa_volume_group_performance_latency_usec: ["name", "dimension"],
  purefa_hw_component_voltage_volt: ["component_name", "component_type"],
  purefa_network_interface_performance_throughput_pkts: [
    "name",
    "dimension",
    "type",
  ],
  purefa_pod_performance_replication_bandwidth_bytes: [
    "dimension",
    "direction",
    "name",
  ],
};

const NOT_ALLOW_LISTED: Array<string> = [
  "purefa_array_performance_latency_usec",
  "purefa_volume_group_performance_latency_usec",
  "purefa_hw_component_voltage_volt",
  "purefa_network_interface_performance_throughput_pkts",
  "purefa_pod_performance_replication_bandwidth_bytes",
];

function toNano(ms: number): string {
  return `${ms}000000`;
}

interface DatapointOptions {
  value: number;
  labels?: LabelMap | undefined;
  atMs?: number | undefined;
}

function dp(metricName: string, options: DatapointOptions): JSONObject {
  const allowed: Array<string> | undefined = PURE_LABELS[metricName];
  if (!allowed) {
    throw new Error(`${metricName} is not a Pure series this suite knows`);
  }
  const labels: LabelMap = options.labels || {};
  for (const key of Object.keys(labels)) {
    if (key !== SCRAPE_ENDPOINT_LABEL && !allowed.includes(key)) {
      throw new Error(`${metricName} carries no "${key}" label`);
    }
  }
  return {
    asDouble: options.value,
    timeUnixNano: toNano(options.atMs ?? BASE_MS),
    attributes: Object.entries(labels).map(([key, value]: [string, string]) => {
      return { key, value: { stringValue: value } };
    }),
  };
}

interface Buffers {
  resourceBuffer: Map<string, Map<string, StorageArrayResourceBufferEntry>>;
  arrayBuffer: Map<string, StorageArraySnapshotBufferEntry>;
}

function buffers(): Buffers {
  return { resourceBuffer: new Map(), arrayBuffer: new Map() };
}

function feedRaw(
  b: Buffers,
  metricName: string,
  datapoint: JSONObject,
  arrayIdStr: string = ARRAY,
): void {
  bufferStorageArraySnapshotMetric({
    arrayIdStr,
    metricName,
    datapoint,
    resourceBuffer: b.resourceBuffer,
    arrayBuffer: b.arrayBuffer,
  });
}

function feed(
  b: Buffers,
  metricName: string,
  labels: LabelMap,
  value: number,
  atMs?: number,
): void {
  feedRaw(b, metricName, dp(metricName, { value, labels, atMs }));
}

function entries(
  b: Buffers,
  arrayIdStr: string = ARRAY,
): Array<StorageArrayResourceBufferEntry> {
  return Array.from(b.resourceBuffer.get(arrayIdStr)?.values() || []);
}

function maybeEntry(
  b: Buffers,
  kind: StorageArrayResourceKind,
  externalId: string,
): StorageArrayResourceBufferEntry | undefined {
  return b.resourceBuffer.get(ARRAY)?.get(`${kind}|${externalId}`);
}

function entry(
  b: Buffers,
  kind: StorageArrayResourceKind,
  externalId: string,
): StorageArrayResourceBufferEntry {
  const found: StorageArrayResourceBufferEntry | undefined = maybeEntry(
    b,
    kind,
    externalId,
  );
  if (!found) {
    throw new Error(`expected buffered entry ${kind}|${externalId}`);
  }
  return found;
}

function ofKind(
  list: Array<StorageArrayResourceBufferEntry>,
  kind: StorageArrayResourceKind,
): Array<StorageArrayResourceBufferEntry> {
  return list.filter((e: StorageArrayResourceBufferEntry) => {
    return e.kind === kind;
  });
}

function snapOf(b: Buffers): StorageArraySnapshotBufferEntry | undefined {
  return b.arrayBuffer.get(ARRAY);
}

function rows(b: Buffers): Array<StorageArrayResourceBufferEntry> {
  return getStorageArrayResourceRows(entries(b), snapOf(b));
}

// Exactly what OtelMetricsIngestService.flushStorageArraySnapshotBuffers does.
function derive(b: Buffers): StorageArraySnapshotDerivedExtras {
  return deriveStorageArraySnapshotExtras(rows(b), snapOf(b));
}

// ---------------- FlashArray fixtures ----------------

function faInfo(b: Buffers, endpoint?: string, atMs?: number): void {
  feed(
    b,
    "purefa_info",
    {
      array_name: "pure-prod-01",
      os: "Purity//FA",
      subscription_type: "FlashArray",
      system_id: "6f2c9e1a-7d4b-4a1e-9c3f-2b8d5e7a9c10",
      version: "6.7.3",
      ...(endpoint ? { [SCRAPE_ENDPOINT_LABEL]: endpoint } : {}),
    },
    1,
    atMs,
  );
}

function faAlert(b: Buffers, labels: LabelMap, atMs?: number): void {
  feed(
    b,
    "purefa_alerts_open",
    {
      category: "hardware",
      code: "36",
      component_type: "controller",
      created: "1699999000000",
      issue: "failure",
      name: "4521",
      severity: "critical",
      summary: "Controller failed",
      ...labels,
    },
    1,
    atMs,
  );
}

function faHw(
  b: Buffers,
  componentName: string,
  componentType: string,
  componentStatus: string,
  atMs?: number,
): void {
  feed(
    b,
    "purefa_hw_component_status",
    {
      component_name: componentName,
      component_type: componentType,
      component_status: componentStatus,
    },
    1,
    atMs,
  );
}

function faDrive(
  b: Buffers,
  componentName: string,
  componentStatus: string,
  capacity: number = 3 * TIB,
): void {
  feed(
    b,
    "purefa_drive_capacity_bytes",
    {
      component_name: componentName,
      component_type: "SSD",
      component_status: componentStatus,
      component_protocol: "NVMe",
    },
    capacity,
  );
}

function faController(
  b: Buffers,
  name: string,
  mode: string,
  status: string,
): void {
  feed(
    b,
    "purefa_hw_controller_info",
    {
      mode,
      model: "FA-X70R4",
      name,
      status,
      type: "array_controller",
      version: "6.7.3",
    },
    1,
  );
}

function faVolume(
  b: Buffers,
  metricName: string,
  name: string,
  labels: LabelMap,
  value: number,
  atMs?: number,
): void {
  feed(
    b,
    metricName,
    { name, naa_id: `naa.624a9370${name.length}`, ...labels },
    value,
    atMs,
  );
}

function faConnection(
  b: Buffers,
  host: string,
  volume: string,
  hostgroup: string = "",
  atMs?: number,
): void {
  feed(b, "purefa_host_connections_info", { host, hostgroup, volume }, 1, atMs);
}

function faReplicaLag(
  b: Buffers,
  localPod: string,
  remotePod: string,
  status: string,
  lagMs: number,
  atMs?: number,
  remote: string = "pure-dr-01",
): void {
  feed(
    b,
    "purefa_pod_replica_links_lag_max_msec",
    {
      remote,
      local_pod: localPod,
      remote_pod: remotePod,
      direction: "outbound",
      status,
    },
    lagMs,
    atMs,
  );
}

// ---------------- FlashBlade fixtures ----------------

function fbInfo(b: Buffers, endpoint?: string): void {
  feed(
    b,
    "purefb_info",
    {
      array_name: "pure-fb-01",
      system_id: "0b1f2e3d-4c5b-6a79-8897-a6b5c4d3e2f1",
      os: "Purity//FB",
      version: "4.5.6",
      ...(endpoint ? { [SCRAPE_ENDPOINT_LABEL]: endpoint } : {}),
    },
    1,
  );
}

function fbHardware(
  b: Buffers,
  name: string,
  type: string,
  health: number,
  slot: string = "1",
): void {
  feed(b, "purefb_hardware_health", { type, name, index: "0", slot }, health);
}

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StorageArraySnapshotScan - the allow-list (the ingest gate)", () => {
  test("every allow-listed family is a real Pure exporter series", () => {
    for (const metricName of STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES) {
      expect(PURE_LABELS[metricName]).toBeDefined();
      expect(metricName).toMatch(/^pure(fa|fb)_[a-z0-9_]+$/);
    }
  });

  test("allow-lists exactly the families the scan maps", () => {
    const expected: Array<string> = Object.keys(PURE_LABELS).filter(
      (metricName: string) => {
        return !NOT_ALLOW_LISTED.includes(metricName);
      },
    );
    expect([...STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES].sort()).toEqual(
      [...expected].sort(),
    );
  });

  test("chart-only performance families stay out of the Postgres mirror", () => {
    for (const metricName of NOT_ALLOW_LISTED) {
      expect(STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES.has(metricName)).toBe(false);
    }
    // A name that is not even Pure's.
    expect(STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES.has("ceph_health_status")).toBe(
      false,
    );
  });

  function feedEveryLabel(b: Buffers, metricName: string): void {
    feed(
      b,
      metricName,
      Object.fromEntries(
        PURE_LABELS[metricName]!.map((label: string) => {
          return [label, label === "dimension" ? "usec_per_read_op" : "x"];
        }),
      ),
      123,
    );
  }

  test.each(
    NOT_ALLOW_LISTED.filter((metricName: string) => {
      return (
        metricName !== "purefa_pod_performance_replication_bandwidth_bytes"
      );
    }),
  )(
    "%s fed past the gate never creates an inventory row",
    (metricName: string) => {
      /*
       * Defense in depth: even if the Set gate were bypassed, the fold's
       * metric-name branches must drop the series. purefa_volume_group_*
       * in particular names a volume GROUP in its `name` label.
       */
      const b: Buffers = buffers();
      feedEveryLabel(b, metricName);
      expect(entries(b)).toHaveLength(0);
      // The platform is still known from the prefix.
      expect(snapOf(b)?.storageSystem).toBe(
        StorageSystem.PureStorageFlashArray,
      );
    },
  );

  test("an unlisted pod family is a bare sighting of its pod: no column is filled", () => {
    // Every purefa_pod_* series names a real pod in `name`.
    const b: Buffers = buffers();
    feedEveryLabel(b, "purefa_pod_performance_replication_bandwidth_bytes");
    expect(entries(b)).toEqual([
      {
        ...emptyStorageArrayResourceEntry(
          StorageArrayResourceKind.Pod,
          "x",
          new Date(BASE_MS),
        ),
        name: "x",
      },
    ]);
  });
});

describe("StorageArraySnapshotScan - identity and platform", () => {
  test("purefa_info carries the array's own name, system id, OS and version", () => {
    const b: Buffers = buffers();
    faInfo(b);

    expect(derive(b)).toEqual({
      storageSystem: StorageSystem.PureStorageFlashArray,
      reportedName: "pure-prod-01",
      systemId: "6f2c9e1a-7d4b-4a1e-9c3f-2b8d5e7a9c10",
      osName: "Purity//FA",
      osVersion: "6.7.3",
    });
    // purefa_info is array-level: it never becomes an inventory row.
    expect(entries(b)).toHaveLength(0);
  });

  test("purefb_info identifies a FlashBlade", () => {
    const b: Buffers = buffers();
    fbInfo(b);

    expect(derive(b)).toEqual({
      storageSystem: StorageSystem.PureStorageFlashBlade,
      reportedName: "pure-fb-01",
      systemId: "0b1f2e3d-4c5b-6a79-8897-a6b5c4d3e2f1",
      osName: "Purity//FB",
      osVersion: "4.5.6",
    });
  });

  test("identity is first-non-null-wins across the batch", () => {
    const b: Buffers = buffers();
    // A first purefa_info whose labels are blank fills nothing ...
    feed(
      b,
      "purefa_info",
      { array_name: "  ", os: "", system_id: "sys-1", version: "" },
      1,
    );
    // ... so the second one fills the gaps but never overrides system_id.
    faInfo(b, undefined, BASE_MS + 60_000);
    feed(b, "purefa_info", { array_name: "renamed", version: "9.9.9" }, 1);

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.reportedName).toBe("pure-prod-01");
    expect(extras.systemId).toBe("sys-1");
    expect(extras.osName).toBe("Purity//FA");
    expect(extras.osVersion).toBe("6.7.3");
  });

  test("label values are trimmed", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_info",
      { array_name: "  pure-prod-01\n", os: " Purity//FA " },
      1,
    );
    expect(derive(b).reportedName).toBe("pure-prod-01");
    expect(derive(b).osName).toBe("Purity//FA");
  });

  test("the platform is detected from any series' prefix, without purefa_info", () => {
    const fa: Buffers = buffers();
    faVolume(
      fa,
      "purefa_volume_space_bytes",
      "vol1",
      { space: "total_provisioned" },
      TIB,
    );
    expect(derive(fa).storageSystem).toBe(StorageSystem.PureStorageFlashArray);
    expect(derive(fa).reportedName).toBeUndefined();

    const fb: Buffers = buffers();
    fbHardware(fb, "CH1.FB1", "fb", 1);
    expect(derive(fb).storageSystem).toBe(StorageSystem.PureStorageFlashBlade);
  });

  test("the first platform seen wins for the batch", () => {
    const b: Buffers = buffers();
    fbInfo(b);
    faInfo(b);
    expect(snapOf(b)?.storageSystem).toBe(StorageSystem.PureStorageFlashBlade);
  });

  test("getOrCreateStorageArraySnapshot starts empty and returns the same entry", () => {
    const buffer: Map<string, StorageArraySnapshotBufferEntry> = new Map();
    const first: StorageArraySnapshotBufferEntry =
      getOrCreateStorageArraySnapshot(buffer, ARRAY);

    expect(getOrCreateStorageArraySnapshot(buffer, ARRAY)).toBe(first);
    expect(buffer.size).toBe(1);
    expect(first).toMatchObject({
      storageSystem: null,
      reportedName: null,
      systemId: null,
      osName: null,
      osVersion: null,
      sawAlerts: false,
      capacityBytes: null,
      emptyBytes: null,
      utilizationPercent: null,
      dataReductionRatio: null,
      sawHardware: false,
      sawDrives: false,
      sawControllers: false,
      sawVolumes: false,
      sawHosts: false,
      sawPods: false,
      sawFileSystems: false,
      sawBuckets: false,
      connectionsObservedAt: null,
    });
    expect(first.openAlertKeys.size).toBe(0);
    expect(first.volumesByHost.size).toBe(0);
    expect(first.hostsByVolume.size).toBe(0);

    // Another array gets its own entry.
    expect(getOrCreateStorageArraySnapshot(buffer, OTHER_ARRAY)).not.toBe(
      first,
    );
  });

  test("two arrays in one request never share state", () => {
    const b: Buffers = buffers();
    faInfo(b, "volumes");
    faVolume(
      b,
      "purefa_volume_space_bytes",
      "vol1",
      { space: "total_provisioned" },
      TIB,
    );
    feedRaw(
      b,
      "purefb_info",
      dp("purefb_info", { value: 1, labels: { array_name: "pure-fb-01" } }),
      OTHER_ARRAY,
    );

    expect(entries(b)).toHaveLength(1);
    expect(entries(b, OTHER_ARRAY)).toHaveLength(0);
    expect(b.arrayBuffer.get(OTHER_ARRAY)?.storageSystem).toBe(
      StorageSystem.PureStorageFlashBlade,
    );
    expect(b.arrayBuffer.get(OTHER_ARRAY)?.sawVolumes).toBe(false);
    expect(derive(b).volumeCount).toBe(1);
  });

  test("no buffered state derives nothing", () => {
    expect(deriveStorageArraySnapshotExtras([], undefined)).toEqual({});
  });
});

describe("StorageArraySnapshotScan - capacity", () => {
  test("FlashArray: capacity, used = capacity - empty, percent and data reduction", () => {
    const b: Buffers = buffers();
    feed(b, "purefa_array_space_bytes", { space: "capacity" }, 100 * TIB);
    // 30 TiB plus some sub-MiB noise: used must round to whole MiB.
    feed(b, "purefa_array_space_bytes", { space: "empty" }, 30 * TIB + 123456);
    feed(b, "purefa_array_space_bytes", { space: "snapshots" }, 2 * TIB);
    feed(b, "purefa_array_space_utilization", {}, 70.004321);
    feed(b, "purefa_array_space_data_reduction_ratio", {}, 4.2567);

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.capacityBytes).toBe(100 * TIB);
    expect(extras.usedBytes).toBe(70 * TIB);
    expect(extras.usedBytes! % MIB).toBe(0);
    expect(extras.capacityUsedPercent).toBe(70);
    expect(extras.dataReductionRatio).toBe(4.26);
  });

  test("capacity bytes round to whole MiB so the heartbeat fingerprint is stable", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_array_space_bytes",
      { space: "capacity" },
      100 * TIB + 3 * MIB + 600_000,
    );
    expect(derive(b).capacityBytes).toBe(100 * TIB + 4 * MIB);
  });

  test("used falls back to capacity x utilization when the empty series is missing", () => {
    const b: Buffers = buffers();
    feed(b, "purefa_array_space_bytes", { space: "capacity" }, 100 * TIB);
    feed(b, "purefa_array_space_utilization", {}, 42.5);

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.usedBytes).toBe(42.5 * TIB);
    expect(extras.capacityUsedPercent).toBe(42.5);
  });

  test("a utilization above 100% never reports more used than capacity", () => {
    const b: Buffers = buffers();
    feed(b, "purefa_array_space_bytes", { space: "capacity" }, 10 * TIB);
    feed(b, "purefa_array_space_utilization", {}, 120);

    expect(derive(b).usedBytes).toBe(10 * TIB);
    // The array's own figure is reported as-is.
    expect(derive(b).capacityUsedPercent).toBe(120);
  });

  test("percent is computed from capacity and empty when utilization is missing", () => {
    const b: Buffers = buffers();
    feed(b, "purefa_array_space_bytes", { space: "capacity" }, 100 * TIB);
    feed(b, "purefa_array_space_bytes", { space: "empty" }, 25 * TIB);

    expect(derive(b).capacityUsedPercent).toBe(75);
    expect(derive(b).usedBytes).toBe(75 * TIB);
  });

  test("empty above capacity clamps used and percent to 0, never negative", () => {
    const b: Buffers = buffers();
    feed(b, "purefa_array_space_bytes", { space: "capacity" }, 10 * TIB);
    feed(b, "purefa_array_space_bytes", { space: "empty" }, 12 * TIB);

    expect(derive(b).usedBytes).toBe(0);
    expect(derive(b).capacityUsedPercent).toBe(0);
  });

  test("a zero capacity never divides by zero", () => {
    const b: Buffers = buffers();
    feed(b, "purefa_array_space_bytes", { space: "capacity" }, 0);
    feed(b, "purefa_array_space_bytes", { space: "empty" }, 0);

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.capacityBytes).toBe(0);
    expect(extras.usedBytes).toBe(0);
    expect("capacityUsedPercent" in extras).toBe(false);
  });

  test("negative space and ratio values clamp to 0", () => {
    const b: Buffers = buffers();
    feed(b, "purefa_array_space_bytes", { space: "capacity" }, -5);
    feed(b, "purefa_array_space_utilization", {}, -1);
    feed(b, "purefa_array_space_data_reduction_ratio", {}, -2);

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.capacityBytes).toBe(0);
    expect(extras.capacityUsedPercent).toBe(0);
    expect(extras.dataReductionRatio).toBe(0);
  });

  test("percent and ratio round to two decimals", () => {
    const b: Buffers = buffers();
    feed(b, "purefa_array_space_utilization", {}, 87.6549);
    feed(b, "purefa_array_space_data_reduction_ratio", {}, 3.14159);

    expect(derive(b).capacityUsedPercent).toBe(87.65);
    expect(derive(b).dataReductionRatio).toBe(3.14);
  });

  test("utilization alone writes the percent but no byte columns", () => {
    const b: Buffers = buffers();
    feed(b, "purefa_array_space_utilization", {}, 12.5);

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.capacityUsedPercent).toBe(12.5);
    expect("capacityBytes" in extras).toBe(false);
    expect("usedBytes" in extras).toBe(false);
  });

  test("a batch without capacity series writes no capacity column at all", () => {
    const b: Buffers = buffers();
    faInfo(b, "volumes");
    faVolume(
      b,
      "purefa_volume_space_bytes",
      "vol1",
      { space: "total_provisioned" },
      TIB,
    );

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    for (const key of [
      "capacityBytes",
      "usedBytes",
      "capacityUsedPercent",
      "dataReductionRatio",
    ]) {
      expect(key in extras).toBe(false);
    }
  });

  test("FlashBlade: only the type=array rows describe the array", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefb_array_space_bytes",
      { type: "array", space: "capacity" },
      2000 * TIB,
    );
    feed(
      b,
      "purefb_array_space_bytes",
      { type: "array", space: "empty" },
      1500 * TIB,
    );
    feed(b, "purefb_array_space_utilization", { type: "array" }, 25);
    feed(b, "purefb_array_space_data_reduction_ratio", { type: "array" }, 2.1);
    // The file-system and object-store rows must not overwrite the array's.
    feed(
      b,
      "purefb_array_space_bytes",
      { type: "file-system", space: "capacity" },
      TIB,
    );
    feed(
      b,
      "purefb_array_space_bytes",
      { type: "object-store", space: "empty" },
      5 * TIB,
    );
    feed(b, "purefb_array_space_utilization", { type: "file-system" }, 99);
    feed(
      b,
      "purefb_array_space_data_reduction_ratio",
      { type: "object-store" },
      9.9,
    );

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.capacityBytes).toBe(2000 * TIB);
    expect(extras.usedBytes).toBe(500 * TIB);
    expect(extras.capacityUsedPercent).toBe(25);
    expect(extras.dataReductionRatio).toBe(2.1);
  });

  test("FlashBlade: file-system / object-store space rows alone are not the array endpoint", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefb_array_space_bytes",
      { type: "file-system", space: "capacity" },
      TIB,
    );
    feed(b, "purefb_array_space_utilization", { type: "object-store" }, 50);

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(snapOf(b)?.sawAlerts).toBe(false);
    expect("openAlertCount" in extras).toBe(false);
    expect("capacityBytes" in extras).toBe(false);
    expect("capacityUsedPercent" in extras).toBe(false);
  });
});

describe("StorageArraySnapshotScan - open alerts", () => {
  test("counts open, critical and warning alerts and never the hidden ones", () => {
    const b: Buffers = buffers();
    faAlert(b, { name: "4521", severity: "critical", code: "36" });
    faAlert(b, {
      name: "4522",
      severity: "critical",
      code: "38",
      component_type: "power_supply",
      summary: "Power supply failed",
    });
    faAlert(b, {
      name: "4530",
      severity: "warning",
      code: "44",
      component_type: "drive_bay",
      summary: "Drive bay degraded",
    });
    faAlert(b, {
      name: "4540",
      severity: "info",
      category: "software",
      summary: "Software update available",
    });
    faAlert(b, { name: "4550", severity: "hidden", summary: "Internal" });

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.openAlertCount).toBe(4);
    expect(extras.criticalAlertCount).toBe(2);
    expect(extras.warningAlertCount).toBe(1);
    // Alerts are array-level: no inventory row.
    expect(entries(b)).toHaveLength(0);
  });

  test("severity is matched without regard to case", () => {
    const b: Buffers = buffers();
    faAlert(b, { name: "1", severity: "CRITICAL" });
    faAlert(b, { name: "2", severity: "Warning" });
    faAlert(b, { name: "3", severity: "Hidden" });

    expect(derive(b)).toMatchObject({
      openAlertCount: 2,
      criticalAlertCount: 1,
      warningAlertCount: 1,
    });
  });

  test("the same alert in two scrapes of one batch is counted once", () => {
    const b: Buffers = buffers();
    faAlert(b, { name: "4521" }, BASE_MS);
    faAlert(b, { name: "4521" }, BASE_MS + 60_000);
    // A different alert with the same code is a second alert.
    faAlert(b, { name: "4522" }, BASE_MS + 60_000);

    expect(derive(b)).toMatchObject({
      openAlertCount: 2,
      criticalAlertCount: 2,
    });
  });

  test.each([
    [
      "its space series",
      (b: Buffers): void => {
        feed(b, "purefa_array_space_bytes", { space: "capacity" }, TIB);
      },
    ],
    [
      "its utilization series",
      (b: Buffers): void => {
        feed(b, "purefa_array_space_utilization", {}, 10);
      },
    ],
    [
      "scrape_endpoint=array on purefa_info alone",
      (b: Buffers): void => {
        faInfo(b, "array");
      },
    ],
    [
      "only a hidden alert",
      (b: Buffers): void => {
        faAlert(b, { severity: "hidden" });
      },
    ],
  ])(
    "an array endpoint seen through %s with no open alert reports 0 alerts",
    (_: string, arrange: (b: Buffers) => void) => {
      /*
       * An array with no open alert exports no purefa_alerts_open series at
       * all, so seeing its endpoint is what lets the counts fall to 0.
       */
      const b: Buffers = buffers();
      arrange(b);

      expect(derive(b)).toMatchObject({
        openAlertCount: 0,
        criticalAlertCount: 0,
        warningAlertCount: 0,
      });
    },
  );

  test("a batch that never touched the array endpoint writes no alert counts", () => {
    const b: Buffers = buffers();
    faInfo(b, "volumes");
    faVolume(
      b,
      "purefa_volume_performance_latency_usec",
      "vol1",
      { dimension: "usec_per_read_op" },
      250,
    );

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    for (const key of [
      "openAlertCount",
      "criticalAlertCount",
      "warningAlertCount",
      "healthStatus",
    ]) {
      expect(key in extras).toBe(false);
    }
  });

  test("FlashBlade alerts with their own labels count the same way", () => {
    const b: Buffers = buffers();
    const fbAlert: (labels: LabelMap) => void = (labels: LabelMap): void => {
      feed(
        b,
        "purefb_alerts_open",
        {
          action: "Contact Pure Storage Support",
          code: "1301",
          component_name: "CH1.FB3",
          component_type: "blade",
          created: "1699999000000",
          kburl: "https://support.purestorage.com/?cid=Alert_1301",
          severity: "critical",
          summary: "Blade failed",
          ...labels,
        },
        1,
      );
    };
    fbAlert({});
    fbAlert({ component_name: "CH1.FM1", severity: "warning", code: "1402" });
    fbAlert({ component_name: "CH1.PWR2", severity: "info", code: "1500" });

    expect(derive(b)).toMatchObject({
      storageSystem: StorageSystem.PureStorageFlashBlade,
      openAlertCount: 3,
      criticalAlertCount: 1,
      warningAlertCount: 1,
    });
  });
});

describe("StorageArraySnapshotScan - the scrape_endpoint contract", () => {
  test.each([
    ["volumes", "volumeCount"],
    ["hosts", "hostCount"],
    ["pods", "podCount"],
  ])(
    "a FlashArray %s scrape that listed nothing reports %s 0",
    (endpoint: string, countKey: string) => {
      /*
       * How an array whose last volume was just deleted reports 0 instead
       * of keeping the old count forever: the endpoint was scraped, its
       * purefa_info said so, and it carried no object series.
       */
      const b: Buffers = buffers();
      faInfo(b, endpoint);

      const extras: StorageArraySnapshotDerivedExtras = derive(b);
      expect((extras as Record<string, unknown>)[countKey]).toBe(0);
      // Only that endpoint's count.
      for (const other of [
        "volumeCount",
        "hostCount",
        "podCount",
        "fileSystemCount",
        "bucketCount",
        "openAlertCount",
      ]) {
        if (other !== countKey) {
          expect(other in extras).toBe(false);
        }
      }
    },
  );

  test.each([
    ["filesystems", "fileSystemCount"],
    ["objectstore", "bucketCount"],
  ])(
    "a FlashBlade %s scrape that listed nothing reports %s 0",
    (endpoint: string, countKey: string) => {
      const b: Buffers = buffers();
      fbInfo(b, endpoint);

      const extras: StorageArraySnapshotDerivedExtras = derive(b);
      expect((extras as Record<string, unknown>)[countKey]).toBe(0);
      expect("openAlertCount" in extras).toBe(false);
    },
  );

  test("the array endpoint label zeroes the alert counts only", () => {
    const b: Buffers = buffers();
    faInfo(b, "array");

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.openAlertCount).toBe(0);
    expect("volumeCount" in extras).toBe(false);
    expect("hostCount" in extras).toBe(false);
  });

  test("directories have no count column, so their endpoint marks nothing", () => {
    const b: Buffers = buffers();
    faInfo(b, "directories");
    feed(
      b,
      "purefa_directory_space_bytes",
      { name: "fs1:root", space: "total_physical" },
      TIB,
    );

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    for (const key of [
      "volumeCount",
      "hostCount",
      "podCount",
      "openAlertCount",
      "fileSystemCount",
      "bucketCount",
    ]) {
      expect(key in extras).toBe(false);
    }
    expect(ofKind(entries(b), StorageArrayResourceKind.Directory)).toHaveLength(
      1,
    );
  });

  test.each(["all", "metrics", " ALL "])(
    "scrape_endpoint=%p on a FlashArray completes every FlashArray family and no FlashBlade one",
    (endpoint: string) => {
      const b: Buffers = buffers();
      faInfo(b, endpoint);

      const extras: StorageArraySnapshotDerivedExtras = derive(b);
      expect(extras).toMatchObject({
        volumeCount: 0,
        hostCount: 0,
        podCount: 0,
        openAlertCount: 0,
        criticalAlertCount: 0,
        warningAlertCount: 0,
      });
      /*
       * REGRESSION: `all` used to mark every family, so a FlashArray wrote
       * fileSystemCount 0 and bucketCount 0 for kinds it never reports.
       */
      expect("fileSystemCount" in extras).toBe(false);
      expect("bucketCount" in extras).toBe(false);
    },
  );

  test("scrape_endpoint=all on a FlashBlade completes file systems and buckets, never volumes", () => {
    const b: Buffers = buffers();
    fbInfo(b, "all");

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras).toMatchObject({
      fileSystemCount: 0,
      bucketCount: 0,
      openAlertCount: 0,
    });
    for (const key of ["volumeCount", "hostCount", "podCount"]) {
      expect(key in extras).toBe(false);
    }
  });

  test("the label is matched without regard to case or surrounding whitespace", () => {
    const b: Buffers = buffers();
    faInfo(b, "  Volumes ");
    expect(derive(b).volumeCount).toBe(0);
  });

  test.each(["clients", "usage", "policies", "unknown", ""])(
    "an endpoint the scan has no count for (%p) marks nothing",
    (endpoint: string) => {
      const b: Buffers = buffers();
      fbInfo(b, endpoint);

      const extras: StorageArraySnapshotDerivedExtras = derive(b);
      for (const key of [
        "volumeCount",
        "hostCount",
        "podCount",
        "fileSystemCount",
        "bucketCount",
        "openAlertCount",
      ]) {
        expect(key in extras).toBe(false);
      }
    },
  );

  test("only purefa_info / purefb_info read the label", () => {
    // The agent labels every series; only the identity series decides.
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_volume_space_bytes",
      {
        name: "vol1",
        space: "total_provisioned",
        [SCRAPE_ENDPOINT_LABEL]: "hosts",
      },
      TIB,
    );

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.volumeCount).toBe(1);
    expect("hostCount" in extras).toBe(false);
  });

  test("never zeroes a count on a partial batch: an array-endpoint batch leaves every object count alone", () => {
    const b: Buffers = buffers();
    faInfo(b, "array");
    feed(b, "purefa_array_space_bytes", { space: "capacity" }, 100 * TIB);
    faHw(b, "CT0", "controller", "ok");

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    for (const key of [
      "volumeCount",
      "hostCount",
      "podCount",
      "fileSystemCount",
      "bucketCount",
    ]) {
      expect(key in extras).toBe(false);
    }
  });

  test("without the label (a hand-written collector config) counts are inferred from the series", () => {
    const withVolumes: Buffers = buffers();
    faInfo(withVolumes);
    for (const name of ["vol1", "vol2", "vol3"]) {
      faVolume(
        withVolumes,
        "purefa_volume_space_bytes",
        name,
        { space: "total_provisioned" },
        TIB,
      );
    }
    expect(derive(withVolumes).volumeCount).toBe(3);

    // ... and an unlabelled batch with no volume series cannot say "0".
    const withoutVolumes: Buffers = buffers();
    faInfo(withoutVolumes);
    expect("volumeCount" in derive(withoutVolumes)).toBe(false);
  });
});

describe("StorageArraySnapshotScan - FlashArray hardware, drives and controllers", () => {
  test("purefa_hw_component_status becomes a Hardware row per component", () => {
    const b: Buffers = buffers();
    faHw(b, "CH0.PWR1", "power_supply", "OK");
    faHw(b, "CT0", "controller", "critical");
    faHw(b, "CH0.BAY4", "drive_bay", "not_installed");

    const psu: StorageArrayResourceBufferEntry = entry(
      b,
      StorageArrayResourceKind.Hardware,
      "CH0.PWR1",
    );
    expect(psu.name).toBe("CH0.PWR1");
    // Statuses are normalized to lowercase.
    expect(psu.status).toBe("ok");
    expect(psu.componentType).toBe("power_supply");
    expect(psu.observedAt).toEqual(new Date(BASE_MS));

    expect(entry(b, StorageArrayResourceKind.Hardware, "CT0").status).toBe(
      "critical",
    );
    // Empty bays are inventory too, and count as components.
    expect(derive(b).hardwareComponentCount).toBe(3);
    expect(derive(b).unhealthyHardwareCount).toBe(1);
  });

  test("temperature merges into the sensor's Hardware row without touching its status", () => {
    const b: Buffers = buffers();
    faHw(b, "CH0.TMP1", "temp_sensor", "ok");
    feed(
      b,
      "purefa_hw_component_temperature_celsius",
      { component_name: "CH0.TMP1", component_type: "temp_sensor" },
      31.5,
    );

    const sensor: StorageArrayResourceBufferEntry = entry(
      b,
      StorageArrayResourceKind.Hardware,
      "CH0.TMP1",
    );
    expect(sensor.temperatureCelsius).toBe(31.5);
    expect(sensor.status).toBe("ok");
    expect(entries(b)).toHaveLength(1);
  });

  test("a temperature series alone is a row but not the hardware list", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_hw_component_temperature_celsius",
      { component_name: "CH0.TMP1", component_type: "temp_sensor" },
      30,
    );

    const sensor: StorageArrayResourceBufferEntry = entry(
      b,
      StorageArrayResourceKind.Hardware,
      "CH0.TMP1",
    );
    expect(sensor.status).toBeNull();
    expect(sensor.componentType).toBe("temp_sensor");
    expect(snapOf(b)?.sawHardware).toBe(false);
    expect("hardwareComponentCount" in derive(b)).toBe(false);
    expect("unhealthyHardwareCount" in derive(b)).toBe(false);
  });

  test("purefa_drive_capacity_bytes becomes a Drive row with capacity, status, type and protocol", () => {
    const b: Buffers = buffers();
    faDrive(b, "CH0.BAY0", "healthy", 3.84e12 + 0.75);
    faDrive(b, "CH0.BAY1", "FAILED");

    const drive: StorageArrayResourceBufferEntry = entry(
      b,
      StorageArrayResourceKind.Drive,
      "CH0.BAY0",
    );
    expect(drive.name).toBe("CH0.BAY0");
    expect(drive.status).toBe("healthy");
    expect(drive.componentType).toBe("SSD");
    // Whole bytes.
    expect(drive.capacityBytes).toBe(3.84e12);
    expect(drive.details).toEqual({ protocol: "NVMe" });
    expect(entry(b, StorageArrayResourceKind.Drive, "CH0.BAY1").status).toBe(
      "failed",
    );

    expect(snapOf(b)?.sawDrives).toBe(true);
    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.unhealthyHardwareCount).toBe(1);
    // Drives are not hardware components: no component count from them.
    expect("hardwareComponentCount" in extras).toBe(false);
  });

  test("purefa_hw_controller_info becomes a Controller row: status, mode, model, version, type", () => {
    const b: Buffers = buffers();
    faController(b, "CT0", "primary", "ready");
    faController(b, "CT1", "secondary", "Not Ready");

    const ct0: StorageArrayResourceBufferEntry = entry(
      b,
      StorageArrayResourceKind.Controller,
      "CT0",
    );
    expect(ct0).toMatchObject({
      name: "CT0",
      status: "ready",
      statusDetail: "primary",
      model: "FA-X70R4",
      firmwareVersion: "6.7.3",
      componentType: "array_controller",
    });
    expect(entry(b, StorageArrayResourceKind.Controller, "CT1").status).toBe(
      "not ready",
    );
    expect(snapOf(b)?.sawControllers).toBe(true);
    expect(derive(b).unhealthyHardwareCount).toBe(1);
  });

  test("a component series without its name label is skipped", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_hw_component_status",
      { component_type: "cooling", component_status: "critical" },
      1,
    );
    feed(
      b,
      "purefa_hw_component_temperature_celsius",
      { component_type: "temp_sensor" },
      40,
    );
    feed(
      b,
      "purefa_drive_capacity_bytes",
      { component_status: "failed", component_type: "SSD" },
      TIB,
    );
    feed(
      b,
      "purefa_hw_controller_info",
      { mode: "primary", status: "ready" },
      1,
    );

    expect(entries(b)).toHaveLength(0);
    expect(snapOf(b)?.sawHardware).toBe(false);
    expect(snapOf(b)?.sawDrives).toBe(false);
    expect(snapOf(b)?.sawControllers).toBe(false);
  });

  test("unhealthy counts span hardware, drives and controllers", () => {
    const b: Buffers = buffers();
    faHw(b, "CH0.FAN1", "cooling", "degraded");
    faHw(b, "CH0.PWR0", "power_supply", "unknown");
    faHw(b, "CH0.PWR1", "power_supply", "device_off");
    faHw(b, "CH0.BAY9", "drive_bay", "identifying");
    faDrive(b, "CH0.BAY2", "missing");
    faDrive(b, "CH0.BAY3", "unrecognized");
    faDrive(b, "CH0.BAY5", "recovering");
    faDrive(b, "CH0.BAY6", "empty");
    faController(b, "CT0", "primary", "ready");
    faController(b, "CT1", "secondary", "unknown");

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.hardwareComponentCount).toBe(4);
    // degraded, unknown (hardware), missing, unrecognized (drives), unknown (controller).
    expect(extras.unhealthyHardwareCount).toBe(5);
  });

  test("one failed part counts once even though it is several rows", () => {
    const b: Buffers = buffers();
    // A failed drive: its bay reports critical AND the drive reports failed.
    faHw(b, "CH0.BAY4", "drive_bay", "critical");
    faDrive(b, "CH0.BAY4", "failed");
    // A controller that is not ready: a Hardware row and a Controller row.
    faHw(b, "CT1", "controller", "unknown");
    faController(b, "CT1", "secondary", "unknown");
    // Names are compared without regard to case.
    faHw(b, "ch0.pwr1", "power_supply", "degraded");
    faDrive(b, "CH0.PWR1", "unhealthy");
    faHw(b, "CH0.FAN0", "cooling", "ok");

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.hardwareComponentCount).toBe(4);
    expect(extras.unhealthyHardwareCount).toBe(3);
    expect(extras.healthStatus).toBeUndefined();
  });
});

describe("StorageArraySnapshotScan - component status vocabulary", () => {
  test.each([
    // purefa_hw_component_status
    ["ok", false, false],
    ["critical", true, true],
    ["degraded", true, false],
    ["unknown", true, false],
    ["device_off", false, false],
    ["identifying", false, false],
    ["not_installed", false, false],
    // purefa_drive_capacity_bytes
    ["healthy", false, false],
    ["empty", false, false],
    ["failed", true, true],
    ["missing", true, true],
    ["unhealthy", true, true],
    ["unrecognized", true, false],
    ["recovering", false, false],
    ["unadmitted", false, false],
    ["updating", false, false],
    // purefa_hw_controller_info
    ["ready", false, false],
    ["not ready", true, false],
    // purefb_hardware_health, as the scan maps it
    ["unused", false, false],
  ])(
    "%p is unhealthy: %p, critical: %p",
    (status: string, unhealthy: boolean, critical: boolean) => {
      expect(isUnhealthyComponentStatus(status)).toBe(unhealthy);
      expect(isCriticalComponentStatus(status)).toBe(critical);
      // Case and whitespace never matter.
      expect(isUnhealthyComponentStatus(` ${status.toUpperCase()} `)).toBe(
        unhealthy,
      );
      expect(isCriticalComponentStatus(` ${status.toUpperCase()} `)).toBe(
        critical,
      );
    },
  );

  test("every critical status is also unhealthy", () => {
    for (const status of ["critical", "failed", "missing", "unhealthy"]) {
      expect(isCriticalComponentStatus(status)).toBe(true);
      expect(isUnhealthyComponentStatus(status)).toBe(true);
    }
  });

  test("a missing status is neither", () => {
    for (const status of [null, undefined, ""]) {
      expect(isUnhealthyComponentStatus(status)).toBe(false);
      expect(isCriticalComponentStatus(status)).toBe(false);
    }
  });
});

describe("StorageArraySnapshotScan - health status", () => {
  function arrayEndpoint(b: Buffers): void {
    faInfo(b, "array");
    feed(b, "purefa_array_space_bytes", { space: "capacity" }, 100 * TIB);
    faHw(b, "CT0", "controller", "ok");
    faHw(b, "CT1", "controller", "ok");
  }

  test("the enum is CephCluster.healthStatus's scale", () => {
    expect(StorageArrayHealthStatus.Ok).toBe(0);
    expect(StorageArrayHealthStatus.Warning).toBe(1);
    expect(StorageArrayHealthStatus.Critical).toBe(2);
  });

  test("no open alert and healthy hardware is OK, and 0 is written", () => {
    const b: Buffers = buffers();
    arrayEndpoint(b);

    expect(derive(b).healthStatus).toBe(StorageArrayHealthStatus.Ok);
    expect("healthStatus" in derive(b)).toBe(true);
  });

  test("an info alert leaves the array OK", () => {
    const b: Buffers = buffers();
    arrayEndpoint(b);
    faAlert(b, { severity: "info" });

    expect(derive(b).healthStatus).toBe(StorageArrayHealthStatus.Ok);
  });

  test.each([
    [
      "a warning alert",
      (b: Buffers): void => {
        faAlert(b, { severity: "warning" });
      },
    ],
    [
      "a degraded component",
      (b: Buffers): void => {
        faHw(b, "CH0.FAN0", "cooling", "degraded");
      },
    ],
    [
      "a component in an unknown state",
      (b: Buffers): void => {
        faHw(b, "CH0.PWR0", "power_supply", "unknown");
      },
    ],
    [
      "an unrecognized drive",
      (b: Buffers): void => {
        faDrive(b, "CH0.BAY7", "unrecognized");
      },
    ],
    [
      "a controller that is not ready",
      (b: Buffers): void => {
        faController(b, "CT1", "secondary", "not ready");
      },
    ],
  ])("%s makes it Warning", (_: string, arrange: (b: Buffers) => void) => {
    const b: Buffers = buffers();
    arrayEndpoint(b);
    arrange(b);

    expect(derive(b).healthStatus).toBe(StorageArrayHealthStatus.Warning);
  });

  test.each([
    [
      "a critical alert",
      (b: Buffers): void => {
        faAlert(b, { severity: "critical" });
      },
    ],
    [
      "a critical component",
      (b: Buffers): void => {
        faHw(b, "CH0.PWR1", "power_supply", "critical");
      },
    ],
    [
      "a failed drive",
      (b: Buffers): void => {
        faDrive(b, "CH0.BAY4", "failed");
      },
    ],
    [
      "a missing drive",
      (b: Buffers): void => {
        faDrive(b, "CH0.BAY4", "missing");
      },
    ],
    [
      "an unhealthy drive",
      (b: Buffers): void => {
        faDrive(b, "CH0.BAY4", "unhealthy");
      },
    ],
  ])("%s makes it Critical", (_: string, arrange: (b: Buffers) => void) => {
    const b: Buffers = buffers();
    arrayEndpoint(b);
    arrange(b);

    expect(derive(b).healthStatus).toBe(StorageArrayHealthStatus.Critical);
  });

  test("critical beats warning", () => {
    const b: Buffers = buffers();
    arrayEndpoint(b);
    faAlert(b, { name: "1", severity: "warning" });
    faHw(b, "CH0.FAN0", "cooling", "degraded");
    faDrive(b, "CH0.BAY4", "failed");

    expect(derive(b).healthStatus).toBe(StorageArrayHealthStatus.Critical);
  });

  test("needs both the alert list and the hardware list to say anything", () => {
    // Alerts seen, no hardware series: no verdict.
    const alertsOnly: Buffers = buffers();
    faInfo(alertsOnly, "array");
    expect("healthStatus" in derive(alertsOnly)).toBe(false);

    // Hardware seen, alert list unknown: counts, but no verdict.
    const hardwareOnly: Buffers = buffers();
    faHw(hardwareOnly, "CT0", "controller", "critical");
    const extras: StorageArraySnapshotDerivedExtras = derive(hardwareOnly);
    expect("healthStatus" in extras).toBe(false);
    expect(extras.unhealthyHardwareCount).toBe(1);
  });

  test("a FlashBlade blade reporting unhealthy is Critical", () => {
    const b: Buffers = buffers();
    fbInfo(b, "array");
    fbHardware(b, "CH1.FB1", "fb", 1);
    fbHardware(b, "CH1.FB2", "fb", 0);

    expect(derive(b).healthStatus).toBe(StorageArrayHealthStatus.Critical);
  });
});

describe("StorageArraySnapshotScan - FlashBlade hardware", () => {
  test("purefb_hardware_health maps 1 healthy, 2 unused, anything else unhealthy", () => {
    const b: Buffers = buffers();
    fbHardware(b, "CH1.FB1", "fb", 1, "1");
    fbHardware(b, "CH1.FB2", "fb", 0, "2");
    fbHardware(b, "CH1.FB15", "fb", 2, "15");
    fbHardware(b, "CH1.PWR1", "pwr", 3, "1");

    const healthy: StorageArrayResourceBufferEntry = entry(
      b,
      StorageArrayResourceKind.Hardware,
      "CH1.FB1",
    );
    expect(healthy).toMatchObject({
      name: "CH1.FB1",
      status: "healthy",
      componentType: "fb",
      details: { slot: "1" },
    });
    expect(entry(b, StorageArrayResourceKind.Hardware, "CH1.FB2").status).toBe(
      "unhealthy",
    );
    expect(entry(b, StorageArrayResourceKind.Hardware, "CH1.FB15").status).toBe(
      "unused",
    );
    expect(entry(b, StorageArrayResourceKind.Hardware, "CH1.PWR1").status).toBe(
      "unhealthy",
    );

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    // An empty slot is a component, but not an unhealthy one.
    expect(extras.hardwareComponentCount).toBe(4);
    expect(extras.unhealthyHardwareCount).toBe(2);
  });

  test("a blade without its name label is skipped", () => {
    const b: Buffers = buffers();
    feed(b, "purefb_hardware_health", { type: "fb", slot: "3" }, 0);
    expect(entries(b)).toHaveLength(0);
    expect(snapOf(b)?.sawHardware).toBe(false);
  });

  test("slot 0 is kept as a detail", () => {
    const b: Buffers = buffers();
    fbHardware(b, "CH1.FM0", "fm", 1, "0");
    expect(
      entry(b, StorageArrayResourceKind.Hardware, "CH1.FM0").details,
    ).toEqual({ slot: "0" });
  });
});

describe("StorageArraySnapshotScan - FlashArray volumes", () => {
  test("performance series land in columns by their dimension label", () => {
    const b: Buffers = buffers();
    const vol: string = "vmfs-prod-01";
    const latency: string = "purefa_volume_performance_latency_usec";
    faVolume(b, latency, vol, { dimension: "usec_per_read_op" }, 250.5);
    faVolume(b, latency, vol, { dimension: "usec_per_write_op" }, 410);
    // Breakdowns stay in ClickHouse for the charts.
    faVolume(b, latency, vol, { dimension: "queue_usec_per_read_op" }, 9999);
    faVolume(b, latency, vol, { dimension: "san_usec_per_write_op" }, 8888);
    faVolume(
      b,
      latency,
      vol,
      { dimension: "usec_per_mirrored_write_op" },
      7777,
    );
    const iops: string = "purefa_volume_performance_throughput_iops";
    faVolume(b, iops, vol, { dimension: "reads_per_sec" }, 1200.7);
    faVolume(b, iops, vol, { dimension: "writes_per_sec" }, 800);
    faVolume(b, iops, vol, { dimension: "mirrored_writes_per_sec" }, 6666);
    const bandwidth: string = "purefa_volume_performance_bandwidth_bytes";
    faVolume(b, bandwidth, vol, { dimension: "read_bytes_per_sec" }, 52428800);
    faVolume(b, bandwidth, vol, { dimension: "write_bytes_per_sec" }, 10485760);

    expect(entry(b, StorageArrayResourceKind.Volume, vol)).toMatchObject({
      name: vol,
      readLatencyUsec: 250.5,
      writeLatencyUsec: 410,
      readIops: 1200.7,
      writeIops: 800,
      readBytesPerSec: 52428800,
      writeBytesPerSec: 10485760,
    });
    expect(entries(b)).toHaveLength(1);
  });

  test("space: total_provisioned is the size, total_physical what it occupies, in whole bytes", () => {
    const b: Buffers = buffers();
    const space: string = "purefa_volume_space_bytes";
    faVolume(b, space, "vol1", { space: "total_provisioned" }, TIB);
    faVolume(b, space, "vol1", { space: "total_physical" }, 214748364.8);
    faVolume(b, space, "vol1", { space: "snapshots" }, 5 * TIB);
    faVolume(b, space, "vol1", { space: "unique" }, 4 * TIB);
    feed(b, "purefa_volume_space_data_reduction_ratio", { name: "vol1" }, 3.7);

    expect(entry(b, StorageArrayResourceKind.Volume, "vol1")).toMatchObject({
      capacityBytes: TIB,
      usedBytes: 214748364,
      dataReductionRatio: 3.7,
    });
  });

  test("naa_id becomes details.naaId; QoS limits become details", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_volume_qos_iops_limit",
      { name: "vol1", naa_id: "naa.624a93701c0d5e1a00000001" },
      50000,
    );
    feed(
      b,
      "purefa_volume_qos_bandwidth_bytes_per_sec_limit",
      { name: "vol1", naa_id: "naa.624a93701c0d5e1a00000001" },
      524288000,
    );

    expect(entry(b, StorageArrayResourceKind.Volume, "vol1").details).toEqual({
      naaId: "naa.624a93701c0d5e1a00000001",
      qosIopsLimit: 50000,
      qosBandwidthBytesPerSecLimit: 524288000,
    });
  });

  test("groupName is the pod, else the volume group; Pure's empty labels count as absent", () => {
    const b: Buffers = buffers();
    const space: string = "purefa_volume_space_bytes";
    faVolume(
      b,
      space,
      "pod1::stretched-01",
      { pod: "pod1", volume_group: "", space: "total_provisioned" },
      TIB,
    );
    faVolume(
      b,
      space,
      "vg1/data-01",
      { pod: "", volume_group: "vg1", space: "total_provisioned" },
      TIB,
    );
    faVolume(
      b,
      space,
      "standalone",
      { pod: "", volume_group: "", space: "total_provisioned" },
      TIB,
    );

    expect(
      entry(b, StorageArrayResourceKind.Volume, "pod1::stretched-01").groupName,
    ).toBe("pod1");
    expect(
      entry(b, StorageArrayResourceKind.Volume, "vg1/data-01").groupName,
    ).toBe("vg1");
    expect(
      entry(b, StorageArrayResourceKind.Volume, "standalone").groupName,
    ).toBeNull();
  });

  test("a performance series without the group labels never blanks the group", () => {
    const b: Buffers = buffers();
    faVolume(
      b,
      "purefa_volume_space_bytes",
      "pod1::v",
      { pod: "pod1", space: "total_physical" },
      1,
    );
    faVolume(
      b,
      "purefa_volume_performance_latency_usec",
      "pod1::v",
      { dimension: "usec_per_read_op" },
      100,
      BASE_MS + 1000,
    );
    expect(entry(b, StorageArrayResourceKind.Volume, "pod1::v").groupName).toBe(
      "pod1",
    );
  });

  test("negative performance readings clamp to 0", () => {
    const b: Buffers = buffers();
    faVolume(
      b,
      "purefa_volume_performance_latency_usec",
      "vol1",
      { dimension: "usec_per_read_op" },
      -3,
    );
    faVolume(
      b,
      "purefa_volume_space_bytes",
      "vol1",
      { space: "total_physical" },
      -10,
    );
    expect(entry(b, StorageArrayResourceKind.Volume, "vol1")).toMatchObject({
      readLatencyUsec: 0,
      usedBytes: 0,
    });
  });

  test("a series with only an unmapped dimension is still a sighting of the volume", () => {
    const b: Buffers = buffers();
    faVolume(
      b,
      "purefa_volume_performance_latency_usec",
      "quiet-volume",
      { dimension: "queue_usec_per_write_op" },
      12,
    );
    const quiet: StorageArrayResourceBufferEntry = entry(
      b,
      StorageArrayResourceKind.Volume,
      "quiet-volume",
    );
    expect(quiet.readLatencyUsec).toBeNull();
    expect(quiet.writeLatencyUsec).toBeNull();
    expect(derive(b).volumeCount).toBe(1);
  });

  test("a volume series without a name is skipped and is not a volumes sighting", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_volume_space_bytes",
      { naa_id: "naa.1", space: "total_provisioned" },
      TIB,
    );
    expect(entries(b)).toHaveLength(0);
    expect(snapOf(b)?.sawVolumes).toBe(false);
    expect("volumeCount" in derive(b)).toBe(false);
  });

  test("volumeCount counts distinct volumes across every volume family", () => {
    const b: Buffers = buffers();
    faInfo(b, "volumes");
    for (const name of ["a", "b", "c"]) {
      faVolume(
        b,
        "purefa_volume_space_bytes",
        name,
        { space: "total_provisioned" },
        TIB,
      );
      faVolume(
        b,
        "purefa_volume_performance_throughput_iops",
        name,
        { dimension: "reads_per_sec" },
        10,
      );
    }
    expect(derive(b).volumeCount).toBe(3);
    expect(ofKind(entries(b), StorageArrayResourceKind.Volume)).toHaveLength(3);
  });
});

describe("StorageArraySnapshotScan - FlashArray hosts and connections", () => {
  test("connectivity: status and details", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_host_connectivity_info",
      { host: "esx-01", status: "healthy", details: "Redundant" },
      1,
    );
    feed(
      b,
      "purefa_host_connectivity_info",
      { host: "esx-02", status: "Critical", details: "Single Controller" },
      1,
    );

    expect(entry(b, StorageArrayResourceKind.Host, "esx-01")).toMatchObject({
      name: "esx-01",
      status: "healthy",
      statusDetail: "Redundant",
    });
    expect(entry(b, StorageArrayResourceKind.Host, "esx-02")).toMatchObject({
      status: "critical",
      statusDetail: "Single Controller",
    });
  });

  test("performance and space map like a volume's", () => {
    const b: Buffers = buffers();
    const host: LabelMap = { host: "esx-01" };
    feed(
      b,
      "purefa_host_performance_latency_usec",
      { ...host, dimension: "usec_per_read_op" },
      300,
    );
    feed(
      b,
      "purefa_host_performance_latency_usec",
      { ...host, dimension: "usec_per_write_op" },
      450,
    );
    feed(
      b,
      "purefa_host_performance_throughput_iops",
      { ...host, dimension: "reads_per_sec" },
      100,
    );
    feed(
      b,
      "purefa_host_performance_throughput_iops",
      { ...host, dimension: "writes_per_sec" },
      200,
    );
    feed(
      b,
      "purefa_host_performance_bandwidth_bytes",
      { ...host, dimension: "read_bytes_per_sec" },
      1000,
    );
    feed(
      b,
      "purefa_host_performance_bandwidth_bytes",
      { ...host, dimension: "write_bytes_per_sec" },
      2000,
    );
    feed(
      b,
      "purefa_host_space_bytes",
      { ...host, space: "total_provisioned" },
      8 * TIB,
    );
    feed(
      b,
      "purefa_host_space_bytes",
      { ...host, space: "total_physical" },
      2 * TIB,
    );
    feed(b, "purefa_host_space_data_reduction_ratio", host, 5.5);

    expect(entry(b, StorageArrayResourceKind.Host, "esx-01")).toMatchObject({
      readLatencyUsec: 300,
      writeLatencyUsec: 450,
      readIops: 100,
      writeIops: 200,
      readBytesPerSec: 1000,
      writeBytesPerSec: 2000,
      capacityBytes: 8 * TIB,
      usedBytes: 2 * TIB,
      dataReductionRatio: 5.5,
    });
  });

  test("connections: a host counts its volumes, a volume its hosts, the host group is recorded", () => {
    const b: Buffers = buffers();
    faInfo(b, "volumes");
    for (const name of ["vmfs-prod-01", "vmfs-prod-02", "vmfs-test-01"]) {
      faVolume(
        b,
        "purefa_volume_space_bytes",
        name,
        { space: "total_provisioned" },
        TIB,
      );
    }
    faInfo(b, "hosts");
    faConnection(b, "esx-01", "vmfs-prod-01", "esx-cluster");
    faConnection(b, "esx-01", "vmfs-prod-02", "esx-cluster");
    faConnection(b, "esx-02", "vmfs-prod-01", "esx-cluster");
    // The same pair in a second scrape of the batch counts once.
    faConnection(b, "esx-02", "vmfs-prod-01", "esx-cluster", BASE_MS + 60_000);

    const all: Array<StorageArrayResourceBufferEntry> = rows(b);
    const byId: (
      kind: StorageArrayResourceKind,
      id: string,
    ) => StorageArrayResourceBufferEntry | undefined = (
      kind: StorageArrayResourceKind,
      id: string,
    ): StorageArrayResourceBufferEntry | undefined => {
      return all.find((e: StorageArrayResourceBufferEntry) => {
        return e.kind === kind && e.externalId === id;
      });
    };

    expect(byId(StorageArrayResourceKind.Host, "esx-01")).toMatchObject({
      connectionCount: 2,
      groupName: "esx-cluster",
    });
    expect(byId(StorageArrayResourceKind.Host, "esx-02")?.connectionCount).toBe(
      1,
    );
    expect(
      byId(StorageArrayResourceKind.Volume, "vmfs-prod-01")?.connectionCount,
    ).toBe(2);
    expect(
      byId(StorageArrayResourceKind.Volume, "vmfs-prod-02")?.connectionCount,
    ).toBe(1);
    // A volume the batch reported with no connection is connected to nobody.
    expect(
      byId(StorageArrayResourceKind.Volume, "vmfs-test-01")?.connectionCount,
    ).toBe(0);
    expect(snapOf(b)?.connectionsObservedAt).toEqual(
      new Date(BASE_MS + 60_000),
    );

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.volumeCount).toBe(3);
    expect(extras.hostCount).toBe(2);
  });

  test("a private connection's empty hostgroup never hides the host's group", () => {
    const b: Buffers = buffers();
    faConnection(b, "esx-01", "boot-lun-01", "");
    faConnection(b, "esx-01", "vmfs-prod-01", "esx-cluster");
    expect(entry(b, StorageArrayResourceKind.Host, "esx-01").groupName).toBe(
      "esx-cluster",
    );
  });

  test("a host the hosts endpoint listed without a connection is connected to 0 volumes", () => {
    const b: Buffers = buffers();
    faInfo(b, "hosts");
    feed(
      b,
      "purefa_host_connectivity_info",
      { host: "idle-host", status: "unused", details: "Unused Port" },
      1,
    );
    faConnection(b, "esx-01", "vmfs-prod-01");
    // A connection series whose volume label is empty: a host with nothing.
    feed(
      b,
      "purefa_host_connections_info",
      { host: "empty-host", hostgroup: "", volume: "" },
      1,
    );

    const all: Array<StorageArrayResourceBufferEntry> = rows(b);
    const hostCount: (id: string) => number | null | undefined = (
      id: string,
    ): number | null | undefined => {
      return all.find((e: StorageArrayResourceBufferEntry) => {
        return e.kind === StorageArrayResourceKind.Host && e.externalId === id;
      })?.connectionCount;
    };
    expect(hostCount("idle-host")).toBe(0);
    expect(hostCount("empty-host")).toBe(0);
    expect(hostCount("esx-01")).toBe(1);
    expect(snapOf(b)?.volumesByHost.get("empty-host")?.size).toBe(0);
    expect(derive(b).hostCount).toBe(3);
  });

  test("without a connections series the rows pass through untouched", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_host_connectivity_info",
      { host: "esx-01", status: "healthy", details: "Redundant" },
      1,
    );
    faVolume(
      b,
      "purefa_volume_space_bytes",
      "vol1",
      { space: "total_provisioned" },
      TIB,
    );

    const list: Array<StorageArrayResourceBufferEntry> = entries(b);
    // Same array back: a volumes scrape never zeroes a hosts-scrape count.
    expect(getStorageArrayResourceRows(list, snapOf(b))).toBe(list);
    expect(getStorageArrayResourceRows(list, undefined)).toBe(list);
    for (const row of list) {
      expect(row.connectionCount).toBeNull();
    }
  });

  test("volumes only seen through connections get a row carrying connectionCount alone", () => {
    const b: Buffers = buffers();
    faInfo(b, "hosts");
    faConnection(b, "esx-01", "vmfs-prod-01", "esx-cluster", BASE_MS);
    faConnection(b, "esx-02", "vmfs-prod-01", "esx-cluster", BASE_MS + 5_000);
    faConnection(b, "esx-02", "pod1::stretched-01", "", BASE_MS + 5_000);

    const volumes: Array<StorageArrayResourceBufferEntry> = ofKind(
      rows(b),
      StorageArrayResourceKind.Volume,
    );
    expect(
      volumes
        .map((v: StorageArrayResourceBufferEntry) => {
          return v.externalId;
        })
        .sort(),
    ).toEqual(["pod1::stretched-01", "vmfs-prod-01"]);

    const prod: StorageArrayResourceBufferEntry = volumes.find(
      (v: StorageArrayResourceBufferEntry) => {
        return v.externalId === "vmfs-prod-01";
      },
    )!;
    expect(prod).toEqual({
      ...emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.Volume,
        "vmfs-prod-01",
        new Date(BASE_MS + 5_000),
      ),
      name: "vmfs-prod-01",
      connectionCount: 2,
      fromConnectionsOnly: true,
    });
    // The buffer itself never grows a volume entry.
    expect(ofKind(entries(b), StorageArrayResourceKind.Volume)).toHaveLength(0);
  });

  test("REGRESSION: a volumes scrape with no volume series and a hosts scrape naming two volumes reports volumeCount 0", () => {
    /*
     * Replayed from real collector output: one request carried the volumes
     * scrape (purefa_info{scrape_endpoint="volumes"} and zero purefa_volume_*
     * series — the array has no volumes) plus the hosts scrape whose
     * purefa_host_connections_info still named two volumes. The synthesized
     * connection rows were counted, and the array reported 2 volumes.
     */
    const b: Buffers = buffers();
    faInfo(b, "volumes");
    faInfo(b, "hosts");
    feed(
      b,
      "purefa_host_connectivity_info",
      { host: "esx-01", status: "healthy", details: "Redundant" },
      1,
    );
    faConnection(b, "esx-01", "vmfs-prod-01", "esx-cluster");
    faConnection(b, "esx-01", "pod1::stretched-01", "esx-cluster");

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.volumeCount).toBe(0);
    expect(extras.hostCount).toBe(1);

    // The two rows still ride the upsert, carrying their connection count.
    const volumes: Array<StorageArrayResourceBufferEntry> = ofKind(
      rows(b),
      StorageArrayResourceKind.Volume,
    );
    expect(volumes).toHaveLength(2);
    for (const volume of volumes) {
      expect(volume.connectionCount).toBe(1);
      expect(volume.fromConnectionsOnly).toBe(true);
      expect(volume.capacityBytes).toBeNull();
      expect(volume.status).toBeNull();
      expect(volume.details).toEqual({});
    }
  });

  test("REGRESSION: a hosts-only batch writes no volumeCount at all", () => {
    const b: Buffers = buffers();
    faInfo(b, "hosts");
    faConnection(b, "esx-01", "vmfs-prod-01");
    faConnection(b, "esx-01", "pod1::stretched-01");

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect("volumeCount" in extras).toBe(false);
    expect(extras.hostCount).toBe(1);
    expect(ofKind(rows(b), StorageArrayResourceKind.Volume)).toHaveLength(2);
  });

  test("real volumes count, connection-only ones never do", () => {
    const b: Buffers = buffers();
    faInfo(b, "volumes");
    faVolume(
      b,
      "purefa_volume_space_bytes",
      "vmfs-prod-01",
      { space: "total_provisioned" },
      TIB,
    );
    faInfo(b, "hosts");
    faConnection(b, "esx-01", "vmfs-prod-01");
    faConnection(b, "esx-01", "deleted-meanwhile");

    expect(derive(b).volumeCount).toBe(1);
    const real: StorageArrayResourceBufferEntry | undefined = rows(b).find(
      (e: StorageArrayResourceBufferEntry) => {
        return e.externalId === "vmfs-prod-01";
      },
    );
    expect(real?.fromConnectionsOnly).toBeUndefined();
    expect(real?.connectionCount).toBe(1);
  });

  test("a host series without its host label is skipped", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_host_connections_info",
      { hostgroup: "hg", volume: "v" },
      1,
    );
    feed(b, "purefa_host_space_data_reduction_ratio", {}, 2);
    expect(entries(b)).toHaveLength(0);
    expect(snapOf(b)?.sawHosts).toBe(false);
    expect(snapOf(b)?.connectionsObservedAt).toBeNull();
  });
});

/*
 * Which volumes keep a connection count after a batch: everything else of
 * the array is reset to 0 by StorageArrayResourceService.
 * resetVolumeConnectionCounts — so null (reset nothing) is the answer
 * whenever the batch cannot see every connection.
 */
describe("StorageArraySnapshotScan - volume connection counts (getVolumeConnectionCounts)", () => {
  test("counts each connected volume's hosts for a complete hosts batch", () => {
    const b: Buffers = buffers();
    feed(b, "purefa_info", { array_name: "fa", scrape_endpoint: "hosts" }, 1);
    for (const [host, volume] of [
      ["esx-01", "vol-a"],
      ["esx-02", "vol-a"],
      ["esx-01", "vol-b"],
    ]) {
      feed(
        b,
        "purefa_host_connections_info",
        { host: host!, hostgroup: "cluster", volume: volume! },
        1,
      );
    }

    expect(getVolumeConnectionCounts(rows(b), snapOf(b))).toEqual({
      "vol-a": 2,
      "vol-b": 1,
    });
  });

  test("is null whenever the batch does not know every connection", () => {
    const b: Buffers = buffers();
    feed(b, "purefa_info", { array_name: "fa", scrape_endpoint: "volumes" }, 1);
    expect(getVolumeConnectionCounts(rows(b), snapOf(b))).toBeNull();
    expect(getVolumeConnectionCounts([], undefined)).toBeNull();
  });

  test("a hosts batch with no host at all knows nothing is connected", () => {
    const b: Buffers = buffers();
    feed(b, "purefa_info", { array_name: "fa", scrape_endpoint: "hosts" }, 1);
    expect(getVolumeConnectionCounts(rows(b), snapOf(b))).toEqual({});
  });
});

describe("StorageArraySnapshotScan - volumes to keep connected (getConnectedVolumeNames)", () => {
  function connected(b: Buffers): Array<string> | null {
    return getConnectedVolumeNames(rows(b), snapOf(b));
  }

  test("a hosts scrape names every connected volume once, sorted", () => {
    const b: Buffers = buffers();
    faInfo(b, "hosts");
    faConnection(b, "esx-02", "vol-web-01", "esx-cluster");
    faConnection(b, "esx-01", "vol-db-01", "esx-cluster");
    faConnection(b, "esx-02", "vol-db-01", "esx-cluster");
    // A host with nothing connected names no volume.
    feed(
      b,
      "purefa_host_connections_info",
      { host: "idle-host", hostgroup: "", volume: "" },
      1,
    );

    expect(connected(b)).toEqual(["vol-db-01", "vol-web-01"]);
  });

  test("without the scrape_endpoint label the host series alone mark the complete list", () => {
    const b: Buffers = buffers();
    faConnection(b, "esx-01", "vol-db-01");

    expect(snapOf(b)?.sawHosts).toBe(true);
    expect(connected(b)).toEqual(["vol-db-01"]);
  });

  test("a hosts scrape that listed no host at all has nothing connected", () => {
    const b: Buffers = buffers();
    faInfo(b, "hosts");

    expect(snapOf(b)?.sawHosts).toBe(true);
    expect(snapOf(b)?.connectionsObservedAt).toBeNull();
    expect(connected(b)).toEqual([]);
  });

  test("hosts whose connections series was filtered out reset nothing", () => {
    const b: Buffers = buffers();
    faInfo(b, "hosts");
    feed(
      b,
      "purefa_host_connectivity_info",
      { host: "esx-01", status: "healthy", details: "Redundant" },
      1,
    );

    expect(snapOf(b)?.sawHosts).toBe(true);
    expect(connected(b)).toBeNull();
  });

  test("a batch without the hosts endpoint resets nothing", () => {
    for (const endpoint of ["array", "volumes", "pods", "directories"]) {
      const b: Buffers = buffers();
      faInfo(b, endpoint);
      faVolume(
        b,
        "purefa_volume_space_bytes",
        "vol-db-01",
        { space: "total_provisioned" },
        TIB,
      );

      expect({ endpoint, connected: connected(b) }).toEqual({
        endpoint,
        connected: null,
      });
    }
    expect(getConnectedVolumeNames([], undefined)).toBeNull();
  });

  test("a FlashArray `all` scrape is complete; a FlashBlade one has no hosts to speak of", () => {
    const fa: Buffers = buffers();
    faInfo(fa, "all");
    faConnection(fa, "esx-01", "vol-db-01");
    expect(connected(fa)).toEqual(["vol-db-01"]);

    const fb: Buffers = buffers();
    fbInfo(fb, "all");
    expect(snapOf(fb)?.sawHosts).toBe(false);
    expect(connected(fb)).toBeNull();
  });
});

describe("StorageArraySnapshotScan - the platform to write (resolveStorageArraySystem)", () => {
  test("the metric names win over a declaration that disagrees", () => {
    // A FlashBlade .env without STORAGE_SYSTEM declares the compose default.
    expect(
      resolveStorageArraySystem({
        derived: StorageSystem.PureStorageFlashBlade,
        declared: StorageSystem.PureStorageFlashArray,
      }),
    ).toBe(StorageSystem.PureStorageFlashBlade);
  });

  test("a platform with no catalog is taken from the declaration", () => {
    expect(
      resolveStorageArraySystem({
        derived: undefined,
        declared: "netapp.ontap",
      }),
    ).toBe("netapp.ontap");
  });

  test("a known platform is never taken from the declaration alone", () => {
    // A batch with no Pure series (a failed scrape's `up`) writes nothing.
    for (const declared of Object.values(StorageSystem) as Array<string>) {
      expect(
        resolveStorageArraySystem({ derived: undefined, declared }),
      ).toBeUndefined();
    }
  });

  test("nothing derived and nothing declared writes nothing", () => {
    expect(
      resolveStorageArraySystem({ derived: undefined, declared: undefined }),
    ).toBeUndefined();
    expect(
      resolveStorageArraySystem({ derived: null, declared: null }),
    ).toBeUndefined();
    expect(resolveStorageArraySystem({ derived: "", declared: "" })).toBe(
      undefined,
    );
  });

  test("the snapshot's derived platform is what the flush passes as derived", () => {
    const b: Buffers = buffers();
    fbInfo(b, "array");
    expect(
      resolveStorageArraySystem({
        derived: derive(b).storageSystem,
        declared: StorageSystem.PureStorageFlashArray,
      }),
    ).toBe(StorageSystem.PureStorageFlashBlade);
  });
});

describe("StorageArraySnapshotScan - FlashArray pods and replication", () => {
  test("pod performance, space and data reduction come from the `name` label", () => {
    const b: Buffers = buffers();
    const pod: LabelMap = { name: "pod1" };
    feed(
      b,
      "purefa_pod_performance_latency_usec",
      { ...pod, dimension: "usec_per_read_op" },
      150,
    );
    feed(
      b,
      "purefa_pod_performance_latency_usec",
      { ...pod, dimension: "usec_per_mirrored_write_op" },
      900,
    );
    feed(
      b,
      "purefa_pod_performance_throughput_iops",
      { ...pod, dimension: "writes_per_sec" },
      300,
    );
    feed(
      b,
      "purefa_pod_performance_bandwidth_bytes",
      { ...pod, dimension: "read_bytes_per_sec" },
      4096,
    );
    feed(
      b,
      "purefa_pod_space_bytes",
      { ...pod, space: "total_provisioned" },
      10 * TIB,
    );
    feed(b, "purefa_pod_space_bytes", { ...pod, space: "total_physical" }, TIB);
    feed(b, "purefa_pod_space_data_reduction_ratio", pod, 6.1);

    expect(entry(b, StorageArrayResourceKind.Pod, "pod1")).toMatchObject({
      name: "pod1",
      readLatencyUsec: 150,
      writeLatencyUsec: null,
      writeIops: 300,
      readBytesPerSec: 4096,
      capacityBytes: 10 * TIB,
      usedBytes: TIB,
      dataReductionRatio: 6.1,
    });
  });

  test("a replica link names its pod `local_pod` and carries lag, status and peer", () => {
    const b: Buffers = buffers();
    faReplicaLag(b, "pod1", "pod1-dr", "Replicating", 1500);

    expect(entry(b, StorageArrayResourceKind.Pod, "pod1")).toMatchObject({
      name: "pod1",
      replicationLagMs: 1500,
      status: "replicating",
      details: {
        remote: "pure-dr-01",
        remotePod: "pod1-dr",
        direction: "outbound",
      },
    });
  });

  test.each([
    ["the worst link first", false],
    ["the worst link last", true],
  ])(
    "REGRESSION: the pod takes the worst link's lag AND status, %s",
    (_: string, worstLast: boolean) => {
      /*
       * Two links of one pod share a scrape timestamp. Newest-wins used to
       * hand the pod whichever link was folded last — a paused link's
       * status next to the other link's lag.
       */
      const b: Buffers = buffers();
      const worst: () => void = (): void => {
        faReplicaLag(b, "pod1", "pod1-dr", "replicating", 1500);
      };
      const better: () => void = (): void => {
        faReplicaLag(b, "pod1", "pod1-dr2", "paused", 900);
      };
      if (worstLast) {
        better();
        worst();
      } else {
        worst();
        better();
      }

      const pod: StorageArrayResourceBufferEntry = entry(
        b,
        StorageArrayResourceKind.Pod,
        "pod1",
      );
      expect(pod.replicationLagMs).toBe(1500);
      expect(pod.status).toBe("replicating");
    },
  );

  test.each([
    ["the worst link first", false],
    ["the worst link last", true],
  ])(
    "the link details describe the same (worst) link as the lag, %s",
    (_: string, worstLast: boolean) => {
      // Otherwise the pod would show one link's lag next to another's peer.
      const b: Buffers = buffers();
      const worst: () => void = (): void => {
        faReplicaLag(
          b,
          "pod1",
          "pod1-dr",
          "replicating",
          1500,
          undefined,
          "pure-dr-01",
        );
      };
      const better: () => void = (): void => {
        faReplicaLag(
          b,
          "pod1",
          "pod1-dr2",
          "paused",
          900,
          undefined,
          "pure-dr-02",
        );
      };
      if (worstLast) {
        better();
        worst();
      } else {
        worst();
        better();
      }

      expect(entry(b, StorageArrayResourceKind.Pod, "pod1").details).toEqual({
        remote: "pure-dr-01",
        remotePod: "pod1-dr",
        direction: "outbound",
      });
    },
  );

  test("a pod's other details still merge newest-wins around its link details", () => {
    const b: Buffers = buffers();
    faReplicaLag(b, "pod1", "pod1-dr", "replicating", 1500);
    feed(
      b,
      "purefa_pod_mediator_status",
      {
        array: "pure-prod-01",
        mediator: "purestorage",
        pod: "pod1",
        status: "online",
      },
      1,
    );
    faReplicaLag(b, "pod1", "pod1-dr2", "paused", 10, undefined, "pure-dr-02");

    expect(entry(b, StorageArrayResourceKind.Pod, "pod1").details).toEqual({
      remote: "pure-dr-01",
      remotePod: "pod1-dr",
      direction: "outbound",
      mediatorStatus: "online",
    });
  });

  test("a later scrape with a smaller lag does not lower the batch's worst lag", () => {
    const b: Buffers = buffers();
    faReplicaLag(b, "pod1", "pod1-dr", "replicating", 4000, BASE_MS);
    faReplicaLag(b, "pod1", "pod1-dr", "replicating", 100, BASE_MS + 60_000);
    expect(
      entry(b, StorageArrayResourceKind.Pod, "pod1").replicationLagMs,
    ).toBe(4000);
  });

  test("the average lag is a detail, never the pod's lag", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_pod_replica_links_lag_average_msec",
      {
        remote: "pure-dr-01",
        local_pod: "pod1",
        remote_pod: "pod1-dr",
        direction: "outbound",
        status: "replicating",
      },
      350,
    );
    const pod: StorageArrayResourceBufferEntry = entry(
      b,
      StorageArrayResourceKind.Pod,
      "pod1",
    );
    expect(pod.details).toEqual({ averageLagMs: 350 });
    expect(pod.replicationLagMs).toBeNull();
    expect(pod.status).toBeNull();
  });

  test("other pod series never override the replica link status", () => {
    const b: Buffers = buffers();
    faReplicaLag(b, "pod1", "pod1-dr", "replicating", 10, BASE_MS);
    feed(
      b,
      "purefa_pod_space_bytes",
      { name: "pod1", space: "total_physical" },
      TIB,
      BASE_MS + 60_000,
    );
    expect(entry(b, StorageArrayResourceKind.Pod, "pod1").status).toBe(
      "replicating",
    );
  });

  test("mediator status: named by `pod`, lowercased", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_pod_mediator_status",
      {
        array: "pure-prod-01",
        mediator: "purestorage",
        pod: "pod1",
        status: "Online",
      },
      1,
    );
    expect(entry(b, StorageArrayResourceKind.Pod, "pod1").details).toEqual({
      mediatorStatus: "online",
    });
  });

  test.each([
    ["online then unreachable", ["online", "unreachable"], "unreachable"],
    ["unreachable then online", ["unreachable", "online"], "unreachable"],
    ["both online", ["online", "online"], "online"],
  ])(
    "a stretched pod's mediator shows the worst array's view: %s",
    (_: string, statuses: Array<string>, expected: string) => {
      /*
       * The pod reports its mediator once per array it spans, in one scrape:
       * one array that cannot reach the mediator is the fact worth showing,
       * whatever the series order.
       */
      const b: Buffers = buffers();
      const arrays: Array<string> = ["pure-prod-01", "pure-prod-02"];
      statuses.forEach((status: string, index: number) => {
        feed(
          b,
          "purefa_pod_mediator_status",
          {
            array: arrays[index]!,
            mediator: "purestorage",
            pod: "pod1",
            status,
          },
          status === "online" ? 1 : 0,
        );
      });
      expect(
        entry(b, StorageArrayResourceKind.Pod, "pod1").details[
          "mediatorStatus"
        ],
      ).toBe(expected);
    },
  );

  test("podCount counts pods from every pod family", () => {
    const b: Buffers = buffers();
    faInfo(b, "pods");
    feed(
      b,
      "purefa_pod_space_bytes",
      { name: "pod1", space: "total_physical" },
      TIB,
    );
    faReplicaLag(b, "pod2", "pod2-dr", "replicating", 10);
    feed(
      b,
      "purefa_pod_mediator_status",
      { array: "a", mediator: "m", pod: "pod3", status: "online" },
      1,
    );
    expect(derive(b).podCount).toBe(3);
  });

  test("a pod series without its pod label is skipped", () => {
    const b: Buffers = buffers();
    feed(b, "purefa_pod_space_data_reduction_ratio", {}, 2);
    feed(
      b,
      "purefa_pod_replica_links_lag_max_msec",
      { remote: "r", remote_pod: "rp", direction: "outbound", status: "x" },
      5,
    );
    feed(
      b,
      "purefa_pod_mediator_status",
      { array: "a", mediator: "m", status: "online" },
      1,
    );
    expect(entries(b)).toHaveLength(0);
    expect(snapOf(b)?.sawPods).toBe(false);
  });
});

describe("StorageArraySnapshotScan - FlashArray network interfaces", () => {
  test("speed series: enabled/disabled status, speed, services, subtype, type", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_network_interface_speed_bandwidth_bytes",
      {
        enabled: "true",
        ethsubtype: "physical",
        name: "ct0.eth4",
        services: "iscsi, replication",
        type: "eth",
      },
      3125000000,
    );
    feed(
      b,
      "purefa_network_interface_speed_bandwidth_bytes",
      {
        enabled: "FALSE",
        ethsubtype: "",
        name: "ct0.fc0",
        services: "",
        type: "fc",
      },
      4000000000,
    );
    feed(
      b,
      "purefa_network_interface_speed_bandwidth_bytes",
      { enabled: "maybe", name: "ct1.eth0", type: "eth" },
      1,
    );

    expect(
      entry(b, StorageArrayResourceKind.NetworkInterface, "ct0.eth4"),
    ).toMatchObject({
      name: "ct0.eth4",
      status: "enabled",
      componentType: "eth",
      details: {
        speedBytesPerSec: 3125000000,
        services: "iscsi, replication",
        ethSubtype: "physical",
      },
    });
    const fc: StorageArrayResourceBufferEntry = entry(
      b,
      StorageArrayResourceKind.NetworkInterface,
      "ct0.fc0",
    );
    expect(fc.status).toBe("disabled");
    expect(fc.componentType).toBe("fc");
    // Empty labels are absent, not "".
    expect(fc.details).toEqual({ speedBytesPerSec: 4000000000 });
    expect(
      entry(b, StorageArrayResourceKind.NetworkInterface, "ct1.eth0").status,
    ).toBeNull();
  });

  test("bandwidth and error rates land in details by dimension", () => {
    const b: Buffers = buffers();
    const nic: LabelMap = { name: "ct0.eth4", type: "eth" };
    feed(
      b,
      "purefa_network_interface_performance_bandwidth_bytes",
      { ...nic, dimension: "received_bytes_per_sec" },
      1000,
    );
    feed(
      b,
      "purefa_network_interface_performance_bandwidth_bytes",
      { ...nic, dimension: "transmitted_bytes_per_sec" },
      2000,
    );
    feed(
      b,
      "purefa_network_interface_performance_errors",
      { ...nic, dimension: "total_errors_per_sec" },
      0.5,
    );
    feed(
      b,
      "purefa_network_interface_performance_errors",
      { ...nic, dimension: "received_crc_errors_per_sec" },
      0.4,
    );

    expect(
      entry(b, StorageArrayResourceKind.NetworkInterface, "ct0.eth4").details,
    ).toEqual({
      receivedBytesPerSec: 1000,
      transmittedBytesPerSec: 2000,
      errorsPerSec: 0.5,
    });
  });

  test("a series with only an unmapped dimension creates no interface row", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_network_interface_performance_errors",
      { name: "ct0.eth9", type: "eth", dimension: "other_errors_per_sec" },
      3,
    );
    feed(
      b,
      "purefa_network_interface_performance_bandwidth_bytes",
      { name: "ct0.eth9", type: "eth", dimension: "something_new" },
      3,
    );
    expect(entries(b)).toHaveLength(0);
  });

  test("interfaces are neither hardware components nor unhealthy hardware", () => {
    const b: Buffers = buffers();
    faInfo(b, "array");
    faHw(b, "CT0", "controller", "ok");
    feed(
      b,
      "purefa_network_interface_speed_bandwidth_bytes",
      { enabled: "false", name: "ct0.eth1", type: "eth" },
      0,
    );

    const extras: StorageArraySnapshotDerivedExtras = derive(b);
    expect(extras.hardwareComponentCount).toBe(1);
    expect(extras.unhealthyHardwareCount).toBe(0);
    expect(extras.healthStatus).toBe(StorageArrayHealthStatus.Ok);
  });

  test("an interface series without a name is skipped", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefa_network_interface_speed_bandwidth_bytes",
      { enabled: "true", type: "eth" },
      1,
    );
    expect(entries(b)).toHaveLength(0);
  });
});

describe("StorageArraySnapshotScan - FlashArray directories", () => {
  test("space and performance become a Directory row", () => {
    const b: Buffers = buffers();
    const dir: LabelMap = { name: "fs1:root" };
    feed(
      b,
      "purefa_directory_space_bytes",
      { ...dir, space: "total_provisioned" },
      2 * TIB,
    );
    feed(
      b,
      "purefa_directory_space_bytes",
      { ...dir, space: "total_physical" },
      TIB,
    );
    feed(b, "purefa_directory_space_data_reduction_ratio", dir, 1.8);
    feed(
      b,
      "purefa_directory_performance_latency_usec",
      { ...dir, dimension: "usec_per_write_op" },
      700,
    );
    feed(
      b,
      "purefa_directory_performance_throughput_iops",
      { ...dir, dimension: "reads_per_sec" },
      40,
    );
    feed(
      b,
      "purefa_directory_performance_bandwidth_bytes",
      { ...dir, dimension: "write_bytes_per_sec" },
      8192,
    );

    expect(
      entry(b, StorageArrayResourceKind.Directory, "fs1:root"),
    ).toMatchObject({
      name: "fs1:root",
      capacityBytes: 2 * TIB,
      usedBytes: TIB,
      dataReductionRatio: 1.8,
      writeLatencyUsec: 700,
      readIops: 40,
      writeBytesPerSec: 8192,
    });
  });

  test("a directory series without a name is skipped", () => {
    const b: Buffers = buffers();
    feed(b, "purefa_directory_space_bytes", { space: "total_physical" }, TIB);
    expect(entries(b)).toHaveLength(0);
  });
});

describe("StorageArraySnapshotScan - FlashBlade file systems", () => {
  test("space, data reduction, performance and protocol flags", () => {
    const b: Buffers = buffers();
    const fs: LabelMap = {
      name: "home",
      nfspolicy: "default",
      nfs: "3,41",
      smb: "",
    };
    feed(
      b,
      "purefb_file_systems_space_bytes",
      { ...fs, space: "total_provisioned" },
      10 * TIB,
    );
    feed(
      b,
      "purefb_file_systems_space_bytes",
      { ...fs, space: "total_physical" },
      TIB + 0.5,
    );
    feed(
      b,
      "purefb_file_systems_space_bytes",
      { ...fs, space: "provisioned" },
      12 * TIB,
    );
    feed(
      b,
      "purefb_file_systems_space_bytes",
      { ...fs, space: "available_ratio" },
      0.9,
    );
    feed(b, "purefb_file_systems_space_data_reduction_ratio", fs, 1.3);
    feed(
      b,
      "purefb_file_systems_performance_latency_usec",
      { name: "home", dimension: "usec_per_read_op" },
      800,
    );
    feed(
      b,
      "purefb_file_systems_performance_throughput_iops",
      { name: "home", dimension: "writes_per_sec" },
      55,
    );
    feed(
      b,
      "purefb_file_systems_performance_bandwidth_bytes",
      { name: "home", dimension: "read_bytes_per_sec" },
      65536,
    );

    expect(entry(b, StorageArrayResourceKind.FileSystem, "home")).toMatchObject(
      {
        name: "home",
        capacityBytes: 10 * TIB,
        usedBytes: TIB,
        dataReductionRatio: 1.3,
        readLatencyUsec: 800,
        writeIops: 55,
        readBytesPerSec: 65536,
        details: {
          nfs: "3,41",
          nfsPolicy: "default",
          provisionedBytes: 12 * TIB,
        },
      },
    );
    // smb was empty: absent, not "".
    expect(
      "smb" in entry(b, StorageArrayResourceKind.FileSystem, "home").details,
    ).toBe(false);
  });

  test("an SMB-only file system records its smb flag", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefb_file_systems_space_bytes",
      { name: "shares", nfspolicy: "", nfs: "", smb: "3", space: "virtual" },
      TIB,
    );
    expect(
      entry(b, StorageArrayResourceKind.FileSystem, "shares").details,
    ).toEqual({ smb: "3" });
  });

  test("fileSystemCount counts file systems; a nameless series is skipped", () => {
    const b: Buffers = buffers();
    fbInfo(b, "filesystems");
    for (const name of ["home", "scratch"]) {
      feed(
        b,
        "purefb_file_systems_space_bytes",
        { name, space: "total_physical" },
        TIB,
      );
    }
    feed(b, "purefb_file_systems_space_bytes", { space: "total_physical" }, 1);
    expect(derive(b).fileSystemCount).toBe(2);
  });
});

describe("StorageArraySnapshotScan - FlashBlade buckets", () => {
  test("used space, virtual space, quota, object count, data reduction and the account", () => {
    const b: Buffers = buffers();
    const bucket: LabelMap = { name: "backups", account: "veeam" };
    feed(
      b,
      "purefb_buckets_space_bytes",
      { ...bucket, space: "total_physical" },
      5 * TIB,
    );
    feed(
      b,
      "purefb_buckets_space_bytes",
      { ...bucket, space: "virtual" },
      7 * TIB + 0.9,
    );
    feed(b, "purefb_buckets_space_bytes", { ...bucket, space: "snapshots" }, 3);
    feed(
      b,
      "purefb_buckets_quota_space_bytes",
      { ...bucket, hard_limit_enabled: "true" },
      10 * TIB,
    );
    feed(b, "purefb_buckets_object_count", bucket, 123456.7);
    feed(b, "purefb_buckets_space_data_reduction_ratio", bucket, 1.4);
    feed(
      b,
      "purefb_buckets_performance_latency_usec",
      { name: "backups", dimension: "usec_per_write_op" },
      1500,
    );
    feed(
      b,
      "purefb_buckets_performance_throughput_iops",
      { name: "backups", dimension: "reads_per_sec" },
      12,
    );
    feed(
      b,
      "purefb_buckets_performance_bandwidth_bytes",
      { name: "backups", dimension: "write_bytes_per_sec" },
      1048576,
    );

    expect(entry(b, StorageArrayResourceKind.Bucket, "backups")).toMatchObject({
      name: "backups",
      groupName: "veeam",
      usedBytes: 5 * TIB,
      capacityBytes: 10 * TIB,
      dataReductionRatio: 1.4,
      writeLatencyUsec: 1500,
      readIops: 12,
      writeBytesPerSec: 1048576,
      details: {
        virtualBytes: 7 * TIB,
        hardLimitEnabled: true,
        objectCount: 123456,
      },
    });
  });

  test("a soft quota records hardLimitEnabled false", () => {
    const b: Buffers = buffers();
    feed(
      b,
      "purefb_buckets_quota_space_bytes",
      { name: "logs", account: "app", hard_limit_enabled: "false" },
      TIB,
    );
    expect(
      entry(b, StorageArrayResourceKind.Bucket, "logs").details[
        "hardLimitEnabled"
      ],
    ).toBe(false);
  });

  test("bucketCount counts buckets; a nameless series is skipped", () => {
    const b: Buffers = buffers();
    fbInfo(b, "objectstore");
    feed(b, "purefb_buckets_object_count", { name: "a", account: "x" }, 1);
    feed(b, "purefb_buckets_object_count", { name: "b", account: "x" }, 1);
    feed(b, "purefb_buckets_object_count", { account: "x" }, 1);
    expect(derive(b).bucketCount).toBe(2);
  });
});

describe("StorageArraySnapshotScan - fold semantics", () => {
  function patch(
    overrides: Partial<StorageArrayResourceBufferEntry>,
    atMs: number,
  ): StorageArrayResourceBufferEntry {
    return {
      ...emptyStorageArrayResourceEntry(
        StorageArrayResourceKind.Hardware,
        "CH0.TMP1",
        new Date(atMs),
      ),
      ...overrides,
    };
  }

  function fold(
    buffer: Map<string, Map<string, StorageArrayResourceBufferEntry>>,
    p: StorageArrayResourceBufferEntry,
    arrayIdStr: string = ARRAY,
  ): void {
    foldStorageArrayResourceSnapshot({ buffer, arrayIdStr, patch: p });
  }

  test("emptyStorageArrayResourceEntry starts every column null and details empty", () => {
    const at: Date = new Date(BASE_MS);
    const empty: StorageArrayResourceBufferEntry =
      emptyStorageArrayResourceEntry("Volume", "vol1", at);
    expect(empty).toEqual({
      kind: "Volume",
      externalId: "vol1",
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
      observedAt: at,
    });
    // Each entry gets its own details object.
    expect(emptyStorageArrayResourceEntry("Volume", "v2", at).details).not.toBe(
      empty.details,
    );
  });

  test("identity is first-non-null-wins, metrics newest-observedAt-wins, details per key", () => {
    const buffer: Map<
      string,
      Map<string, StorageArrayResourceBufferEntry>
    > = new Map();

    fold(
      buffer,
      patch(
        {
          name: "first-name",
          status: "ok",
          temperatureCelsius: 30,
          details: { firmware: "a" },
        },
        BASE_MS + 1000,
      ),
    );
    // An OLDER observation only fills what is still empty.
    fold(
      buffer,
      patch(
        {
          name: "older-name",
          componentType: "temp_sensor",
          model: "M1",
          status: "critical",
          temperatureCelsius: 55,
          readIops: 5,
          details: { firmware: "old", slot: "4" },
        },
        BASE_MS,
      ),
    );

    const folded: StorageArrayResourceBufferEntry = buffer
      .get(ARRAY)!
      .get(`${StorageArrayResourceKind.Hardware}|CH0.TMP1`)!;
    expect(folded).toMatchObject({
      name: "first-name",
      componentType: "temp_sensor",
      model: "M1",
      status: "ok",
      temperatureCelsius: 30,
      readIops: 5,
      details: { firmware: "a", slot: "4" },
    });
    expect(folded.observedAt).toEqual(new Date(BASE_MS + 1000));

    // A NEWER observation wins every metric and detail, never identity.
    fold(
      buffer,
      patch(
        {
          name: "newer-name",
          firmwareVersion: "2.0",
          groupName: "g",
          status: "degraded",
          temperatureCelsius: 41,
          details: { firmware: "b" },
        },
        BASE_MS + 2000,
      ),
    );
    expect(folded).toMatchObject({
      name: "first-name",
      firmwareVersion: "2.0",
      groupName: "g",
      status: "degraded",
      temperatureCelsius: 41,
      readIops: 5,
      details: { firmware: "b", slot: "4" },
    });
    expect(folded.observedAt).toEqual(new Date(BASE_MS + 2000));
  });

  test("a null in a newer patch never blanks a value", () => {
    const buffer: Map<
      string,
      Map<string, StorageArrayResourceBufferEntry>
    > = new Map();
    fold(buffer, patch({ status: "ok", capacityBytes: 10 }, BASE_MS));
    fold(buffer, patch({ status: null, capacityBytes: null }, BASE_MS + 5));

    const folded: StorageArrayResourceBufferEntry = buffer
      .get(ARRAY)!
      .get(`${StorageArrayResourceKind.Hardware}|CH0.TMP1`)!;
    expect(folded.status).toBe("ok");
    expect(folded.capacityBytes).toBe(10);
  });

  test("at the same timestamp the later series wins (>=)", () => {
    const buffer: Map<
      string,
      Map<string, StorageArrayResourceBufferEntry>
    > = new Map();
    fold(buffer, patch({ status: "ok", usedBytes: 1 }, BASE_MS));
    fold(buffer, patch({ status: "degraded", usedBytes: 2 }, BASE_MS));

    const folded: StorageArrayResourceBufferEntry = buffer
      .get(ARRAY)!
      .get(`${StorageArrayResourceKind.Hardware}|CH0.TMP1`)!;
    expect(folded.status).toBe("degraded");
    expect(folded.usedBytes).toBe(2);
  });

  test("entries are keyed by kind AND externalId, and by array", () => {
    const buffer: Map<
      string,
      Map<string, StorageArrayResourceBufferEntry>
    > = new Map();
    fold(
      buffer,
      emptyStorageArrayResourceEntry("Hardware", "CT0", new Date(BASE_MS)),
    );
    fold(
      buffer,
      emptyStorageArrayResourceEntry("Controller", "CT0", new Date(BASE_MS)),
    );
    fold(
      buffer,
      emptyStorageArrayResourceEntry("Hardware", "CT0", new Date(BASE_MS)),
      OTHER_ARRAY,
    );

    expect(buffer.get(ARRAY)?.size).toBe(2);
    expect(buffer.get(OTHER_ARRAY)?.size).toBe(1);
  });

  test("datapoints of one object fold into one entry across a batch", () => {
    const b: Buffers = buffers();
    faHw(b, "CT0", "controller", "ok", BASE_MS);
    faHw(b, "CT0", "controller", "critical", BASE_MS + 60_000);
    faHw(b, "CT0", "controller", "degraded", BASE_MS + 30_000);

    expect(entries(b)).toHaveLength(1);
    const ct0: StorageArrayResourceBufferEntry = entry(
      b,
      StorageArrayResourceKind.Hardware,
      "CT0",
    );
    // The newest observation, regardless of arrival order.
    expect(ct0.status).toBe("critical");
    expect(ct0.observedAt).toEqual(new Date(BASE_MS + 60_000));
  });
});

describe("StorageArraySnapshotScan - malformed datapoints", () => {
  function volumeDatapoint(overrides: JSONObject): JSONObject {
    return {
      ...dp("purefa_volume_space_bytes", {
        value: TIB,
        labels: { name: "vol1", space: "total_provisioned" },
      }),
      ...overrides,
    };
  }

  test.each([
    ["a NaN double", { asDouble: NaN }],
    ["the OTLP JSON NaN string", { asDouble: "NaN" }],
    ["+Infinity", { asDouble: Infinity }],
    ["-Infinity", { asDouble: -Infinity }],
    ["an unparseable string", { asDouble: "lots" }],
    ["no value at all", { asDouble: undefined }],
    ["a null value", { asDouble: null }],
    ["a boolean", { asDouble: true }],
  ])(
    "%s is skipped without touching the buffers",
    (_: string, value: JSONObject) => {
      const b: Buffers = buffers();
      feedRaw(b, "purefa_volume_space_bytes", volumeDatapoint(value));

      expect(entries(b)).toHaveLength(0);
      expect(b.arrayBuffer.size).toBe(0);
      expect(derive(b)).toEqual({});
    },
  );

  test("an asInt (int64 as an OTLP JSON string) is read when there is no double", () => {
    const b: Buffers = buffers();
    feedRaw(
      b,
      "purefa_volume_space_bytes",
      volumeDatapoint({ asDouble: undefined, asInt: "1099511627776" }),
    );
    expect(
      entry(b, StorageArrayResourceKind.Volume, "vol1").capacityBytes,
    ).toBe(TIB);
  });

  test("asDouble wins over asInt when both are present", () => {
    const b: Buffers = buffers();
    feedRaw(
      b,
      "purefa_volume_space_bytes",
      volumeDatapoint({ asDouble: 2048, asInt: 1024 }),
    );
    expect(
      entry(b, StorageArrayResourceKind.Volume, "vol1").capacityBytes,
    ).toBe(2048);
  });

  test.each([
    ["a staleness marker (FLAG_NO_RECORDED_VALUE)", 1],
    ["the flag combined with others", 3],
  ])("%s is skipped", (_: string, flags: number) => {
    /*
     * The prometheus receiver forwards a Prometheus staleness marker with
     * this flag when a series disappears; folding it would count a deleted
     * volume as present for one more batch.
     */
    const b: Buffers = buffers();
    faInfo(b, "volumes");
    feedRaw(b, "purefa_volume_space_bytes", volumeDatapoint({ flags }));

    expect(entries(b)).toHaveLength(0);
    expect(derive(b).volumeCount).toBe(0);
  });

  test("flags without the no-recorded-value bit are processed", () => {
    const b: Buffers = buffers();
    feedRaw(b, "purefa_volume_space_bytes", volumeDatapoint({ flags: 0 }));
    feedRaw(
      b,
      "purefa_volume_space_bytes",
      volumeDatapoint({ flags: 2, asDouble: 5 }),
    );
    expect(entries(b)).toHaveLength(1);
  });

  test("a datapoint without an attributes array is read as carrying no labels", () => {
    const b: Buffers = buffers();
    feedRaw(b, "purefa_volume_space_bytes", {
      asDouble: 1,
      timeUnixNano: toNano(BASE_MS),
    });
    feedRaw(b, "purefa_array_space_utilization", {
      asDouble: 33,
      timeUnixNano: toNano(BASE_MS),
    });

    expect(entries(b)).toHaveLength(0);
    expect(derive(b).capacityUsedPercent).toBe(33);
  });

  test("non-string, blank and malformed attributes count as absent", () => {
    const b: Buffers = buffers();
    feedRaw(b, "purefa_volume_space_bytes", {
      asDouble: TIB,
      timeUnixNano: toNano(BASE_MS),
      attributes: [
        { key: "name", value: { intValue: "7" } },
        { key: "space", value: { stringValue: "total_provisioned" } },
      ],
    });
    feedRaw(b, "purefa_volume_space_bytes", {
      asDouble: TIB,
      timeUnixNano: toNano(BASE_MS),
      attributes: [
        { key: "name", value: { stringValue: "   " } },
        { key: "space", value: null },
      ],
    });
    feedRaw(b, "purefa_volume_space_bytes", {
      asDouble: TIB,
      timeUnixNano: toNano(BASE_MS),
      attributes: [{ key: "name" }, { value: { stringValue: "vol9" } }],
    });

    expect(entries(b)).toHaveLength(0);
  });

  test("a duplicated label key: the first non-blank value wins", () => {
    const b: Buffers = buffers();
    feedRaw(b, "purefa_volume_space_bytes", {
      asDouble: TIB,
      timeUnixNano: toNano(BASE_MS),
      attributes: [
        { key: "name", value: { stringValue: "" } },
        { key: "name", value: { stringValue: "vol-a" } },
        { key: "name", value: { stringValue: "vol-b" } },
        { key: "space", value: { stringValue: "total_provisioned" } },
      ],
    });
    expect(
      maybeEntry(b, StorageArrayResourceKind.Volume, "vol-a"),
    ).toBeDefined();
    expect(
      maybeEntry(b, StorageArrayResourceKind.Volume, "vol-b"),
    ).toBeUndefined();
  });

  test.each([
    ["an unparseable string", "abc"],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["a value past the Date range", "99999999999999999999999999999"],
    ["an exponent past the Date range", "1e30"],
  ])(
    "a timestamp that is %s falls back to now, with a warning",
    (_: string, timeUnixNano: string | number) => {
      const b: Buffers = buffers();
      const before: number = Date.now();
      feedRaw(
        b,
        "purefa_volume_space_bytes",
        volumeDatapoint({ timeUnixNano }),
      );
      const after: number = Date.now();

      const observedAt: Date = entry(
        b,
        StorageArrayResourceKind.Volume,
        "vol1",
      ).observedAt;
      // Never an Invalid Date: it would fail the upsert's timestamptz cast.
      expect(Number.isNaN(observedAt.getTime())).toBe(false);
      expect(observedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(observedAt.getTime()).toBeLessThanOrEqual(after);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    },
  );

  test("a missing timestamp falls back to now silently", () => {
    const b: Buffers = buffers();
    const before: number = Date.now();
    feedRaw(
      b,
      "purefa_volume_space_bytes",
      volumeDatapoint({ timeUnixNano: undefined }),
    );
    const observedAt: Date = entry(
      b,
      StorageArrayResourceKind.Volume,
      "vol1",
    ).observedAt;
    expect(observedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("a numeric nanosecond timestamp is read like the string form", () => {
    const b: Buffers = buffers();
    feedRaw(
      b,
      "purefa_volume_space_bytes",
      volumeDatapoint({ timeUnixNano: BASE_MS * 1_000_000 }),
    );
    expect(
      entry(b, StorageArrayResourceKind.Volume, "vol1").observedAt.getTime(),
    ).toBeCloseTo(BASE_MS, -1);
  });
});

describe("StorageArraySnapshotScan - end to end", () => {
  test("a FlashArray's five endpoints in one request derive every array column", () => {
    const b: Buffers = buffers();

    // /metrics/array
    faInfo(b, "array");
    feed(b, "purefa_array_space_bytes", { space: "capacity" }, 100 * TIB);
    feed(b, "purefa_array_space_bytes", { space: "empty" }, 40 * TIB);
    feed(b, "purefa_array_space_utilization", {}, 60);
    feed(b, "purefa_array_space_data_reduction_ratio", {}, 4.5);
    faAlert(b, { name: "4530", severity: "warning", summary: "Bay degraded" });
    faHw(b, "CH0", "chassis", "ok");
    faHw(b, "CT0", "controller", "ok");
    faHw(b, "CT1", "controller", "ok");
    faHw(b, "CH0.FAN0", "cooling", "degraded");
    faDrive(b, "CH0.BAY0", "healthy");
    faDrive(b, "CH0.BAY1", "healthy");
    faController(b, "CT0", "primary", "ready");
    faController(b, "CT1", "secondary", "ready");
    feed(
      b,
      "purefa_network_interface_speed_bandwidth_bytes",
      {
        enabled: "true",
        ethsubtype: "physical",
        name: "ct0.eth4",
        services: "iscsi",
        type: "eth",
      },
      3125000000,
    );

    // /metrics/volumes
    faInfo(b, "volumes");
    faVolume(
      b,
      "purefa_volume_space_bytes",
      "vmfs-prod-01",
      { space: "total_provisioned" },
      4 * TIB,
    );
    faVolume(
      b,
      "purefa_volume_space_bytes",
      "pod1::stretched-01",
      { pod: "pod1", space: "total_provisioned" },
      TIB,
    );

    // /metrics/hosts
    faInfo(b, "hosts");
    feed(
      b,
      "purefa_host_connectivity_info",
      { host: "esx-01", status: "healthy", details: "Redundant" },
      1,
    );
    faConnection(b, "esx-01", "vmfs-prod-01", "esx-cluster");
    faConnection(b, "esx-01", "pod1::stretched-01", "esx-cluster");

    // /metrics/pods
    faInfo(b, "pods");
    faReplicaLag(b, "pod1", "pod1-dr", "replicating", 250);

    // /metrics/directories
    faInfo(b, "directories");
    feed(
      b,
      "purefa_directory_space_bytes",
      { name: "fs1:root", space: "total_physical" },
      TIB,
    );

    expect(derive(b)).toEqual({
      storageSystem: StorageSystem.PureStorageFlashArray,
      reportedName: "pure-prod-01",
      systemId: "6f2c9e1a-7d4b-4a1e-9c3f-2b8d5e7a9c10",
      osName: "Purity//FA",
      osVersion: "6.7.3",
      capacityBytes: 100 * TIB,
      usedBytes: 60 * TIB,
      capacityUsedPercent: 60,
      dataReductionRatio: 4.5,
      openAlertCount: 1,
      criticalAlertCount: 0,
      warningAlertCount: 1,
      volumeCount: 2,
      hostCount: 1,
      podCount: 1,
      hardwareComponentCount: 4,
      unhealthyHardwareCount: 1,
      healthStatus: StorageArrayHealthStatus.Warning,
    });

    const all: Array<StorageArrayResourceBufferEntry> = rows(b);
    const countOf: (kind: StorageArrayResourceKind) => number = (
      kind: StorageArrayResourceKind,
    ): number => {
      return ofKind(all, kind).length;
    };
    expect(countOf(StorageArrayResourceKind.Hardware)).toBe(4);
    expect(countOf(StorageArrayResourceKind.Drive)).toBe(2);
    expect(countOf(StorageArrayResourceKind.Controller)).toBe(2);
    expect(countOf(StorageArrayResourceKind.NetworkInterface)).toBe(1);
    expect(countOf(StorageArrayResourceKind.Volume)).toBe(2);
    expect(countOf(StorageArrayResourceKind.Host)).toBe(1);
    expect(countOf(StorageArrayResourceKind.Pod)).toBe(1);
    expect(countOf(StorageArrayResourceKind.Directory)).toBe(1);
    expect(countOf(StorageArrayResourceKind.FileSystem)).toBe(0);
    expect(countOf(StorageArrayResourceKind.Bucket)).toBe(0);
    for (const volume of ofKind(all, StorageArrayResourceKind.Volume)) {
      expect(volume.connectionCount).toBe(1);
      expect(volume.fromConnectionsOnly).toBeUndefined();
    }
  });

  test("a FlashBlade's array, filesystems and objectstore endpoints derive its columns", () => {
    const b: Buffers = buffers();

    fbInfo(b, "array");
    feed(
      b,
      "purefb_array_space_bytes",
      { type: "array", space: "capacity" },
      1000 * TIB,
    );
    feed(
      b,
      "purefb_array_space_bytes",
      { type: "array", space: "empty" },
      750 * TIB,
    );
    feed(b, "purefb_array_space_utilization", { type: "array" }, 25);
    feed(b, "purefb_array_space_data_reduction_ratio", { type: "array" }, 1.9);
    fbHardware(b, "CH1.FB1", "fb", 1, "1");
    fbHardware(b, "CH1.FB2", "fb", 1, "2");
    fbHardware(b, "CH1.FB3", "fb", 2, "3");

    fbInfo(b, "filesystems");
    feed(
      b,
      "purefb_file_systems_space_bytes",
      {
        name: "home",
        nfspolicy: "default",
        nfs: "3,41",
        smb: "",
        space: "total_physical",
      },
      TIB,
    );

    fbInfo(b, "objectstore");
    feed(
      b,
      "purefb_buckets_object_count",
      { name: "backups", account: "veeam" },
      9,
    );
    feed(b, "purefb_buckets_object_count", { name: "logs", account: "app" }, 3);

    expect(derive(b)).toEqual({
      storageSystem: StorageSystem.PureStorageFlashBlade,
      reportedName: "pure-fb-01",
      systemId: "0b1f2e3d-4c5b-6a79-8897-a6b5c4d3e2f1",
      osName: "Purity//FB",
      osVersion: "4.5.6",
      capacityBytes: 1000 * TIB,
      usedBytes: 250 * TIB,
      capacityUsedPercent: 25,
      dataReductionRatio: 1.9,
      openAlertCount: 0,
      criticalAlertCount: 0,
      warningAlertCount: 0,
      fileSystemCount: 1,
      bucketCount: 2,
      hardwareComponentCount: 3,
      unhealthyHardwareCount: 0,
      healthStatus: StorageArrayHealthStatus.Ok,
    });
  });
});
