import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import VMwareResourceService, {
  ParsedVMwareResource,
  VMwareResourceLatestMetric,
} from "Common/Server/Services/VMwareResourceService";
import VMwareVCenterService from "Common/Server/Services/VMwareVCenterService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The VMware snapshot path end to end: a realistic OTLP/JSON payload as
 * the OpenTelemetry Collector `vcenter` receiver emits it (one
 * ResourceMetrics per vSphere object, identity in RESOURCE attributes,
 * fan-out dimensions on the datapoints, `vmware.vcenter.name` stamped
 * by the agent's resource processor) goes through the real OTLP walk,
 * the real fold and the real flush, with only the Postgres seams
 * (bulkUpsert / bulkUpdateLatestMetrics / updateLastSeen) and the
 * unrelated backends (other discoveries, service resolution, ClickHouse
 * submit) mocked. Pins:
 *
 *   - the exact inventory rows handed to bulkUpsert (kinds, externalIds,
 *     parent names, isTemplate, inferred isPoweredOn),
 *   - the exact latest-metric mirror rows (unit conversions, derived
 *     capacities, summed counts),
 *   - the exact extras handed to updateLastSeen (from the same buffer),
 *   - a partial batch never zeroes a vCenter count,
 *   - the fold runs BEFORE the pipeline rules (a Drop rule must not
 *     blank the inventory or flip every VM to powered-off),
 *   - a failing inventory write is swallowed and the vCenter snapshot
 *     still lands.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const VCENTER_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();

const MIB: number = 1024 * 1024;

// 2023-11-14T22:13:20.000Z — one collection instant for the whole batch.
const BASE_MS: number = 1700000000000;
const OBSERVED_AT: Date = new Date(BASE_MS);

const VM_ON_ID: string = "5030a1b2-0000-4000-8000-000000000001";
const VM_OFF_ID: string = "5030a1b2-0000-4000-8000-000000000002";
const TEMPLATE_ID: string = "5030a1b2-0000-4000-8000-0000000000aa";

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
];

function toNano(ms: number): string {
  return `${ms}000000`;
}

function attributes(values: Record<string, string | boolean>): JSONArray {
  return Object.entries(values).map(
    ([key, value]: [string, string | boolean]) => {
      return {
        key,
        value:
          typeof value === "boolean"
            ? { boolValue: value }
            : { stringValue: value },
      };
    },
  );
}

function point(data: {
  value: number;
  labels?: Record<string, string | boolean>;
  asDouble?: boolean;
}): JSONObject {
  return {
    ...(data.asDouble
      ? { asDouble: data.value }
      : { asInt: String(data.value) }),
    startTimeUnixNano: toNano(BASE_MS - 120_000),
    timeUnixNano: toNano(BASE_MS),
    attributes: attributes(data.labels || {}),
  };
}

function gauge(
  name: string,
  unit: string,
  dataPoints: Array<JSONObject>,
): JSONObject {
  return { name, description: name, unit, gauge: { dataPoints } };
}

function sum(
  name: string,
  unit: string,
  dataPoints: Array<JSONObject>,
): JSONObject {
  return {
    name,
    description: name,
    unit,
    sum: { dataPoints, aggregationTemporality: 2, isMonotonic: false },
  };
}

function resourceMetrics(
  resourceAttributes: Record<string, string>,
  metrics: Array<JSONObject>,
): JSONObject {
  return {
    resource: {
      attributes: attributes({
        "vmware.vcenter.name": "vcsa-prod",
        ...resourceAttributes,
      }),
    },
    scopeMetrics: [
      {
        scope: {
          name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/vcenterreceiver",
          version: "0.110.0",
        },
        metrics,
      },
    ],
  };
}

const DC: Record<string, string> = { "vcenter.datacenter.name": "DC1" };
const CLUSTER: Record<string, string> = {
  ...DC,
  "vcenter.cluster.name": "Prod-Cluster",
};
const HOST: Record<string, string> = {
  ...CLUSTER,
  "vcenter.host.name": "esx01.example.com",
};

function datacenterBlock(): JSONObject {
  return resourceMetrics(DC, [
    sum("vcenter.datacenter.cpu.limit", "MHz", [point({ value: 96000 })]),
    sum("vcenter.datacenter.memory.limit", "By", [
      point({ value: 512 * 1024 * MIB }),
    ]),
    sum("vcenter.datacenter.disk.space", "By", [
      point({ value: 30 * 1024 * MIB, labels: { disk_state: "used" } }),
      point({ value: 70 * 1024 * MIB, labels: { disk_state: "available" } }),
    ]),
    sum("vcenter.datacenter.host.count", "{hosts}", [
      point({ value: 3, labels: { status: "green", power_state: "on" } }),
      point({ value: 1, labels: { status: "gray", power_state: "off" } }),
    ]),
    sum("vcenter.datacenter.vm.count", "{virtual_machines}", [
      point({ value: 40, labels: { status: "green", power_state: "on" } }),
      point({ value: 5, labels: { status: "green", power_state: "off" } }),
    ]),
    sum("vcenter.datacenter.cluster.count", "{clusters}", [
      point({ value: 1, labels: { status: "green" } }),
    ]),
    sum("vcenter.datacenter.datastore.count", "{datastores}", [
      point({ value: 2 }),
    ]),
  ]);
}

function clusterBlock(): JSONObject {
  return resourceMetrics(CLUSTER, [
    sum("vcenter.cluster.cpu.limit", "MHz", [point({ value: 64000 })]),
    sum("vcenter.cluster.cpu.effective", "MHz", [point({ value: 60000 })]),
    sum("vcenter.cluster.memory.limit", "By", [
      point({ value: 256 * 1024 * MIB }),
    ]),
    sum("vcenter.cluster.memory.effective", "By", [
      point({ value: 240 * 1024 * MIB }),
    ]),
    sum("vcenter.cluster.host.count", "{hosts}", [
      point({ value: 2, labels: { effective: true } }),
      point({ value: 1, labels: { effective: false } }),
    ]),
    sum("vcenter.cluster.vm.count", "{virtual_machines}", [
      point({ value: 30, labels: { power_state: "on" } }),
      point({ value: 4, labels: { power_state: "off" } }),
    ]),
    sum("vcenter.cluster.vm_template.count", "{virtual_machines}", [
      point({ value: 1 }),
    ]),
    // vSAN perf series — ClickHouse only, never the inventory.
    gauge("vcenter.cluster.vsan.latency.avg", "us", [
      point({ value: 900, labels: { type: "read" } }),
    ]),
  ]);
}

function hostBlock(): JSONObject {
  return resourceMetrics(HOST, [
    gauge("vcenter.host.cpu.utilization", "%", [
      point({ value: 42.5, asDouble: true }),
    ]),
    sum("vcenter.host.cpu.usage", "MHz", [point({ value: 13600 })]),
    sum("vcenter.host.cpu.capacity", "MHz", [point({ value: 32000 })]),
    sum("vcenter.host.memory.usage", "MiBy", [point({ value: 65536 })]),
    sum("vcenter.host.memory.capacity", "MiBy", [point({ value: 131072 })]),
    gauge("vcenter.host.memory.utilization", "%", [
      point({ value: 50, asDouble: true }),
    ]),
    gauge("vcenter.host.disk.latency.max", "ms", [
      point({ value: 4, labels: { object: "naa.600" } }),
    ]),
    gauge("vcenter.host.network.packet.error.rate", "{errors/s}", [
      point({ value: 0, asDouble: true, labels: { object: "vmnic0" } }),
    ]),
  ]);
}

function poweredOnVmBlock(): JSONObject {
  return resourceMetrics(
    {
      ...HOST,
      "vcenter.vm.name": "web-01",
      "vcenter.vm.id": VM_ON_ID,
      "vcenter.resource_pool.name": "Web",
      "vcenter.resource_pool.inventory_path":
        "/DC1/host/Prod-Cluster/Resources/Web",
    },
    [
      gauge("vcenter.vm.cpu.utilization", "%", [
        point({ value: 12.5, asDouble: true }),
      ]),
      sum("vcenter.vm.cpu.usage", "MHz", [point({ value: 800 })]),
      gauge("vcenter.vm.cpu.readiness", "%", [
        point({ value: 1.5, asDouble: true }),
      ]),
      sum("vcenter.vm.memory.usage", "MiBy", [point({ value: 2048 })]),
      gauge("vcenter.vm.memory.utilization", "%", [
        point({ value: 25, asDouble: true }),
      ]),
      sum("vcenter.vm.memory.ballooned", "MiBy", [point({ value: 0 })]),
      sum("vcenter.vm.memory.swapped", "MiBy", [point({ value: 0 })]),
      sum("vcenter.vm.disk.usage", "By", [
        point({ value: 20 * 1024 * MIB, labels: { disk_state: "used" } }),
        point({ value: 80 * 1024 * MIB, labels: { disk_state: "available" } }),
      ]),
      gauge("vcenter.vm.disk.utilization", "%", [
        point({ value: 20, asDouble: true }),
      ]),
      gauge("vcenter.vm.network.usage", "{KiBy/s}", [
        point({ value: 12, labels: { object: "4000" } }),
      ]),
    ],
  );
}

function poweredOffVmBlock(): JSONObject {
  return resourceMetrics(
    {
      ...HOST,
      "vcenter.vm.name": "batch-02",
      "vcenter.vm.id": VM_OFF_ID,
      "vcenter.virtual_app.name": "Batch vApp",
      "vcenter.virtual_app.inventory_path":
        "/DC1/host/Prod-Cluster/Resources/Batch vApp",
    },
    [
      sum("vcenter.vm.memory.usage", "MiBy", [point({ value: 0 })]),
      gauge("vcenter.vm.memory.utilization", "%", [
        point({ value: 0, asDouble: true }),
      ]),
      sum("vcenter.vm.disk.usage", "By", [
        point({ value: 10 * 1024 * MIB, labels: { disk_state: "used" } }),
        point({ value: 30 * 1024 * MIB, labels: { disk_state: "available" } }),
      ]),
    ],
  );
}

function templateBlock(): JSONObject {
  return resourceMetrics(
    {
      ...HOST,
      "vcenter.vm_template.name": "ubuntu-22.04-template",
      "vcenter.vm_template.id": TEMPLATE_ID,
    },
    [
      sum("vcenter.vm.disk.usage", "By", [
        point({ value: 5 * 1024 * MIB, labels: { disk_state: "used" } }),
        point({ value: 0, labels: { disk_state: "available" } }),
      ]),
    ],
  );
}

function datastoreBlock(): JSONObject {
  return resourceMetrics({ ...DC, "vcenter.datastore.name": "vsanDatastore" }, [
    sum("vcenter.datastore.disk.usage", "By", [
      point({ value: 30 * 1024 * MIB, labels: { disk_state: "used" } }),
      point({ value: 70 * 1024 * MIB, labels: { disk_state: "available" } }),
    ]),
    gauge("vcenter.datastore.disk.utilization", "%", [
      point({ value: 30, asDouble: true }),
    ]),
  ]);
}

function resourcePoolBlock(): JSONObject {
  return resourceMetrics(
    {
      ...CLUSTER,
      "vcenter.resource_pool.name": "Web",
      "vcenter.resource_pool.inventory_path":
        "/DC1/host/Prod-Cluster/Resources/Web",
    },
    [
      sum("vcenter.resource_pool.cpu.usage", "MHz", [point({ value: 1200 })]),
      sum("vcenter.resource_pool.memory.usage", "MiBy", [
        point({ value: 4096, labels: { type: "guest" } }),
        point({ value: 4200, labels: { type: "host" } }),
        point({ value: 104, labels: { type: "overhead" } }),
      ]),
      sum("vcenter.resource_pool.memory.ballooned", "MiBy", [
        point({ value: 16 }),
      ]),
      sum("vcenter.resource_pool.memory.swapped", "MiBy", [
        point({ value: 8 }),
      ]),
      sum("vcenter.resource_pool.cpu.shares", "{shares}", [
        point({ value: 4000 }),
      ]),
    ],
  );
}

function request(blocks: Array<JSONObject>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: { resourceMetrics: blocks },
    headers: {},
  } as unknown as TelemetryRequest;
}

function fullCollectionRequest(): TelemetryRequest {
  return request([
    datacenterBlock(),
    clusterBlock(),
    hostBlock(),
    poweredOnVmBlock(),
    poweredOffVmBlock(),
    templateBlock(),
    datastoreBlock(),
    resourcePoolBlock(),
  ]);
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
  bulkUpdateLatestMetrics: jest.SpyInstance;
  updateLastSeen: jest.SpyInstance;
  discoverVCenter: jest.SpyInstance;
}

function setupIngestMocks(data: {
  rules?: MetricRulesForProject;
  vcenterId?: ObjectID | null;
}): Spies {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelMetricsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
  jest.spyOn(service, "submitMetricsBuffer").mockResolvedValue(undefined);

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }
  const discoverVCenter: jest.SpyInstance = jest
    .spyOn(service, "autoDiscoverVMwareVCenter")
    .mockResolvedValue(
      data.vcenterId === undefined ? VCENTER_ID : data.vcenterId,
    );

  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: "vmware/vcsa-prod",
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.VMwareVCenter,
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
    .spyOn(VMwareResourceService, "bulkUpsert")
    .mockResolvedValue(undefined);
  const bulkUpdateLatestMetrics: jest.SpyInstance = jest
    .spyOn(VMwareResourceService, "bulkUpdateLatestMetrics")
    .mockResolvedValue(undefined);
  const updateLastSeen: jest.SpyInstance = jest
    .spyOn(VMwareVCenterService, "updateLastSeen")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);

  return {
    bulkUpsert,
    bulkUpdateLatestMetrics,
    updateLastSeen,
    discoverVCenter,
  };
}

function byExternalId<T extends { externalId: string }>(
  rows: Array<T>,
): Array<T> {
  return [...rows].sort((a: T, b: T) => {
    return a.externalId.localeCompare(b.externalId);
  });
}

function upsertedResources(spies: Spies): Array<ParsedVMwareResource> {
  expect(spies.bulkUpsert).toHaveBeenCalledTimes(1);
  const args: {
    projectId: ObjectID;
    vmwareVCenterId: ObjectID;
    resources: Array<ParsedVMwareResource>;
  } = spies.bulkUpsert.mock.calls[0]![0];
  expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
  expect(args.vmwareVCenterId.toString()).toBe(VCENTER_ID.toString());
  return byExternalId(args.resources);
}

function mirroredMetrics(spies: Spies): Array<VMwareResourceLatestMetric> {
  expect(spies.bulkUpdateLatestMetrics).toHaveBeenCalledTimes(1);
  const args: {
    projectId: ObjectID;
    vmwareVCenterId: ObjectID;
    metrics: Array<VMwareResourceLatestMetric>;
  } = spies.bulkUpdateLatestMetrics.mock.calls[0]![0];
  expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
  expect(args.vmwareVCenterId.toString()).toBe(VCENTER_ID.toString());
  return byExternalId(args.metrics);
}

function metricRow(
  rows: Array<VMwareResourceLatestMetric>,
  externalId: string,
): VMwareResourceLatestMetric {
  const row: VMwareResourceLatestMetric | undefined = rows.find(
    (r: VMwareResourceLatestMetric) => {
      return r.externalId === externalId;
    },
  );
  if (!row) {
    throw new Error(`expected mirrored metric row ${externalId}`);
  }
  return row;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("VMware snapshot ingest — full vcenter receiver collection", () => {
  test("every vSphere object becomes exactly one inventory row with the §3 identity", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      fullCollectionRequest(),
    );

    // One discovery per ResourceMetrics block.
    expect(spies.discoverVCenter).toHaveBeenCalledTimes(8);

    const rows: Array<ParsedVMwareResource> = upsertedResources(spies);
    expect(rows).toEqual(
      byExternalId([
        {
          kind: "Datacenter",
          externalId: "datacenter/DC1",
          name: "DC1",
          datacenterName: "DC1",
          clusterName: null,
          hostName: null,
          resourcePoolName: null,
          resourcePoolPath: null,
          virtualAppName: null,
          vmInstanceUuid: null,
          isTemplate: null,
          isPoweredOn: null,
          lastSeenAt: OBSERVED_AT,
        },
        {
          kind: "Cluster",
          externalId: "cluster/DC1/Prod-Cluster",
          name: "Prod-Cluster",
          datacenterName: "DC1",
          clusterName: "Prod-Cluster",
          hostName: null,
          resourcePoolName: null,
          resourcePoolPath: null,
          virtualAppName: null,
          vmInstanceUuid: null,
          isTemplate: null,
          isPoweredOn: null,
          lastSeenAt: OBSERVED_AT,
        },
        {
          kind: "Host",
          externalId: "host/DC1/esx01.example.com",
          name: "esx01.example.com",
          datacenterName: "DC1",
          clusterName: "Prod-Cluster",
          hostName: "esx01.example.com",
          resourcePoolName: null,
          resourcePoolPath: null,
          virtualAppName: null,
          vmInstanceUuid: null,
          isTemplate: null,
          isPoweredOn: null,
          lastSeenAt: OBSERVED_AT,
        },
        {
          kind: "VirtualMachine",
          externalId: `vm/${VM_ON_ID}`,
          name: "web-01",
          datacenterName: "DC1",
          clusterName: "Prod-Cluster",
          hostName: "esx01.example.com",
          resourcePoolName: "Web",
          resourcePoolPath: "/DC1/host/Prod-Cluster/Resources/Web",
          virtualAppName: null,
          vmInstanceUuid: VM_ON_ID,
          isTemplate: false,
          isPoweredOn: true,
          lastSeenAt: OBSERVED_AT,
        },
        {
          kind: "VirtualMachine",
          externalId: `vm/${VM_OFF_ID}`,
          name: "batch-02",
          datacenterName: "DC1",
          clusterName: "Prod-Cluster",
          hostName: "esx01.example.com",
          resourcePoolName: null,
          resourcePoolPath: "/DC1/host/Prod-Cluster/Resources/Batch vApp",
          virtualAppName: "Batch vApp",
          vmInstanceUuid: VM_OFF_ID,
          isTemplate: false,
          isPoweredOn: false,
          lastSeenAt: OBSERVED_AT,
        },
        {
          kind: "VirtualMachine",
          externalId: `vm/${TEMPLATE_ID}`,
          name: "ubuntu-22.04-template",
          datacenterName: "DC1",
          clusterName: "Prod-Cluster",
          hostName: "esx01.example.com",
          resourcePoolName: null,
          resourcePoolPath: null,
          virtualAppName: null,
          vmInstanceUuid: TEMPLATE_ID,
          isTemplate: true,
          isPoweredOn: null,
          lastSeenAt: OBSERVED_AT,
        },
        {
          kind: "Datastore",
          externalId: "datastore/DC1/vsanDatastore",
          name: "vsanDatastore",
          datacenterName: "DC1",
          clusterName: null,
          hostName: null,
          resourcePoolName: null,
          resourcePoolPath: null,
          virtualAppName: null,
          vmInstanceUuid: null,
          isTemplate: null,
          isPoweredOn: null,
          lastSeenAt: OBSERVED_AT,
        },
        {
          kind: "ResourcePool",
          externalId: "resourcepool//DC1/host/Prod-Cluster/Resources/Web",
          name: "Web",
          datacenterName: "DC1",
          clusterName: "Prod-Cluster",
          hostName: null,
          resourcePoolName: "Web",
          resourcePoolPath: "/DC1/host/Prod-Cluster/Resources/Web",
          virtualAppName: null,
          vmInstanceUuid: null,
          isTemplate: null,
          isPoweredOn: null,
          lastSeenAt: OBSERVED_AT,
        },
      ]),
    );
  });

  test("the latest-metric mirror carries the converted units, derived capacities and summed counts", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      fullCollectionRequest(),
    );

    const rows: Array<VMwareResourceLatestMetric> = mirroredMetrics(spies);
    expect(rows).toHaveLength(8);

    expect(metricRow(rows, "host/DC1/esx01.example.com")).toEqual({
      kind: "Host",
      externalId: "host/DC1/esx01.example.com",
      cpuPercent: 42.5,
      cpuMhz: 13600,
      cpuCapacityMhz: 32000,
      cpuEffectiveMhz: null,
      memoryBytes: 65536 * MIB,
      maxMemoryBytes: 131072 * MIB,
      memoryEffectiveBytes: null,
      memoryPercent: 50,
      diskBytes: null,
      maxDiskBytes: null,
      diskPercent: null,
      cpuReadinessPercent: null,
      memoryBalloonedBytes: null,
      memorySwappedBytes: null,
      hostCount: null,
      effectiveHostCount: null,
      poweredOnHostCount: null,
      vmCount: null,
      poweredOnVmCount: null,
      vmTemplateCount: null,
      datastoreCount: null,
      clusterCount: null,
      observedAt: OBSERVED_AT,
    });

    expect(metricRow(rows, `vm/${VM_ON_ID}`)).toMatchObject({
      kind: "VirtualMachine",
      cpuPercent: 12.5,
      cpuMhz: 800,
      cpuReadinessPercent: 1.5,
      memoryBytes: 2048 * MIB,
      // Derived: usage × 100 ÷ utilization (no vm.memory.capacity metric).
      maxMemoryBytes: 2048 * 4 * MIB,
      memoryPercent: 25,
      memoryBalloonedBytes: 0,
      memorySwappedBytes: 0,
      diskBytes: 20 * 1024 * MIB,
      maxDiskBytes: 100 * 1024 * MIB,
      diskPercent: 20,
    });

    expect(metricRow(rows, `vm/${VM_OFF_ID}`)).toMatchObject({
      cpuPercent: null,
      cpuMhz: null,
      memoryBytes: 0,
      maxMemoryBytes: null,
      diskBytes: 10 * 1024 * MIB,
      maxDiskBytes: 40 * 1024 * MIB,
    });

    expect(metricRow(rows, `vm/${TEMPLATE_ID}`)).toMatchObject({
      diskBytes: 5 * 1024 * MIB,
      maxDiskBytes: 5 * 1024 * MIB,
      cpuPercent: null,
      memoryBytes: null,
    });

    expect(metricRow(rows, "datastore/DC1/vsanDatastore")).toMatchObject({
      diskBytes: 30 * 1024 * MIB,
      maxDiskBytes: 100 * 1024 * MIB,
      diskPercent: 30,
    });

    expect(metricRow(rows, "cluster/DC1/Prod-Cluster")).toMatchObject({
      cpuCapacityMhz: 64000,
      cpuEffectiveMhz: 60000,
      maxMemoryBytes: 256 * 1024 * MIB,
      memoryEffectiveBytes: 240 * 1024 * MIB,
      hostCount: 3,
      effectiveHostCount: 2,
      vmCount: 34,
      poweredOnVmCount: 30,
      vmTemplateCount: 1,
      poweredOnHostCount: null,
      clusterCount: null,
    });

    expect(metricRow(rows, "datacenter/DC1")).toMatchObject({
      cpuCapacityMhz: 96000,
      maxMemoryBytes: 512 * 1024 * MIB,
      diskBytes: 30 * 1024 * MIB,
      maxDiskBytes: 100 * 1024 * MIB,
      hostCount: 4,
      poweredOnHostCount: 3,
      vmCount: 45,
      poweredOnVmCount: 40,
      clusterCount: 1,
      datastoreCount: 2,
      effectiveHostCount: null,
    });
    expect(metricRow(rows, "datacenter/DC1").diskPercent).toBeCloseTo(30, 9);

    expect(
      metricRow(rows, "resourcepool//DC1/host/Prod-Cluster/Resources/Web"),
    ).toMatchObject({
      cpuMhz: 1200,
      // type=guest only; host / overhead rows are not the pool's usage.
      memoryBytes: 4096 * MIB,
      memoryBalloonedBytes: 16 * MIB,
      memorySwappedBytes: 8 * MIB,
      cpuPercent: null,
    });
  });

  test("the vCenter snapshot extras come from the same buffer as the inventory", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      fullCollectionRequest(),
    );

    expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
    expect(spies.updateLastSeen.mock.calls[0]![0].toString()).toBe(
      VCENTER_ID.toString(),
    );
    expect(spies.updateLastSeen.mock.calls[0]![1]).toEqual({
      datacenterCount: 1,
      clusterCount: 1,
      hostCount: 1,
      vmCount: 2,
      poweredOnVmCount: 1,
      datastoreCount: 1,
      resourcePoolCount: 1,
      datastoreCapacityBytes: 100 * 1024 * MIB,
      datastoreUsedBytes: 30 * 1024 * MIB,
    });

    // Inventory is written before the vCenter counts (single-source rule).
    expect(spies.bulkUpsert.mock.invocationCallOrder[0]).toBeLessThan(
      spies.updateLastSeen.mock.invocationCallOrder[0]!,
    );
    expect(
      spies.bulkUpdateLatestMetrics.mock.invocationCallOrder[0],
    ).toBeLessThan(spies.updateLastSeen.mock.invocationCallOrder[0]!);
  });
});

describe("VMware snapshot ingest — partial batches and failure modes", () => {
  test("a partial batch (one host block) never zeroes the other vCenter counts", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([hostBlock()]),
    );

    const rows: Array<ParsedVMwareResource> = upsertedResources(spies);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.externalId).toBe("host/DC1/esx01.example.com");

    expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
    // ONLY hostCount — vmCount / datastoreCount / … keys must be absent.
    expect(spies.updateLastSeen.mock.calls[0]![1]).toEqual({ hostCount: 1 });
  });

  test("a batch of perf-only series creates no inventory row and no vCenter write", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        resourceMetrics(HOST, [
          gauge("vcenter.host.disk.latency.max", "ms", [
            point({ value: 4, labels: { object: "naa.600" } }),
          ]),
          gauge("vcenter.host.network.usage", "{KiBy/s}", [
            point({ value: 10, labels: { object: "vmnic0" } }),
          ]),
        ]),
      ]),
    );

    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(spies.bulkUpdateLatestMetrics).not.toHaveBeenCalled();
    expect(spies.updateLastSeen).not.toHaveBeenCalled();
  });

  test("a batch that is not a vCenter batch never touches the VMware tables", async () => {
    const spies: Spies = setupIngestMocks({ vcenterId: null });

    await OtelMetricsIngestService.processMetricsFromQueue(
      fullCollectionRequest(),
    );

    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(spies.bulkUpdateLatestMetrics).not.toHaveBeenCalled();
    expect(spies.updateLastSeen).not.toHaveBeenCalled();
  });

  test("the fold runs BEFORE the pipeline rules: a Drop rule neither blanks the inventory nor flips VMs to powered-off", async () => {
    const spies: Spies = setupIngestMocks({ rules: dropEverythingRules() });

    await OtelMetricsIngestService.processMetricsFromQueue(
      fullCollectionRequest(),
    );

    const rows: Array<ParsedVMwareResource> = upsertedResources(spies);
    expect(rows).toHaveLength(8);
    const vmOn: ParsedVMwareResource | undefined = rows.find(
      (r: ParsedVMwareResource) => {
        return r.externalId === `vm/${VM_ON_ID}`;
      },
    );
    expect(vmOn?.isPoweredOn).toBe(true);
    expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
    expect(spies.updateLastSeen.mock.calls[0]![1]).toMatchObject({
      vmCount: 2,
      poweredOnVmCount: 1,
    });
  });

  test("a failing inventory write is swallowed and the vCenter snapshot still lands", async () => {
    const spies: Spies = setupIngestMocks({});
    spies.bulkUpsert.mockRejectedValue(new Error("postgres down"));

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(fullCollectionRequest()),
    ).resolves.toBeUndefined();

    expect(spies.bulkUpsert).toHaveBeenCalledTimes(1);
    // The mirror UPDATE rides in the same try block, so it is skipped …
    expect(spies.bulkUpdateLatestMetrics).not.toHaveBeenCalled();
    // … but the vCenter counts have their own try block.
    expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
  });

  test("a failing vCenter write is swallowed too", async () => {
    const spies: Spies = setupIngestMocks({});
    spies.updateLastSeen.mockRejectedValue(new Error("postgres down"));

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(fullCollectionRequest()),
    ).resolves.toBeUndefined();

    expect(spies.bulkUpsert).toHaveBeenCalledTimes(1);
    expect(spies.bulkUpdateLatestMetrics).toHaveBeenCalledTimes(1);
  });
});
