import { ConnectionOptions as TlsConnectionOptions } from "tls";
import net from "net";
import { Client as PgClient, ClientConfig as PgClientConfig } from "pg";
import mysql, {
  Connection as MySqlCoreConnection,
  ConnectionOptions as MySqlConnectionOptions,
  QueryError as MySqlQueryError,
} from "mysql2";
import Redis, { RedisOptions } from "ioredis";
import { BSON, Document, MongoClient, MongoClientOptions } from "mongodb";
import { DatabaseTlsMode } from "./DatabaseSettings";

/*
 * The four database drivers the Database AI agent talks through — pg,
 * mysql2, ioredis and mongodb — behind the few calls the diagnostics make,
 * so the executor and its diagnostics never touch a driver directly and
 * the tests replace all four with scripted fakes (DatabaseExecutor's
 * `drivers` seam).
 *
 * Every connection is one connection for one job:
 *   - made with exactly the options the executor built from its own
 *     environment (host, port, login, TLS, a connect timeout), never a URL
 *     with the login in it, never a pool, never a retry or a reconnect;
 *   - with an "error" listener from the first moment, so a server that
 *     drops the connection between two statements can never crash the
 *     agent with an unhandled "error" event;
 *   - closed with close(), which says goodbye and gives up after
 *     CLOSE_TIMEOUT_MS, or destroy(), which drops the socket at once (a
 *     statement that outlived the job's time budget).
 * MySQL is opened with LOCAL INFILE and multiple statements off, so a
 * hostile server can never ask the agent for a file.
 */

// A Redis user whose ACL leaves a command out.
const NO_PERMISSION_PATTERN: RegExp = /^NOPERM/i;

// How long close() waits for a polite goodbye before dropping the socket.
export const CLOSE_TIMEOUT_MS: number = 2_000;

export interface DatabaseTlsOptions {
  mode: DatabaseTlsMode;
  // PEM CA bundle (ONEUPTIME_AI_DATABASE_CA_FILE's contents), or null.
  ca: string | null;
}

export interface DatabaseConnectOptions {
  host: string;
  port: number;
  // "" when the server has no users (Redis, MongoDB without auth).
  username: string;
  password: string;
  /*
   * PostgreSQL: the database to connect to. MongoDB: the authentication
   * database. Ignored by MySQL and Redis.
   */
  database: string;
  tls: DatabaseTlsOptions;
  connectTimeoutMs: number;
  // How the connection names itself to the server (application_name, ...).
  applicationName: string;
}

export type SqlRow = Record<string, unknown>;

// A PostgreSQL or MySQL connection.
export interface SqlConnection {
  /*
   * One statement, with bind parameters ($1 for PostgreSQL, ? for MySQL);
   * the rows it returned ([] for a statement that returns none).
   */
  query(sql: string, params?: ReadonlyArray<unknown>): Promise<Array<SqlRow>>;
  close(): Promise<void>;
  destroy(): void;
}

export interface RedisConnection {
  // One command, its arguments as separate words (never one string).
  command(name: string, args: ReadonlyArray<string>): Promise<unknown>;
  close(): Promise<void>;
  destroy(): void;
}

export interface MongoConnection {
  /*
   * One database command on one database; the reply as plain JSON (relaxed
   * Extended JSON: 64-bit integers as numbers where they fit, dates as
   * {"$date": ...}).
   */
  command(
    database: string,
    command: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  close(): Promise<void>;
  destroy(): void;
}

export interface DatabaseDriverFactory {
  connectPostgres(options: DatabaseConnectOptions): Promise<SqlConnection>;
  connectMySql(options: DatabaseConnectOptions): Promise<SqlConnection>;
  connectRedis(options: DatabaseConnectOptions): Promise<RedisConnection>;
  connectMongo(options: DatabaseConnectOptions): Promise<MongoConnection>;
}

function noop(): void {
  // Deliberately empty: a late "error" event is already reported elsewhere.
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

// Await a goodbye, but never longer than CLOSE_TIMEOUT_MS; then drop it.
async function closeWithin(
  goodbye: () => Promise<unknown>,
  drop: () => void,
): Promise<void> {
  try {
    await Promise.race([goodbye().catch(noop), sleep(CLOSE_TIMEOUT_MS)]);
  } finally {
    try {
      drop();
    } catch {
      // Already gone.
    }
  }
}

/*
 * A connect (and its handshake) that may not outlive the connect timeout,
 * whatever the driver does: a server that accepts the TCP connection and
 * then says nothing would otherwise hold some drivers (ioredis) forever.
 * The driver gets CONNECT_GRACE_MS more to report its own reason first;
 * then the connection is dropped and the connect fails with ETIMEDOUT.
 */
export const CONNECT_GRACE_MS: number = 250;

async function connectWithin(
  connect: () => Promise<unknown>,
  connectTimeoutMs: number,
  drop: () => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const expired: Promise<never> = new Promise<never>(
    (
      _resolve: (value: never) => void,
      reject: (err: unknown) => void,
    ): void => {
      timer = setTimeout(
        (): void => {
          drop();
          const err: Error & { code?: string } = new Error(
            `connect ETIMEDOUT: no answer within ${connectTimeoutMs} ms`,
          );
          err.code = "ETIMEDOUT";
          reject(err);
        },
        Math.max(1, Math.floor(connectTimeoutMs)) + CONNECT_GRACE_MS,
      );
    },
  );

  try {
    await Promise.race([connect(), expired]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

// Node's TLS options for the mode: never "accept anything" unless asked to.
export function buildTlsOptions(
  tls: DatabaseTlsOptions,
  host: string,
): TlsConnectionOptions | null {
  if (tls.mode === DatabaseTlsMode.Off) {
    return null;
  }

  const options: TlsConnectionOptions = {
    rejectUnauthorized: tls.mode === DatabaseTlsMode.Verify,
  };

  // SNI takes a host name, never an IP address.
  if (!net.isIP(host)) {
    options.servername = host;
  }

  if (tls.ca !== null && tls.mode === DatabaseTlsMode.Verify) {
    options.ca = tls.ca;
  }

  return options;
}

// ---- PostgreSQL (pg) -------------------------------------------------------------

/*
 * Every connection setting is given explicitly — pg falls back to PG*
 * variables and ~/.pgpass only for what it is not given.
 */
export function buildPostgresClientConfig(
  options: DatabaseConnectOptions,
): PgClientConfig {
  const tls: TlsConnectionOptions | null = buildTlsOptions(
    options.tls,
    options.host,
  );

  const config: PgClientConfig = {
    host: options.host,
    port: options.port,
    user: options.username,
    database: options.database,
    ssl: tls === null ? false : tls,
    application_name: options.applicationName,
    connectionTimeoutMillis: Math.max(1, Math.floor(options.connectTimeoutMs)),
    keepAlive: true,
  };

  if (options.password) {
    config.password = options.password;
  }

  return config;
}

async function connectPostgres(
  options: DatabaseConnectOptions,
): Promise<SqlConnection> {
  const client: PgClient = new PgClient(buildPostgresClientConfig(options));
  client.on("error", noop);

  const destroy: () => void = (): void => {
    try {
      client.connection.stream.destroy();
    } catch {
      // Never connected, or already gone.
    }
  };

  try {
    await connectWithin(
      (): Promise<unknown> => {
        return client.connect();
      },
      options.connectTimeoutMs,
      destroy,
    );
  } catch (err: unknown) {
    destroy();
    throw err;
  }

  return {
    query: async (
      sql: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<Array<SqlRow>> => {
      const result: { rows?: Array<SqlRow> } = await client.query(
        sql,
        params ? [...params] : [],
      );
      return Array.isArray(result.rows) ? result.rows : [];
    },
    close: (): Promise<void> => {
      return closeWithin((): Promise<void> => {
        return client.end();
      }, destroy);
    },
    destroy,
  };
}

// ---- MySQL / MariaDB (mysql2) ------------------------------------------------------

export function buildMySqlConnectionOptions(
  options: DatabaseConnectOptions,
): MySqlConnectionOptions {
  const tls: TlsConnectionOptions | null = buildTlsOptions(
    options.tls,
    options.host,
  );

  const config: MySqlConnectionOptions = {
    host: options.host,
    port: options.port,
    user: options.username,
    password: options.password,
    connectTimeout: Math.max(1, Math.floor(options.connectTimeoutMs)),
    // Never LOAD DATA LOCAL (a server could ask for a file), never two statements in one.
    flags: ["-LOCAL_FILES", "-MULTI_STATEMENTS"],
    multipleStatements: false,
    // Numbers and dates exactly as the server sends them.
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    charset: "utf8mb4",
    connectAttributes: { program_name: options.applicationName },
  };

  if (tls !== null) {
    config.ssl = {
      rejectUnauthorized: tls.rejectUnauthorized !== false,
      ...(typeof tls.ca === "string" ? { ca: tls.ca } : {}),
    };
  }

  return config;
}

async function connectMySql(
  options: DatabaseConnectOptions,
): Promise<SqlConnection> {
  const connection: MySqlCoreConnection = mysql.createConnection(
    buildMySqlConnectionOptions(options),
  );
  connection.on("error", noop);

  const destroy: () => void = (): void => {
    try {
      connection.destroy();
    } catch {
      // Already gone.
    }
  };

  try {
    await connectWithin(
      (): Promise<void> => {
        return new Promise<void>(
          (resolve: () => void, reject: (err: unknown) => void): void => {
            connection.connect((err: MySqlQueryError | null): void => {
              if (err) {
                reject(err);
                return;
              }
              resolve();
            });
          },
        );
      },
      options.connectTimeoutMs,
      destroy,
    );
  } catch (err: unknown) {
    destroy();
    throw err;
  }

  return {
    query: (
      sql: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<Array<SqlRow>> => {
      return new Promise<Array<SqlRow>>(
        (
          resolve: (rows: Array<SqlRow>) => void,
          reject: (err: unknown) => void,
        ): void => {
          connection.query(
            { sql, values: params ? [...params] : [] },
            (err: MySqlQueryError | null, result: unknown): void => {
              if (err) {
                reject(err);
                return;
              }

              // A statement that returns no rows answers with a header object.
              resolve(Array.isArray(result) ? (result as Array<SqlRow>) : []);
            },
          );
        },
      );
    },
    close: (): Promise<void> => {
      return closeWithin((): Promise<void> => {
        return new Promise<void>((resolve: () => void): void => {
          connection.end((): void => {
            resolve();
          });
        });
      }, destroy);
    },
    destroy,
  };
}

// ---- Redis and its forks (ioredis) ---------------------------------------------------

// RESP2 replies only: replyMapping is left to ioredis's default ("legacy").
export type AgentRedisOptions = Omit<RedisOptions, "replyMapping">;

export function buildRedisOptions(
  options: DatabaseConnectOptions,
): AgentRedisOptions {
  const tls: TlsConnectionOptions | null = buildTlsOptions(
    options.tls,
    options.host,
  );

  const config: AgentRedisOptions = {
    host: options.host,
    port: options.port,
    connectTimeout: Math.max(1, Math.floor(options.connectTimeoutMs)),
    // Connect only when asked, once: no retries, no offline queue, no resending.
    lazyConnect: true,
    retryStrategy: (): null => {
      return null;
    },
    reconnectOnError: null,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    autoResubscribe: false,
    autoResendUnfulfilledCommands: false,
    // RESP2 (every Redis, KeyDB and Dragonfly speaks it), and no CLIENT SETINFO.
    protocol: 2,
    disableClientInfo: true,
    connectionName: options.applicationName,
    db: 0,
  };

  if (options.username) {
    config.username = options.username;
  }

  if (options.password) {
    config.password = options.password;
  }

  if (tls !== null) {
    config.tls = tls;
  }

  return config;
}

async function connectRedis(
  options: DatabaseConnectOptions,
): Promise<RedisConnection> {
  const client: Redis = new Redis(buildRedisOptions(options));
  /*
   * ioredis reports a refused AUTH as an "error" event and then rejects
   * connect() with a bare "Connection is closed": keep the event's error,
   * which says why.
   */
  let lastError: unknown = null;
  client.on("error", (err: unknown): void => {
    lastError = err;
  });

  const destroy: () => void = (): void => {
    try {
      client.disconnect();
    } catch {
      // Already gone.
    }
  };

  try {
    await connectWithin(
      async (): Promise<void> => {
        await client.connect();
        /*
         * A server that needs a login still accepts the connection
         * without one; PING now, so a missing or refused login is a failed
         * connect (the command never ran), not an error from its first
         * command. A user whose ACL leaves out PING is still connected.
         */
        await client.call("PING").catch((err: unknown): void => {
          if (
            !NO_PERMISSION_PATTERN.test(err instanceof Error ? err.message : "")
          ) {
            throw err;
          }
        });
      },
      options.connectTimeoutMs,
      destroy,
    );
  } catch (err: unknown) {
    destroy();
    throw lastError || err;
  }

  return {
    command: (name: string, args: ReadonlyArray<string>): Promise<unknown> => {
      return client.call(name, ...args);
    },
    close: (): Promise<void> => {
      return closeWithin((): Promise<unknown> => {
        return client.quit();
      }, destroy);
    },
    destroy,
  };
}

// ---- MongoDB (mongodb) -------------------------------------------------------------

// mongodb://host:port/ — never with the login in it (that goes in `auth`).
export function buildMongoUri(host: string, port: number): string {
  return `mongodb://${host.includes(":") ? `[${host}]` : host}:${port}/`;
}

export function buildMongoClientOptions(
  options: DatabaseConnectOptions,
): MongoClientOptions {
  const timeout: number = Math.max(1, Math.floor(options.connectTimeoutMs));

  const config: MongoClientOptions = {
    // This member, never the rest of its replica set.
    directConnection: true,
    appName: options.applicationName,
    serverSelectionTimeoutMS: timeout,
    connectTimeoutMS: timeout,
    maxPoolSize: 1,
    minPoolSize: 0,
    retryReads: false,
    retryWrites: false,
    monitorCommands: false,
    tls: options.tls.mode !== DatabaseTlsMode.Off,
  };

  if (options.tls.mode === DatabaseTlsMode.NoVerify) {
    config.tlsAllowInvalidCertificates = true;
    config.tlsAllowInvalidHostnames = true;
  }

  if (options.tls.mode === DatabaseTlsMode.Verify && options.tls.ca !== null) {
    config.ca = options.tls.ca;
  }

  if (options.username) {
    config.auth = { username: options.username, password: options.password };
    config.authSource = options.database;
  }

  return config;
}

async function connectMongo(
  options: DatabaseConnectOptions,
): Promise<MongoConnection> {
  const client: MongoClient = new MongoClient(
    buildMongoUri(options.host, options.port),
    buildMongoClientOptions(options),
  );

  const destroy: () => void = (): void => {
    client.close(true).catch(noop);
  };

  try {
    await connectWithin(
      (): Promise<unknown> => {
        return client.connect();
      },
      options.connectTimeoutMs,
      destroy,
    );
  } catch (err: unknown) {
    destroy();
    throw err;
  }

  return {
    command: async (
      database: string,
      command: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      const reply: Document = await client
        .db(database)
        .command(command as Document);

      return BSON.EJSON.serialize(reply, { relaxed: true }) as Record<
        string,
        unknown
      >;
    },
    close: (): Promise<void> => {
      return closeWithin((): Promise<void> => {
        return client.close();
      }, destroy);
    },
    destroy,
  };
}

// The real drivers. The executor uses these unless a test injects fakes.
export const NODE_DATABASE_DRIVERS: DatabaseDriverFactory = {
  connectPostgres,
  connectMySql,
  connectRedis,
  connectMongo,
};
