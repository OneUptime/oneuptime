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
} from "Common/Types/Rum/UserFlow";
import {
  analyzeUserFlow,
  toSessionListUrlPrefix,
  toUserFlowPageKey,
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
  UserFlowJourneysScope,
} from "Common/Server/Utils/SessionReplay/SessionReplayUserFlowReadService";
import SessionReplayReadService, {
  SessionReplayListItem,
  SessionReplayListResult,
} from "Common/Server/Utils/SessionReplay/SessionReplayReadService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `rum_user_flow_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID("6600000000000000000000c1");
const rumApplicationId: string = "6600000000000000000000c2";
const otherApplicationId: string = "6600000000000000000000c3";
const returnApplicationId: string = "6600000000000000000000c7";
const longApplicationId: string = "6600000000000000000000c4";

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

/*
 * Who those sessions belong to:
 *
 *   JANE     journey and ancient, and a session in the other application -
 *            the key is per project, so she is one person across both. Her
 *            journey session's provisional header was written before the
 *            recorder said who she was; only the newest header names her,
 *            under a label that changed between the two.
 *   VISITOR  journey (signed in on this browser) and landing (not signed in).
 *   FORMER   the key on a superseded header of blank: the page switched
 *            user, so a read of that key must not find the session.
 */
/* One session in an application of its own, so it counts in no other test. */
const LONG_SESSION: string = "a0000000000000000000000000000006";
const LONGEST_JOURNEY: Array<string> = Array.from(
  { length: USER_FLOW_MAX_PAGES_PER_JOURNEY + 1 },
  (_value: unknown, index: number): string => {
    return `${ORIGIN}/step-${index}`;
  },
);

/*
 * Also in an application of its own: a session that came back to the page it
 * left, stored the two ways that happens. RETURN_IN_LAST_CHUNK is as an older
 * recorder wrote it: the last chunk's list holds /inbox once, and only its
 * flush url says the visitor went back. RETURN_KEPT is as the recorders write
 * it now, with the return in the list itself.
 */
const RETURN_IN_LAST_CHUNK: string = "a0000000000000000000000000000007";
const RETURN_KEPT: string = "a0000000000000000000000000000008";

const JANE_KEY: string = "1".repeat(64);
const FORMER_KEY: string = "2".repeat(64);
const VISITOR_ID: string = "b".repeat(32);

/*
 * The session list a User Flows row hands its page to ("show sessions"),
 * in an application of its own. Each session went to one page, stored as
 * the ingest stores it: in its routes, or in its entry URL alone, as a
 * session from before route lists were stored has it.
 */
const pageApplicationId: string = "6600000000000000000000c9";

const PAGE_SESSIONS: {
  hashRoute: string;
  hashbangRoute: string;
  hashEntry: string;
  home: string;
  cafeUpper: string;
  cafeLower: string;
  cafeDecomposed: string;
  cafeHashRoute: string;
  slashEscaped: string;
  slashEscapedLower: string;
  slashPlain: string;
  cartUpper: string;
  cartLower: string;
  notUtf8: string;
} = {
  // #7878: a hash router's routes, kept by the scrubber.
  hashRoute: "c0000000000000000000000000000001",
  hashbangRoute: "c0000000000000000000000000000002",
  hashEntry: "c0000000000000000000000000000003",
  home: "c0000000000000000000000000000004",
  /*
   * #7877: one page in each spelling a browser can give it, stored as it
   * was before the scrubber wrote one, and pages a spelling must not join.
   */
  cafeUpper: "c0000000000000000000000000000005",
  cafeLower: "c0000000000000000000000000000006",
  cafeDecomposed: "c0000000000000000000000000000007",
  cafeHashRoute: "c0000000000000000000000000000008",
  slashEscaped: "c0000000000000000000000000000009",
  slashEscapedLower: "c000000000000000000000000000000a",
  slashPlain: "c000000000000000000000000000000b",
  cartUpper: "c000000000000000000000000000000c",
  cartLower: "c000000000000000000000000000000d",
  notUtf8: "c000000000000000000000000000000e",
};

const PAGE_FIXTURES: Array<{
  sessionId: string;
  routes: Array<string>;
  entryUrl: string;
}> = [
  {
    sessionId: PAGE_SESSIONS.hashRoute,
    routes: [`${ORIGIN}/#/orders`, `${ORIGIN}/#/settings`],
    entryUrl: `${ORIGIN}/#/orders`,
  },
  {
    sessionId: PAGE_SESSIONS.hashbangRoute,
    routes: [`${ORIGIN}/app/#!/orders/42`],
    entryUrl: `${ORIGIN}/app/#!/orders/42`,
  },
  {
    sessionId: PAGE_SESSIONS.hashEntry,
    routes: [],
    entryUrl: `${ORIGIN}/#/orders/7`,
  },
  {
    sessionId: PAGE_SESSIONS.home,
    routes: [`${ORIGIN}/`, `${ORIGIN}/pricing`],
    entryUrl: `${ORIGIN}/`,
  },
  {
    sessionId: PAGE_SESSIONS.cafeUpper,
    routes: [`${ORIGIN}/caf%C3%A9`],
    entryUrl: `${ORIGIN}/caf%C3%A9`,
  },
  {
    // Lower-case hex, as .NET and WordPress write it.
    sessionId: PAGE_SESSIONS.cafeLower,
    routes: [`${ORIGIN}/`, `${ORIGIN}/caf%c3%a9/menu`],
    entryUrl: `${ORIGIN}/`,
  },
  {
    // The accent decomposed, in the entry URL alone.
    sessionId: PAGE_SESSIONS.cafeDecomposed,
    routes: [],
    entryUrl: `${ORIGIN}/cafe%CC%81`,
  },
  {
    sessionId: PAGE_SESSIONS.cafeHashRoute,
    routes: [`${ORIGIN}/#/caf%c3%a9`],
    entryUrl: `${ORIGIN}/#/caf%c3%a9`,
  },
  {
    sessionId: PAGE_SESSIONS.slashEscaped,
    routes: [`${ORIGIN}/a%2Fb`],
    entryUrl: `${ORIGIN}/a%2Fb`,
  },
  {
    sessionId: PAGE_SESSIONS.slashEscapedLower,
    routes: [`${ORIGIN}/a%2fb`],
    entryUrl: `${ORIGIN}/a%2fb`,
  },
  {
    // An escape further on, so the list reads this path in one spelling too.
    sessionId: PAGE_SESSIONS.slashPlain,
    routes: [`${ORIGIN}/a/b/caf%C3%A9`],
    entryUrl: `${ORIGIN}/a/b/caf%C3%A9`,
  },
  {
    sessionId: PAGE_SESSIONS.cartUpper,
    routes: [`${ORIGIN}/Cart`],
    entryUrl: `${ORIGIN}/Cart`,
  },
  {
    sessionId: PAGE_SESSIONS.cartLower,
    routes: [`${ORIGIN}/cart`],
    entryUrl: `${ORIGIN}/cart`,
  },
  {
    // Bytes that are not UTF-8: cut short, and one no character starts with.
    sessionId: PAGE_SESSIONS.notUtf8,
    routes: [`${ORIGIN}/x%E0%A4`, `${ORIGIN}/caf%FF`],
    entryUrl: `${ORIGIN}/x%E0%A4`,
  },
];

const START: Record<string, Date> = {
  [SESSIONS.journey]: new Date(now - 10 * 60 * 1000),
  [SESSIONS.landing]: new Date(now - 20 * 60 * 1000),
  [SESSIONS.blank]: new Date(now - 30 * 60 * 1000),
  [SESSIONS.elsewhere]: new Date(now - 15 * 60 * 1000),
  [SESSIONS.ancient]: new Date(now - 3 * 24 * 60 * 60 * 1000),
  [LONG_SESSION]: new Date(now - 5 * 60 * 1000),
  [RETURN_IN_LAST_CHUNK]: new Date(now - 6 * 60 * 1000),
  [RETURN_KEPT]: new Date(now - 7 * 60 * 1000),
  ...Object.fromEntries(
    PAGE_FIXTURES.map(
      (fixture: { sessionId: string }, index: number): [string, Date] => {
        return [fixture.sessionId, new Date(now - (40 + index) * 60 * 1000)];
      },
    ),
  ),
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
  // The application's own signals (issue #6443): every hit, and the frustrating ones.
  customSignalCount?: number;
  customSignalFrustrationCount?: number;
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
    customSignalCount: 7,
    customSignalFrustrationCount: 7,
  },
  /*
   * Two of the application's own signals: one counts as frustration, one
   * is a marker, which frustration never counts (issue #6443).
   */
  {
    sessionId: SESSIONS.journey,
    tabId: "tab-1",
    chunkIndex: 1,
    version: 1000,
    startOffsetMs: CHUNK_MS,
    url: `${ORIGIN}/products/42`,
    routes: [`${ORIGIN}/products`, `${ORIGIN}/products/42`],
    errorCount: 2,
    customSignalCount: 2,
    customSignalFrustrationCount: 1,
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
  {
    sessionId: LONG_SESSION,
    rumApplicationId: longApplicationId,
    tabId: "tab-1",
    chunkIndex: 0,
    version: 1000,
    startOffsetMs: 0,
    url: LONGEST_JOURNEY[LONGEST_JOURNEY.length - 1] as string,
    routes: LONGEST_JOURNEY,
  },
  {
    sessionId: RETURN_IN_LAST_CHUNK,
    rumApplicationId: returnApplicationId,
    tabId: "tab-1",
    chunkIndex: 0,
    version: 1000,
    startOffsetMs: 0,
    url: `${ORIGIN}/inbox`,
    routes: [`${ORIGIN}/inbox`],
  },
  {
    sessionId: RETURN_IN_LAST_CHUNK,
    rumApplicationId: returnApplicationId,
    tabId: "tab-1",
    chunkIndex: 1,
    version: 1000,
    startOffsetMs: CHUNK_MS,
    url: `${ORIGIN}/inbox`,
    routes: [`${ORIGIN}/inbox`, `${ORIGIN}/inbox/7`],
  },
  {
    sessionId: RETURN_KEPT,
    rumApplicationId: returnApplicationId,
    tabId: "tab-1",
    chunkIndex: 0,
    version: 1000,
    startOffsetMs: 0,
    url: `${ORIGIN}/inbox`,
    routes: [
      `${ORIGIN}/inbox`,
      `${ORIGIN}/inbox/7`,
      `${ORIGIN}/inbox`,
      `${ORIGIN}/inbox/8`,
      `${ORIGIN}/inbox`,
    ],
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
    customSignalCount: fixture.customSignalCount || 0,
    customSignalFrustrationCount: fixture.customSignalFrustrationCount || 0,
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
  identifiedUserKey?: string;
  identifiedUserLabel?: string;
  visitorId?: string;
  isFinalized?: boolean;
  chunkCount?: number;
  sealedReason?: string;
  routes?: Array<string>;
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
    isFinalized: data.isFinalized ?? false,
    chunkCount: data.chunkCount ?? 0,
    sealedReason: data.sealedReason ?? "",
    identifiedUserKey: data.identifiedUserKey ?? "",
    identifiedUserLabel: data.identifiedUserLabel ?? "",
    visitorId: data.visitorId ?? "",
    triggerReason: "sampled",
    samplePercentageAtCapture: 100,
    errorCount: 0,
    entryUrl: data.entryUrl,
    exitUrl: data.entryUrl,
    routes: data.routes ?? [],
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
    visitorId: VISITOR_ID,
  }),
  headerRow({
    sessionId: SESSIONS.journey,
    version: 2000,
    entryUrl: `${ORIGIN}/`,
    deviceType: "mobile",
    identifiedUserKey: JANE_KEY,
    identifiedUserLabel: "jane@example.com",
    visitorId: VISITOR_ID,
    isFinalized: true,
    chunkCount: 3,
  }),
  headerRow({
    sessionId: SESSIONS.landing,
    version: 1000,
    entryUrl: `${ORIGIN}/landing`,
    deviceType: "desktop",
    visitorId: VISITOR_ID,
  }),
  headerRow({
    sessionId: SESSIONS.blank,
    version: 1000,
    entryUrl: `${ORIGIN}/blank-entry`,
    deviceType: "tablet",
    identifiedUserKey: FORMER_KEY,
    identifiedUserLabel: "former@example.com",
  }),
  /* Finalized with nothing stored: there is no recording to offer. */
  headerRow({
    sessionId: SESSIONS.blank,
    version: 2000,
    entryUrl: `${ORIGIN}/blank-entry`,
    deviceType: "tablet",
    isFinalized: true,
    chunkCount: 0,
  }),
  headerRow({
    sessionId: SESSIONS.elsewhere,
    rumApplicationId: otherApplicationId,
    version: 1000,
    entryUrl: `${ORIGIN}/other-app`,
    deviceType: "desktop",
    identifiedUserKey: JANE_KEY,
    identifiedUserLabel: "jane@example.com",
  }),
  headerRow({
    sessionId: SESSIONS.ancient,
    version: 1000,
    entryUrl: `${ORIGIN}/ancient`,
    deviceType: "desktop",
    identifiedUserKey: JANE_KEY,
    identifiedUserLabel: "j.doe@example.com",
    sealedReason: "recording-lost",
    isFinalized: true,
    chunkCount: 1,
  }),
  headerRow({
    sessionId: LONG_SESSION,
    rumApplicationId: longApplicationId,
    version: 1000,
    entryUrl: LONGEST_JOURNEY[0] as string,
    deviceType: "desktop",
  }),
  headerRow({
    sessionId: RETURN_IN_LAST_CHUNK,
    rumApplicationId: returnApplicationId,
    version: 1000,
    entryUrl: `${ORIGIN}/inbox`,
    deviceType: "desktop",
  }),
  headerRow({
    sessionId: RETURN_KEPT,
    rumApplicationId: returnApplicationId,
    version: 1000,
    entryUrl: `${ORIGIN}/inbox`,
    deviceType: "desktop",
  }),
  ...PAGE_FIXTURES.map(
    (fixture: (typeof PAGE_FIXTURES)[number]): JSONObject => {
      return headerRow({
        sessionId: fixture.sessionId,
        rumApplicationId: pageApplicationId,
        version: 1000,
        entryUrl: fixture.entryUrl,
        routes: fixture.routes,
        deviceType: "desktop",
        isFinalized: true,
        chunkCount: 1,
      });
    },
  ),
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

    /*
     * One insert per version, with merges stopped. ReplacingMergeTree keeps
     * only the newest of the rows one insert holds, so written together a
     * superseded header would never exist. The real thing is a provisional
     * header and a finalized one in two parts, until a merge happens to run.
     */
    await client.command({
      query: `SYSTEM STOP MERGES ${database}.${new RumSession().tableName}`,
    });

    for (const version of ["1000", "2000"]) {
      await RumSessionService.insertJsonRows(
        headerFixtures.filter((row: JSONObject): boolean => {
          return row["version"] === version;
        }),
        { clickhouseSettings: { wait_for_async_insert: 1 } },
      );
    }
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
    /* The rage clicks and the one own signal that counts; not the marker. */
    expect(journey.frustrationCount).toBe(4);
    expect(journey.durationMs).toBe(3 * CHUNK_MS);
    expect(journey.startUnixMs).toBe(START[SESSIONS.journey]!.getTime());

    const signals: Record<string, [number, number]> = {};

    for (const [index, errors, frustration] of journey.pageSignals) {
      signals[response.pages[index] as string] = [errors, frustration];
    }

    expect(signals).toEqual({
      [`${ORIGIN}/products/42`]: [2, 1],
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

  test("a session that goes on past the page cap says so", async () => {
    const response: UserFlowJourneysResponseDto =
      await SessionReplayUserFlowReadService.readJourneys({
        projectId: projectId,
        rumApplicationId: new ObjectID(longApplicationId),
        startTime: windowStart,
        endTime: windowEnd,
      });
    const session: UserFlowJourneysResponseDto["sessions"][number] =
      response.sessions[0]!;

    expect(session.pages).toHaveLength(USER_FLOW_MAX_PAGES_PER_JOURNEY);
    expect(session.isTruncated).toBe(true);
    /* The page it was cut after is the last one sent, not the one after. */
    expect(response.pages).not.toContain(
      LONGEST_JOURNEY[USER_FLOW_MAX_PAGES_PER_JOURNEY],
    );
  });

  describe("a page the visitor came back to", () => {
    const readReturns: () => Promise<UserFlowJourneysResponseDto> =
      (): Promise<UserFlowJourneysResponseDto> => {
        return SessionReplayUserFlowReadService.readJourneys({
          projectId: projectId,
          rumApplicationId: new ObjectID(returnApplicationId),
          startTime: windowStart,
          endTime: windowEnd,
        });
      };

    /*
     * Without the flush url this journey ended on /inbox/7, and the page
     * called that the exit page of a session that left from /inbox.
     */
    test("a return in the last chunk is where the journey ends, in a recording that lists a page once", async () => {
      expect(pagesOf(await readReturns(), RETURN_IN_LAST_CHUNK)).toEqual([
        `${ORIGIN}/inbox`,
        `${ORIGIN}/inbox/7`,
        `${ORIGIN}/inbox`,
      ]);
    });

    test("a list that keeps its returns reads as it was lived", async () => {
      expect(pagesOf(await readReturns(), RETURN_KEPT)).toEqual([
        `${ORIGIN}/inbox`,
        `${ORIGIN}/inbox/7`,
        `${ORIGIN}/inbox`,
        `${ORIGIN}/inbox/8`,
        `${ORIGIN}/inbox`,
      ]);
    });
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

  describe("narrowed to one person or one session", () => {
    const sessionIdsOf: (
      response: UserFlowJourneysResponseDto,
    ) => Array<string> = (
      response: UserFlowJourneysResponseDto,
    ): Array<string> => {
      return response.sessions.map(
        (session: UserFlowJourneysResponseDto["sessions"][number]): string => {
          return session.sessionId;
        },
      );
    };

    const read: (
      scope: UserFlowJourneysScope,
      options?: { includeIdentifiedUserLabel?: boolean; startTime?: Date },
    ) => Promise<UserFlowJourneysResponseDto> = (
      scope: UserFlowJourneysScope,
      options: { includeIdentifiedUserLabel?: boolean; startTime?: Date } = {},
    ): Promise<UserFlowJourneysResponseDto> => {
      return SessionReplayUserFlowReadService.readJourneys({
        projectId: projectId,
        rumApplicationId: new ObjectID(rumApplicationId),
        startTime: options.startTime || windowStart,
        endTime: windowEnd,
        scope: scope,
        includeIdentifiedUserLabel: options.includeIdentifiedUserLabel ?? true,
      });
    };

    test("a user's key finds their session in this application and window, and nobody else's", async () => {
      const response: UserFlowJourneysResponseDto = await read({
        kind: "user",
        identifiedUserKey: JANE_KEY,
      });

      expect(sessionIdsOf(response)).toEqual([SESSIONS.journey]);
      /* The chunk read's IN-subquery narrowed with the header read. */
      expect(pagesOf(response, SESSIONS.journey)).toEqual([
        `${ORIGIN}/`,
        `${ORIGIN}/products`,
        `${ORIGIN}/products/42`,
        `${ORIGIN}/cart`,
      ]);
      expect(response.sessionsInWindow).toBe(1);
      expect(response.isSampled).toBe(false);
      expect(response.pages).not.toContain(`${ORIGIN}/landing`);
      expect(response.scope).toEqual({
        kind: "user",
        identifiedUserKey: JANE_KEY,
        visitorId: "",
        sessionId: "",
        identifiedUserLabel: "jane@example.com",
      });
    });

    test("a wider window reaches their older session, and the newest label wins", async () => {
      const response: UserFlowJourneysResponseDto = await read(
        { kind: "user", identifiedUserKey: JANE_KEY },
        { startTime: new Date(now - 7 * 24 * 60 * 60 * 1000) },
      );

      expect(sessionIdsOf(response)).toEqual([
        SESSIONS.journey,
        SESSIONS.ancient,
      ]);
      expect(response.sessionsInWindow).toBe(2);
      expect(response.scope?.identifiedUserLabel).toBe("jane@example.com");
    });

    test("a person is judged on the newest header, never on a superseded one", async () => {
      const response: UserFlowJourneysResponseDto = await read({
        kind: "user",
        identifiedUserKey: FORMER_KEY,
      });

      expect(response.sessions).toEqual([]);
      expect(response.sessionsInWindow).toBe(0);
      /* Still says what was asked, with no session to name them. */
      expect(response.scope).toEqual({
        kind: "user",
        identifiedUserKey: FORMER_KEY,
        visitorId: "",
        sessionId: "",
        identifiedUserLabel: "",
      });
    });

    test("a key nobody has answers empty, not with everyone", async () => {
      const response: UserFlowJourneysResponseDto = await read({
        kind: "user",
        identifiedUserKey: "f".repeat(64),
      });

      expect(response.sessions).toEqual([]);
      expect(response.pages).toEqual([]);
      expect(response.sessionsInWindow).toBe(0);
    });

    test("a visitor finds every session from that browser, signed in or not", async () => {
      const response: UserFlowJourneysResponseDto = await read({
        kind: "visitor",
        visitorId: VISITOR_ID,
      });

      expect(sessionIdsOf(response)).toEqual([
        SESSIONS.journey,
        SESSIONS.landing,
      ]);
      expect(response.sessionsInWindow).toBe(2);
      expect(response.scope).toEqual({
        kind: "visitor",
        identifiedUserKey: "",
        visitorId: VISITOR_ID,
        sessionId: "",
      });
    });

    test("a session is found by id and says whose it is", async () => {
      const response: UserFlowJourneysResponseDto = await read({
        kind: "session",
        sessionId: SESSIONS.journey,
      });

      expect(sessionIdsOf(response)).toEqual([SESSIONS.journey]);
      expect(response.sessionsInWindow).toBe(1);
      expect(response.scope).toEqual({
        kind: "session",
        identifiedUserKey: JANE_KEY,
        visitorId: VISITOR_ID,
        sessionId: SESSIONS.journey,
        identifiedUserLabel: "jane@example.com",
      });
    });

    test("a session of another application, or outside the window, is not found", async () => {
      for (const sessionId of [SESSIONS.elsewhere, SESSIONS.ancient]) {
        const response: UserFlowJourneysResponseDto = await read({
          kind: "session",
          sessionId: sessionId,
        });

        expect(response.sessions).toEqual([]);
        expect(response.sessionsInWindow).toBe(0);
      }
    });

    test("the label is read only for a role that may read it", async () => {
      const response: UserFlowJourneysResponseDto = await read(
        { kind: "user", identifiedUserKey: JANE_KEY },
        { includeIdentifiedUserLabel: false },
      );

      expect(sessionIdsOf(response)).toEqual([SESSIONS.journey]);
      expect(response.scope).toEqual({
        kind: "user",
        identifiedUserKey: JANE_KEY,
        visitorId: "",
        sessionId: "",
      });
    });

    test("a recording is offered when there is footage, by the session list's rule", async () => {
      const everyone: UserFlowJourneysResponseDto = await read({
        kind: "visitor",
        visitorId: VISITOR_ID,
      });
      const blank: UserFlowJourneysResponseDto = await read({
        kind: "session",
        sessionId: SESSIONS.blank,
      });
      const lost: UserFlowJourneysResponseDto = await read(
        { kind: "user", identifiedUserKey: JANE_KEY },
        { startTime: new Date(now - 7 * 24 * 60 * 60 * 1000) },
      );

      const hasRecording: (
        response: UserFlowJourneysResponseDto,
        sessionId: string,
      ) => boolean | undefined = (
        response: UserFlowJourneysResponseDto,
        sessionId: string,
      ): boolean | undefined => {
        return response.sessions.find(
          (
            session: UserFlowJourneysResponseDto["sessions"][number],
          ): boolean => {
            return session.sessionId === sessionId;
          },
        )?.hasRecording;
      };

      /* Finalized with chunks counted. */
      expect(hasRecording(everyone, SESSIONS.journey)).toBe(true);
      /* Not finalized: its zero means "not counted yet". */
      expect(hasRecording(everyone, SESSIONS.landing)).toBe(true);
      /* Finalized with nothing stored. */
      expect(hasRecording(blank, SESSIONS.blank)).toBe(false);
      /* Sealed as lost, whatever it counted. */
      expect(hasRecording(lost, SESSIONS.ancient)).toBe(false);
    });

    test("a read over everyone stays silent about who anyone is", async () => {
      const response: UserFlowJourneysResponseDto =
        await SessionReplayUserFlowReadService.readJourneys({
          projectId: projectId,
          rumApplicationId: new ObjectID(rumApplicationId),
          startTime: windowStart,
          endTime: windowEnd,
          includeIdentifiedUserLabel: true,
        });

      expect(response.scope).toBeNull();

      for (const session of response.sessions) {
        expect(session.hasRecording).toBeUndefined();
      }
    });
  });

  /*
   * A row's "show sessions" hands its page to the session list as
   * urlPrefix (toSessionListUrlPrefix), and the list matches it in SQL -
   * so the match is proven here, by the read the endpoint runs.
   */
  describe("a page's sessions in the session list", () => {
    const listed: (urlPrefix: string) => Promise<Array<string>> = async (
      urlPrefix: string,
    ): Promise<Array<string>> => {
      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions({
          projectId: projectId,
          rumApplicationId: new ObjectID(pageApplicationId),
          startTime: windowStart,
          endTime: windowEnd,
          filters: { urlPrefix: urlPrefix },
          limit: 50,
          includeIdentifiedUserLabel: false,
        });

      return result.sessions
        .map((session: SessionReplayListItem): string => {
          return session.sessionId;
        })
        .sort();
    };

    // What a User Flows row of the page at `url` asks the list for.
    const showSessionsOf: (url: string) => string = (url: string): string => {
      return toSessionListUrlPrefix(
        toUserFlowPageKey(url, {
          groupDynamicSegments: true,
          includeHost: false,
        }),
      );
    };

    test("every session reads back without a filter", async () => {
      expect(await listed("")).toEqual(
        PAGE_FIXTURES.map((fixture: { sessionId: string }): string => {
          return fixture.sessionId;
        }).sort(),
      );
    });

    /*
     * #7878: ClickHouse's path() stops at the fragment, so a hash router's
     * every page has the path "/" there. The route is matched as the page.
     */
    test("a hash router's route is found by its path, in a route or the entry URL", async () => {
      expect(await listed("/orders")).toEqual(
        [
          PAGE_SESSIONS.hashRoute,
          PAGE_SESSIONS.hashbangRoute,
          PAGE_SESSIONS.hashEntry,
        ].sort(),
      );
      expect(await listed("/settings")).toEqual([PAGE_SESSIONS.hashRoute]);
      expect(await listed(showSessionsOf(`${ORIGIN}/#!/orders/42`))).toEqual(
        [PAGE_SESSIONS.hashbangRoute, PAGE_SESSIONS.hashEntry].sort(),
      );
      // The page's own path still matches as it did.
      expect(await listed("/app")).toEqual([PAGE_SESSIONS.hashbangRoute]);
      expect(await listed("/pricing")).toEqual([PAGE_SESSIONS.home]);
      // An absolute prefix still matches the whole URL.
      expect(await listed(`${ORIGIN}/#/orders`)).toEqual(
        [PAGE_SESSIONS.hashRoute, PAGE_SESSIONS.hashEntry].sort(),
      );
    });

    /*
     * #7877: a session recorded before the scrubber stored one spelling
     * holds whichever the browser had. A row's key is in one spelling, and
     * the list finds every spelling of it, in a route, a hash route or the
     * entry URL - while "/a%2Fb" and "/a/b", and "/Cart" and "/cart", stay
     * two pages.
     */
    test("every spelling of a row's page is listed, and only those", async () => {
      const cafe: Array<string> = [
        PAGE_SESSIONS.cafeUpper,
        PAGE_SESSIONS.cafeLower,
        PAGE_SESSIONS.cafeDecomposed,
        PAGE_SESSIONS.cafeHashRoute,
      ].sort();

      for (const url of [
        `${ORIGIN}/caf%C3%A9`,
        `${ORIGIN}/caf%c3%a9`,
        `${ORIGIN}/cafe%CC%81`,
        `${ORIGIN}/café`,
      ]) {
        expect(showSessionsOf(url)).toBe("/caf%C3%A9");
        expect(await listed(showSessionsOf(url))).toEqual(cafe);
      }

      // Typed in the search box in its letters, or in lower-case hex.
      expect(await listed("/café")).toEqual(cafe);
      expect(await listed("/caf%c3%a9")).toEqual(cafe);

      expect(await listed(showSessionsOf(`${ORIGIN}/a%2fb`))).toEqual(
        [PAGE_SESSIONS.slashEscaped, PAGE_SESSIONS.slashEscapedLower].sort(),
      );
      expect(await listed(showSessionsOf(`${ORIGIN}/a/b`))).toEqual([
        PAGE_SESSIONS.slashPlain,
      ]);
      expect(await listed(showSessionsOf(`${ORIGIN}/Cart`))).toEqual([
        PAGE_SESSIONS.cartUpper,
      ]);
      expect(await listed(showSessionsOf(`${ORIGIN}/cart`))).toEqual([
        PAGE_SESSIONS.cartLower,
      ]);
    });

    /*
     * Bytes that are not UTF-8 are read as U+FFFD, since normalizeUTF8NFC
     * refuses them and would fail the whole list.
     */
    test("an address that is not UTF-8 neither fails the list nor joins a page of words", async () => {
      expect(await listed("/x%E0%A4")).toEqual([PAGE_SESSIONS.notUtf8]);
      expect(await listed("/x%e0%a4")).toEqual([PAGE_SESSIONS.notUtf8]);
      expect(await listed("/caf%C3%A9")).not.toContain(PAGE_SESSIONS.notUtf8);
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
