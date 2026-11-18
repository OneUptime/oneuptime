import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import RumProductAnalyticsSession from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import RumProductAnalyticsUser from "Common/Models/AnalyticsModels/RumProductAnalyticsUser";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import RumProductAnalyticsSessionService from "Common/Server/Services/RumProductAnalyticsSessionService";
import RumProductAnalyticsUserService from "Common/Server/Services/RumProductAnalyticsUserService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import RumProductAnalyticsReadService from "Common/Server/Utils/RumProductAnalytics/RumProductAnalyticsReadService";
import AnalyticsTableEngine from "Common/Types/AnalyticsDatabase/AnalyticsTableEngine";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * BackfillProductAnalyticsFromKeptSessions against a real ClickHouse
 * (issue #6624), under both query analyzers.
 *
 * The schema is production's on one node: each table a local one behind a
 * Distributed table on the server's own "default" cluster, and the two
 * product analytics views on the local RumSessionV1, as boot creates them
 * (without ON CLUSTER: the test server has no Keeper). Sessions recorded
 * before the views existed sit in RumSessionV1 alone; a few are recorded
 * after, which the views file. Then:
 *
 *   - while a delete of RumSessionV1 has not landed (merges stopped), a run
 *     copies nothing and fails, so no session an erasure is removing is
 *     copied; once it lands, the erased session is not copied;
 *   - every session started before the cut-off and within what the tables
 *     keep is copied once - folded with what the views filed - and each
 *     application's retention and the longest one leave out what they no
 *     longer keep, as does the cut-off;
 *   - the person-month rows count each person's finished sessions once;
 *   - the "counting since" date moves back to the oldest session kept;
 *   - a second run copies nothing, and a run that lost its progress copies
 *     again without changing a single count.
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing. Locally:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/DataMigrations/BackfillProductAnalyticsFromKeptSessionsClickhouse.test.ts
 * ------------------------------------------------------------------
 */

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

import BackfillProductAnalyticsFromKeptSessions, {
  ProductAnalyticsBackfillEnvironment,
  ProductAnalyticsBackfillState,
} from "../../../FeatureSet/Workers/DataMigrations/BackfillProductAnalyticsFromKeptSessions";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";
const DAY_MS: number = 24 * 60 * 60 * 1000;

const projectId: ObjectID = new ObjectID("6600000000000000000000e1");
const keepsDefault: ObjectID = new ObjectID("6600000000000000000000e2");
const keepsThree: ObjectID = new ObjectID("6600000000000000000000e3");
const keepsTwentyFive: ObjectID = new ObjectID("6600000000000000000000e4");

/* The first run's cut-off: an hour ago, to the second. */
const CUTOFF: Date = new Date(
  Math.floor(Date.now() / 1000) * 1000 - 60 * 60 * 1000,
);

function daysAgo(days: number): Date {
  return new Date(CUTOFF.getTime() - days * DAY_MS);
}

/* The 10th of the month `months` before the cut-off's. */
function monthsAgo(months: number): Date {
  return new Date(
    Date.UTC(CUTOFF.getUTCFullYear(), CUTOFF.getUTCMonth() - months, 10, 12),
  );
}

function monthOf(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    .toISOString()
    .substring(0, 10);
}

interface SessionRow {
  id: string;
  application: ObjectID;
  start: Date;
  version: number;
  isFinalized: boolean;
  durationMs: number;
  userKey: string;
  visitorId: string;
}

function session(
  id: string,
  application: ObjectID,
  start: Date,
  overrides?: Partial<SessionRow>,
): SessionRow {
  return {
    id: id.padEnd(32, "0"),
    application: application,
    start: start,
    version: 2,
    isFinalized: true,
    durationMs: 60000,
    userKey: "",
    visitorId: `visitor-${id}`,
    ...overrides,
  };
}

/* Recorded before the views existed: RumSessionV1 alone holds them. */
const recentWithAProvisionalHeader: Array<SessionRow> = [
  session("a1", keepsDefault, daysAgo(2), {
    version: 1,
    isFinalized: false,
    durationMs: 1000,
    userKey: "alice",
  }),
  session("a1", keepsDefault, daysAgo(2), {
    version: 2,
    durationMs: 5000,
    userKey: "alice",
  }),
];

const anonymousFinished: SessionRow = session("b2", keepsDefault, daysAgo(40), {
  visitorId: "visitor-b",
});

// Never finished: a session row, but no person-month row.
const anonymousUnfinished: SessionRow = session(
  "b3",
  keepsDefault,
  new Date(daysAgo(40).getTime() + 60 * 60 * 1000),
  { visitorId: "visitor-b", isFinalized: false, version: 1 },
);

const erased: SessionRow = session("e4", keepsDefault, daysAgo(10));

// Past the default 13 months.
const pastTheDefault: SessionRow = session("d5", keepsDefault, monthsAgo(20));

// Within the 25 months its application keeps.
const keptForTwentyFive: SessionRow = session(
  "f6",
  keepsTwentyFive,
  monthsAgo(20),
);

// Past the longest retention, the tables' TTL.
const pastTheLongest: SessionRow = session(
  "f7",
  keepsTwentyFive,
  monthsAgo(26),
);

// Past the 3 months its application keeps.
const pastThree: SessionRow = session("c8", keepsThree, monthsAgo(5));

const keptForThree: SessionRow = session("c9", keepsThree, monthsAgo(1));

// Started after the cut-off: the views' to file, never the backfill's.
const afterTheCutoff: SessionRow = session(
  "aa",
  keepsDefault,
  new Date(CUTOFF.getTime() + 10 * 60 * 1000),
);

// Its first header before the views existed, its last after.
const straddling: Array<SessionRow> = [
  session("ab", keepsDefault, daysAgo(1), {
    version: 1,
    isFinalized: false,
    durationMs: 100,
    userKey: "bob",
  }),
  session("ab", keepsDefault, daysAgo(1), {
    version: 2,
    durationMs: 9000,
    userKey: "bob",
  }),
];

// Recorded after the views existed: they file it.
const recordedSince: SessionRow = session(
  "ac",
  keepsDefault,
  new Date(CUTOFF.getTime() - 30 * 60 * 1000),
  { userKey: "alice" },
);

const BEFORE_THE_VIEWS: Array<SessionRow> = [
  ...recentWithAProvisionalHeader,
  anonymousFinished,
  anonymousUnfinished,
  erased,
  pastTheDefault,
  keptForTwentyFive,
  pastTheLongest,
  pastThree,
  keptForThree,
  afterTheCutoff,
  straddling[0]!,
];

const AFTER_THE_VIEWS: Array<SessionRow> = [straddling[1]!, recordedSince];

/* What the session table must hold once the backfill ran. */
const COPIED_OR_FILED: Array<string> = [
  recentWithAProvisionalHeader[0]!.id,
  anonymousFinished.id,
  anonymousUnfinished.id,
  keptForTwentyFive.id,
  keptForThree.id,
  straddling[0]!.id,
  recordedSince.id,
].sort();

/* Both query analyzers: 1 is the new one (the default), 0 the old one. */
for (const analyzer of [1, 0]) {
  integration(
    `BackfillProductAnalyticsFromKeptSessions against ClickHouse (analyzer ${analyzer})`,
    () => {
      const database: string = `pa_backfill_test_${analyzer}_${process.pid}_${Date.now()}`;
      let clickhouse: ClickhouseDatabase;
      let client: ClickhouseClient;
      let savedClusterName: string | undefined;
      const originals: Array<Record<string, unknown>> = [];

      const services: Array<{
        database: unknown;
        databaseClient: unknown;
        migrationDatabase: unknown;
        migrationDatabaseClient: unknown;
      }> = [
        RumProductAnalyticsSessionService,
        RumProductAnalyticsUserService,
      ] as never;

      /* The run's progress, kept here instead of in Valkey. */
      const state: ProductAnalyticsBackfillState = {
        cutoff: null,
        doneThrough: null,
      };

      function environment(
        deleteWaitMs: number,
      ): Partial<ProductAnalyticsBackfillEnvironment> {
        return {
          now: (): Date => {
            return CUTOFF;
          },
          progress: {
            read: async (): Promise<ProductAnalyticsBackfillState> => {
              return { ...state };
            },
            writeCutoff: async (cutoff: Date): Promise<void> => {
              state.cutoff = cutoff;
            },
            writeDoneThrough: async (partition: string): Promise<void> => {
              state.doneThrough = partition;
            },
          },
          // The lock is Valkey's, and its own suite's.
          withoutErasures: <T>(work: () => Promise<T>): Promise<T> => {
            return work();
          },
          retentionChoices: async (): Promise<
            Array<{ rumApplicationId: string; months: number }>
          > => {
            return [
              { rumApplicationId: keepsThree.toString(), months: 3 },
              { rumApplicationId: keepsTwentyFive.toString(), months: 25 },
            ];
          },
          sleep: (ms: number): Promise<void> => {
            return new Promise<void>((resolve: () => void): void => {
              setTimeout(resolve, Math.min(ms, 200));
            });
          },
          deleteWaitMs: deleteWaitMs,
        };
      }

      async function rows(query: string): Promise<Array<JSONObject>> {
        const result: { json: () => Promise<unknown> } = await client.query({
          query: query,
          format: "JSONEachRow",
        });

        return (await result.json()) as Array<JSONObject>;
      }

      async function waitForMutations(): Promise<void> {
        const deadline: number = Date.now() + 90000;

        while (Date.now() < deadline) {
          const pending: Array<JSONObject> = await rows(
            `SELECT toString(count()) AS c FROM system.mutations WHERE database = '${database}' AND NOT is_done`,
          );

          if (Number(pending[0]?.["c"] || 0) === 0) {
            return;
          }

          await new Promise<void>((resolve: () => void): void => {
            setTimeout(resolve, 300);
          });
        }

        throw new Error("Timed out waiting for the delete to land");
      }

      /* A local table, as the model declares it, behind its Distributed one. */
      async function createTable(
        modelType: { new (): AnalyticsBaseModel },
        shardingKey: string,
      ): Promise<void> {
        const model: AnalyticsBaseModel = new modelType();
        const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
          modelType: modelType,
          database: clickhouse,
        }).toColumnsCreateStatement(model.tableColumns);

        const engine: string =
          model.tableEngine === AnalyticsTableEngine.AggregatingMergeTree
            ? "AggregatingMergeTree"
            : model.tableEngine === AnalyticsTableEngine.ReplacingMergeTree
              ? "ReplacingMergeTree(version)"
              : "MergeTree";

        await client.command({
          query: `CREATE TABLE ${database}.${model.tableName}Local (${columns.query}) ENGINE = ${engine} PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
          query_params: columns.query_params,
        });

        await client.command({
          query: `CREATE TABLE ${database}.${model.tableName} AS ${database}.${model.tableName}Local ENGINE = Distributed('default', '${database}', '${model.tableName}Local', ${shardingKey})`,
        });
      }

      /* A view as boot creates it on a cluster: the local tables, both ends. */
      async function createView(model: AnalyticsBaseModel): Promise<void> {
        const view: { name: string; query: string } =
          model.materializedViews[0]!;

        await client.command({
          query: view.query
            .replace(
              `CREATE MATERIALIZED VIEW IF NOT EXISTS ${view.name}`,
              `CREATE MATERIALIZED VIEW ${database}.${view.name}`,
            )
            .replace(
              `\nTO ${model.tableName}\n`,
              `\nTO ${database}.${model.tableName}Local\n`,
            )
            .replace(
              "\nFROM RumSessionV1\n",
              `\nFROM ${database}.RumSessionV1Local\n`,
            ),
        });
      }

      async function insertSessions(
        sessions: Array<SessionRow>,
      ): Promise<void> {
        for (const row of sessions) {
          const start: string = OneUptimeDate.toClickhouseDateTime64(row.start);

          await client.command({
            query: `INSERT INTO ${database}.RumSessionV1Local (projectId, rumApplicationId, startTime, sessionId, version, isFinalized, endTime, durationMs, identifiedUserKey, visitorId, retentionDate, isPinnedCopy) VALUES ('${projectId.toString()}', '${row.application.toString()}', '${start}', '${row.id}', ${row.version}, ${row.isFinalized ? 1 : 0}, '${start}', ${row.durationMs}, '${row.userKey}', '${row.visitorId}', '2099-01-01', 0)`,
          });
        }
      }

      /* Each session of the project once, folded as the reads fold it. */
      async function foldedSessions(): Promise<Array<JSONObject>> {
        return await rows(
          `SELECT sessionId, toString(max(durationMs)) AS durationMs, toString(toUInt8(max(isFinalized))) AS isFinalized, toString(count()) AS starts FROM (SELECT sessionId, startTime, max(durationMs) AS durationMs, max(isFinalized) AS isFinalized FROM ${database}.RumProductAnalyticsSessionV1 WHERE projectId = '${projectId.toString()}' GROUP BY sessionId, startTime) GROUP BY sessionId ORDER BY sessionId`,
        );
      }

      /* Each person-month: the finished sessions it counts, and its first. */
      async function foldedPeople(): Promise<Array<JSONObject>> {
        return await rows(
          `SELECT personKey, toString(toDate(month)) AS month, toString(uniqMerge(sessions)) AS sessions FROM ${database}.RumProductAnalyticsUserV1 WHERE projectId = '${projectId.toString()}' GROUP BY personKey, month ORDER BY personKey, month`,
        );
      }

      async function physicalRows(): Promise<string> {
        const found: Array<JSONObject> = await rows(
          `SELECT toString((SELECT count() FROM ${database}.RumProductAnalyticsSessionV1Local)) AS s, toString((SELECT count() FROM ${database}.RumProductAnalyticsUserV1Local)) AS u`,
        );

        return `${found[0]?.["s"]}/${found[0]?.["u"]}`;
      }

      beforeAll(async (): Promise<void> => {
        const url: URL = new URL(endpoint!);

        if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
          throw new Error(
            "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
          );
        }

        savedClusterName = process.env[CLUSTER_ENV_KEY];
        process.env[CLUSTER_ENV_KEY] = "default";

        const options: ClickHouseClientConfigOptions = {
          url: `${url.protocol}//${url.host}`,
          username: decodeURIComponent(url.username) || "default",
          password: decodeURIComponent(url.password),
          database: database,
          request_timeout: 60000,
          clickhouse_settings: {
            enable_analyzer: analyzer === 1 ? 1 : 0,
          } as unknown as NonNullable<
            ClickHouseClientConfigOptions["clickhouse_settings"]
          >,
        };

        clickhouse = new ClickhouseDatabase(options);
        client = await clickhouse.connect(options);

        for (const service of services) {
          originals.push({
            database: service.database,
            databaseClient: service.databaseClient,
            migrationDatabase: service.migrationDatabase,
            migrationDatabaseClient: service.migrationDatabaseClient,
          });

          service.database = clickhouse;
          service.databaseClient = client;
          service.migrationDatabase = clickhouse;
          service.migrationDatabaseClient = client;
        }

        await createTable(
          RumSession as unknown as { new (): AnalyticsBaseModel },
          "cityHash64(projectId, sessionId)",
        );
        await createTable(
          RumProductAnalyticsSession as unknown as {
            new (): AnalyticsBaseModel;
          },
          "cityHash64(projectId, sessionId)",
        );
        await createTable(
          RumProductAnalyticsUser as unknown as { new (): AnalyticsBaseModel },
          "cityHash64(projectId, personKey)",
        );

        await insertSessions(BEFORE_THE_VIEWS);

        await createView(new RumProductAnalyticsSession());
        await createView(new RumProductAnalyticsUser());

        await insertSessions(AFTER_THE_VIEWS);
      });

      afterAll(async (): Promise<void> => {
        if (savedClusterName === undefined) {
          delete process.env[CLUSTER_ENV_KEY];
        } else {
          process.env[CLUSTER_ENV_KEY] = savedClusterName;
        }

        originals.forEach(
          (original: Record<string, unknown>, index: number) => {
            Object.assign(services[index]!, original);
          },
        );

        if (client) {
          await client.command({
            query: `SYSTEM START MERGES ${database}.RumSessionV1Local`,
          });
          await client.command({
            query: `DROP DATABASE IF EXISTS ${database}`,
          });
        }

        if (clickhouse) {
          await clickhouse.disconnect();
        }
      });

      test("the analyzer setting took", async () => {
        const found: Array<JSONObject> = await rows(
          "SELECT toString(toUInt8(getSetting('enable_analyzer'))) AS value",
        );

        expect(Number(found[0]?.["value"])).toBe(analyzer);
      });

      test("before it runs, product analytics holds only what the views filed", async () => {
        expect(
          (await foldedSessions()).map((row: JSONObject): string => {
            return String(row["sessionId"]);
          }),
        ).toEqual([straddling[1]!.id, recordedSince.id].sort());

        expect(
          await RumProductAnalyticsReadService.getDataStartedAt({
            projectId: projectId,
            rumApplicationId: keepsDefault,
          }),
        ).toBe(straddling[1]!.start.getTime());
      });

      test("while a delete of RumSessionV1 has not landed, it copies nothing", async () => {
        await client.command({
          query: `SYSTEM STOP MERGES ${database}.RumSessionV1Local`,
        });
        await client.command({
          query: `ALTER TABLE ${database}.RumSessionV1Local DELETE WHERE sessionId = '${erased.id}'`,
        });

        await expect(
          new BackfillProductAnalyticsFromKeptSessions(
            environment(800),
          ).migrate(),
        ).rejects.toThrow(/delete\(s\) of RumSessionV1 have not landed/);

        expect(
          (await foldedSessions()).map((row: JSONObject): string => {
            return String(row["sessionId"]);
          }),
        ).toEqual([straddling[1]!.id, recordedSince.id].sort());
        expect(state.cutoff).toEqual(CUTOFF);
        expect(state.doneThrough).toBeNull();

        await client.command({
          query: `SYSTEM START MERGES ${database}.RumSessionV1Local`,
        });
        await waitForMutations();
      });

      test("copies every kept session from before the cut-off once, and never the erased one", async () => {
        const migration: BackfillProductAnalyticsFromKeptSessions =
          new BackfillProductAnalyticsFromKeptSessions(environment(60000));

        await migration.migrate();

        expect(migration.lastResult?.daysCopied.length).toBeGreaterThan(0);

        const sessions: Array<JSONObject> = await foldedSessions();

        expect(
          sessions.map((row: JSONObject): string => {
            return String(row["sessionId"]);
          }),
        ).toEqual(COPIED_OR_FILED);

        // One start per session: the views' rows and the copies fold.
        for (const row of sessions) {
          expect(row["starts"]).toBe("1");
        }

        const byId: Map<string, JSONObject> = new Map<string, JSONObject>(
          sessions.map((row: JSONObject): [string, JSONObject] => {
            return [String(row["sessionId"]), row];
          }),
        );

        // Its last header wins over its first.
        expect(byId.get(recentWithAProvisionalHeader[0]!.id)).toMatchObject({
          durationMs: "5000",
          isFinalized: "1",
        });
        // Filed by the view at its end, copied from its start: the end wins.
        expect(byId.get(straddling[0]!.id)).toMatchObject({
          durationMs: "9000",
          isFinalized: "1",
        });
        expect(byId.get(anonymousUnfinished.id)).toMatchObject({
          isFinalized: "0",
        });
      });

      test("counts each person's finished sessions once a month", async () => {
        const expected: Array<JSONObject> = [
          {
            personKey: "u:alice",
            month: monthOf(recentWithAProvisionalHeader[0]!.start),
          },
          { personKey: "u:alice", month: monthOf(recordedSince.start) },
          { personKey: "u:bob", month: monthOf(straddling[0]!.start) },
          { personKey: "v:visitor-b", month: monthOf(anonymousFinished.start) },
          {
            personKey: `v:${keptForThree.visitorId}`,
            month: monthOf(keptForThree.start),
          },
          {
            personKey: `v:${keptForTwentyFive.visitorId}`,
            month: monthOf(keptForTwentyFive.start),
          },
        ];

        // A month keyed twice (alice's two sessions in one month) is one row of 2.
        const counted: Map<string, number> = new Map<string, number>();

        for (const row of expected) {
          const key: string = `${row["personKey"]}|${row["month"]}`;
          counted.set(key, (counted.get(key) || 0) + 1);
        }

        expect(
          (await foldedPeople()).map((row: JSONObject): string => {
            return `${row["personKey"]}|${row["month"]}|${row["sessions"]}`;
          }),
        ).toEqual(
          Array.from(counted.entries())
            .map(([key, sessions]: [string, number]): string => {
              return `${key}|${sessions}`;
            })
            .sort(),
        );
      });

      test("the counting-since date moves back to the oldest session kept", async () => {
        expect(
          await RumProductAnalyticsReadService.getDataStartedAt({
            projectId: projectId,
            rumApplicationId: keepsDefault,
          }),
        ).toBe(anonymousFinished.start.getTime());

        expect(
          await RumProductAnalyticsReadService.getDataStartedAt({
            projectId: projectId,
            rumApplicationId: keepsTwentyFive,
          }),
        ).toBe(keptForTwentyFive.start.getTime());
      });

      test("a second run copies nothing", async () => {
        const before: string = await physicalRows();

        const second: BackfillProductAnalyticsFromKeptSessions =
          new BackfillProductAnalyticsFromKeptSessions(environment(60000));

        await second.migrate();

        expect(second.lastResult?.daysCopied).toEqual([]);
        expect(await physicalRows()).toBe(before);
      });

      test("a run that lost its progress copies again, and no count changes", async () => {
        const sessions: Array<JSONObject> = await foldedSessions();
        const people: Array<JSONObject> = await foldedPeople();

        state.cutoff = null;
        state.doneThrough = null;

        const again: BackfillProductAnalyticsFromKeptSessions =
          new BackfillProductAnalyticsFromKeptSessions(environment(60000));

        await again.migrate();

        expect(again.lastResult?.daysCopied.length).toBeGreaterThan(0);
        expect(await foldedSessions()).toEqual(sessions);
        expect(await foldedPeople()).toEqual(people);
      });
    },
  );
}

describe("BackfillProductAnalyticsFromKeptSessions ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
