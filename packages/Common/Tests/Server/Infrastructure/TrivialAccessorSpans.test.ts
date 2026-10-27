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
import { Span, context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import LocalCache from "../../../Server/Infrastructure/LocalCache";
import Database from "../../../Server/Infrastructure/PostgresDatabase";
import Queue, { QueueName } from "../../../Server/Infrastructure/Queue";
import Redis from "../../../Server/Infrastructure/Redis";
import IO from "../../../Server/Infrastructure/SocketIO";
import GracefulShutdown from "../../../Server/Utils/GracefulShutdown";
import Realtime from "../../../Server/Utils/Realtime";
import Telemetry from "../../../Server/Utils/Telemetry";

/*
 * ACCESSORS ARE NOT TRACED.
 *
 * One telemetry job's trace on test.oneuptime.com held 3,102 spans, and 1,546
 * of them were Redis.getClient, Redis.isConnected, Database.isConnected and
 * Database.getDataSource: methods that read a field, called before every cache
 * command and every query, each wrapped in a span by @CaptureSpan. They cost
 * microseconds and said nothing, and they made up half of every trace's
 * volume. The datastore calls themselves now get CLIENT spans
 * (DatabaseClientSpan).
 *
 * Each accessor is called here the way production calls it, with spans
 * exported, inside a request's span: the request's span is the only one.
 */

jest.mock("../../../Server/Utils/Logger");

const exporter: InMemorySpanExporter = new InMemorySpanExporter();
const provider: BasicTracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager: AsyncLocalStorageContextManager =
  new AsyncLocalStorageContextManager();

function spanNames(): Array<string> {
  return exporter.getFinishedSpans().map((span: ReadableSpan) => {
    return span.name;
  });
}

// Run `work` inside a request's span, as production does.
function inRequest(work: () => void): void {
  trace.getTracer("test").startActiveSpan("request", (span: Span) => {
    try {
      work();
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
  jest.spyOn(GracefulShutdown, "registerHandler").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Accessors get no span of their own", () => {
  test("the harness records a span that is still captured", async () => {
    // Redis.checkConnnectionStatus keeps @CaptureSpan: it does I/O.
    await new Promise<void>((resolve: () => void) => {
      trace.getTracer("test").startActiveSpan("request", (span: Span) => {
        Redis.checkConnnectionStatus().then(() => {
          span.end();
          resolve();
        });
      });
    });

    expect(spanNames()).toEqual(
      expect.arrayContaining(["Redis.checkConnnectionStatus", "request"]),
    );
  });

  test("Redis's accessors", () => {
    inRequest(() => {
      expect(Redis.getClient()).toBeNull();
      expect(Redis.isConnected()).toBe(false);
      expect(Redis.getRedisOptions()).toEqual(
        expect.objectContaining({ lazyConnect: true }),
      );
    });

    expect(spanNames()).toEqual(["request"]);
  });

  test("Postgres's accessors", () => {
    inRequest(() => {
      expect(Database.getDataSource()).toBeNull();
      expect(Database.isConnected()).toBe(false);
      expect(Database.getDatasourceOptions()).toEqual(
        expect.objectContaining({ type: "postgres" }),
      );
    });

    expect(spanNames()).toEqual(["request"]);
  });

  test("the in-process cache's reads and writes", () => {
    inRequest(() => {
      LocalCache.setString("accessor-spans", "string", "value");
      LocalCache.setNumber("accessor-spans", "number", 7);
      LocalCache.setJSON("accessor-spans", "json", { a: 1 });
      expect(LocalCache.getString("accessor-spans", "string")).toBe("value");
      expect(LocalCache.getNumber("accessor-spans", "number")).toBe(7);
      expect(LocalCache.getJSON("accessor-spans", "json")).toEqual({ a: 1 });
      expect(LocalCache.hasValue("accessor-spans", "string")).toBe(true);
    });

    expect(spanNames()).toEqual(["request"]);
  });

  test("the queue lookup an enqueue makes, and the inspector's route", () => {
    // The first lookup creates the queue; every later one reads a dictionary.
    Queue.getQueue(QueueName.Worker);
    exporter.reset();

    inRequest(() => {
      expect(Queue.getQueue(QueueName.Worker)).toBeDefined();
      expect(Queue.getInspectorRoute()).toBe(
        "/worker/inspect/queue/:dashboardSecret",
      );
    });

    expect(spanNames()).toEqual(["request"]);
  });

  test("the realtime server's accessors, read on every database write", () => {
    (IO as unknown as { socketServer: unknown }).socketServer = {};

    try {
      inRequest(() => {
        expect(IO.getSocketServer()).toEqual({});
        expect(Realtime.isInitialized()).toBe(false);
      });
    } finally {
      (IO as unknown as { socketServer: unknown }).socketServer = null;
    }

    expect(spanNames()).toEqual(["request"]);
  });
});
