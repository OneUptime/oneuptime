import "./Helpers/TestSupport";
import assert from "assert";
import net from "net";
import { after, describe, test } from "node:test";
import {
  DatabaseConnectOptions,
  DatabaseTlsOptions,
  NODE_DATABASE_DRIVERS,
  RedisConnection,
  buildMongoClientOptions,
  buildMongoUri,
  buildMySqlConnectionOptions,
  buildPostgresClientConfig,
  buildRedisOptions,
  buildTlsOptions,
} from "../Executors/Database/DatabaseDrivers";
import { DatabaseTlsMode } from "../Executors/Database/DatabaseSettings";
import { DATABASE_AI_AGENT_APPLICATION_NAME } from "../Executors/Database/DiagnosticTypes";

/*
 * The real drivers (pg, mysql2, ioredis, mongodb) behind the executor: the
 * exact options each is given, and how each behaves against local stand-in
 * servers — nothing listening, a server that never answers, one that hangs
 * up, and small protocol fakes (a Redis that wants a password, a
 * PostgreSQL without TLS) — so a failed connect rejects promptly with the
 * driver's reason, never crashes the agent with an "error" event, and
 * leaves no socket behind (a leak would keep this test file from exiting).
 */

const OFF: DatabaseTlsOptions = { mode: DatabaseTlsMode.Off, ca: null };

function options(
  overrides: Partial<DatabaseConnectOptions> = {},
): DatabaseConnectOptions {
  return {
    host: "127.0.0.1",
    port: 1,
    username: "monitor",
    password: "secret",
    database: "postgres",
    tls: OFF,
    connectTimeoutMs: 1_500,
    applicationName: DATABASE_AI_AGENT_APPLICATION_NAME,
    ...overrides,
  };
}

const servers: Array<net.Server> = [];
const sockets: Array<net.Socket> = [];

after((): void => {
  for (const socket of sockets) {
    socket.destroy();
  }

  for (const server of servers) {
    server.close();
  }
});

// A local server running `onConnection` for each client; resolves to its port.
function listen(onConnection: (socket: net.Socket) => void): Promise<number> {
  return new Promise<number>((resolve: (port: number) => void): void => {
    const server: net.Server = net.createServer((socket: net.Socket): void => {
      sockets.push(socket);
      socket.on("error", (): void => {
        // The client went away.
      });
      onConnection(socket);
      // Read (and drop) whatever is not handled, so a hang-up is seen.
      socket.resume();
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", (): void => {
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

// A port nothing listens on.
async function closedPort(): Promise<number> {
  const server: net.Server = net.createServer();
  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const port: number = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => {
      resolve();
    });
  });
  return port;
}

async function rejection(
  promise: Promise<unknown>,
): Promise<{ error: Error; ms: number }> {
  const started: number = Date.now();

  try {
    await promise;
  } catch (err: unknown) {
    return { error: err as Error, ms: Date.now() - started };
  }

  throw new Error("expected the connect to fail");
}

type Connector = (options: DatabaseConnectOptions) => Promise<unknown>;

const CONNECTORS: Array<[string, Connector]> = [
  ["pg", NODE_DATABASE_DRIVERS.connectPostgres],
  ["mysql2", NODE_DATABASE_DRIVERS.connectMySql],
  ["ioredis", NODE_DATABASE_DRIVERS.connectRedis],
  ["mongodb", NODE_DATABASE_DRIVERS.connectMongo],
];

describe("the options each driver is given", () => {
  test("TLS: none when off; verification and SNI (never for an IP) when on; the CA only when verifying", () => {
    assert.strictEqual(buildTlsOptions(OFF, "db"), null);
    assert.deepStrictEqual(
      buildTlsOptions(
        { mode: DatabaseTlsMode.Verify, ca: "PEM" },
        "db.internal",
      ),
      { rejectUnauthorized: true, servername: "db.internal", ca: "PEM" },
    );
    assert.deepStrictEqual(
      buildTlsOptions({ mode: DatabaseTlsMode.Verify, ca: null }, "10.0.0.5"),
      { rejectUnauthorized: true },
    );
    assert.deepStrictEqual(
      buildTlsOptions({ mode: DatabaseTlsMode.NoVerify, ca: "PEM" }, "db"),
      { rejectUnauthorized: false, servername: "db" },
    );
  });

  test("pg: every connection setting explicit, the password only when there is one", () => {
    assert.deepStrictEqual(buildPostgresClientConfig(options({ port: 5432 })), {
      host: "127.0.0.1",
      port: 5432,
      user: "monitor",
      database: "postgres",
      ssl: false,
      application_name: DATABASE_AI_AGENT_APPLICATION_NAME,
      connectionTimeoutMillis: 1_500,
      keepAlive: true,
      password: "secret",
    });
    assert.ok(
      !("password" in buildPostgresClientConfig(options({ password: "" }))),
    );
    assert.deepStrictEqual(
      buildPostgresClientConfig(
        options({
          host: "db",
          tls: { mode: DatabaseTlsMode.Verify, ca: null },
        }),
      ).ssl,
      { rejectUnauthorized: true, servername: "db" },
    );
  });

  test("mysql2: no LOCAL INFILE, one statement at a time, numbers and dates as the server sends them", () => {
    const config: ReturnType<typeof buildMySqlConnectionOptions> =
      buildMySqlConnectionOptions(options({ port: 3306 }));

    assert.deepStrictEqual(config.flags, ["-LOCAL_FILES", "-MULTI_STATEMENTS"]);
    assert.strictEqual(config.multipleStatements, false);
    assert.strictEqual(config.bigNumberStrings, true);
    assert.strictEqual(config.dateStrings, true);
    assert.strictEqual(config.connectTimeout, 1_500);
    assert.deepStrictEqual(config.connectAttributes, {
      program_name: DATABASE_AI_AGENT_APPLICATION_NAME,
    });
    assert.ok(!("ssl" in config));
    assert.deepStrictEqual(
      buildMySqlConnectionOptions(
        options({ tls: { mode: DatabaseTlsMode.NoVerify, ca: null } }),
      ).ssl,
      { rejectUnauthorized: false },
    );
    assert.deepStrictEqual(
      buildMySqlConnectionOptions(
        options({ tls: { mode: DatabaseTlsMode.Verify, ca: "PEM" } }),
      ).ssl,
      { rejectUnauthorized: true, ca: "PEM" },
    );
  });

  test("ioredis: connect once when asked, no retries or queues, RESP2, the login only when set", () => {
    const config: ReturnType<typeof buildRedisOptions> = buildRedisOptions(
      options({ username: "", password: "", port: 6379 }),
    );

    assert.strictEqual(config.lazyConnect, true);
    assert.strictEqual(config.maxRetriesPerRequest, 0);
    assert.strictEqual(config.enableOfflineQueue, false);
    assert.strictEqual(config.enableReadyCheck, false);
    assert.strictEqual(config.autoResendUnfulfilledCommands, false);
    assert.strictEqual(config.reconnectOnError, null);
    assert.strictEqual(config.protocol, 2);
    assert.strictEqual(config.disableClientInfo, true);
    assert.strictEqual(
      config.connectionName,
      DATABASE_AI_AGENT_APPLICATION_NAME,
    );
    assert.strictEqual(config.db, 0);
    assert.strictEqual(
      (config.retryStrategy as (times: number) => unknown)(1),
      null,
    );
    assert.ok(!("username" in config));
    assert.ok(!("password" in config));
    assert.ok(!("tls" in config));

    const secured: ReturnType<typeof buildRedisOptions> = buildRedisOptions(
      options({
        tls: { mode: DatabaseTlsMode.Verify, ca: null },
        host: "cache",
      }),
    );
    assert.strictEqual(secured.username, "monitor");
    assert.strictEqual(secured.password, "secret");
    assert.deepStrictEqual(secured.tls, {
      rejectUnauthorized: true,
      servername: "cache",
    });
  });

  test("mongodb: this member only, one connection, no retries, the login in auth (never the URI)", () => {
    assert.strictEqual(
      buildMongoUri("db.internal", 27017),
      "mongodb://db.internal:27017/",
    );
    assert.strictEqual(
      buildMongoUri("fd00::1", 27017),
      "mongodb://[fd00::1]:27017/",
    );

    assert.deepStrictEqual(
      buildMongoClientOptions(options({ database: "admin" })),
      {
        directConnection: true,
        appName: DATABASE_AI_AGENT_APPLICATION_NAME,
        serverSelectionTimeoutMS: 1_500,
        connectTimeoutMS: 1_500,
        maxPoolSize: 1,
        minPoolSize: 0,
        retryReads: false,
        retryWrites: false,
        monitorCommands: false,
        tls: false,
        auth: { username: "monitor", password: "secret" },
        authSource: "admin",
      },
    );

    const open: ReturnType<typeof buildMongoClientOptions> =
      buildMongoClientOptions(
        options({
          username: "",
          password: "",
          tls: { mode: DatabaseTlsMode.NoVerify, ca: null },
        }),
      );
    assert.ok(!("auth" in open));
    assert.strictEqual(open.tls, true);
    assert.strictEqual(open.tlsAllowInvalidCertificates, true);
    assert.strictEqual(open.tlsAllowInvalidHostnames, true);
  });
});

describe("the real drivers against stand-in servers", () => {
  test("nothing listening: every driver rejects promptly with the driver's reason", async () => {
    const port: number = await closedPort();

    for (const [name, connect] of CONNECTORS) {
      const failure: { error: Error; ms: number } = await rejection(
        connect(options({ port, connectTimeoutMs: 1_000 })),
      );

      assert.match(
        `${failure.error.message} ${String((failure.error as unknown as Record<string, unknown>)["code"] ?? "")}`,
        /ECONNREFUSED/,
        name,
      );
      assert.ok(failure.ms < 5_000, `${name} took ${failure.ms} ms`);
    }
  });

  test("a server that never answers: every driver gives up at its connect timeout and hangs up", async () => {
    const opened: Array<{ closed: boolean }> = [];
    const port: number = await listen((socket: net.Socket): void => {
      const entry: { closed: boolean } = { closed: false };
      opened.push(entry);
      socket.on("close", (): void => {
        entry.closed = true;
      });
    });

    for (const [name, connect] of CONNECTORS) {
      const before: number = opened.length;
      const failure: { error: Error; ms: number } = await rejection(
        connect(options({ port, connectTimeoutMs: 400 })),
      );

      assert.ok(
        failure.ms >= 300 && failure.ms < 5_000,
        `${name} took ${failure.ms} ms`,
      );
      assert.ok(opened.length > before, `${name} never connected`);
    }

    // Every socket the drivers opened is closed again.
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 300);
    });
    assert.deepStrictEqual(
      opened.filter((entry: { closed: boolean }): boolean => {
        return !entry.closed;
      }),
      [],
      "a driver left its socket open",
    );
  });

  test("a server that hangs up at once: every driver rejects", async () => {
    const port: number = await listen((socket: net.Socket): void => {
      socket.destroy();
    });

    for (const [name, connect] of CONNECTORS) {
      const failure: { error: Error; ms: number } = await rejection(
        connect(options({ port, connectTimeoutMs: 800 })),
      );
      assert.ok(failure.ms < 5_000, `${name} took ${failure.ms} ms`);
    }
  });

  test("PostgreSQL asked for TLS by a server without it: pg's own reason", async () => {
    const port: number = await listen((socket: net.Socket): void => {
      socket.once("data", (): void => {
        // The SSLRequest: answer "N" (no TLS here).
        socket.write("N");
      });
    });
    const failure: { error: Error; ms: number } = await rejection(
      NODE_DATABASE_DRIVERS.connectPostgres(
        options({ port, tls: { mode: DatabaseTlsMode.NoVerify, ca: null } }),
      ),
    );

    assert.strictEqual(
      failure.error.message,
      "The server does not support SSL connections",
    );
  });

  test("Redis: the login refused at PING is the connect's failure; a working server answers, then says goodbye", async () => {
    const received: Array<string> = [];
    const respond: (socket: net.Socket, needsAuth: boolean) => void = (
      socket: net.Socket,
      needsAuth: boolean,
    ): void => {
      let buffer: string = "";

      socket.on("data", (chunk: Buffer): void => {
        buffer += chunk.toString("utf8");

        // RESP arrays of bulk strings: *N\r\n$len\r\nword\r\n...
        for (;;) {
          const match: RegExpMatchArray | null = buffer.match(/^\*(\d+)\r\n/);

          if (!match) {
            return;
          }

          const words: Array<string> = [];
          let rest: string = buffer.slice(match[0].length);
          let complete: boolean = true;

          for (let index: number = 0; index < Number(match[1]); index++) {
            const word: RegExpMatchArray | null = rest.match(/^\$(\d+)\r\n/);

            if (!word || rest.length < word[0].length + Number(word[1]) + 2) {
              complete = false;
              break;
            }

            words.push(
              rest.slice(word[0].length, word[0].length + Number(word[1])),
            );
            rest = rest.slice(word[0].length + Number(word[1]) + 2);
          }

          if (!complete) {
            return;
          }

          buffer = rest;
          const command: string = words.join(" ").toUpperCase();
          received.push(command);

          if (command.startsWith("CLIENT SETNAME")) {
            socket.write("+OK\r\n");
          } else if (command === "PING") {
            socket.write(
              needsAuth ? "-NOAUTH Authentication required.\r\n" : "+PONG\r\n",
            );
          } else if (command === "QUIT") {
            socket.write("+OK\r\n");
            socket.end();
          } else if (command === "CLIENT ID") {
            socket.write(":42\r\n");
          } else {
            socket.write("-ERR unknown command\r\n");
          }
        }
      });
    };

    const locked: number = await listen((socket: net.Socket): void => {
      respond(socket, true);
    });
    const refused: { error: Error; ms: number } = await rejection(
      NODE_DATABASE_DRIVERS.connectRedis(
        options({ port: locked, username: "", password: "" }),
      ),
    );
    assert.match(refused.error.message, /^NOAUTH Authentication required\./);

    received.length = 0;
    const open: number = await listen((socket: net.Socket): void => {
      respond(socket, false);
    });
    const connection: RedisConnection =
      await NODE_DATABASE_DRIVERS.connectRedis(
        options({ port: open, username: "", password: "" }),
      );

    assert.strictEqual(await connection.command("CLIENT", ["ID"]), 42);
    await assert.rejects(connection.command("FLUSHALL", []), /unknown command/);
    await connection.close();

    assert.deepStrictEqual(received, [
      `CLIENT SETNAME ${DATABASE_AI_AGENT_APPLICATION_NAME.toUpperCase()}`,
      "PING",
      "CLIENT ID",
      "FLUSHALL",
      "QUIT",
    ]);
  });
});
