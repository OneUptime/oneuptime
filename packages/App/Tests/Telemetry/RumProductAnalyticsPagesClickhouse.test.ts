import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsTableEngine from "Common/Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import RumProductAnalyticsSession from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import RumProductAnalyticsUser from "Common/Models/AnalyticsModels/RumProductAnalyticsUser";
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
  ProductAnalyticsBreakdownDto,
  ProductAnalyticsBreakdownRowDto,
  ProductAnalyticsDimension,
  ProductAnalyticsPersonDetailDto,
} from "Common/Types/Rum/ProductAnalytics";
import { toProductAnalyticsPage } from "Common/Types/Rum/ProductAnalyticsEvents";
import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import {
  CAFE_PAGE,
  PAGE_SPELLINGS,
  PageSpellingCase,
  addressOf,
} from "Common/Tests/Helpers/PageSpellings";
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
 * The Product Analytics overview's pages against a real ClickHouse (#8194).
 *
 * RumProductAnalyticsSessionV1_mv filed a session's entry page as
 * path(entryUrl), and path() stops at the fragment, so every session of a
 * hash-routed app was filed under "/". The Entry page and Page breakdowns
 * grouped the stored values as written, so a page stored in two spellings
 * ("/caf%c3%a9" by a session recorded before the scrubber wrote one, and
 * "/caf%C3%A9") was two rows, its people split between them. This suite
 * builds the tables and the views from the models, writes session headers
 * as the ingest and the finalizer write them - their addresses scrubbed as
 * the ingest scrubs them, or as an older recorder stored them - and reads
 * the breakdowns through the production read path, under both query
 * analyzers (a customer's own ClickHouse may run either).
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/RumProductAnalyticsPagesClickhouse.test.ts
 *
 * The App Test workflow provides the server, and the guard at the bottom
 * fails the run there if it ever goes missing.
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

const projectId: ObjectID = new ObjectID("6600000000000000000000c1");
const applicationId: ObjectID = new ObjectID("6600000000000000000000c2");
const mobileApplicationId: ObjectID = new ObjectID("6600000000000000000000c3");

const DAY_MS: number = 24 * 60 * 60 * 1000;
const now: Date = new Date();
const dayZero: Date = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
    10 * DAY_MS,
);

function at(day: number, minute: number): Date {
  return new Date(dayZero.getTime() + day * DAY_MS + minute * 60000);
}

const ORIGIN: string = "https://shop.example.com";

interface SessionFixture {
  sessionId: string;
  start: Date;
  application?: ObjectID | undefined;
  visitorId: string;
  recorderKind?: string | undefined;
  entryUrl: string;
  routes: Array<string>;
}

let sequence: number = 0;

function session(
  visitor: string,
  entryUrl: string,
  routes: Array<string>,
  extra?: Partial<SessionFixture>,
): SessionFixture {
  sequence++;

  return {
    sessionId: sequence.toString(16).padStart(32, "0"),
    start: at(1 + (sequence % 5), sequence),
    visitorId: visitor.repeat(32).substring(0, 32),
    entryUrl: entryUrl,
    routes: routes,
    ...extra,
  };
}

// What the ingest stores of an address now.
function stored(address: string): string {
  return UrlScrubber.scrub(address, []);
}

/*
 * A page in three spellings, by one person and another: "/caf%c3%a9" and
 * "/cafe%CC%81" as an older recorder stored them, "/caf%C3%A9" as the
 * scrubber stores it now (PageSpellings' CAFE_SPELLINGS, whole addresses).
 */
const CAFE_ADDRESSES: Array<string> = PAGE_SPELLINGS.filter(
  (row: PageSpellingCase): boolean => {
    return row.page === CAFE_PAGE && row.location.hash === "";
  },
).map((row: PageSpellingCase): string => {
  return addressOf(row);
});

const fixtures: Array<SessionFixture> = [
  // A hash-routed app: its entry page is its route, its pages each route.
  session("a1", stored(`${ORIGIN}/#/orders/42?tab=open`), [
    stored(`${ORIGIN}/#/orders/42`),
    stored(`${ORIGIN}/#/cart`),
  ]),
  session("a2", stored(`${ORIGIN}/app/#!/cart`), [
    stored(`${ORIGIN}/app/#!/cart`),
    stored(`${ORIGIN}/app/#!/checkout`),
  ]),
  // A hash-routed session's route, as the home page's "/" is no route.
  session("a3", stored(`${ORIGIN}/#/`), [stored(`${ORIGIN}/#/`)]),
  // The café, by one visitor in every spelling and by another once.
  ...CAFE_ADDRESSES.map((address: string): SessionFixture => {
    return session("b1", address, [address]);
  }),
  session("b2", stored(`${ORIGIN}/caf%C3%A9`), [stored(`${ORIGIN}/caf%C3%A9`)]),
  // One session that saw the café twice, in two spellings: one visit.
  session("b3", `${ORIGIN}/caf%c3%a9`, [
    `${ORIGIN}/caf%c3%a9`,
    stored(`${ORIGIN}/caf%C3%A9`),
    stored(`${ORIGIN}/pricing`),
  ]),
  // Pages that stay apart: an escaped slash, and case outside an escape.
  session("c1", stored(`${ORIGIN}/a%2Fb`), [stored(`${ORIGIN}/a%2Fb`)]),
  session("c2", stored(`${ORIGIN}/a/b`), [stored(`${ORIGIN}/a/b`)]),
  session("c3", stored(`${ORIGIN}/Cart`), [stored(`${ORIGIN}/Cart`)]),
  // A mobile app's screen, stored as "null/..." before #8384 and since.
  session("d1", "null/Checkout", ["null/Home", "null/Checkout"], {
    application: mobileApplicationId,
    recorderKind: "rn-view-tree",
  }),
  session(
    "d2",
    stored("app://com.example.shop/Checkout"),
    [
      stored("app://com.example.shop/Home"),
      stored("app://com.example.shop/Checkout"),
    ],
    { application: mobileApplicationId, recorderKind: "rn-view-tree" },
  ),
];

function headerRows(fixture: SessionFixture): Array<JSONObject> {
  const application: ObjectID = fixture.application || applicationId;
  const base: JSONObject = {
    projectId: projectId.toString(),
    rumApplicationId: application.toString(),
    primaryEntityId: application.toString(),
    primaryEntityType: "RealUserMonitor",
    startTime: OneUptimeDate.toClickhouseDateTime64(fixture.start),
    clientReportedStartTime: OneUptimeDate.toClickhouseDateTime64(
      fixture.start,
    ),
    sessionId: fixture.sessionId,
    visitorId: fixture.visitorId,
    deviceType: fixture.recorderKind === "rn-view-tree" ? "ios" : "desktop",
    viewportWidth: 1440,
    viewportHeight: 900,
    browserName: "Chrome",
    browserVersion: "unknown",
    osName: "macOS",
    recorderKind: fixture.recorderKind || "dom",
    countryCode: "DE",
    entryUrl: fixture.entryUrl,
    triggerReason: "sampled",
    samplePercentageAtCapture: 100,
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(now, 30),
    ).substring(0, 10),
    identifiedUserKey: "",
    identifiedUserLabel: "",
    isPinnedCopy: false,
  };

  // The provisional header the first chunk writes, then the finished one.
  return [
    {
      ...base,
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
      version: String(fixture.start.getTime()),
      endTime: OneUptimeDate.toClickhouseDateTime64(
        new Date(fixture.start.getTime() + 15000),
      ),
      isFinalized: false,
      durationMs: "0",
      pageCount: 1,
      routes: fixture.routes.slice(0, 1),
    },
    {
      ...base,
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
      version: String(fixture.start.getTime() + 1000),
      endTime: OneUptimeDate.toClickhouseDateTime64(
        new Date(fixture.start.getTime() + 60000),
      ),
      isFinalized: true,
      durationMs: "60000",
      pageCount: fixture.routes.length,
      routes: fixture.routes,
    },
  ];
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  database: string,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
    modelType: modelType,
    database: clickhouse,
  }).toColumnsCreateStatement(model.tableColumns);

  const engine: string =
    model.tableEngine === AnalyticsTableEngine.ReplacingMergeTree
      ? "ReplacingMergeTree(version)"
      : model.tableEngine === AnalyticsTableEngine.AggregatingMergeTree
        ? "AggregatingMergeTree"
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
  RumSessionService as unknown as AnyAnalyticsService,
  RumProductAnalyticsSessionService as unknown as AnyAnalyticsService,
  RumProductAnalyticsUserService as unknown as AnyAnalyticsService,
];

function rowsOf(
  breakdown: ProductAnalyticsBreakdownDto,
): Array<[string, number, number]> {
  return breakdown.rows.map(
    (row: ProductAnalyticsBreakdownRowDto): [string, number, number] => {
      return [row.value, row.users, row.sessions];
    },
  );
}

/* Both query analyzers: 1 is the new one (the default), 0 the old one. */
for (const analyzer of [1, 0]) {
  integration(
    `Product analytics overview pages against ClickHouse (analyzer ${analyzer})`,
    () => {
      const database: string = `rum_pa_pages_test_${analyzer}_${process.pid}_${Date.now()}`;
      let clickhouse: ClickhouseDatabase;
      let client: ClickhouseClient;
      const originals: Array<ServiceConnection> = [];

      async function breakdown(
        dimension: ProductAnalyticsDimension,
        application: ObjectID = applicationId,
      ): Promise<ProductAnalyticsBreakdownDto> {
        return await RumProductAnalyticsReadService.getBreakdown({
          projectId: projectId,
          rumApplicationId: application,
          startTime: at(0, 0),
          endTime: at(9, 0),
          dimension: dimension,
        });
      }

      async function entryPageOf(sessionId: string): Promise<string> {
        const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
          (await client.query({
            query: `SELECT max(entryPage) AS page FROM ${database}.RumProductAnalyticsSessionV1 WHERE sessionId = {sessionId:String}`,
            query_params: { sessionId: sessionId },
            format: "JSON",
          })) as unknown as {
            json: () => Promise<{ data: Array<JSONObject> }>;
          };

        return String((await result.json()).data[0]?.["page"] ?? "");
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
          clickhouse_settings: {
            enable_analyzer: analyzer === 1 ? 1 : 0,
          } as unknown as NonNullable<
            ClickHouseClientConfigOptions["clickhouse_settings"]
          >,
        };

        clickhouse = new ClickhouseDatabase(options);
        client = await clickhouse.connect(options);

        for (const modelType of [
          RumSession,
          RumProductAnalyticsSession,
          RumProductAnalyticsUser,
        ]) {
          await createTable(
            client,
            clickhouse,
            database,
            modelType as unknown as { new (): AnalyticsBaseModel },
          );
        }

        // The views exactly as the models declare them.
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

        // Every provisional header first, then the finished ones.
        for (const index of [0, 1]) {
          for (const fixture of fixtures) {
            await RumSessionService.insertJsonRows(
              [headerRows(fixture)[index]!],
              { clickhouseSettings: { wait_for_async_insert: 1 } },
            );
          }
        }
      });

      afterAll(async (): Promise<void> => {
        originals.forEach(
          (original: ServiceConnection, index: number): void => {
            Object.assign(services[index]!, original);
          },
        );

        if (client) {
          await client.command({
            query: `DROP DATABASE IF EXISTS ${database}`,
          });
        }

        if (clickhouse) {
          await clickhouse.disconnect();
        }
      });

      test("the analyzer setting took", async () => {
        const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
          (await client.query({
            query: "SELECT getSetting('enable_analyzer') AS value",
            format: "JSON",
          })) as unknown as {
            json: () => Promise<{ data: Array<JSONObject> }>;
          };

        expect(Number((await result.json()).data[0]?.["value"])).toBe(analyzer);
      });

      test("the view files a hash-routed session under its route, as the events name the page", async () => {
        expect(await entryPageOf(fixtures[0]!.sessionId)).toBe("/orders/42");
        expect(await entryPageOf(fixtures[1]!.sessionId)).toBe("/app/cart");
        expect(await entryPageOf(fixtures[2]!.sessionId)).toBe("/");

        // The page product analytics' events file the same address under.
        for (const fixture of fixtures.slice(0, 3)) {
          expect(await entryPageOf(fixture.sessionId)).toBe(
            toProductAnalyticsPage(fixture.entryUrl),
          );
        }

        // A page with no route is its path, and a mobile screen its route.
        expect(
          await entryPageOf(fixtures[fixtures.length - 2]!.sessionId),
        ).toBe("/Checkout");
        expect(
          await entryPageOf(fixtures[fixtures.length - 1]!.sessionId),
        ).toBe("/Checkout");
      });

      test("the Entry page breakdown has a row for each route, and one for a page in every spelling", async () => {
        const rows: Array<[string, number, number]> = rowsOf(
          await breakdown(ProductAnalyticsDimension.EntryPage),
        );

        // The café: three spellings by b1, once by b2 and b3 - one row.
        expect(rows).toContainEqual([CAFE_PAGE, 3, CAFE_ADDRESSES.length + 2]);
        expect(rows).toContainEqual(["/orders/42", 1, 1]);
        expect(rows).toContainEqual(["/app/cart", 1, 1]);
        expect(rows).toContainEqual(["/", 1, 1]);

        // What names another page stays apart.
        expect(rows).toContainEqual(["/a%2Fb", 1, 1]);
        expect(rows).toContainEqual(["/a/b", 1, 1]);
        expect(rows).toContainEqual(["/Cart", 1, 1]);

        const names: Array<string> = rows.map(
          (row: [string, number, number]): string => {
            return row[0];
          },
        );

        // No row of an old spelling, and every row named once.
        expect(names).not.toContain("/caf%c3%a9");
        expect(names).not.toContain("/cafe%CC%81");
        expect(new Set(names).size).toBe(names.length);
      });

      test("the Page breakdown has a row for each route, and counts a session once on a page it saw in two spellings", async () => {
        const rows: Array<[string, number, number]> = rowsOf(
          await breakdown(ProductAnalyticsDimension.Page),
        );

        expect(rows).toContainEqual([CAFE_PAGE, 3, CAFE_ADDRESSES.length + 2]);
        expect(rows).toContainEqual(["/orders/42", 1, 1]);
        expect(rows).toContainEqual(["/cart", 1, 1]);
        expect(rows).toContainEqual(["/app/cart", 1, 1]);
        expect(rows).toContainEqual(["/app/checkout", 1, 1]);
        expect(rows).toContainEqual(["/pricing", 1, 1]);
        expect(rows).toContainEqual(["/a%2Fb", 1, 1]);
        expect(rows).toContainEqual(["/a/b", 1, 1]);
        expect(rows).toContainEqual(["/Cart", 1, 1]);

        // A page row is a path, never a whole address.
        for (const row of rows) {
          expect(row[0].startsWith("/")).toBe(true);
          expect(row[0]).not.toContain("shop.example.com");
        }
      });

      test("a mobile screen stored as null/... and as app://... is one row", async () => {
        expect(
          rowsOf(
            await breakdown(
              ProductAnalyticsDimension.EntryPage,
              mobileApplicationId,
            ),
          ),
        ).toEqual([["/Checkout", 2, 2]]);
        expect(
          rowsOf(
            await breakdown(
              ProductAnalyticsDimension.Page,
              mobileApplicationId,
            ),
          ),
        ).toEqual([
          ["/Checkout", 2, 2],
          ["/Home", 2, 2],
        ]);
      });

      test("a person's sessions name their entry page and pages as the breakdowns do", async () => {
        const detail: ProductAnalyticsPersonDetailDto =
          await RumProductAnalyticsReadService.getPerson({
            projectId: projectId,
            rumApplicationId: applicationId,
            personKey: `v:${"b3".repeat(16)}`,
            now: now,
            limit: 10,
            offset: 0,
            includeLabel: false,
          });

        expect(detail.sessions).toHaveLength(1);
        expect(detail.sessions[0]!.entryPage).toBe(CAFE_PAGE);
        expect(detail.sessions[0]!.pages).toEqual([CAFE_PAGE, "/pricing"]);
      });
    },
  );
}

describe("Product analytics overview pages ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
