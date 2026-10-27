import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Span, SpanKind, context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ClickHouseError } from "@clickhouse/client";
import {
  DatabaseCall,
  DatabaseSystemName,
  MAX_QUERY_TEXT_LENGTH,
  MAX_SUMMARY_SCAN_LENGTH,
  StatementSummary,
  describeDatabaseError,
  formatQueryText,
  summarizeStatement,
  traceDatabaseCall,
} from "../../../../Server/Utils/Telemetry/DatabaseClientSpan";
import Telemetry from "../../../../Server/Utils/Telemetry";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * The CLIENT span every OneUptime datastore call gets (Postgres, Valkey,
 * ClickHouse): when one is made, what it is called, what it carries, and
 * what it says about a failure - never an "exception" event, which ingest
 * would turn into an Issue.
 */

jest.mock("../../../../Server/Utils/Logger");

const exporter: InMemorySpanExporter = new InMemorySpanExporter();
const provider: BasicTracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager: AsyncLocalStorageContextManager =
  new AsyncLocalStorageContextManager();

const SELECT_CALL: DatabaseCall = {
  system: DatabaseSystemName.Postgres,
  server: { address: "postgres", port: 5432, namespace: "oneuptimedb" },
  operation: "SELECT",
  collection: "Monitor",
  queryText: 'SELECT "Monitor"."_id" FROM "Monitor" "Monitor" WHERE "_id" = $1',
};

function finishedSpans(): Array<ReadableSpan> {
  return exporter.getFinishedSpans();
}

function onlySpanNamed(name: string): ReadableSpan {
  const spans: Array<ReadableSpan> = finishedSpans().filter(
    (span: ReadableSpan) => {
      return span.name === name;
    },
  );
  expect(spans).toHaveLength(1);
  return spans[0]!;
}

// Run `work` inside a request's span, the way a traced request runs it.
async function inRequest<T>(work: () => Promise<T>): Promise<T> {
  return trace
    .getTracer("test")
    .startActiveSpan("request", async (span: Span): Promise<T> => {
      try {
        return await work();
      } finally {
        span.end();
      }
    });
}

beforeAll(() => {
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);
});

afterAll(() => {
  trace.disable();
  context.disable();
});

beforeEach(() => {
  exporter.reset();
  jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("summarizeStatement", () => {
  test.each([
    [
      "a TypeORM read, with its quoted aliases",
      'SELECT "Monitor"."_id" AS "Monitor__id", "Monitor"."name" AS "Monitor_name" FROM "Monitor" "Monitor" WHERE ( ("Monitor"."projectId" = $1) ) LIMIT 1',
      "SELECT",
      "Monitor",
    ],
    [
      "a TypeORM insert",
      'INSERT INTO "TelemetryAttribute"("_id", "projectId") VALUES ($1, $2) RETURNING "_id", "createdAt"',
      "INSERT",
      "TelemetryAttribute",
    ],
    [
      "an update",
      'UPDATE "Monitor" SET "name" = $1 WHERE "_id" IN ($2)',
      "UPDATE",
      "Monitor",
    ],
    [
      "an update of one table only",
      'UPDATE ONLY "Monitor" SET "name" = $1',
      "UPDATE",
      "Monitor",
    ],
    ["a delete", 'DELETE FROM "Monitor" WHERE "_id" = $1', "DELETE", "Monitor"],
    [
      "a read with a subquery in its select list",
      'SELECT (SELECT count(*) FROM "Incident" WHERE "monitorId" = "Monitor"."_id") AS "incidents" FROM "Monitor"',
      "SELECT",
      "Monitor",
    ],
    [
      "FROM inside a string",
      `SELECT 'from FROM "Hidden"' AS "text" FROM "Project"`,
      "SELECT",
      "Project",
    ],
    [
      "FROM inside comments",
      'SELECT 1 /* FROM "Hidden" */ -- FROM "AlsoHidden"\nFROM "Team"',
      "SELECT",
      "Team",
    ],
    [
      "EXTRACT(... FROM ...) in the select list",
      'SELECT EXTRACT(EPOCH FROM "createdAt") AS "t" FROM "Probe"',
      "SELECT",
      "Probe",
    ],
    [
      "a schema-qualified table",
      'SELECT * FROM "public"."Monitor"',
      "SELECT",
      "public.Monitor",
    ],
    [
      "a ClickHouse read",
      "SELECT count() AS count FROM oneuptime.Log WHERE projectId = {p0:String}",
      "SELECT",
      "oneuptime.Log",
    ],
    [
      "a ClickHouse read with backticks",
      "SELECT * FROM `oneuptime`.`Span` FINAL",
      "SELECT",
      "oneuptime.Span",
    ],
    ["lower case", "select * from monitor where id = 1", "SELECT", "monitor"],
    [
      "a leading comment and parenthesis",
      '-- reason\n  (SELECT 1 FROM "A") UNION (SELECT 1 FROM "B")',
      "SELECT",
      "A",
    ],
    [
      "a subquery as the source",
      "SELECT * FROM (SELECT 1) AS x",
      "SELECT",
      null,
    ],
    ["a read of no table", "SELECT 1", "SELECT", null],
    [
      "TypeORM's transaction start",
      "START TRANSACTION",
      "START TRANSACTION",
      null,
    ],
    ["a commit", "COMMIT", "COMMIT", null],
    ["a savepoint", 'SAVEPOINT "typeorm_1"', "SAVEPOINT", null],
    [
      "a common table expression",
      'WITH "x" AS (SELECT 1) SELECT * FROM "x"',
      "WITH",
      null,
    ],
  ])(
    "%s",
    (
      _case: string,
      statement: string,
      operation: string,
      collection: string | null,
    ) => {
      expect(summarizeStatement(statement)).toEqual({
        operation: operation,
        collection: collection,
      });
    },
  );

  test("nothing readable is null, never an error", () => {
    for (const statement of ["", "   ", "123", "(((", '"', "/* open"]) {
      expect(summarizeStatement(statement)).toEqual({
        operation: null,
        collection: null,
      });
    }
  });

  test("a table named past the scanned length is not looked for", () => {
    const statement: string = `SELECT ${'"column", '.repeat(
      Math.ceil(MAX_SUMMARY_SCAN_LENGTH / 10) + 10,
    )}1 FROM "Far"`;

    expect(statement.length).toBeGreaterThan(MAX_SUMMARY_SCAN_LENGTH);
    expect(summarizeStatement(statement)).toEqual({
      operation: "SELECT",
      collection: null,
    });
  });

  test("a statement of megabytes costs no more than its first 64 KB", () => {
    /*
     * A bulk insert's VALUES, an IN list: shapes a regular expression chokes
     * on. Built flat through a Buffer, so the clock times the summary rather
     * than V8 joining the pieces of a repeat() into one string.
     */
    const flat: (text: string) => string = (text: string): string => {
      return Buffer.from(text).toString();
    };
    const bulkInsert: string = flat(
      `INSERT INTO "MetricType"("name") VALUES ${"($1), ".repeat(2_000_000)}($1)`,
    );
    const unclosedString: string = flat(
      `SELECT '${"x".repeat(16 * 1024 * 1024)}`,
    );
    const deepParentheses: string = flat(
      `SELECT ${"(".repeat(4 * 1024 * 1024)}`,
    );

    /*
     * The fastest of up to three attempts counts (Tests/Helpers/FastestRun):
     * one attempt on a busy runner can stall for longer than the work takes.
     * Each attempt summarizes the same strings again; nothing is cached.
     */
    const timed: FastestRun<{
      summaries: Array<StatementSummary>;
      formattedLength: number;
    }> = fastestRun({
      run: (): {
        summaries: Array<StatementSummary>;
        formattedLength: number;
      } => {
        return {
          summaries: [
            summarizeStatement(bulkInsert),
            summarizeStatement(unclosedString),
            summarizeStatement(deepParentheses),
          ],
          formattedLength: formatQueryText(bulkInsert).length,
        };
      },
      limitInMs: 2000,
    });

    expect(timed.result.summaries).toEqual([
      { operation: "INSERT", collection: "MetricType" },
      { operation: "SELECT", collection: null },
      { operation: "SELECT", collection: null },
    ]);
    expect(timed.result.formattedLength).toBeLessThanOrEqual(
      MAX_QUERY_TEXT_LENGTH,
    );

    // The budget the other linear-time suites hold a busy CI runner to.
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("formatQueryText", () => {
  test("a statement within the cap is kept whole", () => {
    expect(formatQueryText(SELECT_CALL.queryText!)).toBe(SELECT_CALL.queryText);
  });

  test("a longer one keeps its start and its end", () => {
    const columns: string = '"Monitor"."column" AS "Monitor_column", '.repeat(
      200,
    );
    const statement: string = `SELECT ${columns}1 FROM "Monitor" "Monitor" WHERE "Monitor"."projectId" = $1 ORDER BY "createdAt" DESC LIMIT 10`;

    const formatted: string = formatQueryText(statement);

    expect(formatted.length).toBeLessThanOrEqual(MAX_QUERY_TEXT_LENGTH);
    expect(formatted.startsWith('SELECT "Monitor"."column"')).toBe(true);
    expect(formatted.endsWith('ORDER BY "createdAt" DESC LIMIT 10')).toBe(true);
    expect(formatted).toContain(" … ");
  });
});

describe("describeDatabaseError", () => {
  test("a Postgres error answers with its SQLSTATE, through TypeORM's wrapper", () => {
    const queryFailed: Error = Object.assign(
      new Error('duplicate key value violates unique constraint "UQ_name"'),
      {
        name: "QueryFailedError",
        driverError: { code: "23505", detail: "Key (name)=(x) exists." },
      },
    );

    expect(
      describeDatabaseError(DatabaseSystemName.Postgres, queryFailed),
    ).toEqual({ type: "23505", statusCode: "23505" });
  });

  test("a connection that failed has no status code", () => {
    const refused: Error = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });

    expect(describeDatabaseError(DatabaseSystemName.Postgres, refused)).toEqual(
      { type: "ECONNREFUSED", statusCode: null },
    );
    expect(
      describeDatabaseError(
        DatabaseSystemName.Postgres,
        new Error("Connection terminated"),
      ),
    ).toEqual({ type: "Error", statusCode: null });
  });

  test("a ClickHouse error answers with its code and its name", () => {
    const missing: ClickHouseError = new ClickHouseError({
      message: "Table oneuptime.Missing does not exist.",
      code: "60",
      type: "UNKNOWN_TABLE",
    });

    expect(
      describeDatabaseError(DatabaseSystemName.ClickHouse, missing),
    ).toEqual({ type: "UNKNOWN_TABLE", statusCode: "60" });
    expect(
      describeDatabaseError(
        DatabaseSystemName.ClickHouse,
        new Error("Timeout error."),
      ),
    ).toEqual({ type: "Error", statusCode: null });
  });

  test("a Redis error answers with the kind its reply starts with", () => {
    const wrongType: Error = Object.assign(
      new Error(
        "WRONGTYPE Operation against a key holding the wrong kind of value",
      ),
      { name: "ReplyError" },
    );

    expect(describeDatabaseError(DatabaseSystemName.Redis, wrongType)).toEqual({
      type: "WRONGTYPE",
      statusCode: "WRONGTYPE",
    });
    expect(
      describeDatabaseError(
        DatabaseSystemName.Redis,
        new Error("Connection is closed."),
      ),
    ).toEqual({ type: "Error", statusCode: null });
  });

  test("whatever was thrown, it is described", () => {
    expect(describeDatabaseError(DatabaseSystemName.Redis, "text")).toEqual({
      type: "Error",
      statusCode: null,
    });
    expect(describeDatabaseError(DatabaseSystemName.Postgres, null)).toEqual({
      type: "Error",
      statusCode: null,
    });
  });
});

describe("traceDatabaseCall", () => {
  test("a call inside a trace is a CLIENT span under the active span", async () => {
    const answer: Array<{ id: number }> = await inRequest(() => {
      return traceDatabaseCall(
        () => {
          return SELECT_CALL;
        },
        async () => {
          return [{ id: 1 }];
        },
      );
    });

    expect(answer).toEqual([{ id: 1 }]);

    const request: ReadableSpan = onlySpanNamed("request");
    const query: ReadableSpan = onlySpanNamed("SELECT Monitor");

    expect(query.kind).toBe(SpanKind.CLIENT);
    expect(query.parentSpanContext?.spanId).toBe(request.spanContext().spanId);
    expect(query.attributes).toEqual({
      "db.system.name": "postgresql",
      "db.namespace": "oneuptimedb",
      "db.operation.name": "SELECT",
      "db.query.summary": "SELECT Monitor",
      "db.collection.name": "Monitor",
      "db.query.text": SELECT_CALL.queryText,
      "server.address": "postgres",
      "server.port": 5432,
    });
    expect(query.status.code).toBe(0);
  });

  test("a call outside every trace gets no span", async () => {
    let described: number = 0;

    await traceDatabaseCall(
      () => {
        described++;
        return SELECT_CALL;
      },
      async () => {
        return 1;
      },
    );

    expect(finishedSpans()).toHaveLength(0);
    // Not even summarized: nothing would carry the summary.
    expect(described).toBe(0);
  });

  test("a deployment that exports no spans gets none", async () => {
    jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(false);

    await inRequest(() => {
      return traceDatabaseCall(
        () => {
          return SELECT_CALL;
        },
        async () => {
          return 1;
        },
      );
    });

    expect(
      finishedSpans().map((span: ReadableSpan) => {
        return span.name;
      }),
    ).toEqual(["request"]);
  });

  test("a failed call is an ERROR span with no exception event, and the caller gets the error", async () => {
    const failure: Error = Object.assign(new Error("relation does not exist"), {
      name: "QueryFailedError",
      driverError: { code: "42P01" },
    });

    await expect(
      inRequest(() => {
        return traceDatabaseCall(
          () => {
            return SELECT_CALL;
          },
          async () => {
            throw failure;
          },
        );
      }),
    ).rejects.toBe(failure);

    const query: ReadableSpan = onlySpanNamed("SELECT Monitor");

    expect(query.status).toEqual({
      code: 2,
      message: "relation does not exist",
    });
    expect(query.attributes["error.type"]).toBe("42P01");
    expect(query.attributes["db.response.status_code"]).toBe("42P01");
    expect(query.events).toHaveLength(0);
  });

  test("a call that throws before it starts still ends its span", async () => {
    const failure: Error = new Error("not connected");

    await expect(
      inRequest(async () => {
        return traceDatabaseCall(
          () => {
            return SELECT_CALL;
          },
          () => {
            throw failure;
          },
        );
      }),
    ).rejects.toBe(failure);

    expect(onlySpanNamed("SELECT Monitor").status.code).toBe(2);
  });

  test("a call that cannot be described is still made, untraced", async () => {
    const answer: number = await inRequest(() => {
      return traceDatabaseCall(
        () => {
          throw new Error("unreadable");
        },
        async () => {
          return 7;
        },
      );
    });

    expect(answer).toBe(7);
    expect(
      finishedSpans().map((span: ReadableSpan) => {
        return span.name;
      }),
    ).toEqual(["request"]);
  });

  test("a call with no operation is named for its database", async () => {
    await inRequest(() => {
      return traceDatabaseCall(
        () => {
          return {
            system: DatabaseSystemName.ClickHouse,
            server: {},
            operation: null,
          };
        },
        async () => {
          return 1;
        },
      );
    });

    const span: ReadableSpan = onlySpanNamed("clickhouse");
    expect(span.attributes).toEqual({ "db.system.name": "clickhouse" });
  });
});
