import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import KubernetesResourceService, {
  ResourceLatestVolumeStats,
} from "Common/Server/Services/KubernetesResourceService";
import KubernetesContainerService from "Common/Server/Services/KubernetesContainerService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A persistent volume claim's used, free and capacity at ingest (#9539).
 *
 * The kubernetes-agent's kubeletstats receiver reports every volume a
 * running pod mounts (k8s.volume.capacity, k8s.volume.available,
 * k8s.volume.inodes, k8s.volume.inodes.free), and names a claim's volume by
 * k8s.persistentvolumeclaim.name. Ingest mirrors the latest point of each
 * claim onto its row (KubernetesResourceService.bulkUpdateLatestVolumeStats),
 * which the Persistent Volume Claims pages read. Fed here as the agent sends
 * them: int gauges whose 64-bit values arrive as strings, one resource per
 * pod volume.
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
  volumeStats: jest.SpiedFunction<
    typeof KubernetesResourceService.bulkUpdateLatestVolumeStats
  >;
  resourceMetrics: jest.SpiedFunction<
    typeof KubernetesResourceService.bulkUpdateLatestMetrics
  >;
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
  jest.spyOn(service, "submitMetricsBuffer").mockResolvedValue(undefined);
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
    .spyOn(KubernetesContainerService, "bulkUpdateLatestMetrics")
    .mockResolvedValue(undefined);

  return {
    volumeStats: jest
      .spyOn(KubernetesResourceService, "bulkUpdateLatestVolumeStats")
      .mockResolvedValue(undefined),
    resourceMetrics: jest
      .spyOn(KubernetesResourceService, "bulkUpdateLatestMetrics")
      .mockResolvedValue(undefined),
  };
}

interface VolumeResource {
  pod: string;
  namespace?: string;
  volume: string;
  // The claim the pod mounts the volume from; none for a configMap.
  claim?: string | undefined;
  type: string;
}

// One pod volume's readings, as the agent sends them.
function volumeBlock(
  resource: VolumeResource,
  readings: Record<string, number>,
  timeUnixNano: string = FIRST_SCRAPE,
): JSONObject {
  const attributes: Array<[string, string]> = [
    ["k8s.cluster.name", "prod"],
    ["k8s.namespace.name", resource.namespace || "data"],
    ["k8s.pod.name", resource.pod],
    ["k8s.pod.uid", `uid-${resource.pod}`],
    ["k8s.node.name", "node-1"],
    ["k8s.volume.name", resource.volume],
    ["k8s.volume.type", resource.type],
  ];
  if (resource.claim) {
    attributes.push(["k8s.persistentvolumeclaim.name", resource.claim]);
  }

  return {
    resource: {
      attributes: attributes.map(
        ([key, value]: [string, string]): JSONObject => {
          return { key, value: { stringValue: value } };
        },
      ),
    },
    scopeMetrics: [
      {
        scope: { name: KUBELETSTATS_SCOPE, version: "0.161.0" },
        metrics: Object.entries(readings).map(
          ([name, value]: [string, number]): JSONObject => {
            return {
              name: name,
              unit: name.includes("inodes") ? "1" : "By",
              gauge: {
                // int64 travels as a string in OTLP JSON.
                dataPoints: [{ timeUnixNano, asInt: String(value) }],
              },
            };
          },
        ),
      },
    ],
  };
}

const POSTGRES_DATA: VolumeResource = {
  pod: "postgres-0",
  volume: "data",
  claim: "data-postgres-0",
  type: "persistentVolumeClaim",
};

function writtenVolumes(spies: Spies): Array<ResourceLatestVolumeStats> {
  expect(spies.volumeStats).toHaveBeenCalledTimes(1);
  const call: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    volumes: Array<ResourceLatestVolumeStats>;
  } = spies.volumeStats.mock.calls[0]![0];
  expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
  expect(call.kubernetesClusterId.toString()).toBe(CLUSTER_ID.toString());
  return call.volumes;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a persistent volume claim's usage at ingest", () => {
  test("mirrors a claim's capacity, available bytes and inodes onto its row", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        volumeBlock(POSTGRES_DATA, {
          "k8s.volume.capacity": 50 * GIB,
          "k8s.volume.available": 14 * GIB,
          "k8s.volume.inodes": 3276800,
          "k8s.volume.inodes.free": 3200000,
          // Stored like any metric, never mirrored.
          "k8s.volume.inodes.used": 76800,
        }),
      ]),
    );

    expect(writtenVolumes(spies)).toEqual([
      {
        namespaceKey: "data",
        name: "data-postgres-0",
        capacityBytes: 50 * GIB,
        availableBytes: 14 * GIB,
        inodes: 3276800,
        inodesFree: 3200000,
        observedAt: new Date("2026-11-18T10:00:00.000Z"),
      },
    ]);
  });

  test("never files a volume that names no claim: a configMap, a secret, a token", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        volumeBlock(
          { pod: "postgres-0", volume: "config", type: "configMap" },
          { "k8s.volume.capacity": 8 * GIB, "k8s.volume.available": GIB },
        ),
        volumeBlock(
          { pod: "postgres-0", volume: "kube-api-access-x7k2p", type: "" },
          { "k8s.volume.capacity": 8 * GIB, "k8s.volume.available": GIB },
        ),
      ]),
    );

    expect(spies.volumeStats).not.toHaveBeenCalled();
  });

  test("writes one row per claim that several pods mount, with each reading's latest point", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        volumeBlock(
          { ...POSTGRES_DATA, pod: "reader-a" },
          {
            "k8s.volume.capacity": 100 * GIB,
            "k8s.volume.available": 40 * GIB,
          },
          SECOND_SCRAPE,
        ),
        volumeBlock(
          { ...POSTGRES_DATA, pod: "reader-b" },
          {
            "k8s.volume.capacity": 100 * GIB,
            "k8s.volume.available": 41 * GIB,
          },
          FIRST_SCRAPE,
        ),
      ]),
    );

    const volumes: Array<ResourceLatestVolumeStats> = writtenVolumes(spies);
    expect(volumes).toHaveLength(1);
    expect(volumes[0]!.availableBytes).toBe(40 * GIB);
    expect(volumes[0]!.capacityBytes).toBe(100 * GIB);
    expect(volumes[0]!.observedAt).toEqual(
      new Date("2026-11-18T10:00:30.000Z"),
    );
  });

  test("keeps two claims of the same name in different namespaces apart", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        volumeBlock(
          { ...POSTGRES_DATA, namespace: "billing" },
          { "k8s.volume.available": GIB },
        ),
        volumeBlock(
          { ...POSTGRES_DATA, namespace: "orders" },
          { "k8s.volume.available": 2 * GIB },
        ),
      ]),
    );

    const volumes: Array<ResourceLatestVolumeStats> = writtenVolumes(spies);
    expect(
      volumes
        .map((v: ResourceLatestVolumeStats): string => {
          return `${v.namespaceKey}/${v.name}=${v.availableBytes}`;
        })
        .sort(),
    ).toEqual([
      `billing/data-postgres-0=${GIB}`,
      `orders/data-postgres-0=${2 * GIB}`,
    ]);
    // A reading the batch did not carry stays null, so the row keeps its own.
    expect(volumes[0]!.capacityBytes).toBeNull();
  });

  test("files an in-tree disk's claim by its name, whatever type the receiver gives it", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        volumeBlock(
          { ...POSTGRES_DATA, type: "awsElasticBlockStore" },
          { "k8s.volume.capacity": 20 * GIB },
        ),
      ]),
    );

    expect(writtenVolumes(spies)[0]!.capacityBytes).toBe(20 * GIB);
  });

  test("never writes a pod's or a node's CPU and memory from a volume", async () => {
    const spies: Spies = setupIngest();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        volumeBlock(POSTGRES_DATA, {
          "k8s.volume.capacity": 50 * GIB,
          "k8s.volume.available": 14 * GIB,
        }),
      ]),
    );

    expect(spies.resourceMetrics).not.toHaveBeenCalled();
  });

  test("a failed write is logged and never fails the batch", async () => {
    const spies: Spies = setupIngest();
    spies.volumeStats.mockRejectedValue(new Error("connection reset"));

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(
        request([
          volumeBlock(POSTGRES_DATA, { "k8s.volume.capacity": 50 * GIB }),
        ]),
      ),
    ).resolves.not.toThrow();
  });
});
