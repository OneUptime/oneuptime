import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #6624: after an upgrade, product analytics counted only the
 * sessions recorded since; this migration copies the sessions RumSessionV1
 * still keeps into the session and person-month tables.
 *
 * What is pinned here (BackfillProductAnalyticsFromKeptSessionsClickhouse
 * runs it against a real ClickHouse server):
 *
 *   - each view's own SELECT is what copies a day, its columns named in
 *     its order, over one day partition of RumSessionV1, the sessions that
 *     started before the cut-off, and only what the tables keep - the
 *     longest retention, and each application's own;
 *   - the days are read from every node's parts, newest first, and the
 *     deletes it waits for are RumSessionV1's unfinished ones on any node;
 *   - a run keeps the first run's cut-off, copies each day under the
 *     erasure job's lock once no delete of the source is unfinished, the
 *     person-month table before the session table, and records the day
 *     after it; a run that stopped resumes at the next day, and one that
 *     finished copies nothing;
 *   - a delete that does not land, a lock it cannot take, or an insert that
 *     fails stops the run without recording the day;
 *   - the progress lives in Valkey, with a TTL, and is refused without a
 *     connection;
 *   - the erasure job's lock: taken, waited for, refused without Valkey,
 *     and a lease lost while working is not counted as done;
 *   - it runs on the clustered schema, does nothing on rollback, and is
 *     registered once, after KeepProductAnalyticsForTheLongestRetention and
 *     before the last slot.
 */

jest.mock("Common/Server/Services/RumProductAnalyticsSessionService", () => {
  return {
    __esModule: true,
    default: {
      execute: jest.fn(),
      executeQuery: jest.fn(),
      database: {
        getDatasourceOptions: (): { database: string } => {
          return { database: "oneuptime" };
        },
      },
    },
  };
});

jest.mock("Common/Server/Services/RumProductAnalyticsUserService", () => {
  return {
    __esModule: true,
    default: { execute: jest.fn() },
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
    },
  };
});

const valkey: Map<string, { value: string; ttl: number }> = new Map<
  string,
  { value: string; ttl: number }
>();
let valkeyConnected: boolean = true;

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        if (!valkeyConnected) {
          return null;
        }

        return {
          get: (key: string): Promise<string | null> => {
            return Promise.resolve(valkey.get(key)?.value ?? null);
          },
          set: (
            key: string,
            value: string,
            mode: string,
            ttl: number,
          ): Promise<string> => {
            if (mode !== "EX") {
              throw new Error("expected an EX expiry");
            }

            valkey.set(key, { value: value, ttl: ttl });
            return Promise.resolve("OK");
          },
        };
      },
      isConnected: (): boolean => {
        return valkeyConnected;
      },
    },
  };
});

jest.mock("../../../FeatureSet/Workers/Utils/CronLock", () => {
  return {
    __esModule: true,
    CronLockTakeResult: {
      Taken: "Taken",
      HeldByAnotherRun: "HeldByAnotherRun",
      Unavailable: "Unavailable",
    },
    default: { take: jest.fn() },
  };
});

import RumProductAnalyticsSession from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import RumProductAnalyticsUser from "Common/Models/AnalyticsModels/RumProductAnalyticsUser";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import {
  ClickhouseExecuteOptions,
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import RumProductAnalyticsSessionService from "Common/Server/Services/RumProductAnalyticsSessionService";
import RumProductAnalyticsUserService from "Common/Server/Services/RumProductAnalyticsUserService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import {
  ProductAnalyticsRetentionBucket,
  ProductAnalyticsRetentionChoice,
  buildProductAnalyticsRetentionBuckets,
} from "Common/Server/Utils/RumProductAnalytics/RumProductAnalyticsRetention";
import { JSONObject } from "Common/Types/JSON";
import CronLock from "../../../FeatureSet/Workers/Utils/CronLock";
import {
  SESSION_REPLAY_ERASURE_JOB_NAME,
  SESSION_REPLAY_ERASURE_LOCK_RETRY_MS,
  SessionReplayErasureLockError,
  withSessionReplayErasureLock,
} from "../../../FeatureSet/Workers/Utils/SessionReplayErasureLock";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import BackfillProductAnalyticsFromKeptSessions, {
  PRODUCT_ANALYTICS_BACKFILL_DELETE_POLL_MS,
  PRODUCT_ANALYTICS_BACKFILL_MAX_EXECUTION_TIME_IN_SECONDS,
  PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME,
  PRODUCT_ANALYTICS_BACKFILL_PROGRESS_TTL_SECONDS,
  ProductAnalyticsBackfillEnvironment,
  ProductAnalyticsBackfillProgress,
  ProductAnalyticsBackfillState,
  ProductAnalyticsBackfillTarget,
  buildProductAnalyticsBackfillInsert,
  buildProductAnalyticsBackfillKeepClause,
  buildProductAnalyticsBackfillPartitionsQuery,
  buildProductAnalyticsBackfillPendingDeletesQuery,
  getProductAnalyticsBackfillProgressKey,
  getProductAnalyticsBackfillTargets,
  getValkeyProductAnalyticsBackfillProgress,
  readProductAnalyticsBackfillSelect,
} from "../../../FeatureSet/Workers/DataMigrations/BackfillProductAnalyticsFromKeptSessions";

type MockFunction = ReturnType<typeof jest.fn>;

const sessionService: {
  execute: MockFunction;
  executeQuery: MockFunction;
} = RumProductAnalyticsSessionService as unknown as {
  execute: MockFunction;
  executeQuery: MockFunction;
};

const userService: { execute: MockFunction } =
  RumProductAnalyticsUserService as unknown as { execute: MockFunction };

const cronLock: { take: MockFunction } = CronLock as unknown as {
  take: MockFunction;
};

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";
const NOW: Date = new Date("2026-11-18T10:30:00.000Z");
const CUTOFF: Date = new Date("2026-11-18T09:00:00.000Z");

const threeMonths: string = "6600000000000000000000b3";
const twentyFive: string = "66000000000000000000b025";

let savedClusterName: string | undefined;

function targetOf(
  targets: Array<ProductAnalyticsBackfillTarget>,
  tableName: string,
): ProductAnalyticsBackfillTarget {
  return targets.find((target: ProductAnalyticsBackfillTarget): boolean => {
    return target.tableName === tableName;
  })!;
}

function render(statement: Statement): string {
  return statement.query;
}

/* What the mocked ClickHouse answers, query by query. */
interface FakeClickhouse {
  missingTables: Set<string>;
  partitions: Array<string>;
  // One answer per look at the source's unfinished deletes; then none.
  pendingDeletes: Array<JSONObject>;
  failInsertInto: string | null;
}

let fake: FakeClickhouse;
let steps: Array<string>;

function answer(rows: Array<JSONObject>): unknown {
  return {
    json: async (): Promise<{ data: Array<JSONObject> }> => {
      return { data: rows };
    },
  };
}

/* An environment that records what the run did, in order. */
function environmentWith(data?: {
  state?: ProductAnalyticsBackfillState;
  choices?: Array<ProductAnalyticsRetentionChoice>;
  withoutErasures?: ProductAnalyticsBackfillEnvironment["withoutErasures"];
  deleteWaitMs?: number;
}): {
  environment: Partial<ProductAnalyticsBackfillEnvironment>;
  state: ProductAnalyticsBackfillState;
  sleeps: Array<number>;
} {
  const state: ProductAnalyticsBackfillState = data?.state || {
    cutoff: null,
    doneThrough: null,
  };
  const sleeps: Array<number> = [];

  const progress: ProductAnalyticsBackfillProgress = {
    read: async (): Promise<ProductAnalyticsBackfillState> => {
      return { ...state };
    },
    writeCutoff: async (cutoff: Date): Promise<void> => {
      steps.push(`cutoff ${cutoff.toISOString()}`);
      state.cutoff = cutoff;
    },
    writeDoneThrough: async (partition: string): Promise<void> => {
      steps.push(`done ${partition}`);
      state.doneThrough = partition;
    },
  };

  return {
    state: state,
    sleeps: sleeps,
    environment: {
      now: (): Date => {
        return NOW;
      },
      progress: progress,
      withoutErasures:
        data?.withoutErasures ||
        (async <T>(work: () => Promise<T>): Promise<T> => {
          steps.push("lock");
          try {
            return await work();
          } finally {
            steps.push("unlock");
          }
        }),
      retentionChoices: async (): Promise<
        Array<ProductAnalyticsRetentionChoice>
      > => {
        return data?.choices || [];
      },
      sleep: async (ms: number): Promise<void> => {
        sleeps.push(ms);
      },
      deleteWaitMs: data?.deleteWaitMs ?? 60000,
    },
  };
}

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  valkey.clear();
  valkeyConnected = true;
  steps = [];

  fake = {
    missingTables: new Set<string>(),
    partitions: [],
    pendingDeletes: [],
    failInsertInto: null,
  };

  sessionService.executeQuery.mockReset();
  sessionService.executeQuery.mockImplementation(
    async (statement: unknown): Promise<unknown> => {
      const query: string =
        statement instanceof Statement ? statement.query : String(statement);

      if (query.startsWith("EXISTS TABLE ")) {
        const table: string = query.substring("EXISTS TABLE ".length);
        return answer([{ result: fake.missingTables.has(table) ? 0 : 1 }]);
      }

      if (query.includes("system.parts")) {
        return answer(
          fake.partitions.map((partition: string): JSONObject => {
            return { paPartition: partition };
          }),
        );
      }

      if (query.includes("system.mutations")) {
        steps.push("deletes?");
        return answer([fake.pendingDeletes.shift() || { paPending: "0" }]);
      }

      throw new Error(`unexpected query: ${query}`);
    },
  );

  // Each insert, as "insert <table> <day>"; the one failInsertInto names fails.
  const recordInsert: (statement: unknown) => Promise<void> = async (
    statement: unknown,
  ): Promise<void> => {
    const query: string = (statement as Statement).query;
    const table: string = query.split(" ")[2] as string;
    const day: string =
      query.match(/toYYYYMMDD\(startTime\) = ([0-9]+)/)?.[1] || "";

    steps.push(`insert ${table} ${day}`);

    if (fake.failInsertInto === table) {
      throw new Error(`INSERT INTO ${table} failed`);
    }
  };

  for (const service of [sessionService, userService]) {
    service.execute.mockReset();
    service.execute.mockImplementation(recordInsert);
  }

  cronLock.take.mockReset();
});

afterEach(() => {
  if (savedClusterName === undefined) {
    delete process.env[CLUSTER_ENV_KEY];
  } else {
    process.env[CLUSTER_ENV_KEY] = savedClusterName;
  }
});

describe("BackfillProductAnalyticsFromKeptSessions (issue #6624)", () => {
  describe("each view's own SELECT", () => {
    test("names the columns its table has, in the SELECT's order", () => {
      const targets: Array<ProductAnalyticsBackfillTarget> =
        getProductAnalyticsBackfillTargets();

      expect(
        targets.map((target: ProductAnalyticsBackfillTarget): string => {
          return target.tableName;
        }),
      ).toEqual(["RumProductAnalyticsUserV1", "RumProductAnalyticsSessionV1"]);

      for (const [target, model] of [
        [
          targetOf(targets, "RumProductAnalyticsUserV1"),
          new RumProductAnalyticsUser(),
        ],
        [
          targetOf(targets, "RumProductAnalyticsSessionV1"),
          new RumProductAnalyticsSession(),
        ],
      ] as Array<[ProductAnalyticsBackfillTarget, AnalyticsBaseModel]>) {
        expect(target.view.query).toBe(model.materializedViews[0]!.query);

        const columns: Array<string> = readProductAnalyticsBackfillSelect(
          target.view,
        ).columns;

        expect([...columns].sort()).toEqual(
          model.tableColumns
            .map((column: { key: string }): string => {
              return column.key;
            })
            .sort(),
        );
      }
    });

    test("is cut at FROM RumSessionV1, with the person view's own WHERE kept apart", () => {
      const targets: Array<ProductAnalyticsBackfillTarget> =
        getProductAnalyticsBackfillTargets();

      const user: ReturnType<typeof readProductAnalyticsBackfillSelect> =
        readProductAnalyticsBackfillSelect(
          targetOf(targets, "RumProductAnalyticsUserV1").view,
        );

      expect(user.head.startsWith("SELECT\n")).toBe(true);
      expect(user.head.endsWith("\nFROM RumSessionV1\n")).toBe(true);
      expect(user.where).toBe(
        "isFinalized = 1 AND isPinnedCopy = 0 AND (identifiedUserKey != '' OR visitorId != '')",
      );
      expect(user.tail).toBe(
        "GROUP BY projectId, rumApplicationId, personKey, month",
      );

      const session: ReturnType<typeof readProductAnalyticsBackfillSelect> =
        readProductAnalyticsBackfillSelect(
          targetOf(targets, "RumProductAnalyticsSessionV1").view,
        );

      expect(session.where).toBeNull();
      expect(session.tail).toBe(
        "GROUP BY projectId, rumApplicationId, startTime, sessionId",
      );
    });

    test("refuses a view it cannot read", () => {
      expect(() => {
        readProductAnalyticsBackfillSelect({
          name: "x_mv",
          query: "CREATE MATERIALIZED VIEW x_mv TO x AS SELECT 1 FROM y",
        });
      }).toThrow(/no "AS" line/);

      expect(() => {
        readProductAnalyticsBackfillSelect({
          name: "x_mv",
          query:
            "CREATE MATERIALIZED VIEW x_mv\nTO x\nAS\nSELECT\n  projectId,\n  count()\nFROM RumSessionV1\nGROUP BY projectId",
        });
      }).toThrow(/selects "count\(\)" with no name/);

      expect(() => {
        readProductAnalyticsBackfillSelect({
          name: "x_mv",
          query:
            "CREATE MATERIALIZED VIEW x_mv\nTO x\nAS\nSELECT\n  projectId\nFROM LogItemV3\nGROUP BY projectId",
        });
      }).toThrow(/does not read "FROM RumSessionV1"/);
    });
  });

  describe("a day's copy", () => {
    const keep: () => Statement = (): Statement => {
      return buildProductAnalyticsBackfillKeepClause({
        buckets: [],
        floor: new Date("2024-12-01T00:00:00.000Z"),
      });
    };

    test("is the session view's SELECT over one partition, before the cut-off, kept rows only", () => {
      const statement: Statement = buildProductAnalyticsBackfillInsert({
        target: targetOf(
          getProductAnalyticsBackfillTargets(),
          "RumProductAnalyticsSessionV1",
        ),
        partition: "20261116",
        cutoff: CUTOFF,
        keep: keep(),
      });

      const query: string = render(statement);

      expect(query).toMatch(
        /^INSERT INTO RumProductAnalyticsSessionV1 \(projectId, rumApplicationId, startTime, sessionId, endTime, /,
      );
      expect(query).toContain(
        "\nFROM RumSessionV1\nWHERE toYYYYMMDD(startTime) = 20261116 AND startTime < {p0:DateTime64(9)} AND (startTime >= {p1:DateTime64(9)})\nGROUP BY projectId, rumApplicationId, startTime, sessionId",
      );
      expect(statement.query_params).toEqual({
        p0: "2026-11-18 09:00:00.000000000",
        p1: "2024-12-01 00:00:00.000000000",
      });
    });

    test("keeps the person view's own WHERE after its own", () => {
      const query: string = render(
        buildProductAnalyticsBackfillInsert({
          target: targetOf(
            getProductAnalyticsBackfillTargets(),
            "RumProductAnalyticsUserV1",
          ),
          partition: "20261116",
          cutoff: CUTOFF,
          keep: keep(),
        }),
      );

      expect(query).toMatch(
        /^INSERT INTO RumProductAnalyticsUserV1 \(projectId, rumApplicationId, personKey, month, firstSeen, lastSeen, sessions, deviceType, countryCode\)\n/,
      );
      expect(query).toContain(
        "AND (startTime >= {p1:DateTime64(9)}) AND (isFinalized = 1 AND isPinnedCopy = 0 AND (identifiedUserKey != '' OR visitorId != ''))\nGROUP BY projectId, rumApplicationId, personKey, month",
      );
    });

    test("refuses anything but a day partition", () => {
      for (const partition of ["2026111", "202611160", "20261116 OR 1", ""]) {
        expect(() => {
          buildProductAnalyticsBackfillInsert({
            target: getProductAnalyticsBackfillTargets()[0]!,
            partition: partition,
            cutoff: CUTOFF,
            keep: keep(),
          });
        }).toThrow(/is not a day partition/);
      }
    });

    test("leaves out what the longest retention and each application's own no longer keep", () => {
      const buckets: Array<ProductAnalyticsRetentionBucket> =
        buildProductAnalyticsRetentionBuckets({
          choices: [
            { rumApplicationId: threeMonths, months: 3 },
            { rumApplicationId: twentyFive, months: 25 },
          ],
          now: NOW,
        });

      const statement: Statement = buildProductAnalyticsBackfillKeepClause({
        buckets: buckets,
        floor: new Date("2024-12-01T00:00:00.000Z"),
      });

      expect(statement.query).toBe(
        "startTime >= {p0:DateTime64(9)} AND NOT (startTime < {p1:DateTime64(9)} AND rumApplicationId IN {p2:Array(String)}) AND NOT (startTime < {p3:DateTime64(9)} AND rumApplicationId NOT IN {p4:Array(String)})",
      );
      expect(statement.query_params).toEqual({
        p0: "2024-12-01 00:00:00.000000000",
        // 3 months: September, October and the running November.
        p1: "2026-09-01 00:00:00.000000000",
        p2: [threeMonths],
        // The default 13 months, for everyone who chose no more.
        p3: "2025-11-01 00:00:00.000000000",
        p4: [twentyFive],
      });
    });
  });

  describe("what it reads of the cluster", () => {
    test("the days of RumSessionV1 on every node, from the floor to the cut-off, newest first", () => {
      process.env[CLUSTER_ENV_KEY] = "prod'cluster";

      const statement: Statement = buildProductAnalyticsBackfillPartitionsQuery(
        {
          databaseName: "oneuptime",
          floor: new Date("2024-12-01T00:00:00.000Z"),
          cutoff: CUTOFF,
        },
      );

      expect(statement.query).toBe(
        "SELECT DISTINCT partition AS paPartition FROM clusterAllReplicas('prod\\'cluster', system.parts) WHERE database = 'oneuptime' AND table = 'RumSessionV1Local' AND active AND partition >= toString(toYYYYMMDD({p0:DateTime64(9)})) AND partition <= toString(toYYYYMMDD({p1:DateTime64(9)})) ORDER BY paPartition DESC",
      );
    });

    test("the unfinished deletes of RumSessionV1 on every node, in both ways ClickHouse writes them", () => {
      expect(
        buildProductAnalyticsBackfillPendingDeletesQuery({
          databaseName: "oneuptime",
        }),
      ).toBe(
        "SELECT toUInt64(count()) AS paPending, any(mutation_id) AS paMutation, any(latest_fail_reason) AS paFailure FROM clusterAllReplicas('oneuptime', system.mutations) WHERE database = 'oneuptime' AND table = 'RumSessionV1Local' AND NOT is_done AND (position(command, 'DELETE WHERE') > 0 OR position(command, '_row_exists') > 0)",
      );
    });
  });

  describe("a run", () => {
    test("keeps its cut-off, then copies each day newest first under the lock, person rows first, and records it", async () => {
      fake.partitions = ["20261118", "20261117"];

      const run: ReturnType<typeof environmentWith> = environmentWith();
      const migration: BackfillProductAnalyticsFromKeptSessions =
        new BackfillProductAnalyticsFromKeptSessions(run.environment);

      await migration.migrate();

      expect(steps).toEqual([
        `cutoff ${NOW.toISOString()}`,
        "deletes?",
        "lock",
        "deletes?",
        "insert RumProductAnalyticsUserV1 20261118",
        "insert RumProductAnalyticsSessionV1 20261118",
        "unlock",
        "done 20261118",
        "deletes?",
        "lock",
        "deletes?",
        "insert RumProductAnalyticsUserV1 20261117",
        "insert RumProductAnalyticsSessionV1 20261117",
        "unlock",
        "done 20261117",
      ]);

      expect(migration.lastResult).toEqual({
        cutoff: NOW,
        daysCopied: ["20261118", "20261117"],
        daysAlreadyDone: 0,
      });
    });

    test("names each insert and holds it to its time, every shard's share written", async () => {
      fake.partitions = ["20261117"];

      await new BackfillProductAnalyticsFromKeptSessions(
        environmentWith().environment,
      ).migrate();

      const options: Array<ClickhouseExecuteOptions> = [
        userService.execute.mock.calls[0]![1] as ClickhouseExecuteOptions,
        sessionService.execute.mock.calls[0]![1] as ClickhouseExecuteOptions,
      ];

      expect(
        options.map((option: ClickhouseExecuteOptions) => {
          return option.queryId;
        }),
      ).toEqual([
        `${PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME}:RumProductAnalyticsUserV1:20261117`,
        `${PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME}:RumProductAnalyticsSessionV1:20261117`,
      ]);

      for (const option of options) {
        expect(option.useMigrationConnection).toBe(true);
        expect(option.clickhouseSettings).toEqual({
          ...MigrationExecuteOptions.clickhouseSettings,
          max_execution_time:
            PRODUCT_ANALYTICS_BACKFILL_MAX_EXECUTION_TIME_IN_SECONDS,
          insert_distributed_sync: 1,
          optimize_aggregation_in_order: 1,
        });
      }
    });

    test("copies only before the first run's cut-off, and what each application keeps", async () => {
      fake.partitions = ["20261117"];

      await new BackfillProductAnalyticsFromKeptSessions(
        environmentWith({
          state: { cutoff: CUTOFF, doneThrough: null },
          choices: [{ rumApplicationId: threeMonths, months: 3 }],
        }).environment,
      ).migrate();

      const statement: Statement = sessionService.execute.mock
        .calls[0]![0] as Statement;

      expect(statement.query_params["p0"]).toBe(
        "2026-11-18 09:00:00.000000000",
      );
      expect(statement.query).toContain(
        "rumApplicationId IN {p3:Array(String)}",
      );
      expect(statement.query_params["p3"]).toEqual([threeMonths]);
      expect(steps).not.toContain(`cutoff ${NOW.toISOString()}`);
    });

    test("a run that stopped resumes at the day after the last one done", async () => {
      fake.partitions = ["20261118", "20261117", "20261116", "20261115"];

      const run: ReturnType<typeof environmentWith> = environmentWith({
        state: { cutoff: CUTOFF, doneThrough: "20261117" },
      });
      const migration: BackfillProductAnalyticsFromKeptSessions =
        new BackfillProductAnalyticsFromKeptSessions(run.environment);

      await migration.migrate();

      expect(
        steps.filter((step: string): boolean => {
          return step.startsWith("insert") || step.startsWith("done");
        }),
      ).toEqual([
        "insert RumProductAnalyticsUserV1 20261116",
        "insert RumProductAnalyticsSessionV1 20261116",
        "done 20261116",
        "insert RumProductAnalyticsUserV1 20261115",
        "insert RumProductAnalyticsSessionV1 20261115",
        "done 20261115",
      ]);
      expect(migration.lastResult?.daysAlreadyDone).toBe(2);
    });

    test("a second run of a finished one copies nothing", async () => {
      fake.partitions = ["20261118", "20261117"];

      const run: ReturnType<typeof environmentWith> = environmentWith();

      await new BackfillProductAnalyticsFromKeptSessions(
        run.environment,
      ).migrate();

      steps = [];
      sessionService.execute.mockClear();
      userService.execute.mockClear();

      const second: BackfillProductAnalyticsFromKeptSessions =
        new BackfillProductAnalyticsFromKeptSessions(run.environment);

      await second.migrate();

      expect(userService.execute).not.toHaveBeenCalled();
      expect(sessionService.execute).not.toHaveBeenCalled();
      expect(steps).toEqual([]);
      expect(second.lastResult).toEqual({
        cutoff: NOW,
        daysCopied: [],
        daysAlreadyDone: 2,
      });
    });

    test("waits for the deletes of RumSessionV1 to land before it copies a day", async () => {
      fake.partitions = ["20261117"];
      fake.pendingDeletes = [
        { paPending: "1", paMutation: "mutation_7.txt", paFailure: "" },
        { paPending: "0" },
        // Inside the lock: an erasure ran in between.
        { paPending: "2", paMutation: "mutation_8.txt", paFailure: "" },
        { paPending: "0" },
      ];

      const run: ReturnType<typeof environmentWith> = environmentWith();

      await new BackfillProductAnalyticsFromKeptSessions(
        run.environment,
      ).migrate();

      expect(steps).toEqual([
        `cutoff ${NOW.toISOString()}`,
        "deletes?",
        "deletes?",
        "lock",
        "deletes?",
        "deletes?",
        "insert RumProductAnalyticsUserV1 20261117",
        "insert RumProductAnalyticsSessionV1 20261117",
        "unlock",
        "done 20261117",
      ]);
      expect(run.sleeps).toEqual([
        PRODUCT_ANALYTICS_BACKFILL_DELETE_POLL_MS,
        PRODUCT_ANALYTICS_BACKFILL_DELETE_POLL_MS,
      ]);
    });

    test("a delete that does not land stops the run, nothing copied or recorded", async () => {
      fake.partitions = ["20261117"];
      fake.pendingDeletes = [
        {
          paPending: "3",
          paMutation: "0000000042",
          paFailure: "Memory limit exceeded",
        },
      ];

      await expect(
        new BackfillProductAnalyticsFromKeptSessions(
          environmentWith({ deleteWaitMs: 0 }).environment,
        ).migrate(),
      ).rejects.toThrow(
        "3 delete(s) of RumSessionV1 have not landed (mutation 0000000042, failing: Memory limit exceeded)",
      );

      expect(userService.execute).not.toHaveBeenCalled();
      expect(sessionService.execute).not.toHaveBeenCalled();
      expect(steps).not.toContain("done 20261117");
    });

    test("a lock it cannot take stops the run, nothing copied or recorded", async () => {
      fake.partitions = ["20261117"];

      await expect(
        new BackfillProductAnalyticsFromKeptSessions(
          environmentWith({
            withoutErasures: async (): Promise<never> => {
              throw new SessionReplayErasureLockError("no lock");
            },
          }).environment,
        ).migrate(),
      ).rejects.toThrow("no lock");

      expect(userService.execute).not.toHaveBeenCalled();
      expect(steps).not.toContain("done 20261117");
    });

    test("an insert that fails stops the run, and its day is not recorded", async () => {
      fake.partitions = ["20261118", "20261117"];
      fake.failInsertInto = "RumProductAnalyticsSessionV1";

      await expect(
        new BackfillProductAnalyticsFromKeptSessions(
          environmentWith().environment,
        ).migrate(),
      ).rejects.toThrow("INSERT INTO RumProductAnalyticsSessionV1 failed");

      expect(
        steps.filter((step: string): boolean => {
          return step.startsWith("done");
        }),
      ).toEqual([]);
    });

    test("an install without the RUM tables has nothing to copy", async () => {
      fake.missingTables.add("RumSessionV1");
      fake.partitions = ["20261117"];

      const run: ReturnType<typeof environmentWith> = environmentWith();

      await new BackfillProductAnalyticsFromKeptSessions(
        run.environment,
      ).migrate();

      expect(steps).toEqual([]);
      expect(run.state.cutoff).toBeNull();
    });

    test("an unexpected partition name stops the run before anything is copied", async () => {
      fake.partitions = ["202611"];

      await expect(
        new BackfillProductAnalyticsFromKeptSessions(
          environmentWith().environment,
        ).migrate(),
      ).rejects.toThrow('unexpected RumSessionV1 partition "202611"');

      expect(userService.execute).not.toHaveBeenCalled();
    });
  });

  describe("its progress, in Valkey", () => {
    test("is kept with a TTL, and read back", async () => {
      const progress: ProductAnalyticsBackfillProgress =
        getValkeyProductAnalyticsBackfillProgress(
          PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME,
        );

      expect(await progress.read()).toEqual({
        cutoff: null,
        doneThrough: null,
      });

      await progress.writeCutoff(CUTOFF);
      await progress.writeDoneThrough("20261116");

      expect(await progress.read()).toEqual({
        cutoff: CUTOFF,
        doneThrough: "20261116",
      });

      expect(
        valkey.get(
          getProductAnalyticsBackfillProgressKey(
            PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME,
            "cutoff",
          ),
        ),
      ).toEqual({
        value: CUTOFF.toISOString(),
        ttl: PRODUCT_ANALYTICS_BACKFILL_PROGRESS_TTL_SECONDS,
      });
      expect(
        getProductAnalyticsBackfillProgressKey(
          PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME,
          "done-through",
        ),
      ).toBe(
        "product-analytics-backfill:BackfillProductAnalyticsFromKeptSessions:done-through",
      );
    });

    test("reads anything it did not write as no progress", async () => {
      valkey.set(
        getProductAnalyticsBackfillProgressKey(
          PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME,
          "cutoff",
        ),
        { value: "not a date", ttl: 1 },
      );
      valkey.set(
        getProductAnalyticsBackfillProgressKey(
          PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME,
          "done-through",
        ),
        { value: "2026", ttl: 1 },
      );

      expect(
        await getValkeyProductAnalyticsBackfillProgress(
          PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME,
        ).read(),
      ).toEqual({ cutoff: null, doneThrough: null });
    });

    test("is refused without a connection", async () => {
      valkeyConnected = false;

      await expect(
        getValkeyProductAnalyticsBackfillProgress(
          PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME,
        ).read(),
      ).rejects.toThrow("Valkey is not connected");
    });
  });

  describe("the erasure job's lock", () => {
    function taking(
      results: Array<string>,
      deadlines: Array<JobDeadline>,
      released: Array<string>,
    ): void {
      cronLock.take.mockImplementation((async (data: {
        jobName: string;
        deadline: JobDeadline;
      }): Promise<unknown> => {
        expect(data.jobName).toBe(SESSION_REPLAY_ERASURE_JOB_NAME);
        deadlines.push(data.deadline);
        const result: string = results.shift() || "Taken";
        return {
          result: result,
          release: async (): Promise<void> => {
            released.push(result);
          },
        };
      }) as never);
    }

    test("is the job's own name", () => {
      expect(SESSION_REPLAY_ERASURE_JOB_NAME).toBe(
        "Rum:ProcessSessionErasureRequests",
      );

      const job: string = fs.readFileSync(
        path.resolve(
          __dirname,
          "..",
          "..",
          "..",
          "FeatureSet",
          "Workers",
          "Jobs",
          "Rum",
          "ProcessSessionErasureRequests.ts",
        ),
        "utf8",
      );

      expect(job).toContain(
        "const JOB_NAME: string = SESSION_REPLAY_ERASURE_JOB_NAME;",
      );
    });

    test("runs the work while it holds the lock, and gives it back", async () => {
      const released: Array<string> = [];
      taking(["Taken"], [], released);

      const order: Array<string> = [];

      expect(
        await withSessionReplayErasureLock({
          holder: "test",
          waitMs: 1000,
          work: async (): Promise<string> => {
            order.push("work");
            return "done";
          },
        }),
      ).toBe("done");

      expect(order).toEqual(["work"]);
      expect(released).toEqual(["Taken"]);
    });

    test("waits for a run of the job to finish", async () => {
      const sleeps: Array<number> = [];
      taking(["HeldByAnotherRun", "HeldByAnotherRun", "Taken"], [], []);

      await withSessionReplayErasureLock({
        holder: "test",
        waitMs: 60000,
        work: async (): Promise<void> => {
          return;
        },
        sleep: async (ms: number): Promise<void> => {
          sleeps.push(ms);
        },
      });

      expect(sleeps).toEqual([
        SESSION_REPLAY_ERASURE_LOCK_RETRY_MS,
        SESSION_REPLAY_ERASURE_LOCK_RETRY_MS,
      ]);
    });

    test("gives up on a run that holds it too long, without working", async () => {
      taking(["HeldByAnotherRun"], [], []);
      const work: MockFunction = jest.fn();

      await expect(
        withSessionReplayErasureLock({
          holder: "test",
          waitMs: 0,
          work: work as never,
        }),
      ).rejects.toThrow(/held its lock for longer than/);

      expect(work).not.toHaveBeenCalled();
    });

    test("refuses to work without Valkey", async () => {
      taking(["Unavailable"], [], []);
      const work: MockFunction = jest.fn();

      await expect(
        withSessionReplayErasureLock({
          holder: "test",
          waitMs: 60000,
          work: work as never,
        }),
      ).rejects.toThrow(/Valkey is not reachable/);

      expect(work).not.toHaveBeenCalled();
    });

    test("does not count work done after the lock was lost", async () => {
      const deadlines: Array<JobDeadline> = [];
      const released: Array<string> = [];
      taking(["Taken"], deadlines, released);

      await expect(
        withSessionReplayErasureLock({
          holder: "test",
          waitMs: 1000,
          work: async (): Promise<void> => {
            // What CronLock does when it finds its lease gone.
            deadlines[0]!.end(new Error("lease lost"));
          },
        }),
      ).rejects.toThrow(/lost the lock of Rum:ProcessSessionErasureRequests/);

      expect(released).toEqual(["Taken"]);
    });

    test("holds a run's day: the default environment copies under it", async () => {
      fake.partitions = ["20261117"];
      taking(["Taken"], [], []);

      const run: ReturnType<typeof environmentWith> = environmentWith();
      delete run.environment.withoutErasures;

      await new BackfillProductAnalyticsFromKeptSessions(
        run.environment,
      ).migrate();

      expect(cronLock.take).toHaveBeenCalledTimes(1);
      expect(userService.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe("as a data migration", () => {
    test("runs on the clustered schema and does nothing on rollback", async () => {
      const migration: BackfillProductAnalyticsFromKeptSessions =
        new BackfillProductAnalyticsFromKeptSessions();

      expect(migration).toBeInstanceOf(DataMigrationBase);
      expect(migration.name).toBe(PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME);
      expect(migration.runsInClusterMode()).toBe(true);
      await expect(migration.rollback()).resolves.toBeUndefined();
    });

    test("is registered once, after the retention migration and before the last slot", () => {
      const index: string = fs
        .readFileSync(
          path.resolve(
            __dirname,
            "..",
            "..",
            "..",
            "FeatureSet",
            "Workers",
            "DataMigrations",
            "Index.ts",
          ),
          "utf8",
        )
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

      const registered: Array<string> = Array.from(
        index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });

      expect(
        registered.filter((name: string): boolean => {
          return name === PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(
        registered.indexOf(PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME),
      ).toBeGreaterThan(
        registered.indexOf("KeepProductAnalyticsForTheLongestRetention"),
      );
      expect(
        registered.indexOf(PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME),
      ).toBeGreaterThan(
        registered.indexOf("ReadWebAppVersionsInProductAnalyticsSessions"),
      );
      expect(registered[registered.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
    });
  });
});
