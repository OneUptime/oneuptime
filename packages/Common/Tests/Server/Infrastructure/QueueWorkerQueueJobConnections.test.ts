import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import QueueJobConnections from "../../../Server/Infrastructure/Postgres/QueueJobConnections";
import { QueueJob, QueueName } from "../../../Server/Infrastructure/Queue";
import QueueWorker from "../../../Server/Infrastructure/QueueWorker";
import GracefulShutdown from "../../../Server/Utils/GracefulShutdown";

/*
 * Every job a QueueWorker runs runs as a job of its queue
 * (QueueJobConnections.runAsQueueJob), so the Postgres connections it
 * borrows count against the queue jobs' share of the pool and requests
 * always have the rest (#7920). Whatever the handler starts inherits it;
 * nothing outside the handler does.
 */

interface MockWorker {
  processor: (job: QueueJob, token?: string) => Promise<void>;
}

const mockWorkers: Array<MockWorker> = [];

jest.mock("bullmq", () => {
  return {
    __esModule: true,
    Queue: class {},
    QueueEvents: class {},
    Job: class {},
    Worker: jest
      .fn()
      .mockImplementation(
        (
          _name: string,
          processor: (job: QueueJob, token?: string) => Promise<void>,
        ) => {
          mockWorkers.push({ processor });
          return { on: jest.fn(), close: jest.fn() };
        },
      ),
  };
});

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getRedisOptions: jest.fn().mockReturnValue({}) },
  };
});

jest.mock("../../../Server/Utils/Telemetry/AppMetrics", () => {
  const instrument: () => { add: jest.Mock; record: jest.Mock } = () => {
    return { add: jest.fn(), record: jest.fn() };
  };

  return {
    __esModule: true,
    default: {
      getWorkerJobsInFlight: instrument,
      getWorkerJobCounter: instrument,
      getWorkerJobDuration: instrument,
    },
  };
});

const JOB: QueueJob = {
  id: "job-1",
  name: "ProcessTelemetry",
  data: {},
} as unknown as QueueJob;

function worker(
  queueName: QueueName,
  onJobInQueue: (job: QueueJob, token?: string) => Promise<void>,
): MockWorker {
  QueueWorker.getWorker(queueName, onJobInQueue, { concurrency: 1 });
  return mockWorkers[mockWorkers.length - 1]!;
}

beforeEach(() => {
  mockWorkers.length = 0;
  jest.spyOn(GracefulShutdown, "registerHandler").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("QueueWorker runs every job as a job of its queue", () => {
  test("the handler, and what it starts, borrow connections as a job of the worker's queue", async () => {
    const seen: Array<string | undefined> = [];
    let started: Promise<void> = Promise.resolve();

    await worker(QueueName.Telemetry, async (): Promise<void> => {
      seen.push(QueueJobConnections.currentQueue());
      started = new Promise<void>((resolve: () => void): void => {
        setTimeout((): void => {
          seen.push(QueueJobConnections.currentQueue());
          resolve();
        }, 0);
      });
    }).processor(JOB, "lock-token");
    await started;

    expect(seen).toEqual([QueueName.Telemetry, QueueName.Telemetry]);
    expect(QueueJobConnections.currentQueue()).toBeUndefined();
  });

  test("each worker's jobs count under their own queue", async () => {
    const seen: Array<string | undefined> = [];
    const record: () => Promise<void> = async (): Promise<void> => {
      seen.push(QueueJobConnections.currentQueue());
    };

    await worker(QueueName.Worker, record).processor(JOB);
    await worker(QueueName.Workflow, record).processor(JOB);

    expect(seen).toEqual([QueueName.Worker, QueueName.Workflow]);
  });

  test("a job that fails still fails as it did", async () => {
    const failure: Error = new Error("statement timeout");

    await expect(
      worker(QueueName.Worker, async (): Promise<void> => {
        throw failure;
      }).processor(JOB),
    ).rejects.toThrow("statement timeout");
    expect(QueueJobConnections.currentQueue()).toBeUndefined();
  });
});
