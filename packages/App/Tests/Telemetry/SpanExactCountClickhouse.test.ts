import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import PositiveNumber from "Common/Types/PositiveNumber";
import TimeoutException from "Common/Types/Exception/TimeoutException";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import Query from "Common/Server/Types/AnalyticsDatabase/Query";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * The traces explorer's exact span count against a real ClickHouse server
 * (issue #4202).
 *
 * The explorer prints "712,345 spans" above its list and numbers its pages
 * by it, so the count has to be the number of rows the list pages through:
 * SpanService.countBy with `exact` must count what SpanService.findBy
 * returns for the same query, or fail. The unit suites pin the statements
 * the service builds. What they cannot show is what those statements
 * COUNT, so this suite builds a table from the real Span model — its
 * columns, skip indexes and aggregate projections, so the cheap count's
 * proj_hist_by_minute shortcut is really there to be taken — and shows:
 *
 *   1. at window edges that are not minute-aligned, the exact count is the
 *      list's row count, while the projection-shaped default count rounds
 *      the window out to whole minutes and counts more;
 *   2. the same holds under every filter the explorer's list sends;
 *   3. a span past its retention date but not yet dropped is in the
 *      default count and in neither the list nor the exact count;
 *   4. a query ClickHouse stops at its time limit is recognised as a
 *      timeout, and an exact count that runs out of time is refused with
 *      the TimeoutException the API answers 408 with — never a partial
 *      count, never 0;
 *   5. the exact count statement runs on a real server as built.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/SpanExactCountClickhouse.test.ts
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

import SpanService from "Common/Server/Services/SpanService";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `span_exact_count_test_${process.pid}_${Date.now()}`;

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

// The project the explorer is looking at.
const projectId: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000001",
);
// Another project's spans in the same window, which nothing may count.
const otherProjectId: ObjectID = new ObjectID(
  "c2000000-0000-4000-8000-000000000002",
);
// A project whose window holds spans past their retention date.
const retentionProjectId: ObjectID = new ObjectID(
  "c3000000-0000-4000-8000-000000000003",
);

const checkoutServiceId: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000001",
);
const paymentServiceId: ObjectID = new ObjectID(
  "d2000000-0000-4000-8000-000000000002",
);
// Primary-keyed on a host, as agent-ingested spans are.
const gatewayHostId: ObjectID = new ObjectID(
  "d3000000-0000-4000-8000-000000000003",
);

const SERVICE_IDS: Array<ObjectID> = [
  checkoutServiceId,
  paymentServiceId,
  gatewayHostId,
];

// The span names a substring search has to tell apart.
const SPAN_NAMES: Array<string> = [
  "SELECT dbo.F5742013",
  "GET /api/orders",
  "POST /api/checkout",
];

/*
 * A minute boundary two hours back, and a window cut 30 seconds into the
 * minutes either side of it: the explorer's windows are "now minus an hour"
 * and drag-zooms, neither of which lands on a minute.
 */
const MINUTE_START: number =
  Math.floor((Date.now() - 2 * 60 * MINUTE) / MINUTE) * MINUTE;
const WINDOW_START: Date = new Date(MINUTE_START + 30 * SECOND);
const WINDOW_END: Date = new Date(MINUTE_START + 5 * MINUTE + 30 * SECOND);

// Minute-aligned, half an hour before the other one, for the retention case.
const RETENTION_WINDOW_START: Date = new Date(MINUTE_START - 30 * MINUTE);
const RETENTION_WINDOW_END: Date = new Date(MINUTE_START - 20 * MINUTE);

const liveRetentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

// Past its retention: TTL may drop it at any merge, and until then it is on disk.
const expiredRetentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), -3),
).substring(0, 10);

interface SpanFixture {
  projectId: ObjectID;
  serviceId: ObjectID;
  startMs: number;
  name: string;
  statusCode: SpanStatus;
  isRootSpan: boolean;
  httpMethod: string;
  isExpired?: boolean | undefined;
}

let spanCounter: number = 0;

function spanAt(
  startMs: number,
  overrides: Partial<SpanFixture> = {},
): SpanFixture {
  const index: number = spanCounter++;

  return {
    projectId: projectId,
    serviceId: SERVICE_IDS[index % SERVICE_IDS.length]!,
    startMs: startMs,
    name: SPAN_NAMES[Math.floor(index / 2) % SPAN_NAMES.length]!,
    statusCode: [
      SpanStatus.Unset,
      SpanStatus.Unset,
      SpanStatus.Ok,
      SpanStatus.Error,
    ][index % 4]!,
    isRootSpan: index % 5 === 0,
    httpMethod: index % 2 === 0 ? "GET" : "POST",
    ...overrides,
  };
}

// In the start minute, before the window opens: a minute-rounded count's.
const BEFORE_START_SAME_MINUTE: Array<SpanFixture> = [
  spanAt(MINUTE_START + 10 * SECOND),
  spanAt(MINUTE_START + 20 * SECOND),
  spanAt(WINDOW_START.getTime() - 1),
];

// The window's own bounds, which the list includes.
const AT_START: SpanFixture = spanAt(WINDOW_START.getTime());
const AT_END: SpanFixture = spanAt(WINDOW_END.getTime());

const INSIDE: Array<SpanFixture> = Array.from(
  { length: 24 },
  (_: unknown, index: number): SpanFixture => {
    return spanAt(WINDOW_START.getTime() + SECOND + index * 12_300);
  },
);

// In the end minute, after the window closes: a minute-rounded count's.
const AFTER_END_SAME_MINUTE: Array<SpanFixture> = [
  spanAt(WINDOW_END.getTime() + 1),
  spanAt(MINUTE_START + 5 * MINUTE + 45 * SECOND),
  spanAt(MINUTE_START + 6 * MINUTE - 1),
];

// Nowhere near the window.
const OUTSIDE: Array<SpanFixture> = [
  spanAt(MINUTE_START - 2 * MINUTE),
  spanAt(MINUTE_START + 7 * MINUTE),
];

// Inside the window, but another project's.
const OTHER_PROJECT: Array<SpanFixture> = Array.from(
  { length: 4 },
  (_: unknown, index: number): SpanFixture => {
    return spanAt(WINDOW_START.getTime() + (index + 1) * MINUTE, {
      projectId: otherProjectId,
    });
  },
);

const RETENTION_LIVE: Array<SpanFixture> = Array.from(
  { length: 5 },
  (_: unknown, index: number): SpanFixture => {
    return spanAt(RETENTION_WINDOW_START.getTime() + (index + 1) * MINUTE, {
      projectId: retentionProjectId,
    });
  },
);

const RETENTION_EXPIRED: Array<SpanFixture> = Array.from(
  { length: 3 },
  (_: unknown, index: number): SpanFixture => {
    return spanAt(
      RETENTION_WINDOW_START.getTime() + (index + 1) * MINUTE + 30 * SECOND,
      { projectId: retentionProjectId, isExpired: true },
    );
  },
);

const ALL_SPANS: Array<SpanFixture> = [
  ...BEFORE_START_SAME_MINUTE,
  AT_START,
  ...INSIDE,
  AT_END,
  ...AFTER_END_SAME_MINUTE,
  ...OUTSIDE,
  ...OTHER_PROJECT,
  ...RETENTION_LIVE,
  ...RETENTION_EXPIRED,
];

function spanRow(span: SpanFixture, index: number): JSONObject {
  const start: Date = new Date(span.startMs);
  const durationNs: number = 42 * 1_000_000;
  const startNs: string = String(BigInt(span.startMs) * BigInt(1_000_000));

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: span.projectId.toString(),
    primaryEntityId: span.serviceId.toString(),
    primaryEntityType: "Service",
    startTime: OneUptimeDate.toClickhouseDateTime64(start),
    endTime: OneUptimeDate.toClickhouseDateTime64(start),
    startTimeUnixNano: startNs,
    endTimeUnixNano: String(BigInt(startNs) + BigInt(durationNs)),
    durationUnixNano: String(durationNs),
    traceId: `trace-${index}`,
    spanId: `span-${index}`,
    parentSpanId: span.isRootSpan ? "" : `parent-${index}`,
    attributes: { "http.method": span.httpMethod },
    attributeKeys: ["http.method"],
    entityKeys: [],
    statusCode: span.statusCode,
    name: span.name,
    kind: "SPAN_KIND_SERVER",
    isRootSpan: span.isRootSpan,
    retentionDate: span.isExpired ? expiredRetentionDate : liveRetentionDate,
  };
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new Span();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: Span as unknown as { new (): AnalyticsBaseModel },
      database: clickhouse,
    });

  // Columns, then the model's skip indexes and aggregate projections.
  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

const ROOT: { isRoot: true } = { isRoot: true };

// The traces explorer's list query: its project, its window, its filters.
function windowQuery(
  filters: Record<string, unknown> = {},
  window: { projectId: ObjectID; start: Date; end: Date } = {
    projectId: projectId,
    start: WINDOW_START,
    end: WINDOW_END,
  },
): Query<Span> {
  return {
    projectId: window.projectId,
    startTime: new InBetween<Date>(window.start, window.end),
    ...filters,
  } as Query<Span>;
}

async function exactCount(query: Query<Span>): Promise<number> {
  const count: PositiveNumber = await SpanService.countBy({
    query: query,
    props: ROOT,
    exact: true,
  });

  return count.toNumber();
}

async function defaultCount(query: Query<Span>): Promise<number> {
  const count: PositiveNumber = await SpanService.countBy({
    query: query,
    props: ROOT,
  });

  return count.toNumber();
}

// Every row the list would page through, as the explorer asks for a page.
async function listedSpanIds(query: Query<Span>): Promise<Array<string>> {
  const spans: Array<Span> = await SpanService.findBy({
    query: query,
    select: { spanId: true },
    sort: { startTime: SortOrder.Descending },
    skip: 0,
    limit: 1000,
    props: ROOT,
  });

  return spans.map((span: Span): string => {
    return span.spanId || "";
  });
}

function isInWindow(span: SpanFixture): boolean {
  return (
    span.projectId.toString() === projectId.toString() &&
    span.startMs >= WINDOW_START.getTime() &&
    span.startMs <= WINDOW_END.getTime() &&
    !span.isExpired
  );
}

function expectedInWindow(
  predicate: (span: SpanFixture) => boolean = (): boolean => {
    return true;
  },
): number {
  return ALL_SPANS.filter((span: SpanFixture): boolean => {
    return isInWindow(span) && predicate(span);
  }).length;
}

/*
 * The exact count statement, with a slow filter folded in and its time
 * limit cut to a second, so a real server stops it at the limit the way it
 * stops a count over months of spans at 45. Everything else — the WHERE,
 * the retention filter, timeout_overflow_mode — is the statement as built.
 */
class SlowCountStatement extends Statement {
  public constructor(private readonly source: Statement) {
    super();
  }

  public override get query(): string {
    const query: string = this.source.query;

    if (!query.includes(" SETTINGS max_execution_time = 45,")) {
      throw new Error(`Unexpected count statement: ${query}`);
    }

    return query.replace(
      " SETTINGS max_execution_time = 45,",
      " AND sleepEachRow(0.2) = 0 SETTINGS max_execution_time = 1, max_block_size = 1,",
    );
  }

  public override get query_params(): Record<string, unknown> {
    return this.source.query_params;
  }
}

async function captureError(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the query to fail, and it succeeded.");
}

function describeError(error: unknown): string {
  const details: { code?: unknown; type?: unknown; message?: unknown } =
    (error || {}) as { code?: unknown; type?: unknown; message?: unknown };

  return `code=${String(details.code)} type=${String(details.type)} message=${String(details.message).slice(0, 160)}`;
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

integration("The traces explorer's exact span count against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: ServiceConnection | undefined;

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

    await createTable(client, clickhouse);

    original = {
      database: SpanService.database,
      databaseClient: SpanService.databaseClient,
      ingestDatabase: SpanService.ingestDatabase,
      ingestDatabaseClient: SpanService.ingestDatabaseClient,
    };

    SpanService.database = clickhouse;
    SpanService.databaseClient = client;
    SpanService.ingestDatabase = clickhouse;
    SpanService.ingestDatabaseClient = client;

    const model: Span = new Span();

    await client.insert({
      table: `${database}.${model.tableName}`,
      values: ALL_SPANS.map(spanRow),
      format: "JSONEachRow",
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(SpanService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("the fixture loaded every span", async () => {
    const result: {
      json: () => Promise<{ data?: Array<{ total?: string | number }> }>;
    } = (await client.query({
      query: `SELECT count() AS total FROM ${database}.${new Span().tableName}`,
      format: "JSON",
    })) as unknown as {
      json: () => Promise<{ data?: Array<{ total?: string | number }> }>;
    };
    const response: { data?: Array<{ total?: string | number }> } =
      await result.json();

    expect(Number(response.data?.[0]?.total)).toBe(ALL_SPANS.length);
  });

  describe("window edges that are not minute-aligned", () => {
    test("the exact count is the list's row count, bounds included", async () => {
      const expected: number = expectedInWindow();

      // The bound spans and every span strictly inside.
      expect(expected).toBe(1 + INSIDE.length + 1);

      const listed: Array<string> = await listedSpanIds(windowQuery());

      expect(listed).toHaveLength(expected);
      expect(await exactCount(windowQuery())).toBe(listed.length);
    });

    test("the default count rounds the window out to whole minutes and counts more", async () => {
      const exact: number = await exactCount(windowQuery());
      const rounded: number = await defaultCount(windowQuery());

      /*
       * The spans in the start minute before the window opens and in the
       * end minute after it closes: what a total printed beside the list
       * would have over-reported.
       */
      expect(rounded).toBe(
        exact + BEFORE_START_SAME_MINUTE.length + AFTER_END_SAME_MINUTE.length,
      );
    });

    test("the default count is served from a minute-grained projection; the exact one reads the table", async () => {
      const explain: (exact: boolean) => Promise<string> = async (
        exact: boolean,
      ): Promise<string> => {
        const statement: Statement = SpanService.toCountStatement({
          query: windowQuery(),
          props: ROOT,
          exact: exact,
        });

        const result: { text: () => Promise<string> } = (await client.query({
          query: `EXPLAIN indexes = 1 ${statement.query}`,
          query_params: statement.query_params,
          format: "TabSeparatedRaw",
        })) as unknown as { text: () => Promise<string> };

        return result.text();
      };

      const projectionRead: RegExp = /ReadFromMergeTree \((proj_[a-z_]+)\)/;

      const roundedPlan: string = await explain(false);
      const exactPlan: string = await explain(true);

      /*
       * Either aggregate projection can serve it — proj_hist_by_minute and
       * proj_agg_by_service both store count() by the minute, and the
       * optimizer picks the smaller — and both are why its window edges
       * round to the minute.
       */
      expect({
        projection: roundedPlan.match(projectionRead)?.[1] || null,
        plan: roundedPlan,
      }).toEqual({
        projection: expect.stringMatching(
          /^proj_(hist_by_minute|agg_by_service)$/,
        ),
        plan: roundedPlan,
      });
      expect({
        projection: exactPlan.match(projectionRead)?.[1] || null,
        plan: exactPlan,
      }).toEqual({ projection: null, plan: exactPlan });
    });
  });

  describe("the filters the explorer's list sends", () => {
    const FILTER_CASES: Array<{
      name: string;
      filters: Record<string, unknown>;
      predicate: (span: SpanFixture) => boolean;
    }> = [
      {
        name: "root spans only",
        filters: { isRootSpan: true },
        predicate: (span: SpanFixture): boolean => {
          return span.isRootSpan;
        },
      },
      {
        name: "one service",
        filters: { primaryEntityId: checkoutServiceId },
        predicate: (span: SpanFixture): boolean => {
          return span.serviceId.toString() === checkoutServiceId.toString();
        },
      },
      {
        name: "two services",
        filters: {
          primaryEntityId: new Includes([checkoutServiceId, paymentServiceId]),
        },
        predicate: (span: SpanFixture): boolean => {
          return span.serviceId.toString() !== gatewayHostId.toString();
        },
      },
      {
        name: "status Error",
        filters: { statusCode: SpanStatus.Error },
        predicate: (span: SpanFixture): boolean => {
          return span.statusCode === SpanStatus.Error;
        },
      },
      {
        name: "statuses Unset or Ok",
        filters: {
          statusCode: new Includes([SpanStatus.Unset, SpanStatus.Ok]),
        },
        predicate: (span: SpanFixture): boolean => {
          return span.statusCode !== SpanStatus.Error;
        },
      },
      {
        name: "a span-name substring",
        filters: { name: new Search("dbo.F5742013") },
        predicate: (span: SpanFixture): boolean => {
          return span.name.includes("dbo.F5742013");
        },
      },
      {
        name: "an attribute value",
        filters: { attributes: { "http.method": "GET" } },
        predicate: (span: SpanFixture): boolean => {
          return span.httpMethod === "GET";
        },
      },
      {
        name: "a host picked in the resource facets",
        filters: {
          resourceFilters: { hostId: [gatewayHostId.toString()] },
        },
        predicate: (span: SpanFixture): boolean => {
          return span.serviceId.toString() === gatewayHostId.toString();
        },
      },
      {
        name: "a service, a status and an attribute together",
        filters: {
          primaryEntityId: checkoutServiceId,
          statusCode: SpanStatus.Unset,
          attributes: { "http.method": "GET" },
        },
        predicate: (span: SpanFixture): boolean => {
          return (
            span.serviceId.toString() === checkoutServiceId.toString() &&
            span.statusCode === SpanStatus.Unset &&
            span.httpMethod === "GET"
          );
        },
      },
    ];

    test.each(
      FILTER_CASES.map(
        (filterCase: { name: string }, index: number): [string, number] => {
          return [filterCase.name, index];
        },
      ),
    )(
      "%s: the exact count is the list's row count",
      async (_name: string, index: number): Promise<void> => {
        const filterCase: {
          filters: Record<string, unknown>;
          predicate: (span: SpanFixture) => boolean;
        } = FILTER_CASES[index]!;

        const expected: number = expectedInWindow(filterCase.predicate);

        // A case that matched nothing would prove nothing.
        expect(expected).toBeGreaterThan(0);
        expect(expected).toBeLessThan(expectedInWindow());

        /*
         * Fresh query objects for each call: the resource facet's rewrite
         * consumes `resourceFilters` off the query it is handed.
         */
        const listed: Array<string> = await listedSpanIds(
          windowQuery({ ...filterCase.filters }),
        );

        expect(listed).toHaveLength(expected);
        expect(await exactCount(windowQuery({ ...filterCase.filters }))).toBe(
          listed.length,
        );
      },
    );
  });

  describe("spans past their retention date", () => {
    const retentionWindow: { projectId: ObjectID; start: Date; end: Date } = {
      projectId: retentionProjectId,
      start: RETENTION_WINDOW_START,
      end: RETENTION_WINDOW_END,
    };

    test("are in neither the list nor the exact count, and are in the default count", async () => {
      const listed: Array<string> = await listedSpanIds(
        windowQuery({}, retentionWindow),
      );
      const exact: number = await exactCount(windowQuery({}, retentionWindow));
      const rounded: number = await defaultCount(
        windowQuery({}, retentionWindow),
      );

      expect(listed).toHaveLength(RETENTION_LIVE.length);
      expect(exact).toBe(RETENTION_LIVE.length);
      // The projection does not store retentionDate, so it cannot apply it.
      expect(rounded).toBe(RETENTION_LIVE.length + RETENTION_EXPIRED.length);
    });
  });

  describe("a count that runs out of time", () => {
    /*
     * A count's shape: one row, written when the scan ends, so the limit
     * fires before a byte of the answer is sent and the server can answer
     * with the error itself. (A query that had already streamed rows would
     * have its connection cut instead — a count never streams.)
     */
    test("a count stopped at max_execution_time is a timeout", async () => {
      const error: unknown = await captureError(async (): Promise<void> => {
        const result: { json: () => Promise<unknown> } = (await client.query({
          query:
            "SELECT count() AS count FROM numbers(50) WHERE sleepEachRow(0.2) = 0 SETTINGS max_execution_time = 1, timeout_overflow_mode = 'throw', max_block_size = 1",
          format: "JSON",
        })) as unknown as { json: () => Promise<unknown> };

        await result.json();
      });

      // TIMEOUT_EXCEEDED once the limit passes, or TOO_SLOW when estimated.
      expect(describeError(error)).toMatch(
        /^code=(159|160) type=(TIMEOUT_EXCEEDED|TOO_SLOW) /,
      );
      expect(AnalyticsDatabaseService.isQueryTimeoutError(error)).toBe(true);
    });

    test("an unrelated ClickHouse error is not a timeout", async () => {
      const error: unknown = await captureError(async (): Promise<void> => {
        const result: { json: () => Promise<unknown> } = (await client.query({
          query: "SELECT FROM WHERE",
          format: "JSON",
        })) as unknown as { json: () => Promise<unknown> };

        await result.json();
      });

      expect(describeError(error)).toMatch(/^code=62 type=SYNTAX_ERROR /);
      expect(AnalyticsDatabaseService.isQueryTimeoutError(error)).toBe(false);
    });

    test("an exact count stopped at its limit is refused with a TimeoutException, not a partial count", async () => {
      const buildStatement: typeof SpanService.toCountStatement =
        SpanService.toCountStatement.bind(SpanService);

      jest
        .spyOn(SpanService, "toCountStatement")
        .mockImplementation((countBy: Parameters<typeof buildStatement>[0]) => {
          return new SlowCountStatement(buildStatement(countBy));
        });

      const error: unknown = await captureError(async (): Promise<number> => {
        return exactCount(windowQuery());
      });

      expect({
        isTimeoutException: error instanceof TimeoutException,
        error: describeError(error),
      }).toEqual({ isTimeoutException: true, error: describeError(error) });
      expect((error as TimeoutException).message).toContain(
        "Narrow the time range or add a filter",
      );
    });
  });

  describe("the exact count statement as built", () => {
    test("refuses to break off early, and runs on the server", async () => {
      const statement: Statement = SpanService.toCountStatement({
        query: windowQuery(),
        props: ROOT,
        exact: true,
      });

      expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
      expect(statement.query).toContain("retentionDate >= now()");
      expect(statement.query).not.toContain("toStartOfMinute");

      const result: {
        json: () => Promise<{ data?: Array<{ count?: string | number }> }>;
      } = (await SpanService.executeQuery(statement)) as unknown as {
        json: () => Promise<{ data?: Array<{ count?: string | number }> }>;
      };
      const response: { data?: Array<{ count?: string | number }> } =
        await result.json();

      expect(Number(response.data?.[0]?.count)).toBe(expectedInWindow());
    });
  });
});

describe("Span exact count ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
