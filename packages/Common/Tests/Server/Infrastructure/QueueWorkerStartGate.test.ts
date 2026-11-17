import { beforeEach, describe, expect, test } from "@jest/globals";
import { QueueJob, QueueName } from "../../../Server/Infrastructure/Queue";

/*
 * A QUEUE WORKER TAKES NO JOB UNTIL ITS PROCESS HAS STARTED.
 *
 * The telemetry worker (ProcessTelemetry) is built when its module is
 * imported, and BullMQ used to start its fetch loop in the constructor. The
 * worker process then waited - for the migrate Job to apply the schema
 * migrations its code needs (up to DATABASE_MIGRATION_WAIT_TIMEOUT_MS), and
 * then for Valkey and ClickHouse - while that worker took jobs at its full
 * concurrency and failed every one ("Database not connected", "Redis not
 * connected"). After three attempts a job was dropped. In one rollout a
 * migration that could not finish held the new worker pods at that wait for
 * hours, and they threw away the probes' results, and the logs, metrics and
 * traces, that the older pods would have recorded.
 *
 * A worker is now built with autorun off. Its fetch loop (Worker.run())
 * starts at QueueWorker.startProcessingJobs(), which App/Index.ts calls once
 * the process has connected to its datastores and started, or at once for a
 * worker built after that.
 */

interface MockWorker {
  queueName: string;
  options: Record<string, unknown>;
  run: jest.Mock;
  emit: jest.Mock;
  on: jest.Mock;
  close: jest.Mock;
}

const mockWorkers: Array<MockWorker> = [];

// What the next worker's run() does: a fetch loop runs until it is closed.
let mockRun: () => Promise<void> = () => {
  return new Promise<void>(() => {});
};

jest.mock("bullmq", () => {
  return {
    __esModule: true,
    Queue: class {},
    QueueEvents: class {},
    Job: class {},
    Worker: jest
      .fn()
      .mockImplementation(
        (queueName: string, _processor: unknown, options: unknown) => {
          const worker: MockWorker = {
            queueName: queueName,
            options: options as Record<string, unknown>,
            run: jest.fn().mockImplementation(() => {
              return mockRun();
            }),
            emit: jest.fn(),
            on: jest.fn(),
            close: jest.fn().mockResolvedValue(undefined),
          };
          mockWorkers.push(worker);
          return worker;
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

jest.mock("../../../Server/Utils/GracefulShutdown", () => {
  return {
    __esModule: true,
    default: { registerHandler: jest.fn() },
    ShutdownPriority: { Workers: 1, DataStores: 2 },
  };
});

type QueueWorkerClass =
  typeof import("../../../Server/Infrastructure/QueueWorker").default;

/*
 * A fresh QueueWorker, as a process has at startup: whether jobs may be
 * processed is the state of the process, so each test starts from none.
 */
function freshQueueWorker(): QueueWorkerClass {
  let queueWorker: QueueWorkerClass | null = null;

  // Its own imports (bullmq, Redis, GracefulShutdown) are still the mocks.
  jest.isolateModules(() => {
    queueWorker = (
      jest.requireActual("../../../Server/Infrastructure/QueueWorker") as {
        default: QueueWorkerClass;
      }
    ).default;
  });

  return queueWorker!;
}

function build(queueWorker: QueueWorkerClass, queueName: QueueName): void {
  queueWorker.getWorker(
    queueName,
    async (_job: QueueJob): Promise<void> => {},
    {
      concurrency: 250,
    },
  );
}

function workerOf(queueName: QueueName): MockWorker {
  const workers: Array<MockWorker> = mockWorkers.filter(
    (worker: MockWorker) => {
      return worker.queueName === queueName;
    },
  );

  expect(workers).toHaveLength(1);

  return workers[0]!;
}

// Lets a rejected run() reach its catch.
async function settle(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

beforeEach(() => {
  mockWorkers.length = 0;
  mockRun = () => {
    return new Promise<void>(() => {});
  };
});

describe("QueueWorker takes no job until its process has started", () => {
  test("a worker built before the process started is built with autorun off, and takes no job", () => {
    const queueWorker: QueueWorkerClass = freshQueueWorker();

    // As ProcessTelemetry does when it is imported.
    build(queueWorker, QueueName.Telemetry);

    const worker: MockWorker = workerOf(QueueName.Telemetry);

    expect(worker.options["autorun"]).toBe(false);
    expect(worker.options["concurrency"]).toBe(250);
    expect(worker.run).not.toHaveBeenCalled();
    expect(queueWorker.isProcessingJobs()).toBe(false);
    expect(queueWorker.getQueuesWaitingToStart()).toEqual([
      QueueName.Telemetry,
    ]);
  });

  test("startProcessingJobs starts every worker built so far, each once", () => {
    const queueWorker: QueueWorkerClass = freshQueueWorker();

    build(queueWorker, QueueName.Telemetry);
    build(queueWorker, QueueName.Worker);

    queueWorker.startProcessingJobs();

    expect(workerOf(QueueName.Telemetry).run).toHaveBeenCalledTimes(1);
    expect(workerOf(QueueName.Worker).run).toHaveBeenCalledTimes(1);
    expect(queueWorker.isProcessingJobs()).toBe(true);
    expect(queueWorker.getQueuesWaitingToStart()).toEqual([]);

    // Calling it again starts nothing a second time.
    queueWorker.startProcessingJobs();

    expect(workerOf(QueueName.Telemetry).run).toHaveBeenCalledTimes(1);
    expect(workerOf(QueueName.Worker).run).toHaveBeenCalledTimes(1);
  });

  test("a worker built after the process started takes jobs at once", () => {
    const queueWorker: QueueWorkerClass = freshQueueWorker();

    queueWorker.startProcessingJobs();

    // As the Workers, Workflow and Runbook feature sets do in their init().
    build(queueWorker, QueueName.Workflow);

    const worker: MockWorker = workerOf(QueueName.Workflow);

    expect(worker.options["autorun"]).toBe(false);
    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(queueWorker.getQueuesWaitingToStart()).toEqual([]);
  });

  test("a process that never starts never takes a job", () => {
    const queueWorker: QueueWorkerClass = freshQueueWorker();

    build(queueWorker, QueueName.Telemetry);
    build(queueWorker, QueueName.Worker);
    build(queueWorker, QueueName.Workflow);

    for (const worker of mockWorkers) {
      expect(worker.run).not.toHaveBeenCalled();
    }

    expect(queueWorker.getQueuesWaitingToStart()).toEqual([
      QueueName.Telemetry,
      QueueName.Worker,
      QueueName.Workflow,
    ]);
  });

  test("a worker that cannot run says so as its error event, as BullMQ's own autorun does", async () => {
    const queueWorker: QueueWorkerClass = freshQueueWorker();
    const failure: Error = new Error("No process function is defined.");

    mockRun = () => {
      return Promise.reject(failure);
    };

    build(queueWorker, QueueName.Telemetry);
    queueWorker.startProcessingJobs();
    await settle();

    expect(workerOf(QueueName.Telemetry).emit).toHaveBeenCalledWith(
      "error",
      failure,
    );
  });
});
