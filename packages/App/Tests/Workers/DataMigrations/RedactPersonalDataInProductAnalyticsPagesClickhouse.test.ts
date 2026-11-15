import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumProductAnalyticsEvent from "Common/Models/AnalyticsModels/RumProductAnalyticsEvent";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ProductAnalyticsEventKind,
  ProductAnalyticsParsedEvent,
  toProductAnalyticsPage,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import {
  PAGES_WITH_PERSONAL_DATA,
  PAGE_SPELLINGS,
  PageSpellingCase,
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
 * RedactPersonalDataInProductAnalyticsPages against a real ClickHouse
 * (#8197).
 *
 * The unit suite pins the statements. This one shows what they do to the
 * product analytics events an install already has - a table built from the
 * model's own columns and keys, with rows the ingest worker's own row
 * builder made:
 *
 *   - the page views a client stored with an email, a uuid, an id or a
 *     token in their page are gone, and every other event stays, its page
 *     redacted to the page the ingest stores now;
 *   - every row the browser recorder sent, scrubbed, is untouched, in each
 *     spelling it was stored in, as is a page whose escape is cut short;
 *   - running it again changes nothing;
 *   - the rule in SQL never takes for an identifier a segment the scrubber
 *     keeps, over thousands of segments, and takes the same ones in ASCII.
 *
 * The CI server is a single node without a cluster, so ON CLUSTER is left
 * out of the statements and the table is a plain MergeTree under the local
 * table's name - the statements are otherwise the migration's own. The App
 * Test workflow provides the server; the guard at the bottom fails the run
 * there if it ever goes missing. Locally:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/DataMigrations/RedactPersonalDataInProductAnalyticsPagesClickhouse.test.ts
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
import RedactPersonalDataInProductAnalyticsPages, {
  DECODED_SEGMENT_SQL,
  PAGE_SEGMENT_IDENTIFIER_PATTERN,
} from "../../../FeatureSet/Workers/DataMigrations/RedactPersonalDataInProductAnalyticsPages";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `redact_pa_pages_test_${process.pid}_${Date.now()}`;
const STORAGE_TABLE: string =
  RedactPersonalDataInProductAnalyticsPages.getStorageTable();

const projectId: ObjectID = new ObjectID("6600000000000000000000e1");
const applicationId: ObjectID = new ObjectID("6600000000000000000000e2");

const recorderSession: string = "a1".repeat(16);
const storedBeforeSession: string = "b1".repeat(16);
const cutShortSession: string = "c1".repeat(16);

const POLL_INTERVAL_MS: number = 250;
const WAIT_LIMIT_MS: number = 120000;

// A page with an email whose letters are beyond ASCII: left for the reads.
const BEYOND_ASCII_EMAIL_PAGE: string = "/u/j%C3%B6rg@m%C3%BCller.de";

// The page the ingest kept before it scrubbed: no query, no fragment.
function storedBeforeTheIngestScrubbed(sent: string): string {
  const path: string = sent.split(/[?#]/)[0] || "/";

  return UrlScrubber.normalizePathSpelling(
    path.startsWith("/") ? path : `/${path}`,
  );
}

function events(
  pages: Array<string>,
  dayOffsetMs: number,
): Array<ProductAnalyticsParsedEvent> {
  const start: number = Date.now() - 10 * 24 * 60 * 60 * 1000 + dayOffsetMs;

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
          properties: { plan: "pro" },
        },
      ];
    },
  );
}

function rowsOf(
  sessionId: string,
  parsedEvents: Array<ProductAnalyticsParsedEvent>,
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
    userProperties: {},
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

// Pages the browser recorder sent, scrubbed, in every spelling it had.
const recorderPages: Array<string> = Array.from(
  new Set(
    [...PAGE_SPELLINGS, ...PAGES_WITH_PERSONAL_DATA].flatMap(
      (row: PageSpellingCase): Array<string> => {
        return [row.page, storedBeforeTheIngestScrubbed(row.sent)];
      },
    ),
  ),
).filter((page: string): boolean => {
  // A recorder sends a page the scrubber redacts nothing of.
  return (
    UrlScrubber.scrubPath(page) === UrlScrubber.normalizePathSpelling(page)
  );
});

// What a client that did not scrub had stored, before the ingest scrubbed.
const storedBeforePages: Array<string> = PAGES_WITH_PERSONAL_DATA.map(
  (row: PageSpellingCase): string => {
    return storedBeforeTheIngestScrubbed(row.sent);
  },
);

// Escapes cut short: the scrubber reads these as written, and keeps them.
const cutShortPages: Array<string> = ["/a%40b.c%zz", "/u/x%40y.co%4"];

integration(
  "RedactPersonalDataInProductAnalyticsPages against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original: Record<string, unknown> | undefined;

    interface StoredRow {
      sessionId: string;
      kind: string;
      name: string;
      page: string;
    }

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

    async function storedRows(sessionId: string): Promise<Array<StoredRow>> {
      return rows<StoredRow>(
        `SELECT sessionId, kind, name, page FROM ${database}.${STORAGE_TABLE} WHERE sessionId = {sessionId:String} ORDER BY time`,
        { sessionId: sessionId },
      );
    }

    async function fingerprint(sessionId?: string): Promise<string> {
      const result: Array<{ f: string }> = await rows<{ f: string }>(
        `SELECT toString(count()) || ':' || toString(sum(cityHash64(kind, name, page, toString(properties), time))) AS f FROM ${database}.${STORAGE_TABLE}${sessionId ? " WHERE sessionId = {sessionId:String}" : ""}`,
        sessionId ? { sessionId: sessionId } : {},
      );

      return result[0]!.f;
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
          throw new Error("Timed out waiting for the redaction to finish");
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

    let recorderBefore: string;
    let cutShortBefore: string;

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

      // connect() creates the database it is pointed at.
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

      const model: AnalyticsBaseModel = new RumProductAnalyticsEvent();
      const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
        modelType: RumProductAnalyticsEvent as unknown as {
          new (): AnalyticsBaseModel;
        },
        database: clickhouse,
      }).toColumnsCreateStatement(model.tableColumns);

      await client.command({
        query: `CREATE TABLE ${database}.${STORAGE_TABLE} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")}) SETTINGS ${model.tableSettings}`,
        query_params: columns.query_params,
      });

      for (const [sessionId, pages, offset] of [
        [recorderSession, recorderPages, 0],
        [storedBeforeSession, storedBeforePages, 60 * 60 * 1000],
        [cutShortSession, cutShortPages, 2 * 60 * 60 * 1000],
      ] as Array<[string, Array<string>, number]>) {
        await client.insert({
          table: `${database}.${STORAGE_TABLE}`,
          values: rowsOf(sessionId, events(pages, offset)),
          format: "JSONEachRow",
        });
      }

      recorderBefore = await fingerprint(recorderSession);
      cutShortBefore = await fingerprint(cutShortSession);
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

    test("before it runs, a client's pages name people", async () => {
      const stored: Array<StoredRow> = await storedRows(storedBeforeSession);

      expect(stored).toHaveLength(storedBeforePages.length * 3);
      expect(
        stored.some((row: StoredRow): boolean => {
          return row.name === "/users/someone@example.com/orders";
        }),
      ).toBe(true);
      expect(recorderPages.length).toBeGreaterThan(20);
    });

    test("it deletes the page views named by a page with an identifier, and redacts every other event's page", async () => {
      await new RedactPersonalDataInProductAnalyticsPages().migrate();
      await mutationsDone();

      expect(await failedMutations()).toEqual([]);

      const stored: Array<StoredRow> = await storedRows(storedBeforeSession);
      const pageViews: Array<string> = stored
        .filter((row: StoredRow): boolean => {
          return row.kind === ProductAnalyticsEventKind.Page;
        })
        .map((row: StoredRow): string => {
          return row.name;
        });

      // The page views that named no one stay, and the one beyond ASCII.
      expect(pageViews).toEqual(
        storedBeforePages.filter((page: string): boolean => {
          return (
            toProductAnalyticsPage(page) === page ||
            page === BEYOND_ASCII_EMAIL_PAGE
          );
        }),
      );
      expect(pageViews).toContain(BEYOND_ASCII_EMAIL_PAGE);

      // Every session start and order stays, on the page stored now.
      for (const kind of [
        ProductAnalyticsEventKind.Session,
        ProductAnalyticsEventKind.Custom,
      ]) {
        expect(
          stored
            .filter((row: StoredRow): boolean => {
              return row.kind === kind;
            })
            .map((row: StoredRow): string => {
              return row.page;
            }),
        ).toEqual(
          PAGES_WITH_PERSONAL_DATA.map((row: PageSpellingCase): string => {
            const before: string = storedBeforeTheIngestScrubbed(row.sent);

            return before === BEYOND_ASCII_EMAIL_PAGE ? before : row.page;
          }),
        );
      }

      // The reads name every row as the ingest stores it now.
      for (const row of stored) {
        expect(toProductAnalyticsPage(row.page)).not.toContain("someone");
        expect(toProductAnalyticsPage(row.name)).not.toContain("@");
      }
    });

    test("it leaves what the recorder sent, in every spelling, and a page whose escape is cut short", async () => {
      expect(await fingerprint(recorderSession)).toBe(recorderBefore);
      expect(await fingerprint(cutShortSession)).toBe(cutShortBefore);
      expect(
        (await storedRows(cutShortSession)).filter(
          (row: StoredRow): boolean => {
            return row.kind === ProductAnalyticsEventKind.Page;
          },
        ),
      ).toHaveLength(cutShortPages.length);
    });

    test("run again, it changes nothing", async () => {
      const before: string = await fingerprint();

      await new RedactPersonalDataInProductAnalyticsPages().migrate();
      await mutationsDone();

      expect(await failedMutations()).toEqual([]);
      expect(await fingerprint()).toBe(before);
    });

    /*
     * The rule in SQL against the scrubber, segment by segment. Never more:
     * a segment SQL takes for an identifier that the scrubber keeps is one
     * the recorder sends, and its page view would be deleted. And the same
     * on every segment in printable ASCII without an escape.
     */
    test("never takes for an identifier a segment the scrubber keeps, over thousands of segments", async () => {
      const random: SeededRandom = seededRandom(81970);
      const alphabet: Array<string> = [
        ..."abcdefxyzABCDEF0123456789",
        "@",
        ".",
        "-",
        "_",
        "+",
        "%",
        "%40",
        "%2E",
        "%2e",
        "%zz",
        "%4",
        "%C3%A9",
        "%E9",
        "é",
        "ö",
        "😀",
        " ",
        " ",
        "[",
        "]",
        "~",
        "!",
        ":",
      ];
      const segments: Array<string> = [
        "someone@example.com",
        "someone%40example.com",
        "First.Last+news%40Example.co.uk",
        "jörg@müller.de",
        "j%C3%B6rg@m%C3%BCller.de",
        "a b@example.com",
        `${"a".repeat(64)}@example.com`,
        `${"a".repeat(65)}@example.com`,
        `${"😀".repeat(40)}@example.com`,
        "3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f",
        "%33f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f",
        "5f8d0d55b54764421b7156c9",
        "123456789",
        "12345678",
        "a".repeat(32),
        "a".repeat(31),
        "[redacted]",
        "a%40b.c%zz",
        "x%E9@b.co",
        "x%E9y%40b.co",
      ];

      for (let index: number = 0; index < 4000; index++) {
        const length: number = 1 + random(index % 5 === 0 ? 70 : 24);
        let segment: string = "";

        for (let part: number = 0; part < length; part++) {
          segment += alphabet[random(alphabet.length)];
        }

        // Some shaped as an email, at the lengths the rule allows and past.
        if (index % 3 === 0) {
          // Cut by characters, so an emoji is never cut in two.
          const domain: string = Array.from(segment)
            .slice(0, 1 + random(20))
            .join("");

          segment = `${segment}@${domain}.${"co".repeat(1 + random(3))}`;
        }

        segments.push(segment);
      }

      // Too many for a query parameter: they are read from a table.
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
        `SELECT segment, toUInt8(match(${DECODED_SEGMENT_SQL}, '${PAGE_SEGMENT_IDENTIFIER_PATTERN}')) AS redacted FROM ${database}.segments ORDER BY position`,
      );

      expect(
        sql.map((row: { segment: string }): string => {
          return row.segment;
        }),
      ).toEqual(segments);

      expect(sql).toHaveLength(segments.length);

      const PLAIN_ASCII: RegExp = /^[!-$&-.0-~]+$/;
      let taken: number = 0;

      for (const row of sql) {
        // Whether the scrubber redacts it ("[redacted]" itself it keeps).
        const scrubber: boolean =
          UrlScrubber.scrubPath(`/${row.segment}`) !==
          UrlScrubber.normalizePathSpelling(`/${row.segment}`);

        if (Number(row.redacted) === 1) {
          taken++;
          expect([row.segment, scrubber]).toEqual([row.segment, true]);
        }

        if (PLAIN_ASCII.test(row.segment)) {
          expect([row.segment, Number(row.redacted) === 1]).toEqual([
            row.segment,
            scrubber,
          ]);
        }
      }

      // The sweep reaches both sides of the rule.
      expect(taken).toBeGreaterThan(200);
      expect(sql.length - taken).toBeGreaterThan(200);
    });
  },
);

describe("RedactPersonalDataInProductAnalyticsPages ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
