import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Span from "Common/Models/AnalyticsModels/Span";
import Log from "Common/Models/AnalyticsModels/Log";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsDatabaseService, {
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import SpanService from "Common/Server/Services/SpanService";
import LogService from "Common/Server/Services/LogService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import RumSessionPinService from "Common/Server/Services/RumSessionPinService";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * Rum:ProcessSessionErasureRequests' trace-id lookup against a real
 * ClickHouse server.
 *
 * SessionReplayErasureTraceIds.test.ts pins the lookup's SQL as a string
 * and fakes its answers, so it cannot tell whether ClickHouse evaluates
 * the ownership flag the way the job reads it: which traces count as the
 * erased sessions' own, how countIf / minIf / maxIf behave on the real
 * column types, what JSON type the flag comes back as, and whether one
 * lookup returns every candidate. A wrong answer there deletes other
 * visitors' telemetry (a shared trace let through) or silently keeps the
 * subject's (a candidate missed).
 *
 * It also runs the trace-id delete's WHERE clause, as a SELECT, with a
 * full mutation's worth of ids: ClickHouse caps every URL parameter at
 * 128 KiB (http_max_field_value_size), which is why the ids are split
 * over several parameters. The ALTER itself is ON CLUSTER and needs a
 * Keeper and a cluster definition a disposable server does not have; that
 * part, with the max_query_size the queued DDL needs, was checked against
 * a keeper-backed 24.8 and 26.7 by hand.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server,
 * credentials in the URL:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/SessionReplayErasureClickhouse.test.ts
 *
 * The suite creates and drops only its own uniquely named database. The
 * App Test workflow provides the server, and the guard at the bottom fails
 * the run there if it ever goes missing, so this cannot quietly skip in CI.
 * ------------------------------------------------------------------
 */

/* RunCron registers a repeatable BullMQ job at import time. */
jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
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

/* The tombstone write and the finalizer-queue purge; neither is under test. */
jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return {
          sadd: (): Promise<number> => {
            return Promise.resolve(1);
          },
          expire: (): Promise<number> => {
            return Promise.resolve(1);
          },
          zscan: (): Promise<[string, Array<string>]> => {
            return Promise.resolve(["0", []]);
          },
          zrem: (): Promise<number> => {
            return Promise.resolve(0);
          },
        };
      },
      isConnected: (): boolean => {
        return true;
      },
    },
  };
});

import {
  buildErasedSessionTraceIdStatement,
  buildTraceDeleteStatement,
  eraseSessionBatch,
  MAX_TRACE_IDS_PER_MUTATION,
} from "../../FeatureSet/Workers/Jobs/Rum/ProcessSessionErasureRequests";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `rum_erasure_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID("6600000000000000000000a1");
const otherProjectId: ObjectID = new ObjectID("6600000000000000000000e5");

/* The erased batch, and a visitor who is not being erased. */
const sessionA: string = "1f0c9a4b6d2e47f8a1b3c5d7e9f00112";
const sessionB: string = "2a1d0b5c7e3f48a9b2c4d6e8f0a11223";
const outsider: string = "3b2e1c6d8f4059bac3d5e7f9a1b22334";

function traceId(prefix: string, index: number): string {
  return `${prefix}${index.toString(16).padStart(32 - prefix.length, "0")}`;
}

/* One trace per ownership case; all sort before the bulk "b..." traces. */
const ownTrace: string = traceId("a", 1);
const bothSessionsTrace: string = traceId("a", 2);
const sharedTrace: string = traceId("a", 3);
const predatedTrace: string = traceId("a", 4);
const withinSkewTrace: string = traceId("a", 5);
const outsiderOnlyTrace: string = traceId("a", 6);
const otherProjectTrace: string = traceId("a", 7);
const extendedTrace: string = traceId("a", 8);
const lateWithinSkewTrace: string = traceId("a", 9);
const spreadStampsTrace: string = traceId("a", 10);
const zeroTrace: string = "0".repeat(32);

/*
 * Traces owned by sessionB alone: more than the 10,000 rows per page the
 * lookup used to be cut into, which one lookup now returns whole.
 */
const BULK_TRACES: number = 10005;

const sessionStart: Date = OneUptimeDate.addRemoveHours(new Date(), -2);
const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

function at(offsetSeconds: number): string {
  return OneUptimeDate.toClickhouseDateTime64(
    new Date(sessionStart.getTime() + offsetSeconds * 1000),
  );
}

function spanRow(data: {
  project?: ObjectID | undefined;
  trace: string;
  session: string;
  offsetSeconds: number;
}): JSONObject {
  return {
    projectId: (data.project || projectId).toString(),
    startTime: at(data.offsetSeconds),
    traceId: data.trace,
    spanId: "00f067aa0ba902b7",
    sessionId: data.session,
    retentionDate: retentionDate,
  };
}

/*
 * Each case is a trace the erased batch (sessionA, sessionB) stamped, plus
 * the spans that decide whether it is theirs alone.
 */
const spanFixtures: Array<JSONObject> = [
  /* Owned: a stamped span and an unstamped child. */
  spanRow({ trace: ownTrace, session: sessionA, offsetSeconds: 0 }),
  spanRow({ trace: ownTrace, session: "", offsetSeconds: 1 }),
  /* Owned: both stamped sessions are in the batch. */
  spanRow({ trace: bothSessionsTrace, session: sessionA, offsetSeconds: 0 }),
  spanRow({ trace: bothSessionsTrace, session: sessionB, offsetSeconds: 2 }),
  /* Shared: a cached server-rendered traceparent, another visitor an hour later. */
  spanRow({ trace: sharedTrace, session: sessionA, offsetSeconds: 0 }),
  spanRow({ trace: sharedTrace, session: outsider, offsetSeconds: 3600 }),
  /*
   * Extended: the same reused traceparent, but the visitor an hour later
   * is one the recorder is not uploading for (sampled out, no consent
   * yet), so their span carries no stamp at all. Only the time says it is
   * not the session's.
   */
  spanRow({ trace: extendedTrace, session: sessionA, offsetSeconds: 0 }),
  spanRow({ trace: extendedTrace, session: "", offsetSeconds: 3600 }),
  /* Owned: five minutes after the last stamp is clock skew too. */
  spanRow({ trace: lateWithinSkewTrace, session: sessionA, offsetSeconds: 0 }),
  spanRow({ trace: lateWithinSkewTrace, session: "", offsetSeconds: 300 }),
  /*
   * Owned: the upper bound follows the LAST stamped span, not the first -
   * both sessions are the batch's, an hour apart, the unstamped span just
   * after the later one.
   */
  spanRow({ trace: spreadStampsTrace, session: sessionA, offsetSeconds: 0 }),
  spanRow({ trace: spreadStampsTrace, session: sessionB, offsetSeconds: 3600 }),
  spanRow({ trace: spreadStampsTrace, session: "", offsetSeconds: 3605 }),
  /* Pre-dated: the trace was running an hour before the session joined it. */
  spanRow({ trace: predatedTrace, session: "", offsetSeconds: -3600 }),
  spanRow({ trace: predatedTrace, session: sessionA, offsetSeconds: 0 }),
  /* Owned: five minutes earlier is clock skew, inside the allowance. */
  spanRow({ trace: withinSkewTrace, session: "", offsetSeconds: -300 }),
  spanRow({ trace: withinSkewTrace, session: sessionA, offsetSeconds: 0 }),
  /* Not a candidate: nobody in the batch stamped it. */
  spanRow({ trace: outsiderOnlyTrace, session: outsider, offsetSeconds: 0 }),
  /* Not a candidate: a span with no trace id. */
  spanRow({ trace: "", session: sessionA, offsetSeconds: 0 }),
  /* A candidate the job drops itself: W3C's invalid all-zero id. */
  spanRow({ trace: zeroTrace, session: sessionA, offsetSeconds: 0 }),
  /*
   * Another project: its outsider-stamped, far older span on ownTrace must
   * not make ownTrace look shared or pre-dated, and its own sessionA trace
   * is not this project's candidate.
   */
  spanRow({
    project: otherProjectId,
    trace: ownTrace,
    session: outsider,
    offsetSeconds: -86400,
  }),
  spanRow({
    project: otherProjectId,
    trace: otherProjectTrace,
    session: sessionA,
    offsetSeconds: 0,
  }),
];

const bulkTraces: Array<string> = Array.from(
  { length: BULK_TRACES },
  (_unused: unknown, index: number): string => {
    return traceId("b", index);
  },
);

/* What the job may erase by trace id, in the lookup's (byte) order. */
const expectedOwned: Array<string> = [
  ownTrace,
  bothSessionsTrace,
  withinSkewTrace,
  lateWithinSkewTrace,
  spreadStampsTrace,
  ...bulkTraces,
];

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  /*
   * The model's own columns and skip indexes under a plain MergeTree named
   * like the Distributed table the lookup reads: production's Replicated*
   * local tables need a Keeper and a cluster a disposable server does not
   * have, and neither changes how the SELECT is evaluated (GLOBAL IN is a
   * no-op on one server).
   */
  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

type AnyAnalyticsService = AnalyticsDatabaseService<AnalyticsBaseModel>;

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  migrationDatabase: ClickhouseDatabase;
  migrationDatabaseClient: ClickhouseClient | null;
}

const services: Array<AnyAnalyticsService> = [
  SpanService as unknown as AnyAnalyticsService,
  LogService as unknown as AnyAnalyticsService,
];

/* The batch's lookup, through the production executeQuery path. */
async function readLookup(): Promise<Array<JSONObject>> {
  const resultSet: { json: () => Promise<{ data: Array<JSONObject> }> } =
    (await SpanService.executeQuery(
      buildErasedSessionTraceIdStatement({
        databaseName: database,
        projectId: projectId,
        sessionIds: [sessionA, sessionB],
      }),
      MigrationExecuteOptions,
    )) as unknown as { json: () => Promise<{ data: Array<JSONObject> }> };

  return (await resultSet.json()).data;
}

integration(
  "Rum:ProcessSessionErasureRequests trace-id lookup against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    const originals: Array<ServiceConnection> = [];

    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
        );
      }

      const options: ClickHouseClientConfigOptions = {
        url: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username) || "default",
        password: decodeURIComponent(url.password),
        database: database,
        request_timeout: 60000,
      };

      clickhouse = new ClickhouseDatabase(options);
      /* connect() creates the database before opening the pool on it. */
      client = await clickhouse.connect(options);

      for (const modelType of [Span, Log]) {
        await createTable(
          client,
          clickhouse,
          modelType as unknown as { new (): AnalyticsBaseModel },
        );
      }

      /* The lookup and the reads go through the MIGRATION pool; point both at the test server. */
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

      await client.insert({
        table: AnalyticsTableName.Span,
        format: "JSONEachRow",
        values: [
          ...spanFixtures,
          ...bulkTraces.map((trace: string, index: number): JSONObject => {
            return spanRow({
              trace: trace,
              session: sessionB,
              offsetSeconds: index % 600,
            });
          }),
        ],
      });

      await client.insert({
        table: AnalyticsTableName.Log,
        format: "JSONEachRow",
        values: [
          ...expectedOwned,
          sharedTrace,
          predatedTrace,
          extendedTrace,
        ].map((trace: string): JSONObject => {
          return {
            projectId: projectId.toString(),
            time: at(0),
            traceId: trace,
            sessionId: "",
            body: "backend log line",
            retentionDate: retentionDate,
          };
        }),
      });

      /* The same trace id in another project must never be counted. */
      await client.insert({
        table: AnalyticsTableName.Log,
        format: "JSONEachRow",
        values: [
          {
            projectId: otherProjectId.toString(),
            time: at(0),
            traceId: ownTrace,
            sessionId: "",
            body: "another project's log line",
            retentionDate: retentionDate,
          },
        ],
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(async (): Promise<void> => {
      originals.forEach((original: ServiceConnection, index: number): void => {
        Object.assign(services[index]!, original);
      });

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    test("ClickHouse flags exactly the traces the batch owns alone", async () => {
      const rows: Array<JSONObject> = await readLookup();
      const flags: Map<string, unknown> = new Map<string, unknown>();

      for (const row of rows) {
        flags.set(row["traceId"] as string, row["ownedByBatch"]);
      }

      /* A number, which is what the job's isOwnedByBatch accepts. */
      expect(flags.get(ownTrace)).toBe(1);
      expect(flags.get(bothSessionsTrace)).toBe(1);
      expect(flags.get(withinSkewTrace)).toBe(1);
      expect(flags.get(sharedTrace)).toBe(0);
      expect(flags.get(predatedTrace)).toBe(0);
      expect(flags.get(extendedTrace)).toBe(0);
      expect(flags.get(lateWithinSkewTrace)).toBe(1);
      expect(flags.get(spreadStampsTrace)).toBe(1);
      expect(flags.get(zeroTrace)).toBe(1);

      expect(flags.has(outsiderOnlyTrace)).toBe(false);
      expect(flags.has(otherProjectTrace)).toBe(false);
      expect(flags.has("")).toBe(false);
    });

    test("one lookup returns every candidate once, in byte order, more than ten thousand of them", async () => {
      const rows: Array<JSONObject> = await readLookup();
      const ids: Array<string> = rows.map((row: JSONObject): string => {
        return row["traceId"] as string;
      });

      /*
       * Every candidate once: the zero trace, the eight a-traces the batch
       * stamped (not the outsider's or the other project's), every bulk
       * trace.
       */
      expect(ids.length).toBe(1 + 8 + BULK_TRACES);
      expect(ids.length).toBeGreaterThan(10000);
      expect(new Set<string>(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual(ids);
    });

    test("eraseSessionBatch submits trace-id deletes for exactly the owned traces, after one lookup", async () => {
      const submitted: Array<{ table: string; traceIds: Array<string> }> = [];
      const order: Array<string> = [];
      const realLookup: typeof SpanService.executeQuery =
        SpanService.executeQuery.bind(SpanService);

      /* The lookup runs for real; the spy only records when. */
      jest.spyOn(SpanService, "executeQuery").mockImplementation(((
        ...args: Parameters<typeof SpanService.executeQuery>
      ): ReturnType<typeof SpanService.executeQuery> => {
        order.push("lookup");
        return realLookup(...args);
      }) as never);

      jest.spyOn(RumSessionChunkService, "executeQuery").mockResolvedValue({
        json: (): Promise<{ data: Array<JSONObject> }> => {
          return Promise.resolve({ data: [{ chunkCount: 0 }] });
        },
      } as never);

      /* The deletes are ON CLUSTER; capture them instead of running them. */
      for (const service of [
        RumSessionChunkService,
        RumSessionService,
        LogService,
        SpanService,
        ExceptionInstanceService,
      ]) {
        jest
          .spyOn(
            service as unknown as {
              execute: (statement: Statement) => Promise<unknown>;
            },
            "execute",
          )
          .mockImplementation(((statement: Statement): Promise<unknown> => {
            order.push("delete");

            if (statement.query.includes("traceId IN")) {
              submitted.push({
                table: service.model.tableName,
                traceIds: (
                  Object.values(statement.query_params).filter(
                    (value: unknown): boolean => {
                      return Array.isArray(value);
                    },
                  ) as Array<Array<string>>
                ).reduce((all: Array<string>, next: Array<string>) => {
                  return all.concat(next);
                }, []),
              });
            }

            return Promise.resolve({});
          }) as never);
      }

      jest
        .spyOn(RumSessionPinService, "deleteBy")
        .mockResolvedValue(0 as never);

      await eraseSessionBatch({
        databaseName: database,
        projectId: projectId,
        sessionIds: [sessionA, sessionB],
      });

      expect(
        order.filter((step: string): boolean => {
          return step === "lookup";
        }).length,
      ).toBe(1);
      expect(order.indexOf("lookup")).toBeLessThan(order.indexOf("delete"));

      for (const table of [
        AnalyticsTableName.Log,
        AnalyticsTableName.ExceptionInstance,
        AnalyticsTableName.Span,
      ]) {
        const ids: Array<string> = submitted
          .filter((entry: { table: string }): boolean => {
            return entry.table === table;
          })
          .reduce((all: Array<string>, entry: { traceIds: Array<string> }) => {
            return all.concat(entry.traceIds);
          }, [] as Array<string>);

        expect(ids).toEqual(expectedOwned);
        /* The reused traceparent unrecorded visitors went on extending. */
        expect(ids).not.toContain(extendedTrace);
      }

      expect(
        submitted.filter((entry: { table: string }): boolean => {
          return entry.table === AnalyticsTableName.Log;
        }).length,
      ).toBe(Math.ceil(expectedOwned.length / MAX_TRACE_IDS_PER_MUTATION));
    });

    test("a full mutation's WHERE clause is accepted over HTTP and matches exactly its ids in its project", async () => {
      /*
       * Ten thousand, spelled out: one Array(String) parameter that size is
       * ~410 KB URL-encoded, over the 128 KiB a parameter may be.
       */
      expect(MAX_TRACE_IDS_PER_MUTATION).toBe(10000);

      const ids: Array<string> = expectedOwned.slice(0, 10000);

      expect(ids.length).toBe(10000);

      const statement: Statement = buildTraceDeleteStatement({
        databaseName: database,
        tableName: AnalyticsTableName.Log,
        projectId: projectId,
        traceIds: ids,
      });

      /*
       * The same WHERE, parameters and URL as the mutation, as a count over
       * the Log table the ALTER would rewrite.
       */
      const pattern: RegExp =
        /^ALTER TABLE \{(p\d+):Identifier\}\.\{(p\d+):Identifier\} ON CLUSTER '[^']*'\s*DELETE WHERE/;
      const match: RegExpMatchArray | null = statement.query.match(pattern);

      expect(match).not.toBeNull();

      const tableParam: string = match![2]!;
      const query: string = statement.query.replace(
        pattern,
        `SELECT count() AS matched FROM {${match![1]}:Identifier}.{${tableParam}:Identifier} WHERE`,
      );

      expect(statement.query_params[tableParam]).toBe(
        `${AnalyticsTableName.Log}Local`,
      );

      const resultSet: { json: () => Promise<{ data: Array<JSONObject> }> } =
        (await client.query({
          query: query,
          format: "JSON",
          query_params: {
            ...statement.query_params,
            [tableParam]: AnalyticsTableName.Log,
          },
        })) as unknown as { json: () => Promise<{ data: Array<JSONObject> }> };

      const rows: Array<JSONObject> = (await resultSet.json()).data;

      /* UInt64 comes back quoted in JSON. */
      expect(Number(rows[0]!["matched"])).toBe(ids.length);
    });
  },
);

/*
 * The suite above is opt-in, and an opt-in regression guard that silently
 * stops opting in guards nothing. The App Test workflow starts a ClickHouse
 * service for it, so a missing URL there is a broken pipeline, not a skip.
 */
describe("Rum:ProcessSessionErasureRequests ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
