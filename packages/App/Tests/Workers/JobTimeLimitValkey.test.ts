/*
 * A Worker queue job that stops at its deadline is completed, not failed: on
 * a real Valkey and real BullMQ (OneUptime issue #11017).
 *
 * The report: the Worker queue's failed jobs were all "Job Timeout", every
 * run of AlertOwner:SendStateChangeEmail, IncidentOwner:
 * SendCreatedResourceEmail, MonitorOwner:SendStatusChangeEmail,
 * NetworkDeviceMonitor:CheckStalePolls and their kind, each run five minutes
 * after it started. Those jobs work through a backlog a page at a time and
 * stop at their deadline, leaving the rest to the next run - as they are
 * meant to. But the queue failed the run in the instant its deadline passed,
 * so a run that stopped as asked read as a failure, every run, and looked
 * like a worker that was broken.
 *
 * Here runWorkerJob, RunCron's run function, CronLock and BullMQ's own Lua run
 * for real, on a queue of this suite's own, and show that:
 *   - a run that stops at its deadline is completed, and nothing is logged as
 *     a failed job;
 *   - a cron run that stops at its deadline is completed and gives its lock
 *     back, so the next run carries on at once;
 *   - a run still going at the end of the grace is failed, "Job Timeout", as
 *     before - and no sooner.
 *
 * The grace is shortened here (JOB_DEADLINE_GRACE_MS, thirty seconds in
 * every server: QueueWorkerTimeout.test.ts pins it), so the suite takes
 * seconds.
 *
 * It needs Valkey: CI's test-setup.sh starts one and `npm test` exports its
 * settings from config.env. Locally, a disposable one:
 *
 *   docker run -d --rm -p 16405:6379 valkey/valkey:9.1-alpine
 *   VALKEY_HOST=localhost VALKEY_PORT=16405 \
 *     npx jest Tests/Workers/JobTimeLimitValkey.test.ts
 *
 * The queue has a name of its own, and it and the suite's locks are removed
 * afterwards.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  type QueueModule = {
    default: unknown;
    QueueName: Record<string, string>;
  };

  const actual: QueueModule = jest.requireActual(
    "Common/Server/Infrastructure/Queue",
  ) as QueueModule;

  actual.QueueName["Worker"] = `JobTimeLimitTest-${process.pid}-${Date.now()}`;

  return {
    __esModule: true,
    default: actual.default,
    QueueName: actual.QueueName,
  };
});

// The grace, shortened: the queue and the cron lock both read it from here.
jest.mock("Common/Server/Utils/JobDeadline", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/JobDeadline",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    JOB_DEADLINE_GRACE_MS: 1500,
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
import JobDeadline, {
  JOB_DEADLINE_GRACE_MS,
} from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import TimeoutException from "Common/Types/Exception/TimeoutException";
import { buildCronJobFunction } from "../../FeatureSet/Workers/Utils/Cron";
import {
  CRON_LOCK_GRACE_MS,
  CRON_LOCK_NAMESPACE,
} from "../../FeatureSet/Workers/Utils/CronLock";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import runWorkerJob from "../../FeatureSet/Workers/Utils/RunWorkerJob";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type BullQueue = ReturnType<typeof Queue.getQueue>;
type BullWorker = ReturnType<typeof QueueWorker.getWorker>;
type RedisClient = Awaited<BullQueue["client"]>;

// Every job name of this suite starts with it: its locks are found by it.
const JOB_NAME_PREFIX: string = `JobTimeLimitTest${process.pid}`;

// The job's time limit: short, as the grace here is.
const TIME_LIMIT_MS: number = 1000;

let queue: BullQueue;
let client: RedisClient;
let worker: BullWorker | null = null;

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

    await sleep(25);
  }
}

// The Worker queue's consumer, as Workers/Index.ts builds it.
async function startWorker(): Promise<void> {
  QueueWorker.startProcessingJobs();

  worker = QueueWorker.getWorker(
    QueueName.Worker,
    async (job: QueueJob, token?: string) => {
      await runWorkerJob(job, token);
    },
    { concurrency: 4 },
  );

  await worker.waitUntilReady();
}

// Queues one run of the job named `jobName`, as a cron's schedule does.
async function queueRun(jobName: string): Promise<string> {
  const jobId: string = `${jobName}-${Date.now()}-${Math.random()}`.replace(
    /[:.]/g,
    "-",
  );

  await queue.add(jobName, {}, { jobId });

  return jobId;
}

async function stateOf(jobId: string): Promise<string> {
  const job: QueueJob | undefined = (await queue.getJob(jobId)) as
    | QueueJob
    | undefined;

  return job ? String(await job.getState()) : "missing";
}

// Whether the worker logged a failed job ("Queue job failed: ...").
function loggedFailedJobs(): Array<string> {
  return jest
    .mocked(logger.error)
    .mock.calls.map((call: Array<unknown>) => {
      return String(call[0]);
    })
    .filter((message: string) => {
      return message.startsWith("Queue job failed");
    });
}

jest.setTimeout(60_000);

beforeAll(async () => {
  // CronLock takes its lock in the shared client (Redis.getClient()).
  await Redis.connect();
  queue = Queue.getQueue(QueueName.Worker);
  await queue.waitUntilReady();
  client = await queue.client;
});

afterAll(async () => {
  if (worker) {
    await worker.close();
  }

  if (queue) {
    const locks: Array<string> = await client.keys(
      `*${CRON_LOCK_NAMESPACE}*${JOB_NAME_PREFIX}*`,
    );

    if (locks.length > 0) {
      await client.del(...locks);
    }

    await queue.obliterate({ force: true });
    await queue.close();
  }

  await Redis.disconnect();
});

beforeEach(() => {
  jest.mocked(logger.error).mockClear();
});

afterEach(async () => {
  if (worker) {
    await worker.close();
    worker = null;
  }
});

describe("a Worker queue job at its time limit, on a real Valkey", () => {
  test("has the shortened grace, which the cron lock shares", () => {
    expect(JOB_DEADLINE_GRACE_MS).toBe(1500);
    expect(CRON_LOCK_GRACE_MS).toBe(JOB_DEADLINE_GRACE_MS);
  });

  test("is completed, not failed, when it stops at its deadline", async () => {
    const jobName: string = `${JOB_NAME_PREFIX}:WorksThroughABacklog`;
    let pages: number = 0;
    let stoppedBecause: Error | null = null;

    JobDictionary.setTimeoutInMs(jobName, TIME_LIMIT_MS);
    JobDictionary.setJobFunction(
      jobName,
      async (
        _job?: QueueJob,
        deadline: JobDeadline = JobDeadline.none(),
      ): Promise<void> => {
        // A page every 100 ms of a backlog far longer than one run reaches.
        while (!deadline.hasPassed()) {
          await sleep(100);
          pages++;
        }

        stoppedBecause = deadline.getReason();
      },
    );

    await startWorker();
    const startedAt: number = Date.now();
    const jobId: string = await queueRun(jobName);

    await waitFor("the run to finish", async () => {
      return ["completed", "failed"].includes(await stateOf(jobId));
    });

    expect(await stateOf(jobId)).toBe("completed");
    expect(await queue.getJobCounts("failed")).toEqual({ failed: 0 });
    expect(loggedFailedJobs()).toEqual([]);

    // It worked until its deadline and stopped there, as it was asked to.
    expect(stoppedBecause).toBeInstanceOf(TimeoutException);
    expect(pages).toBeGreaterThanOrEqual(5);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(TIME_LIMIT_MS);
  });

  test("is completed, and gives its lock back, when a cron run stops at its deadline", async () => {
    const jobName: string = `${JOB_NAME_PREFIX}:OwnerNotifications`;
    const runs: Array<{ pages: number; stopped: boolean }> = [];

    JobDictionary.setTimeoutInMs(jobName, TIME_LIMIT_MS);
    JobDictionary.setJobFunction(
      jobName,
      buildCronJobFunction({
        jobName: jobName,
        options: {},
        runFunction: async (
          deadline: JobDeadline = JobDeadline.none(),
        ): Promise<void> => {
          const run: { pages: number; stopped: boolean } = {
            pages: 0,
            stopped: false,
          };
          runs.push(run);

          while (!deadline.hasPassed()) {
            await sleep(100);
            run.pages++;
          }

          run.stopped = true;
        },
      }),
    );

    await startWorker();
    const first: string = await queueRun(jobName);

    await waitFor("the first run to finish", async () => {
      return ["completed", "failed"].includes(await stateOf(first));
    });

    expect(await stateOf(first)).toBe("completed");

    // The next run takes the lock at once: it carries on, it does not skip.
    const second: string = await queueRun(jobName);

    await waitFor("the second run to finish", async () => {
      return ["completed", "failed"].includes(await stateOf(second));
    });

    expect(await stateOf(second)).toBe("completed");
    expect(runs).toHaveLength(2);
    expect(
      runs.every((run: { pages: number; stopped: boolean }) => {
        return run.stopped && run.pages > 0;
      }),
    ).toBe(true);
    expect(await queue.getJobCounts("failed")).toEqual({ failed: 0 });
    expect(loggedFailedJobs()).toEqual([]);
  });

  test("is completed when the page in flight at its deadline finishes inside the grace", async () => {
    const jobName: string = `${JOB_NAME_PREFIX}:SlowPage`;

    JobDictionary.setTimeoutInMs(jobName, TIME_LIMIT_MS);
    JobDictionary.setJobFunction(
      jobName,
      async (
        _job?: QueueJob,
        deadline: JobDeadline = JobDeadline.none(),
      ): Promise<void> => {
        // Pages of 700 ms: the one in flight at 1 s ends at 1.4 s.
        while (!deadline.hasPassed()) {
          await sleep(700);
        }
      },
    );

    await startWorker();
    const jobId: string = await queueRun(jobName);

    await waitFor("the run to finish", async () => {
      return ["completed", "failed"].includes(await stateOf(jobId));
    });

    expect(await stateOf(jobId)).toBe("completed");
    expect(loggedFailedJobs()).toEqual([]);
  });

  test("is failed with Job Timeout when it is still going at the end of the grace, and no sooner", async () => {
    const jobName: string = `${JOB_NAME_PREFIX}:NeverReturns`;
    let release: () => void = () => {};
    const hang: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    JobDictionary.setTimeoutInMs(jobName, TIME_LIMIT_MS);
    JobDictionary.setJobFunction(jobName, async (): Promise<void> => {
      // Checks no deadline: a query that never comes back.
      await hang;
    });

    await startWorker();
    const startedAt: number = Date.now();
    const jobId: string = await queueRun(jobName);

    // Past its limit, inside its grace: not failed yet.
    await sleep(TIME_LIMIT_MS + JOB_DEADLINE_GRACE_MS / 2);
    expect(await stateOf(jobId)).toBe("active");

    await waitFor("the run to be failed", async () => {
      return (await stateOf(jobId)) === "failed";
    });

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
      TIME_LIMIT_MS + JOB_DEADLINE_GRACE_MS,
    );

    const failedJob: QueueJob | undefined = (await queue.getJob(jobId)) as
      | QueueJob
      | undefined;

    expect(failedJob?.failedReason).toBe("Job Timeout");
    expect(loggedFailedJobs()).toHaveLength(1);
    expect(loggedFailedJobs()[0]).toContain(jobName);

    release();
  });
});
