import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { SpanStatusCode, context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { QueueJob, QueueName } from "../../../Server/Infrastructure/Queue";
import QueueWorker from "../../../Server/Infrastructure/QueueWorker";
import GracefulShutdown from "../../../Server/Utils/GracefulShutdown";
import Telemetry from "../../../Server/Utils/Telemetry";

/*
 * A job handler that moves its job back to the queue (job.moveToDelayed) and
 * throws BullMQ's DelayedError - as UnknownQueueJob.handBack does with a job
 * a different release of OneUptime queued (issue #5546) - has neither failed
 * nor completed it. QueueWorker hands the handler the lock that moving the
 * job needs, rethrows the DelayedError untouched so BullMQ leaves the job
 * where the handler put it, and counts it as "delayed": not as a failure, an
 * exception on the job's span, or an Issue.
 */

interface MockWorker {
  processor: (job: QueueJob, token?: string) => Promise<void>;
}

const mockWorkers: Array<MockWorker> = [];
const mockJobCounts: Array<Record<string, string>> = [];

jest.mock("bullmq", () => {
  class DelayedError extends Error {
    public constructor(message: string = "bullmq:movedToDelayed") {
      super(message);
      this.name = "DelayedError";
    }
  }

  class UnrecoverableError extends Error {
    public constructor(message: string = "bullmq:unrecoverable") {
      super(message);
      this.name = "UnrecoverableError";
    }
  }

  return {
    __esModule: true,
    Queue: class {},
    QueueEvents: class {},
    Job: class {},
    DelayedError,
    UnrecoverableError,
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
      getWorkerJobCounter: () => {
        return {
          add: (_count: number, attributes: Record<string, string>) => {
            mockJobCounts.push(attributes);
          },
          record: jest.fn(),
        };
      },
      getWorkerJobDuration: instrument,
    },
  };
});

const bullmq: {
  DelayedError: new () => Error;
  UnrecoverableError: new (message?: string) => Error;
} = jest.requireMock("bullmq");

const exporter: InMemorySpanExporter = new InMemorySpanExporter();
const provider: BasicTracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager: AsyncLocalStorageContextManager =
  new AsyncLocalStorageContextManager();

const JOB: QueueJob = {
  id: "job-1",
  name: "SecurityHunts:RunProjectHunts",
  data: {},
} as unknown as QueueJob;

function worker(
  onJobInQueue: (job: QueueJob, token?: string) => Promise<void>,
): MockWorker {
  QueueWorker.getWorker(QueueName.Worker, onJobInQueue, { concurrency: 1 });
  return mockWorkers[mockWorkers.length - 1]!;
}

function jobSpan(): ReadableSpan {
  const spans: Array<ReadableSpan> = exporter
    .getFinishedSpans()
    .filter((span: ReadableSpan) => {
      return span.name === `worker.job Worker/${JOB.name}`;
    });

  expect(spans).toHaveLength(1);
  return spans[0]!;
}

beforeAll(() => {
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);
});

afterAll(() => {
  trace.disable();
  context.disable();
});

beforeEach(() => {
  exporter.reset();
  mockWorkers.length = 0;
  mockJobCounts.length = 0;
  jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(true);
  jest.spyOn(GracefulShutdown, "registerHandler").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("QueueWorker hands a job's handler the lock BullMQ holds on it", () => {
  test("the token BullMQ passes reaches the handler", async () => {
    const onJobInQueue: jest.Mock = jest.fn(async () => {});

    await worker(onJobInQueue as never).processor(JOB, "lock-token");

    expect(onJobInQueue).toHaveBeenCalledWith(JOB, "lock-token");
  });
});

describe("QueueWorker and a job its handler moved back to the queue", () => {
  test("the DelayedError reaches BullMQ as it is", async () => {
    const delayed: Error = new bullmq.DelayedError();

    await expect(
      worker(async () => {
        throw delayed;
      }).processor(JOB, "lock-token"),
    ).rejects.toBe(delayed);
  });

  test("it is counted as delayed, not as a failure", async () => {
    await worker(async () => {
      throw new bullmq.DelayedError();
    })
      .processor(JOB, "lock-token")
      .catch(() => {});

    expect(mockJobCounts).toEqual([
      expect.objectContaining({
        "messaging.destination.name": QueueName.Worker,
        "messaging.operation.name": JOB.name,
        outcome: "delayed",
      }),
    ]);
  });

  test("its span records no exception and ends well", async () => {
    const recordException: jest.SpyInstance = jest.spyOn(
      Telemetry,
      "recordExceptionOnSpan",
    );

    await worker(async () => {
      throw new bullmq.DelayedError();
    })
      .processor(JOB, "lock-token")
      .catch(() => {});

    expect(recordException).not.toHaveBeenCalled();
    expect(jobSpan().status.code).toBe(SpanStatusCode.OK);
    expect(jobSpan().events).toEqual([]);
  });

  test("a job that gives up (UnrecoverableError) is a failure like any other", async () => {
    const recordException: jest.SpyInstance = jest.spyOn(
      Telemetry,
      "recordExceptionOnSpan",
    );
    const gaveUp: Error = new bullmq.UnrecoverableError(
      'No worker ran a job named "X" within 30 minutes of it falling due.',
    );

    await expect(
      worker(async () => {
        throw gaveUp;
      }).processor(JOB, "lock-token"),
    ).rejects.toBe(gaveUp);

    expect(recordException).toHaveBeenCalledTimes(1);
    expect(mockJobCounts).toEqual([
      expect.objectContaining({ outcome: "failure" }),
    ]);
  });

  test("a job that throws is still a failure", async () => {
    await worker(async () => {
      throw new Error("ClickHouse is not reachable");
    })
      .processor(JOB, "lock-token")
      .catch(() => {});

    expect(mockJobCounts).toEqual([
      expect.objectContaining({ outcome: "failure" }),
    ]);
    expect(jobSpan().status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe("QueueWorker.isMovedBackToQueue", () => {
  test("knows BullMQ's DelayedError, by name as BullMQ does", () => {
    expect(QueueWorker.isMovedBackToQueue(new bullmq.DelayedError())).toBe(
      true,
    );
    expect(QueueWorker.isMovedBackToQueue({ name: "DelayedError" })).toBe(true);
  });

  test("takes nothing else for it", () => {
    for (const error of [
      new Error("bullmq:movedToDelayed"),
      new bullmq.UnrecoverableError(),
      { name: "TimeoutException" },
      "DelayedError",
      null,
      undefined,
    ]) {
      expect(QueueWorker.isMovedBackToQueue(error)).toBe(false);
    }
  });
});
