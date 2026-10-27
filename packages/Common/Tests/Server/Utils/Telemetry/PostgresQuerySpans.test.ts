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
import { PostgresQueryRunner } from "typeorm/driver/postgres/PostgresQueryRunner";
import PostgresQuerySpans, {
  QueryRunnerClass,
  getPostgresServer,
} from "../../../../Server/Utils/Telemetry/PostgresQuerySpans";
import Telemetry from "../../../../Server/Utils/Telemetry";

/*
 * Every statement OneUptime sends its own Postgres is a CLIENT span of the
 * request or job that sent it. The wrapper sits on TypeORM's query runner;
 * here it wraps a stand-in with the same query(), and
 * PostgresQuerySpansPostgres.test.ts runs it on a real Postgres.
 */

jest.mock("../../../../Server/Utils/Logger");

const exporter: InMemorySpanExporter = new InMemorySpanExporter();
const provider: BasicTracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager: AsyncLocalStorageContextManager =
  new AsyncLocalStorageContextManager();

interface SentStatement {
  query: string;
  parameters: Array<unknown> | undefined;
  useStructuredResult: boolean | undefined;
}

const sent: Array<SentStatement> = [];

// What a query runner's query() does, minus the database.
class StandInQueryRunner {
  public driver: { options: Record<string, unknown> } = {
    options: {
      type: "postgres",
      host: "postgres.internal",
      port: 5433,
      database: "oneuptimedb",
      password: "never-recorded",
    },
  };

  public async query(
    query: string,
    parameters?: Array<unknown>,
    useStructuredResult?: boolean,
  ): Promise<unknown> {
    sent.push({ query, parameters, useStructuredResult });

    if (query.startsWith("INSERT")) {
      throw Object.assign(
        new Error('duplicate key value violates unique constraint "UQ_x"'),
        {
          name: "QueryFailedError",
          driverError: { code: "23505" },
        },
      );
    }

    return [{ answer: 42 }];
  }
}

const runnerClass: QueryRunnerClass =
  StandInQueryRunner as unknown as QueryRunnerClass;

function spanNames(): Array<string> {
  return exporter.getFinishedSpans().map((span: ReadableSpan) => {
    return span.name;
  });
}

function onlySpanNamed(name: string): ReadableSpan {
  const spans: Array<ReadableSpan> = exporter
    .getFinishedSpans()
    .filter((span: ReadableSpan) => {
      return span.name === name;
    });
  expect(spans).toHaveLength(1);
  return spans[0]!;
}

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
  PostgresQuerySpans.install(runnerClass);
});

afterAll(() => {
  PostgresQuerySpans.uninstall(runnerClass);
  trace.disable();
  context.disable();
});

beforeEach(() => {
  exporter.reset();
  sent.length = 0;
  jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PostgresQuerySpans", () => {
  test("a statement is a span of the request that sent it, the query run as asked", async () => {
    const runner: StandInQueryRunner = new StandInQueryRunner();

    const answer: unknown = await inRequest(() => {
      return runner.query(
        'SELECT "Monitor"."_id" AS "Monitor__id" FROM "Monitor" "Monitor" WHERE "Monitor"."_id" = $1',
        ["secret-looking-value"],
        true,
      );
    });

    expect(answer).toEqual([{ answer: 42 }]);
    expect(sent).toEqual([
      {
        query:
          'SELECT "Monitor"."_id" AS "Monitor__id" FROM "Monitor" "Monitor" WHERE "Monitor"."_id" = $1',
        parameters: ["secret-looking-value"],
        useStructuredResult: true,
      },
    ]);

    const span: ReadableSpan = onlySpanNamed("SELECT Monitor");

    expect(span.kind).toBe(SpanKind.CLIENT);
    expect(span.parentSpanContext?.spanId).toBe(
      onlySpanNamed("request").spanContext().spanId,
    );
    expect(span.attributes).toEqual({
      "db.system.name": "postgresql",
      "db.namespace": "oneuptimedb",
      "db.operation.name": "SELECT",
      "db.query.summary": "SELECT Monitor",
      "db.collection.name": "Monitor",
      "db.query.text":
        'SELECT "Monitor"."_id" AS "Monitor__id" FROM "Monitor" "Monitor" WHERE "Monitor"."_id" = $1',
      "server.address": "postgres.internal",
      "server.port": 5433,
    });
    // The values a statement is sent with are never recorded.
    expect(JSON.stringify(span.attributes)).not.toContain(
      "secret-looking-value",
    );
    expect(JSON.stringify(span.attributes)).not.toContain("never-recorded");
  });

  test("a statement Postgres refuses is an ERROR span, and the caller gets the error", async () => {
    const runner: StandInQueryRunner = new StandInQueryRunner();

    const error: unknown = await inRequest(async () => {
      try {
        await runner.query('INSERT INTO "Label"("name") VALUES ($1)', ["x"]);
        return null;
      } catch (caught) {
        return caught;
      }
    });

    expect((error as Error).name).toBe("QueryFailedError");

    const span: ReadableSpan = onlySpanNamed("INSERT Label");
    expect(span.status.code).toBe(2);
    expect(span.attributes["error.type"]).toBe("23505");
    expect(span.attributes["db.response.status_code"]).toBe("23505");
    // Never an "exception" event: the caller's @CaptureSpan reports it.
    expect(span.events).toHaveLength(0);
  });

  test("a statement outside every trace is sent and gets no span", async () => {
    const runner: StandInQueryRunner = new StandInQueryRunner();

    await runner.query("SELECT 1");

    expect(sent).toHaveLength(1);
    expect(spanNames()).toEqual([]);
  });

  test("installing twice wraps once", async () => {
    PostgresQuerySpans.install(runnerClass);

    await inRequest(() => {
      return new StandInQueryRunner().query("COMMIT");
    });

    expect(spanNames().sort()).toEqual(["COMMIT", "request"]);
    expect(sent).toHaveLength(1);
  });

  test("TypeORM's own query runner is the one wrapped by default", () => {
    const original: unknown = PostgresQueryRunner.prototype.query;

    try {
      PostgresQuerySpans.install();
      expect(PostgresQuerySpans.isInstalled()).toBe(true);
      expect(PostgresQueryRunner.prototype.query).not.toBe(original);
    } finally {
      PostgresQuerySpans.uninstall();
    }

    expect(PostgresQuerySpans.isInstalled()).toBe(false);
    expect(PostgresQueryRunner.prototype.query).toBe(original);
  });
});

describe("getPostgresServer", () => {
  test("host, port and database, as the data source has them", () => {
    expect(
      getPostgresServer({ host: "db", port: 6432, database: "oneuptime" }),
    ).toEqual({ address: "db", port: 6432, namespace: "oneuptime" });
  });

  test("a URL fills in what the options leave out, without its password", () => {
    const server: unknown = getPostgresServer({
      url: "postgres://user:pass@pg.example:5433/app",
    });

    expect(server).toEqual({
      address: "pg.example",
      port: 5433,
      namespace: "app",
    });
    expect(JSON.stringify(server)).not.toContain("pass");
  });

  test("nothing known is Postgres's default port and nothing else", () => {
    expect(getPostgresServer(undefined)).toEqual({
      address: undefined,
      port: 5432,
      namespace: undefined,
    });
  });
});
