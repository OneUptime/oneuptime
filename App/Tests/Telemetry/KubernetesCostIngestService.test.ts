import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import PositiveNumber from "Common/Types/PositiveNumber";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import { keyForKubernetesCluster } from "Common/Utils/Telemetry/EntityKey";
import {
  KubernetesCostAllocationIngestRow,
  KubernetesCostIngestPayload,
} from "Common/Types/Kubernetes/KubernetesCostIngest";

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
      countBy: jest.fn(),
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
import OpenTelemetryIngestService from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import KubernetesCostIngestService, {
  KubernetesCostStorageFlushError,
} from "../../FeatureSet/Telemetry/Services/KubernetesCostIngestService";
import { KubernetesCostIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

type MockedFn = jest.Mock;

const findOrCreateMock: MockedFn =
  KubernetesClusterService.findOrCreateByClusterIdentifier as unknown as MockedFn;
const updateLastSeenMock: MockedFn =
  KubernetesClusterService.updateLastSeen as unknown as MockedFn;
const countByMock: MockedFn =
  KubernetesCostAllocationService.countBy as unknown as MockedFn;
const buildMetadataMock: MockedFn =
  OpenTelemetryIngestService.buildResourceMetadataForNonService as unknown as MockedFn;
const submitMock: MockedFn = TelemetryFanInWriter.submit as unknown as MockedFn;

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();
const RETENTION_DAYS: number = 15;

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

describe("KubernetesCostIngestService.processFromQueue", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    findOrCreateMock.mockResolvedValue({
      id: CLUSTER_ID,
      clusterIdentifier: "prod-cluster",
    } as never);
    updateLastSeenMock.mockResolvedValue(undefined as never);
    countByMock.mockResolvedValue(new PositiveNumber(0) as never);
    buildMetadataMock.mockResolvedValue({
      dataRententionInDays: RETENTION_DAYS,
    } as never);
    submitMock.mockResolvedValue({ flushed: Promise.resolve() } as never);
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

  test("skips windows that already have rows and keeps new windows", async () => {
    const ingestedWindow: string = "2026-07-24T10:00:00Z";
    const newWindow: string = "2026-07-24T11:00:00Z";

    countByMock.mockImplementation(((countBy: {
      query: JSONObject;
    }): Promise<PositiveNumber> => {
      const queried: Date = countBy.query["windowStart"] as Date;
      const isIngested: boolean =
        queried.getTime() ===
        OneUptimeDate.fromString(ingestedWindow).getTime();
      return Promise.resolve(new PositiveNumber(isIngested ? 42 : 0));
    }) as never);

    await KubernetesCostIngestService.processFromQueue(
      makeJobData({
        clusterName: "prod-cluster",
        allocations: [
          makeAllocation({ windowStart: ingestedWindow, namespace: "old-a" }),
          makeAllocation({ windowStart: ingestedWindow, namespace: "old-b" }),
          makeAllocation({
            windowStart: newWindow,
            windowEnd: "2026-07-24T12:00:00Z",
            namespace: "new-a",
          }),
        ],
      }),
    );

    // One existence check per DISTINCT window, not per row.
    expect(countByMock).toHaveBeenCalledTimes(2);

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
});
