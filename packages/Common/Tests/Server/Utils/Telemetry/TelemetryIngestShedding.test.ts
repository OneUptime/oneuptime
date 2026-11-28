import TelemetryIngestShedding, {
  decideRefusedProjects,
  DEFAULT_PROJECT_QUEUE_LIMIT,
  DEFAULT_VALKEY_MEMORY_LIMIT_PERCENT,
  estimateQueuedBatches,
  getTelemetryIngestSheddingKey,
  getTelemetryIngestSheddingSignalForJobType,
  isValkeyOverMemoryLimit,
  MIN_SAMPLE_HITS,
  parseQueuedTelemetryJobId,
  QueuedBatchesEstimate,
  readTelemetryIngestSheddingSettingsFromEnv,
  STALE_AFTER_MS,
  TelemetryIngestShedError,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestShedding";
import Queue from "../../../../Server/Infrastructure/Queue";
import Redis, { ClientType } from "../../../../Server/Infrastructure/Redis";
import logger from "../../../../Server/Utils/Logger";
import TooManyRequestsException from "../../../../Types/Exception/TooManyRequestsException";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import {
  TelemetryIngestionBudgetRefusal,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * 2026-11-27: one project's metrics flood was 93% of the Telemetry queue,
 * which grew to 700,000 jobs and Valkey to 35 GB, until a Valkey restart
 * lost every project's queued telemetry and the probes' check results. The
 * only lever was DISABLE_TELEMETRY_INGESTION, which drops everyone's data.
 * TelemetryIngestShedding refuses, retryably, the one project far ahead of
 * the workers - and everyone's bulk telemetry only when Valkey is nearly
 * full - from a sample of the queue's job ids read every ten seconds.
 */

const FLOODING: string = "863451e2-ca8c-4511-9e8b-322596eea195";
const QUIET: string = "5d3b0f1a-0000-4000-8000-000000000071";
const PRIORITIZED_KEY: string = "bull:Telemetry:prioritized";

function jobId(type: string, projectId: string, index: number = 0): string {
  return `${type}-${projectId}-17950000000000${index}-0d7c0a6e-1111-4222-8333-${String(
    index,
  ).padStart(12, "0")}`;
}

function ids(type: string, projectId: string, count: number): Array<string> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return jobId(type, projectId, index);
  });
}

interface FakeValkey {
  info: Mock<(section: string) => Promise<string>>;
  zcard: Mock<(key: string) => Promise<number>>;
  zrandmember: Mock<(key: string, count: number) => Promise<Array<string>>>;
}

let valkey: FakeValkey;

function memoryInfo(usedBytes: number, maxBytes: number): string {
  return `# Memory\r\nused_memory:${usedBytes}\r\nused_memory_human:x\r\nmaxmemory:${maxBytes}\r\nmaxmemory_policy:noeviction\r\n`;
}

function queueHolds(data: {
  queued: number;
  sample?: Array<string>;
  usedBytes?: number;
  maxBytes?: number;
}): void {
  valkey.zcard.mockResolvedValue(data.queued);
  valkey.zrandmember.mockResolvedValue(data.sample ?? []);
  valkey.info.mockResolvedValue(
    memoryInfo(data.usedBytes ?? 100, data.maxBytes ?? 1000),
  );
}

const NOW: number = Date.parse("2026-11-27T22:00:00Z");

beforeEach(() => {
  valkey = {
    info: jest.fn(),
    zcard: jest.fn(),
    zrandmember: jest.fn(),
  };
  queueHolds({ queued: 0 });

  jest
    .spyOn(Redis, "getClient")
    .mockReturnValue(valkey as unknown as ClientType);
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
  jest.spyOn(Queue, "getQueue").mockReturnValue({
    toKey: (type: string): string => {
      return `bull:Telemetry:${type}`;
    },
  } as unknown as ReturnType<typeof Queue.getQueue>);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined;
  });

  TelemetryIngestShedding.reset({
    projectQueueLimit: 10_000,
    valkeyMemoryLimitPercent: 85,
    sampleSize: 1000,
    refreshIntervalMs: 10_000,
    retryAfterSeconds: 30,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function refusalFor(
  projectId: string,
  signal: ProductType,
  nowMs: number = NOW,
): TelemetryIngestionBudgetRefusal | null {
  return TelemetryIngestShedding.getRefusal({
    projectId: projectId,
    signal: signal as never,
    nowMs: nowMs,
  });
}

describe("reading a queued job's project and signal from its id", () => {
  test.each([
    ["logs", ProductType.Logs],
    ["syslog", ProductType.Logs],
    ["fluentlogs", ProductType.Logs],
    ["traces", ProductType.Traces],
    ["metrics", ProductType.Metrics],
    ["profiles", ProductType.Profiles],
    ["security-events", ProductType.SecurityEvents],
  ])("a %s job is %s", (type: string, signal: ProductType) => {
    expect(parseQueuedTelemetryJobId(jobId(type, FLOODING))).toEqual({
      projectId: FLOODING,
      signal: signal,
    });
    expect(getTelemetryIngestSheddingSignalForJobType(type)).toBe(signal);
  });

  test.each([
    // Budgets and limits of their own.
    "session-replay",
    "product-analytics-events",
    "kubernetes-cost",
  ])(
    "a %s job counts towards the queue but has no signal here",
    (type: string) => {
      expect(parseQueuedTelemetryJobId(jobId(type, FLOODING))).toBeNull();
    },
  );

  test("monitoring work and ids of no known shape are not anyone's telemetry", () => {
    expect(
      parseQueuedTelemetryJobId(
        "probe-probe-response-general-1795000000000-0d7c0a6e-1111-4222-8333-000000000000",
      ),
    ).toBeNull();
    expect(parseQueuedTelemetryJobId("metrics-not-a-project-1-2")).toBeNull();
    expect(parseQueuedTelemetryJobId("")).toBeNull();
    expect(getTelemetryIngestSheddingSignalForJobType("toString")).toBeNull();
  });

  test("a project id in capitals is the same project", () => {
    expect(
      parseQueuedTelemetryJobId(jobId("metrics", FLOODING.toUpperCase())),
    ).toEqual({ projectId: FLOODING, signal: ProductType.Metrics });
    expect(
      getTelemetryIngestSheddingKey(
        FLOODING.toUpperCase(),
        ProductType.Metrics,
      ),
    ).toBe(getTelemetryIngestSheddingKey(FLOODING, ProductType.Metrics));
  });
});

describe("estimating how many batches a project has waiting", () => {
  test("a project's share of the sample, times the size of the set", () => {
    const estimates: Array<QueuedBatchesEstimate> = estimateQueuedBatches({
      sampledJobIds: [
        ...ids("metrics", FLOODING, 930),
        ...ids("logs", QUIET, 70),
      ],
      queuedBatches: 700_000,
    });

    expect(estimates).toEqual(
      expect.arrayContaining([
        {
          projectId: FLOODING,
          signal: ProductType.Metrics,
          sampleHits: 930,
          estimatedQueuedBatches: 651_000,
        },
        {
          projectId: QUIET,
          signal: ProductType.Logs,
          sampleHits: 70,
          estimatedQueuedBatches: 49_000,
        },
      ]),
    );
    expect(estimates).toHaveLength(2);
  });

  test("a sample as large as the set counts exactly", () => {
    expect(
      estimateQueuedBatches({
        sampledJobIds: ids("traces", QUIET, 12),
        queuedBatches: 12,
      }),
    ).toEqual([
      {
        projectId: QUIET,
        signal: ProductType.Traces,
        sampleHits: 12,
        estimatedQueuedBatches: 12,
      },
    ]);
  });

  test("an empty sample or set says nothing", () => {
    expect(
      estimateQueuedBatches({ sampledJobIds: [], queuedBatches: 50 }),
    ).toEqual([]);
    expect(
      estimateQueuedBatches({
        sampledJobIds: ids("logs", QUIET, 3),
        queuedBatches: 0,
      }),
    ).toEqual([]);
  });
});

describe("deciding whom to refuse", () => {
  const estimate: (
    estimated: number,
    hits: number = 500,
  ) => QueuedBatchesEstimate = (
    estimated: number,
    hits: number = 500,
  ): QueuedBatchesEstimate => {
    return {
      projectId: FLOODING,
      signal: ProductType.Metrics,
      sampleHits: hits,
      estimatedQueuedBatches: estimated,
    };
  };
  const key: string = getTelemetryIngestSheddingKey(
    FLOODING,
    ProductType.Metrics,
  );

  test("a project at the limit is refused, one under it is not", () => {
    expect(
      decideRefusedProjects({
        estimates: [estimate(10_000)],
        limit: 10_000,
        refusedBefore: new Map(),
      }).has(key),
    ).toBe(true);
    expect(
      decideRefusedProjects({
        estimates: [estimate(9_999)],
        limit: 10_000,
        refusedBefore: new Map(),
      }).has(key),
    ).toBe(false);
  });

  test("a refused project is taken again only once it is under four fifths of the limit", () => {
    const refusedBefore: Map<string, QueuedBatchesEstimate> = new Map([
      [key, estimate(20_000)],
    ]);

    expect(
      decideRefusedProjects({
        estimates: [estimate(8_000)],
        limit: 10_000,
        refusedBefore: refusedBefore,
      }).has(key),
    ).toBe(true);
    expect(
      decideRefusedProjects({
        estimates: [estimate(7_999)],
        limit: 10_000,
        refusedBefore: refusedBefore,
      }).has(key),
    ).toBe(false);
  });

  test(`a project seen fewer than ${MIN_SAMPLE_HITS} times in the sample is never refused on chance`, () => {
    // A queue of ten million: each of 1,000 ids stands for 10,000 batches.
    expect(
      decideRefusedProjects({
        estimates: [estimate(40_000, MIN_SAMPLE_HITS - 1)],
        limit: 10_000,
        refusedBefore: new Map(),
      }).size,
    ).toBe(0);
    expect(
      decideRefusedProjects({
        estimates: [estimate(50_000, MIN_SAMPLE_HITS)],
        limit: 10_000,
        refusedBefore: new Map(),
      }).has(key),
    ).toBe(true);
  });

  test("a limit of 0 refuses no one", () => {
    expect(
      decideRefusedProjects({
        estimates: [estimate(1_000_000)],
        limit: 0,
        refusedBefore: new Map(),
      }).size,
    ).toBe(0);
  });
});

describe("Valkey's memory", () => {
  const info: (used: number, max: number) => Record<string, string> = (
    used: number,
    max: number,
  ): Record<string, string> => {
    return { used_memory: String(used), maxmemory: String(max) };
  };

  test("at 85% of maxmemory it is over the limit, under it it is not", () => {
    expect(
      isValkeyOverMemoryLimit({ info: info(850, 1000), limitPercent: 85 }),
    ).toBe(true);
    expect(
      isValkeyOverMemoryLimit({ info: info(849, 1000), limitPercent: 85 }),
    ).toBe(false);
  });

  test("without a maxmemory there is no share to measure, and 0 turns it off", () => {
    expect(
      isValkeyOverMemoryLimit({
        info: info(35_000_000_000, 0),
        limitPercent: 85,
      }),
    ).toBe(false);
    expect(isValkeyOverMemoryLimit({ info: {}, limitPercent: 85 })).toBe(false);
    expect(
      isValkeyOverMemoryLimit({ info: info(999, 1000), limitPercent: 0 }),
    ).toBe(false);
  });
});

describe("the refusal one flooding project gets", () => {
  async function readQueue(nowMs: number = NOW): Promise<void> {
    // The first request after the interval starts a read in the background.
    expect(refusalFor(QUIET, ProductType.Logs, nowMs)).toBeNull();
    await TelemetryIngestShedding.getRunningRefresh();
  }

  test("the 2026-11-27 queue: the flooding project's metrics are refused, retryably; everyone else is taken", async () => {
    queueHolds({
      queued: 700_000,
      sample: [...ids("metrics", FLOODING, 930), ...ids("logs", QUIET, 70)],
    });

    await readQueue();

    const refusal: TelemetryIngestionBudgetRefusal | null = refusalFor(
      FLOODING,
      ProductType.Metrics,
      NOW + 1000,
    );

    expect(refusal).toEqual({
      kind: TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
      scope: TelemetryIngestionBudgetScope.Project,
      signal: ProductType.Metrics,
      message:
        "OneUptime has not yet stored the metrics this project already sent: about 651,000 batches are waiting, and a project may have 10,000 waiting. Retry in 30 seconds.",
      retryAfterSeconds: 30,
      resetsAt: new Date(NOW + 1000 + 30_000),
    });

    // Its other signals, and the other project - 49,000 logs - carry on.
    expect(refusalFor(FLOODING, ProductType.Logs, NOW + 1000)).toBeNull();
    expect(refusalFor(FLOODING, ProductType.Traces, NOW + 1000)).toBeNull();

    expect(valkey.zcard).toHaveBeenCalledWith(PRIORITIZED_KEY);
    expect(valkey.zrandmember).toHaveBeenCalledWith(PRIORITIZED_KEY, 1000);
  });

  test("the other project over the limit too is refused on its own signal", async () => {
    queueHolds({
      queued: 700_000,
      sample: [...ids("metrics", FLOODING, 930), ...ids("logs", QUIET, 70)],
    });

    await readQueue();

    expect(refusalFor(QUIET, ProductType.Logs, NOW + 1000)).not.toBeNull();
    expect(refusalFor(QUIET, ProductType.Metrics, NOW + 1000)).toBeNull();
  });

  test("a healthy queue is counted, never sampled, and refuses no one", async () => {
    queueHolds({ queued: 120 });

    await readQueue();

    expect(valkey.zcard).toHaveBeenCalledTimes(1);
    expect(valkey.zrandmember).not.toHaveBeenCalled();
    expect(refusalFor(FLOODING, ProductType.Metrics, NOW + 1000)).toBeNull();
  });

  test("the queue is read at most once per interval, in the background, never per request", async () => {
    queueHolds({ queued: 120 });

    await readQueue();

    for (let i: number = 0; i < 100; i++) {
      refusalFor(FLOODING, ProductType.Metrics, NOW + 9_999);
    }
    await TelemetryIngestShedding.getRunningRefresh();
    expect(valkey.zcard).toHaveBeenCalledTimes(1);

    refusalFor(FLOODING, ProductType.Metrics, NOW + 10_000);
    await TelemetryIngestShedding.getRunningRefresh();
    expect(valkey.zcard).toHaveBeenCalledTimes(2);
  });

  test("once its batches are stored it is taken again, and both changes are logged once", async () => {
    queueHolds({
      queued: 700_000,
      sample: ids("metrics", FLOODING, 1000),
    });
    await readQueue();
    expect(refusalFor(FLOODING, ProductType.Metrics, NOW + 1)).not.toBeNull();

    // Refused again on the next read: no second line.
    await readQueue(NOW + 10_000);

    queueHolds({ queued: 2_000 });
    await readQueue(NOW + 20_000);
    expect(refusalFor(FLOODING, ProductType.Metrics, NOW + 20_001)).toBeNull();

    const errorLines: Array<string> = (
      logger.error as unknown as Mock<(line: string) => void>
    ).mock.calls.map((call: Array<unknown>) => {
      return String(call[0]);
    });
    expect(errorLines).toEqual([
      `TelemetryIngestShedding: refusing metrics of project ${FLOODING}: about 700,000 of its batches wait in the telemetry queue, over the limit of 10,000 (TELEMETRY_INGEST_PROJECT_QUEUE_LIMIT). Its senders are told to retry; every other project is taken as before.`,
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      `TelemetryIngestShedding: taking metrics of project ${FLOODING} again: the workers caught up with it.`,
    );
  });

  test("a read older than a minute is not used: nothing is refused on it", async () => {
    queueHolds({
      queued: 700_000,
      sample: ids("metrics", FLOODING, 1000),
    });
    await readQueue();

    // Valkey stops answering: every later read fails.
    valkey.zcard.mockRejectedValue(new Error("Connection is closed."));

    expect(
      refusalFor(FLOODING, ProductType.Metrics, NOW + STALE_AFTER_MS),
    ).not.toBeNull();
    await TelemetryIngestShedding.getRunningRefresh();

    expect(
      refusalFor(FLOODING, ProductType.Metrics, NOW + STALE_AFTER_MS + 1),
    ).toBeNull();
    await TelemetryIngestShedding.getRunningRefresh();
    expect(logger.warn).toHaveBeenCalled();
  });

  test("a Valkey that is not connected is not read, and refuses no one", async () => {
    jest.spyOn(Redis, "isConnected").mockReturnValue(false);

    await readQueue();

    expect(valkey.zcard).not.toHaveBeenCalled();
    expect(valkey.info).not.toHaveBeenCalled();
    expect(refusalFor(FLOODING, ProductType.Metrics, NOW + 1)).toBeNull();
  });

  test("with both limits at 0 Valkey is never read", async () => {
    TelemetryIngestShedding.reset({
      projectQueueLimit: 0,
      valkeyMemoryLimitPercent: 0,
    });

    expect(refusalFor(FLOODING, ProductType.Metrics)).toBeNull();
    expect(TelemetryIngestShedding.getRunningRefresh()).toBeNull();
    expect(valkey.zcard).not.toHaveBeenCalled();
    expect(valkey.info).not.toHaveBeenCalled();
  });
});

describe("when Valkey is nearly full", () => {
  test("every project's bulk telemetry is refused, retryably, until it is back under the limit", async () => {
    queueHolds({ queued: 40, usedBytes: 2_800, maxBytes: 3_000 });

    expect(refusalFor(QUIET, ProductType.Logs)).toBeNull();
    await TelemetryIngestShedding.getRunningRefresh();

    for (const signal of [ProductType.Logs, ProductType.Metrics]) {
      const refusal: TelemetryIngestionBudgetRefusal | null = refusalFor(
        QUIET,
        signal,
        NOW + 1,
      );

      expect(refusal?.kind).toBe(
        TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
      );
      expect(refusal?.retryAfterSeconds).toBe(30);
    }

    expect(refusalFor(QUIET, ProductType.Metrics, NOW + 1)?.message).toBe(
      "OneUptime's telemetry queue is nearly full, so it is not taking metrics for now. Retry in 30 seconds.",
    );
    expect(logger.error).toHaveBeenCalledTimes(1);

    queueHolds({ queued: 40, usedBytes: 1_000, maxBytes: 3_000 });
    refusalFor(QUIET, ProductType.Logs, NOW + 10_000);
    await TelemetryIngestShedding.getRunningRefresh();

    expect(refusalFor(QUIET, ProductType.Logs, NOW + 10_001)).toBeNull();
  });

  test("Valkey without a maxmemory has no share to measure", async () => {
    queueHolds({ queued: 40, usedBytes: 35_000_000_000, maxBytes: 0 });

    refusalFor(QUIET, ProductType.Logs);
    await TelemetryIngestShedding.getRunningRefresh();

    expect(refusalFor(QUIET, ProductType.Logs, NOW + 1)).toBeNull();
  });
});

describe("the settings", () => {
  const KEYS: Array<string> = [
    "TELEMETRY_INGEST_PROJECT_QUEUE_LIMIT",
    "TELEMETRY_INGEST_VALKEY_MEMORY_LIMIT_PERCENT",
  ];
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  test("10,000 batches of one signal a project, and 85% of Valkey's maxmemory", () => {
    expect(DEFAULT_PROJECT_QUEUE_LIMIT).toBe(10_000);
    expect(DEFAULT_VALKEY_MEMORY_LIMIT_PERCENT).toBe(85);
    expect(readTelemetryIngestSheddingSettingsFromEnv()).toEqual({
      projectQueueLimit: 10_000,
      valkeyMemoryLimitPercent: 85,
      sampleSize: 1000,
      refreshIntervalMs: 10_000,
      retryAfterSeconds: 30,
    });
  });

  test("set from the environment, 0 turning either off", () => {
    process.env["TELEMETRY_INGEST_PROJECT_QUEUE_LIMIT"] = "50000";
    process.env["TELEMETRY_INGEST_VALKEY_MEMORY_LIMIT_PERCENT"] = "0";

    expect(readTelemetryIngestSheddingSettingsFromEnv()).toMatchObject({
      projectQueueLimit: 50_000,
      valkeyMemoryLimitPercent: 0,
    });
  });

  test.each(["lots", "-1", "2.5", "101"])(
    "%s falls back to the default",
    (value: string) => {
      process.env["TELEMETRY_INGEST_PROJECT_QUEUE_LIMIT"] =
        value === "101" ? "10000" : value;
      process.env["TELEMETRY_INGEST_VALKEY_MEMORY_LIMIT_PERCENT"] = value;

      expect(readTelemetryIngestSheddingSettingsFromEnv()).toMatchObject({
        projectQueueLimit: 10_000,
        valkeyMemoryLimitPercent: 85,
      });
    },
  );
});

test("a batch refused at the enqueue is a TooManyRequests carrying its refusal", () => {
  const refusal: TelemetryIngestionBudgetRefusal = {
    kind: TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
    scope: TelemetryIngestionBudgetScope.Project,
    signal: ProductType.Metrics,
    message: "refused for a test",
    retryAfterSeconds: 30,
    resetsAt: new Date(NOW),
  };
  const error: TelemetryIngestShedError = new TelemetryIngestShedError(refusal);

  expect(error).toBeInstanceOf(TooManyRequestsException);
  expect(error.message).toBe("refused for a test");
  expect(error.refusal).toBe(refusal);
});
