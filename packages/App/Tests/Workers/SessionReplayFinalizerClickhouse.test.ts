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
  hasSessionRecordingEnded,
  hasTabRecordingEnded,
} from "Common/Utils/Rum/SessionReplayRecordingEnded";
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
    version: 2000,
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

  test("the chunk aggregate reads each tab's end facts, and the shared rule agrees", async () => {
    /*
     * The two expressions the recording-ended rule reads sit beside
     * aggregates that read isFinal, chunkStartTime and chunkEndTime, which
     * is exactly where an alias clash becomes ILLEGAL_AGGREGATION - so the
     * server has to accept them, not just the string test.
     */
    const rows: Array<JSONObject> = await readRows(
      buildTabAggregateStatement({
        databaseName: database,
        projectId: projectId,
        sessionId: sessionId,
      }),
    );

    const tabs: Map<string, TabChunkAggregate> = new Map<
      string,
      TabChunkAggregate
    >(
      rows.map((row: JSONObject): [string, TabChunkAggregate] => {
        const tab: TabChunkAggregate = parseTabAggregateRow(row);
        return [tab.tabId, tab];
      }),
    );

    const tabA: TabChunkAggregate = tabs.get("tab-a")!;
    const tabB: TabChunkAggregate = tabs.get("tab-b")!;

    /* tab-a's final chunk 3 spans 45s-60s and is also its latest start. */
    expect(tabA.finalChunkEndUnixMs).toBe(sessionStart.getTime() + 60000);
    expect(tabA.lastChunkStartUnixMs).toBe(sessionStart.getTime() + 45000);
    expect(hasTabRecordingEnded(tabA)).toBe(true);

    /* maxIf over no final chunk is the epoch, which reads as 0. */
    expect(tabB.finalChunkEndUnixMs).toBe(0);
    expect(tabB.lastChunkStartUnixMs).toBe(sessionStart.getTime() + 20000);
    expect(hasTabRecordingEnded(tabB)).toBe(false);

    /*
     * max(chunkIndex) and max(version) sit beside aggregates that read both
     * columns too, and max(version) must cover the deduped rows: tab-a's
     * stale redelivery of chunk 2 is version 500, its newest rows 1000.
     */
    expect(tabA.maxChunkIndex).toBe(3);
    expect(tabA.lastChunkStoredAtUnixMs).toBe(1000);
    expect(tabB.maxChunkIndex).toBe(0);
    expect(tabB.lastChunkStoredAtUnixMs).toBe(2000);

    /* Stored long before "now", so only tab-b being live holds it back. */
    expect(hasSessionRecordingEnded([tabA], Date.now())).toBe(true);
    expect(hasSessionRecordingEnded([tabA, tabB], Date.now())).toBe(false);
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

  /*
   * #4207, against the real server: a tab left open with nobody at it. One
   * snapshot chunk, then the empty seal an older recorder sent when its idle
   * rollover noticed - half an hour later. The footage columns sit beside
   * aggregates that read eventCount and chunkEndTime, so the server has to
   * accept them, and the header must say 15 seconds, not 30 minutes.
   */
  test("a seal sent an idle window after the footage does not stretch the session", async () => {
    const idleSessionId: string = "2a1b3c4d5e6f708192a3b4c5d6e7f801";
    const sealOffsetMs: number = CHUNK_DURATION_MS + 30 * 60 * 1000;
    const sealAt: string = OneUptimeDate.toClickhouseDateTime64(
      new Date(sessionStart.getTime() + sealOffsetMs),
    );

    await RumSessionChunkService.insertJsonRows(
      [
        {
          ...chunkRow({
            tabId: "tab-a",
            chunkIndex: 0,
            version: 1000,
            startOffsetMs: 0,
            eventCount: 2,
            errorCount: 0,
            hasFullSnapshot: true,
            url: "https://app.example.com/login",
          }),
          sessionId: idleSessionId,
        },
        {
          ...chunkRow({
            tabId: "tab-a",
            chunkIndex: 1,
            version: 1000,
            startOffsetMs: sealOffsetMs,
            eventCount: 0,
            errorCount: 0,
            isFinal: true,
            url: "https://app.example.com/login",
          }),
          sessionId: idleSessionId,
          chunkEndOffsetMs: sealOffsetMs,
          chunkEndTime: sealAt,
          payloadBytes: "2",
        },
      ],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );

    await RumSessionService.insertJsonRows(
      [{ ...provisionalHeaderRow(), sessionId: idleSessionId }],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );

    const tabs: Array<TabChunkAggregate> = (
      await readRows(
        buildTabAggregateStatement({
          databaseName: database,
          projectId: projectId,
          sessionId: idleSessionId,
        }),
      )
    ).map(parseTabAggregateRow);

    expect(tabs).toHaveLength(1);

    const tab: TabChunkAggregate = tabs[0]!;

    expect(tab.lastChunkEndUnixMs).toBe(
      sessionStart.getTime() + CHUNK_DURATION_MS,
    );

    /* The seal still ends the tab, at its own time. */
    expect(tab.hasFinalChunk).toBe(true);
    expect(tab.finalChunkEndUnixMs).toBe(sessionStart.getTime() + sealOffsetMs);
    expect(hasTabRecordingEnded(tab)).toBe(true);

    const outcome: FinalizeSessionOutcome = await finalizeSession({
      projectId: projectId,
      sessionId: idleSessionId,
      databaseName: database,
      correlation: { traceIds: [], exceptionFingerprints: [] },
    });

    expect(outcome).toBe("written");

    const headers: Array<JSONObject> = await readRows(
      SQL`
        SELECT isFinalized, durationMs, chunkCount, eventCount
        FROM ${database}.${AnalyticsTableName.RumSession}
        WHERE sessionId = ${{ type: TableColumnType.Text, value: idleSessionId }}
        ORDER BY version DESC
        LIMIT 1`,
    );

    expect(headers).toHaveLength(1);
    expect(headers[0]!["isFinalized"]).toBe(true);
    expect(Number(headers[0]!["durationMs"])).toBe(CHUNK_DURATION_MS);
    expect(Number(headers[0]!["chunkCount"])).toBe(2);
    expect(Number(headers[0]!["eventCount"])).toBe(2);
  });

  /*
   * #4206, against the real server. The session is identified (and tagged)
   * by a page the user signed in on; a NEWER header version comes from a
   * page that named nobody - the login page an app's sign-out redirects to,
   * written by an upload that raced the identified one. The finalized row
   * must still name the person, with their traits and the tags, while
   * every other column (exitUrl here) still comes from the newest version.
   *
   * One insert per version, as the ingest writes them, with merges held
   * off: ReplacingMergeTree collapses same-key rows inside one insert
   * block (optimize_on_insert) and in a background merge, and either
   * would leave only the newest version for the read to see. That is also
   * the honest limit of this read - it can only find a version a merge
   * has not removed yet; the ingest's carry is what keeps the newest
   * version right in the first place.
   */
  test("the finalized row keeps the newest identity and tags even when a newer version names nobody", async () => {
    const signedInSessionId: string = "3b2c4d5e6f708192a3b4c5d6e7f80912";
    const userKey: string = "c".repeat(64);
    const headerBase: JSONObject = {
      ...provisionalHeaderRow(),
      sessionId: signedInSessionId,
    };
    const baseVersion: number = sessionStart.getTime();

    await RumSessionChunkService.insertJsonRows(
      [
        {
          ...chunkRow({
            tabId: "tab-app",
            chunkIndex: 0,
            version: 1000,
            startOffsetMs: 0,
            eventCount: 30,
            errorCount: 0,
            hasFullSnapshot: true,
            url: "https://app.example.com/orders",
          }),
          sessionId: signedInSessionId,
        },
        {
          ...chunkRow({
            tabId: "tab-login",
            chunkIndex: 0,
            version: 1000,
            startOffsetMs: 20000,
            eventCount: 5,
            errorCount: 0,
            hasFullSnapshot: true,
            isFinal: true,
            url: "https://app.example.com/login",
          }),
          sessionId: signedInSessionId,
        },
      ],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );

    const versions: Array<JSONObject> = [
      /* An older identified version that a newer identity replaced. */
      {
        ...headerBase,
        _id: ObjectID.generateTimeOrdered().toString(),
        version: String(baseVersion),
        identifiedUserKey: "a".repeat(64),
        identifiedUserLabel: "someone-before@example.com",
        identifiedUserTraits: { role: "intern" },
        tags: { build: "1.0.0" },
      },
      /* The newest version that names a person, and has tags. */
      {
        ...headerBase,
        _id: ObjectID.generateTimeOrdered().toString(),
        version: String(baseVersion + 1),
        identifiedUserKey: userKey,
        identifiedUserLabel: "jshoemaker@example.com",
        identifiedUserTraits: { role: "manager" },
        tags: { build: "1.2.3" },
      },
      /* The newest version of all: a page that named nobody. */
      {
        ...headerBase,
        _id: ObjectID.generateTimeOrdered().toString(),
        version: String(baseVersion + 2),
        exitUrl: "https://app.example.com/login",
      },
    ];

    const table: string = `${database}.${AnalyticsTableName.RumSession}`;

    await client.command({ query: `SYSTEM STOP MERGES ${table}` });

    try {
      for (const version of versions) {
        await RumSessionService.insertJsonRows([version], {
          clickhouseSettings: { wait_for_async_insert: 1 },
        });
      }

      /* All three versions are there for the read to choose from. */
      expect(
        await readRows(
          SQL`
            SELECT version
            FROM ${database}.${AnalyticsTableName.RumSession}
            WHERE sessionId = ${{ type: TableColumnType.Text, value: signedInSessionId }}`,
        ),
      ).toHaveLength(3);

      const outcome: FinalizeSessionOutcome = await finalizeSession({
        projectId: projectId,
        sessionId: signedInSessionId,
        databaseName: database,
        correlation: { traceIds: [], exceptionFingerprints: [] },
      });

      expect(outcome).toBe("written");
    } finally {
      await client.command({ query: `SYSTEM START MERGES ${table}` });
    }

    const headers: Array<JSONObject> = await readRows(
      SQL`
        SELECT isFinalized, identifiedUserKey, identifiedUserLabel,
          identifiedUserTraits, tags, exitUrl
        FROM ${database}.${AnalyticsTableName.RumSession}
        WHERE sessionId = ${{ type: TableColumnType.Text, value: signedInSessionId }}
        ORDER BY version DESC
        LIMIT 1`,
    );

    expect(headers).toHaveLength(1);

    const header: JSONObject = headers[0]!;

    expect(header["isFinalized"]).toBe(true);
    expect(header["identifiedUserKey"]).toBe(userKey);
    expect(header["identifiedUserLabel"]).toBe("jshoemaker@example.com");
    expect(header["identifiedUserTraits"]).toEqual({ role: "manager" });
    expect(header["tags"]).toEqual({ build: "1.2.3" });
    expect(header["exitUrl"]).toBe("https://app.example.com/login");
  });

  test("a session nobody identified finalizes anonymous, with empty maps", async () => {
    const anonymousSessionId: string = "4c3d5e6f708192a3b4c5d6e7f8091a2b";

    await RumSessionChunkService.insertJsonRows(
      [
        {
          ...chunkRow({
            tabId: "tab-a",
            chunkIndex: 0,
            version: 1000,
            startOffsetMs: 0,
            eventCount: 10,
            errorCount: 0,
            hasFullSnapshot: true,
            isFinal: true,
            url: "https://app.example.com/login",
          }),
          sessionId: anonymousSessionId,
        },
      ],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );

    await RumSessionService.insertJsonRows(
      [
        { ...provisionalHeaderRow(), sessionId: anonymousSessionId },
        {
          ...provisionalHeaderRow(),
          sessionId: anonymousSessionId,
          version: String(sessionStart.getTime() + 1),
        },
      ],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );

    const outcome: FinalizeSessionOutcome = await finalizeSession({
      projectId: projectId,
      sessionId: anonymousSessionId,
      databaseName: database,
      correlation: { traceIds: [], exceptionFingerprints: [] },
    });

    expect(outcome).toBe("written");

    const headers: Array<JSONObject> = await readRows(
      SQL`
        SELECT isFinalized, identifiedUserKey, identifiedUserLabel,
          identifiedUserTraits, tags
        FROM ${database}.${AnalyticsTableName.RumSession}
        WHERE sessionId = ${{ type: TableColumnType.Text, value: anonymousSessionId }}
        ORDER BY version DESC
        LIMIT 1`,
    );

    expect(headers).toHaveLength(1);
    expect(headers[0]!["isFinalized"]).toBe(true);
    expect(headers[0]!["identifiedUserKey"]).toBe("");
    expect(headers[0]!["identifiedUserLabel"]).toBe("");
    expect(headers[0]!["identifiedUserTraits"]).toEqual({});
    expect(headers[0]!["tags"]).toEqual({});
  });

  /*
   * #4207 from a React Native app still on an older recorder: used for 15
   * seconds, put in the background, and brought back two hours later - when
   * that recorder sealed the session with a final chunk holding only its
   * rotation marker. Not empty, so hasFootage in the inner query is what
   * has to recognise it, on the raw recorderKind (the outer SELECT aliases
   * it), and the header must say 15 seconds, not two hours.
   */
  test("an older React Native recorder's marker sent when the app came back does not stretch the session", async () => {
    const appSessionId: string = "5d4e6f708192a3b4c5d6e7f8091a2b3c";
    const markerOffsetMs: number = CHUNK_DURATION_MS + 2 * 60 * 60 * 1000;
    const markerAt: string = OneUptimeDate.toClickhouseDateTime64(
      new Date(sessionStart.getTime() + markerOffsetMs),
    );

    await RumSessionChunkService.insertJsonRows(
      [
        {
          ...chunkRow({
            tabId: "app-launch",
            chunkIndex: 0,
            version: 1000,
            startOffsetMs: 0,
            eventCount: 3,
            errorCount: 0,
            hasFullSnapshot: true,
          }),
          sessionId: appSessionId,
          recorderKind: "rn-view-tree",
        },
        {
          ...chunkRow({
            tabId: "app-launch",
            chunkIndex: 1,
            version: 1000,
            startOffsetMs: markerOffsetMs,
            eventCount: 1,
            errorCount: 0,
            isFinal: true,
          }),
          sessionId: appSessionId,
          recorderKind: "rn-view-tree",
          chunkEndOffsetMs: markerOffsetMs,
          chunkEndTime: markerAt,
        },
      ],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );

    await RumSessionService.insertJsonRows(
      [{ ...provisionalHeaderRow(), sessionId: appSessionId }],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );

    const tabs: Array<TabChunkAggregate> = (
      await readRows(
        buildTabAggregateStatement({
          databaseName: database,
          projectId: projectId,
          sessionId: appSessionId,
        }),
      )
    ).map(parseTabAggregateRow);

    expect(tabs).toHaveLength(1);

    const tab: TabChunkAggregate = tabs[0]!;

    expect(tab.recorderKind).toBe("rn-view-tree");
    expect(tab.lastChunkEndUnixMs).toBe(
      sessionStart.getTime() + CHUNK_DURATION_MS,
    );

    /* The marker still ends the tab, at its own time. */
    expect(tab.hasFinalChunk).toBe(true);
    expect(tab.finalChunkEndUnixMs).toBe(
      sessionStart.getTime() + markerOffsetMs,
    );
    expect(hasTabRecordingEnded(tab)).toBe(true);

    const outcome: FinalizeSessionOutcome = await finalizeSession({
      projectId: projectId,
      sessionId: appSessionId,
      databaseName: database,
      correlation: { traceIds: [], exceptionFingerprints: [] },
    });

    expect(outcome).toBe("written");

    const headers: Array<JSONObject> = await readRows(
      SQL`
        SELECT isFinalized, durationMs, chunkCount, eventCount
        FROM ${database}.${AnalyticsTableName.RumSession}
        WHERE sessionId = ${{ type: TableColumnType.Text, value: appSessionId }}
        ORDER BY version DESC
        LIMIT 1`,
    );

    expect(headers).toHaveLength(1);
    expect(headers[0]!["isFinalized"]).toBe(true);
    expect(Number(headers[0]!["durationMs"])).toBe(CHUNK_DURATION_MS);
    expect(Number(headers[0]!["chunkCount"])).toBe(2);
    expect(Number(headers[0]!["eventCount"])).toBe(4);
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
