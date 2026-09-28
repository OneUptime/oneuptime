import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import ProxmoxResourceService, {
  ParsedProxmoxResource,
  ProxmoxInventorySummary,
  ProxmoxResourceLatestMetric,
} from "Common/Server/Services/ProxmoxResourceService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * GitHub issue #4101: Proxmox VE's built-in OpenTelemetry push reached
 * OneUptime, but the Proxmox pages showed no data and the catalog checks
 * never fired — everything reads pve-exporter's pve_* shape, and the
 * native push sends proxmox_* series with a different identity model.
 *
 * This drives real native-push payloads (built the way
 * PVE::Status::OpenTelemetry builds them) through the real metrics
 * ingest — the in-place translation, the OTLP walk, the snapshot fold
 * and the flush — with only the Postgres seams and unrelated backends
 * mocked. Pins:
 *
 *   - the cluster is discovered from PVE's own `proxmox.cluster` (no
 *     hand-set resource attribute), and routed with no service.name,
 *   - the stored rows carry the pve_* series the pages and templates
 *     query, next to the untouched proxmox_* originals,
 *   - every node, guest and storage lands in the inventory with the
 *     same identity the agent path produces,
 *   - cluster counts come from the inventory, so a node's guest-only
 *     push does not report the cluster as that node's guest count.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();

const CTIME_S: number = 1700000000;
const TIME_NANO: number = CTIME_S * 1_000_000_000;
const OBSERVED_AT: Date = new Date(CTIME_S * 1000);
const GIB: number = 1024 * 1024 * 1024;

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
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

function attrs(values: Record<string, string>): JSONArray {
  return Object.entries(values).map(([key, value]: [string, string]) => {
    return { key, value: { stringValue: value } };
  });
}

function gauge(
  name: string,
  value: number,
  labels: Record<string, string>,
): JSONObject {
  return {
    name,
    unit: "1",
    gauge: {
      dataPoints: [
        {
          timeUnixNano: TIME_NANO,
          attributes: attrs(labels),
          ...(Number.isInteger(value) ? { asInt: value } : { asDouble: value }),
        },
      ],
    },
  };
}

function pvePush(
  metrics: Array<JSONObject>,
  resource: Record<string, string> = {},
): JSONObject {
  return {
    resource: {
      attributes: attrs({
        "service.name": "proxmox-ve",
        "service.version": "9.0.10/deb1ca707ec72a89",
        "proxmox.cluster": "homelab",
        "proxmox.node": "pve1",
        ...resource,
      }),
    },
    scopeMetrics: [{ scope: {}, metrics }],
  };
}

function nodePush(): JSONObject {
  const n: Record<string, string> = { node: "pve1" };
  return pvePush([
    gauge("proxmox_node_uptime", 86400, n),
    gauge("proxmox_node_cpustat_cpu", 0.25, n),
    gauge("proxmox_node_cpustat_cpus", 16, n),
    gauge("proxmox_node_memory_memtotal", 64 * GIB, n),
    gauge("proxmox_node_memory_memused", 16 * GIB, n),
    gauge("proxmox_node_blockstat_total", 100 * GIB, n),
    gauge("proxmox_node_blockstat_used", 40 * GIB, n),
  ]);
}

function qemuPush(): JSONObject {
  const vm: Record<string, string> = {
    vmid: "100",
    node: "pve1",
    name: "web",
    type: "qemu",
  };
  return pvePush([
    gauge("proxmox_vm_uptime", 3600, vm),
    gauge("proxmox_vm_cpu", 0.5, vm),
    gauge("proxmox_vm_mem", 2 * GIB, vm),
    gauge("proxmox_vm_maxmem", 8 * GIB, vm),
  ]);
}

function storagePush(): JSONObject {
  const s: Record<string, string> = { node: "pve1", storage: "local" };
  return pvePush([
    gauge("proxmox_storage_total", 100 * GIB, s),
    gauge("proxmox_storage_used", 40 * GIB, s),
    gauge("proxmox_storage_active", 1, s),
  ]);
}

function request(blocks: Array<JSONObject>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: { resourceMetrics: blocks },
    headers: {},
  } as unknown as TelemetryRequest;
}

interface Spies {
  rows: Array<JSONObject>;
  discoverProxmox: jest.SpyInstance;
  resolveResource: jest.SpyInstance;
  bulkUpsert: jest.SpyInstance;
  bulkUpdateLatestMetrics: jest.SpyInstance;
  getInventorySummary: jest.SpyInstance;
  updateLastSeen: jest.SpyInstance;
}

function setupIngestMocks(data: {
  inventory?: ProxmoxInventorySummary;
  clusterId?: ObjectID | null;
}): Spies {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelMetricsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  const rows: Array<JSONObject> = [];
  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
  jest
    .spyOn(service, "submitMetricsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const buffer: Array<JSONObject> = args[0] as Array<JSONObject>;
      rows.push(...buffer.splice(0, buffer.length));
      return Promise.resolve();
    });

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }
  const discoverProxmox: jest.SpyInstance = jest
    .spyOn(service, "autoDiscoverProxmoxCluster")
    .mockResolvedValue(
      data.clusterId === undefined ? CLUSTER_ID : data.clusterId,
    );

  const resolveResource: jest.SpyInstance = jest
    .spyOn(service, "resolveTelemetryResource")
    .mockResolvedValue({
      serviceName: "proxmox/homelab",
      primaryEntityId: CLUSTER_ID,
      primaryEntityType: ServiceType.ProxmoxCluster,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    });

  jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue({
    projectRules: [],
    rulesByServiceId: new Map(),
  });
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);

  const bulkUpsert: jest.SpyInstance = jest
    .spyOn(ProxmoxResourceService, "bulkUpsert")
    .mockResolvedValue(undefined);
  const bulkUpdateLatestMetrics: jest.SpyInstance = jest
    .spyOn(ProxmoxResourceService, "bulkUpdateLatestMetrics")
    .mockResolvedValue(undefined);
  const getInventorySummary: jest.SpyInstance = jest
    .spyOn(ProxmoxResourceService, "getInventorySummary")
    .mockResolvedValue(
      data.inventory || {
        countsByKind: {},
        nodeOnlineCount: 0,
        guestRunningCount: 0,
      },
    );
  const updateLastSeen: jest.SpyInstance = jest
    .spyOn(ProxmoxClusterService, "updateLastSeen")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);

  return {
    rows,
    discoverProxmox,
    resolveResource,
    bulkUpsert,
    bulkUpdateLatestMetrics,
    getInventorySummary,
    updateLastSeen,
  };
}

function stringAttr(attributes: JSONArray, key: string): Array<string> {
  return (attributes as Array<JSONObject>)
    .filter((a: JSONObject) => {
      return a["key"] === key;
    })
    .map((a: JSONObject) => {
      return (a["value"] as JSONObject)["stringValue"] as string;
    });
}

function upserted(spies: Spies): Array<ParsedProxmoxResource> {
  expect(spies.bulkUpsert).toHaveBeenCalledTimes(1);
  const args: {
    projectId: ObjectID;
    proxmoxClusterId: ObjectID;
    resources: Array<ParsedProxmoxResource>;
  } = spies.bulkUpsert.mock.calls[0]![0];
  expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
  expect(args.proxmoxClusterId.toString()).toBe(CLUSTER_ID.toString());
  return [...args.resources].sort(
    (a: ParsedProxmoxResource, b: ParsedProxmoxResource) => {
      return a.externalId.localeCompare(b.externalId);
    },
  );
}

function rowNames(rows: Array<JSONObject>): Set<string> {
  return new Set(
    rows.map((r: JSONObject) => {
      return r["name"] as string;
    }),
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Proxmox VE native OTLP push — ingest (issue #4101)", () => {
  test("the cluster is discovered from PVE's own proxmox.cluster, without a hand-set attribute", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([nodePush()]),
    );

    expect(spies.discoverProxmox).toHaveBeenCalledTimes(1);
    const attributes: JSONArray =
      spies.discoverProxmox.mock.calls[0]![0].attributes;
    expect(stringAttr(attributes, "proxmox.cluster.name")).toEqual([
      "homelab",
    ]);
  });

  test("the batch is routed with no service.name, so it lands on the cluster instead of a phantom 'proxmox-ve' Service", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([nodePush()]),
    );

    expect(spies.resolveResource).toHaveBeenCalledTimes(1);
    const args: { attributes: JSONArray; proxmoxClusterId: ObjectID } =
      spies.resolveResource.mock.calls[0]![0];
    expect(stringAttr(args.attributes, "service.name")).toEqual([]);
    expect(args.proxmoxClusterId.toString()).toBe(CLUSTER_ID.toString());
  });

  test("stored rows carry the pve_* series the Proxmox pages and templates query, next to the originals", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([nodePush(), qemuPush(), storagePush()]),
    );

    const names: Set<string> = rowNames(spies.rows);
    for (const expected of [
      "pve_up",
      "pve_node_info",
      "pve_guest_info",
      "pve_storage_info",
      "pve_version_info",
      "pve_uptime_seconds",
      "pve_cpu_usage_ratio",
      "pve_cpu_usage_limit",
      "pve_memory_usage_bytes",
      "pve_memory_size_bytes",
      "pve_disk_usage_bytes",
      "pve_disk_size_bytes",
      // The originals are still there for Metrics Explorer.
      "proxmox_node_cpustat_cpu",
      "proxmox_vm_cpu",
      "proxmox_storage_used",
    ]) {
      expect(names).toContain(expected);
    }

    const vmCpu: JSONObject | undefined = spies.rows.find((r: JSONObject) => {
      return (
        r["name"] === "pve_cpu_usage_ratio" &&
        (r["attributes"] as JSONObject)["id"] === "qemu/100"
      );
    });
    expect(vmCpu).toBeDefined();
    expect(vmCpu!["attributes"]).toMatchObject({
      id: "qemu/100",
      "pve.scope": "guest",
      "pve.type": "qemu",
      "pve.id": "100",
    });
  });

  test("every node, guest and storage becomes an inventory row with the agent's identity", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([nodePush(), qemuPush(), storagePush()]),
    );

    expect(upserted(spies)).toEqual([
      {
        kind: "Node",
        externalId: "node/pve1",
        name: "pve1",
        vmid: null,
        guestType: null,
        parentNodeName: null,
        isUp: true,
        haState: null,
        onboot: null,
        isBackedUp: null,
        uptimeSeconds: 86400,
        lastSeenAt: OBSERVED_AT,
      },
      {
        kind: "Guest",
        externalId: "qemu/100",
        name: "web",
        vmid: 100,
        guestType: "qemu",
        parentNodeName: "pve1",
        isUp: true,
        haState: null,
        onboot: null,
        isBackedUp: null,
        uptimeSeconds: 3600,
        lastSeenAt: OBSERVED_AT,
      },
      {
        kind: "Storage",
        externalId: "storage/pve1/local",
        name: "local",
        vmid: null,
        guestType: null,
        parentNodeName: "pve1",
        isUp: true,
        haState: null,
        onboot: null,
        isBackedUp: null,
        uptimeSeconds: null,
        lastSeenAt: OBSERVED_AT,
      },
    ]);

    const metrics: Array<ProxmoxResourceLatestMetric> =
      spies.bulkUpdateLatestMetrics.mock.calls[0]![0].metrics;
    const node: ProxmoxResourceLatestMetric | undefined = metrics.find(
      (m: ProxmoxResourceLatestMetric) => {
        return m.externalId === "node/pve1";
      },
    );
    expect(node).toEqual({
      kind: "Node",
      externalId: "node/pve1",
      cpuPercent: 25,
      memoryBytes: 16 * GIB,
      maxMemoryBytes: 64 * GIB,
      memoryPercent: 25,
      diskBytes: 40 * GIB,
      maxDiskBytes: 100 * GIB,
      observedAt: OBSERVED_AT,
    });
  });

  test("cluster counts come from the inventory, not from one node's push", async () => {
    const spies: Spies = setupIngestMocks({
      inventory: {
        countsByKind: { Node: 3, Guest: 14, Storage: 6 },
        nodeOnlineCount: 3,
        guestRunningCount: 11,
      },
    });

    // A guest-only push from one node of a three-node cluster.
    await OtelMetricsIngestService.processMetricsFromQueue(
      request([qemuPush()]),
    );

    expect(spies.getInventorySummary).toHaveBeenCalledTimes(1);
    expect(
      spies.getInventorySummary.mock.calls[0]![0].proxmoxClusterId.toString(),
    ).toBe(CLUSTER_ID.toString());
    expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
    expect(spies.updateLastSeen.mock.calls[0]![1]).toEqual({
      nodeCount: 3,
      onlineNodeCount: 3,
      guestCount: 14,
      storageCount: 6,
    });
  });

  test("the node push also records the PVE version", async () => {
    const spies: Spies = setupIngestMocks({
      inventory: {
        countsByKind: { Node: 1 },
        nodeOnlineCount: 1,
        guestRunningCount: 0,
      },
    });

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([nodePush()]),
    );

    expect(spies.updateLastSeen.mock.calls[0]![1]).toEqual({
      pveVersion: "9.0.10",
      nodeCount: 1,
      onlineNodeCount: 1,
    });
  });

  test("an inventory write failure is swallowed and never fails the batch", async () => {
    const spies: Spies = setupIngestMocks({});
    spies.getInventorySummary.mockRejectedValue(new Error("pg down"));

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(request([qemuPush()])),
    ).resolves.toBeUndefined();
    expect(rowNames(spies.rows)).toContain("pve_up");
  });

  test("with no cluster discovered, the series are still translated and stored", async () => {
    const spies: Spies = setupIngestMocks({ clusterId: null });

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([qemuPush()]),
    );

    expect(rowNames(spies.rows)).toContain("pve_cpu_usage_ratio");
    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(spies.getInventorySummary).not.toHaveBeenCalled();
  });
});

describe("Proxmox Agent batches are unaffected", () => {
  function agentBlock(): JSONObject {
    return {
      resource: { attributes: attrs({ "proxmox.cluster.name": "homelab" }) },
      scopeMetrics: [
        {
          scope: {},
          metrics: [
            gauge("pve_node_info", 1, { id: "node/pve1", name: "pve1" }),
            gauge("pve_up", 1, { id: "node/pve1" }),
            gauge("pve_node_info", 1, { id: "node/pve2", name: "pve2" }),
            gauge("pve_up", 0, { id: "node/pve2" }),
          ],
        },
      ],
    };
  }

  test("the agent's full scrape still counts itself, without an inventory read", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([agentBlock()]),
    );

    expect(spies.getInventorySummary).not.toHaveBeenCalled();
    expect(spies.updateLastSeen.mock.calls[0]![1]).toEqual({
      nodeCount: 2,
      onlineNodeCount: 1,
    });
  });

  test("the agent's rows are exactly the series it sent", async () => {
    const spies: Spies = setupIngestMocks({});

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([agentBlock()]),
    );

    expect([...rowNames(spies.rows)].sort()).toEqual([
      "pve_node_info",
      "pve_up",
    ]);
    expect(spies.rows).toHaveLength(4);
  });
});
