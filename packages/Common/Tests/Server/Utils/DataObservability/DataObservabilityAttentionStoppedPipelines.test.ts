import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataObservabilityAttentionReader from "../../../../Server/Utils/DataObservability/DataObservabilityAttentionReader";
import DataObservabilityReadScope, {
  DataObservabilityScope,
} from "../../../../Server/Utils/DataObservability/DataObservabilityReadScope";
import logger from "../../../../Server/Utils/Logger";
import {
  DataCircuitBreakerReason,
  DataCircuitBreakerReasonKind,
} from "../../../../Types/DataObservability/DataCircuitBreaker";
import {
  DataAttentionItem,
  DataAttentionKind,
} from "../../../../Types/DataObservability/DataObservabilityAttention";
import { MAX_LATENESS_WATCH_IN_SECONDS } from "../../../../Types/DataObservability/DataPipelineSchedule";
import { NO_BREAK_SPACE } from "../../../../Types/NoBreakSpaces";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A PIPELINE ITS CIRCUIT BREAKER STOPPED, IN NEEDS ATTENTION (#6548).
 *
 *   - it is one item, "Pipeline Stopped", since the breaker first stopped
 *     it - told of instead of its failed or late run, which the stop
 *     explains, so Needs Attention names the pipeline once;
 *   - its message is its first reason in a sentence, and how many more -
 *     of the reasons about tables its reader may read: a table they may
 *     not read is never named;
 *   - a month on, like a failed run, it is no longer told of.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;

function id(index: number): string {
  return `77777777-7777-4777-8777-${index.toString().padStart(12, "0")}`;
}

const PIPELINE: string = id(1);
const ORDERS: string = id(11);
const SALARIES: string = id(12);
const CUSTOMERS: string = id(13);

const ON_ORDERS: DataCircuitBreakerReason = {
  kind: DataCircuitBreakerReasonKind.CheckFailing,
  dataAssetId: ORDERS,
  table: "public.orders",
  database: "warehouse",
  check: "unique order id",
  dataCheckId: id(21),
  lateBySeconds: 0,
};
const ON_SALARIES: DataCircuitBreakerReason = {
  kind: DataCircuitBreakerReasonKind.CheckFailing,
  dataAssetId: SALARIES,
  table: "hr.salaries",
  database: "warehouse",
  check: "salary is never negative",
  dataCheckId: id(22),
  lateBySeconds: 0,
};
const ON_CUSTOMERS: DataCircuitBreakerReason = {
  kind: DataCircuitBreakerReasonKind.TableLate,
  dataAssetId: CUSTOMERS,
  table: "public.customers",
  database: null,
  check: null,
  dataCheckId: null,
  lateBySeconds: 7_200,
};

function pipeline(fields: Partial<Record<string, unknown>>): DataPipeline {
  const row: DataPipeline = new DataPipeline();

  row._id = PIPELINE;
  row.jobName = "orders_daily";
  row.jobNamespace = "airflow://prod";

  for (const [column, value] of Object.entries(fields)) {
    (row as unknown as Record<string, unknown>)[column] = value;
  }

  return row;
}

function items(
  rows: Array<DataPipeline>,
  readable?: Set<string> | null,
): Array<DataAttentionItem> {
  return DataObservabilityAttentionReader.getPipelineItems(rows, NOW, readable);
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a stopped pipeline is told of once, as stopped", () => {
  test("one item, since the breaker first stopped it, naming its first reason", () => {
    const stoppedAt: Date = new Date(NOW.getTime() - 3 * HOUR);

    expect(
      items([
        pipeline({
          circuitBreakerStoppedAt: stoppedAt,
          circuitBreakerReasons: [ON_ORDERS],
          lastRunState: "COMPLETE",
          lastRunStartedAt: new Date(NOW.getTime() - 26 * HOUR),
        }),
      ]),
    ).toEqual([
      expect.objectContaining({
        kind: DataAttentionKind.PipelineStopped,
        name: "orders_daily",
        where: "airflow://prod",
        message:
          "The check unique order id is failing on public.orders (warehouse).",
        since: stoppedAt.toISOString(),
        dataPipelineId: PIPELINE,
        overdueBySeconds: 0,
        alert: null,
      }),
    ]);
  });

  test("its failed run is not told of again: the stop explains it", () => {
    expect(
      items([
        pipeline({
          circuitBreakerStoppedAt: new Date(NOW.getTime() - HOUR),
          circuitBreakerReasons: [ON_ORDERS],
          lastRunState: "FAIL",
          lastRunStartedAt: new Date(NOW.getTime() - 2 * HOUR),
          lastErrorMessage: "the circuit breaker said stop",
        }),
      ]).map((item: DataAttentionItem): DataAttentionKind => {
        return item.kind;
      }),
    ).toEqual([DataAttentionKind.PipelineStopped]);
  });

  test("nor a run that has not started when it usually does", () => {
    expect(
      items([
        pipeline({
          circuitBreakerStoppedAt: new Date(NOW.getTime() - HOUR),
          lastRunState: "COMPLETE",
          lastRunStartedAt: new Date(NOW.getTime() - 50 * HOUR),
          expectedRunIntervalInSeconds: 24 * 60 * 60,
        }),
      ]).map((item: DataAttentionItem): DataAttentionKind => {
        return item.kind;
      }),
    ).toEqual([DataAttentionKind.PipelineStopped]);
  });

  test("without the stop, the same pipeline is late, as it always was", () => {
    expect(
      items([
        pipeline({
          lastRunState: "COMPLETE",
          lastRunStartedAt: new Date(NOW.getTime() - 50 * HOUR),
          expectedRunIntervalInSeconds: 24 * 60 * 60,
        }),
      ]).map((item: DataAttentionItem): DataAttentionKind => {
        return item.kind;
      }),
    ).toEqual([DataAttentionKind.PipelineLate]);
  });

  test("a month on, a stop is no longer told of", () => {
    expect(
      items([
        pipeline({
          circuitBreakerStoppedAt: new Date(
            NOW.getTime() - (MAX_LATENESS_WATCH_IN_SECONDS + 60) * 1000,
          ),
          circuitBreakerReasons: [ON_ORDERS],
          lastRunState: "FAIL",
        }),
      ]),
    ).toEqual([]);
  });
});

describe("what its message names", () => {
  test("the first reason, then how many more", () => {
    const stopped: DataPipeline = pipeline({
      circuitBreakerStoppedAt: new Date(NOW.getTime() - HOUR),
      circuitBreakerReasons: [ON_ORDERS, ON_CUSTOMERS],
    });

    expect(items([stopped])[0]!.message).toBe(
      "The check unique order id is failing on public.orders (warehouse). 1 more reason.",
    );

    stopped.circuitBreakerReasons = [ON_ORDERS, ON_SALARIES, ON_CUSTOMERS];

    expect(items([stopped])[0]!.message).toBe(
      "The check unique order id is failing on public.orders (warehouse). 2 more reasons.",
    );
  });

  test("a reason about a table its reader may not read is never named, nor counted", () => {
    const stopped: DataPipeline = pipeline({
      circuitBreakerStoppedAt: new Date(NOW.getTime() - HOUR),
      circuitBreakerReasons: [ON_SALARIES, ON_CUSTOMERS],
    });

    expect(items([stopped], new Set([CUSTOMERS]))[0]!.message).toBe(
      `public.customers is late by 2${NO_BREAK_SPACE}hours.`,
    );
  });

  test("with no reason its reader may read, it says no more than the kind does", () => {
    const stopped: DataPipeline = pipeline({
      circuitBreakerStoppedAt: new Date(NOW.getTime() - HOUR),
      circuitBreakerReasons: [ON_SALARIES],
    });

    expect(items([stopped], new Set())[0]!.message).toBeNull();
    expect(
      items([pipeline({ circuitBreakerStoppedAt: NOW })])[0]!.message,
    ).toBeNull();
  });
});

describe("the tables a reader may read, of those the stops name", () => {
  const WHOLE: DataObservabilityScope =
    DataObservabilityReadScope.wholeProject(PROJECT);
  const NARROWED: DataObservabilityScope = {
    isWholeProject: false,
    assetQuery: { projectId: PROJECT, ownedOnly: true } as never,
    checkQuery: { projectId: PROJECT },
    pipelineQuery: { projectId: PROJECT },
  };

  test("a reader of the whole project reads every one, with nothing asked", async () => {
    const asked: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataObservabilityReadScope,
      "getReadableIds",
    );

    await expect(
      DataObservabilityAttentionReader.getReadableStopTables({
        pipelines: [
          pipeline({
            circuitBreakerStoppedAt: NOW,
            circuitBreakerReasons: [ON_ORDERS],
          }),
        ],
        scope: WHOLE,
      }),
    ).resolves.toBeNull();
    expect(asked).not.toHaveBeenCalled();
  });

  test("a narrowed reader is asked about the stopped pipelines' tables alone, once", async () => {
    const asked: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataObservabilityReadScope, "getReadableIds")
      .mockResolvedValue(new Set([ORDERS]) as never);

    const readable: Set<string> | null =
      await DataObservabilityAttentionReader.getReadableStopTables({
        pipelines: [
          pipeline({
            circuitBreakerStoppedAt: NOW,
            circuitBreakerReasons: [ON_ORDERS, ON_SALARIES],
          }),
          // Saying go: its old reasons are not asked about.
          pipeline({ circuitBreakerReasons: [ON_CUSTOMERS] }),
        ],
        scope: NARROWED,
      });

    expect(readable).toEqual(new Set([ORDERS]));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(asked.mock.calls[0]![0]).toMatchObject({
      service: DataAssetService,
      query: NARROWED.assetQuery,
      ids: [ORDERS, SALARIES],
    });
  });

  test("no stop: nothing to ask, and nothing readable", async () => {
    const asked: ReturnType<typeof jest.spyOn> = jest.spyOn(
      DataObservabilityReadScope,
      "getReadableIds",
    );

    await expect(
      DataObservabilityAttentionReader.getReadableStopTables({
        pipelines: [pipeline({})],
        scope: NARROWED,
      }),
    ).resolves.toEqual(new Set());
    expect(asked).not.toHaveBeenCalled();
  });

  test("a read that fails names no table, never one the reader may not read", async () => {
    jest
      .spyOn(DataObservabilityReadScope, "getReadableIds")
      .mockRejectedValue(new Error("The database did not answer.") as never);

    await expect(
      DataObservabilityAttentionReader.getReadableStopTables({
        pipelines: [
          pipeline({
            circuitBreakerStoppedAt: NOW,
            circuitBreakerReasons: [ON_ORDERS],
          }),
        ],
        scope: NARROWED,
      }),
    ).resolves.toEqual(new Set());
  });
});
