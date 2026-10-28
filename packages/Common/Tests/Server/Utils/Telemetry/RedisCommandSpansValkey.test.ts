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
import { Redis as RedisClient, RedisOptions } from "ioredis";

jest.mock("../../../../Server/Utils/Logger");

import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../../Server/Infrastructure/Redis";
import GracefulShutdown from "../../../../Server/Utils/GracefulShutdown";
import RedisCommandSpans from "../../../../Server/Utils/Telemetry/RedisCommandSpans";
import Telemetry from "../../../../Server/Utils/Telemetry";
import getTestRedisConnectionOptions from "../../TestingUtils/Redis/TestRedisOptions";

/*
 * Commands on a real Valkey, each a CLIENT span of the request that sent
 * them: single commands, a pipeline, a MULTI, an error reply. The connection
 * Redis.connect() opens is the instrumented one, and a GlobalCache call on it
 * is one span - its command's.
 *
 * It needs Valkey: CI's test-setup.sh starts one on localhost:6310, which
 * TestRedisOptions points at. Locally, a disposable one:
 *
 *   docker run -d --rm -p 16391:6379 valkey/valkey:9.1-alpine
 *   REDIS_COMMAND_SPANS_TEST_REDIS_URL=redis://localhost:16391 \
 *     npx jest Tests/Server/Utils/Telemetry/RedisCommandSpansValkey.test.ts
 *
 * Only this suite's own keys (a prefix of its own) are touched, and they are
 * removed afterwards.
 */

const KEY_PREFIX: string = `redis-command-spans-test-${process.pid}-${Date.now()}`;

const redisUrl: string | undefined =
  process.env["REDIS_COMMAND_SPANS_TEST_REDIS_URL"];

function testRedisOptions(): RedisOptions {
  if (!redisUrl) {
    return getTestRedisConnectionOptions();
  }

  const url: URL = new URL(redisUrl);

  return {
    host: url.hostname,
    port: Number(url.port || "6379"),
    username: decodeURIComponent(url.username) || undefined,
    password: decodeURIComponent(url.password) || undefined,
    lazyConnect: true,
  };
}

const exporter: InMemorySpanExporter = new InMemorySpanExporter();
const provider: BasicTracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager: AsyncLocalStorageContextManager =
  new AsyncLocalStorageContextManager();

let client: RedisClient;

function key(name: string): string {
  return `${KEY_PREFIX}:${name}`;
}

function clientSpans(): Array<ReadableSpan> {
  return exporter.getFinishedSpans().filter((span: ReadableSpan) => {
    return span.kind === SpanKind.CLIENT;
  });
}

function namesOf(spans: Array<ReadableSpan>): Array<string> {
  return spans.map((span: ReadableSpan) => {
    return span.name;
  });
}

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

describe("Commands on a real Valkey", () => {
  beforeAll(async () => {
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    trace.setGlobalTracerProvider(provider);

    client = new RedisClient(testRedisOptions());
    RedisCommandSpans.instrument(client);
    await client.connect();
  });

  afterAll(async () => {
    try {
      // This suite's keys, and GlobalCache's ("<namespace>-<key>").
      const keys: Array<string> = await client.keys(`${KEY_PREFIX}*`);
      if (keys.length > 0) {
        await client.del(...keys);
      }
      client.disconnect();
    } finally {
      trace.disable();
      context.disable();
    }
  });

  beforeEach(() => {
    exporter.reset();
    jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(true);
  });

  test("each command is a span of the request that sent it", async () => {
    let value: string | null = null;

    const requestSpanId: string = await inRequest(async () => {
      await client.set(key("cache"), "cached value", "EX", 60);
      value = await client.get(key("cache"));
      await client.del(key("cache"));
    });

    expect(value).toBe("cached value");

    const spans: Array<ReadableSpan> = clientSpans();

    expect(namesOf(spans)).toEqual(["SET", "GET", "DEL"]);

    for (const span of spans) {
      expect(span.parentSpanContext?.spanId).toBe(requestSpanId);
      expect(span.attributes["db.system.name"]).toBe("redis");
      expect(span.status.code).not.toBe(2);
      expect(JSON.stringify(span.attributes)).not.toContain(KEY_PREFIX);
      expect(JSON.stringify(span.attributes)).not.toContain("cached value");
    }
  });

  test("a pipeline and a MULTI are a span each", async () => {
    await inRequest(async () => {
      await client
        .pipeline()
        .incr(key("counter"))
        .expire(key("counter"), 60)
        .get(key("counter"))
        .exec();
      await client.multi().incr(key("counter")).get(key("counter")).exec();
    });

    expect(namesOf(clientSpans())).toEqual(["PIPELINE", "MULTI"]);
    expect(clientSpans()[0]!.attributes["db.operation.batch.size"]).toBe(3);
  });

  test("an error reply is an ERROR span named for its kind", async () => {
    await inRequest(async () => {
      await client.set(key("string"), "x", "EX", 60);
      await expect(client.lpush(key("string"), "y")).rejects.toThrow(
        "WRONGTYPE",
      );
    });

    const lpush: ReadableSpan = clientSpans().find((span: ReadableSpan) => {
      return span.name === "LPUSH";
    })!;

    expect(lpush.status.code).toBe(2);
    expect(lpush.attributes["db.response.status_code"]).toBe("WRONGTYPE");
    expect(lpush.events).toHaveLength(0);
  });

  test("commands outside every request get no span", async () => {
    await client.get(key("untraced"));

    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  test("the connection Redis.connect() opens is instrumented, and a cache call is one span: its command's", async () => {
    jest.spyOn(GracefulShutdown, "registerHandler").mockImplementation(() => {
      return undefined;
    });
    jest.spyOn(Redis, "getRedisOptions").mockReturnValue(testRedisOptions());

    try {
      await Redis.connect();
      expect(RedisCommandSpans.isInstrumented(Redis.getClient()!)).toBe(true);

      exporter.reset();
      let cached: string | null = null;

      await inRequest(async () => {
        await GlobalCache.setString(KEY_PREFIX, "global-cache", "value", {
          expiresInSeconds: 60,
        });
        cached = await GlobalCache.getString(KEY_PREFIX, "global-cache");
      });

      expect(cached).toBe("value");
      // No GlobalCache.* frame and no accessor span: the commands alone.
      expect(
        exporter
          .getFinishedSpans()
          .map((span: ReadableSpan) => {
            return span.name;
          })
          .sort(),
      ).toEqual(["GET", "SET", "request"]);
    } finally {
      await Redis.disconnect();
    }
  });
});
