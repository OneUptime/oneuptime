import {
  DatabaseConnectOptions,
  DatabaseDriverFactory,
  MongoConnection,
  RedisConnection,
  SqlConnection,
  SqlRow,
} from "../../Executors/Database/DatabaseDrivers";

/*
 * Scripted stand-ins for the four database drivers (DatabaseExecutor's
 * `drivers` seam). Each fake connection records every statement or command
 * it is sent, exactly (text and parameters), answers from a responder the
 * test writes, and records whether it was closed politely or dropped. The
 * factory records every connect with its options, and can refuse, hang or
 * answer late.
 */

// An answer: rows / a reply, an error to throw, or a promise of either.
export type FakeAnswer<T> = T | Error | Promise<T | Error>;

export type SqlResponder = (
  sql: string,
  params: ReadonlyArray<unknown>,
) => FakeAnswer<Array<SqlRow>>;

export type RedisResponder = (
  name: string,
  args: ReadonlyArray<string>,
) => FakeAnswer<unknown>;

export type MongoResponder = (
  database: string,
  command: Record<string, unknown>,
) => FakeAnswer<Record<string, unknown>>;

// A promise that never settles: a statement or connect that hangs.
export function never<T>(): Promise<T> {
  return new Promise<T>((): void => {
    // Never resolves.
  });
}

// An Error with driver-style fields (code, errno, ...).
export function driverError(
  message: string,
  fields: Record<string, unknown> = {},
): Error {
  const err: Error = new Error(message);
  Object.assign(err, fields);
  return err;
}

async function answer<T>(value: FakeAnswer<T>): Promise<T> {
  const settled: T | Error = await value;

  if (settled instanceof Error) {
    throw settled;
  }

  return settled;
}

class FakeConnectionState {
  public closed: boolean = false;
  public destroyed: boolean = false;
}

export class FakeSqlConnection implements SqlConnection {
  public readonly queries: Array<{ sql: string; params: Array<unknown> }> = [];
  public readonly state: FakeConnectionState = new FakeConnectionState();

  public constructor(public responder: SqlResponder) {}

  public async query(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<Array<SqlRow>> {
    const given: Array<unknown> = params ? [...params] : [];
    this.queries.push({ sql, params: given });
    return answer(this.responder(sql, given));
  }

  public close(): Promise<void> {
    this.state.closed = true;
    return Promise.resolve();
  }

  public destroy(): void {
    this.state.destroyed = true;
  }

  // The statements sent, in order.
  public statements(): Array<string> {
    return this.queries.map((query: { sql: string }): string => {
      return query.sql;
    });
  }
}

export class FakeRedisConnection implements RedisConnection {
  public readonly commands: Array<Array<string>> = [];
  public readonly state: FakeConnectionState = new FakeConnectionState();

  public constructor(public responder: RedisResponder) {}

  public async command(
    name: string,
    args: ReadonlyArray<string>,
  ): Promise<unknown> {
    this.commands.push([name, ...args]);
    return answer(this.responder(name, [...args]));
  }

  public close(): Promise<void> {
    this.state.closed = true;
    return Promise.resolve();
  }

  public destroy(): void {
    this.state.destroyed = true;
  }

  // Each command as one line: "CLIENT KILL ID 7".
  public lines(): Array<string> {
    return this.commands.map((words: Array<string>): string => {
      return words.join(" ");
    });
  }
}

export class FakeMongoConnection implements MongoConnection {
  public readonly commands: Array<{
    database: string;
    command: Record<string, unknown>;
  }> = [];
  public readonly state: FakeConnectionState = new FakeConnectionState();

  public constructor(public responder: MongoResponder) {}

  public async command(
    database: string,
    command: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.commands.push({
      database,
      command: JSON.parse(JSON.stringify(command)) as Record<string, unknown>,
    });
    return answer(this.responder(database, command));
  }

  public close(): Promise<void> {
    this.state.closed = true;
    return Promise.resolve();
  }

  public destroy(): void {
    this.state.destroyed = true;
  }

  // The name of each command (its first key), in order.
  public names(): Array<string> {
    return this.commands.map(
      (entry: { command: Record<string, unknown> }): string => {
        return Object.keys(entry.command)[0] || "";
      },
    );
  }
}

export type FakeEngine = "postgres" | "mysql" | "redis" | "mongo";

/*
 * The factory. `connectAnswer` decides each connect: the connection itself
 * (by default), an error, or a promise (a hang, or a late connection).
 */
export class FakeDrivers implements DatabaseDriverFactory {
  public readonly connects: Array<{
    engine: FakeEngine;
    options: DatabaseConnectOptions;
  }> = [];

  public connectAnswer:
    | ((engine: FakeEngine) => Error | Promise<unknown> | null)
    | null = null;

  public constructor(
    public readonly sql: FakeSqlConnection = new FakeSqlConnection(
      (): Array<SqlRow> => {
        return [];
      },
    ),
    public readonly redis: FakeRedisConnection = new FakeRedisConnection(
      (): unknown => {
        return "OK";
      },
    ),
    public readonly mongo: FakeMongoConnection = new FakeMongoConnection(
      (): Record<string, unknown> => {
        return { ok: 1 };
      },
    ),
  ) {}

  public connectPostgres(
    options: DatabaseConnectOptions,
  ): Promise<SqlConnection> {
    return this.connect("postgres", options, this.sql);
  }

  public connectMySql(options: DatabaseConnectOptions): Promise<SqlConnection> {
    return this.connect("mysql", options, this.sql);
  }

  public connectRedis(
    options: DatabaseConnectOptions,
  ): Promise<RedisConnection> {
    return this.connect("redis", options, this.redis);
  }

  public connectMongo(
    options: DatabaseConnectOptions,
  ): Promise<MongoConnection> {
    return this.connect("mongo", options, this.mongo);
  }

  private async connect<T>(
    engine: FakeEngine,
    options: DatabaseConnectOptions,
    connection: T,
  ): Promise<T> {
    this.connects.push({ engine, options: { ...options } });

    const decided: Error | Promise<unknown> | null = this.connectAnswer
      ? this.connectAnswer(engine)
      : null;

    if (decided instanceof Error) {
      throw decided;
    }

    if (decided) {
      await decided;
    }

    return connection;
  }
}
