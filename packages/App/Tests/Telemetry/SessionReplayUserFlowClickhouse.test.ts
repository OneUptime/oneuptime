import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsTableEngine from "Common/Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumSessionChunk from "Common/Models/AnalyticsModels/RumSessionChunk";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import { UserFlowJourneysResponseDto } from "Common/Types/Rum/UserFlow";
import {
  analyzeUserFlow,
  UserFlowAnalysis,
  UserFlowNode,
} from "Common/Utils/Rum/UserFlow";
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
 * The User Flows read against a real ClickHouse server.
 *
 * SessionReplayUserFlowReadService builds its journeys with nested array
 * lambdas (arraySort over tuples, arrayFlatten, an arrayFilter that reads
 * the previous element by index) plus an IN-subquery that must pick the
 * same newest-N sessions as the header read. A statement-text test cannot
 * tell whether ClickHouse accepts any of that, or whether a retried chunk
 * delivery is really collapsed - so this suite runs readJourneys, the exact
 * code the endpoint calls, against tables built from the real models.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/SessionReplayUserFlowClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
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

import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import SessionReplayUserFlowReadService from "Common/Server/Utils/SessionReplay/SessionReplayUserFlowReadService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `rum_user_flow_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID("6600000000000000000000c1");
const rumApplicationId: string = "6600000000000000000000c2";
const otherApplicationId: string = "6600000000000000000000c3";

const ORIGIN: string = "https://shop.example.com";
const CHUNK_MS: number = 15 * 1000;

const now: number = Date.now();
const windowStart: Date = new Date(now - 2 * 60 * 60 * 1000);
const windowEnd: Date = new Date(now);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

/*
 * The sessions, newest first:
 *
 *   journey   an MPA-style walk across two tabs, with chunk 1 delivered
 *             twice (the stale copy names a page the user never saw), an
 *             error on the product page and rage clicks on the cart.
 *   landing   a header whose chunks never arrived: falls back to its entry
 *             URL.
 *   blank     chunks with no URL at all: also falls back to the entry URL.
 *   elsewhere another application's session in the same window.
 *   ancient   this application, three days before the window.
 */
const SESSIONS: {
  journey: string;
  landing: string;
  blank: string;
  elsewhere: string;
  ancient: string;
} = {
  journey: "a0000000000000000000000000000001",
  landing: "a0000000000000000000000000000002",
  blank: "a0000000000000000000000000000003",
  elsewhere: "a0000000000000000000000000000004",
  ancient: "a0000000000000000000000000000005",
};

const START: Record<string, Date> = {
  [SESSIONS.journey]: new Date(now - 10 * 60 * 1000),
  [SESSIONS.landing]: new Date(now - 20 * 60 * 1000),
  [SESSIONS.blank]: new Date(now - 30 * 60 * 1000),
  [SESSIONS.elsewhere]: new Date(now - 15 * 60 * 1000),
  [SESSIONS.ancient]: new Date(now - 3 * 24 * 60 * 60 * 1000),
};

interface ChunkFixture {
  sessionId: string;
  rumApplicationId?: string;
  tabId: string;
  chunkIndex: number;
  version: number;
  startOffsetMs: number;
  url: string;
  routes: Array<string>;
  errorCount?: number;
  rageClickCount?: number;
}

const chunkFixtures: Array<ChunkFixture> = [
  {
    sessionId: SESSIONS.journey,
    tabId: "tab-1",
    chunkIndex: 0,
    version: 1000,
    startOffsetMs: 0,
    url: `${ORIGIN}/products`,
    routes: [`${ORIGIN}/`, `${ORIGIN}/products`],
  },
  /* The stale delivery of chunk 1: must lose to the version below. */
  {
    sessionId: SESSIONS.journey,
    tabId: "tab-1",
    chunkIndex: 1,
    version: 900,
    startOffsetMs: CHUNK_MS,
    url: `${ORIGIN}/never-seen`,
    routes: [`${ORIGIN}/never-seen`],
  },
  {
    sessionId: SESSIONS.journey,
    tabId: "tab-1",
    chunkIndex: 1,
    version: 1000,
    startOffsetMs: CHUNK_MS,
    url: `${ORIGIN}/products/42`,
    routes: [`${ORIGIN}/products`, `${ORIGIN}/products/42`],
    errorCount: 2,
  },
  /*
   * A new page load: the browser recorder mints a new tab per load, and its
   * chunk index restarts at 0. Ordered by start time, not by index.
   */
  {
    sessionId: SESSIONS.journey,
    tabId: "tab-2",
    chunkIndex: 0,
    version: 1000,
    startOffsetMs: 2 * CHUNK_MS,
    url: `${ORIGIN}/cart`,
    routes: [`${ORIGIN}/cart`],
    rageClickCount: 3,
  },
  {
    sessionId: SESSIONS.blank,
    tabId: "tab-1",
    chunkIndex: 0,
    version: 1000,
    startOffsetMs: 0,
    url: "",
    routes: [],
  },
  {
    sessionId: SESSIONS.elsewhere,
    rumApplicationId: otherApplicationId,
    tabId: "tab-1",
    chunkIndex: 0,
    version: 1000,
    startOffsetMs: 0,
    url: `${ORIGIN}/other-app`,
    routes: [`${ORIGIN}/other-app`],
  },
  {
    sessionId: SESSIONS.ancient,
    tabId: "tab-1",
    chunkIndex: 0,
    version: 1000,
    startOffsetMs: 0,
    url: `${ORIGIN}/ancient`,
    routes: [`${ORIGIN}/ancient`],
  },
];

function chunkRow(fixture: ChunkFixture): JSONObject {
  const sessionStart: Date = START[fixture.sessionId] as Date;
  const endOffsetMs: number = fixture.startOffsetMs + CHUNK_MS;
  const applicationId: string = fixture.rumApplicationId || rumApplicationId;

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: projectId.toString(),
    sessionId: fixture.sessionId,
    tabId: fixture.tabId,
    chunkIndex: fixture.chunkIndex,
    version: String(fixture.version),
    rumApplicationId: applicationId,
    primaryEntityId: applicationId,
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
    eventCount: 20,
    hasFullSnapshot: fixture.chunkIndex === 0,
    isFinal: false,
    isPinnedCopy: false,
    recorderKind: "dom",
    payloadEncoding: "identity",
    schemaVersion: 1,
    payload: "[]",
    payloadBytes: "100",
    errorCount: fixture.errorCount || 0,
    rageClickCount: fixture.rageClickCount || 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: fixture.routes.length,
    clickCount: 0,
    customEventCount: 0,
    url: fixture.url,
    routes: fixture.routes,
    retentionDate: retentionDate,
  };
}

function headerRow(data: {
  sessionId: string;
  rumApplicationId?: string;
  version: number;
  entryUrl: string;
  deviceType: string;
}): JSONObject {
  const sessionStart: Date = START[data.sessionId] as Date;
  const applicationId: string = data.rumApplicationId || rumApplicationId;

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: projectId.toString(),
    rumApplicationId: applicationId,
    primaryEntityId: applicationId,
    primaryEntityType: "RealUserMonitor",
    startTime: OneUptimeDate.toClickhouseDateTime64(sessionStart),
    clientReportedStartTime: OneUptimeDate.toClickhouseDateTime64(sessionStart),
    endTime: OneUptimeDate.toClickhouseDateTime64(
      new Date(sessionStart.getTime() + CHUNK_MS),
    ),
    sessionId: data.sessionId,
    version: String(data.version),
    isFinalized: false,
    triggerReason: "sampled",
    samplePercentageAtCapture: 100,
    errorCount: 0,
    entryUrl: data.entryUrl,
    exitUrl: data.entryUrl,
    deviceType: data.deviceType,
    browserName: "Chrome",
    countryCode: "DK",
    retentionDate: retentionDate,
  };
}

const headerFixtures: Array<JSONObject> = [
  /* Provisional and finalized header of one session: counted once. */
  headerRow({
    sessionId: SESSIONS.journey,
    version: 1000,
    entryUrl: `${ORIGIN}/`,
    deviceType: "desktop",
  }),
  headerRow({
    sessionId: SESSIONS.journey,
    version: 2000,
    entryUrl: `${ORIGIN}/`,
    deviceType: "mobile",
  }),
  headerRow({
    sessionId: SESSIONS.landing,
    version: 1000,
    entryUrl: `${ORIGIN}/landing`,
    deviceType: "desktop",
  }),
  headerRow({
    sessionId: SESSIONS.blank,
    version: 1000,
    entryUrl: `${ORIGIN}/blank-entry`,
    deviceType: "tablet",
  }),
  headerRow({
    sessionId: SESSIONS.elsewhere,
    rumApplicationId: otherApplicationId,
    version: 1000,
    entryUrl: `${ORIGIN}/other-app`,
    deviceType: "desktop",
  }),
  headerRow({
    sessionId: SESSIONS.ancient,
    version: 1000,
    entryUrl: `${ORIGIN}/ancient`,
    deviceType: "desktop",
  }),
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

  const engine: string =
    model.tableEngine === AnalyticsTableEngine.ReplacingMergeTree
      ? "ReplacingMergeTree(version)"
      : "MergeTree";

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${engine} PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
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

function pagesOf(
  response: UserFlowJourneysResponseDto,
  sessionId: string,
): Array<string> | undefined {
  const session: UserFlowJourneysResponseDto["sessions"][number] | undefined =
    response.sessions.find(
      (candidate: UserFlowJourneysResponseDto["sessions"][number]): boolean => {
        return candidate.sessionId === sessionId;
      },
    );

  return session?.pages.map((index: number): string => {
    return response.pages[index] as string;
  });
}

integration("User Flows journeys against ClickHouse", () => {
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
    client = await clickhouse.connect(options);

    for (const modelType of [RumSessionChunk, RumSession]) {
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

    await RumSessionService.insertJsonRows(headerFixtures, {
      clickhouseSettings: { wait_for_async_insert: 1 },
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

  test("reads every session of the application in the window, newest first", async () => {
    const response: UserFlowJourneysResponseDto =
      await SessionReplayUserFlowReadService.readJourneys({
        projectId: projectId,
        rumApplicationId: new ObjectID(rumApplicationId),
        startTime: windowStart,
        endTime: windowEnd,
      });

    expect(
      response.sessions.map(
        (session: UserFlowJourneysResponseDto["sessions"][number]): string => {
          return session.sessionId;
        },
      ),
    ).toEqual([SESSIONS.journey, SESSIONS.landing, SESSIONS.blank]);
    expect(response.sessionsInWindow).toBe(3);
    expect(response.isSampled).toBe(false);
  });

  test("orders pages across chunks and tabs, collapses repeats, and ignores the stale delivery", async () => {
    const response: UserFlowJourneysResponseDto =
      await SessionReplayUserFlowReadService.readJourneys({
        projectId: projectId,
        rumApplicationId: new ObjectID(rumApplicationId),
        startTime: windowStart,
        endTime: windowEnd,
      });

    expect(pagesOf(response, SESSIONS.journey)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/products`,
      `${ORIGIN}/products/42`,
      `${ORIGIN}/cart`,
    ]);
    expect(response.pages).not.toContain(`${ORIGIN}/never-seen`);
    expect(response.pages).not.toContain(`${ORIGIN}/other-app`);
    expect(response.pages).not.toContain(`${ORIGIN}/ancient`);
  });

  test("carries the newest header's device facts and the chunks' totals and span", async () => {
    const response: UserFlowJourneysResponseDto =
      await SessionReplayUserFlowReadService.readJourneys({
        projectId: projectId,
        rumApplicationId: new ObjectID(rumApplicationId),
        startTime: windowStart,
        endTime: windowEnd,
      });
    const journey: UserFlowJourneysResponseDto["sessions"][number] =
      response.sessions[0]!;

    expect(journey.deviceType).toBe("mobile");
    expect(journey.browserName).toBe("Chrome");
    expect(journey.errorCount).toBe(2);
    expect(journey.frustrationCount).toBe(3);
    expect(journey.durationMs).toBe(3 * CHUNK_MS);
    expect(journey.startUnixMs).toBe(START[SESSIONS.journey]!.getTime());

    const signals: Record<string, [number, number]> = {};

    for (const [index, errors, frustration] of journey.pageSignals) {
      signals[response.pages[index] as string] = [errors, frustration];
    }

    expect(signals).toEqual({
      [`${ORIGIN}/products/42`]: [2, 0],
      [`${ORIGIN}/cart`]: [0, 3],
    });
  });

  test("a session without usable chunks falls back to its entry URL", async () => {
    const response: UserFlowJourneysResponseDto =
      await SessionReplayUserFlowReadService.readJourneys({
        projectId: projectId,
        rumApplicationId: new ObjectID(rumApplicationId),
        startTime: windowStart,
        endTime: windowEnd,
      });

    expect(pagesOf(response, SESSIONS.landing)).toEqual([`${ORIGIN}/landing`]);
    expect(pagesOf(response, SESSIONS.blank)).toEqual([
      `${ORIGIN}/blank-entry`,
    ]);
  });

  test("the session cap keeps the newest and says the window held more", async () => {
    const response: UserFlowJourneysResponseDto =
      await SessionReplayUserFlowReadService.readJourneys({
        projectId: projectId,
        rumApplicationId: new ObjectID(rumApplicationId),
        startTime: windowStart,
        endTime: windowEnd,
        maxSessions: 1,
      });

    expect(response.sessions).toHaveLength(1);
    expect(response.sessions[0]?.sessionId).toBe(SESSIONS.journey);
    /* The chunk read's IN-subquery picked the same session as the header read. */
    expect(response.sessions[0]?.pages).toHaveLength(4);
    expect(response.sessionsInWindow).toBe(3);
    expect(response.isSampled).toBe(true);
    expect(response.maxSessions).toBe(1);
  });

  test("the journeys fold into a flow map", async () => {
    const response: UserFlowJourneysResponseDto =
      await SessionReplayUserFlowReadService.readJourneys({
        projectId: projectId,
        rumApplicationId: new ObjectID(rumApplicationId),
        startTime: windowStart,
        endTime: windowEnd,
      });
    const analysis: UserFlowAnalysis = analyzeUserFlow(response, {});
    const labels: Array<string> = analysis.graph.nodes.map(
      (node: UserFlowNode): string => {
        return `${node.step}:${node.page}:${node.sessions}`;
      },
    );

    expect(labels).toEqual([
      "0:/:1",
      "0:/blank-entry:1",
      "0:/landing:1",
      "1:/products:1",
      "2:/products/:id:1",
      "3:/cart:1",
    ]);
    expect(analysis.summary.bounceRate).toBeCloseTo(2 / 3);
  });
});

describe("User Flows ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
