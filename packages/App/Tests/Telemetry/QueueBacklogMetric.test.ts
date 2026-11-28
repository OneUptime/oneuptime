import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Contract under test — the /metrics/queue-size aggregation services that
 * feed the KEDA metrics-api scaler for the app and worker deployments.
 *
 * Both services must aggregate the BACKLOG (waiting + delayed) across the
 * five drained queues via Queue.getQueueBacklogSize — never the
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
      getQueueBacklogSize: (queueName: unknown, options?: unknown): unknown => {
        return options === undefined
          ? getQueueBacklogSizeMock(queueName)
          : getQueueBacklogSizeMock(queueName, options);
      },
      getQueueSize: (queueName: unknown): unknown => {
        return getQueueSizeMock(queueName);
      },
    },
  };
});

import { QueueName } from "Common/Server/Infrastructure/Queue";
import TelemetryInsertBackpressure from "Common/Server/Utils/Telemetry/TelemetryInsertBackpressure";
import AppQueueService from "../../Services/Queue/AppQueueService";
import WorkerQueueService from "../../FeatureSet/Workers/Services/Queue/WorkerQueueService";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

const BACKLOG_BY_QUEUE: Record<string, number> = {
  [QueueName.Worker]: 5,
  [QueueName.Workflow]: 7,
  [QueueName.Telemetry]: 11,
  [QueueName.Runbook]: 2,
  [QueueName.AIInvestigation]: 3,
};

// The Telemetry queue's bulk telemetry: its prioritized set.
const TELEMETRY_BULK: number = 700_000;

beforeEach(() => {
  jest.restoreAllMocks();
  getQueueBacklogSizeMock.mockReset();
  getQueueSizeMock.mockReset();
  getQueueBacklogSizeMock.mockImplementation(
    async (queueName: unknown, options?: unknown) => {
      const withoutPrioritized: boolean =
        (options as { withoutPrioritized?: boolean } | undefined)
          ?.withoutPrioritized === true;

      return (
        (BACKLOG_BY_QUEUE[queueName as string] ?? 0) +
        (queueName === QueueName.Telemetry && !withoutPrioritized
          ? TELEMETRY_BULK
          : 0)
      );
    },
  );
  jest.spyOn(TelemetryInsertBackpressure, "isActive").mockResolvedValue(false);
});

describe("AppQueueService.getQueueBacklogSize", () => {
  test("sums the backlog of all five drained queues", async () => {
    await expect(AppQueueService.getQueueBacklogSize()).resolves.toBe(
      28 + TELEMETRY_BULK,
    );
  });

  /*
   * 2026-11-27: KEDA scaled the workers from 10 to 139 on the backlog of
   * metrics ClickHouse was refusing, each new worker adding inserts. While
   * a writer marks ClickHouse as pushing back, that backlog is left out.
   */
  test("leaves the bulk telemetry out while ClickHouse is pushing back, and counts the rest", async () => {
    jest.spyOn(TelemetryInsertBackpressure, "isActive").mockResolvedValue(true);

    await expect(AppQueueService.getQueueBacklogSize()).resolves.toBe(28);
    expect(getQueueBacklogSizeMock).toHaveBeenCalledWith(QueueName.Telemetry, {
      withoutPrioritized: true,
    });
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
        QueueName.AIInvestigation,
      ].sort(),
    );

    // The active-inclusive counter must never back the scaling metric.
    expect(getQueueSizeMock).not.toHaveBeenCalled();
  });
});

describe("WorkerQueueService.getQueueBacklogSize", () => {
  test("sums the backlog of all five drained queues", async () => {
    await expect(WorkerQueueService.getQueueBacklogSize()).resolves.toBe(
      28 + TELEMETRY_BULK,
    );
  });

  test("leaves the bulk telemetry out while ClickHouse is pushing back, and counts the rest", async () => {
    jest.spyOn(TelemetryInsertBackpressure, "isActive").mockResolvedValue(true);

    await expect(WorkerQueueService.getQueueBacklogSize()).resolves.toBe(28);
  });

  test("never consults the active-inclusive queue size", async () => {
    await WorkerQueueService.getQueueBacklogSize();
    expect(getQueueSizeMock).not.toHaveBeenCalled();
    expect(getQueueBacklogSizeMock).toHaveBeenCalledTimes(5);
  });
});

describe("TelemetryQueueService.getQueueBacklogSize", () => {
  test("reports the Telemetry queue backlog only, never the active-inclusive size", async () => {
    await expect(TelemetryQueueService.getQueueBacklogSize()).resolves.toBe(
      11 + TELEMETRY_BULK,
    );

    expect(getQueueBacklogSizeMock).toHaveBeenCalledTimes(1);
    expect(getQueueBacklogSizeMock).toHaveBeenCalledWith(QueueName.Telemetry, {
      withoutPrioritized: false,
    });
    expect(getQueueSizeMock).not.toHaveBeenCalled();
  });

  test("leaves the bulk telemetry out while ClickHouse is pushing back", async () => {
    jest.spyOn(TelemetryInsertBackpressure, "isActive").mockResolvedValue(true);

    await expect(TelemetryQueueService.getQueueBacklogSize()).resolves.toBe(11);
  });
});
