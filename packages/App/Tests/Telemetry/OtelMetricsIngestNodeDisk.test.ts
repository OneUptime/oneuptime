import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import KubernetesResourceService, {
  ResourceLatestNodeFilesystem,
  ResourceLatestVolumeStats,
} from "Common/Server/Services/KubernetesResourceService";
import KubernetesContainerService from "Common/Server/Services/KubernetesContainerService";
import KubernetesEphemeralVolumeClaims from "Common/Server/Utils/Telemetry/KubernetesEphemeralVolumeClaims";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A node's disks and a generic ephemeral volume's claim at ingest (#9644,
 * #9645), fed as the kubernetes-agent sends them: the kubeletstats
 * receiver's node group (k8s.node.filesystem.*, the node's root filesystem),
 * its container group (container.filesystem.*, each container's root
 * filesystem - the node's image filesystem), and its volume group, whose
 * `ephemeral:` volumes name no claim. Each 64-bit value arrives as a string.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const GIB: number = 1024 * 1024 * 1024;

const KUBELETSTATS_SCOPE: string =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/kubeletstatsreceiver";

// 2026-11-18T10:00:00Z and 30 seconds later, as nanoseconds.
const FIRST_SCRAPE: string = "1794996000000000000";
const SECOND_SCRAPE: string = "1794996030000000000";

const DISCOVERIES_RETURNING_NULL: Array<string> = [
  "autoDiscoverProxmoxCluster",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverIoTFleet",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverDockerSwarmCluster",
];

interface Spies {
  nodeFilesystems: jest.SpyInstance;
  volumeStats: jest.SpyInstance;
  resourceMetrics: jest.SpyInstance;
  containerMetrics: jest.SpyInstance;
  podOwnedClaims: jest.SpyInstance;
  rows: jest.SpyInstance;
  stored: Array<JSONObject>;
}

function request(blocks: Array<JSONObject>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: { resourceMetrics: blocks },
    headers: {},
  } as unknown as TelemetryRequest;
}

function setupIngest(): Spies {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelMetricsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
  // Each row as it was handed over: the buffer is emptied after.
  const stored: Array<JSONObject> = [];
  const rows: jest.SpyInstance = jest
    .spyOn(service, "submitMetricsBuffer")
    .mockImplementation(async (...args: Array<unknown>): Promise<void> => {
      stored.push(
        ...(args[0] as Array<JSONObject>).map((row: JSONObject) => {
          return JSON.parse(JSON.stringify(row)) as JSONObject;
        }),
      );
    });
  for (const method of DISCOVERIES_RETURNING_NULL) {
    if (typeof service[method] === "function") {
      jest.spyOn(service, method).mockResolvedValue(null);
    }
  }
  jest
    .spyOn(service, "autoDiscoverKubernetesCluster")
    .mockResolvedValue(CLUSTER_ID);
  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: "kubernetes-agent-prod",
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.KubernetesCluster,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });
  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);

  return {
    nodeFilesystems: jest
      .spyOn(KubernetesResourceService, "bulkUpdateLatestNodeFilesystems")
      .mockResolvedValue(undefined),
    volumeStats: jest
      .spyOn(KubernetesResourceService, "bulkUpdateLatestVolumeStats")
      .mockResolvedValue(undefined),
    resourceMetrics: jest
      .spyOn(KubernetesResourceService, "bulkUpdateLatestMetrics")
      .mockResolvedValue(undefined),
    containerMetrics: jest
      .spyOn(KubernetesContainerService, "bulkUpdateLatestMetrics")
      .mockResolvedValue(undefined),
    podOwnedClaims: jest
      .spyOn(KubernetesResourceService, "getPodOwnedVolumeClaims")
      .mockResolvedValue([
        { namespace: "web", name: "web2-scratch", podName: "web2" },
      ]),
    rows: rows,
    stored: stored,
  };
}

function block(
  attributes: Array<[string, string]>,
  readings: Record<string, number>,
  timeUnixNano: string = FIRST_SCRAPE,
): JSONObject {
  return {
    resource: {
      attributes: (
        [["k8s.cluster.name", "prod"], ...attributes] as Array<[string, string]>
      ).map(([key, value]: [string, string]): JSONObject => {
        return { key, value: { stringValue: value } };
      }),
    },
    scopeMetrics: [
      {
        scope: { name: KUBELETSTATS_SCOPE, version: "0.161.0" },
        metrics: Object.entries(readings).map(
          ([name, value]: [string, number]): JSONObject => {
            return {
              name: name,
              unit: "By",
              gauge: { dataPoints: [{ timeUnixNano, asInt: String(value) }] },
            };
          },
        ),
      },
    ],
  };
}

// A node's root filesystem, as the node group reports it.
function nodeBlock(
  capacity: number,
  available: number,
  timeUnixNano: string = FIRST_SCRAPE,
  node: string = "node-1",
): JSONObject {
  return block(
    [["k8s.node.name", node]],
    {
      "k8s.node.filesystem.capacity": capacity,
      "k8s.node.filesystem.available": available,
      "k8s.node.filesystem.usage": capacity - available,
    },
    timeUnixNano,
  );
}

// A container's root filesystem: the node's image filesystem.
function containerBlock(
  container: string,
  capacity: number,
  available: number,
  timeUnixNano: string = FIRST_SCRAPE,
): JSONObject {
  return block(
    [
      ["k8s.node.name", "node-1"],
      ["k8s.namespace.name", "web"],
      ["k8s.pod.name", "web2"],
      ["k8s.container.name", container],
    ],
    {
      "container.filesystem.capacity": capacity,
      "container.filesystem.available": available,
      "container.filesystem.usage": 64 * 1024 * 1024,
    },
    timeUnixNano,
  );
}

function writtenNodes(spies: Spies): Array<ResourceLatestNodeFilesystem> {
  expect(spies.nodeFilesystems).toHaveBeenCalledTimes(1);
  const call: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    nodes: Array<ResourceLatestNodeFilesystem>;
  } = spies.nodeFilesystems.mock.calls[0]![0];
  expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
  expect(call.kubernetesClusterId.toString()).toBe(CLUSTER_ID.toString());
  return call.nodes;
}

beforeEach(() => {
  KubernetesEphemeralVolumeClaims.clearCache();
});

afterEach(() => {
  jest.restoreAllMocks();
  KubernetesEphemeralVolumeClaims.clearCache();
});

describe("a node's disks at ingest", () => {
  test("mirror the root filesystem onto the node's row; an image filesystem read the same in one scrape is the same disk", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        nodeBlock(100 * GIB, 30 * GIB),
        containerBlock("app", 100 * GIB, 30 * GIB),
        containerBlock("sidecar", 100 * GIB, 30 * GIB),
      ]),
    );

    expect(writtenNodes(spies)).toEqual([
      {
        name: "node-1",
        capacityBytes: 100 * GIB,
        availableBytes: 30 * GIB,
        imageFs: { state: "same" },
        observedAt: new Date("2026-11-18T10:00:00.000Z"),
      },
    ]);
  });

  test("an image filesystem of another size, in the same scrape, is a disk of its own", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        nodeBlock(50 * GIB, 30 * GIB),
        containerBlock("app", 500 * GIB, 40 * GIB),
      ]),
    );

    expect(writtenNodes(spies)[0]!.imageFs).toEqual({
      state: "separate",
      capacityBytes: 500 * GIB,
      availableBytes: 40 * GIB,
    });
  });

  test("a batch with no container reading, or readings of two scrapes, cannot tell", async () => {
    let spies: Spies = setupIngest();
    await OtelMetricsIngestService.processMetricsFromQueue(
      request([nodeBlock(50 * GIB, 30 * GIB)]),
    );
    expect(writtenNodes(spies)[0]!.imageFs).toEqual({ state: "unknown" });

    jest.restoreAllMocks();
    spies = setupIngest();
    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        nodeBlock(50 * GIB, 30 * GIB, SECOND_SCRAPE),
        containerBlock("app", 500 * GIB, 40 * GIB, FIRST_SCRAPE),
      ]),
    );
    expect(writtenNodes(spies)[0]!.imageFs).toEqual({ state: "unknown" });
  });

  test("keeps each node's own, and each reading's latest point", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        nodeBlock(100 * GIB, 20 * GIB, SECOND_SCRAPE),
        nodeBlock(100 * GIB, 25 * GIB, FIRST_SCRAPE),
        nodeBlock(200 * GIB, 150 * GIB, FIRST_SCRAPE, "node-2"),
      ]),
    );

    const nodes: Array<ResourceLatestNodeFilesystem> = writtenNodes(spies);
    expect(
      nodes.map((node: ResourceLatestNodeFilesystem): string => {
        return `${node.name}=${node.availableBytes}`;
      }),
    ).toEqual([`node-1=${20 * GIB}`, `node-2=${150 * GIB}`]);
    expect(nodes[0]!.observedAt).toEqual(new Date("2026-11-18T10:00:30.000Z"));
  });

  test("never writes a node's CPU and memory, nor a container's, from a disk", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        nodeBlock(100 * GIB, 30 * GIB),
        containerBlock("app", 100 * GIB, 30 * GIB),
      ]),
    );

    expect(spies.resourceMetrics).not.toHaveBeenCalled();
    expect(spies.containerMetrics).not.toHaveBeenCalled();
  });

  test("a failed write is logged and never fails the batch", async () => {
    const spies: Spies = setupIngest();
    spies.nodeFilesystems.mockRejectedValue(new Error("connection reset"));

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(
        request([nodeBlock(100 * GIB, 30 * GIB)]),
      ),
    ).resolves.not.toThrow();
  });
});

describe("a generic ephemeral volume's claim at ingest", () => {
  function ephemeralBlock(volume: string): JSONObject {
    // As the receiver reports it: no k8s.volume.type, no claim.
    return block(
      [
        ["k8s.namespace.name", "web"],
        ["k8s.pod.name", "web2"],
        ["k8s.pod.uid", "uid-web2"],
        ["k8s.node.name", "node-1"],
        ["k8s.volume.name", volume],
      ],
      {
        "k8s.volume.capacity": 10 * GIB,
        "k8s.volume.available": GIB,
      },
    );
  }

  test("files its usage under the claim its pod owns, `<pod>-<volume>`", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([ephemeralBlock("scratch")]),
    );

    expect(spies.volumeStats).toHaveBeenCalledTimes(1);
    const volumes: Array<ResourceLatestVolumeStats> =
      spies.volumeStats.mock.calls[0]![0].volumes;
    expect(volumes).toEqual([
      {
        namespaceKey: "web",
        name: "web2-scratch",
        capacityBytes: 10 * GIB,
        availableBytes: GIB,
        inodes: null,
        inodesFree: null,
        observedAt: new Date("2026-11-18T10:00:00.000Z"),
      },
    ]);
    expect(spies.podOwnedClaims).toHaveBeenCalledTimes(1);
  });

  test("its stored series name the claim, so its charts and PVC Almost Full read it as any claim's", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([ephemeralBlock("scratch")]),
    );

    expect(spies.rows).toHaveBeenCalled();
    const volumeRows: Array<JSONObject> = spies.stored.filter(
      (row: JSONObject): boolean => {
        return String(row["name"]).startsWith("k8s.volume.");
      },
    );
    expect(volumeRows.length).toBeGreaterThan(0);
    for (const row of volumeRows) {
      const attributes: string = JSON.stringify(row["attributes"]);
      expect(attributes).toContain("web2-scratch");
      expect(attributes).toContain("persistentVolumeClaim");
    }
  });

  test("a volume no pod-owned claim matches - a projected token - is filed under nothing", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([ephemeralBlock("kube-api-access-x7k2p")]),
    );

    expect(spies.volumeStats).not.toHaveBeenCalled();
  });

  test("a claim's volume the receiver named is never looked up", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        block(
          [
            ["k8s.namespace.name", "web"],
            ["k8s.pod.name", "web2"],
            ["k8s.volume.name", "data"],
            ["k8s.volume.type", "persistentVolumeClaim"],
            ["k8s.persistentvolumeclaim.name", "data2"],
          ],
          { "k8s.volume.capacity": 10 * GIB },
        ),
      ]),
    );

    expect(spies.podOwnedClaims).not.toHaveBeenCalled();
    expect(spies.volumeStats.mock.calls[0]![0].volumes[0].name).toBe("data2");
  });

  test("a failed read of the claims leaves the batch whole", async () => {
    const spies: Spies = setupIngest();
    spies.podOwnedClaims.mockRejectedValue(new Error("connection reset"));

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(
        request([ephemeralBlock("scratch")]),
      ),
    ).resolves.not.toThrow();
    expect(spies.volumeStats).not.toHaveBeenCalled();
  });
});

/*
 * What a collector that labels generic ephemeral volumes sends (#9842):
 * the type `ephemeral` (opentelemetry-collector-contrib#52321), and the
 * claim too (#52198). Each is filed under its claim from the series alone,
 * so a new pod's usage is filed before the inventory holds its claim, and
 * PVC Almost Full, which reads the volumes typed persistentVolumeClaim, sees
 * it as any claim's.
 */
describe("a generic ephemeral volume a collector labels, at ingest", () => {
  function labelledBlock(fields: {
    volume?: string;
    type?: string;
    claim?: string;
  }): JSONObject {
    const attributes: Array<[string, string]> = [
      ["k8s.namespace.name", "web"],
      ["k8s.pod.name", "web3"],
      ["k8s.pod.uid", "uid-web3"],
      ["k8s.node.name", "node-1"],
      ["k8s.volume.name", fields.volume ?? "scratch"],
    ];
    if (fields.type !== undefined) {
      attributes.push(["k8s.volume.type", fields.type]);
    }
    if (fields.claim !== undefined) {
      attributes.push(["k8s.persistentvolumeclaim.name", fields.claim]);
    }
    return block(attributes, {
      "k8s.volume.capacity": 20 * GIB,
      "k8s.volume.available": 5 * GIB,
    });
  }

  function storedVolumeAttributes(spies: Spies): Array<JSONObject> {
    return spies.stored
      .filter((row: JSONObject): boolean => {
        return String(row["name"]).startsWith("k8s.volume.");
      })
      .map((row: JSONObject): JSONObject => {
        return row["attributes"] as JSONObject;
      });
  }

  test("a claim the series names is the one its usage is filed under, read from nowhere else", async () => {
    const spies: Spies = setupIngest();
    // The inventory knows no claim of this pod's yet.
    spies.podOwnedClaims.mockResolvedValue([]);

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([labelledBlock({ type: "ephemeral", claim: "web3-scratch" })]),
    );

    expect(spies.podOwnedClaims).not.toHaveBeenCalled();
    expect(spies.volumeStats).toHaveBeenCalledTimes(1);
    expect(spies.volumeStats.mock.calls[0]![0].volumes).toEqual([
      {
        namespaceKey: "web",
        name: "web3-scratch",
        capacityBytes: 20 * GIB,
        availableBytes: 5 * GIB,
        inodes: null,
        inodesFree: null,
        observedAt: new Date("2026-11-18T10:00:00.000Z"),
      },
    ]);
  });

  test("and its stored series are typed a claim's, as PVC Almost Full reads them", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([labelledBlock({ type: "ephemeral", claim: "web3-scratch" })]),
    );

    const stored: Array<JSONObject> = storedVolumeAttributes(spies);
    expect(stored.length).toBeGreaterThan(0);
    for (const attributes of stored) {
      const text: string = JSON.stringify(attributes);
      expect(text).toContain("web3-scratch");
      expect(text).toContain("persistentVolumeClaim");
      expect(text).not.toContain('"ephemeral"');
    }
  });

  test("a volume typed ephemeral with no claim is filed under `<pod>-<volume>`, with no read", async () => {
    const spies: Spies = setupIngest();
    spies.podOwnedClaims.mockResolvedValue([]);

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([labelledBlock({ type: "ephemeral" })]),
    );

    expect(spies.podOwnedClaims).not.toHaveBeenCalled();
    expect(spies.volumeStats.mock.calls[0]![0].volumes[0].name).toBe(
      "web3-scratch",
    );
    for (const attributes of storedVolumeAttributes(spies)) {
      expect(JSON.stringify(attributes)).toContain("persistentVolumeClaim");
    }
  });

  test("a volume typed projected is filed under nothing, and never looked up, whatever it is called", async () => {
    const spies: Spies = setupIngest();
    spies.podOwnedClaims.mockResolvedValue([
      { namespace: "web", name: "web3-bundle", podName: "web3" },
    ]);

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        labelledBlock({ volume: "bundle", type: "projected" }),
        labelledBlock({ volume: "kube-api-access-x7k2p", type: "projected" }),
      ]),
    );

    expect(spies.podOwnedClaims).not.toHaveBeenCalled();
    expect(spies.volumeStats).not.toHaveBeenCalled();
    for (const attributes of storedVolumeAttributes(spies)) {
      expect(JSON.stringify(attributes)).not.toContain("persistentvolumeclaim");
    }
  });

  test("beside an unlabelled one, which is still looked up, once", async () => {
    const spies: Spies = setupIngest();
    spies.podOwnedClaims.mockResolvedValue([
      { namespace: "web", name: "web3-cache", podName: "web3" },
    ]);

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        labelledBlock({ type: "ephemeral", claim: "web3-scratch" }),
        labelledBlock({ volume: "cache" }),
      ]),
    );

    expect(spies.podOwnedClaims).toHaveBeenCalledTimes(1);
    expect(
      spies.volumeStats.mock.calls[0]![0].volumes.map(
        (volume: ResourceLatestVolumeStats): string => {
          return volume.name;
        },
      ).sort(),
    ).toEqual(["web3-cache", "web3-scratch"]);
  });
});
