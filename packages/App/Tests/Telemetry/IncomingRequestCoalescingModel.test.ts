/*
 * Random interleavings of same-monitor coalescing of Incoming Request
 * ingest, against a model of BullMQ's deduplication.
 *
 * IncomingRequestCoalescingRedis.test.ts runs hand-picked schedules on a real
 * Redis and BullMQ. This suite runs a hundred and fifty seeded random
 * schedules on the real enqueue path
 * (TelemetryQueueService.addIncomingRequestIngestJob) and the real worker
 * entry point (processIncomingRequestJobFromQueue). Every call they make
 * outward - the queue add, each store operation, the monitor lookup, the
 * evaluation, the job's completion - is a point at which any other request,
 * worker, retry or Redis reply may go first.
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
 * The store is an in-memory one with the same atomic operations as
 * IncomingRequestLatestPayloadStore's Lua. In every schedule:
 *
 *   - a monitor never has more than one job (waiting, delayed or running)
 *     plus the next job BullMQ keeps for it,
 *   - it never evaluates a request stored earlier than one it has already
 *     evaluated, nor any request twice,
 *   - once everything has drained, the request stored last for it is the
 *     last one it evaluated, and nothing is left stored.
 *
 * Run with jobs that evaluate their own copy of the request - the behaviour
 * before the store - the same schedules fail that last check.
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
  "../../FeatureSet/Telemetry/Utils/IncomingRequestLatestPayloadStore",
  () => {
    return {
      __esModule: true,
      default: {
        store: jest.fn(),
        getLatest: jest.fn(),
        clearIfUnchanged: jest.fn(),
      },
    };
  },
);

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

import TelemetryQueueService, {
  IncomingRequestIngestJobData,
  TelemetryIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import {
  processIncomingRequestFromQueue,
  processIncomingRequestJobFromQueue,
} from "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import IncomingRequestLatestPayloadStore, {
  LatestIncomingRequestPayload,
} from "../../FeatureSet/Telemetry/Utils/IncomingRequestLatestPayloadStore";
import { isNonActionableIngestError } from "../../FeatureSet/Telemetry/Utils/NonActionableIngestError";
import Queue from "Common/Server/Infrastructure/Queue";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";

const MONITORS: number = 3;
const REQUESTS_PER_MONITOR: number = 6;
const WORKER_CONCURRENCY: number = 2;
// The Telemetry queue's attempts per job (Queue.addJob's default for it).
const ATTEMPTS: number = 3;
const FAILURE_RATE: number = 0.2;
const SCHEDULES: number = 150;
const OWN_COPY_SCHEDULES: number = 60;

type Processor = (jobData: IncomingRequestIngestJobData) => Promise<void>;

type JobState = "waiting" | "active" | "delayed" | "done";

interface ModelJob {
  id: string;
  deduplicationId: string | undefined;
  data: TelemetryIngestJobData;
  state: JobState;
  attemptsMade: number;
}

interface ScheduleReport {
  violations: Array<string>;
  // Per monitor: the requests in the order they were stored.
  stored: Map<string, Array<number>>;
  // Per monitor: the requests it evaluated, in order.
  evaluated: Map<string, Array<number>>;
  leftInStore: number;
}

// BullMQ serializes job data and store values to JSON; so does the model.
function viaJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function secretKeyOf(job: ModelJob): string {
  return job.data.incomingRequestIngest!.secretKey;
}

function sequenceOf(body: unknown): number {
  return (body as JSONObject)["sequence"] as number;
}

// mulberry32: small, fast, and the same sequence for the same seed.
function seededRandom(seed: number): () => number {
  let state: number = seed >>> 0;

  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t: number = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
const storeMock: jest.Mock =
  IncomingRequestLatestPayloadStore.store as unknown as jest.Mock;
const getLatestMock: jest.Mock =
  IncomingRequestLatestPayloadStore.getLatest as unknown as jest.Mock;
const clearIfUnchangedMock: jest.Mock =
  IncomingRequestLatestPayloadStore.clearIfUnchanged as unknown as jest.Mock;
const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const track: jest.Mock =
  IncomingRequestReceivedAtStore.track as unknown as jest.Mock;

const secretKeys: Array<string> = Array.from(
  { length: MONITORS },
  (_value: unknown, index: number) => {
    return `00000000-0000-4000-8000-00000000000${index + 1}`;
  },
);

/*
 * The state of the schedule being run. The mocks are wired once and read
 * it, so a schedule only has to replace it.
 */
let random: () => number = Math.random;
let points: Array<() => void> = [];
let model: DeduplicatingQueueModel = new DeduplicatingQueueModel();
let slots: Map<string, { payloadId: string; payload: string }> = new Map();
let report: ScheduleReport = {
  violations: [],
  stored: new Map(),
  evaluated: new Map(),
  leftInStore: 0,
};
// The step at which the running attempt of a monitor's job fails, if it does.
let failing: Map<string, "read" | "evaluate"> = new Map();

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

function storedOf(secretKey: string): Array<number> {
  if (!report.stored.has(secretKey)) {
    report.stored.set(secretKey, []);
  }

  return report.stored.get(secretKey)!;
}

function evaluatedOf(secretKey: string): Array<number> {
  if (!report.evaluated.has(secretKey)) {
    report.evaluated.set(secretKey, []);
  }

  return report.evaluated.get(secretKey)!;
}

function checkJobsPerMonitor(): void {
  for (const secretKey of secretKeys) {
    const live: number = model.liveJobsOf(secretKey).length;
    const next: number = model.nextJobs.has(`incoming-request-${secretKey}`)
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

  storeMock.mockImplementation((async (data: {
    secretKey: string;
    payloadId: string;
    payload: IncomingRequestIngestJobData;
  }): Promise<void> => {
    await point();
    slots.set(data.secretKey, {
      payloadId: data.payloadId,
      payload: JSON.stringify(data.payload),
    });
    storedOf(data.secretKey).push(sequenceOf(data.payload.requestBody));
    await point();
  }) as never);

  getLatestMock.mockImplementation((async (
    secretKey: string,
  ): Promise<LatestIncomingRequestPayload | null> => {
    await point();

    if (failing.get(secretKey) === "read") {
      throw new Error("Redis connection reset");
    }

    const slot: { payloadId: string; payload: string } | undefined =
      slots.get(secretKey);
    await point();

    return slot
      ? {
          payloadId: slot.payloadId,
          payload: JSON.parse(slot.payload) as IncomingRequestIngestJobData,
        }
      : null;
  }) as never);

  clearIfUnchangedMock.mockImplementation((async (data: {
    secretKey: string;
    payloadId: string;
  }): Promise<boolean> => {
    await point();
    const cleared: boolean =
      slots.get(data.secretKey)?.payloadId === data.payloadId;

    if (cleared) {
      slots.delete(data.secretKey);
    }

    await point();
    return cleared;
  }) as never);

  findOneBy.mockImplementation((async (args: {
    query: { incomingRequestSecretKey: ObjectID };
  }): Promise<Monitor> => {
    await point();
    const monitor: Monitor = new Monitor();
    monitor._id = args.query.incomingRequestSecretKey.toString();
    monitor.projectId = new ObjectID("4c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19");
    monitor.isArchived = false;
    monitor.disableActiveMonitoring = false;
    monitor.disableActiveMonitoringBecauseOfManualIncident = false;
    monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;
    return monitor;
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

    if (failing.get(secretKey) === "evaluate") {
      throw new Error("Acquire mutex timeout");
    }

    const sequence: number = sequenceOf(request.requestBody);
    const stored: Array<number> = storedOf(secretKey);
    const evaluated: Array<number> = evaluatedOf(secretKey);
    const previous: number | undefined = evaluated[evaluated.length - 1];

    if (evaluated.includes(sequence)) {
      report.violations.push(
        `${secretKey} evaluated request ${sequence} twice`,
      );
    } else if (
      previous !== undefined &&
      stored.indexOf(sequence) < stored.indexOf(previous)
    ) {
      report.violations.push(
        `${secretKey} evaluated request ${sequence} after ${previous}, which was stored later`,
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
  slots = new Map();
  failing = new Map();
  report = {
    violations: [],
    stored: new Map(),
    evaluated: new Map(),
    leftInStore: 0,
  };

  // Which monitor each request goes to, shuffled (Fisher-Yates)...
  const order: Array<string> = [];

  for (let i: number = 0; i < MONITORS * REQUESTS_PER_MONITOR; i++) {
    order.push(secretKeys[i % MONITORS]!);
  }

  for (let i: number = order.length - 1; i > 0; i--) {
    const j: number = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }

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
        await processor(job.data.incomingRequestIngest!);
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
    if (step > 100000) {
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

  report.leftInStore = slots.size;

  return report;
}

function newestEvaluatedLast(scheduleReport: ScheduleReport): boolean {
  return secretKeys.every((secretKey: string) => {
    const stored: Array<number> = scheduleReport.stored.get(secretKey) || [];
    const evaluated: Array<number> =
      scheduleReport.evaluated.get(secretKey) || [];

    return (
      stored.length > 0 &&
      evaluated[evaluated.length - 1] === stored[stored.length - 1]
    );
  });
}

describe("Incoming Request coalescing under random interleavings", () => {
  beforeAll(() => {
    wireMocks();
  });

  test("the newest request is evaluated last, older ones are never evaluated after it, and a monitor has one job at a time", async () => {
    let evaluations: number = 0;
    let supersededRequests: number = 0;

    for (let seed: number = 1; seed <= SCHEDULES; seed++) {
      const scheduleReport: ScheduleReport = await runSchedule(
        seed,
        processIncomingRequestJobFromQueue,
      );

      expect({ seed, violations: scheduleReport.violations }).toEqual({
        seed,
        violations: [],
      });
      expect({
        seed,
        newestEvaluatedLast: newestEvaluatedLast(scheduleReport),
      }).toEqual({ seed, newestEvaluatedLast: true });
      expect({ seed, leftInStore: scheduleReport.leftInStore }).toEqual({
        seed,
        leftInStore: 0,
      });

      const evaluatedInSchedule: number = Array.from(
        scheduleReport.evaluated.values(),
      ).reduce((total: number, evaluated: Array<number>) => {
        return total + evaluated.length;
      }, 0);

      evaluations += evaluatedInSchedule;
      supersededRequests +=
        MONITORS * REQUESTS_PER_MONITOR - evaluatedInSchedule;
    }

    /*
     * The schedules do coalesce: more requests are superseded than are
     * evaluated one by one.
     */
    expect(evaluations).toBeGreaterThan(0);
    expect(supersededRequests).toBeGreaterThan(evaluations);
  }, 120000);

  /*
   * Without the store, the job BullMQ keeps for a waiting monitor evaluates
   * the request that created it, and the newest is lost in nearly every
   * schedule.
   */
  test("the same schedules catch jobs that evaluate their own copy of the request", async () => {
    const ownCopy: Processor = (
      jobData: IncomingRequestIngestJobData,
    ): Promise<void> => {
      return processIncomingRequestFromQueue(jobData);
    };

    let stale: number = 0;

    for (let seed: number = 1; seed <= OWN_COPY_SCHEDULES; seed++) {
      const scheduleReport: ScheduleReport = await runSchedule(seed, ownCopy);

      if (!newestEvaluatedLast(scheduleReport)) {
        stale++;
      }
    }

    expect(stale).toBeGreaterThan(OWN_COPY_SCHEDULES * 0.75);
  }, 120000);
});
