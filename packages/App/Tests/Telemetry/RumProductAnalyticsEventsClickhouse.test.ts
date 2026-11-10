import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import BadDataException from "Common/Types/Exception/BadDataException";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumProductAnalyticsEvent from "Common/Models/AnalyticsModels/RumProductAnalyticsEvent";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import RumProductAnalyticsEventService from "Common/Server/Services/RumProductAnalyticsEventService";
import RumProductAnalyticsEventReadService from "Common/Server/Utils/RumProductAnalytics/RumProductAnalyticsEventReadService";
import {
  ProductAnalyticsErasureFilter,
  buildProductAnalyticsErasureFilters,
  buildProductAnalyticsUserSessionLookup,
} from "Common/Server/Utils/RumProductAnalytics/RumProductAnalyticsErasure";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import { RumSessionErasureRequestType } from "Common/Models/DatabaseModels/RumSessionErasureRequest";
import {
  ProductAnalyticsEventKind,
  ProductAnalyticsParsedEvent,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import {
  ProductAnalyticsEventBreakdownDto,
  ProductAnalyticsEventField,
  ProductAnalyticsEventNameDto,
  ProductAnalyticsEventNamesDto,
  ProductAnalyticsEventRef,
  ProductAnalyticsEventTrendDto,
  ProductAnalyticsFunnelDto,
  ProductAnalyticsRetentionDto,
  ProductAnalyticsRetentionPeriod,
  ProductAnalyticsSegmentFilter,
} from "Common/Types/Rum/ProductAnalyticsEventReads";
import ProductAnalyticsEventIngestService from "../../FeatureSet/Telemetry/Services/ProductAnalyticsEventIngestService";
import { ProductAnalyticsEventsJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
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
 * Product analytics events (issue #6444, part two) against a real
 * ClickHouse server: the event names list, trends, breakdowns, property
 * keys, funnels and retention, on a small known history whose every
 * answer is worked out by hand below - and the erasure deletes on the
 * events table.
 *
 * The rows are made by the ingest worker's own row builder
 * (ProductAnalyticsEventIngestService.buildEventRows), so what is read is
 * what the worker writes. Every read runs twice, under the new query
 * analyzer and the old one: a customer's own ClickHouse may run either.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server,
 * credentials in the URL:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/RumProductAnalyticsEventsClickhouse.test.ts
 *
 * The suite creates and drops only its own uniquely named databases. The
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

const projectId: ObjectID = new ObjectID("6600000000000000000000c1");
const otherProjectId: ObjectID = new ObjectID("6600000000000000000000c2");
const applicationId: ObjectID = new ObjectID("6600000000000000000000d1");
const otherApplicationId: ObjectID = new ObjectID("6600000000000000000000d2");

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

const now: Date = new Date();

/* Day 0: midnight UTC twenty days ago. The range read is days 0 to 6. */
const dayZero: Date = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
    20 * DAY_MS,
);

function at(day: number, hour: number, minute: number = 0): number {
  return dayZero.getTime() + day * DAY_MS + hour * HOUR_MS + minute * MINUTE_MS;
}

const rangeStart: Date = new Date(at(0, 0));
const rangeEnd: Date = new Date(at(7, 0) - 1);

function dayText(day: number): string {
  return new Date(at(day, 0)).toISOString().substring(0, 10);
}

function hex(seed: string, length: number): string {
  return seed.repeat(length).substring(0, length);
}

const aliceKey: string = hex("a1", 64);
const aliceVisitor: string = hex("a2", 32);
const bobVisitor: string = hex("b2", 32);
const carolKey: string = hex("c1", 64);
const carolVisitor: string = hex("c2", 32);
const daveVisitor: string = hex("d2", 32);

const viewedPricing: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Custom,
  name: "Viewed pricing",
};
const signedUp: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Custom,
  name: "Signed up",
};
const purchased: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Custom,
  name: "Purchased",
};
const clicked: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Custom,
  name: "Clicked",
};

function custom(
  name: string,
  time: number,
  properties: Record<string, string> = {},
): ProductAnalyticsParsedEvent {
  return {
    kind: ProductAnalyticsEventKind.Custom,
    name: name,
    time: time,
    page: "/app",
    properties: properties,
  };
}

function sessionStart(time: number): ProductAnalyticsParsedEvent {
  return {
    kind: ProductAnalyticsEventKind.Session,
    name: "",
    time: time,
    page: "/",
    properties: {},
  };
}

interface BatchFixture {
  sessionId: string;
  visitorId: string;
  identifiedUserKey?: string | undefined;
  userProperties?: Record<string, string> | undefined;
  deviceType: string;
  browserName: string;
  osName: string;
  countryCode: string;
  project?: ObjectID | undefined;
  application?: ObjectID | undefined;
  events: Array<ProductAnalyticsParsedEvent>;
}

const desktop: Pick<BatchFixture, "deviceType" | "browserName" | "osName"> = {
  deviceType: "desktop",
  browserName: "Chrome",
  osName: "Windows",
};

/*
 * The history, batch by batch, as the recorders send it:
 *
 *  Alice  S1 day 0: anonymous, she views pricing (10:00) and clicks
 *         (10:01); then she signs in, and signs up (10:05, plan pro) and
 *         buys (10:20). S2 day 2: signed in, she buys again (09:00) and
 *         clicks (09:05).
 *  Bob    S3 day 1, anonymous on a phone in Germany: views pricing (12:00),
 *         signs up (12:30, plan free). S4 day 8 (after the range): views
 *         pricing again.
 *  Carol  S5 day 3, signed in from France: signs up (08:00, plan pro).
 *         S6 day 5: buys (10:00) - 50 hours after signing up.
 *  Dave   S7, anonymous: views pricing at 23:30 on day 6, signs up at
 *         00:10 on day 7, just after the range.
 *  Erin   another application, and Frank another project: never counted.
 */
const batches: Array<BatchFixture> = [
  {
    sessionId: hex("01", 32),
    visitorId: aliceVisitor,
    ...desktop,
    countryCode: "US",
    events: [
      sessionStart(at(0, 9, 58)),
      {
        kind: ProductAnalyticsEventKind.Page,
        name: "/pricing",
        time: at(0, 9, 59),
        page: "/pricing",
        properties: {},
      },
      custom("Viewed pricing", at(0, 10, 0)),
      custom("Clicked", at(0, 10, 1)),
    ],
  },
  {
    sessionId: hex("01", 32),
    visitorId: aliceVisitor,
    identifiedUserKey: aliceKey,
    userProperties: { company: "Initech" },
    ...desktop,
    countryCode: "US",
    events: [
      custom("Signed up", at(0, 10, 5), { plan: "pro" }),
      custom("Purchased", at(0, 10, 20), { amount: "49" }),
    ],
  },
  {
    sessionId: hex("02", 32),
    visitorId: aliceVisitor,
    identifiedUserKey: aliceKey,
    userProperties: { company: "Initech" },
    ...desktop,
    countryCode: "US",
    events: [
      sessionStart(at(2, 8, 59)),
      custom("Purchased", at(2, 9, 0)),
      custom("Clicked", at(2, 9, 5)),
    ],
  },
  {
    sessionId: hex("03", 32),
    visitorId: bobVisitor,
    deviceType: "mobile",
    browserName: "Safari",
    osName: "iOS",
    countryCode: "DE",
    events: [
      sessionStart(at(1, 11, 59)),
      custom("Viewed pricing", at(1, 12, 0)),
      custom("Signed up", at(1, 12, 30), { plan: "free" }),
    ],
  },
  {
    sessionId: hex("04", 32),
    visitorId: bobVisitor,
    deviceType: "mobile",
    browserName: "Safari",
    osName: "iOS",
    countryCode: "DE",
    events: [
      sessionStart(at(8, 10, 0)),
      custom("Viewed pricing", at(8, 10, 1)),
    ],
  },
  {
    sessionId: hex("05", 32),
    visitorId: carolVisitor,
    identifiedUserKey: carolKey,
    userProperties: { company: "Acme" },
    deviceType: "desktop",
    browserName: "Firefox",
    osName: "Linux",
    countryCode: "FR",
    events: [
      sessionStart(at(3, 7, 59)),
      custom("Signed up", at(3, 8, 0), { plan: "pro" }),
    ],
  },
  {
    sessionId: hex("06", 32),
    visitorId: carolVisitor,
    identifiedUserKey: carolKey,
    userProperties: { company: "Acme" },
    deviceType: "desktop",
    browserName: "Firefox",
    osName: "Linux",
    countryCode: "FR",
    events: [sessionStart(at(5, 9, 59)), custom("Purchased", at(5, 10, 0))],
  },
  {
    sessionId: hex("07", 32),
    visitorId: daveVisitor,
    ...desktop,
    countryCode: "US",
    events: [
      sessionStart(at(6, 23, 29)),
      custom("Viewed pricing", at(6, 23, 30)),
      custom("Signed up", at(7, 0, 10), { plan: "free" }),
    ],
  },
  {
    sessionId: hex("08", 32),
    visitorId: hex("e2", 32),
    ...desktop,
    countryCode: "US",
    application: otherApplicationId,
    events: [sessionStart(at(1, 9, 59)), custom("Signed up", at(1, 10, 0))],
  },
  {
    sessionId: hex("09", 32),
    visitorId: hex("f2", 32),
    ...desktop,
    countryCode: "US",
    project: otherProjectId,
    events: [sessionStart(at(1, 9, 59)), custom("Signed up", at(1, 10, 0))],
  },
];

function rowsOfBatch(batch: BatchFixture, index: number): Array<JSONObject> {
  const job: ProductAnalyticsEventsJobData = {
    projectId: (batch.project || projectId).toString(),
    rumApplicationId: (batch.application || applicationId).toString(),
    batchId: hex(String(index).padStart(2, "0"), 32),
    receivedAtUnixMs: now.getTime(),
    countryCode: batch.countryCode,
    sessionId: batch.sessionId,
    visitorId: batch.visitorId,
    identifiedUserKey: batch.identifiedUserKey || "",
    userProperties: batch.userProperties || {},
    context: {
      deviceType: batch.deviceType,
      browserName: batch.browserName,
      osName: batch.osName,
      appVersion: "",
    },
    events: batch.events,
    metrics: [],
  };

  return ProductAnalyticsEventIngestService.buildEventRows(job);
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  database: string,
): Promise<void> {
  const model: AnalyticsBaseModel = new RumProductAnalyticsEvent();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: RumProductAnalyticsEvent as unknown as {
        new (): AnalyticsBaseModel;
      },
      database: clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")}) TTL ${model.ttlExpression} SETTINGS ${model.tableSettings}`,
    query_params: columns.query_params,
  });
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

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

function namesOf(list: ProductAnalyticsEventNamesDto): Array<string> {
  return list.events.map((event: ProductAnalyticsEventNameDto): string => {
    return `${event.kind}:${event.name}`;
  });
}

function mondayOf(time: number): string {
  const date: Date = new Date(time);
  const day: number = date.getUTCDay();
  const back: number = (day + 6) % 7;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      back * DAY_MS,
  )
    .toISOString()
    .substring(0, 10);
}

/* Both query analyzers: 1 is the new one (the default), 0 the old one. */
for (const analyzer of [1, 0]) {
  integration(
    `Product analytics events against ClickHouse (analyzer ${analyzer})`,
    () => {
      const database: string = `rum_pa_events_test_${analyzer}_${process.pid}_${Date.now()}`;
      let clickhouse: ClickhouseDatabase;
      let client: ClickhouseClient;
      let original: ServiceConnection | null = null;

      async function count(query: string): Promise<number> {
        const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
          (await client.query({
            query: query,
            format: "JSON",
          })) as unknown as {
            json: () => Promise<{ data: Array<JSONObject> }>;
          };

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
          clickhouse_settings: {
            enable_analyzer: analyzer === 1 ? 1 : 0,
          } as unknown as NonNullable<
            ClickHouseClientConfigOptions["clickhouse_settings"]
          >,
        };

        clickhouse = new ClickhouseDatabase(options);
        client = await clickhouse.connect(options);

        await createTable(client, clickhouse, database);

        const service: ServiceConnection =
          RumProductAnalyticsEventService as unknown as ServiceConnection;

        original = {
          database: service.database,
          databaseClient: service.databaseClient,
          ingestDatabase: service.ingestDatabase,
          ingestDatabaseClient: service.ingestDatabaseClient,
        };

        service.database = clickhouse;
        service.databaseClient = client;
        service.ingestDatabase = clickhouse;
        service.ingestDatabaseClient = client;

        /* One insert per batch, in the order they were sent. */
        for (let index: number = 0; index < batches.length; index++) {
          await RumProductAnalyticsEventService.insertJsonRows(
            rowsOfBatch(batches[index]!, index),
            { clickhouseSettings: { wait_for_async_insert: 1 } },
          );
        }
      });

      afterAll(async (): Promise<void> => {
        if (original) {
          Object.assign(RumProductAnalyticsEventService, original);
        }

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

      test("the worker's rows land as written", async () => {
        expect(
          await count(
            `SELECT toUInt64(count()) AS rows FROM ${database}.RumProductAnalyticsEventV1`,
          ),
        ).toBe(
          batches.reduce((total: number, batch: BatchFixture): number => {
            return total + batch.events.length;
          }, 0),
        );
      });

      test("event names: the most frequent first, a person counted once across sign-in", async () => {
        const all: ProductAnalyticsEventNamesDto =
          await RumProductAnalyticsEventReadService.listEventNames(range);

        expect(namesOf(all)).toEqual([
          "session:",
          "custom:Purchased",
          "custom:Signed up",
          "custom:Viewed pricing",
          "custom:Clicked",
          "page:/pricing",
        ]);

        const byName: Map<string, ProductAnalyticsEventNameDto> = new Map<
          string,
          ProductAnalyticsEventNameDto
        >(
          all.events.map(
            (
              event: ProductAnalyticsEventNameDto,
            ): [string, ProductAnalyticsEventNameDto] => {
              return [`${event.kind}:${event.name}`, event];
            },
          ),
        );

        /* Six sessions started in the range, by four people. */
        expect(byName.get("session:")?.events).toBe(6);
        expect(byName.get("session:")?.users).toBe(4);
        /* Alice bought twice. */
        expect(byName.get("custom:Purchased")?.events).toBe(3);
        expect(byName.get("custom:Purchased")?.users).toBe(2);
        /* Dave's sign-up is after the range. */
        expect(byName.get("custom:Signed up")?.users).toBe(3);
        /*
         * Alice clicked once anonymously and once signed in: one person,
         * because her first session named her later on.
         */
        expect(byName.get("custom:Clicked")?.events).toBe(2);
        expect(byName.get("custom:Clicked")?.users).toBe(1);
        expect(byName.get("custom:Viewed pricing")?.lastSeenAt).toBe(
          at(6, 23, 30),
        );
        expect(all.hasMore).toBe(false);
        expect(all.dataStartedAt).toBe(at(0, 9, 58));

        const customOnly: ProductAnalyticsEventNamesDto =
          await RumProductAnalyticsEventReadService.listEventNames({
            ...range,
            kind: ProductAnalyticsEventKind.Custom,
          });

        expect(namesOf(customOnly)).toEqual([
          "custom:Purchased",
          "custom:Signed up",
          "custom:Viewed pricing",
          "custom:Clicked",
        ]);
        expect(customOnly.events[3]?.users).toBe(1);
      });

      test("trend: every day of the range, totals over the range", async () => {
        const trend: ProductAnalyticsEventTrendDto =
          await RumProductAnalyticsEventReadService.getEventTrend({
            ...range,
            event: signedUp,
            filters: [],
            timeZone: "UTC",
          });

        expect(trend.days).toEqual([
          { day: dayText(0), events: 1, users: 1 },
          { day: dayText(1), events: 1, users: 1 },
          { day: dayText(2), events: 0, users: 0 },
          { day: dayText(3), events: 1, users: 1 },
          { day: dayText(4), events: 0, users: 0 },
          { day: dayText(5), events: 0, users: 0 },
          { day: dayText(6), events: 0, users: 0 },
        ]);
        expect(trend.totalEvents).toBe(3);
        expect(trend.totalUsers).toBe(3);
        expect(trend.totalSessions).toBe(3);

        const clicks: ProductAnalyticsEventTrendDto =
          await RumProductAnalyticsEventReadService.getEventTrend({
            ...range,
            event: clicked,
            filters: [],
            timeZone: "UTC",
          });

        expect(clicks.totalEvents).toBe(2);
        expect(clicks.totalUsers).toBe(1);
        expect(clicks.totalSessions).toBe(2);
      });

      test("trend: days in the reader's zone", async () => {
        /* Tokyo is UTC+9: the range is 09:00 on day 0 to 08:59 on day 7 there. */
        const trend: ProductAnalyticsEventTrendDto =
          await RumProductAnalyticsEventReadService.getEventTrend({
            ...range,
            event: viewedPricing,
            filters: [],
            timeZone: "Asia/Tokyo",
          });

        expect(trend.days.length).toBe(8);
        expect(
          trend.days.filter((day: { events: number }): boolean => {
            return day.events > 0;
          }),
        ).toEqual([
          { day: dayText(0), events: 1, users: 1 },
          { day: dayText(1), events: 1, users: 1 },
          { day: dayText(7), events: 1, users: 1 },
        ]);
      });

      test("segments: every filter must hold", async () => {
        const mobile: Array<ProductAnalyticsSegmentFilter> = [
          {
            field: ProductAnalyticsEventField.DeviceType,
            key: "",
            value: "mobile",
          },
        ];

        const onPhones: ProductAnalyticsEventTrendDto =
          await RumProductAnalyticsEventReadService.getEventTrend({
            ...range,
            event: viewedPricing,
            filters: mobile,
            timeZone: "UTC",
          });

        expect(onPhones.totalEvents).toBe(1);

        const proSignUps: ProductAnalyticsEventTrendDto =
          await RumProductAnalyticsEventReadService.getEventTrend({
            ...range,
            event: signedUp,
            filters: [
              {
                field: ProductAnalyticsEventField.Property,
                key: "plan",
                value: "pro",
              },
            ],
            timeZone: "UTC",
          });

        expect(proSignUps.totalEvents).toBe(2);

        const acmePro: ProductAnalyticsEventTrendDto =
          await RumProductAnalyticsEventReadService.getEventTrend({
            ...range,
            event: signedUp,
            filters: [
              {
                field: ProductAnalyticsEventField.Property,
                key: "plan",
                value: "pro",
              },
              {
                field: ProductAnalyticsEventField.UserProperty,
                key: "company",
                value: "Acme",
              },
            ],
            timeZone: "UTC",
          });

        expect(acmePro.totalEvents).toBe(1);
        expect(acmePro.totalUsers).toBe(1);
      });

      test("breakdowns: by property, user property, device and country", async () => {
        const read: (
          field: ProductAnalyticsEventField,
          key: string,
        ) => Promise<ProductAnalyticsEventBreakdownDto> = async (
          field: ProductAnalyticsEventField,
          key: string,
        ): Promise<ProductAnalyticsEventBreakdownDto> => {
          return await RumProductAnalyticsEventReadService.getEventBreakdown({
            ...range,
            event: signedUp,
            filters: [],
            breakdown: { field: field, key: key },
            limit: 50,
          });
        };

        const byPlan: ProductAnalyticsEventBreakdownDto = await read(
          ProductAnalyticsEventField.Property,
          "plan",
        );
        expect(byPlan.rows).toEqual([
          { value: "pro", events: 2, users: 2 },
          { value: "free", events: 1, users: 1 },
        ]);
        expect(byPlan.totalEvents).toBe(3);
        expect(byPlan.totalUsers).toBe(3);
        expect(byPlan.hasMore).toBe(false);

        /* Bob signed up anonymously: no user properties. */
        expect(
          (await read(ProductAnalyticsEventField.UserProperty, "company")).rows,
        ).toEqual([
          { value: "", events: 1, users: 1 },
          { value: "Acme", events: 1, users: 1 },
          { value: "Initech", events: 1, users: 1 },
        ]);

        expect(
          (await read(ProductAnalyticsEventField.DeviceType, "")).rows,
        ).toEqual([
          { value: "desktop", events: 2, users: 2 },
          { value: "mobile", events: 1, users: 1 },
        ]);

        expect(
          (await read(ProductAnalyticsEventField.Country, "")).rows,
        ).toEqual([
          { value: "DE", events: 1, users: 1 },
          { value: "FR", events: 1, users: 1 },
          { value: "US", events: 1, users: 1 },
        ]);

        const limited: ProductAnalyticsEventBreakdownDto =
          await RumProductAnalyticsEventReadService.getEventBreakdown({
            ...range,
            event: signedUp,
            filters: [],
            breakdown: { field: ProductAnalyticsEventField.Country, key: "" },
            limit: 2,
          });

        expect(limited.rows.length).toBe(2);
        expect(limited.hasMore).toBe(true);
      });

      test("property keys of an event", async () => {
        expect(
          await RumProductAnalyticsEventReadService.getEventProperties({
            ...range,
            event: signedUp,
          }),
        ).toEqual({ propertyKeys: ["plan"], userPropertyKeys: ["company"] });
      });

      test("funnel: steps in order within the window, across sign-in", async () => {
        const funnel: ProductAnalyticsFunnelDto =
          await RumProductAnalyticsEventReadService.getFunnel({
            ...range,
            steps: [viewedPricing, signedUp, purchased],
            filters: [],
            windowMs: DAY_MS,
            now: now,
          });

        /*
         * Alice (anonymous, then signed in, one session), Bob and Dave (whose
         * sign-up is after the range but inside his day) viewed pricing and
         * signed up; Alice alone bought.
         */
        expect(
          funnel.steps.map((step: { people: number }): number => {
            return step.people;
          }),
        ).toEqual([3, 3, 1]);
        expect(funnel.steps[0]).toEqual({
          kind: ProductAnalyticsEventKind.Custom,
          name: "Viewed pricing",
          people: 3,
          conversionFromStart: 1,
          conversionFromPrevious: 1,
          droppedOff: 0,
          medianMsFromPrevious: null,
        });
        /* 5, 30 and 40 minutes: the median is 30. */
        expect(funnel.steps[1]?.medianMsFromPrevious).toBe(30 * MINUTE_MS);
        expect(funnel.steps[2]?.medianMsFromPrevious).toBe(15 * MINUTE_MS);
        expect(funnel.steps[2]?.conversionFromStart).toBeCloseTo(1 / 3, 6);
        expect(funnel.steps[2]?.conversionFromPrevious).toBeCloseTo(1 / 3, 6);
        expect(funnel.steps[2]?.droppedOff).toBe(2);
      });

      test("funnel: the window decides who converted", async () => {
        const read: (windowMs: number) => Promise<Array<number>> = async (
          windowMs: number,
        ): Promise<Array<number>> => {
          const funnel: ProductAnalyticsFunnelDto =
            await RumProductAnalyticsEventReadService.getFunnel({
              ...range,
              steps: [signedUp, purchased],
              filters: [],
              windowMs: windowMs,
              now: now,
            });

          return funnel.steps.map((step: { people: number }): number => {
            return step.people;
          });
        };

        /* Carol bought 50 hours after signing up. */
        expect(await read(DAY_MS)).toEqual([3, 1]);
        expect(await read(7 * DAY_MS)).toEqual([3, 2]);
        expect(await read(HOUR_MS)).toEqual([3, 1]);
      });

      test("funnel: one event as two steps needs two occurrences", async () => {
        const read: (
          windowMs: number,
        ) => Promise<ProductAnalyticsFunnelDto> = async (
          windowMs: number,
        ): Promise<ProductAnalyticsFunnelDto> => {
          return await RumProductAnalyticsEventReadService.getFunnel({
            ...range,
            steps: [purchased, purchased],
            filters: [],
            windowMs: windowMs,
            now: now,
          });
        };

        const week: ProductAnalyticsFunnelDto = await read(7 * DAY_MS);
        expect(week.steps[0]?.people).toBe(2);
        expect(week.steps[1]?.people).toBe(1);
        expect(week.steps[1]?.medianMsFromPrevious).toBe(
          at(2, 9, 0) - at(0, 10, 20),
        );

        const day: ProductAnalyticsFunnelDto = await read(DAY_MS);
        expect(day.steps[1]?.people).toBe(0);
        expect(day.steps[1]?.medianMsFromPrevious).toBeNull();
      });

      test("funnel: a segment narrows every step", async () => {
        const funnel: ProductAnalyticsFunnelDto =
          await RumProductAnalyticsEventReadService.getFunnel({
            ...range,
            steps: [viewedPricing, signedUp],
            filters: [
              {
                field: ProductAnalyticsEventField.DeviceType,
                key: "",
                value: "mobile",
              },
            ],
            windowMs: DAY_MS,
            now: now,
          });

        expect(
          funnel.steps.map((step: { people: number }): number => {
            return step.people;
          }),
        ).toEqual([1, 1]);
      });

      test("retention by day: cohorts by first start event, null past the range", async () => {
        const retention: ProductAnalyticsRetentionDto =
          await RumProductAnalyticsEventReadService.getRetention({
            ...range,
            startEvent: signedUp,
            returnEvent: purchased,
            filters: [],
            period: ProductAnalyticsRetentionPeriod.Day,
            timeZone: "UTC",
          });

        expect(retention.cohorts.length).toBe(7);
        expect(retention.cohorts[0]).toEqual({
          start: dayText(0),
          people: 1,
          returning: [1, 0, 1, 0, 0, 0, 0],
        });
        expect(retention.cohorts[1]).toEqual({
          start: dayText(1),
          people: 1,
          returning: [0, 0, 0, 0, 0, 0, null],
        });
        expect(retention.cohorts[2]).toEqual({
          start: dayText(2),
          people: 0,
          returning: [0, 0, 0, 0, 0, null, null],
        });
        expect(retention.cohorts[3]).toEqual({
          start: dayText(3),
          people: 1,
          returning: [0, 0, 1, 0, null, null, null],
        });
        expect(retention.cohorts[6]?.returning).toEqual([
          0,
          null,
          null,
          null,
          null,
          null,
          null,
        ]);
      });

      test("retention by week: Monday cohorts", async () => {
        const retention: ProductAnalyticsRetentionDto =
          await RumProductAnalyticsEventReadService.getRetention({
            ...range,
            startEvent: signedUp,
            returnEvent: purchased,
            filters: [],
            period: ProductAnalyticsRetentionPeriod.Week,
            timeZone: "UTC",
          });

        const mondays: Array<string> = Array.from(
          new Set<string>(
            [0, 1, 2, 3, 4, 5, 6].map((day: number): string => {
              return mondayOf(at(day, 12));
            }),
          ),
        );

        expect(
          retention.cohorts.map((cohort: { start: string }): string => {
            return cohort.start;
          }),
        ).toEqual(mondays);

        const total: number = retention.cohorts.reduce(
          (sum: number, cohort: { people: number }): number => {
            return sum + cohort.people;
          },
          0,
        );
        expect(total).toBe(3);

        const aliceCohort: string = mondayOf(at(0, 10, 5));
        const cohort:
          | { people: number; returning: Array<number | null> }
          | undefined = retention.cohorts.find(
          (entry: { start: string }): boolean => {
            return entry.start === aliceCohort;
          },
        );
        /* Alice bought in her own week, at least. */
        expect(cohort?.returning[0]).toBeGreaterThanOrEqual(1);
      });

      test("retention: one event as start and return keeps period zero full", async () => {
        const retention: ProductAnalyticsRetentionDto =
          await RumProductAnalyticsEventReadService.getRetention({
            ...range,
            startEvent: signedUp,
            returnEvent: signedUp,
            filters: [],
            period: ProductAnalyticsRetentionPeriod.Day,
            timeZone: "UTC",
          });

        for (const cohort of retention.cohorts) {
          expect(cohort.returning[0]).toBe(cohort.people);
        }
      });

      test("retention refuses more cohorts than a read covers", async () => {
        await expect(
          RumProductAnalyticsEventReadService.getRetention({
            ...scope,
            startTime: new Date(at(0, 0) - 40 * DAY_MS),
            endTime: rangeEnd,
            startEvent: signedUp,
            returnEvent: purchased,
            filters: [],
            period: ProductAnalyticsRetentionPeriod.Day,
            timeZone: "UTC",
          }),
        ).rejects.toBeInstanceOf(BadDataException);
      });

      test("periods: days, Mondays and months in a zone", async () => {
        expect(
          await RumProductAnalyticsEventReadService.getPeriods({
            startTime: new Date("2026-03-30T12:00:00.000Z"),
            endTime: new Date("2026-04-14T12:00:00.000Z"),
            timeZone: "UTC",
            period: ProductAnalyticsRetentionPeriod.Week,
          }),
        ).toEqual(["2026-03-30", "2026-04-06", "2026-04-13"]);

        expect(
          await RumProductAnalyticsEventReadService.getPeriods({
            startTime: new Date("2026-01-31T23:30:00.000Z"),
            endTime: new Date("2026-03-01T00:30:00.000Z"),
            timeZone: "UTC",
            period: ProductAnalyticsRetentionPeriod.Month,
          }),
        ).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);

        /* 23:30 UTC on 31 January is 1 February in Berlin. */
        expect(
          await RumProductAnalyticsEventReadService.getPeriods({
            startTime: new Date("2026-01-31T23:30:00.000Z"),
            endTime: new Date("2026-02-02T10:00:00.000Z"),
            timeZone: "Europe/Berlin",
            period: ProductAnalyticsRetentionPeriod.Day,
          }),
        ).toEqual(["2026-02-01", "2026-02-02"]);
      });

      describe("erasure", () => {
        async function erase(
          filters: Array<ProductAnalyticsErasureFilter>,
        ): Promise<void> {
          for (const filter of filters) {
            if (
              filter.tableName !== AnalyticsTableName.RumProductAnalyticsEvent
            ) {
              continue;
            }

            await client.command({
              query: `ALTER TABLE ${database}.${filter.tableName} DELETE WHERE ${filter.where.query}`,
              query_params: filter.where.query_params,
              clickhouse_settings: { mutations_sync: "2" },
            });
          }
        }

        async function eventsWhere(where: string): Promise<number> {
          return await count(
            `SELECT toUInt64(count()) AS rows FROM ${database}.RumProductAnalyticsEventV1 WHERE ${where}`,
          );
        }

        test("by user removes every event of the user's sessions, the anonymous ones too", async () => {
          const lookup: { json: () => Promise<{ data: Array<JSONObject> }> } =
            (await RumProductAnalyticsEventService.executeQuery(
              buildProductAnalyticsUserSessionLookup({
                databaseName: database,
                projectId: projectId,
                identifiedUserKey: aliceKey,
                limit: 10000,
                tableName: AnalyticsTableName.RumProductAnalyticsEvent,
              }),
            )) as unknown as {
              json: () => Promise<{ data: Array<JSONObject> }>;
            };

          const aliceSessions: Array<string> = (await lookup.json()).data
            .map((row: JSONObject): string => {
              return String(row["paSessionId"]);
            })
            .sort();

          expect(aliceSessions).toEqual([hex("01", 32), hex("02", 32)]);

          await erase(
            buildProductAnalyticsErasureFilters({
              projectId: projectId,
              requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
              targetValue: aliceKey,
              sessionIds: aliceSessions,
            }),
          );

          expect(await eventsWhere(`visitorId = '${aliceVisitor}'`)).toBe(0);
          expect(await eventsWhere(`visitorId = '${bobVisitor}'`)).toBe(5);
        });

        test("by date range removes the range's events and no others", async () => {
          await erase(
            buildProductAnalyticsErasureFilters({
              projectId: projectId,
              rumApplicationId: applicationId,
              requestType: RumSessionErasureRequestType.ByDateRange,
              startDate: new Date(at(1, 0)),
              endDate: new Date(at(2, 0) - 1),
            }),
          );

          expect(await eventsWhere(`sessionId = '${hex("03", 32)}'`)).toBe(0);
          expect(await eventsWhere(`sessionId = '${hex("04", 32)}'`)).toBe(2);
          /* The other project's day 1 is its own. */
          expect(
            await eventsWhere(`projectId = '${otherProjectId.toString()}'`),
          ).toBe(2);
        });

        test("by application removes the application's events and no other's", async () => {
          await erase(
            buildProductAnalyticsErasureFilters({
              projectId: projectId,
              requestType: RumSessionErasureRequestType.ByRumApplication,
              targetValue: applicationId.toString(),
            }),
          );

          expect(
            await eventsWhere(
              `projectId = '${projectId.toString()}' AND rumApplicationId = '${applicationId.toString()}'`,
            ),
          ).toBe(0);
          expect(
            await eventsWhere(
              `rumApplicationId = '${otherApplicationId.toString()}'`,
            ),
          ).toBe(2);
        });
      });
    },
  );
}

/*
 * The suite above is opt-in, and an opt-in regression guard that silently
 * stops opting in guards nothing. The App Test workflow starts a ClickHouse
 * service for it, so a missing URL there is a broken pipeline, not a skip.
 */
describe("Product analytics events ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
