import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import KubernetesResourceService, {
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
 * A pod's volume at ingest, under either name it can go by (#10055). The
 * kubelet receiver names it k8s.volume.name and k8s.volume.type and sends its
 * usage as k8s.volume.*; semantic conventions renamed the attributes
 * k8s.pod.volume.name and k8s.pod.volume.type (semantic-conventions#4272) and
 * name the series k8s.pod.volume.*, up-down counters. A collector that
 * follows them, or sends both names while it moves, must reach the claims
 * pages, PVC Almost Full and Needs attention as the receiver's names do, and
 * each reading only once.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const GIB: number = 1024 * 1024 * 1024;

const KUBELETSTATS_SCOPE: string =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/kubeletstatsreceiver";

// 2026-11-18T10:00:00Z, as nanoseconds.
const SCRAPE: string = "1794996000000000000";

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
  volumeStats: jest.SpyInstance;
  podOwnedClaims: jest.SpyInstance;
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
  jest
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
  jest
    .spyOn(KubernetesResourceService, "bulkUpdateLatestMetrics")
    .mockResolvedValue(undefined);
  jest
    .spyOn(KubernetesResourceService, "bulkUpdateLatestNodeFilesystems")
    .mockResolvedValue(undefined);
  jest
    .spyOn(KubernetesContainerService, "bulkUpdateLatestMetrics")
    .mockResolvedValue(undefined);

  return {
    volumeStats: jest
      .spyOn(KubernetesResourceService, "bulkUpdateLatestVolumeStats")
      .mockResolvedValue(undefined),
    podOwnedClaims: jest
      .spyOn(KubernetesResourceService, "getPodOwnedVolumeClaims")
      .mockResolvedValue([
        { namespace: "web", name: "web4-cache", podName: "web4" },
      ]),
    stored: stored,
  };
}

type Series = "receiver" | "semconv";

/*
 * One volume's resource: its pod's attributes and its own, and its capacity
 * and free bytes under the receiver's series names (gauges) or semantic
 * conventions' (up-down counters), or both.
 */
function volumeBlock(data: {
  attributes: Array<[string, string]>;
  series: Array<Series>;
}): JSONObject {
  const metrics: Array<JSONObject> = [];
  for (const series of data.series) {
    const point: JSONObject = { timeUnixNano: SCRAPE };
    const reading: (name: string, value: number) => JSONObject = (
      name: string,
      value: number,
    ): JSONObject => {
      const points: Array<JSONObject> = [{ ...point, asInt: String(value) }];
      return series === "receiver"
        ? { name, unit: "By", gauge: { dataPoints: points } }
        : {
            name,
            unit: "By",
            sum: {
              aggregationTemporality: 2,
              isMonotonic: false,
              dataPoints: points,
            },
          };
    };
    const prefix: string =
      series === "receiver" ? "k8s.volume" : "k8s.pod.volume";
    metrics.push(
      reading(`${prefix}.capacity`, 20 * GIB),
      reading(`${prefix}.available`, 5 * GIB),
    );
  }

  return {
    resource: {
      attributes: (
        [
          ["k8s.cluster.name", "prod"],
          ["k8s.namespace.name", "web"],
          ["k8s.pod.name", "web4"],
          ["k8s.pod.uid", "uid-web4"],
          ["k8s.node.name", "node-1"],
          ...data.attributes,
        ] as Array<[string, string]>
      ).map(([key, value]: [string, string]): JSONObject => {
        return { key, value: { stringValue: value } };
      }),
    },
    scopeMetrics: [
      {
        scope: { name: KUBELETSTATS_SCOPE, version: "0.170.0" },
        metrics,
      },
    ],
  };
}

// A claim's volume, its claim named, under the semantic conventions names.
const CLAIM_ATTRIBUTES: Array<[string, string]> = [
  ["k8s.pod.volume.name", "data"],
  ["k8s.pod.volume.type", "persistentVolumeClaim"],
  ["k8s.persistentvolumeclaim.name", "data-web4"],
];

function storedVolumeRows(spies: Spies): Array<JSONObject> {
  return spies.stored.filter((row: JSONObject): boolean => {
    return String(row["name"]).includes("volume.");
  });
}

function writtenClaims(spies: Spies): Array<ResourceLatestVolumeStats> {
  expect(spies.volumeStats).toHaveBeenCalledTimes(1);
  return spies.volumeStats.mock.calls[0]![0].volumes;
}

const FILED_CLAIM: ResourceLatestVolumeStats = {
  namespaceKey: "web",
  name: "data-web4",
  capacityBytes: 20 * GIB,
  availableBytes: 5 * GIB,
  inodes: null,
  inodesFree: null,
  observedAt: new Date("2026-11-18T10:00:00.000Z"),
};

beforeEach(() => {
  KubernetesEphemeralVolumeClaims.clearCache();
});

afterEach(() => {
  jest.restoreAllMocks();
  KubernetesEphemeralVolumeClaims.clearCache();
});

describe("a claim's volume, named the semantic conventions way, at ingest", () => {
  test("files its usage under its claim, from semantic conventions' series", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        volumeBlock({ attributes: CLAIM_ATTRIBUTES, series: ["semconv"] }),
      ]),
    );

    expect(writtenClaims(spies)).toEqual([FILED_CLAIM]);
    expect(spies.podOwnedClaims).not.toHaveBeenCalled();
  });

  test("and from the receiver's series, when only the attributes moved", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        volumeBlock({ attributes: CLAIM_ATTRIBUTES, series: ["receiver"] }),
      ]),
    );

    expect(writtenClaims(spies)).toEqual([FILED_CLAIM]);
  });

  test("stores each reading under the receiver's name, typed a claim's, as PVC Almost Full and the claims pages read it", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        volumeBlock({ attributes: CLAIM_ATTRIBUTES, series: ["semconv"] }),
      ]),
    );

    const rows: Array<JSONObject> = storedVolumeRows(spies);
    expect(
      rows
        .map((row: JSONObject): string => {
          return String(row["name"]);
        })
        .sort(),
    ).toEqual(["k8s.volume.available", "k8s.volume.capacity"]);
    for (const row of rows) {
      const attributes: string = JSON.stringify(row["attributes"]);
      // The names every reader of a volume reads...
      expect(attributes).toContain(
        '"resource.k8s.volume.type":"persistentVolumeClaim"',
      );
      expect(attributes).toContain('"resource.k8s.volume.name":"data"');
      expect(attributes).toContain(
        '"resource.k8s.persistentvolumeclaim.name":"data-web4"',
      );
      // ...beside the ones the collector sent.
      expect(attributes).toContain('"resource.k8s.pod.volume.name":"data"');
    }
  });
});

describe("a volume sent under both names at once, at ingest", () => {
  test("is filed under its claim once", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        volumeBlock({
          attributes: [
            ["k8s.volume.name", "data"],
            ["k8s.volume.type", "persistentVolumeClaim"],
            ...CLAIM_ATTRIBUTES,
          ],
          series: ["receiver", "semconv"],
        }),
      ]),
    );

    expect(writtenClaims(spies)).toEqual([FILED_CLAIM]);
  });

  test("stores each reading once, under the receiver's name: nothing counts it twice", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        volumeBlock({
          attributes: [["k8s.volume.name", "data"], ...CLAIM_ATTRIBUTES],
          series: ["receiver", "semconv"],
        }),
      ]),
    );

    expect(
      storedVolumeRows(spies)
        .map((row: JSONObject): string => {
          return String(row["name"]);
        })
        .sort(),
    ).toEqual(["k8s.volume.available", "k8s.volume.capacity"]);
  });
});

describe("a generic ephemeral volume, named the semantic conventions way, at ingest", () => {
  test("typed ephemeral with no claim, is filed under `<pod>-<volume>`, with no read", async () => {
    const spies: Spies = setupIngest();
    spies.podOwnedClaims.mockResolvedValue([]);

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        volumeBlock({
          attributes: [
            ["k8s.pod.volume.name", "scratch"],
            ["k8s.pod.volume.type", "ephemeral"],
          ],
          series: ["semconv"],
        }),
      ]),
    );

    expect(spies.podOwnedClaims).not.toHaveBeenCalled();
    expect(writtenClaims(spies)[0]!.name).toBe("web4-scratch");
    for (const row of storedVolumeRows(spies)) {
      const attributes: string = JSON.stringify(row["attributes"]);
      expect(attributes).toContain(
        '"resource.k8s.volume.type":"persistentVolumeClaim"',
      );
      expect(attributes).toContain(
        '"resource.k8s.persistentvolumeclaim.name":"web4-scratch"',
      );
      // What the collector said of the pod's spec stays as it said it.
      expect(attributes).toContain(
        '"resource.k8s.pod.volume.type":"ephemeral"',
      );
    }
  });

  test("untyped, is looked up among its pod's claims, once", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        volumeBlock({
          attributes: [["k8s.pod.volume.name", "cache"]],
          series: ["semconv"],
        }),
      ]),
    );

    expect(spies.podOwnedClaims).toHaveBeenCalledTimes(1);
    expect(writtenClaims(spies)[0]!.name).toBe("web4-cache");
  });
});

describe("a pod's small volume, named the semantic conventions way, at ingest", () => {
  test("a projected one is filed under no claim, and never looked up", async () => {
    const spies: Spies = setupIngest();
    spies.podOwnedClaims.mockResolvedValue([
      { namespace: "web", name: "web4-bundle", podName: "web4" },
    ]);

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        volumeBlock({
          attributes: [
            ["k8s.pod.volume.name", "bundle"],
            ["k8s.pod.volume.type", "projected"],
          ],
          series: ["semconv"],
        }),
      ]),
    );

    expect(spies.podOwnedClaims).not.toHaveBeenCalled();
    expect(spies.volumeStats).not.toHaveBeenCalled();
    for (const row of storedVolumeRows(spies)) {
      expect(JSON.stringify(row["attributes"])).not.toContain(
        "persistentvolumeclaim",
      );
    }
  });
});
