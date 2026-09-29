import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import Queue from "Common/Server/Infrastructure/Queue";

/*
 * The Queue module pulls in BullMQ / bull-board at import time, and the
 * contract under test is only "what job data is enqueued" — replace it
 * wholesale, mirroring TelemetryQueueService.test.ts.
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

jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: {
      storeBody: jest.fn(),
      readBody: jest.fn(),
      deleteBody: jest.fn(),
    },
  };
});

import TelemetryQueueService, {
  TelemetryIngestJobData,
  TelemetryType,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

type MockedFn = jest.Mock;

const addJobMock: MockedFn = Queue.addJob as unknown as MockedFn;

describe("TelemetryQueueService.addKubernetesCostIngestJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    addJobMock.mockResolvedValue(undefined as never);
  });

  test("enqueues on the Telemetry queue with the kubernetes-cost type and payload", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const costPayload: JSONObject = {
      clusterName: "prod-cluster",
      allocations: [{ windowStart: "2026-07-24T10:00:00Z" }],
    };

    await TelemetryQueueService.addKubernetesCostIngestJob({
      projectId,
      costPayload,
    });

    expect(addJobMock).toHaveBeenCalledTimes(1);

    const [queueName, jobId, jobName, jobData, options] = addJobMock.mock
      .calls[0] as [string, string, string, TelemetryIngestJobData, JSONObject];

    expect(queueName).toBe("Telemetry");
    expect(jobName).toBe("ProcessTelemetry");
    expect(jobId).toMatch(
      new RegExp(`^kubernetes-cost-${projectId.toString()}-`),
    );
    // Random job ids skip the duplicate-id existence check.
    expect(options["skipExistenceCheck"]).toBe(true);

    expect(jobData.type).toBe(TelemetryType.KubernetesCostIngest);
    expect(jobData.projectId).toBe(projectId.toString());
    expect(jobData.kubernetesCostIngest).toBeDefined();
    expect(jobData.kubernetesCostIngest!.projectId).toBe(projectId.toString());
    expect(jobData.kubernetesCostIngest!.costPayload).toEqual(costPayload);
    expect(jobData.kubernetesCostIngest!.ingestionTimestamp).toBeInstanceOf(
      Date,
    );
  });

  test("generates unique job ids across calls", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const costPayload: JSONObject = { clusterName: "c", allocations: [] };

    await TelemetryQueueService.addKubernetesCostIngestJob({
      projectId,
      costPayload,
    });
    await TelemetryQueueService.addKubernetesCostIngestJob({
      projectId,
      costPayload,
    });

    const firstId: string = addJobMock.mock.calls[0]![1] as string;
    const secondId: string = addJobMock.mock.calls[1]![1] as string;
    expect(firstId).not.toBe(secondId);
  });

  test("propagates enqueue failures", async () => {
    addJobMock.mockRejectedValue(new Error("redis down") as never);

    await expect(
      TelemetryQueueService.addKubernetesCostIngestJob({
        projectId: ObjectID.generate(),
        costPayload: { clusterName: "c", allocations: [] },
      }),
    ).rejects.toThrow("redis down");
  });
});
