import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Contract under test — the /metrics/queue-size aggregation services that
 * feed the KEDA metrics-api scaler for the app and worker deployments.
 *
 * Both services must aggregate the BACKLOG (waiting + delayed) across the
 * four drained queues via Queue.getQueueBacklogSize — never the
 * active-inclusive Queue.getQueueSize. Counting active jobs made the scaler
 * treat telemetry jobs parked on the fan-in flush ack as demand, so every
 * new pod just parked more jobs and the fleet overscaled to
 * jobRate x ackLatency. These tests pin the aggregation to the
 * backlog-only source so the feedback loop cannot quietly come back.
 */

type JestMock = ReturnType<typeof jest.fn>;

const getQueueBacklogSizeMock: JestMock = jest.fn();
const getQueueSizeMock: JestMock = jest.fn();

jest.mock("Common/Server/Infrastructure/Queue", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Infrastructure/Queue",
  ) as Record<string, unknown>;
  return {
    __esModule: true,
    QueueName: actual["QueueName"],
    QueueJob: actual["QueueJob"],
    default: {
      getQueueBacklogSize: (queueName: unknown): unknown => {
        return getQueueBacklogSizeMock(queueName);
      },
      getQueueSize: (queueName: unknown): unknown => {
        return getQueueSizeMock(queueName);
      },
    },
  };
});

import { QueueName } from "Common/Server/Infrastructure/Queue";
import AppQueueService from "../../Services/Queue/AppQueueService";
import WorkerQueueService from "../../FeatureSet/Workers/Services/Queue/WorkerQueueService";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

const BACKLOG_BY_QUEUE: Record<string, number> = {
  [QueueName.Worker]: 5,
  [QueueName.Workflow]: 7,
  [QueueName.Telemetry]: 11,
  [QueueName.Runbook]: 2,
};

beforeEach(() => {
  getQueueBacklogSizeMock.mockReset();
  getQueueSizeMock.mockReset();
  getQueueBacklogSizeMock.mockImplementation(async (queueName: unknown) => {
    return BACKLOG_BY_QUEUE[queueName as string] ?? 0;
  });
});

describe("AppQueueService.getQueueBacklogSize", () => {
  test("sums the backlog of all four drained queues", async () => {
    await expect(AppQueueService.getQueueBacklogSize()).resolves.toBe(25);
  });

  test("reads every queue exactly once, via the backlog-only counter", async () => {
    await AppQueueService.getQueueBacklogSize();

    const queried: Array<unknown> = getQueueBacklogSizeMock.mock.calls.map(
      (call: Array<unknown>) => {
        return call[0];
      },
    );
    expect(queried.sort()).toEqual(
      [
        QueueName.Worker,
        QueueName.Workflow,
        QueueName.Telemetry,
        QueueName.Runbook,
      ].sort(),
    );

    // The active-inclusive counter must never back the scaling metric.
    expect(getQueueSizeMock).not.toHaveBeenCalled();
  });
});

describe("WorkerQueueService.getQueueBacklogSize", () => {
  test("sums the backlog of all four drained queues", async () => {
    await expect(WorkerQueueService.getQueueBacklogSize()).resolves.toBe(25);
  });

  test("never consults the active-inclusive queue size", async () => {
    await WorkerQueueService.getQueueBacklogSize();
    expect(getQueueSizeMock).not.toHaveBeenCalled();
    expect(getQueueBacklogSizeMock).toHaveBeenCalledTimes(4);
  });
});

describe("TelemetryQueueService.getQueueBacklogSize", () => {
  test("reports the Telemetry queue backlog only, never the active-inclusive size", async () => {
    await expect(TelemetryQueueService.getQueueBacklogSize()).resolves.toBe(11);

    expect(getQueueBacklogSizeMock).toHaveBeenCalledTimes(1);
    expect(getQueueBacklogSizeMock).toHaveBeenCalledWith(QueueName.Telemetry);
    expect(getQueueSizeMock).not.toHaveBeenCalled();
  });
});
