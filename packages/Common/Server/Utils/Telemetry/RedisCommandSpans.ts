import { Span } from "@opentelemetry/api";
import { Redis as RedisClient } from "ioredis";
import {
  DatabaseServer,
  DatabaseSystemName,
  endDatabaseClientSpan,
  isTracingDatabaseCalls,
  startDatabaseClientSpan,
} from "./DatabaseClientSpan";

/*
 * A CLIENT span for every command OneUptime's own Valkey connection sends
 * (Redis.connect instruments it): GET, SET, EVALSHA, ... named by the
 * command, under the request or job that sent it. See DatabaseClientSpan for
 * the rules every such span follows.
 *
 * Only the instance handed in is instrumented, never ioredis itself: BullMQ's
 * connections poll for jobs every few seconds and keep their locks alive on
 * timers, and the realtime channel's subscriber blocks on its subscription;
 * none of that is work a trace is about.
 *
 * The span is ended from the command's own resolve / reject, as ioredis
 * settles it, so the promise a caller holds is the one ioredis made: an error
 * nobody handles is still reported as unhandled. A command ioredis sends
 * twice - queued while the connection was down, then sent once it is up -
 * is one span, covering the wait.
 *
 * Commands of a pipeline or MULTI are one span for the whole batch
 * ("PIPELINE", "MULTI", with db.operation.batch.size): they travel as one
 * write and are answered together. Arguments are never recorded - keys hold
 * project ids, and values hold cached payloads, session data and whole
 * telemetry bodies.
 */

const INSTRUMENTED: unique symbol = Symbol("oneuptime.redisCommandSpans");
const TRACED_COMMAND: unique symbol = Symbol("oneuptime.redisCommandSpan");

interface RedisCommand {
  name: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  [TRACED_COMMAND]?: boolean | undefined;
}

interface CommandStream {
  isPipeline?: boolean | undefined;
}

interface Executable {
  length?: number | undefined;
  exec: (...args: Array<unknown>) => unknown;
}

interface InstrumentableRedisClient {
  options?:
    | {
        host?: string | undefined;
        port?: number | undefined;
        db?: number | undefined;
      }
    | undefined;
  sendCommand: (
    command: RedisCommand,
    stream?: CommandStream,
    ...rest: Array<unknown>
  ) => unknown;
  pipeline: (...args: Array<unknown>) => unknown;
  multi: (...args: Array<unknown>) => unknown;
  [INSTRUMENTED]?: boolean | undefined;
}

function serverOf(client: InstrumentableRedisClient): DatabaseServer {
  return {
    address: client.options?.host || undefined,
    port: client.options?.port || undefined,
    namespace: String(client.options?.db ?? 0),
  };
}

function isExecutable(value: unknown): value is Executable {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as Executable).exec === "function"
  );
}

export default class RedisCommandSpans {
  public static isInstrumented(client: RedisClient): boolean {
    return Boolean(
      (client as unknown as InstrumentableRedisClient)[INSTRUMENTED],
    );
  }

  // Idempotent: a client is instrumented once, however often it is handed in.
  public static instrument(client: RedisClient): void {
    const redis: InstrumentableRedisClient =
      client as unknown as InstrumentableRedisClient;

    if (redis[INSTRUMENTED]) {
      return;
    }

    redis[INSTRUMENTED] = true;

    const server: DatabaseServer = serverOf(redis);

    const sendCommand: InstrumentableRedisClient["sendCommand"] =
      redis.sendCommand;

    redis.sendCommand = function (
      this: InstrumentableRedisClient,
      command: RedisCommand,
      stream?: CommandStream,
      ...rest: Array<unknown>
    ): unknown {
      if (
        !command ||
        command[TRACED_COMMAND] ||
        stream?.isPipeline ||
        !isTracingDatabaseCalls()
      ) {
        return sendCommand.call(this, command, stream, ...rest);
      }

      command[TRACED_COMMAND] = true;

      const span: Span = startDatabaseClientSpan({
        system: DatabaseSystemName.Redis,
        server: server,
        operation:
          typeof command.name === "string" ? command.name.toUpperCase() : null,
      });

      const resolve: RedisCommand["resolve"] = command.resolve;
      const reject: RedisCommand["reject"] = command.reject;

      command.resolve = (value: unknown): void => {
        endDatabaseClientSpan(span, DatabaseSystemName.Redis);
        resolve(value);
      };

      command.reject = (error: Error): void => {
        endDatabaseClientSpan(span, DatabaseSystemName.Redis, error);
        reject(error);
      };

      try {
        return sendCommand.call(this, command, stream, ...rest);
      } catch (error) {
        // ioredis settles a command it cannot send; this is only a safeguard.
        endDatabaseClientSpan(span, DatabaseSystemName.Redis, error);
        throw error;
      }
    };

    const pipeline: InstrumentableRedisClient["pipeline"] = redis.pipeline;

    redis.pipeline = function (
      this: InstrumentableRedisClient,
      ...args: Array<unknown>
    ): unknown {
      const created: unknown = pipeline.apply(this, args);
      RedisCommandSpans.traceExec(created, "PIPELINE", server);
      return created;
    };

    const multi: InstrumentableRedisClient["multi"] = redis.multi;

    redis.multi = function (
      this: InstrumentableRedisClient,
      ...args: Array<unknown>
    ): unknown {
      const created: unknown = multi.apply(this, args);
      /*
       * multi({ pipeline: false }) sends MULTI at once and answers with a
       * promise: its commands then go one by one, each a span of its own.
       */
      RedisCommandSpans.traceExec(created, "MULTI", server);
      return created;
    };
  }

  /*
   * One span from exec() until the batch is answered. exec() takes a
   * callback as well as handing back a promise, so the promise is observed
   * and handed back as it is, never replaced.
   */
  private static traceExec(
    batch: unknown,
    operation: string,
    server: DatabaseServer,
  ): void {
    if (!isExecutable(batch)) {
      return;
    }

    const exec: Executable["exec"] = batch.exec;

    batch.exec = function (this: Executable, ...args: Array<unknown>): unknown {
      if (!isTracingDatabaseCalls()) {
        return exec.apply(this, args);
      }

      const span: Span = startDatabaseClientSpan({
        system: DatabaseSystemName.Redis,
        server: server,
        operation: operation,
        batchSize: typeof this.length === "number" ? this.length : undefined,
      });

      let result: unknown;

      try {
        result = exec.apply(this, args);
      } catch (error) {
        endDatabaseClientSpan(span, DatabaseSystemName.Redis, error);
        throw error;
      }

      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).then(
          () => {
            endDatabaseClientSpan(span, DatabaseSystemName.Redis);
          },
          (error: unknown) => {
            endDatabaseClientSpan(span, DatabaseSystemName.Redis, error);
          },
        );
      } else {
        endDatabaseClientSpan(span, DatabaseSystemName.Redis);
      }

      return result;
    };
  }
}
