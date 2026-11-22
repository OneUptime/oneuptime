/*
 * Random interleavings of same-monitor coalescing of Incoming Request
 * ingest, against a model of BullMQ's deduplication.
 *
 * IncomingRequestCoalescingRedis.test.ts runs hand-picked schedules on a real
 * Redis and BullMQ. This suite runs a hundred and fifty seeded random
 * schedules on the real enqueue path
 * (TelemetryQueueService.addIncomingRequestIngestJob) and the real worker
 * entry point (processPendingIncomingRequestsFromQueue). Every call they make
 * outward - the queue add, each operation on a monitor's waiting requests,
 * the monitor lookup, the evaluation, the job's completion - is a point at
 * which any other request, worker, retry or Redis reply may go first.
 *
 * The queue is a model of what BullMQ 5.76's Lua does with
 * deduplication { id, keepLastIfActive: true } and no ttl:
 *
 *   - add: when no job holds the id, a new waiting job holds it. When the
 *     holder is ACTIVE, the add is kept as the next job, and a later add
 *     replaces it. When the holder is waiting or delayed, the add is dropped.
 *   - a job completes or fails for good: it stops holding the id, and a kept
 *     next job is queued (waiting) as the new holder.
 *   - an attempt fails with attempts left: the job is delayed and queued
 *     again later, still holding the id.
 *
 * The monitors' waiting requests are an in-memory model with the same
 * atomic operations as IncomingRequestPendingStore's Lua. Half the monitors
 * group by a payload field, half do not. In every schedule:
 *
 *   - a monitor never has more than one job (waiting, delayed or running)
 *     plus the next job BullMQ keeps for it,
 *   - a grouped monitor evaluates every request it was sent, each once, in
 *     the order they were kept (#10582),
 *   - a monitor without grouping never evaluates a request kept earlier
 *     than one it has already evaluated, nor any request twice, and the
 *     request kept last for it is the last one it evaluates,
 *   - once everything has drained, nothing is left waiting.
 *
 * Run with jobs that evaluate only the newest of a grouped monitor's
 * requests - the behaviour before #10582 - the same schedules lose requests.
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

jest.mock(
  "../../FeatureSet/Telemetry/Utils/IncomingRequestPendingStore",
  () => {
    return {
      __esModule: true,
      default: {
        getSecretKeyHash: (secretKey: string): string => {
          return `hash-of-${secretKey}`;
        },
        push: jest.fn(),
        peekOldest: jest.fn(),
        peekNewest: jest.fn(),
        remove: jest.fn(),
        skipAfterFailures: jest.fn(),
        removeThrough: jest.fn(),
        countFailure: jest.fn(),
        acknowledgeSkipped: jest.fn(),
        hasPending: jest.fn(),
      },
    };
  },
);

jest.mock("Common/Server/Utils/Monitor/MonitorSecretKeyCache", () => {
  return {
    __esModule: true,
    MonitorSecretKeyKind: {
      IncomingRequest: "IncomingRequest",
    },
    default: {
      getMonitor: jest.fn(async () => {
        return null;
      }),
      setMonitor: jest.fn(async () => {}),
      forget: jest.fn(async () => {}),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
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

jest.mock("Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore", () => {
  return {
    __esModule: true,
    default: {
      track: jest.fn(),
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
  IncomingRequestIngestJobData,
  IncomingRequestPendingJobData,
  TelemetryIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import {
  processIncomingRequestFromQueue,
  processPendingIncomingRequestsFromQueue,
} from "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import IncomingRequestPendingStore, {
  PendingIncomingRequest,
  SkippedIncomingRequests,
} from "../../FeatureSet/Telemetry/Utils/IncomingRequestPendingStore";
import { isNonActionableIngestError } from "Common/Server/Utils/Monitor/NonActionableIngestError";
import Queue from "Common/Server/Infrastructure/Queue";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "Common/Tests/Helpers/SeededRandom";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";

const GROUPED_MONITORS: number = 2;
const UNGROUPED_MONITORS: number = 2;
const REQUESTS_PER_MONITOR: number = 6;
const WORKER_CONCURRENCY: number = 2;
// The Telemetry queue's attempts per job (Queue.addJob's default for it).
const ATTEMPTS: number = 3;
const FAILURE_RATE: number = 0.2;
const SCHEDULES: number = 150;
const NEWEST_ONLY_SCHEDULES: number = 60;

type Processor = (
  jobData: IncomingRequestPendingJobData,
  options: { isFinalAttempt: boolean },
) => Promise<void>;

type JobState = "waiting" | "active" | "delayed" | "done";

interface ModelJob {
  id: string;
  deduplicationId: string | undefined;
  data: TelemetryIngestJobData;
  state: JobState;
  attemptsMade: number;
}

// One monitor's waiting requests, as IncomingRequestPendingStore keeps them.
interface ModelList {
  ids: Array<string>;
  payloads: Map<string, string>;
  failures: Map<string, number>;
  skipped: SkippedIncomingRequests;
}

interface ScheduleReport {
  violations: Array<string>;
  // Per monitor: the requests in the order they were kept.
  kept: Map<string, Array<number>>;
  // Per monitor: the requests it evaluated, in order.
  evaluated: Map<string, Array<number>>;
  leftWaiting: number;
}

// BullMQ serializes job data and Redis keeps strings; so does the model.
function viaJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sequenceOf(body: unknown): number {
  return (body as JSONObject)["sequence"] as number;
}

class DeduplicatingQueueModel {
  public readonly jobs: Map<string, ModelJob> = new Map();
  public readonly delayed: Array<string> = [];
  // deduplication id -> data of the next job, kept while the holder runs.
  public readonly nextJobs: Map<string, TelemetryIngestJobData> = new Map();
  private readonly waiting: Array<string> = [];
  // deduplication id -> the id of the job holding it.
  private readonly holders: Map<string, string> = new Map();
  private requeued: number = 0;

  public add(
    jobId: string,
    data: TelemetryIngestJobData,
    deduplicationId: string | undefined,
  ): void {
    if (deduplicationId) {
      const holderId: string | undefined = this.holders.get(deduplicationId);

      if (holderId) {
        if (this.jobs.get(holderId)!.state === "active") {
          this.nextJobs.set(deduplicationId, viaJson(data));
        }

        return;
      }

      this.holders.set(deduplicationId, jobId);
    }

    this.enqueue(jobId, data, deduplicationId);
  }

  public hasWaiting(): boolean {
    return this.waiting.length > 0;
  }

  public takeNext(): ModelJob {
    const job: ModelJob = this.jobs.get(this.waiting.shift()!)!;
    job.state = "active";
    return job;
  }

  // Completed, or failed with no attempts left.
  public finish(job: ModelJob): void {
    job.state = "done";

    if (!job.deduplicationId) {
      return;
    }

    if (this.holders.get(job.deduplicationId) === job.id) {
      this.holders.delete(job.deduplicationId);
    }

    const next: TelemetryIngestJobData | undefined = this.nextJobs.get(
      job.deduplicationId,
    );

    if (next) {
      this.nextJobs.delete(job.deduplicationId);
      this.requeued++;
      const nextId: string = `requeued-${this.requeued}`;
      this.holders.set(job.deduplicationId, nextId);
      this.enqueue(nextId, next, job.deduplicationId);
    }
  }

  public retryLater(job: ModelJob): void {
    job.state = "delayed";
    this.delayed.push(job.id);
  }

  public promote(index: number): void {
    const [jobId]: Array<string> = this.delayed.splice(index, 1);
    const job: ModelJob = this.jobs.get(jobId!)!;
    job.state = "waiting";
    this.waiting.push(job.id);
  }

  public liveJobsOf(secretKey: string): Array<ModelJob> {
    return Array.from(this.jobs.values()).filter((job: ModelJob) => {
      return job.state !== "done" && secretKeyOf(job) === secretKey;
    });
  }

  private enqueue(
    jobId: string,
    data: TelemetryIngestJobData,
    deduplicationId: string | undefined,
  ): void {
    this.jobs.set(jobId, {
      id: jobId,
      deduplicationId: deduplicationId,
      data: viaJson(data),
      state: "waiting",
      attemptsMade: 0,
    });
    this.waiting.push(jobId);
  }
}

const addJob: jest.Mock = Queue.addJob as unknown as jest.Mock;
const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const track: jest.Mock =
  IncomingRequestReceivedAtStore.track as unknown as jest.Mock;

function storeMock(name: keyof typeof IncomingRequestPendingStore): jest.Mock {
  return IncomingRequestPendingStore[name] as unknown as jest.Mock;
}

const groupedKeys: Array<string> = Array.from(
  { length: GROUPED_MONITORS },
  (_value: unknown, index: number) => {
    return `00000000-0000-4000-8000-00000000001${index + 1}`;
  },
);

const ungroupedKeys: Array<string> = Array.from(
  { length: UNGROUPED_MONITORS },
  (_value: unknown, index: number) => {
    return `00000000-0000-4000-8000-00000000002${index + 1}`;
  },
);

const secretKeys: Array<string> = [...groupedKeys, ...ungroupedKeys];

function hashOf(secretKey: string): string {
  return IncomingRequestPendingStore.getSecretKeyHash(secretKey);
}

function secretKeyOf(job: ModelJob): string {
  const hash: string | undefined =
    job.data.incomingRequestPending?.secretKeyHash;

  return (
    secretKeys.find((secretKey: string) => {
      return hashOf(secretKey) === hash;
    }) || ""
  );
}

function monitorOf(secretKey: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = secretKey;
  monitor.projectId = new ObjectID("4c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19");
  monitor.monitorType = MonitorType.IncomingRequest;
  monitor.isArchived = false;
  monitor.disableActiveMonitoring = false;
  monitor.disableActiveMonitoringBecauseOfManualIncident = false;
  monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;

  const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  if (groupedKeys.includes(secretKey)) {
    criteria.data = {
      ...criteria.data!,
      incidentGrouping: { groupByJSONPath: "requestBody.alertActiveID" },
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
 * The state of the schedule being run. The mocks are wired once and read
 * it, so a schedule only has to replace it.
 */
let random: SeededRandom = seededRandom(0);
let points: Array<() => void> = [];
let model: DeduplicatingQueueModel = new DeduplicatingQueueModel();
let lists: Map<string, ModelList> = new Map();
let report: ScheduleReport = {
  violations: [],
  kept: new Map(),
  evaluated: new Map(),
  leftWaiting: 0,
};
// The step at which the running attempt of a monitor's job fails, if it does.
let failing: Map<string, "read" | "evaluate"> = new Map();
// Requests whose evaluation has failed once: none fails twice.
let failedOnce: Set<string> = new Set();

/*
 * Where control may pass to anything else: the caller resumes only when the
 * schedule picks this point.
 */
function point(): Promise<void> {
  return new Promise<void>((resume: () => void) => {
    points.push(resume);
  });
}

// Lets everything that was resumed run until it reaches its next point.
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

function listOf(hash: string): ModelList {
  if (!lists.has(hash)) {
    lists.set(hash, {
      ids: [],
      payloads: new Map(),
      failures: new Map(),
      skipped: { overLimit: 0, afterFailures: 0 },
    });
  }

  return lists.get(hash)!;
}

function keptOf(secretKey: string): Array<number> {
  if (!report.kept.has(secretKey)) {
    report.kept.set(secretKey, []);
  }

  return report.kept.get(secretKey)!;
}

function evaluatedOf(secretKey: string): Array<number> {
  if (!report.evaluated.has(secretKey)) {
    report.evaluated.set(secretKey, []);
  }

  return report.evaluated.get(secretKey)!;
}

function readRequest(
  list: ModelList,
  index: number,
): PendingIncomingRequest | null {
  const requestId: string | undefined =
    index === 0 ? list.ids[0] : list.ids[list.ids.length - 1];

  if (!requestId) {
    return null;
  }

  return {
    requestId: requestId,
    payload: JSON.parse(
      list.payloads.get(requestId)!,
    ) as IncomingRequestIngestJobData,
    failures: list.failures.get(requestId) || 0,
    waiting: list.ids.length,
    skipped: { ...list.skipped },
  };
}

function forget(list: ModelList, requestId: string): boolean {
  const index: number = list.ids.indexOf(requestId);

  list.payloads.delete(requestId);
  list.failures.delete(requestId);

  if (index < 0) {
    return false;
  }

  list.ids.splice(index, 1);
  return true;
}

function checkJobsPerMonitor(): void {
  for (const secretKey of secretKeys) {
    const live: number = model.liveJobsOf(secretKey).length;
    const next: number = model.nextJobs.has(
      TelemetryQueueService.getIncomingRequestPendingDeduplicationId(
        hashOf(secretKey),
      ),
    )
      ? 1
      : 0;

    if (live > 1 || live + next > 2) {
      report.violations.push(
        `${secretKey} had ${live} jobs and ${next} next job at once`,
      );
    }
  }
}

function wireMocks(): void {
  addJob.mockImplementation((async (
    _queueName: string,
    jobId: string,
    _jobName: string,
    data: TelemetryIngestJobData,
    options?: { deduplication?: { id: string } },
  ): Promise<void> => {
    await point();
    model.add(jobId, data, options?.deduplication?.id);
    await point();
  }) as never);

  storeMock("push").mockImplementation((async (data: {
    secretKey: string;
    requestId: string;
    payload: IncomingRequestIngestJobData;
  }) => {
    await point();
    const list: ModelList = listOf(hashOf(data.secretKey));
    list.ids.push(data.requestId);
    list.payloads.set(data.requestId, JSON.stringify(data.payload));
    keptOf(data.secretKey).push(sequenceOf(data.payload.requestBody));
    await point();
    return { waiting: list.ids.length, skipped: 0 };
  }) as never);

  for (const [name, index] of [
    ["peekOldest", 0],
    ["peekNewest", -1],
  ] as Array<["peekOldest" | "peekNewest", number]>) {
    storeMock(name).mockImplementation((async (hash: string) => {
      await point();

      const secretKey: string | undefined = secretKeys.find((key: string) => {
        return hashOf(key) === hash;
      });

      if (secretKey && failing.get(secretKey) === "read") {
        throw new Error("Redis connection reset");
      }

      const read: PendingIncomingRequest | null = readRequest(
        listOf(hash),
        index,
      );
      await point();
      return read;
    }) as never);
  }

  storeMock("remove").mockImplementation((async (
    hash: string,
    requestId: string,
  ) => {
    await point();
    const removed: boolean = forget(listOf(hash), requestId);
    await point();
    return removed;
  }) as never);

  storeMock("skipAfterFailures").mockImplementation((async (
    hash: string,
    requestId: string,
  ) => {
    await point();
    const list: ModelList = listOf(hash);
    const removed: boolean = forget(list, requestId);

    if (removed) {
      list.skipped.afterFailures++;
    }

    await point();
    return removed;
  }) as never);

  storeMock("removeThrough").mockImplementation((async (
    hash: string,
    requestId: string,
  ) => {
    await point();
    const list: ModelList = listOf(hash);
    const through: number = list.ids.indexOf(requestId) + 1;

    for (const id of list.ids.slice(0, through)) {
      forget(list, id);
    }

    await point();
    return through;
  }) as never);

  storeMock("countFailure").mockImplementation((async (
    hash: string,
    requestId: string,
  ) => {
    await point();
    const list: ModelList = listOf(hash);

    if (!list.payloads.has(requestId)) {
      return 0;
    }

    const failures: number = (list.failures.get(requestId) || 0) + 1;
    list.failures.set(requestId, failures);
    await point();
    return failures;
  }) as never);

  storeMock("acknowledgeSkipped").mockImplementation((async (
    hash: string,
    said: SkippedIncomingRequests,
  ) => {
    await point();
    const list: ModelList = listOf(hash);
    list.skipped.overLimit = Math.max(
      0,
      list.skipped.overLimit - said.overLimit,
    );
    list.skipped.afterFailures = Math.max(
      0,
      list.skipped.afterFailures - said.afterFailures,
    );
  }) as never);

  storeMock("hasPending").mockImplementation((async (hash: string) => {
    await point();
    return listOf(hash).ids.length > 0;
  }) as never);

  findOneBy.mockImplementation((async (args: {
    query: { incomingRequestSecretKey: ObjectID };
  }): Promise<Monitor> => {
    await point();
    return monitorOf(args.query.incomingRequestSecretKey.toString());
  }) as never);

  track.mockImplementation((async (input: {
    receivedAt: Date;
  }): Promise<Date> => {
    await point();
    return new Date(input.receivedAt);
  }) as never);

  monitorResource.mockImplementation((async (
    request: IncomingMonitorRequest,
  ): Promise<JSONObject> => {
    await point();
    const secretKey: string = request.monitorId.toString();
    const sequence: number = sequenceOf(request.requestBody);
    const requestKey: string = `${secretKey}:${sequence}`;

    if (failing.get(secretKey) === "evaluate" && !failedOnce.has(requestKey)) {
      failedOnce.add(requestKey);
      throw new Error("Acquire mutex timeout");
    }

    const kept: Array<number> = keptOf(secretKey);
    const evaluated: Array<number> = evaluatedOf(secretKey);
    const previous: number | undefined = evaluated[evaluated.length - 1];

    if (evaluated.includes(sequence)) {
      report.violations.push(
        `${secretKey} evaluated request ${sequence} twice`,
      );
    } else if (
      previous !== undefined &&
      kept.indexOf(sequence) < kept.indexOf(previous)
    ) {
      report.violations.push(
        `${secretKey} evaluated request ${sequence} after ${previous}, which was kept later`,
      );
    }

    evaluated.push(sequence);
    await point();
    return {};
  }) as never);
}

/*
 * One schedule: every monitor's requests are sent - concurrently, in a random
 * order across monitors - while workers take jobs, attempts fail and are
 * retried, and every pending point resumes in a random order.
 */
async function runSchedule(
  seed: number,
  processor: Processor,
): Promise<ScheduleReport> {
  random = seededRandom(seed);
  points = [];
  model = new DeduplicatingQueueModel();
  lists = new Map();
  failing = new Map();
  failedOnce = new Set();
  report = {
    violations: [],
    kept: new Map(),
    evaluated: new Map(),
    leftWaiting: 0,
  };

  // Which monitor each request goes to, shuffled...
  const requests: Array<string> = [];

  for (let i: number = 0; i < secretKeys.length * REQUESTS_PER_MONITOR; i++) {
    requests.push(secretKeys[i % secretKeys.length]!);
  }

  const order: Array<string> = shuffled(requests, random);

  // ...and numbered per monitor in the order they are sent.
  const toSend: Array<{ secretKey: string; sequence: number }> = [];
  const sentSoFar: Map<string, number> = new Map();

  for (const secretKey of order) {
    const sequence: number = (sentSoFar.get(secretKey) || 0) + 1;
    sentSoFar.set(secretKey, sequence);
    toSend.push({ secretKey, sequence });
  }

  let running: number = 0;

  const send: () => void = (): void => {
    const request: { secretKey: string; sequence: number } = toSend.shift()!;

    void TelemetryQueueService.addIncomingRequestIngestJob({
      secretKey: request.secretKey,
      requestHeaders: {},
      requestBody: { sequence: request.sequence },
      requestMethod: "POST",
      receivedAt: new Date(),
    }).catch((err: unknown) => {
      report.violations.push(`a request could not be queued: ${String(err)}`);
    });
  };

  const work: () => void = (): void => {
    const job: ModelJob = model.takeNext();
    const secretKey: string = secretKeyOf(job);

    // The last attempt never fails, so every request gets its chance.
    if (job.attemptsMade < ATTEMPTS - 1 && random() < FAILURE_RATE) {
      failing.set(secretKey, random() < 0.5 ? "read" : "evaluate");
    }

    running++;

    void (async (): Promise<void> => {
      let failed: boolean = false;

      try {
        await processor(job.data.incomingRequestPending!, {
          isFinalAttempt: job.attemptsMade + 1 >= ATTEMPTS,
        });
      } catch (err) {
        // The telemetry worker completes the job on these; none occur here.
        failed = !isNonActionableIngestError(err);
      }

      failing.delete(secretKey);

      // BullMQ moves the job on in a Redis call of its own.
      await point();

      running--;
      job.attemptsMade += failed ? 1 : 0;

      if (failed && job.attemptsMade < ATTEMPTS) {
        model.retryLater(job);
      } else {
        model.finish(job);
      }
    })();
  };

  // A delayed job's backoff is over: it is queued again.
  const promote: () => void = (): void => {
    model.promote(Math.floor(random() * model.delayed.length));
  };

  const resume: () => void = (): void => {
    const [next]: Array<() => void> = points.splice(
      Math.floor(random() * points.length),
      1,
    );
    next!();
  };

  for (let step: number = 0; ; step++) {
    if (step > 200000) {
      throw new Error(`Schedule ${seed} did not drain`);
    }

    const actions: Array<() => void> = [];

    if (toSend.length > 0) {
      actions.push(send);
    }

    if (running < WORKER_CONCURRENCY && model.hasWaiting()) {
      actions.push(work);
    }

    if (model.delayed.length > 0) {
      actions.push(promote);
    }

    if (points.length > 0) {
      // Weighted, so that work in flight tends to move on.
      actions.push(resume, resume, resume);
    }

    if (actions.length === 0) {
      break;
    }

    actions[Math.floor(random() * actions.length)]!();
    await settle();
    checkJobsPerMonitor();
  }

  report.leftWaiting = Array.from(lists.values()).reduce(
    (total: number, list: ModelList) => {
      return total + list.ids.length;
    },
    0,
  );

  return report;
}

// Every grouped monitor evaluated exactly what was kept for it, in order.
function everyGroupedRequestEvaluated(scheduleReport: ScheduleReport): boolean {
  return groupedKeys.every((secretKey: string) => {
    const kept: Array<number> = scheduleReport.kept.get(secretKey) || [];
    const evaluated: Array<number> =
      scheduleReport.evaluated.get(secretKey) || [];

    return (
      kept.length === REQUESTS_PER_MONITOR &&
      JSON.stringify(evaluated) === JSON.stringify(kept)
    );
  });
}

function newestEvaluatedLast(scheduleReport: ScheduleReport): boolean {
  return ungroupedKeys.every((secretKey: string) => {
    const kept: Array<number> = scheduleReport.kept.get(secretKey) || [];
    const evaluated: Array<number> =
      scheduleReport.evaluated.get(secretKey) || [];

    return (
      kept.length > 0 &&
      evaluated[evaluated.length - 1] === kept[kept.length - 1]
    );
  });
}

describe("Incoming Request coalescing under random interleavings", () => {
  beforeAll(() => {
    wireMocks();
  });

  test("a grouped monitor evaluates every request in order, any other its newest last, and a monitor has one job at a time", async () => {
    let ungroupedEvaluations: number = 0;

    for (let seed: number = 1; seed <= SCHEDULES; seed++) {
      const scheduleReport: ScheduleReport = await runSchedule(
        seed,
        processPendingIncomingRequestsFromQueue,
      );

      expect({ seed, violations: scheduleReport.violations }).toEqual({
        seed,
        violations: [],
      });
      expect({
        seed,
        everyGroupedRequestEvaluated:
          everyGroupedRequestEvaluated(scheduleReport),
      }).toEqual({ seed, everyGroupedRequestEvaluated: true });
      expect({
        seed,
        newestEvaluatedLast: newestEvaluatedLast(scheduleReport),
      }).toEqual({ seed, newestEvaluatedLast: true });
      expect({ seed, leftWaiting: scheduleReport.leftWaiting }).toEqual({
        seed,
        leftWaiting: 0,
      });

      for (const secretKey of ungroupedKeys) {
        ungroupedEvaluations += (scheduleReport.evaluated.get(secretKey) || [])
          .length;
      }
    }

    /*
     * The schedules do coalesce a monitor without grouping: more of its
     * requests are superseded than are evaluated.
     */
    const ungroupedRequests: number =
      SCHEDULES * UNGROUPED_MONITORS * REQUESTS_PER_MONITOR;

    expect(ungroupedEvaluations).toBeGreaterThan(0);
    expect(ungroupedRequests - ungroupedEvaluations).toBeGreaterThan(
      ungroupedEvaluations,
    );
  }, 180000);

  /*
   * Before #10582 a coalesced job evaluated only a monitor's newest
   * request, grouped or not. The same schedules lose a grouped monitor's
   * requests in nearly every one of them.
   */
  test("the same schedules catch jobs that evaluate only the newest of a grouped monitor's requests", async () => {
    const newestOnly: Processor = async (
      jobData: IncomingRequestPendingJobData,
    ): Promise<void> => {
      const newest: PendingIncomingRequest | null =
        await IncomingRequestPendingStore.peekNewest(jobData.secretKeyHash);

      if (!newest) {
        return;
      }

      await processIncomingRequestFromQueue(newest.payload);
      await IncomingRequestPendingStore.removeThrough(
        jobData.secretKeyHash,
        newest.requestId,
      );
    };

    let lost: number = 0;

    for (let seed: number = 1; seed <= NEWEST_ONLY_SCHEDULES; seed++) {
      const scheduleReport: ScheduleReport = await runSchedule(
        seed,
        newestOnly,
      );

      if (!everyGroupedRequestEvaluated(scheduleReport)) {
        lost++;
      }
    }

    expect(lost).toBeGreaterThan(NEWEST_ONLY_SCHEDULES * 0.75);
  }, 180000);
});
