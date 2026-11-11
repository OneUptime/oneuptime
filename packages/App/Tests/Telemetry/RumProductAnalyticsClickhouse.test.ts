import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsTableEngine from "Common/Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import RumProductAnalyticsSession from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import RumProductAnalyticsUser from "Common/Models/AnalyticsModels/RumProductAnalyticsUser";
import RumProductAnalyticsEvent from "Common/Models/AnalyticsModels/RumProductAnalyticsEvent";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import RumSessionService from "Common/Server/Services/RumSessionService";
import RumProductAnalyticsSessionService from "Common/Server/Services/RumProductAnalyticsSessionService";
import RumProductAnalyticsUserService from "Common/Server/Services/RumProductAnalyticsUserService";
import RumProductAnalyticsReadService from "Common/Server/Utils/RumProductAnalytics/RumProductAnalyticsReadService";
import {
  buildProductAnalyticsErasureFilters,
  buildProductAnalyticsUserSessionLookup,
  ProductAnalyticsErasureFilter,
} from "Common/Server/Utils/RumProductAnalytics/RumProductAnalyticsErasure";
import {
  ProductAnalyticsBreakdownDto,
  ProductAnalyticsDimension,
  ProductAnalyticsPeopleDto,
  ProductAnalyticsPeopleFilter,
  ProductAnalyticsPersonDetailDto,
  ProductAnalyticsPersonDto,
  ProductAnalyticsSummaryDto,
  ProductAnalyticsTrendDayDto,
  ProductAnalyticsTrendDto,
  toProductAnalyticsTimeZone,
} from "Common/Types/Rum/ProductAnalytics";
import { RumSessionErasureRequestType } from "Common/Models/DatabaseModels/RumSessionErasureRequest";
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
 * Product analytics (issue #6444) against a real ClickHouse server.
 *
 * RumProductAnalyticsReadService.test.ts pins the statements as strings;
 * it cannot tell whether ClickHouse accepts them, folds a session's
 * provisional, finished and pinned rows into one, counts a person who
 * signed in half-way through a session as that user and not also as an
 * anonymous visitor, fills the days nobody came, or counts weekly and
 * monthly users over days rather than rows. This suite builds
 * RumSessionV1 and both product analytics tables from the real models,
 * creates the two materialized views from the models' own statements,
 * writes session headers the way ingest, the finalizer and pinning write
 * them, and reads every answer the five routes give back through the
 * production executeQuery path.
 *
 * It also runs the erasure job's product analytics deletes (as plain
 * mutations: the job's ON CLUSTER form needs a Keeper a disposable server
 * does not have) and checks what each kind of request leaves.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server,
 * credentials in the URL:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/RumProductAnalyticsClickhouse.test.ts
 *
 * The suite creates and drops only its own uniquely named database. The
 * App Test workflow provides the server, and the guard at the bottom fails
 * the run there if it ever goes missing, so this cannot quietly skip in CI.
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

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `rum_product_analytics_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID("6600000000000000000000a1");
const otherProjectId: ObjectID = new ObjectID("6600000000000000000000a2");
const applicationId: ObjectID = new ObjectID("6600000000000000000000b1");
const otherApplicationId: ObjectID = new ObjectID("6600000000000000000000b2");

const DAY_MS: number = 24 * 60 * 60 * 1000;

const now: Date = new Date();

/*
 * Day 0 of the fixtures: midnight UTC twenty days ago. The range the
 * suite reads is days 0 to 6; the dormant windows count back from now.
 */
const dayZero: Date = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
    20 * DAY_MS,
);

function at(day: number, minuteOfDay: number = 600): Date {
  return new Date(dayZero.getTime() + day * DAY_MS + minuteOfDay * 60000);
}

const rangeStart: Date = at(0, 0);
const rangeEnd: Date = new Date(at(7, 0).getTime() - 1);

function dayText(day: number): string {
  return at(day, 0).toISOString().substring(0, 10);
}

function hex(seed: string, length: number): string {
  return seed.repeat(length).substring(0, length);
}

/* The people. Keys are the shapes the recorder and the digest write. */
const aliceKey: string = hex("a1", 64);
const aliceVisitor: string = hex("a2", 32);
const bobVisitor: string = hex("b1", 32);
const carolKey: string = hex("c1", 64);
const daveKey: string = hex("d1", 64);
const erinVisitor: string = hex("e1", 32);
const frankVisitor: string = hex("f1", 32);

interface SessionFixture {
  sessionId: string;
  start: Date;
  project?: ObjectID | undefined;
  application?: ObjectID | undefined;
  /* Who the finished header names; the provisional one names provisionalUserKey. */
  userKey?: string | undefined;
  provisionalUserKey?: string | undefined;
  visitorId?: string | undefined;
  label?: string | undefined;
  deviceType: string;
  viewport?: [number, number] | undefined;
  browserName: string;
  browserVersion?: string | undefined;
  osName: string;
  recorderKind?: string | undefined;
  countryCode: string;
  entryUrl: string;
  routes: Array<string>;
  durationMs: number;
  pageCount: number;
  errorCount: number;
  rageClickCount?: number | undefined;
  customSignalFrustrationCount?: number | undefined;
  finalized: boolean;
  pinned?: boolean | undefined;
  /* Days from now the recording is kept; negative for one already gone. */
  retentionDays?: number | undefined;
}

function sessionId(seed: string): string {
  return hex(seed, 32);
}

const fixtures: Array<SessionFixture> = [
  /* Alice: first came long before the range, signed in. */
  {
    sessionId: sessionId("01"),
    start: at(-40),
    userKey: aliceKey,
    provisionalUserKey: aliceKey,
    visitorId: aliceVisitor,
    label: "alice@example.com",
    deviceType: "desktop",
    browserName: "Chrome",
    osName: "Windows",
    countryCode: "US",
    entryUrl: "https://app.example.com/",
    routes: ["/"],
    durationMs: 120000,
    pageCount: 1,
    errorCount: 0,
    finalized: true,
    retentionDays: -10,
  },
  /*
   * Alice again, in the range: anonymous when the session started, signed
   * in by the time it finished. One session, one person - Alice - and no
   * anonymous visitor made up from its first write.
   */
  {
    sessionId: sessionId("02"),
    start: at(1),
    userKey: aliceKey,
    provisionalUserKey: "",
    visitorId: aliceVisitor,
    label: "alice@example.com",
    deviceType: "desktop",
    browserName: "Chrome",
    osName: "Windows",
    countryCode: "US",
    entryUrl: "https://app.example.com/?ref=mail",
    routes: ["/", "/checkout"],
    durationMs: 300000,
    pageCount: 2,
    errorCount: 1,
    finalized: true,
  },
  /* Alice a third time, pinned: its far-future copy is the same session. */
  {
    sessionId: sessionId("03"),
    start: at(3),
    userKey: aliceKey,
    provisionalUserKey: aliceKey,
    visitorId: aliceVisitor,
    label: "Alice A.",
    deviceType: "desktop",
    browserName: "Firefox",
    osName: "Windows",
    countryCode: "US",
    entryUrl: "https://app.example.com/",
    routes: ["/"],
    durationMs: 90000,
    pageCount: 1,
    errorCount: 0,
    finalized: true,
    pinned: true,
  },
  /* Bob: an anonymous visitor, new in the range, on a phone. */
  {
    sessionId: sessionId("04"),
    start: at(2),
    visitorId: bobVisitor,
    deviceType: "mobile",
    browserName: "Mobile Safari",
    osName: "iOS",
    countryCode: "DE",
    entryUrl: "https://app.example.com/pricing",
    routes: ["/", "/pricing", "/signup"],
    durationMs: 20000,
    pageCount: 3,
    errorCount: 0,
    rageClickCount: 2,
    finalized: true,
  },
  /* Bob again, still recording: no length yet, and not in the history yet. */
  {
    sessionId: sessionId("05"),
    start: at(5),
    visitorId: bobVisitor,
    deviceType: "mobile",
    browserName: "Mobile Safari",
    osName: "iOS",
    countryCode: "DE",
    entryUrl: "https://app.example.com/pricing",
    routes: ["/pricing"],
    durationMs: 0,
    pageCount: 1,
    errorCount: 1,
    finalized: false,
  },
  /*
   * Erin: the mobile app on an iPad, early in the morning UTC - the evening
   * before in New York.
   */
  {
    sessionId: sessionId("06"),
    start: at(4, 180),
    visitorId: erinVisitor,
    deviceType: "ios",
    viewport: [820, 1180],
    browserName: "Shop",
    browserVersion: "2.4.1",
    osName: "iOS 17.2",
    recorderKind: "rn-view-tree",
    countryCode: "GB",
    entryUrl: "app://shop/Home",
    routes: ["/Home", "/Cart"],
    durationMs: 45000,
    pageCount: 2,
    errorCount: 0,
    customSignalFrustrationCount: 1,
    finalized: true,
  },
  /* A session from a recorder too old to name anyone: a session, nobody. */
  {
    sessionId: sessionId("07"),
    start: at(2, 720),
    deviceType: "desktop",
    browserName: "Chrome",
    osName: "Linux",
    countryCode: "",
    entryUrl: "https://app.example.com/",
    routes: ["/"],
    durationMs: 5000,
    pageCount: 1,
    errorCount: 0,
    finalized: true,
  },
  /* Carol: came once, in the range before. */
  {
    sessionId: sessionId("08"),
    start: at(-3),
    userKey: carolKey,
    provisionalUserKey: carolKey,
    label: "carol@example.com",
    deviceType: "tablet",
    browserName: "Safari",
    osName: "iPadOS",
    countryCode: "FR",
    entryUrl: "https://app.example.com/docs",
    routes: ["/docs"],
    durationMs: 60000,
    pageCount: 1,
    errorCount: 0,
    finalized: true,
  },
  /* Dave: came once, a hundred days before the range. */
  {
    sessionId: sessionId("09"),
    start: at(-100),
    userKey: daveKey,
    provisionalUserKey: daveKey,
    label: "dave@example.com",
    deviceType: "desktop",
    browserName: "Edge",
    osName: "Windows",
    countryCode: "US",
    entryUrl: "https://app.example.com/",
    routes: ["/"],
    durationMs: 10000,
    pageCount: 1,
    errorCount: 0,
    finalized: true,
  },
  /* Frank: on the app right now, in his first session. */
  {
    sessionId: sessionId("0a"),
    start: new Date(now.getTime() - 60 * 60 * 1000),
    visitorId: frankVisitor,
    deviceType: "desktop",
    browserName: "Chrome",
    osName: "macOS",
    countryCode: "CA",
    entryUrl: "https://app.example.com/",
    routes: ["/"],
    durationMs: 0,
    pageCount: 1,
    errorCount: 0,
    finalized: false,
  },
  /* Another application of the project, in the range: not this one's. */
  {
    sessionId: sessionId("0b"),
    start: at(2),
    application: otherApplicationId,
    userKey: aliceKey,
    provisionalUserKey: aliceKey,
    visitorId: aliceVisitor,
    deviceType: "desktop",
    browserName: "Chrome",
    osName: "Windows",
    countryCode: "US",
    entryUrl: "https://admin.example.com/",
    routes: ["/admin"],
    durationMs: 30000,
    pageCount: 1,
    errorCount: 0,
    finalized: true,
  },
  /* Another project, same application id by accident: not this one's. */
  {
    sessionId: sessionId("0c"),
    start: at(2),
    project: otherProjectId,
    visitorId: bobVisitor,
    deviceType: "desktop",
    browserName: "Chrome",
    osName: "Windows",
    countryCode: "US",
    entryUrl: "https://elsewhere.example.com/",
    routes: ["/elsewhere"],
    durationMs: 30000,
    pageCount: 1,
    errorCount: 0,
    finalized: true,
  },
];

function retentionDateText(days: number): string {
  return OneUptimeDate.toClickhouseDateTime(
    OneUptimeDate.addRemoveDays(now, days),
  ).substring(0, 10);
}

/*
 * The header rows of one session, as they are written: the provisional
 * header of the first chunk, the finished header, and the pinned copy.
 */
function headerRows(fixture: SessionFixture): Array<JSONObject> {
  const base: JSONObject = {
    projectId: (fixture.project || projectId).toString(),
    rumApplicationId: (fixture.application || applicationId).toString(),
    primaryEntityId: (fixture.application || applicationId).toString(),
    primaryEntityType: "RealUserMonitor",
    startTime: OneUptimeDate.toClickhouseDateTime64(fixture.start),
    clientReportedStartTime: OneUptimeDate.toClickhouseDateTime64(
      fixture.start,
    ),
    sessionId: fixture.sessionId,
    visitorId: fixture.visitorId || "",
    deviceType: fixture.deviceType,
    viewportWidth: fixture.viewport?.[0] || 1440,
    viewportHeight: fixture.viewport?.[1] || 900,
    browserName: fixture.browserName,
    browserVersion: fixture.browserVersion || "unknown",
    osName: fixture.osName,
    recorderKind: fixture.recorderKind || "dom",
    countryCode: fixture.countryCode,
    entryUrl: fixture.entryUrl,
    triggerReason: "sampled",
    samplePercentageAtCapture: 100,
    retentionDate: retentionDateText(fixture.retentionDays ?? 30),
  };

  const provisional: JSONObject = {
    ...base,
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    version: String(fixture.start.getTime()),
    endTime: OneUptimeDate.toClickhouseDateTime64(
      new Date(fixture.start.getTime() + 15000),
    ),
    identifiedUserKey: fixture.provisionalUserKey || "",
    identifiedUserLabel:
      fixture.provisionalUserKey && fixture.label ? fixture.label : "",
    isFinalized: false,
    durationMs: "0",
    pageCount: 1,
    errorCount: fixture.finalized ? 0 : fixture.errorCount,
    routes: fixture.routes.slice(0, 1),
    isPinnedCopy: false,
  };

  if (!fixture.finalized) {
    return [provisional];
  }

  const finished: JSONObject = {
    ...base,
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    version: String(fixture.start.getTime() + 1000),
    endTime: OneUptimeDate.toClickhouseDateTime64(
      new Date(fixture.start.getTime() + fixture.durationMs),
    ),
    identifiedUserKey: fixture.userKey || "",
    identifiedUserLabel: fixture.userKey && fixture.label ? fixture.label : "",
    isFinalized: true,
    durationMs: String(fixture.durationMs),
    pageCount: fixture.pageCount,
    errorCount: fixture.errorCount,
    rageClickCount: fixture.rageClickCount || 0,
    customSignalFrustrationCount: fixture.customSignalFrustrationCount || 0,
    routes: fixture.routes,
    isPinnedCopy: false,
  };

  if (!fixture.pinned) {
    return [provisional, finished];
  }

  return [
    provisional,
    finished,
    {
      ...finished,
      _id: ObjectID.generateTimeOrdered().toString(),
      version: String(fixture.start.getTime() + 2000),
      isPinnedCopy: true,
      retentionDate: "2299-01-01",
    },
  ];
}

/*
 * The model's columns and the engine, ordering, partitioning, TTL and
 * settings it declares, under the plain (non-replicated) engine:
 * production's Replicated* tables need a Keeper and a cluster definition a
 * disposable server does not have, and neither changes how a view fills
 * the table or how a SELECT is analysed.
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
      : model.tableEngine === AnalyticsTableEngine.AggregatingMergeTree
        ? "AggregatingMergeTree"
        : "MergeTree";

  const ttl: string =
    model.tableEngine === AnalyticsTableEngine.AggregatingMergeTree &&
    model.ttlExpression
      ? ` TTL ${model.ttlExpression}`
      : "";

  const settings: string =
    model.tableEngine === AnalyticsTableEngine.AggregatingMergeTree &&
    model.tableSettings
      ? ` SETTINGS ${model.tableSettings}`
      : "";

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${engine} PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})${ttl}${settings}`,
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
  RumSessionService as unknown as AnyAnalyticsService,
  RumProductAnalyticsSessionService as unknown as AnyAnalyticsService,
  RumProductAnalyticsUserService as unknown as AnyAnalyticsService,
];

const scope: { projectId: ObjectID; rumApplicationId: ObjectID } = {
  projectId: projectId,
  rumApplicationId: applicationId,
};

const range: {
  projectId: ObjectID;
  rumApplicationId: ObjectID;
  startTime: Date;
  endTime: Date;
} = {
  ...scope,
  startTime: rangeStart,
  endTime: rangeEnd,
};

function keysOf(people: Array<ProductAnalyticsPersonDto>): Array<string> {
  return people.map((person: ProductAnalyticsPersonDto): string => {
    return person.personKey;
  });
}

function findDay(
  trend: ProductAnalyticsTrendDto,
  day: string,
): ProductAnalyticsTrendDayDto {
  const found: ProductAnalyticsTrendDayDto | undefined = trend.days.find(
    (entry: ProductAnalyticsTrendDayDto): boolean => {
      return entry.day === day;
    },
  );

  if (!found) {
    throw new Error(`No trend day ${day}`);
  }

  return found;
}

async function listPeople(
  filter: ProductAnalyticsPeopleFilter,
  extra?: {
    dormantAfterDays?: number;
    includeLabel?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
  },
): Promise<ProductAnalyticsPeopleDto> {
  return await RumProductAnalyticsReadService.listPeople({
    ...range,
    filter: filter,
    dormantAfterDays: extra?.dormantAfterDays ?? 7,
    now: now,
    limit: extra?.limit ?? 50,
    offset: extra?.offset ?? 0,
    includeLabel: extra?.includeLabel ?? false,
    search: extra?.search,
  });
}

integration("Product analytics against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  const originals: Array<ServiceConnection> = [];

  async function count(query: string): Promise<number> {
    const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
      (await client.query({
        query: query,
        format: "JSON",
      })) as unknown as { json: () => Promise<{ data: Array<JSONObject> }> };

    return Number((await result.json()).data[0]?.["rows"] || 0);
  }

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

    /*
     * The events table too: the erasure filters below name it, as the
     * erasure job deletes a session's events with its summary.
     */
    for (const modelType of [
      RumSession,
      RumProductAnalyticsSession,
      RumProductAnalyticsUser,
      RumProductAnalyticsEvent,
    ]) {
      await createTable(
        client,
        clickhouse,
        modelType as unknown as { new (): AnalyticsBaseModel },
      );
    }

    /*
     * The views exactly as the models declare them: unqualified names,
     * resolved in this suite's database (the connection's default).
     */
    for (const model of [
      new RumProductAnalyticsSession(),
      new RumProductAnalyticsUser(),
    ]) {
      for (const view of model.materializedViews) {
        await client.command({ query: view.query });
      }
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
     * Each write its own insert, in the order they happen: every
     * provisional header first, then the finished ones, then the pinned
     * copies - so the views see them as separate blocks, as they do live.
     */
    const rowsByWrite: Array<Array<JSONObject>> = [[], [], []];

    for (const fixture of fixtures) {
      headerRows(fixture).forEach((row: JSONObject, index: number): void => {
        rowsByWrite[index]!.push(row);
      });
    }

    for (const rows of rowsByWrite) {
      for (const row of rows) {
        await RumSessionService.insertJsonRows([row], {
          clickhouseSettings: { wait_for_async_insert: 1 },
        });
      }
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

  test("the session view files every write; the person view only the finished ones", async () => {
    /* One row per session once folded, every session there. */
    expect(
      await count(
        `SELECT count() AS rows FROM (SELECT sessionId FROM ${database}.RumProductAnalyticsSessionV1 GROUP BY sessionId, startTime)`,
      ),
    ).toBe(fixtures.length);

    /* Frank's session is still recording: in the session table alone. */
    expect(
      await count(
        `SELECT count() AS rows FROM ${database}.RumProductAnalyticsSessionV1 WHERE visitorId = '${frankVisitor}'`,
      ),
    ).toBeGreaterThan(0);

    /*
     * The person view: finished headers that name someone. Alice's
     * anonymous start wrote nothing here, nor did anything of Frank's, and
     * Bob's unfinished second session is not one of his yet.
     */
    for (const nobody of [aliceVisitor, frankVisitor]) {
      expect(
        await count(
          `SELECT count() AS rows FROM ${database}.RumProductAnalyticsUserV1 WHERE personKey = 'v:${nobody}'`,
        ),
      ).toBe(0);
    }

    expect(
      await count(
        `SELECT toUInt64(uniqMerge(sessions)) AS rows FROM ${database}.RumProductAnalyticsUserV1 WHERE personKey = 'v:${bobVisitor}' AND projectId = '${projectId.toString()}'`,
      ),
    ).toBe(1);

    /* A month per row: Alice came in two (or three) months. */
    expect(
      await count(
        `SELECT toUInt64(uniqExact(month)) AS rows FROM ${database}.RumProductAnalyticsUserV1 WHERE personKey = 'u:${aliceKey}' AND rumApplicationId = '${applicationId.toString()}'`,
      ),
    ).toBe(
      new Set<string>(
        [at(-40), at(1), at(3)].map((date: Date): string => {
          return date.toISOString().substring(0, 7);
        }),
      ).size,
    );
    expect(
      await count(
        `SELECT count() AS rows FROM (SELECT personKey FROM ${database}.RumProductAnalyticsUserV1 WHERE projectId = '${projectId.toString()}' AND rumApplicationId = '${applicationId.toString()}' GROUP BY personKey)`,
      ),
    ).toBe(5);
    expect(
      await count(
        `SELECT toUInt64(uniqMerge(sessions)) AS rows FROM ${database}.RumProductAnalyticsUserV1 WHERE projectId = '${projectId.toString()}' AND rumApplicationId = '${applicationId.toString()}' AND personKey = 'u:${aliceKey}'`,
      ),
    ).toBe(3);
  });

  test("the summary counts the range's users, sessions and lengths, and the range before", async () => {
    const summary: ProductAnalyticsSummaryDto =
      await RumProductAnalyticsReadService.getSummary({
        ...range,
        dormantAfterDays: 7,
        now: now,
      });

    expect(summary.current).toEqual({
      activeUsers: 3,
      signedInUsers: 1,
      anonymousUsers: 2,
      newUsers: 2,
      returningUsers: 1,
      sessions: 6,
      signedInSessions: 2,
      finishedSessions: 5,
      medianSessionMs: 45000,
      averagePagesPerSession: 1.8,
      errorSessions: 2,
      frustratedSessions: 2,
      sessionLengths: [1, 1, 1, 1, 1, 0, 0],
    });

    /* Carol's one session, three days before the range: a new user then. */
    expect(summary.previous.activeUsers).toBe(1);
    expect(summary.previous.newUsers).toBe(1);
    expect(summary.previous.signedInUsers).toBe(1);
    expect(summary.previous.sessions).toBe(1);
    expect(summary.previousEndTime).toBe(rangeStart.getTime() - 1);
    expect(summary.previousEndTime - summary.previousStartTime).toBe(
      rangeEnd.getTime() - rangeStart.getTime(),
    );

    /*
     * Everyone kept: Alice, Bob, Erin, Carol and Dave from the history and
     * Frank from the session he is in now. All but Frank are dormant after
     * a week.
     */
    expect(summary.totalUsers).toBe(6);
    expect(summary.dormantUsers).toBe(5);
    expect(summary.dormantAfterDays).toBe(7);
    expect(summary.dataStartedAt).toBe(at(-100).getTime());
  });

  test("dormant counts back from now, whatever the range", async () => {
    const summary: ProductAnalyticsSummaryDto =
      await RumProductAnalyticsReadService.getSummary({
        ...range,
        dormantAfterDays: 30,
        now: now,
      });

    /* Only Dave has stayed away for a month. */
    expect(summary.dormantUsers).toBe(1);
    expect(summary.totalUsers).toBe(6);
  });

  test("an empty application answers zeros and no start", async () => {
    const summary: ProductAnalyticsSummaryDto =
      await RumProductAnalyticsReadService.getSummary({
        projectId: projectId,
        rumApplicationId: new ObjectID("6600000000000000000000b9"),
        startTime: rangeStart,
        endTime: rangeEnd,
        dormantAfterDays: 7,
        now: now,
      });

    expect(summary.current.activeUsers).toBe(0);
    expect(summary.current.sessions).toBe(0);
    expect(summary.current.medianSessionMs).toBe(0);
    expect(summary.current.averagePagesPerSession).toBe(0);
    expect(summary.current.sessionLengths).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(summary.totalUsers).toBe(0);
    expect(summary.dataStartedAt).toBeNull();
  });

  test("the trend has every day, with daily, weekly and monthly users over days", async () => {
    const trend: ProductAnalyticsTrendDto =
      await RumProductAnalyticsReadService.getTrend({
        ...range,
        timeZone: "UTC",
      });

    expect(trend.timeZone).toBe("UTC");
    expect(
      trend.days.map((day: ProductAnalyticsTrendDayDto): string => {
        return day.day;
      }),
    ).toEqual([0, 1, 2, 3, 4, 5, 6].map(dayText));

    expect(findDay(trend, dayText(0))).toEqual({
      day: dayText(0),
      activeUsers: 0,
      /* Carol, three days before. */
      weeklyActiveUsers: 1,
      monthlyActiveUsers: 1,
      newUsers: 0,
      returningUsers: 0,
      sessions: 0,
      desktopSessions: 0,
      mobileSessions: 0,
      tabletSessions: 0,
      otherSessions: 0,
    });

    expect(findDay(trend, dayText(1))).toMatchObject({
      activeUsers: 1,
      newUsers: 0,
      returningUsers: 1,
      sessions: 1,
      desktopSessions: 1,
    });

    /* Bob and a session that names nobody: one user, two sessions. */
    expect(findDay(trend, dayText(2))).toMatchObject({
      activeUsers: 1,
      newUsers: 1,
      returningUsers: 0,
      sessions: 2,
      desktopSessions: 1,
      mobileSessions: 1,
    });

    /* The pinned copy is the same session. */
    expect(findDay(trend, dayText(3))).toMatchObject({
      activeUsers: 1,
      returningUsers: 1,
      sessions: 1,
      desktopSessions: 1,
    });

    /* Erin's iPad is a tablet. */
    expect(findDay(trend, dayText(4))).toMatchObject({
      activeUsers: 1,
      newUsers: 1,
      sessions: 1,
      tabletSessions: 1,
    });

    /* Bob came back: returning on the day, though new in the range. */
    expect(findDay(trend, dayText(5))).toMatchObject({
      activeUsers: 1,
      newUsers: 0,
      returningUsers: 1,
      sessions: 1,
      mobileSessions: 1,
      /* Alice, Bob and Erin over the week ending on it. */
      weeklyActiveUsers: 3,
    });

    /* Carol, Alice, Bob and Erin over the 30 days ending on day 6. */
    expect(findDay(trend, dayText(6))).toMatchObject({
      activeUsers: 0,
      weeklyActiveUsers: 3,
      monthlyActiveUsers: 4,
    });
  });

  test("the trend counts days in the reader's time zone", async () => {
    const trend: ProductAnalyticsTrendDto =
      await RumProductAnalyticsReadService.getTrend({
        ...range,
        timeZone: "America/New_York",
      });

    /* The range starts at midnight UTC, the evening before in New York. */
    expect(trend.days[0]?.day).toBe(dayText(-1));

    /* Erin's 03:00 UTC session is the evening of day 3 in New York. */
    expect(findDay(trend, dayText(3))).toMatchObject({
      activeUsers: 2,
      tabletSessions: 1,
      desktopSessions: 1,
    });
    expect(findDay(trend, dayText(4))).toMatchObject({
      activeUsers: 0,
      sessions: 0,
    });
  });

  /*
   * The trend route hands on a zone as the runtime names it, which is
   * often an old name (Asia/Calcutta for Asia/Kolkata). A name ClickHouse
   * did not know would fail the read, so every one the runtime can give is
   * checked against this server's own list.
   */
  test("ClickHouse knows every time zone the trend route can hand it", async () => {
    /*
     * ES2022's Intl.supportedValuesOf: every Node the tests run on has it,
     * but the lib the tests compile against does not name it.
     */
    const intl: { supportedValuesOf: (key: "timeZone") => Array<string> } =
      Intl as unknown as {
        supportedValuesOf: (key: "timeZone") => Array<string>;
      };
    const names: Array<string> = Array.from(
      new Set<string>(
        [...intl.supportedValuesOf("timeZone"), "UTC", "Etc/GMT+5"].map(
          (timeZone: string): string => {
            return (
              toProductAnalyticsTimeZone(timeZone) || `refused ${timeZone}`
            );
          },
        ),
      ),
    );

    expect(names.length).toBeGreaterThan(300);

    const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
      (await client.query({
        query:
          "SELECT time_zone AS paZone FROM system.time_zones WHERE has({names:Array(String)}, time_zone)",
        query_params: { names: names },
        format: "JSON",
      })) as unknown as { json: () => Promise<{ data: Array<JSONObject> }> };

    const known: Set<string> = new Set<string>(
      (await result.json()).data.map((row: JSONObject): string => {
        return String(row["paZone"]);
      }),
    );

    expect(
      names.filter((name: string): boolean => {
        return !known.has(name);
      }),
    ).toEqual([]);

    /* And one of those old names reads like its new one. */
    const calcutta: ProductAnalyticsTrendDto =
      await RumProductAnalyticsReadService.getTrend({
        ...range,
        timeZone: toProductAnalyticsTimeZone("Asia/Kolkata")!,
      });

    expect(calcutta.days.length).toBe(8);
  });

  test("breakdowns count users and sessions per value, most users first", async () => {
    const devices: ProductAnalyticsBreakdownDto =
      await RumProductAnalyticsReadService.getBreakdown({
        ...range,
        dimension: ProductAnalyticsDimension.DeviceType,
      });

    expect(devices).toEqual({
      dimension: ProductAnalyticsDimension.DeviceType,
      rows: [
        { value: "desktop", users: 1, sessions: 3 },
        { value: "mobile", users: 1, sessions: 2 },
        { value: "tablet", users: 1, sessions: 1 },
      ],
      hasMore: false,
      totalUsers: 3,
      totalSessions: 6,
    });

    const pages: ProductAnalyticsBreakdownDto =
      await RumProductAnalyticsReadService.getBreakdown({
        ...range,
        dimension: ProductAnalyticsDimension.Page,
      });

    /* A session counts once on each page it visited. */
    expect(pages.rows).toEqual([
      { value: "/", users: 2, sessions: 4 },
      { value: "/pricing", users: 1, sessions: 2 },
      { value: "/Cart", users: 1, sessions: 1 },
      { value: "/Home", users: 1, sessions: 1 },
      { value: "/checkout", users: 1, sessions: 1 },
      { value: "/signup", users: 1, sessions: 1 },
    ]);
    expect(pages.totalSessions).toBe(6);

    const systems: ProductAnalyticsBreakdownDto =
      await RumProductAnalyticsReadService.getBreakdown({
        ...range,
        dimension: ProductAnalyticsDimension.OperatingSystem,
      });

    /* The mobile app's "iOS 17.2" is the iOS family. */
    expect(systems.rows).toEqual([
      { value: "iOS", users: 2, sessions: 3 },
      { value: "Windows", users: 1, sessions: 2 },
      { value: "Linux", users: 0, sessions: 1 },
    ]);

    const browsers: ProductAnalyticsBreakdownDto =
      await RumProductAnalyticsReadService.getBreakdown({
        ...range,
        dimension: ProductAnalyticsDimension.Browser,
      });

    /* A mobile app has no browser: "" (not reported), not its own name. */
    expect(browsers.rows).toEqual(
      [
        { value: "Chrome", users: 1, sessions: 2 },
        { value: "", users: 1, sessions: 1 },
        { value: "Firefox", users: 1, sessions: 1 },
        { value: "Mobile Safari", users: 1, sessions: 2 },
      ].sort(
        (
          left: { users: number; sessions: number; value: string },
          right: { users: number; sessions: number; value: string },
        ): number => {
          return (
            right.users - left.users ||
            right.sessions - left.sessions ||
            (left.value < right.value ? -1 : left.value > right.value ? 1 : 0)
          );
        },
      ),
    );

    const versions: ProductAnalyticsBreakdownDto =
      await RumProductAnalyticsReadService.getBreakdown({
        ...range,
        dimension: ProductAnalyticsDimension.AppVersion,
      });

    expect(versions.rows).toEqual([
      { value: "", users: 2, sessions: 5 },
      { value: "2.4.1", users: 1, sessions: 1 },
    ]);

    const entries: ProductAnalyticsBreakdownDto =
      await RumProductAnalyticsReadService.getBreakdown({
        ...range,
        dimension: ProductAnalyticsDimension.EntryPage,
      });

    /* The path alone: no query string, no origin. */
    expect(entries.rows).toEqual([
      { value: "/", users: 1, sessions: 3 },
      { value: "/pricing", users: 1, sessions: 2 },
      { value: "/Home", users: 1, sessions: 1 },
    ]);

    const countries: ProductAnalyticsBreakdownDto =
      await RumProductAnalyticsReadService.getBreakdown({
        ...range,
        dimension: ProductAnalyticsDimension.Country,
      });

    expect(countries.rows).toEqual([
      { value: "DE", users: 1, sessions: 2 },
      { value: "US", users: 1, sessions: 2 },
      { value: "GB", users: 1, sessions: 1 },
      { value: "", users: 0, sessions: 1 },
    ]);
  });

  test("the people list holds who came, with their history", async () => {
    const active: ProductAnalyticsPeopleDto = await listPeople(
      ProductAnalyticsPeopleFilter.Active,
    );

    expect(keysOf(active.people)).toEqual([
      `v:${bobVisitor}`,
      `v:${erinVisitor}`,
      `u:${aliceKey}`,
    ]);
    expect(active.hasMore).toBe(false);
    expect(active.includesLabels).toBe(false);

    const alice: ProductAnalyticsPersonDto = active.people[2]!;

    expect(alice).toEqual({
      personKey: `u:${aliceKey}`,
      kind: "identified",
      identifiedUserKey: aliceKey,
      visitorId: "",
      firstSeenAt: at(-40).getTime(),
      lastSeenAt: at(3).getTime(),
      sessionsInRange: 2,
      totalSessions: 3,
      deviceType: "desktop",
      countryCode: "US",
      isNew: false,
    });

    /* Bob's unfinished second session counts, in the range and in total. */
    expect(active.people[0]).toMatchObject({
      kind: "visitor",
      visitorId: bobVisitor,
      identifiedUserKey: "",
      firstSeenAt: at(2).getTime(),
      lastSeenAt: at(5).getTime(),
      sessionsInRange: 2,
      totalSessions: 2,
      deviceType: "mobile",
      countryCode: "DE",
      isNew: true,
    });
    expect(active.people[1]).toMatchObject({
      deviceType: "tablet",
      countryCode: "GB",
      isNew: true,
    });
  });

  test("each people filter holds the people it names", async () => {
    expect(
      keysOf((await listPeople(ProductAnalyticsPeopleFilter.New)).people),
    ).toEqual([`v:${bobVisitor}`, `v:${erinVisitor}`]);
    expect(
      keysOf((await listPeople(ProductAnalyticsPeopleFilter.Returning)).people),
    ).toEqual([`u:${aliceKey}`]);
    expect(
      keysOf((await listPeople(ProductAnalyticsPeopleFilter.SignedIn)).people),
    ).toEqual([`u:${aliceKey}`]);
    expect(
      keysOf((await listPeople(ProductAnalyticsPeopleFilter.Anonymous)).people),
    ).toEqual([`v:${bobVisitor}`, `v:${erinVisitor}`]);

    /*
     * Away a week: everyone but Frank, latest visit first - Bob's being the
     * unfinished session of day 5, which the range's own sessions hold.
     */
    const dormant: ProductAnalyticsPeopleDto = await listPeople(
      ProductAnalyticsPeopleFilter.Dormant,
    );

    expect(keysOf(dormant.people)).toEqual([
      `v:${bobVisitor}`,
      `v:${erinVisitor}`,
      `u:${aliceKey}`,
      `u:${carolKey}`,
      `u:${daveKey}`,
    ]);

    /* Range sessions are still range sessions on the dormant list. */
    expect(dormant.people[0]?.sessionsInRange).toBe(2);
    expect(dormant.people[0]?.lastSeenAt).toBe(at(5).getTime());
    expect(dormant.people[3]?.sessionsInRange).toBe(0);

    expect(
      keysOf(
        (
          await listPeople(ProductAnalyticsPeopleFilter.Dormant, {
            dormantAfterDays: 30,
          })
        ).people,
      ),
    ).toEqual([`u:${daveKey}`]);

    /* Everyone, Frank included though his only session is not finished. */
    const everyone: ProductAnalyticsPeopleDto = await listPeople(
      ProductAnalyticsPeopleFilter.All,
    );

    expect(keysOf(everyone.people)).toEqual([
      `v:${frankVisitor}`,
      `v:${bobVisitor}`,
      `v:${erinVisitor}`,
      `u:${aliceKey}`,
      `u:${carolKey}`,
      `u:${daveKey}`,
    ]);

    /* First seen after the range is not new in it. */
    expect(everyone.people[0]).toMatchObject({
      sessionsInRange: 0,
      totalSessions: 0,
      isNew: false,
    });
  });

  test("pages through the list and says when there is more", async () => {
    const first: ProductAnalyticsPeopleDto = await listPeople(
      ProductAnalyticsPeopleFilter.All,
      { limit: 4 },
    );
    const second: ProductAnalyticsPeopleDto = await listPeople(
      ProductAnalyticsPeopleFilter.All,
      { limit: 4, offset: 4 },
    );

    expect(first.people).toHaveLength(4);
    expect(first.hasMore).toBe(true);
    expect(keysOf(second.people)).toEqual([`u:${carolKey}`, `u:${daveKey}`]);
    expect(second.hasMore).toBe(false);
  });

  test("names signed-in users only when asked to, and searches their names", async () => {
    const withLabels: ProductAnalyticsPeopleDto = await listPeople(
      ProductAnalyticsPeopleFilter.All,
      { includeLabel: true },
    );

    expect(withLabels.includesLabels).toBe(true);

    const labels: Record<string, string | undefined> = {};

    for (const person of withLabels.people) {
      labels[person.personKey] = person.identifiedUserLabel;
    }

    /* The latest label Alice carried; visitors carry none at all. */
    expect(labels).toEqual({
      [`u:${aliceKey}`]: "Alice A.",
      [`u:${carolKey}`]: "carol@example.com",
      [`u:${daveKey}`]: "dave@example.com",
      [`v:${bobVisitor}`]: undefined,
      [`v:${erinVisitor}`]: undefined,
      [`v:${frankVisitor}`]: undefined,
    });

    const searched: ProductAnalyticsPeopleDto = await listPeople(
      ProductAnalyticsPeopleFilter.All,
      { includeLabel: true, search: "EXAMPLE.com" },
    );

    expect(keysOf(searched.people)).toEqual([`u:${carolKey}`, `u:${daveKey}`]);

    const withoutLabels: ProductAnalyticsPeopleDto = await listPeople(
      ProductAnalyticsPeopleFilter.All,
    );

    for (const person of withoutLabels.people) {
      expect(person.identifiedUserLabel).toBeUndefined();
    }
  });

  test("one person's history and sessions, newest first", async () => {
    const alice: ProductAnalyticsPersonDetailDto =
      await RumProductAnalyticsReadService.getPerson({
        ...scope,
        personKey: `u:${aliceKey}`,
        now: now,
        limit: 50,
        offset: 0,
        includeLabel: true,
      });

    expect(alice.person).toMatchObject({
      personKey: `u:${aliceKey}`,
      kind: "identified",
      firstSeenAt: at(-40).getTime(),
      lastSeenAt: at(3).getTime(),
      totalSessions: 3,
      identifiedUserLabel: "Alice A.",
      deviceType: "desktop",
    });

    expect(
      alice.sessions.map((session: { sessionId: string }): string => {
        return session.sessionId;
      }),
    ).toEqual([sessionId("03"), sessionId("02"), sessionId("01")]);

    expect(alice.sessions[1]).toEqual({
      sessionId: sessionId("02"),
      startedAt: at(1).getTime(),
      durationMs: 300000,
      pageCount: 2,
      entryPage: "/",
      pages: ["/", "/checkout"],
      deviceType: "desktop",
      browserName: "Chrome",
      osName: "Windows",
      countryCode: "US",
      appVersion: "",
      errorCount: 1,
      frustrationCount: 0,
      isFinished: true,
      isReplayKept: true,
    });

    /* The pinned copy keeps the recording; the oldest one's is gone. */
    expect(alice.sessions[0]?.isReplayKept).toBe(true);
    expect(alice.sessions[2]?.isReplayKept).toBe(false);
    expect(alice.hasMore).toBe(false);

    /* A visitor's sessions are the ones in which nobody signed in. */
    const bob: ProductAnalyticsPersonDetailDto =
      await RumProductAnalyticsReadService.getPerson({
        ...scope,
        personKey: `v:${bobVisitor}`,
        now: now,
        limit: 1,
        offset: 0,
        includeLabel: true,
      });

    expect(bob.person).toMatchObject({
      kind: "visitor",
      firstSeenAt: at(2).getTime(),
      lastSeenAt: at(5).getTime(),
      totalSessions: 2,
    });
    expect(bob.person?.identifiedUserLabel).toBeUndefined();
    expect(bob.sessions).toHaveLength(1);
    expect(bob.sessions[0]).toMatchObject({
      sessionId: sessionId("05"),
      isFinished: false,
      durationMs: 0,
    });
    expect(bob.hasMore).toBe(true);

    /* Alice's browser before she signed in is nobody of its own. */
    const aliceBrowser: ProductAnalyticsPersonDetailDto =
      await RumProductAnalyticsReadService.getPerson({
        ...scope,
        personKey: `v:${aliceVisitor}`,
        now: now,
        limit: 50,
        offset: 0,
        includeLabel: false,
      });

    expect(aliceBrowser.person).toBeNull();
    expect(aliceBrowser.sessions).toEqual([]);

    /* Frank is known from his unfinished session alone. */
    const frank: ProductAnalyticsPersonDetailDto =
      await RumProductAnalyticsReadService.getPerson({
        ...scope,
        personKey: `v:${frankVisitor}`,
        now: now,
        limit: 50,
        offset: 0,
        includeLabel: false,
      });

    expect(frank.person).toMatchObject({ totalSessions: 1 });
    expect(frank.sessions).toHaveLength(1);

    /* The label only for a reader who may read it. */
    const hidden: ProductAnalyticsPersonDetailDto =
      await RumProductAnalyticsReadService.getPerson({
        ...scope,
        personKey: `u:${aliceKey}`,
        now: now,
        limit: 50,
        offset: 0,
        includeLabel: false,
      });

    expect(hidden.person?.identifiedUserLabel).toBeUndefined();
    expect(hidden.includesLabels).toBe(false);
  });

  describe("erasure", () => {
    async function erase(
      filters: Array<ProductAnalyticsErasureFilter>,
    ): Promise<void> {
      for (const filter of filters) {
        await client.command({
          query: `ALTER TABLE ${database}.${filter.tableName} DELETE WHERE ${filter.where.query}`,
          query_params: filter.where.query_params,
          clickhouse_settings: { mutations_sync: "2" },
        });
      }
    }

    /*
     * Sessions, or person-months, left: distinct keys rather than rows, as
     * a merge may already have folded a session's writes into one row.
     */
    async function rowsOf(table: string, where: string): Promise<number> {
      const key: string =
        table === "RumProductAnalyticsUserV1"
          ? "personKey, month"
          : "sessionId";

      return await count(
        `SELECT toUInt64(uniqExact(${key})) AS rows FROM ${database}.${table} WHERE ${where}`,
      );
    }

    test("by user removes the user's sessions and months, older than the recordings too", async () => {
      const lookup: { json: () => Promise<{ data: Array<JSONObject> }> } =
        (await RumProductAnalyticsSessionService.executeQuery(
          buildProductAnalyticsUserSessionLookup({
            databaseName: database,
            projectId: projectId,
            identifiedUserKey: aliceKey,
            limit: 10000,
          }),
        )) as unknown as { json: () => Promise<{ data: Array<JSONObject> }> };

      const aliceSessions: Array<string> = (await lookup.json()).data
        .map((row: JSONObject): string => {
          return String(row["paSessionId"]);
        })
        .sort();

      /* Both applications': the request names none. */
      expect(aliceSessions).toEqual(
        [
          sessionId("01"),
          sessionId("02"),
          sessionId("03"),
          sessionId("0b"),
        ].sort(),
      );

      await erase(
        buildProductAnalyticsErasureFilters({
          projectId: projectId,
          requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
          targetValue: aliceKey,
          sessionIds: aliceSessions,
        }),
      );

      /* Alice's sessions in both applications, A1 though its recording is gone. */
      expect(
        await rowsOf(
          "RumProductAnalyticsSessionV1",
          `identifiedUserKey = '${aliceKey}'`,
        ),
      ).toBe(0);
      expect(
        await rowsOf(
          "RumProductAnalyticsUserV1",
          `personKey = 'u:${aliceKey}'`,
        ),
      ).toBe(0);

      /*
       * Her browser's provisional row of the session she signed in during
       * named no user; it is that session's, and goes with it.
       */
      expect(
        await rowsOf(
          "RumProductAnalyticsSessionV1",
          `sessionId = '${sessionId("02")}'`,
        ),
      ).toBe(0);

      /* Everyone else stays. */
      expect(
        await rowsOf(
          "RumProductAnalyticsUserV1",
          `personKey = 'u:${carolKey}'`,
        ),
      ).toBe(1);
      expect(
        await rowsOf(
          "RumProductAnalyticsSessionV1",
          `sessionId = '${sessionId("04")}'`,
        ),
      ).toBe(1);
    });

    test("by date range removes the sessions that started in it", async () => {
      await erase(
        buildProductAnalyticsErasureFilters({
          projectId: projectId,
          requestType: RumSessionErasureRequestType.ByDateRange,
          rumApplicationId: applicationId,
          startDate: at(-100, 0),
          endDate: at(-100, 1439),
        }),
      );

      expect(
        await rowsOf(
          "RumProductAnalyticsSessionV1",
          `sessionId = '${sessionId("09")}'`,
        ),
      ).toBe(0);

      /* Who came that month stays: it says nothing of what a session did. */
      expect(
        await rowsOf("RumProductAnalyticsUserV1", `personKey = 'u:${daveKey}'`),
      ).toBe(1);

      /* The sessions of the days around it stay. */
      expect(
        await rowsOf(
          "RumProductAnalyticsSessionV1",
          `sessionId = '${sessionId("08")}'`,
        ),
      ).toBe(1);
    });

    test("by session removes the sessions named", async () => {
      await erase(
        buildProductAnalyticsErasureFilters({
          projectId: projectId,
          requestType: RumSessionErasureRequestType.BySessionId,
          sessionIds: [sessionId("07")],
        }),
      );

      expect(
        await rowsOf(
          "RumProductAnalyticsSessionV1",
          `sessionId = '${sessionId("07")}'`,
        ),
      ).toBe(0);
      expect(
        await rowsOf(
          "RumProductAnalyticsSessionV1",
          `sessionId = '${sessionId("06")}'`,
        ),
      ).toBe(1);
    });

    test("by application removes the application's rows and no other's", async () => {
      await erase(
        buildProductAnalyticsErasureFilters({
          projectId: projectId,
          requestType: RumSessionErasureRequestType.ByRumApplication,
          targetValue: applicationId.toString(),
        }),
      );

      expect(
        await rowsOf(
          "RumProductAnalyticsSessionV1",
          `rumApplicationId = '${applicationId.toString()}' AND projectId = '${projectId.toString()}'`,
        ),
      ).toBe(0);
      expect(
        await rowsOf(
          "RumProductAnalyticsUserV1",
          `rumApplicationId = '${applicationId.toString()}' AND projectId = '${projectId.toString()}'`,
        ),
      ).toBe(0);

      /* The other project's rows are its own. */
      expect(
        await rowsOf(
          "RumProductAnalyticsSessionV1",
          `projectId = '${otherProjectId.toString()}'`,
        ),
      ).toBe(1);
    });
  });
});

/*
 * The suite above is opt-in, and an opt-in regression guard that silently
 * stops opting in guards nothing. The App Test workflow starts a ClickHouse
 * service for it, so a missing URL there is a broken pipeline, not a skip.
 */
describe("Product analytics ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
