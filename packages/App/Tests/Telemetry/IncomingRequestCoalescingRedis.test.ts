/*
 * Same-monitor coalescing of Incoming Request ingest, against a real Redis
 * and real BullMQ: which requests a monitor evaluates, and in what order,
 * when they arrive while its job is waiting, running, or delayed for a retry
 * - and what a flood from one sender does to it and to other monitors.
 *
 * Every request is kept in its monitor's list (IncomingRequestPendingStore)
 * and the monitor has one job at a time (BullMQ deduplication,
 * keepLastIfActive), which works through the list:
 *
 *   - a monitor whose criteria group by a payload field evaluates every
 *     request, in the order they arrived (#10582): each is about another
 *     value, and a skipped one is an alert that never opens or never
 *     resolves;
 *   - any other evaluates only its newest, as before: the older ones are
 *     superseded.
 *
 * The enqueue path (TelemetryQueueService, the Queue wrapper, BullMQ's Lua,
 * IncomingRequestPendingStore's Lua) and the worker's entry point run for
 * real here, on a queue of this suite's own. Only the monitor lookup and
 * the evaluation are stubbed, so a test can see which request was evaluated,
 * hold an evaluation open, or fail one. IncomingRequestEveryRequest.test.ts
 * runs the real route and the real evaluation.
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
      findOneById: jest.fn(),
      // The key's lookup, by its value, through findOneBy above (#9012).
      findOneByPresentedKey: (
        jest.requireActual("./Helpers/PresentedKeyByValue") as {
          default: unknown;
        }
      ).default,
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

/*
 * A project's incoming request secret requirement (IncomingRequestSecretGate)
 * is not what this suite is about: every request counts, as it did before
 * projects could require a secret. IncomingRequestSecretEndpoint.test.ts and
 * IncomingRequestSecretWorker.test.ts cover the requirement.
 */
jest.mock("Common/Server/Utils/Monitor/IncomingRequestSecretGate", () => {
  return {
    __esModule: true,
    default: {
      decideAtEdge: async (): Promise<{ mayRecordArrival: boolean }> => {
        return { mayRecordArrival: true };
      },
      decideInWorker: async (data: {
        requestHeaders?: Record<string, string> | undefined;
      }): Promise<{
        verdict: string;
        isRefused: boolean;
        requestHeaders: Record<string, string>;
      }> => {
        return {
          verdict: "NotRequired",
          isRefused: false,
          requestHeaders: data.requestHeaders || {},
        };
      },
    },
  };
});

import TelemetryQueueService, {
  TelemetryIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import {
  MAX_ATTEMPTS_PER_REQUEST,
  MAX_REQUESTS_PER_JOB,
  processPendingIncomingRequestsFromQueue,
} from "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import IncomingRequestPendingStore, {
  MAX_PENDING_REQUESTS_PER_MONITOR,
} from "../../FeatureSet/Telemetry/Utils/IncomingRequestPendingStore";
import Queue, { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil, {
  MonitorResourceOptions,
  SkippedIncomingRequestsNote,
} from "Common/Server/Utils/Monitor/MonitorResource";
import { isNonActionableIngestError } from "Common/Server/Utils/Monitor/NonActionableIngestError";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
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
const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;

let queue: BullQueue;
const workers: Array<BullWorker> = [];
const secretKeys: Array<string> = [];
// The monitors whose criteria group by a payload field.
const grouped: Set<string> = new Set<string>();

// Every evaluation that started, as "<secretKey>:<sequence>", in order.
let started: Array<string> = [];
// The sequence numbers each monitor evaluated successfully, in order.
let evaluated: Map<string, Array<number>> = new Map();
// What each evaluation was told was skipped before it, by its key.
let skippedBefore: Map<string, SkippedIncomingRequestsNote> = new Map();
// Evaluations to hold open until released, to fail once, to fail always.
let held: Map<string, Promise<void>> = new Map();
let failOnce: Map<string, Error> = new Map();
let failAlways: Map<string, Error> = new Map();

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

function newMonitor(options: { grouped: boolean }): string {
  const secretKey: string = ObjectID.generate().toString();
  secretKeys.push(secretKey);

  if (options.grouped) {
    grouped.add(secretKey);
  }

  return secretKey;
}

function hashOf(secretKey: string): string {
  return IncomingRequestPendingStore.getSecretKeyHash(secretKey);
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

async function sendAll(
  secretKey: string,
  from: number,
  to: number,
): Promise<void> {
  for (let sequence: number = from; sequence <= to; sequence++) {
    await send(secretKey, sequence);
  }
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

function startsOf(secretKey: string): Array<number> {
  return started
    .filter((key: string) => {
      return key.startsWith(`${secretKey}:`);
    })
    .map((key: string) => {
      return Number(key.split(":")[1]);
    });
}

function range(from: number, to: number): Array<number> {
  return Array.from({ length: to - from + 1 }, (_value: unknown, i: number) => {
    return from + i;
  });
}

function isJobOf(job: QueueJob | undefined, secretKey: string): boolean {
  return (
    (job?.data as TelemetryIngestJobData | undefined)?.incomingRequestPending
      ?.secretKeyHash === hashOf(secretKey)
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

/*
 * Nothing of the monitor's is waiting, running or delayed. All three states
 * come from one snapshot (getJobs reads them in a single Lua call): read one
 * at a time, a job moving from waiting to running between two reads would be
 * in neither, and the monitor would look settled before its job had run.
 */
async function settled(
  secretKey: string,
  timeoutInMs: number = 10000,
): Promise<void> {
  await waitFor(
    "the monitor's jobs to finish",
    async () => {
      const live: Array<QueueJob | undefined> = await queue.getJobs([
        "active",
        "waiting",
        "delayed",
      ]);

      return !live.some((job: QueueJob | undefined) => {
        return isJobOf(job, secretKey);
      });
    },
    timeoutInMs,
  );
}

async function isAnythingKept(secretKey: string): Promise<boolean> {
  const client: ClientType = Redis.getClient()!;

  return (
    (await client.exists(
      IncomingRequestPendingStore.getListKey(hashOf(secretKey)),
      IncomingRequestPendingStore.getRequestsKey(hashOf(secretKey)),
    )) > 0
  );
}

function monitorOf(secretKey: string): Monitor {
  const monitor: Monitor = new Monitor();
  // One monitor per secret key; its id is the key, to tell them apart.
  monitor._id = secretKey;
  monitor.projectId = new ObjectID("4c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19");
  monitor.monitorType = MonitorType.IncomingRequest;
  monitor.isArchived = false;
  monitor.disableActiveMonitoring = false;
  monitor.disableActiveMonitoringBecauseOfManualIncident = false;
  monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;

  const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  if (grouped.has(secretKey)) {
    criteria.data = {
      ...criteria.data!,
      incidentGrouping: {
        groupByJSONPath: "requestBody.alertActiveID",
        resolvedWhenJSONPath: "requestBody.status",
        resolvedWhenValue: "resolved",
      },
    };
  }

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: [criteria] };

  const step: MonitorStep = new MonitorStep();
  step.data!.monitorCriteria = monitorCriteria;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ObjectID.generate(),
  };
  monitor.monitorSteps = monitorSteps;

  return monitor;
}

/*
 * The worker runs the waiting-requests case of the telemetry worker
 * (ProcessTelemetry), one job at a time unless a test asks for more, so the
 * order is predictable. A refusal of the monitor completes the job, as there.
 */
function startWorker(concurrency: number = 1): BullWorker {
  // As a started server does: its workers take jobs (QueueWorker).
  QueueWorker.startProcessingJobs();

  const worker: BullWorker = QueueWorker.getWorker(
    QueueName.Telemetry,
    async (job: QueueJob): Promise<void> => {
      const data: TelemetryIngestJobData = job.data as TelemetryIngestJobData;

      try {
        await processPendingIncomingRequestsFromQueue(
          data.incomingRequestPending!,
          {
            isFinalAttempt:
              (Number(job.attemptsMade) || 0) + 1 >=
              (Number(job.opts?.attempts) || 1),
          },
        );
      } catch (err) {
        if (isNonActionableIngestError(err)) {
          return;
        }

        throw err;
      }
    },
    { concurrency: concurrency },
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
      ...secretKeys.flatMap((secretKey: string): Array<string> => {
        return [
          IncomingRequestPendingStore.getListKey(hashOf(secretKey)),
          IncomingRequestPendingStore.getRequestsKey(hashOf(secretKey)),
        ];
      }),
    );
  }

  await Redis.disconnect();
});

beforeEach(() => {
  started = [];
  evaluated = new Map();
  skippedBefore = new Map();
  held = new Map();
  failOnce = new Map();
  failAlways = new Map();

  findOneBy.mockImplementation((async (args: {
    query: { incomingRequestSecretKey: ObjectID };
  }) => {
    return monitorOf(args.query.incomingRequestSecretKey.toString());
  }) as never);

  findOneById.mockImplementation((async (args: { id: ObjectID }) => {
    return monitorOf(args.id.toString());
  }) as never);

  monitorResource.mockImplementation((async (
    request: IncomingMonitorRequest,
    options?: MonitorResourceOptions,
  ) => {
    const secretKey: string = request.monitorId.toString();
    const sequence: number = (request.requestBody as JSONObject)[
      "sequence"
    ] as number;
    const key: string = `${secretKey}:${sequence}`;

    started.push(key);

    const failure: Error | undefined = failOnce.get(key) || failAlways.get(key);

    if (failure) {
      failOnce.delete(key);
      throw failure;
    }

    await held.get(key);

    if (options?.skippedIncomingRequests) {
      skippedBefore.set(key, options.skippedIncomingRequests);
    }

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

describe("a monitor without grouping evaluates its newest request, as before", () => {
  /*
   * The production case. Five requests arrive while the monitor's job waits
   * in a backlog: BullMQ keeps one job, and it evaluates the newest.
   */
  test("requests that arrive while the monitor's job waits: the newest is evaluated, once", async () => {
    const secretKey: string = newMonitor({ grouped: false });

    await sendAll(secretKey, 1, 5);

    const jobs: MonitorJobs = await jobsOf(secretKey);

    // At most one job per monitor, whatever the sender does.
    expect(jobs.active).toHaveLength(0);
    expect(jobs.waiting).toHaveLength(1);

    startWorker();
    await settled(secretKey);

    expect(evaluationsOf(secretKey)).toEqual([5]);
    expect(await isAnythingKept(secretKey)).toBe(false);
  });

  test("requests that arrive while the monitor's job runs: the newest is evaluated after it", async () => {
    const secretKey: string = newMonitor({ grouped: false });
    const release: () => void = hold(secretKey, 1);

    startWorker();
    await send(secretKey, 1);
    await waitFor("the first evaluation to start", () => {
      return started.includes(`${secretKey}:1`);
    });

    await sendAll(secretKey, 2, 4);

    // The next job is held by BullMQ until the running one finishes.
    const jobs: MonitorJobs = await jobsOf(secretKey);
    expect(jobs.active).toHaveLength(1);
    expect(jobs.waiting).toHaveLength(0);

    release();
    await settled(secretKey);

    expect(evaluationsOf(secretKey)).toEqual([1, 4]);
    expect(await isAnythingKept(secretKey)).toBe(false);
  });

  test("a burst of concurrent requests: the last one kept is evaluated, once", async () => {
    const secretKey: string = newMonitor({ grouped: false });
    const keptOrder: Array<number> = [];
    const push: typeof IncomingRequestPendingStore.push =
      IncomingRequestPendingStore.push.bind(IncomingRequestPendingStore);

    jest
      .spyOn(IncomingRequestPendingStore, "push")
      .mockImplementation(
        async (
          data: Parameters<typeof IncomingRequestPendingStore.push>[0],
        ) => {
          const result: Awaited<ReturnType<typeof push>> = await push(data);
          keptOrder.push(
            (data.payload.requestBody as JSONObject)["sequence"] as number,
          );
          return result;
        },
      );

    await Promise.all(
      range(1, 20).map((sequence: number) => {
        return send(secretKey, sequence);
      }),
    );

    expect((await jobsOf(secretKey)).waiting).toHaveLength(1);

    startWorker();
    await settled(secretKey);

    expect(keptOrder).toHaveLength(20);
    expect(evaluationsOf(secretKey)).toEqual([keptOrder[19]]);
  });

  /*
   * A failed evaluation is retried after a backoff (5 seconds for the first
   * retry), with the job delayed meanwhile; requests that arrive then wait
   * for it. The retry evaluates the newest.
   */
  test("requests that arrive while the monitor's job waits to be retried: the retry evaluates the newest", async () => {
    const secretKey: string = newMonitor({ grouped: false });
    failOnce.set(`${secretKey}:1`, new Error("Acquire mutex timeout"));

    startWorker();
    await send(secretKey, 1);

    await waitFor("the first attempt to fail into a retry", async () => {
      return (await jobsOf(secretKey)).delayed.length === 1;
    });

    // Not evaluated, so still kept for the retry.
    expect(await isAnythingKept(secretKey)).toBe(true);

    await sendAll(secretKey, 2, 3);

    const jobs: MonitorJobs = await jobsOf(secretKey);
    expect(jobs.delayed).toHaveLength(1);
    expect(jobs.waiting).toHaveLength(0);
    expect(jobs.active).toHaveLength(0);

    await settled(secretKey, 20000);

    expect(startsOf(secretKey)).toEqual([1, 3]);
    expect(evaluationsOf(secretKey)).toEqual([3]);
    expect(await isAnythingKept(secretKey)).toBe(false);
  }, 30000);
});

describe("a monitor that groups by a payload field evaluates every request, in order", () => {
  test("requests that arrive while the monitor's job waits: every one is evaluated, in the order they arrived, once", async () => {
    const secretKey: string = newMonitor({ grouped: true });

    await sendAll(secretKey, 1, 5);

    // Still one job for the monitor, however many requests.
    expect((await jobsOf(secretKey)).waiting).toHaveLength(1);

    startWorker();
    await settled(secretKey);

    expect(evaluationsOf(secretKey)).toEqual([1, 2, 3, 4, 5]);
    expect(startsOf(secretKey)).toEqual([1, 2, 3, 4, 5]);
    expect(await isAnythingKept(secretKey)).toBe(false);
  });

  test("requests that arrive while the monitor's job runs are evaluated after it, in order", async () => {
    const secretKey: string = newMonitor({ grouped: true });
    const release: () => void = hold(secretKey, 1);

    startWorker();
    await send(secretKey, 1);
    await waitFor("the first evaluation to start", () => {
      return started.includes(`${secretKey}:1`);
    });

    await sendAll(secretKey, 2, 4);

    release();
    await settled(secretKey);

    expect(evaluationsOf(secretKey)).toEqual([1, 2, 3, 4]);
    expect(await isAnythingKept(secretKey)).toBe(false);
  });

  test("a burst of concurrent requests: every one is evaluated, in the order they were kept", async () => {
    const secretKey: string = newMonitor({ grouped: true });
    const keptOrder: Array<number> = [];
    const push: typeof IncomingRequestPendingStore.push =
      IncomingRequestPendingStore.push.bind(IncomingRequestPendingStore);

    jest
      .spyOn(IncomingRequestPendingStore, "push")
      .mockImplementation(
        async (
          data: Parameters<typeof IncomingRequestPendingStore.push>[0],
        ) => {
          const result: Awaited<ReturnType<typeof push>> = await push(data);
          keptOrder.push(
            (data.payload.requestBody as JSONObject)["sequence"] as number,
          );
          return result;
        },
      );

    startWorker();

    await Promise.all(
      range(1, 30).map((sequence: number) => {
        return send(secretKey, sequence);
      }),
    );

    await settled(secretKey);

    expect(keptOrder).toHaveLength(30);
    expect(evaluationsOf(secretKey)).toEqual(keptOrder);
  });

  /*
   * A failure leaves the request where it is, at the head of the list: the
   * job is retried after a backoff, and the requests after it wait behind it
   * rather than overtake it.
   */
  test("a failed evaluation is tried again before the requests after it", async () => {
    const secretKey: string = newMonitor({ grouped: true });
    failOnce.set(`${secretKey}:2`, new Error("Acquire mutex timeout"));

    await sendAll(secretKey, 1, 4);

    startWorker();
    await settled(secretKey, 20000);

    expect(startsOf(secretKey)).toEqual([1, 2, 2, 3, 4]);
    expect(evaluationsOf(secretKey)).toEqual([1, 2, 3, 4]);
    expect(await isAnythingKept(secretKey)).toBe(false);
  }, 30000);

  /*
   * One that can never be evaluated is tried MAX_ATTEMPTS_PER_REQUEST times
   * (the job's own retries, 5 and 10 seconds apart), then skipped, so it
   * holds the monitor's later requests up no longer - and the next
   * evaluation's log says one was skipped.
   */
  test(`a request that fails ${MAX_ATTEMPTS_PER_REQUEST} times is skipped, the next evaluation says so, and the rest go on in order`, async () => {
    const secretKey: string = newMonitor({ grouped: true });
    failAlways.set(`${secretKey}:2`, new Error("Unexpected payload"));

    await sendAll(secretKey, 1, 4);

    startWorker();
    await settled(secretKey, 30000);

    expect(startsOf(secretKey)).toEqual([1, 2, 2, 2, 3, 4]);
    expect(evaluationsOf(secretKey)).toEqual([1, 3, 4]);
    expect(skippedBefore.get(`${secretKey}:3`)).toEqual({
      overLimit: 0,
      afterFailures: 1,
      attempts: MAX_ATTEMPTS_PER_REQUEST,
    });
    // Said once.
    expect(skippedBefore.get(`${secretKey}:4`)).toBeUndefined();
    expect(await isAnythingKept(secretKey)).toBe(false);
  }, 45000);

  /*
   * A monitor that is not being monitored - deleted, archived, disabled,
   * paused - refuses every request alike: one refusal settles them all, and
   * the job completes, as a job of its own did.
   */
  test("a monitor that refuses a request refuses every request waiting for it", async () => {
    const secretKey: string = newMonitor({ grouped: true });
    failOnce.set(
      `${secretKey}:1`,
      new BadDataException(ExceptionMessages.MonitorDisabled),
    );

    await sendAll(secretKey, 1, 5);

    startWorker();
    await settled(secretKey);

    expect(startsOf(secretKey)).toEqual([1]);
    expect(evaluationsOf(secretKey)).toEqual([]);
    expect(await isAnythingKept(secretKey)).toBe(false);
  });

  /*
   * Whether a monitor evaluates every request is read from the monitor
   * itself, whenever more than one is waiting - never a flag kept from
   * earlier: grouping turned on applies to the next burst.
   */
  test("a monitor whose grouping is turned on evaluates every request of its next burst", async () => {
    const secretKey: string = newMonitor({ grouped: false });

    await sendAll(secretKey, 1, 3);
    startWorker();
    await settled(secretKey);

    expect(evaluationsOf(secretKey)).toEqual([3]);

    grouped.add(secretKey);

    await workers.splice(0)[0]!.close();
    await sendAll(secretKey, 4, 7);
    startWorker();
    await settled(secretKey);

    expect(evaluationsOf(secretKey)).toEqual([3, 4, 5, 6, 7]);
  });
});

describe("a flood from one sender", () => {
  /*
   * Past MAX_PENDING_REQUESTS_PER_MONITOR waiting, the oldest waiting are
   * skipped - never the oldest of all, which a job may be evaluating, nor
   * the newest - and the first evaluation after says how many, so none is
   * dropped in silence.
   */
  test(`more than ${MAX_PENDING_REQUESTS_PER_MONITOR} waiting: the oldest waiting are skipped, the next evaluation says how many, and the rest are evaluated in order`, async () => {
    const secretKey: string = newMonitor({ grouped: true });
    const extra: number = 30;
    const total: number = MAX_PENDING_REQUESTS_PER_MONITOR + extra;

    await sendAll(secretKey, 1, total);

    // However many requests, one job.
    expect((await jobsOf(secretKey)).waiting).toHaveLength(1);

    startWorker();
    await settled(secretKey, 60000);

    // Requests 2 to 31 were skipped to stay within the limit.
    expect(evaluationsOf(secretKey)).toEqual([1, ...range(extra + 2, total)]);
    expect(skippedBefore.get(`${secretKey}:1`)).toEqual({
      overLimit: extra,
      afterFailures: 0,
      attempts: MAX_ATTEMPTS_PER_REQUEST,
    });
    expect(skippedBefore.size).toBe(1);
    expect(await isAnythingKept(secretKey)).toBe(false);
  }, 90000);

  /*
   * A job evaluates at most MAX_REQUESTS_PER_JOB requests, then queues its
   * monitor's job again, behind every job already waiting. With one worker
   * slot, another monitor's request is evaluated after at most that many of
   * the flood's, not after all of them.
   */
  test("another monitor's request is evaluated after at most one job's worth of the flood", async () => {
    const flooded: string = newMonitor({ grouped: true });
    const other: string = newMonitor({ grouped: true });
    const flood: number = MAX_REQUESTS_PER_JOB * 2 + 50;

    await sendAll(flooded, 1, flood);
    await send(other, 1);

    startWorker();
    await settled(flooded, 60000);
    await settled(other);

    expect(evaluationsOf(flooded)).toEqual(range(1, flood));
    expect(evaluationsOf(other)).toEqual([1]);

    const otherAt: number = started.indexOf(`${other}:1`);

    expect(otherAt).toBe(MAX_REQUESTS_PER_JOB);
    expect(started.slice(0, otherAt)).toEqual(
      range(1, MAX_REQUESTS_PER_JOB).map((sequence: number) => {
        return `${flooded}:${sequence}`;
      }),
    );
  }, 90000);

  /*
   * Several workers - as several pods run - still evaluate one monitor's
   * requests one at a time: BullMQ holds one job per monitor.
   */
  test("with many worker slots, a monitor's requests are still evaluated one at a time, in order", async () => {
    const secretKey: string = newMonitor({ grouped: true });
    let inFlight: number = 0;
    let mostInFlight: number = 0;

    const evaluate: (
      request: IncomingMonitorRequest,
      options?: MonitorResourceOptions,
    ) => Promise<unknown> = monitorResource.getMockImplementation() as never;

    monitorResource.mockImplementation((async (
      request: IncomingMonitorRequest,
      options?: MonitorResourceOptions,
    ) => {
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await sleep(2);

      try {
        return await evaluate(request, options);
      } finally {
        inFlight--;
      }
    }) as never);

    startWorker(5);
    startWorker(5);

    // Sent one after another while the workers run.
    await sendAll(secretKey, 1, 60);

    await settled(secretKey, 30000);

    expect(mostInFlight).toBe(1);
    expect(evaluationsOf(secretKey)).toEqual(range(1, 60));
  }, 45000);
});
