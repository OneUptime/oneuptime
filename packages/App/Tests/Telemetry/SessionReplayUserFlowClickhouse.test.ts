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
import {
  USER_FLOW_MAX_PAGES_PER_JOURNEY,
  UserFlowJourneysResponseDto,
  UserFlowSessionDto,
} from "Common/Types/Rum/UserFlow";
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
import SessionReplayUserFlowReadService, {
  UserFlowJourneysRequest,
  UserFlowPersonFilter,
} from "Common/Server/Utils/SessionReplay/SessionReplayUserFlowReadService";

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
 *
 * The people, in an application of their own so the map tests above keep
 * their exact counts (see PERSON_SESSIONS).
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

/*
 * One application's people. Everything these sessions do is written the way
 * the ingest stores it, so the statements are proved against real rows:
 *
 *   janeOnPhone    Jane, on the shared browser. Leaves on a page she came
 *                  back to inside her last chunk, as an older recorder stored
 *                  it: /inbox, /inbox/7 and the flush url back on /inbox.
 *   janeOnLaptop   Jane on her own browser, still recording.
 *   bob            Bob, on the shared browser.
 *   anonymous      The shared browser with nobody signed in.
 *   unlinked       An older recorder: neither a key nor a visitor id.
 *   reidentified   Written as Jane, then superseded as Bob. It is Bob's: a
 *                  raw-row predicate would still hand it to Jane.
 *   identifiedLate A provisional header with nobody on it, then Jane. It is
 *                  Jane's, and the provisional row must not decide that.
 *   marathon       Jane again, navigating past the journey cap.
 *   lost           Jane's session sealed with no footage.
 */
const PERSON_SESSIONS: {
  janeOnPhone: string;
  janeOnLaptop: string;
  bob: string;
  anonymous: string;
  unlinked: string;
  reidentified: string;
  identifiedLate: string;
  marathon: string;
  lost: string;
} = {
  janeOnPhone: "b0000000000000000000000000000001",
  janeOnLaptop: "b0000000000000000000000000000002",
  bob: "b0000000000000000000000000000003",
  anonymous: "b0000000000000000000000000000004",
  unlinked: "b0000000000000000000000000000005",
  reidentified: "b0000000000000000000000000000006",
  identifiedLate: "b0000000000000000000000000000007",
  marathon: "b0000000000000000000000000000008",
  lost: "b0000000000000000000000000000009",
};

const peopleApplicationId: string = "6600000000000000000000c4";

const JANE_REFERENCE: string = "jane@example.com";
const BOB_REFERENCE: string = "bob@example.com";
const JANE_KEY: string = "a".repeat(64);
const BOB_KEY: string = "b".repeat(64);
const SHARED_BROWSER: string = "c".repeat(32);
const JANES_LAPTOP: string = "d".repeat(32);

/* Newest first: index 0 started ten minutes ago, the next a minute before. */
const PERSON_ORDER: Array<string> = [
  PERSON_SESSIONS.janeOnPhone,
  PERSON_SESSIONS.janeOnLaptop,
  PERSON_SESSIONS.bob,
  PERSON_SESSIONS.anonymous,
  PERSON_SESSIONS.unlinked,
  PERSON_SESSIONS.reidentified,
  PERSON_SESSIONS.identifiedLate,
  PERSON_SESSIONS.marathon,
  PERSON_SESSIONS.lost,
];

PERSON_ORDER.forEach((sessionId: string, position: number): void => {
  START[sessionId] = new Date(now - (10 + position) * 60 * 1000);
});

const MARATHON_PAGES: number = USER_FLOW_MAX_PAGES_PER_JOURNEY + 30;

function personChunk(
  sessionId: string,
  chunkIndex: number,
  url: string,
  routes: Array<string>,
  extra: Partial<ChunkFixture> = {},
): ChunkFixture {
  return {
    sessionId: sessionId,
    rumApplicationId: peopleApplicationId,
    tabId: "tab-1",
    chunkIndex: chunkIndex,
    version: 1000,
    startOffsetMs: chunkIndex * CHUNK_MS,
    url: url,
    routes: routes,
    ...extra,
  };
}

const marathonChunks: Array<ChunkFixture> = [];

for (let chunk: number = 0; chunk * 30 < MARATHON_PAGES; chunk++) {
  const routes: Array<string> = [];

  for (let page: number = 0; page < 30; page++) {
    if (chunk * 30 + page < MARATHON_PAGES) {
      routes.push(`${ORIGIN}/step/${chunk * 30 + page}`);
    }
  }

  marathonChunks.push(
    personChunk(
      PERSON_SESSIONS.marathon,
      chunk,
      routes[routes.length - 1] as string,
      routes,
    ),
  );
}

const personChunkFixtures: Array<ChunkFixture> = [
  personChunk(PERSON_SESSIONS.janeOnPhone, 0, `${ORIGIN}/inbox`, [
    `${ORIGIN}/inbox`,
  ]),
  personChunk(PERSON_SESSIONS.janeOnPhone, 1, `${ORIGIN}/inbox`, [
    `${ORIGIN}/inbox`,
    `${ORIGIN}/inbox/7`,
  ]),
  personChunk(
    PERSON_SESSIONS.janeOnLaptop,
    0,
    `${ORIGIN}/settings`,
    [`${ORIGIN}/`, `${ORIGIN}/settings`],
    { errorCount: 1 },
  ),
  personChunk(PERSON_SESSIONS.bob, 0, `${ORIGIN}/billing`, [
    `${ORIGIN}/billing`,
  ]),
  personChunk(PERSON_SESSIONS.anonymous, 0, `${ORIGIN}/pricing`, [
    `${ORIGIN}/pricing`,
  ]),
  personChunk(PERSON_SESSIONS.unlinked, 0, `${ORIGIN}/legacy`, [
    `${ORIGIN}/legacy`,
  ]),
  personChunk(PERSON_SESSIONS.reidentified, 0, `${ORIGIN}/switched`, [
    `${ORIGIN}/switched`,
  ]),
  personChunk(PERSON_SESSIONS.identifiedLate, 0, `${ORIGIN}/signed-in`, [
    `${ORIGIN}/signed-in`,
  ]),
  ...marathonChunks,
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

function personHeader(data: {
  sessionId: string;
  version?: number;
  key?: string;
  label?: string;
  visitorId?: string;
  isFinalized?: boolean;
  sealedReason?: string;
  chunkCount?: number;
}): JSONObject {
  return {
    ...headerRow({
      sessionId: data.sessionId,
      rumApplicationId: peopleApplicationId,
      version: data.version ?? 1000,
      entryUrl: `${ORIGIN}/entry`,
      deviceType: "mobile",
    }),
    identifiedUserKey: data.key ?? "",
    identifiedUserLabel: data.label ?? "",
    visitorId: data.visitorId ?? "",
    isFinalized: data.isFinalized ?? true,
    sealedReason: data.sealedReason ?? "",
    chunkCount: data.chunkCount ?? 2,
  };
}

const personHeaderFixtures: Array<JSONObject> = [
  personHeader({
    sessionId: PERSON_SESSIONS.janeOnPhone,
    key: JANE_KEY,
    label: JANE_REFERENCE,
    visitorId: SHARED_BROWSER,
  }),
  personHeader({
    sessionId: PERSON_SESSIONS.janeOnLaptop,
    key: JANE_KEY,
    label: JANE_REFERENCE,
    visitorId: JANES_LAPTOP,
    isFinalized: false,
    chunkCount: 0,
  }),
  personHeader({
    sessionId: PERSON_SESSIONS.bob,
    key: BOB_KEY,
    label: BOB_REFERENCE,
    visitorId: SHARED_BROWSER,
  }),
  personHeader({
    sessionId: PERSON_SESSIONS.anonymous,
    visitorId: SHARED_BROWSER,
  }),
  personHeader({ sessionId: PERSON_SESSIONS.unlinked }),
  personHeader({
    sessionId: PERSON_SESSIONS.reidentified,
    version: 1000,
    key: JANE_KEY,
    label: JANE_REFERENCE,
  }),
  personHeader({
    sessionId: PERSON_SESSIONS.reidentified,
    version: 2000,
    key: BOB_KEY,
    label: BOB_REFERENCE,
  }),
  personHeader({ sessionId: PERSON_SESSIONS.identifiedLate, version: 1000 }),
  personHeader({
    sessionId: PERSON_SESSIONS.identifiedLate,
    version: 2000,
    key: JANE_KEY,
    label: JANE_REFERENCE,
  }),
  personHeader({
    sessionId: PERSON_SESSIONS.marathon,
    key: JANE_KEY,
    label: JANE_REFERENCE,
  }),
  personHeader({
    sessionId: PERSON_SESSIONS.lost,
    key: JANE_KEY,
    label: JANE_REFERENCE,
    sealedReason: "recording-lost",
    chunkCount: 0,
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

    /*
     * optimize_on_insert off: the engine otherwise replaces rows within one
     * insert, and a superseded version or a stale delivery would never reach
     * the table. In production they arrive in separate inserts and sit beside
     * the newer row until a merge, which is exactly what these tests read.
     */
    const settings: { wait_for_async_insert: 1; optimize_on_insert: 0 } = {
      wait_for_async_insert: 1,
      optimize_on_insert: 0,
    };

    await RumSessionChunkService.insertJsonRows(
      [...chunkFixtures, ...personChunkFixtures].map(chunkRow),
      { clickhouseSettings: settings },
    );

    await RumSessionService.insertJsonRows(
      [...headerFixtures, ...personHeaderFixtures],
      { clickhouseSettings: settings },
    );
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

  describe("one person", () => {
    const readPerson: (
      person: UserFlowPersonFilter,
      extra?: Partial<UserFlowJourneysRequest>,
    ) => Promise<UserFlowJourneysResponseDto> = (
      person: UserFlowPersonFilter,
      extra: Partial<UserFlowJourneysRequest> = {},
    ): Promise<UserFlowJourneysResponseDto> => {
      return SessionReplayUserFlowReadService.readJourneys({
        projectId: projectId,
        rumApplicationId: new ObjectID(peopleApplicationId),
        startTime: windowStart,
        endTime: windowEnd,
        person: person,
        ...extra,
      });
    };

    const idsOf: (response: UserFlowJourneysResponseDto) => Array<string> = (
      response: UserFlowJourneysResponseDto,
    ): Array<string> => {
      return response.sessions.map((session: UserFlowSessionDto): string => {
        return session.sessionId;
      });
    };

    const sessionOf: (
      response: UserFlowJourneysResponseDto,
      sessionId: string,
    ) => UserFlowSessionDto = (
      response: UserFlowJourneysResponseDto,
      sessionId: string,
    ): UserFlowSessionDto => {
      return response.sessions.find((session: UserFlowSessionDto): boolean => {
        return session.sessionId === sessionId;
      }) as UserFlowSessionDto;
    };

    const JANES_SESSIONS: Array<string> = [
      PERSON_SESSIONS.janeOnPhone,
      PERSON_SESSIONS.janeOnLaptop,
      PERSON_SESSIONS.identifiedLate,
      PERSON_SESSIONS.marathon,
      PERSON_SESSIONS.lost,
    ];

    test("a digest selects that person's sessions across browsers, and nobody else's", async () => {
      const response: UserFlowJourneysResponseDto = await readPerson({
        identifiedUserKey: JANE_KEY,
      });

      expect(idsOf(response)).toEqual(JANES_SESSIONS);
      expect(response.sessionsInWindow).toBe(5);
      expect(response.isSampled).toBe(false);
      expect(response.pages).not.toContain(`${ORIGIN}/billing`);
      expect(response.pages).not.toContain(`${ORIGIN}/pricing`);
    });

    test("whose a session is, is decided by its newest header, in all three reads", async () => {
      const jane: UserFlowJourneysResponseDto = await readPerson({
        identifiedUserKey: JANE_KEY,
      });
      const bob: UserFlowJourneysResponseDto = await readPerson({
        identifiedUserKey: BOB_KEY,
      });

      /* Superseded as Bob: not Jane's, though a raw row still says it is. */
      expect(idsOf(jane)).not.toContain(PERSON_SESSIONS.reidentified);
      expect(jane.pages).not.toContain(`${ORIGIN}/switched`);
      expect(idsOf(bob)).toEqual([
        PERSON_SESSIONS.bob,
        PERSON_SESSIONS.reidentified,
      ]);
      expect(bob.sessionsInWindow).toBe(2);

      /* Identified late: Jane's, with its journey read from the chunks. */
      expect(idsOf(jane)).toContain(PERSON_SESSIONS.identifiedLate);
      expect(jane.pages).toContain(`${ORIGIN}/signed-in`);
    });

    test("a visitor id selects every session of one browser, whoever was signed in", async () => {
      const response: UserFlowJourneysResponseDto = await readPerson({
        visitorId: SHARED_BROWSER,
      });

      expect(idsOf(response)).toEqual([
        PERSON_SESSIONS.janeOnPhone,
        PERSON_SESSIONS.bob,
        PERSON_SESSIONS.anonymous,
      ]);

      /* The list can say who each one was. */
      expect(
        response.sessions.map((session: UserFlowSessionDto): string => {
          return session.detail?.identifiedUserKey ?? "missing";
        }),
      ).toEqual([JANE_KEY, BOB_KEY, ""]);
    });

    test("a session id selects that session alone", async () => {
      const response: UserFlowJourneysResponseDto = await readPerson({
        sessionId: PERSON_SESSIONS.bob,
      });

      expect(idsOf(response)).toEqual([PERSON_SESSIONS.bob]);
      expect(response.sessionsInWindow).toBe(1);
      expect(pagesOf(response, PERSON_SESSIONS.bob)).toEqual([
        `${ORIGIN}/billing`,
      ]);
    });

    test("what someone typed matches whichever of the three it turns out to be", async () => {
      const asUser: UserFlowJourneysResponseDto = await readPerson({
        identifiedUserKey: JANE_KEY,
        visitorId: JANE_KEY.slice(0, 32),
        sessionId: JANE_KEY,
      });
      const asVisitor: UserFlowJourneysResponseDto = await readPerson({
        identifiedUserKey: "e".repeat(64),
        visitorId: JANES_LAPTOP,
        sessionId: JANES_LAPTOP,
      });
      const asSession: UserFlowJourneysResponseDto = await readPerson({
        identifiedUserKey: "e".repeat(64),
        sessionId: PERSON_SESSIONS.anonymous,
      });

      expect(idsOf(asUser)).toEqual(JANES_SESSIONS);
      expect(idsOf(asVisitor)).toEqual([PERSON_SESSIONS.janeOnLaptop]);
      expect(idsOf(asSession)).toEqual([PERSON_SESSIONS.anonymous]);
    });

    test("nobody matching is no sessions, never everyone's", async () => {
      const nobody: UserFlowJourneysResponseDto = await readPerson({
        identifiedUserKey: "f".repeat(64),
      });
      const empty: UserFlowJourneysResponseDto = await readPerson({});

      expect(nobody.sessions).toEqual([]);
      expect(nobody.sessionsInWindow).toBe(0);
      expect(empty.sessions).toEqual([]);
      expect(empty.sessionsInWindow).toBe(0);
    });

    test("the cap keeps the person's newest, and says there were more", async () => {
      const response: UserFlowJourneysResponseDto = await readPerson(
        { identifiedUserKey: JANE_KEY },
        { maxSessions: 2 },
      );

      expect(idsOf(response)).toEqual(JANES_SESSIONS.slice(0, 2));
      expect(response.sessionsInWindow).toBe(5);
      expect(response.isSampled).toBe(true);
      /* The chunk read's IN-subquery picked the same two. */
      expect(pagesOf(response, JANES_SESSIONS[1] as string)).toEqual([
        `${ORIGIN}/`,
        `${ORIGIN}/settings`,
      ]);
    });

    test("the label is read only for a role that may read it", async () => {
      const denied: UserFlowJourneysResponseDto = await readPerson({
        identifiedUserKey: JANE_KEY,
      });
      const allowed: UserFlowJourneysResponseDto = await readPerson(
        { identifiedUserKey: JANE_KEY },
        { includeIdentifiedUserLabel: true },
      );

      expect(denied.sessions[0]?.detail).not.toHaveProperty(
        "identifiedUserLabel",
      );
      expect(JSON.stringify(denied)).not.toContain(JANE_REFERENCE);
      expect(allowed.sessions[0]?.detail?.identifiedUserLabel).toBe(
        JANE_REFERENCE,
      );
      expect(denied.sessions[0]?.detail?.identifiedUserKey).toBe(JANE_KEY);
    });

    test("everyone's read names nobody", async () => {
      const response: UserFlowJourneysResponseDto =
        await SessionReplayUserFlowReadService.readJourneys({
          projectId: projectId,
          rumApplicationId: new ObjectID(peopleApplicationId),
          startTime: windowStart,
          endTime: windowEnd,
          includeIdentifiedUserLabel: true,
        });

      expect(response.sessions).toHaveLength(PERSON_ORDER.length);

      for (const session of response.sessions) {
        expect(session.detail).toBeUndefined();
      }

      expect(JSON.stringify(response)).not.toContain(JANE_KEY);
      expect(JSON.stringify(response)).not.toContain(JANE_REFERENCE);
      expect(JSON.stringify(response)).not.toContain(SHARED_BROWSER);
    });

    test("says whether there is anything to watch and whether it is still recording", async () => {
      const response: UserFlowJourneysResponseDto = await readPerson({
        identifiedUserKey: JANE_KEY,
      });

      expect(
        sessionOf(response, PERSON_SESSIONS.janeOnPhone).detail,
      ).toMatchObject({
        isFinalized: true,
        chunkCount: 2,
        sealedReason: "",
      });
      expect(sessionOf(response, PERSON_SESSIONS.lost).detail).toMatchObject({
        isFinalized: true,
        chunkCount: 0,
        sealedReason: "recording-lost",
      });
      expect(
        sessionOf(response, PERSON_SESSIONS.janeOnLaptop).detail,
      ).toMatchObject({ isFinalized: false, hasRecordingEnded: false });
    });

    test("a journey ends on the page it ended on, even one it came back to", async () => {
      const response: UserFlowJourneysResponseDto = await readPerson({
        sessionId: PERSON_SESSIONS.janeOnPhone,
      });

      /*
       * Stored as an older recorder wrote it: the last chunk's list holds
       * /inbox once, and only its flush url says she went back.
       */
      expect(pagesOf(response, PERSON_SESSIONS.janeOnPhone)).toEqual([
        `${ORIGIN}/inbox`,
        `${ORIGIN}/inbox/7`,
        `${ORIGIN}/inbox`,
      ]);
    });

    test("a journey past the cap keeps its head and says where it really ended", async () => {
      const response: UserFlowJourneysResponseDto = await readPerson({
        sessionId: PERSON_SESSIONS.marathon,
      });
      const session: UserFlowSessionDto = sessionOf(
        response,
        PERSON_SESSIONS.marathon,
      );

      expect(session.pages).toHaveLength(USER_FLOW_MAX_PAGES_PER_JOURNEY);
      expect(response.pages[session.pages[0] as number]).toBe(
        `${ORIGIN}/step/0`,
      );
      expect(response.pages[session.exitPage as number]).toBe(
        `${ORIGIN}/step/${MARATHON_PAGES - 1}`,
      );
    });

    test("a journey within the cap carries no separate exit", async () => {
      const response: UserFlowJourneysResponseDto = await readPerson({
        identifiedUserKey: JANE_KEY,
      });

      expect(
        sessionOf(response, PERSON_SESSIONS.janeOnPhone).exitPage,
      ).toBeUndefined();
    });

    test("another application's read cannot reach these people", async () => {
      const response: UserFlowJourneysResponseDto =
        await SessionReplayUserFlowReadService.readJourneys({
          projectId: projectId,
          rumApplicationId: new ObjectID(rumApplicationId),
          startTime: windowStart,
          endTime: windowEnd,
          person: { identifiedUserKey: JANE_KEY },
        });

      expect(response.sessions).toEqual([]);
      expect(response.sessionsInWindow).toBe(0);
    });
  });
});

describe("User Flows ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
