/*
 * Same-monitor coalescing of Incoming Request ingest, against a real Redis
 * and real BullMQ: which request a monitor evaluates when requests arrive
 * while its job is waiting, running, or delayed for a retry.
 *
 * BullMQ's deduplication (keepLastIfActive) keeps the newest payload only for
 * a request that arrives while the monitor's job is ACTIVE. One that arrives
 * while the job is still WAITING - or delayed for a retry - is discarded, and
 * the older job runs with its own payload. On 2026-10-05 (an ~11 minute
 * Telemetry backlog) that was nearly every request: each trip through the
 * queue evaluated the first request after the previous job, never the newest.
 *
 * The enqueue path (TelemetryQueueService, the Queue wrapper, BullMQ's Lua,
 * IncomingRequestLatestPayloadStore's Lua) and the worker entry point run for
 * real here, on a queue of this suite's own. Only the monitor lookup and the
 * evaluation are stubbed, so a test can see which request was evaluated and
 * hold an evaluation open.
 *
 * It needs Redis: CI's test-setup.sh starts one on localhost:6310 and `npm
 * test` exports its settings from config.env. Locally, a disposable one:
 *
 *   docker run -d --rm -p 16379:6379 valkey/valkey:9.1-alpine
 *   VALKEY_HOST=localhost VALKEY_PORT=16379 \
 *     npx jest Tests/Telemetry/IncomingRequestCoalescingRedis.test.ts
 *
 * Only this suite's queue and random secret keys are touched, and they are
 * removed afterwards.
 */

/*
 * The real Queue wrapper, on a queue of this suite's own, so nothing shares
 * its jobs. The Telemetry entry of the wrapper's own enum is renamed in
 * place rather than in a copy: the wrapper gives jobs the Telemetry queue's
 * retries (3 attempts, exponential backoff) by comparing against that enum.
 * The name is built inside the factory, which runs, hoisted, before anything
 * declared in this file.
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
    `IncomingRequestCoalescingTest-${process.pid}-${Date.now()}`;

  return {
    __esModule: true,
    default: actual.default,
    QueueName: actual.QueueName,
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: {
      monitorResource: jest.fn(),
    },
  };
});

/*
 * Covered by its own suites; here it must not leave arrival markers behind
 * in the shared Redis.
 */
jest.mock("Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore", () => {
  return {
    __esModule: true,
    default: {
      track: jest.fn((input: { receivedAt: Date }) => {
        return Promise.resolve(new Date(input.receivedAt));
      }),
      getReceivedAtAsOf: (receivedAt: Date): Date => {
        return receivedAt;
      },
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
      trace: jest.fn(),
    },
  };
});

import TelemetryQueueService, {
  TelemetryIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { processIncomingRequestJobFromQueue } from "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import IncomingRequestLatestPayloadStore, {
  LatestIncomingRequestPayload,
} from "../../FeatureSet/Telemetry/Utils/IncomingRequestLatestPayloadStore";
import Queue, { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
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

type MonitorJobs = {
  active: Array<QueueJob>;
  waiting: Array<QueueJob>;
  delayed: Array<QueueJob>;
};

const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;

let queue: BullQueue;
const workers: Array<BullWorker> = [];
const secretKeys: Array<string> = [];

// Every evaluation that started, as "<secretKey>:<sequence>", in order.
let started: Array<string> = [];
// The sequence numbers each monitor evaluated successfully, in order.
let evaluated: Map<string, Array<number>> = new Map();
// Evaluations to hold open until released, and evaluations to fail once.
let held: Map<string, Promise<void>> = new Map();
let failOnce: Map<string, Error> = new Map();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(
  what: string,
  condition: () => boolean | Promise<boolean>,
  timeoutInMs: number = 10000,
): Promise<void> {
  const deadline: number = Date.now() + timeoutInMs;

  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }

    await sleep(20);
  }
}

function newMonitor(): string {
  const secretKey: string = ObjectID.generate().toString();
  secretKeys.push(secretKey);
  return secretKey;
}

// A request as the endpoint queues it; the body says which one it is.
async function send(secretKey: string, sequence: number): Promise<void> {
  await TelemetryQueueService.addIncomingRequestIngestJob({
    secretKey: secretKey,
    requestHeaders: { "content-type": "application/json" },
    requestBody: { sequence: sequence },
    requestMethod: "POST",
    receivedAt: new Date(),
  });
}

function hold(secretKey: string, sequence: number): () => void {
  let release: () => void = (): void => {};

  held.set(
    `${secretKey}:${sequence}`,
    new Promise<void>((resolve: () => void) => {
      release = resolve;
    }),
  );

  return (): void => {
    release();
  };
}

function evaluationsOf(secretKey: string): Array<number> {
  return evaluated.get(secretKey) || [];
}

function isJobOf(job: QueueJob | undefined, secretKey: string): boolean {
  return (
    (job?.data as TelemetryIngestJobData | undefined)?.incomingRequestIngest
      ?.secretKey === secretKey
  );
}

/*
 * The monitor's jobs by state, read one state at a time: only for moments
 * when they are not moving between states (a job held open, waiting with no
 * worker free, or delayed for a retry).
 */
async function jobsOf(secretKey: string): Promise<MonitorJobs> {
  const pick: (
    state: "active" | "waiting" | "delayed",
  ) => Promise<Array<QueueJob>> = async (
    state: "active" | "waiting" | "delayed",
  ): Promise<Array<QueueJob>> => {
    const jobs: Array<QueueJob> = await queue.getJobs([state]);

    return jobs.filter((job: QueueJob) => {
      return isJobOf(job, secretKey);
    });
  };

  return {
    active: await pick("active"),
    waiting: await pick("waiting"),
    delayed: await pick("delayed"),
  };
}

// The request a job was created with - what BullMQ alone would evaluate.
function ownSequence(job: QueueJob): number {
  const data: TelemetryIngestJobData = job.data as TelemetryIngestJobData;
  return (data.incomingRequestIngest!.requestBody as JSONObject)[
    "sequence"
  ] as number;
}

/*
 * Nothing of the monitor's is waiting, running or delayed. All three states
 * come from one snapshot (getJobs reads them in a single Lua call): read one
 * at a time, a job moving from waiting to running between two reads would be
 * in neither, and the monitor would look settled before its job had run.
 */
async function settled(secretKey: string): Promise<void> {
  await waitFor("the monitor's jobs to finish", async () => {
    const live: Array<QueueJob | undefined> = await queue.getJobs([
      "active",
      "waiting",
      "delayed",
    ]);

    return !live.some((job: QueueJob | undefined) => {
      return isJobOf(job, secretKey);
    });
  });
}

async function isStored(secretKey: string): Promise<boolean> {
  const client: ClientType = Redis.getClient()!;
  return (
    (await client.exists(
      IncomingRequestLatestPayloadStore.getKey(secretKey),
    )) === 1
  );
}

/*
 * The worker runs the Incoming Request case of the telemetry worker
 * (ProcessTelemetry), one job at a time, so the order is predictable.
 */
function startWorker(): BullWorker {
  const worker: BullWorker = QueueWorker.getWorker(
    QueueName.Telemetry,
    async (job: QueueJob): Promise<void> => {
      const data: TelemetryIngestJobData = job.data as TelemetryIngestJobData;
      await processIncomingRequestJobFromQueue(data.incomingRequestIngest!);
    },
    { concurrency: 1 },
  );

  workers.push(worker);

  return worker;
}

beforeAll(async () => {
  await Redis.connect();
  queue = Queue.getQueue(QueueName.Telemetry);
  await queue.waitUntilReady();
});

afterAll(async () => {
  await Promise.all(
    workers.map((worker: BullWorker) => {
      return worker.close();
    }),
  );

  if (queue) {
    await queue.obliterate({ force: true });
    await queue.close();
  }

  const client: ClientType | null = Redis.getClient();

  if (client && secretKeys.length > 0) {
    await client.del(
      ...secretKeys.map((secretKey: string) => {
        return IncomingRequestLatestPayloadStore.getKey(secretKey);
      }),
    );
  }

  await Redis.disconnect();
});

beforeEach(() => {
  started = [];
  evaluated = new Map();
  held = new Map();
  failOnce = new Map();

  findOneBy.mockImplementation((async (args: {
    query: { incomingRequestSecretKey: ObjectID };
  }) => {
    // One monitor per secret key; its id is the key, to tell them apart.
    const monitor: Monitor = new Monitor();
    monitor._id = args.query.incomingRequestSecretKey.toString();
    monitor.projectId = new ObjectID("4c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19");
    monitor.isArchived = false;
    monitor.disableActiveMonitoring = false;
    monitor.disableActiveMonitoringBecauseOfManualIncident = false;
    monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;
    return monitor;
  }) as never);

  monitorResource.mockImplementation((async (
    request: IncomingMonitorRequest,
  ) => {
    const secretKey: string = request.monitorId.toString();
    const sequence: number = (request.requestBody as JSONObject)[
      "sequence"
    ] as number;
    const key: string = `${secretKey}:${sequence}`;

    started.push(key);

    const failure: Error | undefined = failOnce.get(key);

    if (failure) {
      failOnce.delete(key);
      throw failure;
    }

    await held.get(key);

    evaluated.set(secretKey, [...evaluationsOf(secretKey), sequence]);

    return {};
  }) as never);
});

afterEach(async () => {
  jest.restoreAllMocks();

  // Let anything still held go, so no worker is left waiting on this test.
  held = new Map();

  await Promise.all(
    workers.splice(0).map((worker: BullWorker) => {
      return worker.close(true);
    }),
  );
});

describe("Incoming Request coalescing on Redis and BullMQ", () => {
  /*
   * The production case. Five requests arrive while the monitor's job waits
   * in a backlog: BullMQ keeps one job, created by the FIRST request, and
   * discards the other four. That job evaluates the newest request.
   */
  test("requests that arrive while the monitor's job waits: the newest is evaluated, once", async () => {
    const secretKey: string = newMonitor();

    for (let sequence: number = 1; sequence <= 5; sequence++) {
      await send(secretKey, sequence);
    }

    const jobs: MonitorJobs = await jobsOf(secretKey);

    // At most one job per monitor, whatever the sender does...
    expect(jobs.active).toHaveLength(0);
    expect(jobs.waiting).toHaveLength(1);
    // ...and BullMQ keeps the one the first request created.
    expect(ownSequence(jobs.waiting[0]!)).toBe(1);

    startWorker();
    await settled(secretKey);

    expect(evaluationsOf(secretKey)).toEqual([5]);
    expect(await isStored(secretKey)).toBe(false);
  });

  /*
   * BullMQ's own case: requests that arrive while the monitor's job is
   * running are held as one next job, which runs when it finishes.
   */
  test("requests that arrive while the monitor's job runs: the newest is evaluated after it", async () => {
    const secretKey: string = newMonitor();
    const release: () => void = hold(secretKey, 1);

    startWorker();
    await send(secretKey, 1);
    await waitFor("the first evaluation to start", () => {
      return started.includes(`${secretKey}:1`);
    });

    for (let sequence: number = 2; sequence <= 4; sequence++) {
      await send(secretKey, sequence);
    }

    // The next job is held by BullMQ until the running one finishes.
    const jobs: MonitorJobs = await jobsOf(secretKey);
    expect(jobs.active).toHaveLength(1);
    expect(jobs.waiting).toHaveLength(0);

    release();
    await settled(secretKey);

    expect(evaluationsOf(secretKey)).toEqual([1, 4]);
    expect(await isStored(secretKey)).toBe(false);
  });

  /*
   * Both, as a backlog produces them: the job BullMQ queues after the running
   * one lands behind other monitors' work, and more requests arrive while it
   * waits there. Before the store, that job evaluated request 2.
   */
  test("the job queued behind a running one still evaluates the newest request", async () => {
    const secretKey: string = newMonitor();
    const otherSecretKey: string = newMonitor();
    const releaseFirst: () => void = hold(secretKey, 1);
    const releaseOther: () => void = hold(otherSecretKey, 1);

    startWorker();

    await send(secretKey, 1);
    await waitFor("the first evaluation to start", () => {
      return started.includes(`${secretKey}:1`);
    });

    // Held by BullMQ as the next job; another monitor's request queues up.
    await send(secretKey, 2);
    await send(otherSecretKey, 1);

    // The next job is queued when the first finishes, behind the other one.
    releaseFirst();
    await waitFor("the other monitor's evaluation to start", () => {
      return started.includes(`${otherSecretKey}:1`);
    });

    let jobs: MonitorJobs = await jobsOf(secretKey);
    expect(jobs.active).toHaveLength(0);
    expect(jobs.waiting).toHaveLength(1);
    expect(ownSequence(jobs.waiting[0]!)).toBe(2);

    // Discarded by BullMQ: the monitor's job is waiting.
    await send(secretKey, 3);
    await send(secretKey, 4);

    jobs = await jobsOf(secretKey);
    expect(jobs.waiting).toHaveLength(1);
    expect(ownSequence(jobs.waiting[0]!)).toBe(2);

    releaseOther();
    await settled(secretKey);
    await settled(otherSecretKey);

    expect(evaluationsOf(secretKey)).toEqual([1, 4]);
    expect(evaluationsOf(otherSecretKey)).toEqual([1]);
    expect(await isStored(secretKey)).toBe(false);
    expect(await isStored(otherSecretKey)).toBe(false);
  });

  /*
   * A failed evaluation is retried after a backoff (5 seconds for the first
   * retry), with the job delayed meanwhile. Requests that arrive then are
   * discarded by BullMQ like those that arrive while it waits. The retry
   * evaluates the newest.
   */
  test("requests that arrive while the monitor's job waits to be retried: the retry evaluates the newest", async () => {
    const secretKey: string = newMonitor();
    failOnce.set(`${secretKey}:1`, new Error("Acquire mutex timeout"));

    startWorker();
    await send(secretKey, 1);

    await waitFor("the first attempt to fail into a retry", async () => {
      return (await jobsOf(secretKey)).delayed.length === 1;
    });

    // Not evaluated, so still stored for the retry.
    expect(await isStored(secretKey)).toBe(true);

    await send(secretKey, 2);
    await send(secretKey, 3);

    const jobs: MonitorJobs = await jobsOf(secretKey);
    expect(jobs.delayed).toHaveLength(1);
    expect(jobs.waiting).toHaveLength(0);
    expect(jobs.active).toHaveLength(0);
    expect(ownSequence(jobs.delayed[0]!)).toBe(1);

    await waitFor(
      "the retry to finish",
      async () => {
        return (
          evaluationsOf(secretKey).length > 0 &&
          (await jobsOf(secretKey)).active.length === 0
        );
      },
      20000,
    );
    await settled(secretKey);

    expect(started).toEqual([`${secretKey}:1`, `${secretKey}:3`]);
    expect(evaluationsOf(secretKey)).toEqual([3]);
    expect(await isStored(secretKey)).toBe(false);
  }, 30000);

  /*
   * The next job BullMQ holds while a job runs is created by a request that
   * may already have been stored when the running job read the store - so
   * the running job evaluated it. The next job then finds nothing stored and
   * evaluates nothing, rather than the same request twice.
   */
  test("a request the running job already evaluated is not evaluated again", async () => {
    const secretKey: string = newMonitor();
    const getLatest: (
      secretKey: string,
    ) => Promise<LatestIncomingRequestPayload | null> =
      IncomingRequestLatestPayloadStore.getLatest.bind(
        IncomingRequestLatestPayloadStore,
      );

    let releaseRead: () => void = (): void => {};
    const readHeld: Promise<void> = new Promise<void>((resolve: () => void) => {
      releaseRead = resolve;
    });
    let reads: number = 0;

    const getLatestSpy: jest.Mock = jest
      .spyOn(IncomingRequestLatestPayloadStore, "getLatest")
      .mockImplementation(async (key: string) => {
        reads++;

        // Hold the first job just before it reads the store.
        if (reads === 1) {
          await readHeld;
        }

        return getLatest(key);
      }) as unknown as jest.Mock;

    startWorker();
    await send(secretKey, 1);
    await waitFor("the first job to start", () => {
      return reads === 1;
    });

    // Stored before the running job reads it; held by BullMQ as the next job.
    await send(secretKey, 2);

    const jobs: MonitorJobs = await jobsOf(secretKey);
    expect(jobs.active).toHaveLength(1);
    expect(jobs.waiting).toHaveLength(0);

    releaseRead();
    await waitFor("the next job to run", () => {
      return reads === 2;
    });
    await settled(secretKey);

    expect(getLatestSpy).toHaveBeenCalledTimes(2);
    expect(evaluationsOf(secretKey)).toEqual([2]);
    expect(await isStored(secretKey)).toBe(false);
  });

  /*
   * Concurrent requests race to the store; the one stored last is the
   * newest, and it is the one evaluated. Every store write goes over the one
   * Redis connection, in call order, so the last call is the last write.
   */
  test("a burst of concurrent requests: the last one stored is evaluated, once", async () => {
    const secretKey: string = newMonitor();
    const storedOrder: Array<number> = [];
    const store: typeof IncomingRequestLatestPayloadStore.store =
      IncomingRequestLatestPayloadStore.store.bind(
        IncomingRequestLatestPayloadStore,
      );

    jest
      .spyOn(IncomingRequestLatestPayloadStore, "store")
      .mockImplementation(
        (
          data: Parameters<typeof IncomingRequestLatestPayloadStore.store>[0],
        ) => {
          storedOrder.push(
            (data.payload.requestBody as JSONObject)["sequence"] as number,
          );
          return store(data);
        },
      );

    await Promise.all(
      Array.from({ length: 20 }, (_value: unknown, index: number) => {
        return send(secretKey, index + 1);
      }),
    );

    const jobs: MonitorJobs = await jobsOf(secretKey);
    expect(jobs.waiting).toHaveLength(1);
    expect(jobs.active).toHaveLength(0);
    expect(storedOrder).toHaveLength(20);

    startWorker();
    await settled(secretKey);

    expect(evaluationsOf(secretKey)).toEqual([storedOrder[19]]);
    expect(await isStored(secretKey)).toBe(false);
  });

  test("a burst while the monitor's job runs: one more evaluation, of the last request stored", async () => {
    const secretKey: string = newMonitor();
    const release: () => void = hold(secretKey, 0);
    const storedOrder: Array<number> = [];
    const store: typeof IncomingRequestLatestPayloadStore.store =
      IncomingRequestLatestPayloadStore.store.bind(
        IncomingRequestLatestPayloadStore,
      );

    startWorker();
    await send(secretKey, 0);
    await waitFor("the first evaluation to start", () => {
      return started.includes(`${secretKey}:0`);
    });

    jest
      .spyOn(IncomingRequestLatestPayloadStore, "store")
      .mockImplementation(
        (
          data: Parameters<typeof IncomingRequestLatestPayloadStore.store>[0],
        ) => {
          storedOrder.push(
            (data.payload.requestBody as JSONObject)["sequence"] as number,
          );
          return store(data);
        },
      );

    await Promise.all(
      Array.from({ length: 20 }, (_value: unknown, index: number) => {
        return send(secretKey, index + 1);
      }),
    );

    const jobs: MonitorJobs = await jobsOf(secretKey);
    expect(jobs.active).toHaveLength(1);
    expect(jobs.waiting).toHaveLength(0);

    release();
    await settled(secretKey);

    expect(evaluationsOf(secretKey)).toEqual([0, storedOrder[19]]);
    expect(await isStored(secretKey)).toBe(false);
  });
});
