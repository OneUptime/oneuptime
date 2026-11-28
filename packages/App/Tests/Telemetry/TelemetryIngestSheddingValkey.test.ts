/*
 * TelemetryIngestShedding on a real Valkey and real BullMQ (2026-11-27):
 * batches queued through TelemetryQueueService.addMetricIngestJob and
 * addLogIngestJob - the path every producer takes - land in the Telemetry
 * queue's prioritized set under ids the sampler reads its project and
 * signal from, and ZCARD, ZRANDMEMBER and INFO answer what it decides on:
 * the project far ahead of the workers is refused, retryably, on that
 * signal alone, and its next batch is refused at the enqueue, before its
 * body is stored. The unit tests (Common's TelemetryIngestShedding.test.ts)
 * take all of that as given.
 *
 * It needs Valkey: CI's test-setup.sh starts one and `npm test` exports its
 * settings from config.env. Locally, a disposable one:
 *
 *   docker run -d --rm -p 16406:6379 valkey/valkey:9.1-alpine
 *   VALKEY_HOST=localhost VALKEY_PORT=16406 \
 *     npx jest Tests/Telemetry/TelemetryIngestSheddingValkey.test.ts
 *
 * The queue has a name of its own, removed afterwards, and the bodies are
 * kept in memory: nothing else in Valkey is touched.
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
    `TelemetryIngestSheddingTest-${process.pid}-${Date.now()}`;

  return {
    __esModule: true,
    default: actual.default,
    QueueName: actual.QueueName,
  };
});

const storeBody: jest.Mock = jest.fn(async (): Promise<string> => {
  return `telemetry:body:test-${Math.random()}`;
});
jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: { storeBody, readBody: jest.fn(), deleteBody: jest.fn() },
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
    getLogAttributesFromRequest: jest.fn(),
  };
});

import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import Redis from "Common/Server/Infrastructure/Redis";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestShedding, {
  TelemetryIngestShedError,
} from "Common/Server/Utils/Telemetry/TelemetryIngestShedding";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import {
  TelemetryIngestionBudgetRefusal,
  TelemetryIngestionBudgetRefusalKind,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

type BullQueue = ReturnType<typeof Queue.getQueue>;

const FLOODING: ObjectID = ObjectID.generate();
const QUIET: ObjectID = ObjectID.generate();

let queue: BullQueue;

const request: (
  projectId: ObjectID,
  productType: ProductType,
) => TelemetryRequest = (
  projectId: ObjectID,
  productType: ProductType,
): TelemetryRequest => {
  return {
    projectId: projectId,
    body:
      productType === ProductType.Metrics
        ? { resourceMetrics: [] }
        : { resourceLogs: [] },
    headers: {},
    productType: productType,
    // As a gate that counted nothing leaves it.
    telemetryIngestionBudgetCharge: null,
  } as unknown as TelemetryRequest;
};

jest.setTimeout(60_000);

beforeAll(async () => {
  await Redis.connect();
  queue = Queue.getQueue(QueueName.Telemetry);
  await queue.waitUntilReady();
  await queue.obliterate({ force: true });

  TelemetryIngestShedding.reset({
    projectQueueLimit: 50,
    valkeyMemoryLimitPercent: 0,
    sampleSize: 1000,
    refreshIntervalMs: 10_000,
    retryAfterSeconds: 30,
  });

  for (let n: number = 0; n < 120; n++) {
    await TelemetryQueueService.addMetricIngestJob(
      request(FLOODING, ProductType.Metrics),
    );
  }

  for (let n: number = 0; n < 20; n++) {
    await TelemetryQueueService.addLogIngestJob(
      request(QUIET, ProductType.Logs),
    );
  }

  // Monitoring work waits with no priority, outside the sampled set.
  await TelemetryQueueService.addProbeIngestJob({
    probeId: ObjectID.generate(),
    probeMonitorResponse: {},
    jobType: "probe-response",
  });
});

afterAll(async () => {
  TelemetryIngestShedding.reset();

  if (queue) {
    await queue.obliterate({ force: true });
    await queue.close();
  }

  await Redis.disconnect();
});

describe("a flooding project on a real queue", () => {
  test("every bulk batch waits in the prioritized set the sampler reads, monitoring work outside it", async () => {
    expect(await queue.getPrioritizedCount()).toBe(140);
    expect(await queue.getWaitingCount()).toBe(1);
  });

  test("its metrics are refused, retryably, from what the queue holds; its logs and the quiet project are taken", async () => {
    const nowMs: number = Date.now();

    await TelemetryIngestShedding.refresh(nowMs);

    const refusal: TelemetryIngestionBudgetRefusal | null =
      TelemetryIngestShedding.getRefusal({
        projectId: FLOODING,
        signal: ProductType.Metrics,
        nowMs: nowMs + 1,
      });

    // The whole set fits in one sample, so it is counted exactly.
    expect(refusal?.kind).toBe(
      TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
    );
    expect(refusal?.retryAfterSeconds).toBe(30);
    expect(refusal?.message).toContain("about 120 batches are waiting");

    expect(
      TelemetryIngestShedding.getRefusal({
        projectId: FLOODING,
        signal: ProductType.Logs,
        nowMs: nowMs + 1,
      }),
    ).toBeNull();
    expect(
      TelemetryIngestShedding.getRefusal({
        projectId: QUIET,
        signal: ProductType.Logs,
        nowMs: nowMs + 1,
      }),
    ).toBeNull();
  });

  test("its next batch is refused at the enqueue, before a body is stored or a job queued", async () => {
    storeBody.mockClear();

    await expect(
      TelemetryQueueService.addMetricIngestJob(
        request(FLOODING, ProductType.Metrics),
      ),
    ).rejects.toBeInstanceOf(TelemetryIngestShedError);

    expect(storeBody).not.toHaveBeenCalled();
    expect(await queue.getPrioritizedCount()).toBe(140);

    // The quiet project's next batch is queued as before.
    await TelemetryQueueService.addLogIngestJob(
      request(QUIET, ProductType.Logs),
    );
    expect(await queue.getPrioritizedCount()).toBe(141);
  });
});
