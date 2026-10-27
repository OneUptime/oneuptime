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
import { ClickHouseClient, createClient } from "@clickhouse/client";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";
import ClickhouseDatabase from "../../../../Server/Infrastructure/ClickhouseDatabase";
import GracefulShutdown from "../../../../Server/Utils/GracefulShutdown";
import ClickhouseQuerySpans, {
  describeClickhouseCall,
  getClickhouseServer,
} from "../../../../Server/Utils/Telemetry/ClickhouseQuerySpans";
import Telemetry from "../../../../Server/Utils/Telemetry";

/*
 * Every call a ClickHouse pool of OneUptime's own makes is a CLIENT span of
 * the request or job that made it. The real @clickhouse/client talks HTTP to
 * a stand-in server that answers the way ClickHouse does - rows, an accepted
 * insert, an error - so the client's own code paths run unchanged.
 */

jest.mock("../../../../Server/Utils/Logger");

const exporter: InMemorySpanExporter = new InMemorySpanExporter();
const provider: BasicTracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager: AsyncLocalStorageContextManager =
  new AsyncLocalStorageContextManager();

interface ReceivedRequest {
  path: string;
  statement: string;
  body: string;
}

const received: Array<ReceivedRequest> = [];

// Answers as ClickHouse's HTTP interface does, for what these tests send.
const server: http.Server = http.createServer(
  (request: http.IncomingMessage, response: http.ServerResponse) => {
    let body: string = "";

    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    request.on("end", () => {
      const url: URL = new URL(request.url || "/", "http://localhost");
      const statement: string = url.searchParams.get("query") || body;

      received.push({ path: url.pathname, statement: statement, body: body });

      if (url.pathname === "/ping") {
        response.end("Ok.\n");
        return;
      }

      if (statement.includes("Missing")) {
        response.statusCode = 404;
        response.setHeader("X-ClickHouse-Exception-Code", "60");
        response.end(
          "Code: 60. DB::Exception: Table oneuptime.Missing does not exist. (UNKNOWN_TABLE) (version 24.8.1.1)\n",
        );
        return;
      }

      if (statement.trimStart().startsWith("SELECT")) {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            meta: [{ name: "count", type: "UInt64" }],
            data: [{ count: "3" }],
            rows: 1,
          }),
        );
        return;
      }

      response.end("");
    });
  },
);

let url: string;
let client: ClickHouseClient;

/*
 * Common's jest environment is jsdom, whose setTimeout returns a bare number
 * with no unref(); the client unrefs its socket timers. Lend it Node's for
 * the suite, as GracefulShutdown.test.ts does.
 */
const jsdomSetTimeout: typeof globalThis.setTimeout = globalThis.setTimeout;
const jsdomClearTimeout: typeof globalThis.clearTimeout =
  globalThis.clearTimeout;

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

beforeAll(async () => {
  globalThis.setTimeout = timers.setTimeout as typeof globalThis.setTimeout;
  globalThis.clearTimeout =
    timers.clearTimeout as typeof globalThis.clearTimeout;

  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = createClient({ url: url, database: "oneuptime" });
  ClickhouseQuerySpans.instrument(client, { url: url, database: "oneuptime" });
});

afterAll(async () => {
  await client.close();
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
  trace.disable();
  context.disable();
  globalThis.setTimeout = jsdomSetTimeout;
  globalThis.clearTimeout = jsdomClearTimeout;
});

beforeEach(() => {
  exporter.reset();
  received.length = 0;
  jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ClickhouseQuerySpans", () => {
  test("a read is a span of the request that made it, named for its table", async () => {
    const rows: unknown = await inRequest(async () => {
      const resultSet: { json: () => Promise<unknown> } = await client.query({
        query:
          "SELECT count() AS count FROM oneuptime.Log WHERE projectId = {p0:String}",
        query_params: { p0: "a-project-id" },
        format: "JSON",
      });
      return resultSet.json();
    });

    expect((rows as { data: unknown }).data).toEqual([{ count: "3" }]);

    const span: ReadableSpan = onlySpanNamed("SELECT oneuptime.Log");
    const port: number = Number(new URL(url).port);

    expect(span.kind).toBe(SpanKind.CLIENT);
    expect(span.parentSpanContext?.spanId).toBe(
      onlySpanNamed("request").spanContext().spanId,
    );
    expect(span.attributes).toEqual({
      "db.system.name": "clickhouse",
      "db.namespace": "oneuptime",
      "db.operation.name": "SELECT",
      "db.query.summary": "SELECT oneuptime.Log",
      "db.collection.name": "oneuptime.Log",
      "db.query.text":
        "SELECT count() AS count FROM oneuptime.Log WHERE projectId = {p0:String}",
      "server.address": "127.0.0.1",
      "server.port": port,
    });
    // The parameter travelled to ClickHouse but is not on the span.
    expect(JSON.stringify(span.attributes)).not.toContain("a-project-id");
  });

  test("an insert is a span of the statement, never of its rows", async () => {
    await inRequest(() => {
      return client.insert({
        table: "MetricItemV2",
        values: [{ name: "cpu.usage", value: 0.42, secret: "row-content" }],
        format: "JSONEachRow",
      });
    });

    // The rows did reach the server.
    expect(received[0]!.body).toContain("row-content");

    const span: ReadableSpan = onlySpanNamed("INSERT MetricItemV2");

    expect(span.attributes["db.query.text"]).toBe(
      "INSERT INTO MetricItemV2 FORMAT JSONEachRow",
    );
    expect(JSON.stringify(span.attributes)).not.toContain("row-content");
  });

  test("statements sent with exec and command are spans too", async () => {
    await inRequest(async () => {
      const result: { stream: { destroy: () => void } } = await client.exec({
        query: "ALTER TABLE oneuptime.Log DELETE WHERE projectId = {p0:String}",
        query_params: { p0: "x" },
      });
      result.stream.destroy();
      await client.command({ query: "OPTIMIZE TABLE oneuptime.Log FINAL" });
    });

    expect(spanNames().sort()).toEqual(["ALTER", "OPTIMIZE", "request"]);
  });

  test("an error is an ERROR span with ClickHouse's code and its name", async () => {
    await inRequest(async () => {
      await expect(
        client.query({
          query: "SELECT * FROM oneuptime.Missing",
          format: "JSON",
        }),
      ).rejects.toThrow("does not exist");
    });

    const span: ReadableSpan = onlySpanNamed("SELECT oneuptime.Missing");

    expect(span.status.code).toBe(2);
    expect(span.attributes["error.type"]).toBe("UNKNOWN_TABLE");
    expect(span.attributes["db.response.status_code"]).toBe("60");
    expect(span.events).toHaveLength(0);
  });

  test("a call outside every trace gets no span", async () => {
    await client.command({ query: "SYSTEM FLUSH LOGS" });

    expect(received).toHaveLength(1);
    expect(spanNames()).toEqual([]);
  });

  test("a client handed in twice is instrumented once", async () => {
    ClickhouseQuerySpans.instrument(client, { url: url });

    await inRequest(() => {
      return client.command({ query: "SYSTEM FLUSH LOGS" });
    });

    expect(spanNames().sort()).toEqual(["SYSTEM", "request"]);
  });

  test("the pool ClickhouseDatabase.connect() opens is instrumented", async () => {
    jest.spyOn(GracefulShutdown, "registerHandler").mockImplementation(() => {
      return undefined;
    });

    const database: ClickhouseDatabase = new ClickhouseDatabase({
      url: url,
      database: "oneuptime",
    });

    await database.connect(database.getDatasourceOptions());

    try {
      expect(
        ClickhouseQuerySpans.isInstrumented(database.getDataSource()!),
      ).toBe(true);
    } finally {
      await database.disconnect();
    }
  });
});

describe("describeClickhouseCall", () => {
  test("an insert with no table named is still an INSERT", () => {
    expect(describeClickhouseCall("insert", {}, {})).toEqual({
      system: "clickhouse",
      server: {},
      operation: "INSERT",
      collection: null,
      queryText: undefined,
    });
  });

  test("a call with no statement has no operation", () => {
    expect(describeClickhouseCall("query", undefined, {})).toEqual({
      system: "clickhouse",
      server: {},
      operation: null,
      collection: null,
      queryText: undefined,
    });
  });
});

describe("getClickhouseServer", () => {
  test("ClickHouse's default ports when the URL names none", () => {
    expect(getClickhouseServer({ url: "http://clickhouse" })).toEqual({
      address: "clickhouse",
      port: 8123,
      namespace: undefined,
    });
    expect(
      getClickhouseServer({
        url: "https://user:secret@clickhouse.cloud",
        database: "oneuptime",
      }),
    ).toEqual({
      address: "clickhouse.cloud",
      port: 8443,
      namespace: "oneuptime",
    });
  });

  test("no URL is no address", () => {
    expect(getClickhouseServer({})).toEqual({
      address: undefined,
      port: undefined,
      namespace: undefined,
    });
  });
});
