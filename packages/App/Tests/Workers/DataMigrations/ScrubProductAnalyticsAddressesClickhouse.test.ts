import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import RumProductAnalyticsEvent from "Common/Models/AnalyticsModels/RumProductAnalyticsEvent";
import RumProductAnalyticsSession from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  isIdentifierSegmentSql,
  scrubbedPropertyValueSql,
} from "Common/Server/Utils/AnalyticsDatabase/UrlScrubberSql";
import AnalyticsTableEngine from "Common/Types/AnalyticsDatabase/AnalyticsTableEngine";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  PRODUCT_ANALYTICS_PROPERTY_LIMITS,
  ProductAnalyticsEventKind,
  ProductAnalyticsParsedEvent,
  toProductAnalyticsPage,
  toProductAnalyticsPropertyValue,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import {
  PAGES_WITH_PERSONAL_DATA,
  PAGES_WITH_SECRETS,
  PAGE_SPELLINGS,
  PageSpellingCase,
  addressOf,
} from "Common/Tests/Helpers/PageSpellings";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
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
 * ScrubProductAnalyticsAddresses against a real ClickHouse (#8385, #8386).
 *
 * The unit suite pins the statements. This one shows what they do to what
 * an install already holds - tables built from the models' own columns and
 * keys, with the rows the ingest worker's own builders make - and holds the
 * rule they are made of (UrlScrubberSql) to the scrubber's:
 *
 *   - page views named by a page with a JSON Web Token, an address escaped
 *     twice or an email beyond ASCII are gone, every other event stays on
 *     its page redacted, and every page the recorder sends now is untouched;
 *   - an address-valued property or user property is scrubbed as the ingest
 *     scrubs one now, and the application's own words are kept;
 *   - a session's entry page and pages are redacted the same way;
 *   - a RUM application's metric() points have their address attributes
 *     scrubbed, its OpenTelemetry metrics and a service's are left alone;
 *   - running it again changes nothing;
 *   - over thousands of segments and values, the SQL rule never takes for
 *     an identifier what the scrubber keeps, agrees with it on what is
 *     neither beyond U+FFFF nor near a length limit, and what it writes is
 *     what the scrubber writes once scrubbed again.
 *
 * The CI server is a single node without a cluster, so ON CLUSTER is left
 * out of the statements and the tables are plain engines under the local
 * tables' names - the statements are otherwise the migration's own. The App
 * Test workflow provides the server; the guard at the bottom fails the run
 * there if it ever goes missing. Locally:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/DataMigrations/ScrubProductAnalyticsAddressesClickhouse.test.ts
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

jest.mock("Common/Server/Utils/AnalyticsDatabase/ClusterConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/AnalyticsDatabase/ClusterConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    onClusterClause: (): string => {
      return "";
    },
  };
});

import MetricService from "Common/Server/Services/MetricService";
import ProductAnalyticsEventIngestService from "../../../FeatureSet/Telemetry/Services/ProductAnalyticsEventIngestService";
import ScrubProductAnalyticsAddresses from "../../../FeatureSet/Workers/DataMigrations/ScrubProductAnalyticsAddresses";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(300000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `scrub_pa_addresses_test_${process.pid}_${Date.now()}`;
const EVENTS: string = ScrubProductAnalyticsAddresses.getEventStorageTable();
const SESSIONS: string =
  ScrubProductAnalyticsAddresses.getSessionStorageTable();
const METRICS: string = ScrubProductAnalyticsAddresses.getMetricStorageTable();

const projectId: ObjectID = new ObjectID("6600000000000000000000d1");
const applicationId: ObjectID = new ObjectID("6600000000000000000000d2");
const serviceId: ObjectID = new ObjectID("6600000000000000000000d3");

const secretsSession: string = "a1".repeat(16);
const recorderSession: string = "b1".repeat(16);
const propertiesSession: string = "c1".repeat(16);

const VALUE_LIMIT: number = PRODUCT_ANALYTICS_PROPERTY_LIMITS.maxValueLength;

const POLL_INTERVAL_MS: number = 250;
const WAIT_LIMIT_MS: number = 180000;

const ALL_ROWS: Array<PageSpellingCase> = [
  ...PAGE_SPELLINGS,
  ...PAGES_WITH_PERSONAL_DATA,
  ...PAGES_WITH_SECRETS,
];

// What names someone, in any row of the shared tables.
const PERSONAL_DATA: Array<string> = [
  "someone",
  "First.Last",
  "jörg",
  "j%C3%B6rg",
  "3f1a9c7e",
  "3F1A9C7E",
  "5f8d0d55b54764421b7156c9",
  "4111111111111111",
  "Zx8",
  "eyJhbGci",
  "%2540",
  "%2534",
  "dGhpcyBp",
  "k3J",
  "token=",
  "access_token",
];

// JavaScript's spaces RE2's \s does not know: such a value is left alone.
const JAVASCRIPT_ONLY_SPACE: RegExp =
  // eslint-disable-next-line no-control-regex
  /[\u000b\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/;

// The page the ingest kept before it scrubbed: no query, no fragment.
function storedBeforeTheIngestScrubbed(sent: string): string {
  const path: string = sent.split(/[?#]/)[0] || "/";

  return UrlScrubber.normalizePathSpelling(
    path.startsWith("/") ? path : `/${path}`,
  );
}

function events(
  pages: Array<string>,
  offsetMs: number,
  properties?: (index: number) => Record<string, string>,
): Array<ProductAnalyticsParsedEvent> {
  const start: number = Date.now() - 5 * 24 * 60 * 60 * 1000 + offsetMs;

  return pages.flatMap(
    (page: string, index: number): Array<ProductAnalyticsParsedEvent> => {
      const time: number = start + index * 60000;

      return [
        {
          kind: ProductAnalyticsEventKind.Session,
          name: "",
          time: time,
          page: page,
          properties: {},
        },
        {
          kind: ProductAnalyticsEventKind.Page,
          name: page,
          time: time + 1000,
          page: page,
          properties: {},
        },
        {
          kind: ProductAnalyticsEventKind.Custom,
          name: "Ordered",
          time: time + 2000,
          page: page,
          properties: properties ? properties(index) : { plan: "pro" },
        },
      ];
    },
  );
}

function eventRows(
  sessionId: string,
  parsedEvents: Array<ProductAnalyticsParsedEvent>,
  userProperties: Record<string, string> = {},
): Array<JSONObject> {
  return ProductAnalyticsEventIngestService.buildEventRows({
    projectId: projectId.toString(),
    rumApplicationId: applicationId.toString(),
    batchId: sessionId,
    receivedAtUnixMs: Date.now(),
    countryCode: "US",
    sessionId: sessionId,
    visitorId: "d1".repeat(16),
    identifiedUserKey: "",
    userProperties: userProperties,
    context: {
      deviceType: "desktop",
      browserName: "Chrome",
      osName: "Linux",
      appVersion: "",
    },
    events: parsedEvents,
    metrics: [],
  });
}

function metricRows(
  name: string,
  attributes: Array<Record<string, string>>,
): Array<JSONObject> {
  return ProductAnalyticsEventIngestService.buildMetricRows({
    job: {
      projectId: projectId.toString(),
      rumApplicationId: applicationId.toString(),
      batchId: "e1".repeat(16),
      receivedAtUnixMs: Date.now(),
      countryCode: "US",
      sessionId: "e1".repeat(16),
      visitorId: "",
      identifiedUserKey: "",
      userProperties: {},
      context: {
        deviceType: "desktop",
        browserName: "Chrome",
        osName: "Linux",
        appVersion: "",
      },
      events: [],
      metrics: attributes.map(
        (
          attribute: Record<string, string>,
          index: number,
        ): {
          name: string;
          value: number;
          time: number;
          attributes: Record<string, string>;
        } => {
          return {
            name: name,
            value: index,
            time: Date.now() - 60 * 60 * 1000 + index * 1000,
            attributes: attribute,
          };
        },
      ),
    },
    retentionInDays: 15,
  });
}

// Pages the browser recorder sends now: scrubbed, in their one spelling.
const recorderPages: Array<string> = Array.from(
  new Set(
    ALL_ROWS.map((row: PageSpellingCase): string => {
      return row.page;
    }),
  ),
);

// What a client that did not scrub stored before #8197 and #8385.
const secretPages: Array<string> = [
  ...PAGES_WITH_SECRETS.map((row: PageSpellingCase): string => {
    return storedBeforeTheIngestScrubbed(row.sent);
  }),
  // The email beyond ASCII RedactPersonalDataInProductAnalyticsPages left.
  "/u/j%C3%B6rg@m%C3%BCller.de",
];

// Every address of the shared tables, as a property's value.
const addressValues: Array<string> = ALL_ROWS.flatMap(
  (row: PageSpellingCase): Array<string> => {
    return [addressOf(row), row.sent];
  },
);

integration("ScrubProductAnalyticsAddresses against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: Record<string, unknown> | undefined;

  async function rows<T>(
    query: string,
    queryParams: Record<string, unknown> = {},
  ): Promise<Array<T>> {
    const result: { json: () => Promise<unknown> } = await client.query({
      query: query,
      query_params: queryParams,
      format: "JSONEachRow",
    });

    return (await result.json()) as Array<T>;
  }

  async function createTable(
    modelType: { new (): AnalyticsBaseModel },
    name: string,
  ): Promise<void> {
    const model: AnalyticsBaseModel = new modelType();
    const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: clickhouse,
    }).toColumnsCreateStatement(model.tableColumns);

    const engine: string =
      model.tableEngine === AnalyticsTableEngine.AggregatingMergeTree
        ? "AggregatingMergeTree"
        : "MergeTree";

    await client.command({
      query: `CREATE TABLE ${database}.${name} (${columns.query}) ENGINE = ${engine} PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
      query_params: columns.query_params,
    });
  }

  async function fingerprint(): Promise<Array<string>> {
    const found: Array<string> = [];

    for (const [table, columns] of [
      [
        EVENTS,
        "kind, name, page, toString(properties), toString(userProperties), time",
      ],
      [SESSIONS, "sessionId, entryPage, toString(pages)"],
      [METRICS, "primaryEntityType, name, toString(attributes), time"],
    ] as Array<[string, string]>) {
      const result: Array<{ f: string }> = await rows<{ f: string }>(
        `SELECT toString(count()) || ':' || toString(sum(cityHash64(${columns}))) AS f FROM ${database}.${table}`,
      );

      found.push(`${table} ${result[0]!.f}`);
    }

    return found;
  }

  async function mutationsDone(): Promise<void> {
    const deadline: number = Date.now() + WAIT_LIMIT_MS;

    while (
      Number(
        (
          await rows<{ pending: string | number }>(
            `SELECT count() AS pending FROM system.mutations WHERE database = {database:String} AND NOT is_done`,
            { database: database },
          )
        )[0]?.pending,
      ) > 0
    ) {
      if (Date.now() > deadline) {
        throw new Error("Timed out waiting for the scrubbing to finish");
      }

      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, POLL_INTERVAL_MS);
      });
    }
  }

  async function failedMutations(): Promise<Array<string>> {
    return (
      await rows<{ reason: string }>(
        `SELECT latest_fail_reason AS reason FROM system.mutations WHERE database = {database:String} AND latest_fail_reason != ''`,
        { database: database },
      )
    ).map((row: { reason: string }): string => {
      return row.reason;
    });
  }

  interface EventRow {
    sessionId: string;
    kind: string;
    name: string;
    page: string;
    properties: Record<string, string>;
    userProperties: Record<string, string>;
  }

  async function eventsOf(sessionId: string): Promise<Array<EventRow>> {
    return rows<EventRow>(
      `SELECT sessionId, kind, name, page, properties, userProperties FROM ${database}.${EVENTS} WHERE sessionId = {sessionId:String} ORDER BY time`,
      { sessionId: sessionId },
    );
  }

  let recorderBefore: string;

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
      request_timeout: 120000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    original = {
      database: MetricService.database,
      databaseClient: MetricService.databaseClient,
      migrationDatabase: MetricService.migrationDatabase,
      migrationDatabaseClient: MetricService.migrationDatabaseClient,
    };

    MetricService.database = clickhouse;
    MetricService.databaseClient = client;
    MetricService.migrationDatabase = clickhouse;
    MetricService.migrationDatabaseClient = client;

    await createTable(
      RumProductAnalyticsEvent as unknown as { new (): AnalyticsBaseModel },
      EVENTS,
    );
    await createTable(
      RumProductAnalyticsSession as unknown as { new (): AnalyticsBaseModel },
      SESSIONS,
    );
    await createTable(
      Metric as unknown as { new (): AnalyticsBaseModel },
      METRICS,
    );

    // The events.
    for (const values of [
      eventRows(recorderSession, events(recorderPages, 0)),
      eventRows(secretsSession, events(secretPages, 60 * 60 * 1000)),
      eventRows(
        propertiesSession,
        events(
          addressValues.map((): string => {
            return "/checkout";
          }),
          2 * 60 * 60 * 1000,
          (index: number): Record<string, string> => {
            return {
              url: addressValues[index]!,
              plan: "pro",
              note: "someone said hi",
            };
          },
        ),
        {
          website: "https://shop.example.com/u/someone@example.com?ref=mail",
          plan: "pro",
        },
      ),
    ]) {
      await client.insert({
        table: `${database}.${EVENTS}`,
        values: values,
        format: "JSONEachRow",
      });
    }

    // The sessions: one whose pages hold a token, one that names no one.
    const start: string = OneUptimeDate.toClickhouseDateTime64(
      new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    );

    await client.insert({
      table: `${database}.${SESSIONS}`,
      values: [
        {
          projectId: projectId.toString(),
          rumApplicationId: applicationId.toString(),
          startTime: start,
          sessionId: secretsSession,
          entryPage:
            "/auth/callback/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
          pages: [
            "https://shop.example.com/auth/callback/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl?coupon=[redacted]",
            "https://shop.example.com/#/u/someone%2540example.com",
            "app://com.example.shop/Session/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
            "https://shop.example.com/pricing",
          ],
        },
        {
          projectId: projectId.toString(),
          rumApplicationId: applicationId.toString(),
          startTime: start,
          sessionId: recorderSession,
          entryPage: "/caf%C3%A9",
          pages: [
            "https://shop.example.com/caf%C3%A9",
            "https://shop.example.com/#/orders/[redacted]",
            "https://shop.example.com/x?coupon=[redacted]",
            "app://com.example.shop/Home",
            "null/Home",
          ],
        },
      ],
      format: "JSONEachRow",
    });

    // The metric store: metric() points, OpenTelemetry's, a service's.
    const pagePoints: Array<JSONObject> = metricRows(
      "checkout.duration_ms",
      addressValues
        .slice(0, 20)
        .map((address: string): Record<string, string> => {
          return { page: address, step: "payment" };
        }),
    );
    const otelPoints: Array<JSONObject> = metricRows("http.client.duration", [
      {
        "resource.service.name": "shop-web",
        "http.url": "https://api.example.com/u/someone@example.com?token=abc",
      },
    ]);
    const servicePoints: Array<JSONObject> = metricRows(
      "http.server.duration",
      [
        {
          "http.url": "https://api.example.com/u/someone@example.com?token=abc",
        },
      ],
    ).map((row: JSONObject): JSONObject => {
      return {
        ...row,
        primaryEntityId: serviceId.toString(),
        primaryEntityType: "Service",
      };
    });

    await client.insert({
      table: `${database}.${METRICS}`,
      values: [...pagePoints, ...otelPoints, ...servicePoints],
      format: "JSONEachRow",
    });

    recorderBefore = JSON.stringify(await eventsOf(recorderSession));
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(MetricService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("before it runs, what was stored names people and holds tokens", async () => {
    const stored: string = JSON.stringify([
      await eventsOf(secretsSession),
      await eventsOf(propertiesSession),
    ]);

    expect(stored).toContain("eyJhbGci");
    expect(stored).toContain("someone%2540example.com");
    expect(stored).toContain("token=");
    expect(secretPages.length).toBeGreaterThan(10);
  });

  test("it deletes the page views named by a page the scrubber redacts, and redacts every other event's page", async () => {
    await new ScrubProductAnalyticsAddresses().migrate();
    await mutationsDone();

    expect(await failedMutations()).toEqual([]);

    const stored: Array<EventRow> = await eventsOf(secretsSession);
    const pageViews: Array<string> = stored
      .filter((row: EventRow): boolean => {
        return row.kind === ProductAnalyticsEventKind.Page;
      })
      .map((row: EventRow): string => {
        return row.name;
      });

    // The page views that named no one stay; the others are gone.
    expect(pageViews).toEqual(
      secretPages.filter((page: string): boolean => {
        return toProductAnalyticsPage(page) === page;
      }),
    );
    expect(pageViews.length).toBeLessThan(secretPages.length);

    // Every session start and order stays, on the page stored now.
    for (const kind of [
      ProductAnalyticsEventKind.Session,
      ProductAnalyticsEventKind.Custom,
    ]) {
      expect(
        stored
          .filter((row: EventRow): boolean => {
            return row.kind === kind;
          })
          .map((row: EventRow): string => {
            return row.page;
          }),
      ).toEqual(
        secretPages.map((page: string): string => {
          return toProductAnalyticsPage(page);
        }),
      );
    }

    const text: string = JSON.stringify(stored);

    for (const personal of PERSONAL_DATA) {
      expect([personal, text.includes(personal)]).toEqual([personal, false]);
    }
  });

  test("every page the recorder sends now is untouched", async () => {
    expect(JSON.stringify(await eventsOf(recorderSession))).toBe(
      recorderBefore,
    );
  });

  test("an address-valued property or user property is scrubbed as the ingest scrubs it now, and words are kept", async () => {
    const stored: Array<EventRow> = await eventsOf(propertiesSession);
    const orders: Array<EventRow> = stored.filter((row: EventRow): boolean => {
      return row.kind === ProductAnalyticsEventKind.Custom;
    });

    expect(orders).toHaveLength(addressValues.length);

    orders.forEach((row: EventRow, index: number): void => {
      const sent: string = addressValues[index]!;
      const now: string = toProductAnalyticsPropertyValue(sent, VALUE_LIMIT);

      // What it wrote is what the ingest writes now, once scrubbed again.
      expect([
        sent,
        toProductAnalyticsPropertyValue(row.properties["url"]!, VALUE_LIMIT),
      ]).toEqual([sent, now]);
      // The application's own words are kept as they were.
      expect(row.properties["plan"]).toBe("pro");
      expect(row.properties["note"]).toBe("someone said hi");
      expect(row.userProperties).toEqual({
        website: "https://shop.example.com/u/[redacted]",
        plan: "pro",
      });

      for (const personal of PERSONAL_DATA) {
        if (!now.includes(personal)) {
          expect([
            sent,
            personal,
            row.properties["url"]!.includes(personal),
          ]).toEqual([sent, personal, false]);
        }
      }
    });
  });

  test("a session's entry page and pages are redacted, and a session that names no one is untouched", async () => {
    const sessions: Array<{
      sessionId: string;
      entryPage: string;
      pages: Array<string>;
    }> = await rows(
      `SELECT sessionId, entryPage, arraySort(pages) AS pages FROM ${database}.${SESSIONS} ORDER BY sessionId`,
    );

    // A session's pages are a set: compared in order.
    expect(sessions).toEqual([
      {
        sessionId: secretsSession,
        entryPage: "/auth/callback/[redacted]",
        pages: [
          "app://com.example.shop/Session/[redacted]",
          "https://shop.example.com/#/u/[redacted]",
          "https://shop.example.com/auth/callback/[redacted]",
          "https://shop.example.com/pricing",
        ],
      },
      {
        sessionId: recorderSession,
        entryPage: "/caf%C3%A9",
        pages: [
          "app://com.example.shop/Home",
          "https://shop.example.com/#/orders/[redacted]",
          "https://shop.example.com/caf%C3%A9",
          "https://shop.example.com/x?coupon=[redacted]",
          "null/Home",
        ],
      },
    ]);
  });

  test("a RUM application's metric() attributes are scrubbed; its OpenTelemetry metrics and a service's are left as sent", async () => {
    const points: Array<{
      name: string;
      primaryEntityType: string;
      attributes: Record<string, string>;
    }> = await rows(
      `SELECT name, primaryEntityType, attributes FROM ${database}.${METRICS} ORDER BY name, time`,
    );

    const page: Array<Record<string, string>> = points
      .filter((point: { name: string }): boolean => {
        return point.name === "checkout.duration_ms";
      })
      .map(
        (point: {
          attributes: Record<string, string>;
        }): Record<string, string> => {
          return point.attributes;
        },
      );

    expect(page).toHaveLength(20);

    page.forEach((attributes: Record<string, string>, index: number): void => {
      const sent: string = addressValues[index]!;

      expect(attributes["step"]).toBe("payment");
      expect([
        sent,
        toProductAnalyticsPropertyValue(attributes["page"]!, VALUE_LIMIT),
      ]).toEqual([sent, toProductAnalyticsPropertyValue(sent, VALUE_LIMIT)]);
    });

    for (const name of ["http.client.duration", "http.server.duration"]) {
      const point: { attributes: Record<string, string> } | undefined =
        points.find((candidate: { name: string }): boolean => {
          return candidate.name === name;
        });

      expect(point!.attributes["http.url"]).toBe(
        "https://api.example.com/u/someone@example.com?token=abc",
      );
    }
  });

  test("running it again changes nothing", async () => {
    const before: Array<string> = await fingerprint();

    await new ScrubProductAnalyticsAddresses().migrate();
    await mutationsDone();

    expect(await failedMutations()).toEqual([]);
    expect(await fingerprint()).toEqual(before);
  });

  /*
   * The rule in SQL against the scrubber, segment by segment. Never more: a
   * segment SQL takes for an identifier that the scrubber keeps is one a
   * recorder sends, and its page view would be deleted. And the same on
   * every segment that holds no character beyond U+FFFF and no space RE2
   * does not know, at the lengths these are.
   */
  test("never takes for an identifier a segment the scrubber keeps, and agrees with it, over thousands of segments", async () => {
    const random: SeededRandom = seededRandom(83850);
    const alphabet: Array<string> = [
      ..."abcdefxyzJABCDEF0123456789",
      "eyJ",
      "eyJhbGciOiJ",
      "@",
      ".",
      "-",
      "_",
      "+",
      "%",
      "%40",
      "%2540",
      "%2E",
      "%252E",
      "%25",
      "%2525",
      "%zz",
      "%4",
      "%C3%A9",
      "%E9",
      "%C0%AF",
      "é",
      "ö",
      "ü",
      "😀",
      " ",
      "\u00a0",
      "\u3000",
      "\t",
      "[",
      "~",
      "!",
      ":",
      // #8489: standard base64's characters, plain and escaped.
      "+",
      "=",
      "==",
      "%2B",
      "%3D",
      "%2F",
      "%252B",
      "k3J+vT9mL4pR7sW1yB6n",
    ];
    const segments: Array<string> = [
      "someone@example.com",
      "someone%40example.com",
      "someone%2540example.com",
      "someone%252540example.com",
      "First.Last%252Bnews%2540Example.co.uk",
      "jörg@müller.de",
      "j%C3%B6rg@m%C3%BCller.de",
      "j%25C3%25B6rg%2540m%25C3%25BCller.de",
      "a b@example.com",
      "a\u00a0b@example.com",
      `${"a".repeat(64)}@example.com`,
      `${"a".repeat(65)}@example.com`,
      `${"ö".repeat(64)}@example.com`,
      `${"ö".repeat(65)}@example.com`,
      `${"😀".repeat(20)}@example.com`,
      "3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f",
      "%2533f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f",
      "5f8d0d55b54764421b7156c9",
      "123456789",
      "12345678",
      "a".repeat(32),
      "a".repeat(31),
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
      "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.",
      "eyJhbGciOiJIUzI1NiJ9%252EeyJzdWIiOiIxIn0%252Esig",
      "eyJabcdefg.h",
      "eyJabcdefgh.i",
      "eyJhbGciOiJIUzI1NiJ9.a.b.c.d.e",
      "report-2026-11-15.pdf",
      "dGhpcyBpcyBhIHNlY3JldCB0b2tlbiBmb3IgdGVzdGluZw==",
      "dGhpcyBpcyBhIHNlY3JldCB0b2tlbiBmb3IgdGVzdGluZw===",
      "k3J+vT9mL4pR7sW1yB6nC3dF5gH0jKq2Zx8",
      "k3J%2BvT9mL4pR7sW1yB6nC3dF5gH0jK%2Fq2Zx8%3D%3D",
      `${"a+".repeat(15)}a==`,
      `${"a+".repeat(16)}`,
      "c++",
      "size=large",
      "[redacted]",
      "a%40b.c%zz",
      "%25zz%40b.co",
      "x%E9@b.co",
      "x%E9y%40b.co",
      "50%2525-off",
    ];

    for (const row of [...PAGES_WITH_PERSONAL_DATA, ...PAGES_WITH_SECRETS]) {
      segments.push(...row.sent.split(/[?#]/)[0]!.split("/").filter(Boolean));
    }

    for (let index: number = 0; index < 5000; index++) {
      const length: number = 1 + random(index % 5 === 0 ? 30 : 12);
      let segment: string = "";

      for (let part: number = 0; part < length; part++) {
        segment += alphabet[random(alphabet.length)];
      }

      // Some shaped as an email, some as a token.
      if (index % 3 === 0) {
        segment = `${segment}@${Array.from(segment)
          .slice(0, 1 + random(12))
          .join("")}.${"co".repeat(1 + random(3))}`;
      } else if (index % 3 === 1) {
        segment = `eyJ${segment}.${segment}${index % 2 === 0 ? `.${segment}` : ""}`;
      }

      segments.push(segment);
    }

    await client.command({
      query: `CREATE TABLE ${database}.segments (position UInt32, segment String) ENGINE = MergeTree ORDER BY position`,
    });
    await client.insert({
      table: `${database}.segments`,
      values: segments.map((segment: string, position: number) => {
        return { position: position, segment: segment };
      }),
      format: "JSONEachRow",
    });

    const sql: Array<{ segment: string; redacted: number }> = await rows<{
      segment: string;
      redacted: number;
    }>(
      `SELECT segment, toUInt8(${isIdentifierSegmentSql("segment")}) AS redacted FROM ${database}.segments ORDER BY position`,
    );

    expect(
      sql.map((row: { segment: string }): string => {
        return row.segment;
      }),
    ).toEqual(segments);

    let taken: number = 0;
    let compared: number = 0;

    for (const row of sql) {
      // Whether the scrubber redacts it ("[redacted]" itself it keeps).
      const scrubber: boolean =
        UrlScrubber.scrubPath(`/${row.segment}`) !==
        UrlScrubber.normalizePathSpelling(`/${row.segment}`);
      const redacted: boolean = Number(row.redacted) === 1;

      if (redacted) {
        taken++;
        expect([row.segment, scrubber]).toEqual([row.segment, true]);
      }

      const beyondBmp: boolean = Array.from(row.segment).some(
        (character: string): boolean => {
          return character.length > 1;
        },
      );

      /*
       * A segment whose escapes the scrubber cannot decode it reads as
       * written in its one spelling, each letter beyond ASCII escaped; SQL
       * does not take such a segment with a letter beyond ASCII at all.
       */
      let readAsWritten: boolean = false;

      try {
        decodeURIComponent(
          UrlScrubber.normalizePathSpelling(`/${row.segment}`),
        );
      } catch {
        readAsWritten = Array.from(row.segment).some(
          (character: string): boolean => {
            return character.charCodeAt(0) > 0x7f;
          },
        );
      }

      if (
        !beyondBmp &&
        !readAsWritten &&
        !JAVASCRIPT_ONLY_SPACE.test(row.segment) &&
        row.segment.length <= 60
      ) {
        compared++;
        expect([row.segment, redacted]).toEqual([row.segment, scrubber]);
      }
    }

    // The sweep reaches both sides of the rule.
    expect(taken).toBeGreaterThan(500);
    expect(sql.length - taken).toBeGreaterThan(500);
    expect(compared).toBeGreaterThan(2000);
  });

  /*
   * A property's value against toProductAnalyticsPropertyValue. What SQL
   * writes is what the ingest writes now once scrubbed again - it spells an
   * address as it was written, where the URL parser lower-cases a host or
   * adds a scheme - and it never keeps what the ingest takes out, nor
   * changes a value the ingest keeps.
   */
  test("scrubs a property's value as the ingest does, over thousands of values", async () => {
    const random: SeededRandom = seededRandom(83860);
    const segments: Array<string> = [
      "orders",
      "42",
      "café",
      "caf%C3%A9",
      "someone@example.com",
      "someone%40example.com",
      "someone%2540example.com",
      "3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f",
      "5f8d0d55b54764421b7156c9",
      "4111111111111111",
      "Zx8_kQ2-vT9mL4pR7sW1yB6nC3dF5gH0jK",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
      "[redacted]",
      "a%2Fb",
      "%zz",
      "report-2026-11-15.pdf",
    ];
    const tails: Array<string> = [
      "",
      "?token=abc",
      "?email=someone%40example.com",
      "#plans",
      "#access_token=abc",
      "#/u/someone@example.com?tab=1",
      "#!/orders/42",
      "?x=1#/cart",
    ];
    const heads: Array<string> = [
      "https://shop.example.com",
      "http://shop.example.com:8080",
      "HTTPS://Shop.Example.com",
      "https://user:secret@shop.example.com",
      "//cdn.example.com",
      "",
    ];
    const values: Array<string> = [
      ...addressValues,
      "plain words",
      "pro",
      "someone@example.com",
      "a /b",
      " /orders/someone@example.com?x=1 ",
      "\t/u/someone@example.com\n",
      "/u/someone@example.com\u00a0",
      "https://shop.example.com",
      "ftp://files.example.com/u/someone@example.com",
      "mailto:someone@example.com",
      "",
    ];

    for (let index: number = 0; index < 3000; index++) {
      let value: string = heads[random(heads.length)]!;
      const count: number = random(5);

      for (let part: number = 0; part < count; part++) {
        value += `/${segments[random(segments.length)]}`;
      }

      if (!value) {
        value = "/";
      }

      values.push(value + tails[random(tails.length)]);
    }

    await client.command({
      query: `CREATE TABLE ${database}.property_values (position UInt32, value String) ENGINE = MergeTree ORDER BY position`,
    });
    await client.insert({
      table: `${database}.property_values`,
      values: values.map((value: string, position: number) => {
        return { position: position, value: value };
      }),
      format: "JSONEachRow",
    });

    const sql: Array<{ value: string; scrubbed: string }> = await rows<{
      value: string;
      scrubbed: string;
    }>(
      `SELECT value, ${scrubbedPropertyValueSql("value")} AS scrubbed FROM ${database}.property_values ORDER BY position`,
    );

    expect(sql).toHaveLength(values.length);

    let changed: number = 0;

    for (const row of sql) {
      const ingest: string = toProductAnalyticsPropertyValue(
        row.value,
        VALUE_LIMIT,
      );

      if (JAVASCRIPT_ONLY_SPACE.test(row.value)) {
        // Left as it is: RE2 does not know the space JavaScript trims.
        expect(row.scrubbed).toBe(row.value);
        continue;
      }

      expect([
        row.value,
        toProductAnalyticsPropertyValue(row.scrubbed, VALUE_LIMIT),
      ]).toEqual([row.value, ingest]);

      for (const personal of PERSONAL_DATA) {
        if (!ingest.includes(personal)) {
          expect([
            row.value,
            personal,
            row.scrubbed.includes(personal),
          ]).toEqual([row.value, personal, false]);
        }
      }

      if (row.scrubbed !== row.value) {
        changed++;
        expect([row.value, ingest === row.value]).toEqual([row.value, false]);
      }
    }

    expect(changed).toBeGreaterThan(1000);
  });
});

describe("ScrubProductAnalyticsAddresses ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
