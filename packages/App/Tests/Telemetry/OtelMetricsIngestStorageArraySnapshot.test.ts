import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import StorageArrayResourceService, {
  ParsedStorageArrayResource,
} from "Common/Server/Services/StorageArrayResourceService";
import StorageArrayService, {
  StorageArraySnapshotExtras,
} from "Common/Server/Services/StorageArrayService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import StorageSystem from "Common/Types/StorageArray/StorageSystem";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The storage array snapshot path end to end: realistic OTLP/JSON payloads
 * as the OneUptime Storage Array Agent sends them (the prometheus receiver
 * scraping a FlashArray's native OpenMetrics endpoints, or the
 * pure-fb-openmetrics-exporter for a FlashBlade; identity in DATAPOINT
 * labels; `storage.array.name` + `storage.system` stamped on the resource
 * by the agent's resource processor; every scrape job labelled with its
 * `scrape_endpoint`) go through the real OTLP walk, the real fold and the
 * real flush, with only the Postgres seams (StorageArrayResourceService.
 * bulkUpsert / StorageArrayService.updateLastSeen) and the unrelated
 * backends (other discoveries, service resolution, ClickHouse submit)
 * mocked. Pins:
 *
 *   - the exact inventory rows handed to bulkUpsert, per kind,
 *   - the exact extras handed to updateLastSeen (from the same buffer),
 *   - a scrape of one endpoint never zeroes another endpoint's counts,
 *   - the fold runs BEFORE the pipeline rules (a Drop rule must not blank
 *     the inventory),
 *   - a failing inventory write is swallowed and the array snapshot still
 *     lands, and a failing array write is swallowed too.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const ARRAY_ID: ObjectID = ObjectID.generate();

const MIB: number = 1024 * 1024;
const GIB: number = 1024 * MIB;

// 2023-11-14T22:13:20.000Z — one scrape instant for the whole batch.
const BASE_MS: number = 1700000000000;
const OBSERVED_AT: Date = new Date(BASE_MS);

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

function toNano(ms: number): string {
  return `${ms}000000`;
}

function attributes(values: Record<string, string>): JSONArray {
  return Object.entries(values).map(([key, value]: [string, string]) => {
    return { key, value: { stringValue: value } };
  });
}

function point(value: number, labels: Record<string, string> = {}): JSONObject {
  return {
    asDouble: value,
    timeUnixNano: toNano(BASE_MS),
    attributes: attributes(labels),
  };
}

// Every Pure series is a gauge the array computes itself.
function gauge(name: string, dataPoints: Array<JSONObject>): JSONObject {
  return { name, description: name, unit: "", gauge: { dataPoints } };
}

function resourceMetrics(data: {
  arrayName?: string;
  storageSystem?: string | undefined;
  metrics: Array<JSONObject>;
}): JSONObject {
  const resource: Record<string, string> = {
    "storage.array.name": data.arrayName || "pure-prod-01",
  };
  if (data.storageSystem) {
    resource["storage.system"] = data.storageSystem;
  }
  return {
    resource: { attributes: attributes(resource) },
    scopeMetrics: [
      {
        scope: {
          name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/prometheusreceiver",
          version: "0.161.0",
        },
        metrics: data.metrics,
      },
    ],
  };
}

// ---------------- FlashArray ----------------

function faInfo(endpoint: string): JSONObject {
  return gauge("purefa_info", [
    point(1, {
      array_name: "pure-fa-01",
      os: "Purity//FA",
      system_id: "8c3a-0001",
      version: "6.7.3",
      subscription_type: "evergreen_one",
      scrape_endpoint: endpoint,
    }),
  ]);
}

// The `array` scrape job: identity, capacity, alerts and hardware.
function faArrayScrape(): JSONObject {
  return resourceMetrics({
    storageSystem: "purestorage.flasharray",
    metrics: [
      faInfo("array"),
      gauge("purefa_array_space_bytes", [
        point(1000 * GIB, { space: "capacity" }),
        point(400 * GIB, { space: "empty" }),
        point(50 * GIB, { space: "snapshots" }),
      ]),
      gauge("purefa_array_space_utilization", [point(60.004)]),
      gauge("purefa_array_space_data_reduction_ratio", [point(4.237)]),
      gauge("purefa_alerts_open", [
        point(1, {
          severity: "critical",
          category: "hardware",
          code: "42",
          component_name: "CT0",
          component_type: "controller",
          summary: "Controller failed",
        }),
        point(1, {
          severity: "warning",
          category: "hardware",
          code: "7",
          component_name: "CH0.BAY3",
          component_type: "drive_bay",
          summary: "Drive degraded",
        }),
        // Purity's own bookkeeping — never an alert a person must act on.
        point(1, {
          severity: "hidden",
          code: "1",
          component_name: "CT1",
          summary: "Internal",
        }),
      ]),
      gauge("purefa_hw_component_status", [
        point(1, {
          component_name: "CH0.BAY1",
          component_type: "drive_bay",
          component_status: "ok",
        }),
        point(1, {
          component_name: "CT0.FAN0",
          component_type: "cooling",
          component_status: "degraded",
        }),
      ]),
      gauge("purefa_hw_component_temperature_celsius", [
        point(38, {
          component_name: "CT0.TMP0",
          component_type: "temp_sensor",
        }),
      ]),
      gauge("purefa_drive_capacity_bytes", [
        point(1920 * GIB, {
          component_name: "CH0.BAY1",
          component_type: "SSD",
          component_status: "healthy",
          component_protocol: "NVMe",
        }),
      ]),
      gauge("purefa_hw_controller_info", [
        point(1, {
          name: "CT0",
          mode: "primary",
          model: "FA-X70R3",
          status: "ready",
          type: "array_controller",
          version: "6.7.3",
        }),
      ]),
      gauge("purefa_network_interface_speed_bandwidth_bytes", [
        point(3125000000, {
          name: "ct0.eth2",
          enabled: "true",
          ethsubtype: "physical",
          services: "iscsi",
          type: "eth",
        }),
      ]),
    ],
  });
}

// The `volumes` scrape job.
function faVolumesScrape(): JSONObject {
  return resourceMetrics({
    storageSystem: "purestorage.flasharray",
    metrics: [
      faInfo("volumes"),
      gauge("purefa_volume_space_bytes", [
        point(2048 * GIB, {
          name: "vol-db-01",
          naa_id: "624A93700000000000000001",
          space: "total_provisioned",
        }),
        point(300 * GIB, {
          name: "vol-db-01",
          naa_id: "624A93700000000000000001",
          space: "total_physical",
        }),
        point(512 * GIB, {
          name: "vol-web-01",
          naa_id: "624A93700000000000000002",
          volume_group: "vg-web",
          space: "total_provisioned",
        }),
      ]),
      gauge("purefa_volume_space_data_reduction_ratio", [
        point(3.5, { name: "vol-db-01" }),
      ]),
      gauge("purefa_volume_performance_latency_usec", [
        point(250, { name: "vol-db-01", dimension: "usec_per_read_op" }),
        point(400, { name: "vol-db-01", dimension: "usec_per_write_op" }),
        // A latency breakdown: still a sighting, never a column.
        point(10, { name: "vol-db-01", dimension: "queue_usec_per_read_op" }),
      ]),
      gauge("purefa_volume_performance_throughput_iops", [
        point(1500, { name: "vol-db-01", dimension: "reads_per_sec" }),
        point(800, { name: "vol-db-01", dimension: "writes_per_sec" }),
      ]),
      gauge("purefa_volume_performance_bandwidth_bytes", [
        point(50 * MIB, { name: "vol-db-01", dimension: "read_bytes_per_sec" }),
      ]),
    ],
  });
}

// The `hosts` scrape job.
function faHostsScrape(): JSONObject {
  return resourceMetrics({
    storageSystem: "purestorage.flasharray",
    metrics: [
      faInfo("hosts"),
      gauge("purefa_host_connectivity_info", [
        point(1, { host: "esx-01", status: "Redundant", details: "Redundant" }),
      ]),
      gauge("purefa_host_connections_info", [
        point(1, {
          host: "esx-01",
          hostgroup: "esx-cluster",
          volume: "vol-db-01",
        }),
        point(1, {
          host: "esx-01",
          hostgroup: "esx-cluster",
          volume: "vol-web-01",
        }),
        point(1, {
          host: "esx-02",
          hostgroup: "esx-cluster",
          volume: "vol-db-01",
        }),
      ]),
      gauge("purefa_host_performance_latency_usec", [
        point(300, { host: "esx-01", dimension: "usec_per_read_op" }),
      ]),
    ],
  });
}

// ---------------- FlashBlade ----------------

function fbInfo(endpoint: string): JSONObject {
  return gauge("purefb_info", [
    point(1, {
      array_name: "pure-fb-01",
      os: "Purity//FB",
      system_id: "fb-0999",
      version: "4.1.12",
      scrape_endpoint: endpoint,
    }),
  ]);
}

function fbArrayScrape(): JSONObject {
  return resourceMetrics({
    arrayName: "pure-fb-prod",
    storageSystem: "purestorage.flashblade",
    metrics: [
      fbInfo("array"),
      gauge("purefb_array_space_bytes", [
        point(500 * GIB, { type: "array", space: "capacity" }),
        point(100 * GIB, { type: "array", space: "empty" }),
        // The file-system share of the array is not the array.
        point(9999 * GIB, { type: "file-system", space: "capacity" }),
      ]),
      gauge("purefb_array_space_utilization", [
        point(80, { type: "array" }),
        point(12, { type: "object-store" }),
      ]),
      gauge("purefb_array_space_data_reduction_ratio", [
        point(2.1, { type: "array" }),
      ]),
      gauge("purefb_alerts_open", [
        point(1, {
          severity: "critical",
          code: "201",
          component_name: "CH1.FB2",
          summary: "Blade unhealthy",
        }),
      ]),
      gauge("purefb_hardware_health", [
        point(1, { type: "fb", name: "CH1.FB1", index: "1", slot: "1" }),
        point(0, { type: "fb", name: "CH1.FB2", index: "2", slot: "2" }),
        point(2, { type: "fb", name: "CH1.FB3", index: "3", slot: "3" }),
      ]),
    ],
  });
}

function fbFileSystemsScrape(): JSONObject {
  return resourceMetrics({
    arrayName: "pure-fb-prod",
    storageSystem: "purestorage.flashblade",
    metrics: [
      fbInfo("filesystems"),
      gauge("purefb_file_systems_space_bytes", [
        point(10 * GIB, {
          name: "fs-home",
          nfs: "true",
          space: "total_physical",
        }),
        point(100 * GIB, {
          name: "fs-home",
          nfs: "true",
          space: "provisioned",
        }),
      ]),
      gauge("purefb_file_systems_performance_latency_usec", [
        point(900, { name: "fs-home", dimension: "usec_per_read_op" }),
      ]),
    ],
  });
}

function fbObjectStoreScrape(): JSONObject {
  return resourceMetrics({
    arrayName: "pure-fb-prod",
    storageSystem: "purestorage.flashblade",
    metrics: [
      fbInfo("objectstore"),
      gauge("purefb_buckets_space_bytes", [
        point(5 * GIB, {
          name: "bkt-logs",
          account: "acct-1",
          space: "total_physical",
        }),
      ]),
      gauge("purefb_buckets_quota_space_bytes", [
        point(50 * GIB, {
          name: "bkt-logs",
          account: "acct-1",
          hard_limit_enabled: "true",
        }),
      ]),
      gauge("purefb_buckets_object_count", [
        point(12345, { name: "bkt-logs", account: "acct-1" }),
      ]),
    ],
  });
}

function request(blocks: Array<JSONObject>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: { resourceMetrics: blocks },
    headers: {},
  } as unknown as TelemetryRequest;
}

function noRules(): MetricRulesForProject {
  return { projectRules: [], rulesByServiceId: new Map() };
}

function dropEverythingRules(): MetricRulesForProject {
  // A Drop rule with no filters matches (and drops) every datapoint.
  const rule: MetricPipelineRule = new MetricPipelineRule();
  rule.ruleType = MetricPipelineRuleType.Drop;
  rule.filters = [];
  return { projectRules: [rule], rulesByServiceId: new Map() };
}

interface Spies {
  bulkUpsert: jest.SpyInstance;
  setVolumeConnectionCounts: jest.SpyInstance;
  resetVolumeConnectionCounts: jest.SpyInstance;
  updateLastSeen: jest.SpyInstance;
  discoverArray: jest.SpyInstance;
  submitMetricsBuffer: jest.SpyInstance;
}

function setupIngestMocks(data: {
  rules?: MetricRulesForProject;
  arrayId?: ObjectID | null;
}): Spies {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelMetricsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
  const submitMetricsBuffer: jest.SpyInstance = jest
    .spyOn(service, "submitMetricsBuffer")
    .mockResolvedValue(undefined);

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }
  const discoverArray: jest.SpyInstance = jest
    .spyOn(service, "autoDiscoverStorageArray")
    .mockResolvedValue(data.arrayId === undefined ? ARRAY_ID : data.arrayId);

  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: "storage-array/pure-prod-01",
    primaryEntityId: ARRAY_ID,
    primaryEntityType: ServiceType.StorageArray,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });

  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue(data.rules ?? noRules());
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);

  const bulkUpsert: jest.SpyInstance = jest
    .spyOn(StorageArrayResourceService, "bulkUpsert")
    .mockResolvedValue(undefined);
  const setVolumeConnectionCounts: jest.SpyInstance = jest
    .spyOn(StorageArrayResourceService, "setVolumeConnectionCounts")
    .mockResolvedValue(0);
  const resetVolumeConnectionCounts: jest.SpyInstance = jest
    .spyOn(StorageArrayResourceService, "resetVolumeConnectionCounts")
    .mockResolvedValue(0);
  const updateLastSeen: jest.SpyInstance = jest
    .spyOn(StorageArrayService, "updateLastSeen")
    .mockResolvedValue(undefined);

  return {
    bulkUpsert,
    setVolumeConnectionCounts,
    resetVolumeConnectionCounts,
    updateLastSeen,
    discoverArray,
    submitMetricsBuffer,
  };
}

function upsertedResources(spies: Spies): Array<ParsedStorageArrayResource> {
  expect(spies.bulkUpsert).toHaveBeenCalledTimes(1);
  const args: {
    projectId: ObjectID;
    storageArrayId: ObjectID;
    resources: Array<ParsedStorageArrayResource>;
  } = spies.bulkUpsert.mock.calls[0]![0];
  expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
  expect(args.storageArrayId.toString()).toBe(ARRAY_ID.toString());
  return [...args.resources].sort(
    (a: ParsedStorageArrayResource, b: ParsedStorageArrayResource) => {
      return `${a.kind}|${a.externalId}`.localeCompare(
        `${b.kind}|${b.externalId}`,
      );
    },
  );
}

function row(
  rows: Array<ParsedStorageArrayResource>,
  kind: string,
  externalId: string,
): ParsedStorageArrayResource {
  const found: ParsedStorageArrayResource | undefined = rows.find(
    (r: ParsedStorageArrayResource) => {
      return r.kind === kind && r.externalId === externalId;
    },
  );
  if (!found) {
    throw new Error(`expected inventory row ${kind} ${externalId}`);
  }
  return found;
}

function extras(spies: Spies): StorageArraySnapshotExtras {
  expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
  expect(spies.updateLastSeen.mock.calls[0]![0].toString()).toBe(
    ARRAY_ID.toString(),
  );
  return spies.updateLastSeen.mock.calls[0]![1] as StorageArraySnapshotExtras;
}

// An inventory row with every metric column empty, for exact comparisons.
function emptyRow(
  kind: string,
  externalId: string,
): ParsedStorageArrayResource {
  return {
    kind,
    externalId,
    name: externalId,
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
    lastSeenAt: OBSERVED_AT,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("FlashArray — the array scrape job", () => {
  test("hardware, drives, controllers and network interfaces become inventory rows", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([faArrayScrape()]),
    );

    // One discovery per ResourceMetrics block.
    expect(spies.discoverArray).toHaveBeenCalledTimes(1);

    const rows: Array<ParsedStorageArrayResource> = upsertedResources(spies);
    expect(
      rows.map((r: ParsedStorageArrayResource) => {
        return `${r.kind}|${r.externalId}`;
      }),
    ).toEqual([
      "Controller|CT0",
      "Drive|CH0.BAY1",
      "Hardware|CH0.BAY1",
      "Hardware|CT0.FAN0",
      "Hardware|CT0.TMP0",
      "NetworkInterface|ct0.eth2",
    ]);

    expect(row(rows, "Hardware", "CT0.FAN0")).toEqual({
      ...emptyRow("Hardware", "CT0.FAN0"),
      status: "degraded",
      componentType: "cooling",
    });
    expect(row(rows, "Hardware", "CT0.TMP0")).toEqual({
      ...emptyRow("Hardware", "CT0.TMP0"),
      componentType: "temp_sensor",
      temperatureCelsius: 38,
    });
    // A drive bay and the drive in it are two rows of two kinds.
    expect(row(rows, "Hardware", "CH0.BAY1")).toMatchObject({
      status: "ok",
      componentType: "drive_bay",
    });
    expect(row(rows, "Drive", "CH0.BAY1")).toEqual({
      ...emptyRow("Drive", "CH0.BAY1"),
      status: "healthy",
      componentType: "SSD",
      capacityBytes: 1920 * GIB,
      details: { protocol: "NVMe" },
    });
    expect(row(rows, "Controller", "CT0")).toEqual({
      ...emptyRow("Controller", "CT0"),
      status: "ready",
      statusDetail: "primary",
      componentType: "array_controller",
      model: "FA-X70R3",
      firmwareVersion: "6.7.3",
    });
    expect(row(rows, "NetworkInterface", "ct0.eth2")).toEqual({
      ...emptyRow("NetworkInterface", "ct0.eth2"),
      status: "enabled",
      componentType: "eth",
      details: {
        speedBytesPerSec: 3125000000,
        services: "iscsi",
        ethSubtype: "physical",
      },
    });
  });

  test("the array snapshot extras: identity, capacity, alert counts, hardware health", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([faArrayScrape()]),
    );

    expect(extras(spies)).toEqual({
      storageSystem: StorageSystem.PureStorageFlashArray,
      reportedName: "pure-fa-01",
      systemId: "8c3a-0001",
      osName: "Purity//FA",
      osVersion: "6.7.3",
      capacityBytes: 1000 * GIB,
      usedBytes: 600 * GIB,
      capacityUsedPercent: 60,
      dataReductionRatio: 4.24,
      // The hidden alert is Purity's own bookkeeping, never counted.
      openAlertCount: 2,
      criticalAlertCount: 1,
      warningAlertCount: 1,
      hardwareComponentCount: 3,
      // CT0.FAN0 is degraded; the drive is healthy, the controller ready.
      unhealthyHardwareCount: 1,
      // An open critical alert makes the array Critical.
      healthStatus: 2,
    });

    // Inventory is written before the array columns (single-source rule).
    expect(spies.bulkUpsert.mock.invocationCallOrder[0]).toBeLessThan(
      spies.updateLastSeen.mock.invocationCallOrder[0]!,
    );
  });

  test("the array scrape says nothing about volume, host or pod counts", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([faArrayScrape()]),
    );

    const written: StorageArraySnapshotExtras = extras(spies);
    expect(written.volumeCount).toBeUndefined();
    expect(written.hostCount).toBeUndefined();
    expect(written.podCount).toBeUndefined();
    expect(written.fileSystemCount).toBeUndefined();
    expect(written.bucketCount).toBeUndefined();
  });

  test("an array with no open alert and healthy hardware reports zero alerts and OK", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        resourceMetrics({
          storageSystem: "purestorage.flasharray",
          metrics: [
            faInfo("array"),
            gauge("purefa_hw_component_status", [
              point(1, {
                component_name: "CT0",
                component_type: "controller",
                component_status: "ok",
              }),
            ]),
          ],
        }),
      ]),
    );

    expect(extras(spies)).toMatchObject({
      openAlertCount: 0,
      criticalAlertCount: 0,
      warningAlertCount: 0,
      hardwareComponentCount: 1,
      unhealthyHardwareCount: 0,
      healthStatus: 0,
    });
  });
});

describe("FlashArray — the volumes and hosts scrape jobs", () => {
  test("volumes carry space, data reduction and the read / write performance columns", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([faVolumesScrape()]),
    );

    const rows: Array<ParsedStorageArrayResource> = upsertedResources(spies);
    expect(rows).toHaveLength(2);

    expect(row(rows, "Volume", "vol-db-01")).toEqual({
      ...emptyRow("Volume", "vol-db-01"),
      capacityBytes: 2048 * GIB,
      usedBytes: 300 * GIB,
      dataReductionRatio: 3.5,
      readLatencyUsec: 250,
      writeLatencyUsec: 400,
      readIops: 1500,
      writeIops: 800,
      readBytesPerSec: 50 * MIB,
      details: { naaId: "624A93700000000000000001" },
    });
    expect(row(rows, "Volume", "vol-web-01")).toEqual({
      ...emptyRow("Volume", "vol-web-01"),
      groupName: "vg-web",
      capacityBytes: 512 * GIB,
      details: { naaId: "624A93700000000000000002" },
    });

    // Only the volume count — no alert, capacity or hardware column.
    expect(extras(spies)).toEqual({
      storageSystem: StorageSystem.PureStorageFlashArray,
      reportedName: "pure-fa-01",
      systemId: "8c3a-0001",
      osName: "Purity//FA",
      osVersion: "6.7.3",
      volumeCount: 2,
    });
  });

  test("hosts carry connectivity and connection counts, and the volumes they name get theirs", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([faHostsScrape()]),
    );

    const rows: Array<ParsedStorageArrayResource> = upsertedResources(spies);
    expect(
      rows.map((r: ParsedStorageArrayResource) => {
        return `${r.kind}|${r.externalId}`;
      }),
    ).toEqual([
      "Host|esx-01",
      "Host|esx-02",
      "Volume|vol-db-01",
      "Volume|vol-web-01",
    ]);

    expect(row(rows, "Host", "esx-01")).toEqual({
      ...emptyRow("Host", "esx-01"),
      status: "redundant",
      statusDetail: "Redundant",
      groupName: "esx-cluster",
      readLatencyUsec: 300,
      connectionCount: 2,
    });
    expect(row(rows, "Host", "esx-02")).toEqual({
      ...emptyRow("Host", "esx-02"),
      groupName: "esx-cluster",
      connectionCount: 1,
    });

    /*
     * The hosts endpoint names the volumes too; their rows carry ONLY the
     * connection count — every other column COALESCEs on upsert, so the
     * volumes scrape's values survive.
     */
    expect(row(rows, "Volume", "vol-db-01")).toEqual({
      ...emptyRow("Volume", "vol-db-01"),
      connectionCount: 2,
    });
    expect(row(rows, "Volume", "vol-web-01")).toEqual({
      ...emptyRow("Volume", "vol-web-01"),
      connectionCount: 1,
    });

    // The hosts scrape counts hosts, and never the volumes it merely names.
    const written: StorageArraySnapshotExtras = extras(spies);
    expect(written.hostCount).toBe(2);
    expect(written.volumeCount).toBeUndefined();
    expect(written.openAlertCount).toBeUndefined();
  });

  test("a volumes scrape of an array whose last volume was deleted reports zero volumes", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        resourceMetrics({
          storageSystem: "purestorage.flasharray",
          metrics: [faInfo("volumes")],
        }),
      ]),
    );

    // The scrape_endpoint label proves the volumes endpoint was read.
    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(extras(spies)).toMatchObject({ volumeCount: 0 });
  });

  test("all three jobs in one batch fold into one upsert and one snapshot write", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([faArrayScrape(), faVolumesScrape(), faHostsScrape()]),
    );

    expect(spies.discoverArray).toHaveBeenCalledTimes(3);

    const rows: Array<ParsedStorageArrayResource> = upsertedResources(spies);
    // The volumes scrape's columns and the hosts scrape's counts merge.
    expect(row(rows, "Volume", "vol-db-01")).toMatchObject({
      capacityBytes: 2048 * GIB,
      readLatencyUsec: 250,
      connectionCount: 2,
    });

    expect(extras(spies)).toMatchObject({
      volumeCount: 2,
      hostCount: 2,
      openAlertCount: 2,
      healthStatus: 2,
    });
  });
});

describe("FlashBlade", () => {
  test("the array scrape: capacity of the whole array only, alerts and blade health", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([fbArrayScrape()]),
    );

    const rows: Array<ParsedStorageArrayResource> = upsertedResources(spies);
    expect(rows).toEqual([
      {
        ...emptyRow("Hardware", "CH1.FB1"),
        status: "healthy",
        componentType: "fb",
        details: { slot: "1" },
      },
      {
        ...emptyRow("Hardware", "CH1.FB2"),
        status: "unhealthy",
        componentType: "fb",
        details: { slot: "2" },
      },
      {
        ...emptyRow("Hardware", "CH1.FB3"),
        status: "unused",
        componentType: "fb",
        details: { slot: "3" },
      },
    ]);

    expect(extras(spies)).toEqual({
      storageSystem: StorageSystem.PureStorageFlashBlade,
      reportedName: "pure-fb-01",
      systemId: "fb-0999",
      osName: "Purity//FB",
      osVersion: "4.1.12",
      capacityBytes: 500 * GIB,
      usedBytes: 400 * GIB,
      capacityUsedPercent: 80,
      dataReductionRatio: 2.1,
      openAlertCount: 1,
      criticalAlertCount: 1,
      warningAlertCount: 0,
      hardwareComponentCount: 3,
      unhealthyHardwareCount: 1,
      healthStatus: 2,
    });
  });

  test("file systems and buckets become inventory rows with their counts", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([fbFileSystemsScrape(), fbObjectStoreScrape()]),
    );

    const rows: Array<ParsedStorageArrayResource> = upsertedResources(spies);
    expect(rows).toEqual([
      {
        ...emptyRow("Bucket", "bkt-logs"),
        groupName: "acct-1",
        capacityBytes: 50 * GIB,
        usedBytes: 5 * GIB,
        details: { hardLimitEnabled: true, objectCount: 12345 },
      },
      {
        ...emptyRow("FileSystem", "fs-home"),
        usedBytes: 10 * GIB,
        readLatencyUsec: 900,
        details: { nfs: "true", provisionedBytes: 100 * GIB },
      },
    ]);

    expect(extras(spies)).toEqual({
      storageSystem: StorageSystem.PureStorageFlashBlade,
      reportedName: "pure-fb-01",
      systemId: "fb-0999",
      osName: "Purity//FB",
      osVersion: "4.1.12",
      fileSystemCount: 1,
      bucketCount: 1,
    });
  });
});

describe("storage array snapshot ingest — routing and failure modes", () => {
  test("a batch that is not a storage array batch never touches the storage array tables", async () => {
    const spies: Spies = setupIngestMocks({ arrayId: null });

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([faArrayScrape(), fbArrayScrape()]),
    );

    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(spies.updateLastSeen).not.toHaveBeenCalled();
  });

  test("series outside the snapshot set reach ClickHouse but never the inventory", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        resourceMetrics({
          storageSystem: "purestorage.flasharray",
          metrics: [
            gauge("purefa_array_performance_queue_depth_ops", [point(3)]),
            gauge("purefa_volume_group_space_bytes", [
              point(1, { name: "vg-web", space: "total_physical" }),
            ]),
          ],
        }),
      ]),
    );

    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(spies.updateLastSeen).not.toHaveBeenCalled();
    expect(spies.submitMetricsBuffer).toHaveBeenCalled();
  });

  test("the fold runs BEFORE the pipeline rules: a Drop rule does not blank the inventory", async () => {
    const spies: Spies = setupIngestMocks({ rules: dropEverythingRules() });

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([faArrayScrape()]),
    );

    expect(upsertedResources(spies)).toHaveLength(6);
    expect(extras(spies)).toMatchObject({
      openAlertCount: 2,
      healthStatus: 2,
    });
  });

  test("a failing inventory write is swallowed and the array snapshot still lands", async () => {
    const spies: Spies = setupIngestMocks({});
    spies.bulkUpsert.mockRejectedValue(new Error("postgres down"));

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(
        request([faArrayScrape()]),
      ),
    ).resolves.toBeUndefined();

    expect(spies.bulkUpsert).toHaveBeenCalledTimes(1);
    // The array columns have their own try block.
    expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
  });

  test("a failing array write is swallowed too", async () => {
    const spies: Spies = setupIngestMocks({});
    spies.updateLastSeen.mockRejectedValue(new Error("postgres down"));

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(
        request([faArrayScrape()]),
      ),
    ).resolves.toBeUndefined();

    expect(spies.bulkUpsert).toHaveBeenCalledTimes(1);
  });

  test("the platform is detected from the metric names when the agent stamps none", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        resourceMetrics({
          storageSystem: undefined,
          metrics: [fbInfo("array")],
        }),
      ]),
    );

    expect(extras(spies)).toMatchObject({
      storageSystem: StorageSystem.PureStorageFlashBlade,
    });
  });
});

describe("storage array snapshot ingest — volume connection counts", () => {
  test("a hosts scrape resets every volume it no longer names, after the upsert", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([faHostsScrape()]),
    );

    expect(spies.resetVolumeConnectionCounts).toHaveBeenCalledTimes(1);
    const args: {
      storageArrayId: ObjectID;
      connectedVolumeNames: Array<string>;
    } = spies.resetVolumeConnectionCounts.mock.calls[0]![0];
    expect(args.storageArrayId.toString()).toBe(ARRAY_ID.toString());
    expect(args.connectedVolumeNames).toEqual(["vol-db-01", "vol-web-01"]);

    // The connected volumes' own counts land first; the reset never undoes them.
    expect(spies.bulkUpsert.mock.invocationCallOrder[0]).toBeLessThan(
      spies.resetVolumeConnectionCounts.mock.invocationCallOrder[0]!,
    );
  });

  test("a hosts scrape writes the named volumes' counts with their own update, before the reset", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([faHostsScrape()]),
    );

    /*
     * Not left to the connection-only upsert rows alone: the upsert's
     * lastSeenAt guard drops them when the volumes scrape was flushed
     * first with a later timestamp.
     */
    expect(spies.setVolumeConnectionCounts).toHaveBeenCalledTimes(1);
    const args: {
      storageArrayId: ObjectID;
      connectionCounts: Record<string, number>;
    } = spies.setVolumeConnectionCounts.mock.calls[0]![0];
    expect(args.storageArrayId.toString()).toBe(ARRAY_ID.toString());
    // vol-db-01 is connected to esx-01 and esx-02, vol-web-01 to esx-01.
    expect(args.connectionCounts).toEqual({ "vol-db-01": 2, "vol-web-01": 1 });

    expect(spies.bulkUpsert.mock.invocationCallOrder[0]).toBeLessThan(
      spies.setVolumeConnectionCounts.mock.invocationCallOrder[0]!,
    );
    expect(
      spies.setVolumeConnectionCounts.mock.invocationCallOrder[0],
    ).toBeLessThan(
      spies.resetVolumeConnectionCounts.mock.invocationCallOrder[0]!,
    );
  });

  test("a failing count update is swallowed and the array snapshot still lands", async () => {
    const spies: Spies = setupIngestMocks({});
    spies.setVolumeConnectionCounts.mockRejectedValue(
      new Error("postgres down"),
    );

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(
        request([faHostsScrape()]),
      ),
    ).resolves.toBeUndefined();

    expect(spies.bulkUpsert).toHaveBeenCalledTimes(1);
    expect(extras(spies)).toMatchObject({ hostCount: 2 });
  });

  test("a hosts scrape that lists no host at all clears every count, with nothing to upsert", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        resourceMetrics({
          storageSystem: "purestorage.flasharray",
          metrics: [faInfo("hosts")],
        }),
      ]),
    );

    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(spies.setVolumeConnectionCounts).toHaveBeenCalledTimes(1);
    expect(
      spies.setVolumeConnectionCounts.mock.calls[0]![0].connectionCounts,
    ).toEqual({});
    expect(spies.resetVolumeConnectionCounts).toHaveBeenCalledTimes(1);
    expect(
      spies.resetVolumeConnectionCounts.mock.calls[0]![0].connectedVolumeNames,
    ).toEqual([]);
    expect(extras(spies)).toMatchObject({ hostCount: 0 });
  });

  test.each([
    ["the array", faArrayScrape],
    ["the volumes", faVolumesScrape],
    ["a FlashBlade array", fbArrayScrape],
    ["a FlashBlade file systems", fbFileSystemsScrape],
  ])(
    "%s scrape does not know the connections, so it resets nothing",
    async (_label: string, scrape: () => JSONObject) => {
      const spies: Spies = setupIngestMocks({});

      await OtelMetricsIngestService.processMetricsFromQueue(
        request([scrape()]),
      );

      expect(spies.setVolumeConnectionCounts).not.toHaveBeenCalled();
      expect(spies.resetVolumeConnectionCounts).not.toHaveBeenCalled();
    },
  );

  test("a hosts scrape whose connections series was filtered out resets nothing", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        resourceMetrics({
          storageSystem: "purestorage.flasharray",
          metrics: [
            faInfo("hosts"),
            gauge("purefa_host_connectivity_info", [
              point(1, {
                host: "esx-01",
                status: "Redundant",
                details: "Redundant",
              }),
            ]),
          ],
        }),
      ]),
    );

    expect(spies.bulkUpsert).toHaveBeenCalledTimes(1);
    expect(spies.setVolumeConnectionCounts).not.toHaveBeenCalled();
    expect(spies.resetVolumeConnectionCounts).not.toHaveBeenCalled();
  });

  test("a failing reset is swallowed and the array snapshot still lands", async () => {
    const spies: Spies = setupIngestMocks({});
    spies.resetVolumeConnectionCounts.mockRejectedValue(
      new Error("postgres down"),
    );

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(
        request([faHostsScrape()]),
      ),
    ).resolves.toBeUndefined();

    expect(spies.bulkUpsert).toHaveBeenCalledTimes(1);
    expect(extras(spies)).toMatchObject({ hostCount: 2 });
  });
});

// The same block with the agent's declared `storage.system` replaced.
function declaring(block: JSONObject, storageSystem: string): JSONObject {
  const resource: JSONObject = block["resource"] as JSONObject;
  return {
    ...block,
    resource: {
      ...resource,
      attributes: (resource["attributes"] as JSONArray).map(
        (attribute: JSONObject) => {
          return attribute["key"] === "storage.system"
            ? { key: "storage.system", value: { stringValue: storageSystem } }
            : attribute;
        },
      ),
    },
  };
}

describe("storage array snapshot ingest — the platform", () => {
  test("the metric names win over a declared platform that disagrees", async () => {
    // A FlashBlade .env without STORAGE_SYSTEM declares the compose default.
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([declaring(fbArrayScrape(), "purestorage.flasharray")]),
    );

    expect(extras(spies).storageSystem).toBe(
      StorageSystem.PureStorageFlashBlade,
    );
  });

  test("a platform with no catalog is labelled from the declaration alone", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        resourceMetrics({
          arrayName: "ontap-01",
          storageSystem: " NetApp.ONTAP ",
          metrics: [gauge("netapp_volume_size_bytes", [point(GIB)])],
        }),
      ]),
    );

    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(spies.resetVolumeConnectionCounts).not.toHaveBeenCalled();
    expect(extras(spies)).toEqual({ storageSystem: "netapp.ontap" });
  });

  test("a Pure batch without Pure series never writes the declared platform", async () => {
    // A failed scrape: the prometheus receiver's `up` alone.
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        resourceMetrics({
          storageSystem: "purestorage.flasharray",
          metrics: [gauge("up", [point(0)])],
        }),
      ]),
    );

    expect(spies.updateLastSeen).not.toHaveBeenCalled();
  });

  test("a malformed declaration is ignored", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        resourceMetrics({
          storageSystem: "not a platform!",
          metrics: [gauge("up", [point(1)])],
        }),
      ]),
    );

    expect(spies.updateLastSeen).not.toHaveBeenCalled();
  });

  test("two arrays in one batch keep their own declarations", async () => {
    const spies: Spies = setupIngestMocks({});
    const OTHER_ARRAY_ID: ObjectID = ObjectID.generate();
    spies.discoverArray.mockImplementation(
      async (data: { attributes: JSONArray }) => {
        const name: unknown = data.attributes.find((a: JSONObject) => {
          return a["key"] === "storage.array.name";
        })?.["value"];
        return (name as JSONObject)["stringValue"] === "ontap-01"
          ? OTHER_ARRAY_ID
          : ARRAY_ID;
      },
    );

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        declaring(fbArrayScrape(), "purestorage.flasharray"),
        resourceMetrics({
          arrayName: "ontap-01",
          storageSystem: "netapp.ontap",
          metrics: [gauge("netapp_volume_size_bytes", [point(GIB)])],
        }),
      ]),
    );

    const written: Map<string, StorageArraySnapshotExtras> = new Map(
      spies.updateLastSeen.mock.calls.map(
        (call: Array<unknown>): [string, StorageArraySnapshotExtras] => {
          return [
            (call[0] as ObjectID).toString(),
            call[1] as StorageArraySnapshotExtras,
          ];
        },
      ),
    );
    expect(written.get(ARRAY_ID.toString())?.storageSystem).toBe(
      StorageSystem.PureStorageFlashBlade,
    );
    expect(written.get(OTHER_ARRAY_ID.toString())).toEqual({
      storageSystem: "netapp.ontap",
    });
  });
});

describe("autoDiscoverStorageArray — the platform is left to the metrics", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ingest: Record<string, any> = OtelMetricsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  function discoveryMocks(): {
    updateLastSeen: jest.SpyInstance;
    findOrCreateByName: jest.SpyInstance;
  } {
    OtelMetricsIngestService.clearInProcessMemos();
    // The array id is cached, so discovery goes straight to maintenance.
    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(async (namespace: string) => {
        return namespace === "storage-array-id" ? ARRAY_ID.toString() : null;
      });
    jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);
    // The maintenance fence is free.
    jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);
    const findOrCreateByName: jest.SpyInstance = jest
      .spyOn(StorageArrayService, "findOrCreateByName")
      .mockRejectedValue(new Error("the cached id should have been used"));
    const updateLastSeen: jest.SpyInstance = jest
      .spyOn(StorageArrayService, "updateLastSeen")
      .mockResolvedValue(undefined);
    return { updateLastSeen, findOrCreateByName };
  }

  afterEach(() => {
    OtelMetricsIngestService.clearInProcessMemos();
  });

  test("the heartbeat carries the agent version and never the declared platform", async () => {
    const { updateLastSeen, findOrCreateByName } = discoveryMocks();

    const id: ObjectID | null = await ingest["autoDiscoverStorageArray"]({
      projectId: PROJECT_ID,
      attributes: attributes({
        "storage.array.name": "pure-fb-prod",
        // The compose default a FlashBlade .env forgot to override.
        "storage.system": "purestorage.flasharray",
        "oneuptime.agent.version": "1.4.0",
      }),
    });

    expect(id?.toString()).toBe(ARRAY_ID.toString());
    expect(findOrCreateByName).not.toHaveBeenCalled();
    expect(updateLastSeen).toHaveBeenCalledTimes(1);
    expect(updateLastSeen.mock.calls[0]![0].toString()).toBe(
      ARRAY_ID.toString(),
    );
    const written: StorageArraySnapshotExtras = updateLastSeen.mock
      .calls[0]![1] as StorageArraySnapshotExtras;
    expect(Object.keys(written)).toEqual(["agentVersion"]);
    expect(written.agentVersion).toBe("1.4.0");
  });

  test("without an agent version the heartbeat is liveness only", async () => {
    const { updateLastSeen } = discoveryMocks();

    await ingest["autoDiscoverStorageArray"]({
      projectId: PROJECT_ID,
      attributes: attributes({
        "storage.array.name": "pure-prod-01",
        "storage.system": "purestorage.flashblade",
      }),
    });

    const written: StorageArraySnapshotExtras = updateLastSeen.mock
      .calls[0]![1] as StorageArraySnapshotExtras;
    expect(written).not.toHaveProperty("storageSystem");
    expect(written.agentVersion).toBeUndefined();
  });
});
