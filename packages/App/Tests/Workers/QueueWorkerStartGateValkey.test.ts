/*
 * A queue worker that has not started takes no job: on a real Valkey and
 * real BullMQ.
 *
 * The telemetry worker is built when its module is imported, and its pod
 * then waits - for the migrate Job to apply the schema migrations its code
 * needs, then for Valkey and ClickHouse. BullMQ used to start the worker's
 * fetch loop as it was built, so in that wait it took jobs and failed every
 * one ("Database not connected"): three attempts and a job was gone. A
 * rollout whose migration could not finish held the new worker pods there
 * for hours, and they threw away the probes' results the older pods would
 * have recorded.
 *
 * Here jobs wait in the queue for as long as the worker's process has not
 * started (QueueWorker.startProcessingJobs), with none of their attempts
 * used, and are each processed once when it starts.
 *
 * It needs Valkey: CI's test-setup.sh starts one and `npm test` exports its
 * settings from config.env. Locally, a disposable one:
 *
 *   docker run -d --rm -p 16405:6379 valkey/valkey:9.1-alpine
 *   VALKEY_HOST=localhost VALKEY_PORT=16405 \
 *     npx jest Tests/Workers/QueueWorkerStartGateValkey.test.ts
 *
 * The queue has a name of its own, removed afterwards.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  type QueueModule = {
    default: unknown;
    QueueName: Record<string, string>;
  };

  const actual: QueueModule = jest.requireActual(
    "Common/Server/Infrastructure/Queue",
  ) as QueueModule;

  actual.QueueName["Telemetry"] =
    `QueueWorkerStartGateTest-${process.pid}-${Date.now()}`;

  return {
    __esModule: true,
    default: actual.default,
    QueueName: actual.QueueName,
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
      trace: jest.fn(),
    },
  };
});

import Queue, { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import Redis from "Common/Server/Infrastructure/Redis";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type BullQueue = ReturnType<typeof Queue.getQueue>;
type BullWorker = ReturnType<typeof QueueWorker.getWorker>;

let queue: BullQueue;
let worker: BullWorker | null = null;

// The job ids the worker was handed, in the order it was handed them.
const processed: Array<string> = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(
  what: string,
  condition: () => boolean | Promise<boolean>,
  timeoutInMs: number = 15000,
): Promise<void> {
  const deadline: number = Date.now() + timeoutInMs;

  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }

    await sleep(20);
  }
}

// A probe result as the ingest route queues one: three attempts, as it does.
async function queueProbeResult(index: number): Promise<string> {
  const jobId: string = `probe-result-${index}`;

  await queue.add(
    "ProcessTelemetry",
    { index: index },
    {
      jobId: jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  );

  return jobId;
}

jest.setTimeout(60_000);

beforeAll(async () => {
  await Redis.connect();
  queue = Queue.getQueue(QueueName.Telemetry);
  await queue.waitUntilReady();
});

afterAll(async () => {
  if (worker) {
    await worker.close();
  }

  if (queue) {
    await queue.obliterate({ force: true });
    await queue.close();
  }

  await Redis.disconnect();
});

describe("a queue worker takes no job until its process has started", () => {
  test("jobs wait, with none of their attempts used, then are each processed once", async () => {
    const queued: Array<string> = [];

    for (let index: number = 0; index < 20; index++) {
      queued.push(await queueProbeResult(index));
    }

    // Built as ProcessTelemetry builds it, when its module is imported.
    worker = QueueWorker.getWorker(
      QueueName.Telemetry,
      async (job: QueueJob): Promise<void> => {
        processed.push(String(job.id));
      },
      { concurrency: 250 },
    );

    // The process waits for its migrations meanwhile: nothing is taken.
    await sleep(1500);

    expect(processed).toEqual([]);
    expect(worker.isRunning()).toBe(false);
    expect(await queue.getJobCounts("wait", "active", "failed")).toEqual({
      wait: 20,
      active: 0,
      failed: 0,
    });

    for (const jobId of queued) {
      const job: QueueJob | undefined = (await queue.getJob(jobId)) as
        | QueueJob
        | undefined;

      expect({ jobId, attemptsMade: job?.attemptsMade ?? -1 }).toEqual({
        jobId,
        attemptsMade: 0,
      });
    }

    // Connected and started (App/Index.ts).
    QueueWorker.startProcessingJobs();

    await waitFor("every queued job to be processed", async () => {
      const counts: Record<string, number> =
        await queue.getJobCounts("completed");

      return counts["completed"] === queued.length;
    });

    expect([...processed].sort()).toEqual([...queued].sort());
    expect(await queue.getJobCounts("wait", "active", "failed")).toEqual({
      wait: 0,
      active: 0,
      failed: 0,
    });
  });

  test("a job queued after the process started is processed at once", async () => {
    const jobId: string = await queueProbeResult(100);

    await waitFor("the new job to be processed", () => {
      return processed.includes(jobId);
    });
  });
});
