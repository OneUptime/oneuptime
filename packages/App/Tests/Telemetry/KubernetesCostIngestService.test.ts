import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import {
  KubernetesCostMemoryPeaksSource,
  KubernetesCostPricingSource,
} from "Common/Types/Kubernetes/KubernetesCostPricing";
import { keyForKubernetesCluster } from "Common/Utils/Telemetry/EntityKey";
import {
  KubernetesCostAllocationIngestRow,
  KubernetesCostIngestPayload,
} from "Common/Types/Kubernetes/KubernetesCostIngest";
import { readOwnValue } from "Common/Utils/LookupTable";
import { INHERITED_PROPERTY_NAMES } from "Common/Tests/Helpers/InheritedNames";

/*
 * The Queue module pulls in BullMQ / bull-board at import time (via the
 * TelemetryQueueService type import) — replace it wholesale, same as
 * TelemetryQueueService.test.ts.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Telemetry: "Telemetry",
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/KubernetesClusterService", () => {
  return {
    __esModule: true,
    default: {
      findOrCreateByClusterIdentifier: jest.fn(),
      updateLastSeen: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/KubernetesCostAllocationService", () => {
  return {
    __esModule: true,
    default: {
      existsBy: jest.fn(),
      // #9969: what a window holds, and the rows a correction writes.
      findWindowSlices: jest.fn(),
      insertJsonRows: jest.fn(),
    },
  };
});

// A correction is made under a lock per window (#9969).
jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/OpenTelemetryIngestService", () => {
  return {
    __esModule: true,
    default: {
      buildResourceMetadataForNonService: jest.fn(),
    },
  };
});

/*
 * The cost metrics (#9548) go to the metric store and the metric catalog,
 * both stood in for: the contract is which rows reach them, and when.
 */
jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: {
      insertJsonRows: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      indexMetricNameServiceNameMap: jest.fn(),
      getAttributeKeys: (attributes: Record<string, unknown>) => {
        return Object.keys(attributes);
      },
    },
  };
});

/*
 * The fan-in writer talks to ClickHouse; the contract under test is
 * "which rows were submitted for which service". pushObservedAck keeps
 * its real semantics (pre-observed, wrap-on-failure) so the
 * ack-after-flush failure path is honestly exercised.
 */
jest.mock("Common/Server/Utils/Telemetry/TelemetryFanInWriter", () => {
  return {
    __esModule: true,
    default: {
      submit: jest.fn(),
    },
    pushObservedAck: (
      pendingAcks: Array<Promise<void>>,
      flushed: Promise<void>,
      wrapError: (err: Error) => Error,
    ): void => {
      const ack: Promise<void> = flushed.catch((error: Error) => {
        throw wrapError(error);
      });
      ack.catch(() => {
        // Pre-observed; delivered for real at the job's await point.
      });
      pendingAcks.push(ack);
    },
  };
});

import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import KubernetesCostAllocationService from "Common/Server/Services/KubernetesCostAllocationService";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import { KubernetesCostStoredSlice } from "Common/Types/Kubernetes/KubernetesCostCorrection";
import OpenTelemetryIngestService from "Common/Server/Services/OpenTelemetryIngestService";
import MetricService from "Common/Server/Services/MetricService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import {
  AggregationTemporality,
  MetricPointType,
} from "Common/Models/AnalyticsModels/Metric";
import Dictionary from "Common/Types/Dictionary";
import logger from "Common/Server/Utils/Logger";
import {
  KubernetesCostMetric,
  KubernetesCostMetricSourceRow,
} from "Common/Types/Kubernetes/KubernetesCostMetrics";
import KubernetesCostIngestService, {
  KubernetesCostStorageFlushError,
} from "../../FeatureSet/Telemetry/Services/KubernetesCostIngestService";
import { KubernetesCostIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

type MockedFn = jest.Mock;

const findOrCreateMock: MockedFn =
  KubernetesClusterService.findOrCreateByClusterIdentifier as unknown as MockedFn;
const updateLastSeenMock: MockedFn =
  KubernetesClusterService.updateLastSeen as unknown as MockedFn;
const existsByMock: MockedFn =
  KubernetesCostAllocationService.existsBy as unknown as MockedFn;
const findWindowSlicesMock: MockedFn =
  KubernetesCostAllocationService.findWindowSlices as unknown as MockedFn;
const insertCorrectionMock: MockedFn =
  KubernetesCostAllocationService.insertJsonRows as unknown as MockedFn;
const lockMock: MockedFn = Semaphore.lock as unknown as MockedFn;
const releaseMock: MockedFn = Semaphore.release as unknown as MockedFn;
const buildMetadataMock: MockedFn =
  OpenTelemetryIngestService.buildResourceMetadataForNonService as unknown as MockedFn;
const submitMock: MockedFn = TelemetryFanInWriter.submit as unknown as MockedFn;
const insertMetricsMock: MockedFn =
  MetricService.insertJsonRows as unknown as MockedFn;
const indexCatalogMock: MockedFn =
  TelemetryUtil.indexMetricNameServiceNameMap as unknown as MockedFn;
const loggerErrorMock: MockedFn = logger.error as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();
const RETENTION_DAYS: number = 15;
/** The window makeAllocation() defaults to. */
const WINDOW: string = "2026-07-24T10:00:00Z";

function makeJobData(
  payload: Partial<KubernetesCostIngestPayload>,
): KubernetesCostIngestJobData {
  return {
    projectId: PROJECT_ID.toString(),
    costPayload: payload as unknown as JSONObject,
    ingestionTimestamp: OneUptimeDate.getCurrentDate(),
  };
}

function makeAllocation(
  overrides: Partial<KubernetesCostAllocationIngestRow> = {},
): KubernetesCostAllocationIngestRow {
  return {
    windowStart: "2026-07-24T10:00:00Z",
    windowEnd: "2026-07-24T11:00:00Z",
    namespace: "prod",
    controllerKind: "Deployment",
    controllerName: "api",
    podName: "api-abc",
    containerName: "api",
    nodeName: "node-1",
    providerId: "i-0123",
    labels: { team: "payments" },
    cpuCoreHours: 1.5,
    cpuCost: 0.05,
    ramCost: 0.02,
    totalCost: 0.07,
    cpuEfficiency: 0.4,
    ramEfficiency: 0.8,
    totalEfficiency: 0.5,
    ...overrides,
  };
}

function getSubmittedRows(callIndex: number = 0): Array<JSONObject> {
  return submitMock.mock.calls[callIndex]![1] as Array<JSONObject>;
}

/*
 * The dedup path issues real ClickHouse existence queries, so the mock stands
 * in for the table rather than for the answer: tests declare which rows are
 * already stored and the query is evaluated against them. That keeps the
 * NotEqual / equality query shapes under test instead of hard-coding a
 * boolean per call and asserting on call counts.
 */
type StoredRow = {
  windowStart: string;
  shipmentId: string;
  shipmentChunk: number;
};

let stored: Array<StoredRow> = [];

function matchesStoredRow(row: StoredRow, query: JSONObject): boolean {
  const queriedWindow: Date = query["windowStart"] as Date;
  if (
    OneUptimeDate.fromString(row.windowStart).getTime() !==
    queriedWindow.getTime()
  ) {
    return false;
  }

  const shipmentId: unknown = query["shipmentId"];
  if (shipmentId instanceof NotEqual) {
    if (row.shipmentId === shipmentId.value) {
      return false;
    }
  } else if (shipmentId !== undefined && row.shipmentId !== shipmentId) {
    return false;
  }

  const shipmentChunk: unknown = query["shipmentChunk"];
  if (shipmentChunk !== undefined && row.shipmentChunk !== shipmentChunk) {
    return false;
  }

  return true;
}

describe("KubernetesCostIngestService.processFromQueue", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    findOrCreateMock.mockResolvedValue({
      id: CLUSTER_ID,
      clusterIdentifier: "prod-cluster",
    } as never);
    updateLastSeenMock.mockResolvedValue(undefined as never);
    stored = [];
    existsByMock.mockImplementation(((existsBy: {
      query: JSONObject;
    }): Promise<boolean> => {
      return Promise.resolve(
        stored.some((row: StoredRow): boolean => {
          return matchesStoredRow(row, existsBy.query);
        }),
      );
    }) as never);
    buildMetadataMock.mockResolvedValue({
      dataRententionInDays: RETENTION_DAYS,
    } as never);
    submitMock.mockResolvedValue({ flushed: Promise.resolve() } as never);
    insertMetricsMock.mockResolvedValue(undefined as never);
    indexCatalogMock.mockResolvedValue(undefined as never);
    KubernetesCostIngestService.resetCatalogRegistrationsForTests();
  });

  test("drops a payload without clusterName before any cluster work", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({ allocations: [makeAllocation()] }),
    );

    expect(findOrCreateMock).not.toHaveBeenCalled();
    expect(submitMock).not.toHaveBeenCalled();
  });

  test("drops a payload whose allocations is not an array", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations:
          "nope" as unknown as Array<KubernetesCostAllocationIngestRow>,
      }),
    );

    expect(findOrCreateMock).not.toHaveBeenCalled();
    expect(submitMock).not.toHaveBeenCalled();
  });

  test("resolves the cluster, refreshes last-seen, and resolves retention for it", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "  prod-cluster  ",
        allocations: [makeAllocation()],
      }),
    );

    expect(findOrCreateMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      clusterIdentifier: "prod-cluster",
    });
    expect(updateLastSeenMock).toHaveBeenCalledWith(CLUSTER_ID);
    expect(buildMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: CLUSTER_ID,
        primaryEntityType: ServiceType.KubernetesCluster,
        projectId: PROJECT_ID,
      }),
    );
  });

  test("throws when the cluster cannot be resolved", async () => {
    findOrCreateMock.mockResolvedValue({
      clusterIdentifier: "prod-cluster",
    } as never);

    await expect(
      KubernetesCostIngestService.processFromQueue(
        makeJobData({
          clusterName: "prod-cluster",
          allocations: [makeAllocation()],
        }),
      ),
    ).rejects.toThrow(/could not resolve cluster/);
  });

  test("builds a fully-populated row and submits it for the cost allocation service", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        currency: "EUR",
        allocations: [makeAllocation()],
      }),
    );

    expect(submitMock).toHaveBeenCalledTimes(1);
    // Rows are submitted for the KubernetesCostAllocation table's service.
    expect(submitMock.mock.calls[0]![0]).toBe(KubernetesCostAllocationService);

    const rows: Array<JSONObject> = getSubmittedRows();
    expect(rows).toHaveLength(1);
    const row: JSONObject = rows[0]!;

    const windowStart: Date = OneUptimeDate.fromString("2026-07-24T10:00:00Z");
    const windowEnd: Date = OneUptimeDate.fromString("2026-07-24T11:00:00Z");

    expect(row["_id"]).toBeTruthy();
    expect(row["projectId"]).toBe(PROJECT_ID.toString());
    expect(row["kubernetesClusterId"]).toBe(CLUSTER_ID.toString());
    expect(row["clusterName"]).toBe("prod-cluster");
    expect(row["k8sClusterEntityKey"]).toBe(
      keyForKubernetesCluster(PROJECT_ID.toString(), "prod-cluster"),
    );
    expect(row["windowStart"]).toBe(
      OneUptimeDate.toClickhouseDateTime(windowStart),
    );
    expect(row["windowEnd"]).toBe(
      OneUptimeDate.toClickhouseDateTime(windowEnd),
    );
    expect(row["namespace"]).toBe("prod");
    // controllerKind is normalized to lowercase.
    expect(row["controllerKind"]).toBe("deployment");
    expect(row["controllerName"]).toBe("api");
    expect(row["podName"]).toBe("api-abc");
    expect(row["containerName"]).toBe("api");
    expect(row["nodeName"]).toBe("node-1");
    expect(row["providerId"]).toBe("i-0123");
    expect(row["labels"]).toEqual({ team: "payments" });
    expect(row["labelKeys"]).toEqual(["team"]);
    expect(row["cpuCoreHours"]).toBe(1.5);
    expect(row["cpuCost"]).toBe(0.05);
    expect(row["ramCost"]).toBe(0.02);
    expect(row["totalCost"]).toBe(0.07);
    expect(row["cpuEfficiency"]).toBe(0.4);
    expect(row["currency"]).toBe("EUR");
    expect(row["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDays(windowStart, RETENTION_DAYS),
      ),
    );
  });

  /*
   * #9635: every page shows efficiency as sum(weightedEfficiency) /
   * sum(efficiencyWeight), so ingest stores both on every row, worked out as
   * Common's KubernetesCostEfficiency works them out.
   */
  test("stores what each row counts for in a cost-weighted efficiency", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [
          makeAllocation({
            cpuCost: 0.05,
            ramCost: 0.02,
            totalEfficiency: 0.5,
          }),
          makeAllocation({
            podName: "api-def",
            cpuCost: 0.3,
            ramCost: 0.1,
            pvCost: 5,
            totalCost: 5.4,
            totalEfficiency: 1.25,
          }),
        ],
      }),
    );

    const rows: Array<JSONObject> = getSubmittedRows();

    // The weight is what the CPU and memory cost, never the storage.
    expect(rows[0]!["efficiencyWeight"]).toBeCloseTo(0.07, 12);
    expect(rows[0]!["weightedEfficiency"]).toBeCloseTo(0.035, 12);
    expect(rows[1]!["efficiencyWeight"]).toBeCloseTo(0.4, 12);
    // Above 100% stays above 100%.
    expect(rows[1]!["weightedEfficiency"]).toBeCloseTo(0.5, 12);
  });

  test("gives idle and unallocated capacity no weight in any efficiency", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [
          makeAllocation({
            namespace: "__idle__",
            controllerKind: "",
            controllerName: "",
            podName: "",
            containerName: "",
            cpuCost: 4,
            ramCost: 2,
            totalEfficiency: 0,
          }),
          makeAllocation({
            namespace: "__unallocated__",
            cpuCost: 1,
            ramCost: 1,
            totalEfficiency: 0.3,
          }),
        ],
      }),
    );

    for (const row of getSubmittedRows()) {
      expect(row["efficiencyWeight"]).toBe(0);
      expect(row["weightedEfficiency"]).toBe(0);
    }
  });

  test("weighs a row by its costs as stored: a negative or non-finite cost counts as nothing", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [
          makeAllocation({
            cpuCost: -0.5,
            ramCost: Number.NaN,
            totalEfficiency: 0.9,
          }),
          makeAllocation({
            podName: "api-xyz",
            cpuCost: 0.2,
            ramCost: 0.2,
            totalEfficiency: Number.POSITIVE_INFINITY,
          }),
        ],
      }),
    );

    const rows: Array<JSONObject> = getSubmittedRows();

    expect(rows[0]!["efficiencyWeight"]).toBe(0);
    expect(rows[0]!["weightedEfficiency"]).toBe(0);
    // An efficiency ingest could not read is stored as 0: used nothing.
    expect(rows[1]!["totalEfficiency"]).toBe(0);
    expect(rows[1]!["efficiencyWeight"]).toBeCloseTo(0.4, 12);
    expect(rows[1]!["weightedEfficiency"]).toBe(0);
  });

  /*
   * #9633 / #9634: which engine priced a shipment and where its prices come
   * from, stamped on every row so each hour says how it was priced.
   */
  test("stamps every row with the engine that priced it and where its prices come from", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        costEngine: {
          engine: "Kubecost",
          service: "kubecost/kubecost-cost-analyzer",
          bundledEngineUnused: true,
          pricingSource: KubernetesCostPricingSource.ListPrices,
          pricingProvider: "AWS",
          memoryPeaksFrom: KubernetesCostMemoryPeaksSource.Bundled,
        },
        allocations: [
          makeAllocation(),
          makeAllocation({ namespace: "__idle__", podName: "" }),
        ],
      }),
    );

    for (const row of getSubmittedRows()) {
      expect(row["costEngine"]).toBe("Kubecost");
      expect(row["costEngineService"]).toBe("kubecost/kubecost-cost-analyzer");
      expect(row["bundledEngineUnused"]).toBe(true);
      expect(row["pricingSource"]).toBe("list-prices");
      expect(row["pricingProvider"]).toBe("AWS");
      // #9970: where its memory peak came from.
      expect(row["memoryPeaksFrom"]).toBe("bundled");
      // A first reading of its window, not a correction (#9969).
      expect(row["isCostAdjustment"]).toBe(false);
    }
  });

  test("an agent that says nothing of its engine leaves the columns empty", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [makeAllocation()],
      }),
    );

    const row: JSONObject = getSubmittedRows()[0]!;

    expect(row["costEngine"]).toBe("");
    expect(row["costEngineService"]).toBe("");
    expect(row["bundledEngineUnused"]).toBe(false);
    expect(row["pricingSource"]).toBe("");
    expect(row["pricingProvider"]).toBe("");
    expect(row["memoryPeaksFrom"]).toBe("");
    expect(row["isCostAdjustment"]).toBe(false);
  });

  test("an agent older than #9970 says nothing of its memory peaks: none named", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        costEngine: {
          engine: "Kubecost",
          service: "kubecost/kubecost-frontend",
          bundledEngineUnused: true,
          pricingSource: "default-rates",
          pricingProvider: "",
        } as unknown as KubernetesCostIngestPayload["costEngine"],
        allocations: [makeAllocation()],
      }),
    );

    const row: JSONObject = getSubmittedRows()[0]!;

    expect(row["bundledEngineUnused"]).toBe(true);
    expect(row["memoryPeaksFrom"]).toBe("");
  });

  test("keeps only what an agent could have said of its engine", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        // What a broken or hostile agent could send: none of it is stored.
        costEngine: {
          engine: "SomethingElse",
          service: "not a service",
          bundledEngineUnused: "yes",
          pricingSource: "free",
          pricingProvider: "AWS",
          memoryPeaksFrom: "thanos",
        } as unknown as KubernetesCostIngestPayload["costEngine"],
        allocations: [makeAllocation()],
      }),
    );

    const row: JSONObject = getSubmittedRows()[0]!;

    expect(row["costEngine"]).toBe("");
    expect(row["costEngineService"]).toBe("");
    expect(row["bundledEngineUnused"]).toBe(false);
    // A source the server does not know is unknown, and names no cloud.
    expect(row["pricingSource"]).toBe("unknown");
    expect(row["pricingProvider"]).toBe("");
    expect(row["memoryPeaksFrom"]).toBe("");
  });

  test("sanitizes numbers: non-finite and non-numeric become 0, numeric strings parse", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [
          makeAllocation({
            cpuCost: Number.NaN,
            ramCost: Number.POSITIVE_INFINITY,
            pvCost: "not-a-number" as unknown as number,
            networkCost: "0.25" as unknown as number,
            totalCost: undefined,
          }),
        ],
      }),
    );

    const row: JSONObject = getSubmittedRows()[0]!;
    expect(row["cpuCost"]).toBe(0);
    expect(row["ramCost"]).toBe(0);
    expect(row["pvCost"]).toBe(0);
    expect(row["networkCost"]).toBe(0.25);
    expect(row["totalCost"]).toBe(0);
  });

  test("caps strings at 512 chars and labels at 100 entries, stringifying values", async () => {
    const longName: string = "n".repeat(600);
    const manyLabels: Record<string, string> = {};
    for (let i: number = 0; i < 150; i++) {
      manyLabels[`label-${i}`] = `value-${i}`;
    }

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [
          makeAllocation({
            namespace: longName,
            labels: {
              ...manyLabels,
              numeric: 42 as unknown as string,
            },
          }),
        ],
      }),
    );

    const row: JSONObject = getSubmittedRows()[0]!;
    expect((row["namespace"] as string).length).toBe(512);

    const labels: Record<string, string> = row["labels"] as Record<
      string,
      string
    >;
    expect(Object.keys(labels).length).toBeLessThanOrEqual(100);
    expect(row["labelKeys"]).toEqual(Object.keys(labels));
  });

  test("stringifies non-string label values", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [
          makeAllocation({
            labels: { replicas: 3 as unknown as string },
          }),
        ],
      }),
    );

    const row: JSONObject = getSubmittedRows()[0]!;
    expect(row["labels"]).toEqual({ replicas: "3" });
  });

  test("drops rows without a parseable window", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [
          makeAllocation({ windowStart: "" }),
          makeAllocation({ windowStart: "not-a-date" }),
          makeAllocation({ windowEnd: undefined as unknown as string }),
          makeAllocation(),
        ],
      }),
    );

    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(getSubmittedRows()).toHaveLength(1);
  });

  test("does not submit at all when every row is invalid", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [makeAllocation({ windowStart: "not-a-date" })],
      }),
    );

    expect(submitMock).not.toHaveBeenCalled();
  });

  test("stamps the shipment identity on every row", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        shipmentId: "abc123",
        shipmentChunk: 2,
        allocations: [makeAllocation()],
      }),
    );

    const row: JSONObject = getSubmittedRows()[0]!;
    expect(row["shipmentId"]).toBe("abc123");
    expect(row["shipmentChunk"]).toBe(2);
  });

  test("defaults the shipment identity to empty for agents that send none", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [makeAllocation()],
      }),
    );

    const row: JSONObject = getSubmittedRows()[0]!;
    expect(row["shipmentId"]).toBe("");
    expect(row["shipmentChunk"]).toBe(0);
  });

  /*
   * The bug this contract exists for: a window wider than the agent's batch
   * size arrives as several requests, each its own job. Before shipment ids,
   * chunk 2 saw chunk 1's rows and dropped itself, so a cluster with more
   * containers than SHIP_BATCH_SIZE stored only the first slice of each hour.
   */
  test("accepts a later chunk of the shipment already being ingested", async () => {
    stored = [
      { windowStart: WINDOW, shipmentId: "shipment-a", shipmentChunk: 0 },
    ];

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        shipmentId: "shipment-a",
        shipmentChunk: 1,
        allocations: [makeAllocation({ namespace: "chunk-1" })],
      }),
    );

    const rows: Array<JSONObject> = getSubmittedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!["namespace"]).toBe("chunk-1");
  });

  /*
   * Restart idempotency: the poller's checkpoint is in-memory, so it re-ships
   * its lookback windows. Those hash to a different shipment only when the
   * window's contents changed — either way, re-inserting would double-count.
   */
  test("drops a window a different shipment already ingested", async () => {
    stored = [
      { windowStart: WINDOW, shipmentId: "shipment-a", shipmentChunk: 0 },
    ];

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        shipmentId: "shipment-b",
        shipmentChunk: 0,
        allocations: [makeAllocation()],
      }),
    );

    expect(submitMock).not.toHaveBeenCalled();
  });

  // The agent re-sending a chunk that already landed must not duplicate it.
  test("drops a chunk of the current shipment that already landed", async () => {
    stored = [
      { windowStart: WINDOW, shipmentId: "shipment-a", shipmentChunk: 3 },
    ];

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        shipmentId: "shipment-a",
        shipmentChunk: 3,
        allocations: [makeAllocation()],
      }),
    );

    expect(submitMock).not.toHaveBeenCalled();
  });

  test("falls back to the whole-window guard when the agent sends no shipment id", async () => {
    stored = [{ windowStart: WINDOW, shipmentId: "", shipmentChunk: 0 }];

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [makeAllocation()],
      }),
    );

    expect(submitMock).not.toHaveBeenCalled();
  });

  test("skips only the already-ingested window and keeps the others", async () => {
    const newWindow: string = "2026-07-24T11:00:00Z";

    stored = [
      { windowStart: WINDOW, shipmentId: "shipment-a", shipmentChunk: 0 },
    ];

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        shipmentId: "shipment-b",
        shipmentChunk: 0,
        allocations: [
          makeAllocation({ windowStart: WINDOW, namespace: "old-a" }),
          makeAllocation({ windowStart: WINDOW, namespace: "old-b" }),
          makeAllocation({
            windowStart: newWindow,
            windowEnd: "2026-07-24T12:00:00Z",
            namespace: "new-a",
          }),
        ],
      }),
    );

    const rows: Array<JSONObject> = getSubmittedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!["namespace"]).toBe("new-a");
  });

  test("chunks large payloads into multiple fan-in submissions", async () => {
    const allocations: Array<KubernetesCostAllocationIngestRow> = [];
    for (let i: number = 0; i < 501; i++) {
      allocations.push(makeAllocation({ namespace: `ns-${i}` }));
    }

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({ clusterName: "prod-cluster", allocations }),
    );

    expect(submitMock).toHaveBeenCalledTimes(2);
    expect(getSubmittedRows(0)).toHaveLength(500);
    expect(getSubmittedRows(1)).toHaveLength(1);
  });

  test("a failed flush fails the job with a KubernetesCostStorageFlushError", async () => {
    submitMock.mockResolvedValue({
      flushed: Promise.reject(new Error("clickhouse down")),
    } as never);

    await expect(
      KubernetesCostIngestService.processFromQueue(
        makeJobData({
          clusterName: "prod-cluster",
          allocations: [makeAllocation()],
        }),
      ),
    ).rejects.toThrow(KubernetesCostStorageFlushError);
  });

  test("sanitizes a non-string currency to empty", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        currency: 42 as unknown as string,
        allocations: [makeAllocation()],
      }),
    );

    const row: JSONObject = getSubmittedRows()[0]!;
    expect(row["currency"]).toBe("");
  });

  /*
   * Issue #8220: a workload's labels are named as Kubernetes allows, and the
   * row's map was written with an assignment, which drops a label named
   * __proto__ (it still counted towards the cap). Written as the map's own
   * key, every name is a label like any other, in the row and in labelKeys.
   * The labels are built with JSON.parse, as the queued job hands them over.
   */
  test.each(INHERITED_PROPERTY_NAMES)(
    "a label named %s is one of the row's labels and in its labelKeys",
    async (name: string) => {
      await KubernetesCostIngestService.processFromQueue(
        makeJobData({
          clusterName: "prod-cluster",
          allocations: [
            makeAllocation({
              labels: JSON.parse(
                `{"team":"payments",${JSON.stringify(name)}:"own ${name}","replicas":3}`,
              ) as Record<string, string>,
            }),
          ],
        }),
      );

      const row: JSONObject = getSubmittedRows()[0]!;
      const labels: Record<string, string> = row["labels"] as Record<
        string,
        string
      >;

      expect(Object.getPrototypeOf(labels)).toBe(Object.prototype);
      expect(Object.keys(labels)).toEqual(["team", name, "replicas"]);
      expect(readOwnValue(labels, name)).toBe(`own ${name}`);
      expect(readOwnValue(labels, "replicas")).toBe("3");
      expect(row["labelKeys"]).toEqual(["team", name, "replicas"]);
      expect(
        readOwnValue(
          (JSON.parse(JSON.stringify(row)) as JSONObject)[
            "labels"
          ] as JSONObject,
          name,
        ),
      ).toBe(`own ${name}`);
    },
  );

  test("an object under a label named __proto__ is its text, and never the map's prototype", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [
          makeAllocation({
            labels: JSON.parse(
              '{"__proto__":{"polluted":"yes"},"team":"payments"}',
            ) as Record<string, string>,
          }),
        ],
      }),
    );

    const labels: Record<string, string> = getSubmittedRows()[0]![
      "labels"
    ] as Record<string, string>;

    expect(Object.getPrototypeOf(labels)).toBe(Object.prototype);
    expect(Object.keys(labels)).toEqual(["__proto__", "team"]);
    expect(readOwnValue(labels, "__proto__")).toBe("[object Object]");
    expect(labels["polluted"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  test("a label named __proto__ counts towards the cap and is kept within it", async () => {
    const labels: Record<string, string> = JSON.parse(
      '{"__proto__":"first"}',
    ) as Record<string, string>;

    for (let i: number = 0; i < 150; i++) {
      labels[`label-${i}`] = `value-${i}`;
    }

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [makeAllocation({ labels })],
      }),
    );

    const row: JSONObject = getSubmittedRows()[0]!;
    const stored: Record<string, string> = row["labels"] as Record<
      string,
      string
    >;

    expect(Object.keys(stored)).toHaveLength(100);
    expect(readOwnValue(stored, "__proto__")).toBe("first");
    expect(row["labelKeys"]).toEqual(Object.keys(stored));
  });
});

/*
 * The cost metrics the ingest writes from the rows it stores (#9548): cost
 * per cluster, idle, per workload and efficiency, so cost can be charted on
 * the Metrics page and alerted on in a monitor.
 */
describe("KubernetesCostIngestService cost metrics", () => {
  function metricRows(callIndex: number = 0): Array<JSONObject> {
    return insertMetricsMock.mock.calls[callIndex]![0] as Array<JSONObject>;
  }

  function metricRowsNamed(name: string): Array<JSONObject> {
    return metricRows().filter((row: JSONObject): boolean => {
      return row["name"] === name;
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();

    findOrCreateMock.mockResolvedValue({
      id: CLUSTER_ID,
      clusterIdentifier: "prod-cluster",
    } as never);
    updateLastSeenMock.mockResolvedValue(undefined as never);
    stored = [];
    existsByMock.mockImplementation(((existsBy: {
      query: JSONObject;
    }): Promise<boolean> => {
      return Promise.resolve(
        stored.some((row: StoredRow): boolean => {
          return matchesStoredRow(row, existsBy.query);
        }),
      );
    }) as never);
    buildMetadataMock.mockResolvedValue({
      dataRententionInDays: RETENTION_DAYS,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 30,
    } as never);
    submitMock.mockResolvedValue({ flushed: Promise.resolve() } as never);
    insertMetricsMock.mockResolvedValue(undefined as never);
    indexCatalogMock.mockResolvedValue(undefined as never);
    KubernetesCostIngestService.resetCatalogRegistrationsForTests();
  });

  test("writes the cluster's total and idle cost, and each workload's cost and efficiency", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [
          makeAllocation({ podName: "api-a", totalCost: 2 }),
          makeAllocation({ podName: "api-b", totalCost: 1 }),
          makeAllocation({
            namespace: "",
            controllerKind: "",
            controllerName: "",
            podName: "",
            containerName: "",
            totalCost: 4,
          }),
          makeAllocation({
            namespace: "__idle__",
            controllerKind: "",
            controllerName: "",
            podName: "",
            totalCost: 5,
          }),
        ],
      }),
    );

    expect(insertMetricsMock).toHaveBeenCalledTimes(1);

    const total: Array<JSONObject> = metricRowsNamed(
      KubernetesCostMetric.Total,
    );
    expect(total).toHaveLength(1);
    expect(total[0]!["value"]).toBe(12);

    const idle: Array<JSONObject> = metricRowsNamed(KubernetesCostMetric.Idle);
    expect(idle).toHaveLength(1);
    expect(idle[0]!["value"]).toBe(5);

    const workload: Array<JSONObject> = metricRowsNamed(
      KubernetesCostMetric.Workload,
    );
    expect(workload).toHaveLength(1);
    expect(workload[0]!["value"]).toBe(3);
    expect(workload[0]!["attributes"]).toEqual({
      "resource.k8s.cluster.name": "prod-cluster",
      "resource.k8s.namespace.name": "prod",
      "resource.k8s.deployment.name": "api",
    });

    expect(metricRowsNamed(KubernetesCostMetric.Efficiency)).toHaveLength(1);
  });

  test("writes a cost as a Delta Sum and efficiency as a Gauge, at the window's start, under the cluster", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [makeAllocation()],
      }),
    );

    const windowStart: Date = OneUptimeDate.fromString(WINDOW);
    const time: string = OneUptimeDate.toClickhouseDateTime(windowStart);
    const entityKey: string = keyForKubernetesCluster(
      PROJECT_ID.toString(),
      "prod-cluster",
    );

    const workload: JSONObject = metricRowsNamed(
      KubernetesCostMetric.Workload,
    )[0]!;

    expect(workload).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID.toString(),
        primaryEntityId: CLUSTER_ID.toString(),
        primaryEntityType: ServiceType.KubernetesCluster,
        entityKeys: [entityKey],
        k8sClusterEntityKey: entityKey,
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: AggregationTemporality.Delta,
        isMonotonic: false,
        time: time,
        startTime: time,
        timeUnixNano: OneUptimeDate.toUnixNano(windowStart).toString(),
        attributeKeys: [
          "resource.k8s.cluster.name",
          "resource.k8s.namespace.name",
          "resource.k8s.deployment.name",
        ],
        value: 0.07,
      }),
    );

    const efficiency: JSONObject = metricRowsNamed(
      KubernetesCostMetric.Efficiency,
    )[0]!;

    expect(efficiency["metricPointType"]).toBe(MetricPointType.Gauge);
    expect(efficiency["aggregationTemporality"]).toBeNull();
    // In percent, as the Costs pages show it.
    expect(efficiency["value"]).toBe(50);
    expect(efficiency["time"]).toBe(time);
  });

  test("keeps the metrics as long as the cluster's other metrics", async () => {
    buildMetadataMock.mockResolvedValue({
      dataRententionInDays: RETENTION_DAYS,
      serviceRetentionConfig: null,
      serviceRetentionInDays: 45,
      projectRetentionConfig: null,
      projectRetentionInDays: 30,
    } as never);

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [makeAllocation()],
      }),
    );

    const windowStart: Date = OneUptimeDate.fromString(WINDOW);

    expect(metricRows()[0]!["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDurationInDays(windowStart, 45),
      ),
    );
  });

  test("writes the metrics only once the allocation rows have landed", async () => {
    const order: Array<string> = [];

    submitMock.mockImplementation((() => {
      order.push("rows submitted");
      return Promise.resolve({
        flushed: Promise.resolve().then(() => {
          order.push("rows landed");
        }),
      });
    }) as never);
    insertMetricsMock.mockImplementation((() => {
      order.push("metrics written");
      return Promise.resolve();
    }) as never);

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [makeAllocation()],
      }),
    );

    expect(order).toEqual(["rows submitted", "rows landed", "metrics written"]);
  });

  test("writes no metric when the rows failed to land, and fails the job as before", async () => {
    submitMock.mockResolvedValue({
      flushed: Promise.reject(new Error("clickhouse down")),
    } as never);

    await expect(
      KubernetesCostIngestService.processFromQueue(
        makeJobData({
          clusterName: "prod-cluster",
          allocations: [makeAllocation()],
        }),
      ),
    ).rejects.toThrow(KubernetesCostStorageFlushError);

    expect(insertMetricsMock).not.toHaveBeenCalled();
  });

  test("a failed metric write never fails the job: a retry would skip the stored rows anyway", async () => {
    insertMetricsMock.mockRejectedValue(
      new Error("metric store down") as never,
    );

    await expect(
      KubernetesCostIngestService.processFromQueue(
        makeJobData({
          clusterName: "prod-cluster",
          allocations: [makeAllocation()],
        }),
      ),
    ).resolves.toBeUndefined();

    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("could not write the cost metrics"),
    );
    // Nothing registered for metrics that were never written.
    expect(indexCatalogMock).not.toHaveBeenCalled();
  });

  test("writes no metric for a window another shipment already delivered", async () => {
    stored = [{ windowStart: WINDOW, shipmentId: "earlier", shipmentChunk: 0 }];

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        shipmentId: "now",
        shipmentChunk: 0,
        allocations: [makeAllocation()],
      }),
    );

    expect(submitMock).not.toHaveBeenCalled();
    expect(insertMetricsMock).not.toHaveBeenCalled();
  });

  test("writes metrics for the windows it stores and none for the one it skips", async () => {
    stored = [{ windowStart: WINDOW, shipmentId: "earlier", shipmentChunk: 0 }];

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        shipmentId: "now",
        shipmentChunk: 0,
        allocations: [
          makeAllocation({ totalCost: 9 }),
          makeAllocation({
            windowStart: "2026-07-24T11:00:00Z",
            windowEnd: "2026-07-24T12:00:00Z",
            totalCost: 3,
          }),
        ],
      }),
    );

    const total: Array<JSONObject> = metricRowsNamed(
      KubernetesCostMetric.Total,
    );

    expect(total).toHaveLength(1);
    expect(total[0]!["value"]).toBe(3);
    expect(total[0]!["time"]).toBe(
      OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.fromString("2026-07-24T11:00:00Z"),
      ),
    );
  });

  test("puts the four names in the project's metric catalog, in the payload's currency", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        currency: "EUR",
        allocations: [makeAllocation()],
      }),
    );

    expect(indexCatalogMock).toHaveBeenCalledTimes(1);

    const call: {
      projectId: ObjectID;
      metricNameServiceNameMap: Dictionary<MetricType>;
    } = indexCatalogMock.mock.calls[0]![0] as {
      projectId: ObjectID;
      metricNameServiceNameMap: Dictionary<MetricType>;
    };

    expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(Object.keys(call.metricNameServiceNameMap).sort()).toEqual(
      Object.values(KubernetesCostMetric).sort(),
    );

    const total: MetricType =
      call.metricNameServiceNameMap[KubernetesCostMetric.Total]!;
    expect(total.unit).toBe("EUR");
    expect(total.description).toContain("idle capacity included");
    expect(total.aggregationTemporality).toBe(AggregationTemporality.Delta);

    expect(
      call.metricNameServiceNameMap[KubernetesCostMetric.Efficiency]!.unit,
    ).toBe("%");
  });

  test("registers the catalog once a process for each project and currency", async () => {
    for (let i: number = 0; i < 3; i++) {
      await KubernetesCostIngestService.processFromQueue(
        makeJobData({
          clusterName: "prod-cluster",
          allocations: [makeAllocation()],
        }),
      );
    }

    expect(insertMetricsMock).toHaveBeenCalledTimes(3);
    expect(indexCatalogMock).toHaveBeenCalledTimes(1);

    const unit: string | undefined = (
      indexCatalogMock.mock.calls[0]![0] as {
        metricNameServiceNameMap: Dictionary<MetricType>;
      }
    ).metricNameServiceNameMap[KubernetesCostMetric.Total]!.unit;

    // No currency in the payload: the agent prices in USD.
    expect(unit).toBe("USD");
  });

  test("tries the catalog again on the next window when it could not register", async () => {
    indexCatalogMock.mockRejectedValueOnce(new Error("postgres down") as never);

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [makeAllocation()],
      }),
    );
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [makeAllocation()],
      }),
    );

    expect(indexCatalogMock).toHaveBeenCalledTimes(2);
  });

  test("stamps the metrics with the cluster's stored identifier, as its other metrics carry it", async () => {
    findOrCreateMock.mockResolvedValue({
      id: CLUSTER_ID,
      clusterIdentifier: "prod-cluster-canonical",
    } as never);

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [makeAllocation()],
      }),
    );

    for (const row of metricRows()) {
      expect(
        (row["attributes"] as Record<string, string>)[
          "resource.k8s.cluster.name"
        ],
      ).toBe("prod-cluster-canonical");
    }
  });
});

/*
 * #9969: a Kubecost that reads the cloud's bill reconciles each hour with it
 * about two days on, and the agent ships the hour's later reading as a
 * correction. Ingest writes the difference from what the window holds, per
 * workload, pod and container, as rows of their own: nothing is counted
 * twice, and a plain sum of the window is the reconciled figure.
 */
describe("KubernetesCostIngestService corrections", () => {
  const KUBECOST: KubernetesCostIngestPayload["costEngine"] = {
    engine: "Kubecost",
    service: "kubecost/kubecost-cost-analyzer",
    bundledEngineUnused: false,
    pricingSource: KubernetesCostPricingSource.BillingIntegration,
    pricingProvider: "AWS",
    memoryPeaksFrom: KubernetesCostMemoryPeaksSource.Engine,
  };

  // What the window holds for makeAllocation()'s container: its first reading.
  function slice(
    overrides: Partial<KubernetesCostStoredSlice> = {},
  ): KubernetesCostStoredSlice {
    return {
      namespace: "prod",
      controllerKind: "deployment",
      controllerName: "api",
      podName: "api-abc",
      containerName: "api",
      nodeName: "node-1",
      providerId: "i-0123",
      labels: { team: "payments" },
      costEngine: "Kubecost",
      costEngineService: "kubecost/kubecost-cost-analyzer",
      cpuCost: 0.05,
      gpuCost: 0,
      ramCost: 0.02,
      pvCost: 0,
      networkCost: 0,
      loadBalancerCost: 0,
      sharedCost: 0,
      externalCost: 0,
      totalCost: 0.07,
      // As ingest weighed the first reading: (0.05 + 0.02) at 0.5.
      efficiencyWeight: 0.07,
      weightedEfficiency: 0.035,
      ...overrides,
    };
  }

  function correction(
    allocations: Array<KubernetesCostAllocationIngestRow>,
    overrides: Partial<KubernetesCostIngestPayload> = {},
  ): KubernetesCostIngestJobData {
    return makeJobData({
      clusterName: "prod-cluster",
      costEngine: KUBECOST,
      shipmentId: "correction-1",
      shipmentChunk: 0,
      correction: true,
      allocations,
      ...overrides,
    });
  }

  function writtenRows(callIndex: number = 0): Array<JSONObject> {
    return insertCorrectionMock.mock.calls[callIndex]![0] as Array<JSONObject>;
  }

  function metricValue(name: string): Array<number> {
    return ((insertMetricsMock.mock.calls[0]?.[0] as Array<JSONObject>) || [])
      .filter((row: JSONObject): boolean => {
        return row["name"] === name;
      })
      .map((row: JSONObject): number => {
        return row["value"] as number;
      });
  }

  beforeEach(() => {
    jest.clearAllMocks();

    findOrCreateMock.mockResolvedValue({
      id: CLUSTER_ID,
      clusterIdentifier: "prod-cluster",
    } as never);
    updateLastSeenMock.mockResolvedValue(undefined as never);
    buildMetadataMock.mockResolvedValue({
      dataRententionInDays: RETENTION_DAYS,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 30,
    } as never);
    findWindowSlicesMock.mockResolvedValue([slice()] as never);
    insertCorrectionMock.mockResolvedValue(undefined as never);
    lockMock.mockResolvedValue({ id: "mutex" } as never);
    releaseMock.mockResolvedValue(undefined as never);
    submitMock.mockResolvedValue({ flushed: Promise.resolve() } as never);
    insertMetricsMock.mockResolvedValue(undefined as never);
    indexCatalogMock.mockResolvedValue(undefined as never);
    KubernetesCostIngestService.resetCatalogRegistrationsForTests();
  });

  test("writes the difference from what the window holds, as a row of its own", async () => {
    // Kubecost reconciled the hour: a savings plan took 40% off.
    await KubernetesCostIngestService.processFromQueue(
      correction([
        makeAllocation({ cpuCost: 0.03, ramCost: 0.012, totalCost: 0.042 }),
      ]),
    );

    expect(findWindowSlicesMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      windowStart: OneUptimeDate.fromString("2026-07-24T10:00:00Z"),
      windowEnd: OneUptimeDate.fromString("2026-07-24T11:00:00Z"),
    });

    const rows: Array<JSONObject> = writtenRows();
    expect(rows).toHaveLength(1);

    const row: JSONObject = rows[0]!;
    expect(row["isCostAdjustment"]).toBe(true);
    expect(row["cpuCost"]).toBeCloseTo(-0.02, 12);
    expect(row["ramCost"]).toBeCloseTo(-0.008, 12);
    expect(row["totalCost"]).toBeCloseTo(-0.028, 12);
    // Weighed by the reconciled costs: (0.03 + 0.012) at 0.5, less what was.
    expect(row["efficiencyWeight"]).toBeCloseTo(0.042 - 0.07, 12);
    expect(row["weightedEfficiency"]).toBeCloseTo(0.021 - 0.035, 12);
    // The same window, workload, pod and container.
    expect(row["windowStart"]).toBe("2026-07-24 10:00:00");
    expect(row["namespace"]).toBe("prod");
    expect(row["controllerKind"]).toBe("deployment");
    expect(row["controllerName"]).toBe("api");
    expect(row["podName"]).toBe("api-abc");
    expect(row["containerName"]).toBe("api");
    // It says who priced it, as the first reading does.
    expect(row["costEngine"]).toBe("Kubecost");
    expect(row["pricingSource"]).toBe("billing-integration");
    expect(row["shipmentId"]).toBe("correction-1");
    // Its retention is its window's, as every row's.
    expect(row["retentionDate"]).toBe("2026-08-08 10:00:00");
  });

  test("a correction row holds no usage, so no count or average sees it", async () => {
    await KubernetesCostIngestService.processFromQueue(
      correction([
        makeAllocation({
          cpuCost: 0.03,
          ramCost: 0.012,
          totalCost: 0.042,
          cpuCoreHours: 1.5,
          cpuCoreRequestAverage: 2,
          cpuCoreUsageAverage: 0.4,
          ramBytesRequestAverage: 1024,
          ramBytesUsageMax: 2048,
        }),
      ]),
    );

    const row: JSONObject = writtenRows()[0]!;

    for (const column of [
      "cpuCoreHours",
      "cpuCoreRequestAverage",
      "cpuCoreUsageAverage",
      "cpuCoreLimitAverage",
      "gpuHours",
      "ramByteHours",
      "ramBytesRequestAverage",
      "ramBytesUsageAverage",
      "ramBytesLimitAverage",
      "ramBytesUsageMax",
      "pvByteHours",
      "cpuEfficiency",
      "ramEfficiency",
      "totalEfficiency",
    ]) {
      expect([column, row[column]]).toEqual([column, 0]);
    }
  });

  test("a correction row keeps the labels and node the window holds, so it groups with them", async () => {
    findWindowSlicesMock.mockResolvedValue([
      slice({ labels: { team: "platform" }, nodeName: "node-7" }),
    ] as never);

    await KubernetesCostIngestService.processFromQueue(
      correction([makeAllocation({ totalCost: 0.5 })]),
    );

    const row: JSONObject = writtenRows()[0]!;
    expect(row["labels"]).toEqual({ team: "platform" });
    expect(row["labelKeys"]).toEqual(["team"]);
    expect(row["nodeName"]).toBe("node-7");
  });

  test("is written once flushed, under a lock per window, which is given back", async () => {
    await KubernetesCostIngestService.processFromQueue(
      correction([makeAllocation({ totalCost: 0.5 })]),
    );

    expect(insertCorrectionMock.mock.calls[0]![1]).toEqual({
      clickhouseSettings: { wait_for_async_insert: 1 },
    });
    expect(lockMock).toHaveBeenCalledTimes(1);
    expect(lockMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        namespace: "kubernetes-cost-correction",
        key: `${PROJECT_ID.toString()}-${CLUSTER_ID.toString()}-${OneUptimeDate.fromString("2026-07-24T10:00:00Z").getTime()}`,
      }),
    );
    expect(releaseMock).toHaveBeenCalledWith({ id: "mutex" });
    // Never through the first readings' path, which skips a window it has.
    expect(existsByMock).not.toHaveBeenCalled();
    expect(submitMock).not.toHaveBeenCalled();
  });

  test("a write that fails gives the lock back and fails the job, to be tried again", async () => {
    insertCorrectionMock.mockRejectedValue(
      new Error("ClickHouse down") as never,
    );

    await expect(
      KubernetesCostIngestService.processFromQueue(
        correction([makeAllocation({ totalCost: 0.5 })]),
      ),
    ).rejects.toThrow("ClickHouse down");

    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(insertMetricsMock).not.toHaveBeenCalled();
  });

  test("a reading that matches what the window holds writes nothing", async () => {
    await KubernetesCostIngestService.processFromQueue(
      correction([makeAllocation()]),
    );

    expect(insertCorrectionMock).not.toHaveBeenCalled();
    expect(insertMetricsMock).not.toHaveBeenCalled();
  });

  test("the same reading again, once its correction landed, changes nothing", async () => {
    // The first reading plus the correction it brought: the reading itself.
    findWindowSlicesMock.mockResolvedValue([
      slice({
        cpuCost: 0.03,
        ramCost: 0.012,
        totalCost: 0.042,
        efficiencyWeight: 0.042,
        weightedEfficiency: 0.021,
      }),
    ] as never);

    await KubernetesCostIngestService.processFromQueue(
      correction([
        makeAllocation({ cpuCost: 0.03, ramCost: 0.012, totalCost: 0.042 }),
      ]),
    );

    expect(insertCorrectionMock).not.toHaveBeenCalled();
  });

  test("a correction that went in twice is taken back by the next reading", async () => {
    // 0.07 shipped, then -0.028 written twice: the window reads 0.014.
    findWindowSlicesMock.mockResolvedValue([
      slice({ totalCost: 0.014, cpuCost: 0.01, ramCost: 0.004 }),
    ] as never);

    await KubernetesCostIngestService.processFromQueue(
      correction([
        makeAllocation({ cpuCost: 0.03, ramCost: 0.012, totalCost: 0.042 }),
      ]),
    );

    const row: JSONObject = writtenRows()[0]!;
    expect(row["totalCost"]).toBeCloseTo(0.028, 12);
    expect(row["cpuCost"]).toBeCloseTo(0.02, 12);
  });

  test("float noise is no correction", async () => {
    await KubernetesCostIngestService.processFromQueue(
      correction([makeAllocation({ totalCost: 0.07 + 1e-13 })]),
    );

    expect(insertCorrectionMock).not.toHaveBeenCalled();
  });

  test("a container the window does not have is written whole, usage and all", async () => {
    // The window holds another container: this one was collected late.
    findWindowSlicesMock.mockResolvedValue([
      slice({ podName: "api-def" }),
    ] as never);

    await KubernetesCostIngestService.processFromQueue(
      correction([makeAllocation({ cpuCoreHours: 1.5, totalCost: 0.07 })]),
    );

    const rows: Array<JSONObject> = writtenRows();
    expect(rows).toHaveLength(1);

    const row: JSONObject = rows[0]!;
    expect(row["podName"]).toBe("api-abc");
    expect(row["isCostAdjustment"]).toBe(false);
    expect(row["cpuCoreHours"]).toBe(1.5);
    expect(row["totalCost"]).toBe(0.07);
    expect(row["labels"]).toEqual({ team: "payments" });
  });

  test("a window that holds nothing is left alone: a correction never stands in for a first reading", async () => {
    // What a restarted agent's reading of an hour from before it ran finds.
    findWindowSlicesMock.mockResolvedValue([] as never);

    await KubernetesCostIngestService.processFromQueue(
      correction([makeAllocation({ cpuCoreHours: 1.5, totalCost: 0.07 })]),
    );

    expect(insertCorrectionMock).not.toHaveBeenCalled();
    expect(insertMetricsMock).not.toHaveBeenCalled();
    // Routine, so not a warning.
    expect(logger.warn as unknown as MockedFn).not.toHaveBeenCalled();
    expect(
      (logger.debug as unknown as MockedFn).mock.calls.some(
        (call: Array<unknown>): boolean => {
          return String(call[0]).includes(
            "the window holds nothing to correct",
          );
        },
      ),
    ).toBe(true);
    // And the lock is given back.
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  test("a container the window has and the reading lacks is left as it is", async () => {
    findWindowSlicesMock.mockResolvedValue([
      slice(),
      slice({ podName: "api-def", totalCost: 0.3 }),
    ] as never);

    await KubernetesCostIngestService.processFromQueue(
      correction([makeAllocation({ totalCost: 0.05 })]),
    );

    const rows: Array<JSONObject> = writtenRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!["podName"]).toBe("api-abc");
  });

  test("the idle row is corrected too, and weighs nothing in efficiency", async () => {
    findWindowSlicesMock.mockResolvedValue([
      slice({
        namespace: "__idle__",
        controllerKind: "",
        controllerName: "",
        podName: "",
        containerName: "",
        totalCost: 1,
        cpuCost: 0.6,
        ramCost: 0.4,
        efficiencyWeight: 0,
        weightedEfficiency: 0,
      }),
    ] as never);

    await KubernetesCostIngestService.processFromQueue(
      correction([
        makeAllocation({
          namespace: "__idle__",
          controllerKind: "",
          controllerName: "",
          podName: "",
          containerName: "",
          totalCost: 0.7,
          cpuCost: 0.42,
          ramCost: 0.28,
        }),
      ]),
    );

    const row: JSONObject = writtenRows()[0]!;
    expect(row["totalCost"]).toBeCloseTo(-0.3, 12);
    expect(row["efficiencyWeight"]).toBe(0);
    expect(row["weightedEfficiency"]).toBe(0);
    expect(metricValue("oneuptime.kubernetes.cost.idle")).toEqual([
      expect.closeTo(-0.3, 12),
    ]);
  });

  test("brings the cost metrics in line by the same differences, and leaves efficiency as it was", async () => {
    findWindowSlicesMock.mockResolvedValue([
      slice(),
      slice({ podName: "api-def", totalCost: 0.3 }),
    ] as never);

    await KubernetesCostIngestService.processFromQueue(
      correction([
        makeAllocation({ cpuCost: 0.03, ramCost: 0.012, totalCost: 0.042 }),
        makeAllocation({ podName: "api-def", totalCost: 0.3 }),
      ]),
    );

    // The cluster's total and the workload's cost move by the difference.
    expect(metricValue("oneuptime.kubernetes.cost.total")).toEqual([
      expect.closeTo(-0.028, 12),
    ]);
    expect(metricValue("oneuptime.kubernetes.cost.workload")).toEqual([
      expect.closeTo(-0.028, 12),
    ]);
    // Nothing changed for idle, and efficiency is a Gauge: none written.
    expect(metricValue("oneuptime.kubernetes.cost.idle")).toEqual([]);
    expect(metricValue("oneuptime.kubernetes.cost.efficiency")).toEqual([]);

    const point: JSONObject = (
      insertMetricsMock.mock.calls[0]![0] as Array<JSONObject>
    )[0]!;
    // At the window's start, as its first reading's points are.
    expect(point["time"]).toBe("2026-07-24 10:00:00");
    expect(point["aggregationTemporality"]).toBe(AggregationTemporality.Delta);
  });

  test("a window another engine priced is left alone", async () => {
    findWindowSlicesMock.mockResolvedValue([
      slice({ costEngine: "OpenCost", costEngineService: "" }),
    ] as never);

    await KubernetesCostIngestService.processFromQueue(
      correction([makeAllocation({ totalCost: 0.5 })]),
    );

    expect(insertCorrectionMock).not.toHaveBeenCalled();
    expect(insertMetricsMock).not.toHaveBeenCalled();
    expect(
      (logger.warn as unknown as MockedFn).mock.calls.some(
        (call: Array<unknown>): boolean => {
          return String(call[0]).includes(
            "the window was priced by OpenCost, the reading by Kubecost (kubecost/kubecost-cost-analyzer)",
          );
        },
      ),
    ).toBe(true);
  });

  test("a window an agent that named no engine priced is corrected", async () => {
    findWindowSlicesMock.mockResolvedValue([
      slice({ costEngine: "", costEngineService: "" }),
    ] as never);

    await KubernetesCostIngestService.processFromQueue(
      correction([makeAllocation({ totalCost: 0.5 })]),
    );

    expect(writtenRows()).toHaveLength(1);
  });

  test("a reading that does not say which engine priced it changes nothing", async () => {
    await KubernetesCostIngestService.processFromQueue(
      correction([makeAllocation({ totalCost: 0.5 })], {
        costEngine: undefined,
      }),
    );

    expect(insertCorrectionMock).not.toHaveBeenCalled();
  });

  test("a reading of several windows corrects each against what it holds, one lock each", async () => {
    findWindowSlicesMock.mockImplementation(((data: {
      windowStart: Date;
    }): Promise<Array<KubernetesCostStoredSlice>> => {
      return Promise.resolve(
        data.windowStart.getTime() ===
          OneUptimeDate.fromString("2026-07-24T10:00:00Z").getTime()
          ? [slice()]
          : [
              slice({
                totalCost: 0.2,
              }),
            ],
      );
    }) as never);

    await KubernetesCostIngestService.processFromQueue(
      correction([
        makeAllocation({ totalCost: 0.1 }),
        makeAllocation({
          windowStart: "2026-07-24T11:00:00Z",
          windowEnd: "2026-07-24T12:00:00Z",
          totalCost: 0.1,
        }),
      ]),
    );

    expect(findWindowSlicesMock).toHaveBeenCalledTimes(2);
    expect(lockMock).toHaveBeenCalledTimes(2);
    expect(releaseMock).toHaveBeenCalledTimes(2);
    expect(writtenRows(0)[0]!["totalCost"]).toBeCloseTo(0.03, 12);
    expect(writtenRows(1)[0]!["totalCost"]).toBeCloseTo(-0.1, 12);
  });

  test("a first reading never goes the corrections' way", async () => {
    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        costEngine: KUBECOST,
        shipmentId: "first",
        shipmentChunk: 0,
        allocations: [makeAllocation()],
      }),
    );

    expect(findWindowSlicesMock).not.toHaveBeenCalled();
    expect(lockMock).not.toHaveBeenCalled();
    expect(submitMock).toHaveBeenCalledTimes(1);
  });
});

describe("KubernetesCostIngestService.buildCorrection", () => {
  test("one row per container even when a reading names one twice", () => {
    const row: JSONObject = {
      namespace: "prod",
      controllerKind: "deployment",
      controllerName: "api",
      podName: "api-abc",
      containerName: "api",
      totalCost: 0.5,
    };
    const source: KubernetesCostMetricSourceRow = {
      windowStart: new Date("2026-07-24T10:00:00Z"),
      windowEnd: new Date("2026-07-24T11:00:00Z"),
      namespace: "prod",
      controllerKind: "deployment",
      controllerName: "api",
      podName: "api-abc",
      totalCost: 0.5,
      cpuCost: 0,
      ramCost: 0,
      totalEfficiency: 0,
    };

    const result: ReturnType<
      typeof KubernetesCostIngestService.buildCorrection
    > = KubernetesCostIngestService.buildCorrection({
      reading: [
        { row, metricSource: source },
        { row: { ...row, totalCost: 9 }, metricSource: source },
      ],
      // The window holds another container; this one is new to it.
      stored: [
        {
          namespace: "prod",
          controllerKind: "deployment",
          controllerName: "api",
          podName: "api-def",
          containerName: "api",
          nodeName: "",
          providerId: "",
          labels: {},
          costEngine: "Kubecost",
          costEngineService: "",
          cpuCost: 0,
          gpuCost: 0,
          ramCost: 0,
          pvCost: 0,
          networkCost: 0,
          loadBalancerCost: 0,
          sharedCost: 0,
          externalCost: 0,
          totalCost: 0.1,
          efficiencyWeight: 0,
          weightedEfficiency: 0,
        },
      ],
      costEngine: {
        engine: "Kubecost",
        service: "",
        bundledEngineUnused: false,
        pricingSource: KubernetesCostPricingSource.BillingIntegration,
        pricingProvider: "AWS",
        memoryPeaksFrom: KubernetesCostMemoryPeaksSource.None,
      },
    });

    expect(result.refused).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!["totalCost"]).toBe(0.5);
  });
});
