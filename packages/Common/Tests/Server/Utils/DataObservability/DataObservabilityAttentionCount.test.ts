import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataCheckService from "../../../../Server/Services/DataCheckService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import DataProductService from "../../../../Server/Services/DataProductService";
import DataReconciliationService from "../../../../Server/Services/DataReconciliationService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import DataObservabilityAttentionCount, {
  ATTENTION_COUNT_CACHE_TTL_MS,
  DataObservabilityAttentionCounts,
  sumAttentionCounts,
} from "../../../../Server/Utils/DataObservability/DataObservabilityAttentionCount";
import DataObservabilityReadScope, {
  DataObservabilityScope,
} from "../../../../Server/Utils/DataObservability/DataObservabilityReadScope";
import logger from "../../../../Server/Utils/Logger";
import Includes from "../../../../Types/BaseDatabase/Includes";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { DataCheckHealth } from "../../../../Types/DataObservability/DataObservabilityAttention";
import { MAX_LATENESS_WATCH_IN_SECONDS } from "../../../../Types/DataObservability/DataPipelineSchedule";
import { DataProductStatus } from "../../../../Types/DataObservability/DataProductFreshness";
import { DataReconciliationStatus } from "../../../../Types/DataObservability/DataReconciliation";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../../Types/ObjectID";
import { FindOperator } from "typeorm";

/*
 * HOW MANY THINGS NEED SOMEONE, COUNTED, NEVER LISTED (#6552).
 *
 * The count beside Overview is the Overview's Needs Attention count, asked
 * of what each record keeps: one COUNT per kind on an indexed column, side
 * by side, and the few failed databases read to say each is still
 * connected. No table, check or pipeline row is read. A caller who reads
 * the whole project shares the count for half a minute; a narrowed caller
 * (#6553) counts what they may read, every time.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const NOW: Date = new Date("2026-11-18T12:00:00.000Z");

function id(suffix: string): string {
  return `66666666-6666-4666-8666-${suffix.padStart(12, "0")}`;
}

interface CountCall {
  service: string;
  query: Record<string, unknown>;
}

let counts: Record<string, number>;
let countCalls: Array<CountCall>;
let failedStores: Array<DataStore>;
let storeReads: Array<Record<string, unknown>>;

function store(fields: Record<string, unknown>): DataStore {
  const row: DataStore = new DataStore();

  for (const [column, value] of Object.entries(fields)) {
    (row as unknown as Record<string, unknown>)[column] = value;
  }

  return row;
}

function stubCount(service: { countBy: unknown }, name: string): void {
  jest.spyOn(service as never, "countBy" as never).mockImplementation((async (
    countBy: { query: Record<string, unknown> },
  ) => {
    countCalls.push({ service: name, query: countBy.query });
    const keyed: string = `${name}:${String(
      (countBy.query["dataStoreId"] as ObjectID | undefined)?.toString() || "",
    )}`;
    return new PositiveNumber(
      counts[keyed] !== undefined ? counts[keyed]! : counts[name] || 0,
    );
  }) as never);
}

function callsOf(name: string): Array<Record<string, unknown>> {
  return countCalls
    .filter((call: CountCall): boolean => {
      return call.service === name;
    })
    .map((call: CountCall): Record<string, unknown> => {
      return call.query;
    });
}

// A Raw condition as Postgres reads it: its SQL on a column "c", its parameters named "p".
function rawOf(operator: unknown): { sql: string; values: Array<unknown> } {
  expect(operator).toBeInstanceOf(FindOperator);

  const raw: FindOperator<unknown> = operator as FindOperator<unknown>;
  const parameters: Record<string, unknown> =
    (raw.objectLiteralParameters as Record<string, unknown>) || {};
  let sql: string = raw.getSql!("c");

  for (const name of Object.keys(parameters)) {
    sql = sql.split(`:...${name}`).join(":...p").split(`:${name}`).join(":p");
  }

  return { sql, values: Object.values(parameters) };
}

beforeEach(() => {
  DataObservabilityAttentionCount.forget();
  counts = {
    DataAsset: 4,
    DataPipeline: 0,
    DataCheck: 3,
    DataProduct: 1,
    DataReconciliation: 2,
  };
  countCalls = [];
  storeReads = [];
  failedStores = [
    store({
      _id: id("1"),
      kind: DataStoreKind.PostgreSql,
      connectionString: "postgres://reader@db/orders",
    }),
    // No way in any more: one of the suggestions, as the Overview leaves it out.
    store({ _id: id("2"), kind: DataStoreKind.PostgreSql }),
  ];

  stubCount(DataAssetService, "DataAsset");
  stubCount(DataPipelineService, "DataPipeline");
  stubCount(DataCheckService, "DataCheck");
  stubCount(DataProductService, "DataProduct");
  stubCount(DataReconciliationService, "DataReconciliation");

  jest.spyOn(DataStoreService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
  }) => {
    storeReads.push(findBy.query);
    return failedStores;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  DataObservabilityAttentionCount.forget();
});

const WHOLE: DataObservabilityScope =
  DataObservabilityReadScope.wholeProject(PROJECT);

describe("each kind, counted from what it keeps", () => {
  test("late tables by when they are late, not dropped", async () => {
    await DataObservabilityAttentionCount.countEach({
      projectId: PROJECT,
      now: NOW,
      scope: WHOLE,
    });

    const [late] = callsOf("DataAsset");

    expect(late!["projectId"]).toEqual(PROJECT);
    expect(late!["isDropped"]).toBe(false);
    expect(rawOf(late!["lateAt"])).toEqual({
      sql: "(c <= :p)",
      values: [NOW],
    });
  });

  test("failed pipelines in the last thirty days, and late ones that did not fail", async () => {
    await DataObservabilityAttentionCount.countEach({
      projectId: PROJECT,
      now: NOW,
      scope: WHOLE,
    });

    const [failed, late] = callsOf("DataPipeline");
    const retiredBefore: Date = new Date(
      NOW.getTime() - MAX_LATENESS_WATCH_IN_SECONDS * 1000,
    );

    expect(failed!["lastRunState"]).toEqual(new Includes(["ABORT", "FAIL"]));
    // A run of no known start still counts, as Needs Attention says it.
    expect(rawOf(failed!["lastRunStartedAt"])).toEqual({
      sql: "(c >= :p or c IS NULL)",
      values: [retiredBefore],
    });
    expect(rawOf(late!["lateAt"])).toEqual({
      sql: "(c <= :p)",
      values: [NOW],
    });
    expect(rawOf(late!["lastRunStartedAt"])).toEqual({
      sql: "(c >= :p)",
      values: [retiredBefore],
    });
    // NOT IN the failed states: a failed run is counted once, as failed.
    expect(rawOf(late!["lastRunState"])).toEqual({
      sql: "(c NOT IN (:...p))",
      values: [["ABORT", "FAIL"]],
    });
  });

  test("checks failing or that could not run, by the health kept on each, a reconciliation's own two left out", async () => {
    await DataObservabilityAttentionCount.countEach({
      projectId: PROJECT,
      now: NOW,
      scope: WHOLE,
    });

    const [checks] = callsOf("DataCheck");

    expect(checks!["health"]).toEqual(
      new Includes([DataCheckHealth.Failing, DataCheckHealth.CouldNotRun]),
    );
    expect(rawOf(checks!["dataReconciliationId"])).toEqual({
      sql: "(c IS NULL)",
      values: [],
    });
  });

  test("late data products and drifted or failed reconciliations, by their status", async () => {
    await DataObservabilityAttentionCount.countEach({
      projectId: PROJECT,
      now: NOW,
      scope: WHOLE,
    });

    expect(callsOf("DataProduct")).toEqual([
      { projectId: PROJECT, status: DataProductStatus.Late },
    ]);
    expect(callsOf("DataReconciliation")).toEqual([
      {
        projectId: PROJECT,
        status: new Includes([
          DataReconciliationStatus.Drifted,
          DataReconciliationStatus.Failed,
        ]),
      },
    ]);
  });

  test("watched databases whose collection failed and that are still connected: the failed ones alone are read", async () => {
    const each: DataObservabilityAttentionCounts =
      await DataObservabilityAttentionCount.countEach({
        projectId: PROJECT,
        now: NOW,
        scope: WHOLE,
      });

    expect(each.failedStores).toBe(1);
    expect(storeReads).toHaveLength(1);
    expect(storeReads[0]).toMatchObject({
      projectId: PROJECT,
      isArchived: false,
      isTableHealthEnabled: true,
      tableHealthStatus: "Failed",
    });
  });

  test("the sum of every kind", async () => {
    expect(
      await DataObservabilityAttentionCount.count({
        projectId: PROJECT,
        now: NOW,
        scope: WHOLE,
      }),
    ).toBe(1 + 4 + 0 + 0 + 3 + 1 + 2);
    expect(
      sumAttentionCounts({
        failedStores: 1,
        lateTables: 2,
        failedPipelines: 3,
        latePipelines: 4,
        checks: 5,
        lateDataProducts: 6,
        reconciliations: 7,
      }),
    ).toBe(28);
  });

  test("a kind that cannot be counted counts nothing, and the rest still count", async () => {
    jest
      .spyOn(DataCheckService, "countBy")
      .mockRejectedValue(new Error("The database did not answer."));
    const logged: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {}) as never);

    const each: DataObservabilityAttentionCounts =
      await DataObservabilityAttentionCount.countEach({
        projectId: PROJECT,
        now: NOW,
        scope: WHOLE,
      });

    expect(each.checks).toBe(0);
    expect(each.lateTables).toBe(4);
    expect(logged).toHaveBeenCalled();
  });
});

describe("kept for half a minute, for those who read the whole project", () => {
  test("asked twice, counted once", async () => {
    await DataObservabilityAttentionCount.count({
      projectId: PROJECT,
      now: NOW,
      scope: WHOLE,
    });
    const first: number = countCalls.length;

    expect(
      await DataObservabilityAttentionCount.count({
        projectId: PROJECT,
        now: NOW,
        scope: WHOLE,
      }),
    ).toBe(11);
    expect(countCalls.length).toBe(first);
    expect(ATTENTION_COUNT_CACHE_TTL_MS).toBe(30_000);
  });

  test("callers who ask together share one count", async () => {
    const [a, b] = await Promise.all([
      DataObservabilityAttentionCount.count({
        projectId: PROJECT,
        now: NOW,
        scope: WHOLE,
      }),
      DataObservabilityAttentionCount.count({
        projectId: PROJECT,
        now: NOW,
        scope: WHOLE,
      }),
    ]);

    expect(a).toBe(b);
    expect(callsOf("DataProduct")).toHaveLength(1);
  });

  test("forgotten, it is counted again", async () => {
    await DataObservabilityAttentionCount.count({
      projectId: PROJECT,
      now: NOW,
      scope: WHOLE,
    });
    DataObservabilityAttentionCount.forget(PROJECT);
    counts["DataProduct"] = 5;

    expect(
      await DataObservabilityAttentionCount.count({
        projectId: PROJECT,
        now: NOW,
        scope: WHOLE,
      }),
    ).toBe(15);
  });
});

describe("a caller whose reads are narrowed (#6553)", () => {
  const OWNED_TABLES: Array<string> = [id("101")];
  const NARROWED: DataObservabilityScope = {
    isWholeProject: false,
    assetQuery: { projectId: PROJECT, _id: new Includes(OWNED_TABLES) },
    checkQuery: { projectId: PROJECT, dataAssetId: new Includes(OWNED_TABLES) },
    pipelineQuery: { projectId: PROJECT, _id: new Includes([id("201")]) },
  };

  test("counts with their own reads, and is never kept for anyone else", async () => {
    counts["DataAsset:"] = 1;
    counts[`DataAsset:${id("1")}`] = 0;

    const narrowed: number = await DataObservabilityAttentionCount.count({
      projectId: PROJECT,
      now: NOW,
      scope: NARROWED,
    });
    const tables: Record<string, unknown> = callsOf("DataAsset")[0]!;

    expect(tables["_id"]).toEqual(new Includes(OWNED_TABLES));
    expect(callsOf("DataCheck")[0]!["dataAssetId"]).toEqual(
      new Includes(OWNED_TABLES),
    );
    expect(callsOf("DataPipeline")[0]!["_id"]).toEqual(
      new Includes([id("201")]),
    );
    // The failed database holds no table they may read: not theirs to count.
    expect(narrowed).toBe(1 + 0 + 0 + 3 + 1 + 2);

    // Counted again: a narrowed count is nobody else's.
    countCalls = [];
    await DataObservabilityAttentionCount.count({
      projectId: PROJECT,
      now: NOW,
      scope: NARROWED,
    });
    expect(callsOf("DataProduct")).toHaveLength(1);
  });

  test("a failed database holding a table they may read is counted", async () => {
    counts[`DataAsset:${id("1")}`] = 2;

    const each: DataObservabilityAttentionCounts =
      await DataObservabilityAttentionCount.countEach({
        projectId: PROJECT,
        now: NOW,
        scope: NARROWED,
      });

    expect(each.failedStores).toBe(1);
  });
});
