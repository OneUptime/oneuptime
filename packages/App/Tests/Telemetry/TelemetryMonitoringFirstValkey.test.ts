/*
 * Monitoring work is taken ahead of the bulk telemetry queued before it: on a
 * real Valkey and real BullMQ (OneUptime issue #11131).
 *
 * The report (#11017): an installation's Telemetry queue fell 15 million jobs
 * behind. Every probe result, heartbeat and server monitor report went to the
 * back of that queue, behind the logs, traces and metrics, so monitors'
 * statuses and incidents trailed what the probes saw by hours.
 *
 * Here TelemetryQueueService queues real jobs - Kubernetes cost reports and
 * product analytics batches for the bulk telemetry, probe results and server
 * monitor reports for the monitoring work - on a Telemetry queue of this
 * suite's own, a real QueueWorker takes them one at a time, and:
 *   - every monitoring job is taken before the bulk telemetry queued ahead of
 *     it, each kind in the order it was queued;
 *   - how far behind the queue is (TelemetryIngestBacklog) is the oldest job
 *     of either kind, and the queue's counts hold both;
 *   - a job a server of an earlier release queued, with no priority, waits
 *     with the monitoring work, as every job did;
 *   - a bulk batch that fails is retried among the bulk telemetry, never
 *     ahead of the monitoring work.
 *
 * It needs Valkey: CI's test-setup.sh starts one and `npm test` exports its
 * settings from config.env. Locally, a disposable one:
 *
 *   docker run -d --rm -p 16405:6379 valkey/valkey:9.1-alpine
 *   VALKEY_HOST=localhost VALKEY_PORT=16405 \
 *     npx jest Tests/Telemetry/TelemetryMonitoringFirstValkey.test.ts
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
    `TelemetryMonitoringFirstTest-${process.pid}-${Date.now()}`;

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
import TelemetryIngestBacklog from "Common/Server/Utils/Telemetry/TelemetryIngestBacklog";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import TelemetryQueueService, {
  TelemetryIngestJobData,
  TelemetryType,
  getTelemetryJobPriority,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
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

let queue: BullQueue;
let worker: BullWorker | null = null;

// What the worker was handed, in the order it was handed it.
const taken: Array<string> = [];

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

// A name for a queued job, from what it carries: what the worker was handed.
function labelOf(data: TelemetryIngestJobData): string {
  switch (data.type) {
    case TelemetryType.KubernetesCostIngest:
      return `bulk:${String(data.kubernetesCostIngest?.costPayload?.["n"])}`;
    case TelemetryType.ProductAnalyticsEvents:
      return `bulk:${String(
        (data.productAnalyticsEvents as unknown as JSONObject)?.["batchId"],
      )}`;
    case TelemetryType.ProbeIngest:
      return `monitoring:${String(
        (
          data.probeIngest?.probeMonitorResponse?.[
            "probeMonitorResponse"
          ] as JSONObject
        )?.["n"],
      )}`;
    case TelemetryType.ServerMonitorIngest:
      return `monitoring:${String(
        data.serverMonitorIngest?.serverMonitorResponse?.["n"],
      )}`;
    default:
      return `${data.type}:${String((data as unknown as JSONObject)["n"])}`;
  }
}

// One worker, one job at a time, as the order is the point.
async function startWorker(
  handler?: (job: QueueJob) => Promise<void>,
): Promise<void> {
  QueueWorker.startProcessingJobs();

  worker = QueueWorker.getWorker(
    QueueName.Telemetry,
    async (job: QueueJob): Promise<void> => {
      taken.push(labelOf(job.data as TelemetryIngestJobData));

      if (handler) {
        await handler(job);
      }
    },
    { concurrency: 1 },
  );

  await worker.waitUntilReady();
}

async function queueBulk(n: number): Promise<void> {
  if (n % 2 === 0) {
    await TelemetryQueueService.addKubernetesCostIngestJob({
      projectId: ObjectID.generate(),
      costPayload: { n: n },
    });
    return;
  }

  await TelemetryQueueService.addProductAnalyticsEventsJob({
    projectId: ObjectID.generate().toString(),
    batchId: String(n),
  } as unknown as Parameters<
    typeof TelemetryQueueService.addProductAnalyticsEventsJob
  >[0]);
}

async function queueMonitoring(n: number): Promise<void> {
  if (n % 2 === 0) {
    await TelemetryQueueService.addProbeIngestJob({
      probeId: ObjectID.generate(),
      probeMonitorResponse: { n: n },
      jobType: "probe-response",
    });
    return;
  }

  await TelemetryQueueService.addServerMonitorIngestJob({
    secretKey: `server-${n}`,
    serverMonitorResponse: { n: n },
  });
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

beforeEach(async () => {
  taken.length = 0;
  await queue.obliterate({ force: true });
});

afterEach(async () => {
  if (worker) {
    await worker.close();
    worker = null;
  }
});

describe("the Telemetry queue, on a real Valkey", () => {
  test("takes every monitoring job before the bulk telemetry queued ahead of it, each kind in its own order", async () => {
    // A backlog of logs and metrics, the way #11017's was: queued first.
    for (let n: number = 1; n <= 30; n++) {
      await queueBulk(n);
    }

    // Then the probes report, and a server monitor.
    for (let n: number = 1; n <= 6; n++) {
      await queueMonitoring(n);
    }

    await startWorker();

    await waitFor("every job to be taken", () => {
      return taken.length === 36;
    });

    const expectedMonitoring: Array<string> = [1, 2, 3, 4, 5, 6].map(
      (n: number) => {
        return `monitoring:${n}`;
      },
    );
    const expectedBulk: Array<string> = Array.from(
      { length: 30 },
      (_value: unknown, index: number) => {
        return `bulk:${index + 1}`;
      },
    );

    expect(taken).toEqual([...expectedMonitoring, ...expectedBulk]);
  });

  test("monitoring work queued while the bulk telemetry is being worked through goes next", async () => {
    for (let n: number = 1; n <= 20; n++) {
      await queueBulk(n);
    }

    let isMonitoringQueued: boolean = false;

    await startWorker(async (): Promise<void> => {
      // A probe reports once the workers are three batches in.
      if (!isMonitoringQueued && taken.length === 3) {
        isMonitoringQueued = true;
        await queueMonitoring(100);
      }

      await sleep(5);
    });

    await waitFor("every job to be taken", () => {
      return taken.length === 21;
    });

    // Taken right after the batch in flight when it arrived, not after all 20.
    expect(taken.slice(0, 4)).toEqual([
      "bulk:1",
      "bulk:2",
      "bulk:3",
      "monitoring:100",
    ]);
    expect(taken.slice(4)).toEqual(
      Array.from({ length: 17 }, (_value: unknown, index: number) => {
        return `bulk:${index + 4}`;
      }),
    );
  });

  test("is as far behind as its oldest job of either kind, and counts both", async () => {
    await queueBulk(1);
    const oldestBulk: QueueJob = (await queue.getJobs(["prioritized"]))[0]!;

    await sleep(50);
    await queueMonitoring(1);
    await queueMonitoring(2);

    // The bulk batch waits with a priority, the monitoring work without one.
    expect(await queue.getPrioritizedCount()).toBe(1);
    expect(await queue.getWaitingCount()).toBe(2);

    // How far behind the queue is: the logs that waited longest.
    expect(await TelemetryIngestBacklog.getOldestWaitingSince()).toEqual(
      new Date(oldestBulk.timestamp),
    );

    // Every count a page, the health check or KEDA reads has all three.
    expect((await Queue.getQueueStats(QueueName.Telemetry)).waiting).toBe(3);
    expect(await Queue.getQueueBacklogSize(QueueName.Telemetry)).toBe(3);
    expect(await Queue.getQueueSize(QueueName.Telemetry)).toBe(3);
  });

  test("a job an earlier release queued, with no priority, waits with the monitoring work", async () => {
    for (let n: number = 1; n <= 5; n++) {
      await queueBulk(n);
    }

    // A logs batch as a server that sets no priority queued it.
    await queue.add(
      "ProcessTelemetry",
      {
        type: TelemetryType.KubernetesCostIngest,
        kubernetesCostIngest: { costPayload: { n: "from-an-earlier-release" } },
      },
      { jobId: `earlier-release-${Date.now()}` },
    );

    await startWorker();

    await waitFor("every job to be taken", () => {
      return taken.length === 6;
    });

    expect(taken[0]).toBe("bulk:from-an-earlier-release");
    expect(taken.slice(1)).toEqual([
      "bulk:1",
      "bulk:2",
      "bulk:3",
      "bulk:4",
      "bulk:5",
    ]);
  });

  test("a bulk batch that fails is retried among the bulk telemetry, never ahead of the monitoring work", async () => {
    // As TelemetryQueueService queues a logs batch, with a short backoff.
    await Queue.addJob(
      QueueName.Telemetry,
      `retried-logs-${Date.now()}`,
      "ProcessTelemetry",
      {
        type: TelemetryType.KubernetesCostIngest,
        kubernetesCostIngest: { costPayload: { n: "retried" } },
      } as unknown as JSONObject,
      {
        attempts: 2,
        backoffDelayInMs: 100,
        priority: getTelemetryJobPriority(TelemetryType.KubernetesCostIngest),
      },
    );

    let isFailedOnce: boolean = false;

    await startWorker(async (job: QueueJob): Promise<void> => {
      if (labelOf(job.data as TelemetryIngestJobData) === "bulk:retried") {
        if (!isFailedOnce) {
          isFailedOnce = true;
          // Monitoring work arrives while the batch waits for its retry.
          await queueMonitoring(1);
          await queueMonitoring(2);
          throw new Error("ClickHouse ingest client is not connected");
        }
      }
    });

    await waitFor("the retried batch to complete", async () => {
      return (await queue.getCompletedCount()) === 3;
    });

    expect(taken).toEqual([
      "bulk:retried",
      "monitoring:1",
      "monitoring:2",
      "bulk:retried",
    ]);
    expect(await queue.getFailedCount()).toBe(0);
  });
});
