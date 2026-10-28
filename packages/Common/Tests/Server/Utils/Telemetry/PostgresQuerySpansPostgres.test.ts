import {
  afterAll,
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
import { Column, DataSource, Entity, PrimaryColumn, Repository } from "typeorm";
import CancelOnTimeoutClient from "../../../../Server/Infrastructure/Postgres/CancelOnTimeoutClient";
import PostgresQuerySpans from "../../../../Server/Utils/Telemetry/PostgresQuerySpans";
import Telemetry from "../../../../Server/Utils/Telemetry";

/*
 * The statements TypeORM really sends, on a real Postgres, each a CLIENT
 * span of the request that sent it: a repository's save (its existence
 * check, then START TRANSACTION, INSERT and COMMIT), a read, and a statement
 * Postgres refuses. Connections are opened with CancelOnTimeoutClient, as
 * OneUptime's own pools open them.
 *
 * Needs only a bare Postgres - CI's Common test job sets the flag for the
 * one test-setup.sh starts. Everything it creates lives in a schema of its
 * own, dropped afterwards. Locally:
 *
 *   RUN_POSTGRES_QUERY_SPAN_TESTS=true \
 *   POSTGRES_QUERY_SPAN_TEST_DATABASE_HOST=127.0.0.1 \
 *   POSTGRES_QUERY_SPAN_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... \
 *     npx jest Tests/Server/Utils/Telemetry/PostgresQuerySpansPostgres.test.ts
 */

jest.mock("../../../../Server/Utils/Logger");

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_QUERY_SPAN_TESTS"] === "true"
    ? describe
    : describe.skip;

const SCHEMA: string = `query_spans_${process.pid}_${Date.now()}`;

@Entity({ name: "QuerySpanProbe", schema: SCHEMA })
class QuerySpanProbe {
  @PrimaryColumn({ type: "varchar" })
  public id!: string;

  @Column({ type: "varchar" })
  public name!: string;
}

const TABLE: string = `${SCHEMA}.QuerySpanProbe`;

const exporter: InMemorySpanExporter = new InMemorySpanExporter();
const provider: BasicTracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager: AsyncLocalStorageContextManager =
  new AsyncLocalStorageContextManager();

let dataSource: DataSource;
let probes: Repository<QuerySpanProbe>;

function databaseSpans(): Array<ReadableSpan> {
  return exporter.getFinishedSpans().filter((span: ReadableSpan) => {
    return span.kind === SpanKind.CLIENT;
  });
}

function namesOf(spans: Array<ReadableSpan>): Array<string> {
  return spans.map((span: ReadableSpan) => {
    return span.name;
  });
}

// Run `work` as a traced request does, and hand back the request's span id.
async function inRequest(work: () => Promise<void>): Promise<string> {
  return trace
    .getTracer("test")
    .startActiveSpan("request", async (span: Span): Promise<string> => {
      try {
        await work();
        return span.spanContext().spanId;
      } finally {
        span.end();
      }
    });
}

describePostgres("Statements on a real Postgres", () => {
  beforeAll(async () => {
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    trace.setGlobalTracerProvider(provider);

    PostgresQuerySpans.install();

    dataSource = new DataSource({
      type: "postgres",
      host:
        process.env["POSTGRES_QUERY_SPAN_TEST_DATABASE_HOST"] ||
        process.env["DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["POSTGRES_QUERY_SPAN_TEST_DATABASE_PORT"] ||
          process.env["DATABASE_PORT"] ||
          "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["POSTGRES_QUERY_SPAN_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: [QuerySpanProbe],
      synchronize: false,
      extra: { Client: CancelOnTimeoutClient, max: 2 },
    });

    await dataSource.initialize();
    await dataSource.query(`CREATE SCHEMA "${SCHEMA}"`);
    await dataSource.query(
      `CREATE TABLE "${SCHEMA}"."QuerySpanProbe" ("id" varchar PRIMARY KEY, "name" varchar NOT NULL)`,
    );

    probes = dataSource.getRepository(QuerySpanProbe);
  });

  afterAll(async () => {
    try {
      if (dataSource?.isInitialized) {
        await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await dataSource.destroy();
      }
    } finally {
      PostgresQuerySpans.uninstall();
      trace.disable();
      context.disable();
    }
  });

  beforeEach(() => {
    exporter.reset();
    jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(true);
  });

  test("a repository's save is its statements, each a span of the request", async () => {
    const requestSpanId: string = await inRequest(async () => {
      await probes.save(probes.create({ id: "probe-7f3a", name: "first" }));
    });

    const spans: Array<ReadableSpan> = databaseSpans();

    expect(namesOf(spans)).toEqual(
      expect.arrayContaining([
        "START TRANSACTION",
        `INSERT ${TABLE}`,
        "COMMIT",
      ]),
    );

    for (const span of spans) {
      expect(span.parentSpanContext?.spanId).toBe(requestSpanId);
      expect(span.attributes["db.system.name"]).toBe("postgresql");
      expect(span.status.code).not.toBe(2);
      // The values are parameters, never part of the recorded text.
      expect(String(span.attributes["db.query.text"])).not.toContain(
        "probe-7f3a",
      );
    }

    const insert: ReadableSpan = spans.find((span: ReadableSpan) => {
      return span.name === `INSERT ${TABLE}`;
    })!;

    expect(insert.attributes["db.operation.name"]).toBe("INSERT");
    expect(insert.attributes["db.collection.name"]).toBe(TABLE);
    expect(String(insert.attributes["db.query.text"])).toContain("$1");
  });

  test("a read through the repository is one span", async () => {
    let found: QuerySpanProbe | null = null;

    await inRequest(async () => {
      found = await probes.findOneBy({ id: "probe-7f3a" });
    });

    expect(found).toEqual({ id: "probe-7f3a", name: "first" });
    expect(namesOf(databaseSpans())).toEqual([`SELECT ${TABLE}`]);
  });

  test("a statement Postgres refuses is an ERROR span with its SQLSTATE", async () => {
    await inRequest(async () => {
      await expect(
        dataSource.query(`SELECT * FROM "${SCHEMA}"."NoSuchTable"`),
      ).rejects.toThrow();
    });

    expect(databaseSpans()).toHaveLength(1);

    const span: ReadableSpan = databaseSpans()[0]!;

    expect(span.name).toBe(`SELECT ${SCHEMA}.NoSuchTable`);
    expect(span.status.code).toBe(2);
    expect(span.attributes["db.response.status_code"]).toBe("42P01");
    expect(span.events).toHaveLength(0);
  });

  test("a statement outside every request gets no span", async () => {
    await dataSource.query("SELECT 1");

    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});
