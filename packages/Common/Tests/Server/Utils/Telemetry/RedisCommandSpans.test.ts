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
import { Command, Redis as RedisClient } from "ioredis";
import timers from "timers";
import RedisCommandSpans from "../../../../Server/Utils/Telemetry/RedisCommandSpans";
import Telemetry from "../../../../Server/Utils/Telemetry";

/*
 * Every command OneUptime's own Valkey connection sends is a CLIENT span of
 * the request or job that sent it, ended as ioredis settles the command.
 * Here the connection is a stand-in that settles real ioredis Commands the
 * way ioredis does; RedisCommandSpansValkey.test.ts runs against a real
 * Valkey.
 */

jest.mock("../../../../Server/Utils/Logger");

const exporter: InMemorySpanExporter = new InMemorySpanExporter();
const provider: BasicTracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager: AsyncLocalStorageContextManager =
  new AsyncLocalStorageContextManager();

interface CommandStream {
  isPipeline?: boolean;
}

interface Sent {
  name: string;
  pipelined: boolean;
}

// The part of an ioredis connection the instrumentation wraps.
class StandInRedis {
  public options: { host: string; port: number; db: number } = {
    host: "valkey.internal",
    port: 6380,
    db: 2,
  };

  public sent: Array<Sent> = [];

  // A command sent again is answered once, as ioredis answers it.
  private answering: Set<Command> = new Set<Command>();

  public sendCommand(command: Command, stream?: CommandStream): unknown {
    this.sent.push({
      name: command.name,
      pipelined: Boolean(stream?.isPipeline),
    });

    if (this.answering.has(command)) {
      return command.promise;
    }

    this.answering.add(command);

    // Node's: Common's jest environment is jsdom, which has no setImmediate.
    timers.setImmediate(() => {
      if (command.name === "lpush") {
        command.reject(
          Object.assign(
            new Error(
              "WRONGTYPE Operation against a key holding the wrong kind of value",
            ),
            { name: "ReplyError" },
          ),
        );
        return;
      }
      command.resolve("OK");
    });

    return command.promise;
  }

  public pipeline(): StandInPipeline {
    return new StandInPipeline(this);
  }

  public multi(options?: { pipeline?: boolean }): unknown {
    if (options && options.pipeline === false) {
      return this.sendCommand(new Command("multi", []));
    }
    const transaction: StandInPipeline = new StandInPipeline(this);
    transaction.queue("multi");
    return transaction;
  }
}

// An ioredis pipeline: its commands go through sendCommand on one stream.
class StandInPipeline {
  private commands: Array<Command> = [];

  public constructor(private readonly redis: StandInRedis) {}

  public get length(): number {
    return this.commands.length;
  }

  public queue(name: string, ...args: Array<string>): this {
    this.commands.push(new Command(name, args));
    return this;
  }

  public exec(): Promise<Array<[Error | null, unknown]>> {
    const stream: CommandStream = { isPipeline: true };

    return Promise.all(
      this.commands.map((command: Command) => {
        this.redis.sendCommand(command, stream);
        return (command.promise as Promise<unknown>).then(
          (value: unknown): [Error | null, unknown] => {
            return [null, value];
          },
          (error: Error): [Error | null, unknown] => {
            return [error, null];
          },
        );
      }),
    );
  }
}

// The stand-in has the part of a connection the instrumentation touches.
function asClient(redis: StandInRedis): RedisClient {
  return redis as unknown as RedisClient;
}

function newInstrumentedRedis(): StandInRedis {
  const redis: StandInRedis = new StandInRedis();
  RedisCommandSpans.instrument(asClient(redis));
  return redis;
}

function send(redis: StandInRedis, command: Command): Promise<unknown> {
  return redis.sendCommand(command) as Promise<unknown>;
}

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

describe("RedisCommandSpans", () => {
  test("a command is a span of the request that sent it, named by the command", async () => {
    const redis: StandInRedis = newInstrumentedRedis();
    const get: Command = new Command("get", ["session-cache-key"]);

    const answer: unknown = await inRequest(() => {
      const promise: Promise<unknown> = send(redis, get);
      // The caller holds the promise ioredis made, not a wrapper's.
      expect(promise).toBe(get.promise);
      return promise;
    });

    expect(answer).toBe("OK");

    const span: ReadableSpan = onlySpanNamed("GET");

    expect(span.kind).toBe(SpanKind.CLIENT);
    expect(span.parentSpanContext?.spanId).toBe(
      onlySpanNamed("request").spanContext().spanId,
    );
    expect(span.attributes).toEqual({
      "db.system.name": "redis",
      "db.namespace": "2",
      "db.operation.name": "GET",
      "db.query.summary": "GET",
      "server.address": "valkey.internal",
      "server.port": 6380,
    });
  });

  test("keys and values are never recorded", async () => {
    const redis: StandInRedis = newInstrumentedRedis();

    await inRequest(() => {
      return send(
        redis,
        new Command("set", ["telemetry-body:abc", "the whole payload"]),
      );
    });

    const span: ReadableSpan = onlySpanNamed("SET");
    expect(JSON.stringify(span.attributes)).not.toContain("telemetry-body");
    expect(JSON.stringify(span.attributes)).not.toContain("payload");
  });

  test("an error reply is an ERROR span named for its kind, and the caller gets the error", async () => {
    const redis: StandInRedis = newInstrumentedRedis();

    await inRequest(async () => {
      await expect(
        send(redis, new Command("lpush", ["a-string-key", "x"])),
      ).rejects.toThrow("WRONGTYPE");
    });

    const span: ReadableSpan = onlySpanNamed("LPUSH");

    expect(span.status.code).toBe(2);
    expect(span.attributes["error.type"]).toBe("WRONGTYPE");
    expect(span.attributes["db.response.status_code"]).toBe("WRONGTYPE");
    expect(span.events).toHaveLength(0);
  });

  test("a command sent again once the connection is back is still one span", async () => {
    const redis: StandInRedis = newInstrumentedRedis();
    const get: Command = new Command("get", ["key"]);

    await inRequest(async () => {
      // ioredis queues a command while disconnected and sends it again later.
      send(redis, get);
      await send(redis, get);
    });

    expect(redis.sent).toHaveLength(2);
    expect(spanNames().sort()).toEqual(["GET", "request"]);
  });

  test("a pipeline is one span for its batch, not one per command", async () => {
    const redis: StandInRedis = newInstrumentedRedis();

    await inRequest(() => {
      return redis
        .pipeline()
        .queue("incr", "counter")
        .queue("expire", "counter", "60")
        .queue("get", "counter")
        .exec();
    });

    expect(
      redis.sent.every((sent: Sent) => {
        return sent.pipelined;
      }),
    ).toBe(true);
    expect(spanNames().sort()).toEqual(["PIPELINE", "request"]);
    expect(
      onlySpanNamed("PIPELINE").attributes["db.operation.batch.size"],
    ).toBe(3);
  });

  test("a MULTI sent as a pipeline is one span; one sent on its own is its commands", async () => {
    const redis: StandInRedis = newInstrumentedRedis();

    await inRequest(async () => {
      await (redis.multi() as StandInPipeline).queue("set", "k", "v").exec();
      await (redis.multi({ pipeline: false }) as Promise<unknown>);
    });

    expect(spanNames().sort()).toEqual(["MULTI", "MULTI", "request"]);
  });

  test("a command outside every trace gets no span", async () => {
    const redis: StandInRedis = newInstrumentedRedis();

    await send(redis, new Command("get", ["key"]));
    await redis.pipeline().queue("get", "key").exec();

    expect(spanNames()).toEqual([]);
  });

  test("a deployment that exports no spans gets none", async () => {
    jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(false);
    const redis: StandInRedis = newInstrumentedRedis();

    await inRequest(() => {
      return send(redis, new Command("get", ["key"]));
    });

    expect(spanNames()).toEqual(["request"]);
  });

  test("a client handed in twice is instrumented once", async () => {
    const redis: StandInRedis = newInstrumentedRedis();
    RedisCommandSpans.instrument(asClient(redis));

    expect(RedisCommandSpans.isInstrumented(asClient(redis))).toBe(true);
    expect(RedisCommandSpans.isInstrumented(asClient(new StandInRedis()))).toBe(
      false,
    );

    await inRequest(() => {
      return send(redis, new Command("del", ["key"]));
    });

    expect(spanNames().sort()).toEqual(["DEL", "request"]);
  });
});
