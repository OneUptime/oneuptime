import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { ClickhouseExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import QueryTimeoutException from "Common/Types/Exception/QueryTimeoutException";
import TimeoutException from "Common/Types/Exception/TimeoutException";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import ErrorClass, {
  declaredErrorClass,
} from "Common/Types/Telemetry/ErrorClass";
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
 * A log search stopped at the query time limit, against a real ClickHouse
 * server (issue #4707).
 *
 * The report: a log search that runs into the 45 s limit fails with a bare
 * "Server Error". It is true, and it was every explorer read: they ran with
 * timeout_overflow_mode 'break', and ClickHouse answers a read it breaks off
 * with an empty body (grouped and sorted reads) or a document cut off
 * mid-row (streamed reads) — never the partial result the mode is
 * documented to give — which JSON.parse could not read.
 *
 * This suite runs each read the logs explorer makes — the list, its exact
 * total, the grouped histogram, the facets, the analytics chart, the error
 * patterns and the export — and the traces explorer's list and histogram,
 * as the services build them, with two changes that make a few thousand rows
 * as slow as a month of logs: every WHERE also sleeps a little on each row,
 * and the limit is one second instead of 45. Then:
 *
 *   1. each read rejects with the QueryTimeoutException the API answers 504
 *      with ("This query took longer than 1 second and was stopped before it
 *      finished. Try a shorter time range or more specific filters."),
 *      classed Infrastructure — never a SyntaxError, never an empty answer;
 *   2. the premise holds: the same read under 'break' gets an EMPTY body from
 *      this server, which is still reported as the stop;
 *   3. a read that was streaming rows when it was stopped answers, without
 *      http_wait_end_of_query, with rows and a dropped connection — and with
 *      it (as executeQuery sends a time-limited read) with the error itself;
 *   4. the export keeps exactly the rows of an attribute-filtered search;
 *   5. without the slowdown, every one of these reads answers in time.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/LogSearchTimeLimitClickhouse.test.ts
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

import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import LogAggregationService, {
  FacetValue,
  HistogramBucket,
} from "Common/Server/Services/LogAggregationService";
import TraceAggregationService from "Common/Server/Services/TraceAggregationService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `log_search_time_limit_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const WINDOW_START: Date = new Date(
  Math.floor(Date.now() / MINUTE) * MINUTE - 120 * MINUTE,
);
const WINDOW_END: Date = new Date(WINDOW_START.getTime() + 60 * MINUTE);

const PROJECT_ID: ObjectID = new ObjectID(
  "a4707000-0000-4000-8000-000000004707",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "c4707000-0000-4000-8000-000000004707",
);

/*
 * Enough rows that a read sleeping 0.2 ms on each one takes well over the
 * one-second limit even across ClickHouse's parallel streams, and few
 * enough that the fixture loads in a second.
 */
const LOG_ROWS: number = 40000;
const SPAN_ROWS: number = 40000;

// The attribute value an export is filtered on, and how often it occurs.
const RARE_ROUTE: string = "/orders/export";

function isRare(index: number): boolean {
  return index % 997 === 0;
}

const SLEEP_PER_ROW_SECONDS: number = 0.0002;

const ONE_SECOND_MESSAGE: string =
  "This query took longer than 1 second and was stopped before it finished. Try a shorter time range or more specific filters.";

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

function timeOf(index: number, rows: number): Date {
  return new Date(
    WINDOW_START.getTime() + MINUTE + Math.floor((index * 55 * MINUTE) / rows),
  );
}

function logRow(index: number): JSONObject {
  const time: Date = timeOf(index, LOG_ROWS);
  const attributes: Record<string, string> = {
    "http.route": isRare(index) ? RARE_ROUTE : `/route-${index % 7}`,
    "http.method": index % 3 === 0 ? "POST" : "GET",
  };

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: SERVICE_ID.toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000 + index),
    severityText:
      index % 10 === 0 ? LogSeverity.Error : LogSeverity.Information,
    severityNumber: index % 10 === 0 ? 17 : 9,
    attributes: attributes,
    attributeKeys: Object.keys(attributes).sort(),
    entityKeys: [],
    traceId: "",
    spanId: "",
    body:
      index % 10 === 0
        ? `payment ${index} failed: connection refused`
        : `request ${index} served`,
    retentionDate: retentionDate,
  };
}

function spanRow(index: number): JSONObject {
  const start: Date = timeOf(index, SPAN_ROWS);
  const startNs: string = String(BigInt(start.getTime()) * BigInt(1000000));
  const durationNs: number = 12 * 1000000;

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: SERVICE_ID.toString(),
    primaryEntityType: "Service",
    startTime: OneUptimeDate.toClickhouseDateTime64(start),
    endTime: OneUptimeDate.toClickhouseDateTime64(start),
    startTimeUnixNano: startNs,
    endTimeUnixNano: String(BigInt(startNs) + BigInt(durationNs)),
    durationUnixNano: String(durationNs),
    traceId: `trace-${index}`,
    spanId: `span-${index}`,
    parentSpanId: index % 4 === 0 ? "" : `parent-${index}`,
    attributes: { "http.method": "GET" },
    attributeKeys: ["http.method"],
    entityKeys: [],
    statusCode: index % 9 === 0 ? SpanStatus.Error : SpanStatus.Ok,
    name: `GET /api/${index % 5}`,
    kind: "SPAN_KIND_SERVER",
    isRootSpan: index % 4 === 0,
    retentionDate: retentionDate,
  };
}

/*
 * A statement exactly as a service built it, made slow: every WHERE sleeps
 * on each row it reads (the subqueries' too, so the list's sort-key bound
 * cannot skip the work), and the time limit is one second. PREWHERE is
 * switched off where the statement does not set it, so a selective filter
 * cannot drop rows before they reach the sleep. The overflow mode —
 * 'throw', or 'break' for the premise — is the statement's own unless a
 * test swaps it.
 */
class SlowStatement extends Statement {
  public constructor(
    private readonly source: Statement,
    private readonly overflowMode?: "break" | "throw" | undefined,
  ) {
    super();
  }

  public override get query(): string {
    let query: string = this.source.query;

    if (!query.includes("max_execution_time = 45")) {
      throw new Error(`A read without the 45 s limit: ${query}`);
    }

    query = query
      .split("max_execution_time = 45")
      .join(
        query.includes("optimize_move_to_prewhere")
          ? "max_execution_time = 1"
          : "max_execution_time = 1, optimize_move_to_prewhere = 0",
      );
    query = query
      .split("WHERE ")
      .join(`WHERE sleepEachRow(${SLEEP_PER_ROW_SECONDS}) = 0 AND `);

    if (this.overflowMode) {
      query = query
        .split("timeout_overflow_mode = 'throw'")
        .join(`timeout_overflow_mode = '${this.overflowMode}'`);
    }

    return query;
  }

  public override get query_params(): Record<string, unknown> {
    return this.source.query_params;
  }
}

type ExecuteQuery = (
  statement: Statement | string,
  options?: ClickhouseExecuteOptions,
) => Promise<unknown>;

// Every read the service makes from here on is slowed down as above.
function slowDown(
  service: AnalyticsDatabaseService<AnalyticsBaseModel>,
  overflowMode?: "break" | "throw",
): { statements: Array<string> } {
  const original: ExecuteQuery = service.executeQuery.bind(
    service,
  ) as ExecuteQuery;
  const seen: { statements: Array<string> } = { statements: [] };

  jest
    .spyOn(service, "executeQuery")
    .mockImplementation(
      (
        statement: Statement | string,
        options?: ClickhouseExecuteOptions,
      ): Promise<never> => {
        const slow: SlowStatement = new SlowStatement(
          statement as Statement,
          overflowMode,
        );
        seen.statements.push(slow.query);
        return original(slow, options) as Promise<never>;
      },
    );

  return seen;
}

async function captureError(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the read to be stopped, and it finished.");
}

function describeError(error: unknown): string {
  const details: { name?: unknown; code?: unknown; message?: unknown } =
    (error || {}) as { name?: unknown; code?: unknown; message?: unknown };

  return `${String((error as object)?.constructor?.name)} code=${String(details.code)} message=${String(details.message).slice(0, 200)}`;
}

// What the explorer and an API caller get: the stop, said plainly.
function expectStopped(
  error: unknown,
  message: string = ONE_SECOND_MESSAGE,
): void {
  expect({
    isStop: error instanceof QueryTimeoutException,
    error: describeError(error),
  }).toEqual({ isStop: true, error: describeError(error) });
  expect(error).toBeInstanceOf(TimeoutException);
  expect((error as QueryTimeoutException).code).toBe(504);
  expect((error as QueryTimeoutException).code).toBe(
    ExceptionCode.QueryTimeoutException,
  );
  expect((error as QueryTimeoutException).message).toBe(message);
  expect(declaredErrorClass(error)?.errorClass).toBe(ErrorClass.Infrastructure);
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

function connectionOf(
  service: AnalyticsDatabaseService<AnalyticsBaseModel>,
): ServiceConnection {
  return {
    database: service.database,
    databaseClient: service.databaseClient,
    ingestDatabase: service.ingestDatabase,
    ingestDatabaseClient: service.ingestDatabaseClient,
  };
}

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

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

integration(
  "A log search stopped at the query time limit, against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    // Without response compression, which can hold a small answer by itself.
    let uncompressed: ClickhouseDatabase;
    let uncompressedClient: ClickhouseClient;
    let originalLog: ServiceConnection | undefined;
    let originalSpan: ServiceConnection | undefined;

    const logService: AnalyticsDatabaseService<AnalyticsBaseModel> =
      LogService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>;
    const spanService: AnalyticsDatabaseService<AnalyticsBaseModel> =
      SpanService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>;

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
        // As production sends and reads them (ClickhouseConfig).
        compression: { request: true, response: true },
      };

      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      const uncompressedOptions: ClickHouseClientConfigOptions = {
        ...options,
        compression: { request: false, response: false },
      };
      uncompressed = new ClickhouseDatabase(uncompressedOptions);
      uncompressedClient = await uncompressed.connect(uncompressedOptions);

      await createTable(client, clickhouse, Log);
      await createTable(
        client,
        clickhouse,
        Span as unknown as { new (): AnalyticsBaseModel },
      );

      originalLog = connectionOf(logService);
      originalSpan = connectionOf(spanService);

      for (const service of [logService, spanService]) {
        service.database = clickhouse;
        service.databaseClient = client;
        service.ingestDatabase = clickhouse;
        service.ingestDatabaseClient = client;
      }

      await client.insert({
        table: `${database}.${new Log().tableName}`,
        values: Array.from({ length: LOG_ROWS }, (_v: unknown, i: number) => {
          return logRow(i);
        }),
        format: "JSONEachRow",
      });

      await client.insert({
        table: `${database}.${new Span().tableName}`,
        values: Array.from({ length: SPAN_ROWS }, (_v: unknown, i: number) => {
          return spanRow(i);
        }),
        format: "JSONEachRow",
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(async (): Promise<void> => {
      if (originalLog) {
        Object.assign(logService, originalLog);
      }

      if (originalSpan) {
        Object.assign(spanService, originalSpan);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }

      if (uncompressed) {
        await uncompressed.disconnect();
      }
    });

    const window: InBetween<Date> = new InBetween<Date>(
      WINDOW_START,
      WINDOW_END,
    );

    // The reads the logs explorer makes, as the page makes them.
    const LOG_READS: Array<[string, () => Promise<unknown>]> = [
      [
        "the list (findBy, newest first)",
        (): Promise<unknown> => {
          return LogService.findBy({
            query: {
              projectId: PROJECT_ID,
              time: window,
              body: new Search("matches no log line"),
            },
            select: { body: true, time: true },
            sort: { time: SortOrder.Descending },
            skip: 0,
            limit: 100,
            props: { isRoot: true },
          });
        },
      ],
      [
        "the grouped histogram",
        (): Promise<unknown> => {
          return LogAggregationService.getHistogram({
            projectId: PROJECT_ID,
            startTime: WINDOW_START,
            endTime: WINDOW_END,
            bucketSizeInMinutes: 5,
            attributes: { "http.method": "GET" },
          });
        },
      ],
      [
        "a facet",
        (): Promise<unknown> => {
          return LogAggregationService.getFacetValues({
            projectId: PROJECT_ID,
            startTime: WINDOW_START,
            endTime: WINDOW_END,
            facetKey: "severityText",
          });
        },
      ],
      [
        "the analytics chart",
        (): Promise<unknown> => {
          return LogAggregationService.getAnalyticsTimeseries({
            projectId: PROJECT_ID,
            startTime: WINDOW_START,
            endTime: WINDOW_END,
            bucketSizeInMinutes: 5,
            chartType: "timeseries",
            aggregation: "count",
            groupBy: ["severityText"],
          });
        },
      ],
      [
        "the error patterns",
        (): Promise<unknown> => {
          return LogAggregationService.getTopErrorPatterns({
            projectId: PROJECT_ID,
            startTime: WINDOW_START,
            endTime: WINDOW_END,
          });
        },
      ],
      [
        "the export",
        (): Promise<unknown> => {
          return LogAggregationService.getExportLogs({
            projectId: PROJECT_ID,
            startTime: WINDOW_START,
            endTime: WINDOW_END,
            limit: 10000,
          });
        },
      ],
    ];

    describe("every read the logs explorer makes", () => {
      test.each(LOG_READS)(
        "%s: answers in time without the slowdown",
        async (_name: string, read: () => Promise<unknown>) => {
          await expect(read()).resolves.toBeDefined();
        },
      );

      test.each(LOG_READS)(
        "%s: stopped at the limit, rejects with the stop the API answers 504 with",
        async (_name: string, read: () => Promise<unknown>) => {
          const seen: { statements: Array<string> } = slowDown(logService);

          expectStopped(await captureError(read));

          // The read as built: 'throw' at its limit, never 'break'.
          expect(seen.statements.length).toBeGreaterThan(0);
          for (const statement of seen.statements) {
            expect(statement).toContain("timeout_overflow_mode = 'throw'");
            expect(statement).not.toContain("'break'");
          }
        },
      );
    });

    describe("the logs explorer's exact total", () => {
      test("stopped at the limit, says the count took too long — never a total of 0", async () => {
        slowDown(logService);

        expectStopped(
          await captureError(() => {
            return LogService.countBy({
              query: { projectId: PROJECT_ID, time: window },
              props: { isRoot: true },
              exact: true,
            });
          }),
          "Counting every matching log took longer than 45 seconds. Narrow the time range or add a filter to get an exact total.",
        );
      });

      test("answers in time without the slowdown", async () => {
        const count: number = (
          await LogService.countBy({
            query: { projectId: PROJECT_ID, time: window },
            props: { isRoot: true },
            exact: true,
          })
        ).toNumber();

        expect(count).toBe(LOG_ROWS);
      });
    });

    describe("the traces explorer, which reads through the same path", () => {
      test("its list, stopped at the limit, rejects with the stop", async () => {
        slowDown(spanService);

        expectStopped(
          await captureError(() => {
            return SpanService.findBy({
              query: {
                projectId: PROJECT_ID,
                startTime: window,
                name: new Search("matches no span"),
              },
              select: { spanId: true },
              sort: { startTime: SortOrder.Descending },
              skip: 0,
              limit: 100,
              props: { isRoot: true },
            });
          }),
        );
      });

      test("its histogram, stopped at the limit, rejects rather than draw an empty window", async () => {
        slowDown(spanService);

        expectStopped(
          await captureError(() => {
            return TraceAggregationService.getHistogram({
              projectId: PROJECT_ID,
              startTime: WINDOW_START,
              endTime: WINDOW_END,
              bucketSizeInMinutes: 5,
              statusCodes: [SpanStatus.Error],
              attributes: { "http.method": "GET" },
            });
          }),
        );
      });
    });

    /*
     * The premise, on this server: 'break' answers a grouped read it stops
     * with nothing at all. JSON.parse on that was the "Server Error". Should a
     * ClickHouse release ever send the partial result instead, this fails and
     * says so.
     */
    describe("why not 'break'", () => {
      test("ClickHouse answers a grouped read it breaks off with an EMPTY body", async () => {
        const facet: Statement = new SlowStatement(
          (
            LogAggregationService as unknown as {
              buildFacetStatement: (request: JSONObject) => Statement;
            }
          ).buildFacetStatement({
            projectId: PROJECT_ID,
            startTime: WINDOW_START,
            endTime: WINDOW_END,
            facetKey: "severityText",
          }),
          "break",
        );

        const result: { text: () => Promise<string> } = (await client.query({
          query: facet.query,
          query_params: facet.query_params,
          format: "JSON",
        })) as unknown as { text: () => Promise<string> };

        expect(await result.text()).toBe("");
      });

      test("and even a read still under 'break' is reported as the stop, not a SyntaxError", async () => {
        slowDown(logService, "break");

        expectStopped(
          await captureError(() => {
            return LogAggregationService.getFacetValues({
              projectId: PROJECT_ID,
              startTime: WINDOW_START,
              endTime: WINDOW_END,
              facetKey: "severityText",
            }) as Promise<Array<FacetValue>>;
          }),
        );
      });
    });

    /*
     * A read that had already sent rows when it was stopped: without
     * http_wait_end_of_query the server writes its error after them and drops
     * the connection, which the client can only report as an aborted read.
     * (Production's gzip responses hold a small answer in the compressor, so
     * an uncompressed client shows it with a few rows; an export of thousands
     * flushes the same way through gzip.) executeQuery asks ClickHouse to
     * hold a time-limited read's answer, so the stop arrives as the error
     * itself.
     */
    describe("a read that was streaming rows when it was stopped", () => {
      /*
       * A light sleep on one thread, so each block of rows is finished and
       * sent well inside the second, and the whole read is not.
       */
      const STREAMING_READ: string = `SELECT body FROM ${database}.LogItemV3 WHERE sleepEachRow(0.00004) = 0 AND projectId = {projectId:String} LIMIT 100000 SETTINGS max_execution_time = 1, timeout_overflow_mode = 'throw', max_threads = 1`;

      test("without held answers, ends in rows and a dropped connection", async () => {
        const outcome: string = await (async (): Promise<string> => {
          try {
            const result: { text: () => Promise<string> } =
              (await uncompressedClient.query({
                query: STREAMING_READ,
                query_params: { projectId: PROJECT_ID.toString() },
                format: "JSON",
              })) as unknown as { text: () => Promise<string> };

            const text: string = await result.text();

            return text.includes("__exception__")
              ? "rows, then an error block"
              : "a whole answer";
          } catch (error) {
            return AnalyticsDatabaseService.isQueryTimeoutError(error)
              ? "the error itself"
              : "an aborted read";
          }
        })();

        expect(["an aborted read", "rows, then an error block"]).toContain(
          outcome,
        );
      });

      test("through executeQuery, is the stop", async () => {
        expectStopped(
          await captureError(async (): Promise<unknown> => {
            const result: { json: () => Promise<unknown> } =
              (await LogService.executeQuery(
                STREAMING_READ.replace(
                  "{projectId:String}",
                  `'${PROJECT_ID.toString()}'`,
                ),
              )) as unknown as { json: () => Promise<unknown> };

            return result.json();
          }),
        );
      });
    });

    /*
     * The export used to drop the attribute filter: a search narrowed to one
     * route exported every row of the window. The service always took it; the
     * route now passes it (TelemetryReadTimeLimitAPI pins the route).
     */
    describe("the export of a filtered search", () => {
      test("holds exactly the rows the attribute filter matches", async () => {
        const exported: Array<JSONObject> =
          await LogAggregationService.getExportLogs({
            projectId: PROJECT_ID,
            startTime: WINDOW_START,
            endTime: WINDOW_END,
            limit: 10000,
            attributes: { "http.route": RARE_ROUTE },
          });

        const expected: Array<string> = Array.from(
          { length: LOG_ROWS },
          (_v: unknown, i: number) => {
            return i;
          },
        )
          .filter(isRare)
          .map((i: number): string => {
            return String(logRow(i)["body"]);
          })
          .sort();

        expect(expected.length).toBeGreaterThan(10);
        expect(
          exported
            .map((row: JSONObject): string => {
              return String(row["body"]);
            })
            .sort(),
        ).toEqual(expected);
      });

      test("a histogram over the same filter counts the same rows", async () => {
        const buckets: Array<HistogramBucket> =
          await LogAggregationService.getHistogram({
            projectId: PROJECT_ID,
            startTime: WINDOW_START,
            endTime: WINDOW_END,
            bucketSizeInMinutes: 60,
            attributes: { "http.route": RARE_ROUTE },
          });

        expect(
          buckets.reduce((total: number, bucket: HistogramBucket): number => {
            return total + bucket.count;
          }, 0),
        ).toBe(
          Array.from({ length: LOG_ROWS }, (_v: unknown, i: number) => {
            return i;
          }).filter(isRare).length,
        );
      });
    });
  },
);

describe("Log search time limit ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
