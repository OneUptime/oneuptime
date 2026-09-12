import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsTableEngine from "Common/Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumSessionChunk from "Common/Models/AnalyticsModels/RumSessionChunk";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import Span from "Common/Models/AnalyticsModels/Span";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import { SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS } from "Common/Types/Rum/SessionReplay";
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
 * Rum:FinalizeSessions against a real ClickHouse server.
 *
 * SessionReplayFinalizer.test.ts pins the generated SQL as a string and
 * models the GROUP BY in TypeScript, so it cannot tell whether ClickHouse
 * accepts the query at all. It could not catch
 * `sum(errorCount) AS errorCount` next to `countIf(errorCount > 0)`: the
 * server resolves the inner identifier to the alias, rejects the whole
 * statement with ILLEGAL_AGGREGATION, and the job's catch turns that into
 * a log line - so no session ever finalized and nothing went red.
 *
 * This suite runs the finalizer's reads and its header write through the
 * production executeQuery / insertJsonRows path against tables built from
 * the real models' column definitions.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server,
 * credentials in the URL:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/SessionReplayFinalizerClickhouse.test.ts
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

/*
 * Only the erasure tombstone and the seal hint touch Redis during a
 * finalization. Neither is what this suite is about: nothing is erased and
 * no hint is set.
 */
jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return {
          get: (): Promise<null> => {
            return Promise.resolve(null);
          },
          sismember: (): Promise<number> => {
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

import {
  buildNeverFinalizedStatement,
  buildSessionExceptionFingerprintStatement,
  buildSessionTraceIdStatement,
  buildTabAggregateStatement,
  finalizeSession,
  FinalizeSessionOutcome,
  parseTabAggregateRow,
  SWEEP_MIN_SESSION_AGE_MS,
  TabChunkAggregate,
} from "../../FeatureSet/Workers/Jobs/Rum/FinalizeSessions";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `rum_finalizer_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID("6600000000000000000000a1");
const rumApplicationId: string = "6600000000000000000000b2";
const sessionId: string = "1f0c9a4b6d2e47f8a1b3c5d7e9f00112";
const fingerprint: string = "fp-checkout-null-deref";
const traceId: string = "4bf92f3577b34da6a3ce929d0e0e4736";

const CHUNK_DURATION_MS: number = 15 * 1000;

/*
 * Old enough for the never-finalized sweep to consider it, recent enough
 * to sit inside the sweep's lookback and every retention window.
 */
const sessionStart: Date = new Date(
  Date.now() - SWEEP_MIN_SESSION_AGE_MS - 60 * 60 * 1000,
);
const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

interface ChunkFixture {
  tabId: string;
  chunkIndex: number;
  version: number;
  startOffsetMs: number;
  eventCount: number;
  errorCount: number;
  hasFullSnapshot?: boolean;
  isFinal?: boolean;
  url?: string;
}

/*
 * Two tabs, chosen so every aggregate that reads a column inside another
 * aggregate has a value that tells the right reading from a wrong one:
 *
 * - tab-a's chunk 0 is error-free at offset 0, so firstErrorOffsetMs is
 *   only 30000 if minIf filters on the CHUNK's errorCount.
 * - tab-a's chunk 1 carries fewer than SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS
 *   events, so activeMs only excludes it if sumIf reads the CHUNK's
 *   eventCount rather than the tab total.
 * - tab-a's chunk 2 is delivered twice; the stale copy (lower version)
 *   would inflate eventCount by 999 and erase an error if the dedupe broke.
 */
const chunkFixtures: Array<ChunkFixture> = [
  {
    tabId: "tab-a",
    chunkIndex: 0,
    version: 1000,
    startOffsetMs: 0,
    eventCount: 40,
    errorCount: 0,
    hasFullSnapshot: true,
    url: "https://app.example.com/",
  },
  {
    tabId: "tab-a",
    chunkIndex: 1,
    version: 1000,
    startOffsetMs: 15000,
    eventCount: SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS - 2,
    errorCount: 0,
    url: "https://app.example.com/",
  },
  {
    tabId: "tab-a",
    chunkIndex: 2,
    version: 500,
    startOffsetMs: 30000,
    eventCount: 999,
    errorCount: 0,
    url: "https://app.example.com/checkout",
  },
  {
    tabId: "tab-a",
    chunkIndex: 2,
    version: 1000,
    startOffsetMs: 30000,
    eventCount: 25,
    errorCount: 2,
    url: "https://app.example.com/checkout",
  },
  {
    tabId: "tab-a",
    chunkIndex: 3,
    version: 1000,
    startOffsetMs: 45000,
    eventCount: 10,
    errorCount: 1,
    isFinal: true,
    url: "https://app.example.com/checkout",
  },
  {
    tabId: "tab-b",
    chunkIndex: 0,
    version: 1000,
    startOffsetMs: 20000,
    eventCount: 12,
    errorCount: 3,
    hasFullSnapshot: true,
    url: "https://app.example.com/account",
  },
];

function chunkRow(fixture: ChunkFixture): JSONObject {
  const endOffsetMs: number = fixture.startOffsetMs + CHUNK_DURATION_MS;

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: projectId.toString(),
    sessionId: sessionId,
    tabId: fixture.tabId,
    chunkIndex: fixture.chunkIndex,
    version: String(fixture.version),
    rumApplicationId: rumApplicationId,
    primaryEntityId: rumApplicationId,
    primaryEntityType: "RealUserMonitor",
    sessionStartTime: OneUptimeDate.toClickhouseDateTime64(sessionStart),
    chunkStartOffsetMs: fixture.startOffsetMs,
    chunkEndOffsetMs: endOffsetMs,
    chunkStartTime: OneUptimeDate.toClickhouseDateTime64(
      new Date(sessionStart.getTime() + fixture.startOffsetMs),
    ),
    chunkEndTime: OneUptimeDate.toClickhouseDateTime64(
      new Date(sessionStart.getTime() + endOffsetMs),
    ),
    eventCount: fixture.eventCount,
    hasFullSnapshot: Boolean(fixture.hasFullSnapshot),
    isFinal: Boolean(fixture.isFinal),
    isPinnedCopy: false,
    recorderKind: "dom",
    payloadEncoding: "identity",
    schemaVersion: 1,
    payload: "[]",
    payloadBytes: "100",
    errorCount: fixture.errorCount,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 1,
    clickCount: 0,
    customEventCount: 0,
    url: fixture.url || "",
    routes: fixture.url ? [new URL(fixture.url).pathname] : [],
    retentionDate: retentionDate,
  };
}

function provisionalHeaderRow(): JSONObject {
  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: projectId.toString(),
    rumApplicationId: rumApplicationId,
    primaryEntityId: rumApplicationId,
    primaryEntityType: "RealUserMonitor",
    startTime: OneUptimeDate.toClickhouseDateTime64(sessionStart),
    clientReportedStartTime: OneUptimeDate.toClickhouseDateTime64(sessionStart),
    endTime: OneUptimeDate.toClickhouseDateTime64(
      new Date(sessionStart.getTime() + CHUNK_DURATION_MS),
    ),
    sessionId: sessionId,
    version: String(sessionStart.getTime()),
    isFinalized: false,
    triggerReason: "sampled",
    samplePercentageAtCapture: 100,
    errorCount: 0,
    entryUrl: "https://app.example.com/",
    exitUrl: "https://app.example.com/",
    retentionDate: retentionDate,
  };
}

/*
 * The model's own columns, skip indexes and projections, under a plain
 * (non-replicated) engine: production's Replicated* local tables need a
 * Keeper and a cluster definition a disposable server does not have, and
 * neither changes how a SELECT is analysed.
 */
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

  const engine: string =
    model.tableEngine === AnalyticsTableEngine.ReplacingMergeTree
      ? "ReplacingMergeTree(version)"
      : "MergeTree";

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${engine} PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

/*
 * Throws on a rejected query, which is the point: the job's own readRows
 * is private and fetchSessionCorrelation deliberately swallows failures.
 */
async function readRows(statement: Statement): Promise<Array<JSONObject>> {
  const resultSet: { json: () => Promise<{ data: Array<JSONObject> }> } =
    (await RumSessionChunkService.executeQuery(statement)) as unknown as {
      json: () => Promise<{ data: Array<JSONObject> }>;
    };

  return (await resultSet.json()).data;
}

type AnyAnalyticsService = AnalyticsDatabaseService<AnalyticsBaseModel>;

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

const services: Array<AnyAnalyticsService> = [
  RumSessionChunkService as unknown as AnyAnalyticsService,
  RumSessionService as unknown as AnyAnalyticsService,
];

integration("Rum:FinalizeSessions against ClickHouse", () => {
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

    for (const modelType of [
      RumSessionChunk,
      RumSession,
      Span,
      ExceptionInstance,
    ]) {
      await createTable(
        client,
        clickhouse,
        modelType as unknown as { new (): AnalyticsBaseModel },
      );
    }

    for (const service of services) {
      originals.push({
        database: service.database,
        databaseClient: service.databaseClient,
        ingestDatabase: service.ingestDatabase,
        ingestDatabaseClient: service.ingestDatabaseClient,
      });

      service.database = clickhouse;
      service.databaseClient = client;
      service.ingestDatabase = clickhouse;
      service.ingestDatabaseClient = client;
    }

    await RumSessionChunkService.insertJsonRows(chunkFixtures.map(chunkRow), {
      clickhouseSettings: { wait_for_async_insert: 1 },
    });

    await RumSessionService.insertJsonRows([provisionalHeaderRow()], {
      clickhouseSettings: { wait_for_async_insert: 1 },
    });

    await client.insert({
      table: AnalyticsTableName.ExceptionInstance,
      format: "JSONEachRow",
      values: [
        {
          projectId: projectId.toString(),
          time: OneUptimeDate.toClickhouseDateTime64(
            new Date(sessionStart.getTime() + 31000),
          ),
          sessionId: sessionId,
          fingerprint: fingerprint,
          retentionDate: retentionDate,
        },
      ],
    });

    await client.insert({
      table: AnalyticsTableName.Span,
      format: "JSONEachRow",
      values: [
        {
          projectId: projectId.toString(),
          startTime: OneUptimeDate.toClickhouseDateTime64(
            new Date(sessionStart.getTime() + 32000),
          ),
          traceId: traceId,
          spanId: "00f067aa0ba902b7",
          sessionId: sessionId,
          retentionDate: retentionDate,
        },
      ],
    });
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

  test("the chunk aggregate executes and reads each chunk's own counters", async () => {
    const rows: Array<JSONObject> = await readRows(
      buildTabAggregateStatement({
        databaseName: database,
        projectId: projectId,
        sessionId: sessionId,
      }),
    );

    const tabs: Array<TabChunkAggregate> = rows
      .map(parseTabAggregateRow)
      .sort((a: TabChunkAggregate, b: TabChunkAggregate): number => {
        return a.tabId.localeCompare(b.tabId);
      });

    expect(tabs).toHaveLength(2);

    const [tabA, tabB] = tabs as [TabChunkAggregate, TabChunkAggregate];

    expect(tabA.tabId).toBe("tab-a");
    expect(tabA.rumApplicationId).toBe(rumApplicationId);
    /* The stale redelivery of chunk 2 is deduped away. */
    expect(tabA.chunkCount).toBe(4);
    expect([...tabA.chunkIndexes].sort()).toEqual([0, 1, 2, 3]);
    expect(tabA.fullSnapshotChunkIndexes).toEqual([0]);
    expect(tabA.eventCount).toBe(
      40 + (SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS - 2) + 25 + 10,
    );
    expect(tabA.errorCount).toBe(3);
    /* Chunks 2 and 3 errored, not "every chunk of a tab that errored". */
    expect(tabA.erroredChunkCount).toBe(2);
    /* Chunk 0 is error-free at offset 0, so 30000 means the filter held. */
    expect(tabA.firstErrorOffsetMs).toBe(30000);
    /* Chunk 1 is below the activity threshold and contributes nothing. */
    expect(tabA.activeMs).toBe(3 * CHUNK_DURATION_MS);
    expect(tabA.hasFinalChunk).toBe(true);
    expect(tabA.firstUrl).toBe("https://app.example.com/");
    expect(tabA.lastUrl).toBe("https://app.example.com/checkout");
    expect(tabA.routes).toEqual(["/", "/checkout"]);
    expect(tabA.retentionDate.startsWith(retentionDate)).toBe(true);

    expect(tabB.tabId).toBe("tab-b");
    expect(tabB.chunkCount).toBe(1);
    expect(tabB.eventCount).toBe(12);
    expect(tabB.errorCount).toBe(3);
    expect(tabB.erroredChunkCount).toBe(1);
    expect(tabB.firstErrorOffsetMs).toBe(20000);
    expect(tabB.activeMs).toBe(CHUNK_DURATION_MS);
    expect(tabB.hasFinalChunk).toBe(false);
  });

  test("the batch correlation reads execute and find the session's telemetry", async () => {
    const window: {
      windowStartUnixMs: number;
      windowEndUnixMs: number;
    } = {
      windowStartUnixMs: sessionStart.getTime() - 60 * 60 * 1000,
      windowEndUnixMs: sessionStart.getTime() + 60 * 60 * 1000,
    };

    const exceptionRows: Array<JSONObject> = await readRows(
      buildSessionExceptionFingerprintStatement({
        databaseName: database,
        projectId: projectId,
        sessionIds: [sessionId],
        ...window,
      }),
    );

    expect(exceptionRows).toEqual([
      { sessionId: sessionId, exceptionFingerprints: [fingerprint] },
    ]);

    const traceRows: Array<JSONObject> = await readRows(
      buildSessionTraceIdStatement({
        databaseName: database,
        projectId: projectId,
        sessionIds: [sessionId],
        ...window,
      }),
    );

    expect(traceRows).toEqual([{ sessionId: sessionId, traceIds: [traceId] }]);
  });

  test("finalizeSession writes a finalized header the sweep no longer picks up", async () => {
    const sweep: () => Promise<Array<JSONObject>> = (): Promise<
      Array<JSONObject>
    > => {
      return readRows(
        buildNeverFinalizedStatement({
          databaseName: database,
          nowUnixMs: Date.now(),
          limit: 10,
        }),
      );
    };

    /* Provisional only: the sweep query runs and sees the session. */
    expect(
      (await sweep()).map((row: JSONObject): unknown => {
        return row["sessionId"];
      }),
    ).toEqual([sessionId]);

    const outcome: FinalizeSessionOutcome = await finalizeSession({
      projectId: projectId,
      sessionId: sessionId,
      databaseName: database,
      correlation: {
        traceIds: [traceId],
        exceptionFingerprints: [fingerprint],
      },
    });

    expect(outcome).toBe("written");

    const headers: Array<JSONObject> = await readRows(
      SQL`
        SELECT isFinalized, eventCount, errorCount, hasError, chunkCount,
          firstErrorOffsetMs, activeMs, durationMs, entryUrl, exitUrl, routes,
          traceIds, exceptionFingerprints
        FROM ${database}.${AnalyticsTableName.RumSession}
        WHERE sessionId = ${{ type: TableColumnType.Text, value: sessionId }}
        ORDER BY version DESC
        LIMIT 1`,
    );

    expect(headers).toHaveLength(1);

    const header: JSONObject = headers[0]!;

    expect(header["isFinalized"]).toBe(true);
    expect(Number(header["eventCount"])).toBe(
      40 + (SESSION_REPLAY_ACTIVE_CHUNK_MIN_EVENTS - 2) + 25 + 10 + 12,
    );
    expect(Number(header["errorCount"])).toBe(6);
    expect(header["hasError"]).toBe(true);
    expect(Number(header["chunkCount"])).toBe(5);
    expect(Number(header["firstErrorOffsetMs"])).toBe(20000);
    expect(Number(header["durationMs"])).toBe(60000);
    expect(Number(header["activeMs"])).toBe(60000);
    expect(header["entryUrl"]).toBe("https://app.example.com/");
    expect(header["exitUrl"]).toBe("https://app.example.com/checkout");
    expect(header["routes"]).toEqual(["/", "/account", "/checkout"]);
    expect(header["traceIds"]).toEqual([traceId]);
    expect(header["exceptionFingerprints"]).toEqual([fingerprint]);

    expect(await sweep()).toEqual([]);
  });
});

/*
 * The suite above is opt-in, and an opt-in regression guard that silently
 * stops opting in guards nothing. The App Test workflow starts a ClickHouse
 * service for it, so a missing URL there is a broken pipeline, not a skip.
 */
describe("Rum:FinalizeSessions ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
