import { recordingLogger } from "./Helpers/TestSupport";
import assert from "assert";
import fs from "fs";
import path from "path";
import { after, before, describe, test } from "node:test";
import {
  DATABASE_PASSWORD,
  DatabaseHarness,
  assertNoPassword,
  databaseHarness,
  preparedOf,
  readRequest,
  refusalOf,
  runRead,
  runWrite,
  writeRequest,
} from "./Helpers/DatabaseHarness";
import {
  FakeDrivers,
  FakeSqlConnection,
  driverError,
  never,
} from "./Helpers/FakeDatabase";
import { fakePolicy } from "./Helpers/FakeExecutor";
import { makeTempDir } from "./Helpers/FakeBinary";
import { createExecutor } from "../Executors/ExecutorFactory";
import DatabaseExecutor, {
  DEFAULT_CONNECT_TIMEOUT_MS,
  MAX_LOCK_TIMEOUT_MS,
  describeConnectionError,
  describeEngineArgumentProblem,
} from "../Executors/DatabaseExecutor";
import {
  DatabaseConnectOptions,
  SqlRow,
} from "../Executors/Database/DatabaseDrivers";
import {
  DatabaseSettings,
  DatabaseTlsMode,
  resolveDatabaseSettings,
} from "../Executors/Database/DatabaseSettings";
import { POSTGRES_SQL } from "../Executors/Database/PostgresDiagnostics";
import { DATABASE_AI_AGENT_APPLICATION_NAME } from "../Executors/Database/DiagnosticTypes";
import {
  ExecResult,
  PrepareResult,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import {
  MAX_RESOURCE_AGENT_OUTPUT_BYTES,
  ResourceCommandTier,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  DatabaseEngine,
  ParsedDatabaseCommand,
  parseDatabaseCommand,
} from "../Common/Utils/AiRemediation/Resource/DatabaseDiagnosticCatalog";

/*
 * The Database AI agent's executor against FAKE drivers: every connect is
 * recorded with its exact options and every statement with its exact
 * parameters, so each check before a command runs, each connection it
 * opens, what it reports for every way a command can end (answered, failed,
 * stopped before any change, refused by the server, never connected, out of
 * time) and the posture are pinned without a database. The per-engine
 * statements are pinned in <Engine>Diagnostics.test.ts, the real drivers
 * in DatabaseDrivers.test.ts.
 */

const REFUSED: string = "Refused by the Database AI agent";

let tmpDir: string;

before((): void => {
  tmpDir = makeTempDir("agent-database-");
});

after((): void => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// A PostgreSQL server that answers the read wrapper, ping and version.
function postgresAnswers(
  extra: Record<string, Array<SqlRow> | Error> = {},
): FakeSqlConnection {
  return new FakeSqlConnection((sql: string): Array<SqlRow> | Error => {
    if (Object.prototype.hasOwnProperty.call(extra, sql)) {
      return extra[sql] as Array<SqlRow> | Error;
    }

    if (sql === POSTGRES_SQL["ping"]) {
      return [
        { ok: 1, user_name: "oneuptime_monitor", database_name: "postgres" },
      ];
    }

    if (sql === POSTGRES_SQL["probe"]) {
      return [{ server_version: "16.4 (Debian 16.4-1)", in_recovery: false }];
    }

    return [];
  });
}

function harnessWith(
  sql: FakeSqlConnection,
  data: Parameters<typeof databaseHarness>[0] = {},
): DatabaseHarness {
  return databaseHarness({ ...data, drivers: new FakeDrivers(sql) });
}

const WRITES_ON: Record<string, string> = { ONEUPTIME_AI_ALLOW_WRITES: "true" };

// ---- prepare: PrepareGuard first -------------------------------------------------

describe("prepare: the shared checks run first, and nothing connects", () => {
  test("a command for another database server is refused", () => {
    const h: DatabaseHarness = databaseHarness();
    const refusal: string = refusalOf(
      h,
      readRequest(
        h,
        "db ping",
        {},
        {
          resourceIdentifier: "postgresql|other.example.com:5432",
        },
      ),
    );

    assert.match(
      refusal,
      /^Refused by the Database AI agent: this command is for Database server "postgresql\|other\.example\.com:5432", but this agent serves "postgresql\|db\.example\.com:5432"\. Check DATABASE_SYSTEM\+DATABASE_SERVER_ADDRESS\+DATABASE_SERVER_PORT/,
    );
    assert.deepStrictEqual(h.drivers.connects, []);
  });

  test("a payload naming another resource id is refused", () => {
    const h: DatabaseHarness = databaseHarness();

    assert.match(
      refusalOf(h, readRequest(h, "db ping", {}, { resourceId: "other-id" })),
      /this command is for resource id "other-id"/,
    );
  });

  test("an investigation may not cancel a query", () => {
    const h: DatabaseHarness = databaseHarness({ env: WRITES_ON });

    assert.strictEqual(
      refusalOf(h, readRequest(h, "db cancel-query 42")),
      `${REFUSED}: an investigation may only run read-only commands, and "db cancel-query 42" is SafeWrite.`,
    );
    assert.deepStrictEqual(h.drivers.connects, []);
  });

  test("a write needs ONEUPTIME_AI_ALLOW_WRITES=true", () => {
    const h: DatabaseHarness = databaseHarness();

    assert.strictEqual(
      refusalOf(h, writeRequest(h, "db terminate-session 42")),
      `${REFUSED}: "db terminate-session 42" changes the Database server, and this agent is read-only (ONEUPTIME_AI_ALLOW_WRITES is not set). To let OneUptime AI apply fixes, set ONEUPTIME_AI_ALLOW_WRITES=true on the agent and restart it.`,
    );
  });

  test("a write outside ONEUPTIME_AI_WRITE_TARGETS, or at a protected session, is refused", () => {
    const scoped: DatabaseHarness = databaseHarness({
      env: { ...WRITES_ON, ONEUPTIME_AI_WRITE_TARGETS: "session:1*" },
    });

    assert.match(
      refusalOf(scoped, writeRequest(scoped, "db cancel-query 42")),
      /would change session:42, which is outside the targets the Database AI agent may change \(ONEUPTIME_AI_WRITE_TARGETS=session:1\*\)/,
    );
    preparedOf(
      scoped.executor.prepare(writeRequest(scoped, "db cancel-query 17")),
    );

    const guarded: DatabaseHarness = databaseHarness({
      env: { ...WRITES_ON, ONEUPTIME_AI_PROTECTED_TARGETS: "session:42" },
    });

    assert.match(
      refusalOf(guarded, writeRequest(guarded, "db cancel-query 42")),
      /would change session:42, which the Database AI agent protects \(session:42\)/,
    );
  });

  test("a program other than db, SQL, or a tier the agent reads higher never runs", () => {
    const h: DatabaseHarness = databaseHarness({ env: WRITES_ON });

    assert.match(
      refusalOf(h, readRequest(h, ["psql", "-c", "select 1"])),
      /"psql" is not a program the Database AI agent runs \(it runs db\)/,
    );
    assert.match(
      refusalOf(h, readRequest(h, ["db", "sql", "DROP TABLE users"])),
      /^Refused by the Database AI agent: "sql" is not a db operation: db never runs SQL/,
    );
    assert.match(
      refusalOf(
        h,
        readRequest(
          h,
          "db terminate-session 42",
          { origin: "AiRemediation" },
          { tier: ResourceCommandTier.SafeWrite },
        ),
      ),
      /OneUptime sent "db terminate-session 42" as SafeWrite, but this agent's policy reads it as RiskyWrite/,
    );
    assert.deepStrictEqual(h.drivers.connects, []);
  });
});

// ---- prepare: the executor's own checks -------------------------------------------

describe("prepare: the catalog, the settings and the engine", () => {
  test("a policy that ranks a catalog write as a read is refused (the write never runs as a read)", () => {
    const h: DatabaseHarness = databaseHarness({
      env: WRITES_ON,
      guardPolicy: fakePolicy({
        "db cancel-query 42": ResourceCommandTier.Read,
      }),
    });

    assert.strictEqual(
      refusalOf(
        h,
        readRequest(
          h,
          "db cancel-query 42",
          {},
          { tier: ResourceCommandTier.Read },
        ),
      ),
      `${REFUSED}: its command policy reads "db cancel-query 42" as Read, but db cancel-query is SafeWrite in its catalog, so it does not run. Run the agent image version that matches your OneUptime server.`,
    );
  });

  test("a command the catalog cannot read is refused even when a policy allowed it", () => {
    const h: DatabaseHarness = databaseHarness({
      guardPolicy: fakePolicy({ "db frobnicate": ResourceCommandTier.Read }),
    });

    assert.match(
      refusalOf(
        h,
        readRequest(h, "db frobnicate", {}, { tier: ResourceCommandTier.Read }),
      ),
      /^Refused by the Database AI agent: its db catalog refuses "db frobnicate": "frobnicate" is not a db operation/,
    );
  });

  test("an engine without a catalog is refused as not supported for AI diagnostics yet", () => {
    const h: DatabaseHarness = databaseHarness({
      env: {
        DATABASE_SYSTEM: "microsoft.sql_server",
        DATABASE_SERVER_PORT: "1433",
      },
    });

    assert.strictEqual(
      refusalOf(h, readRequest(h, "db ping")),
      `${REFUSED}: DATABASE_SYSTEM="microsoft.sql_server": the Database AI agent does not support Microsoft SQL Server for AI diagnostics yet. It runs its diagnostics on PostgreSQL, MySQL/MariaDB, Redis, MongoDB (Valkey, KeyDB and Dragonfly as Redis). The Database Agent still collects this database's metrics; remove the AI agent's service if you do not want it running.`,
    );
  });

  test("a settings problem is the refusal, naming what to set", () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ DATABASE_ENDPOINT: "" }, /: DATABASE_ENDPOINT is not set\./],
      [{ DATABASE_ENDPOINT: "https://db:5432" }, /is a URL/],
      [
        { DATABASE_USERNAME: "" },
        /: DATABASE_USERNAME is not set\. PostgreSQL needs a login/,
      ],
      [
        { DATABASE_TLS_INSECURE: "on" },
        /DATABASE_TLS_INSECURE="on" is not true or false/,
      ],
    ];

    for (const [env, pattern] of cases) {
      const h: DatabaseHarness = databaseHarness({ env });
      const refusal: string = refusalOf(h, readRequest(h, "db ping"));

      assert.ok(refusal.startsWith(`${REFUSED}: `), refusal);
      assert.match(refusal, pattern);
      assert.deepStrictEqual(h.drivers.connects, []);
    }
  });

  test("what the engine cannot run is refused with what it can", () => {
    const cases: Array<[string, string, RegExp]> = [
      [
        "postgresql",
        "db innodb-status",
        /: db innodb-status is not available on PostgreSQL; on PostgreSQL the operations are ping, version, sessions, long-queries/,
      ],
      ["postgresql", "db info", /db info is not available on PostgreSQL/],
      [
        "redis",
        "db sessions --state idle",
        /--state is not available for db sessions on Redis\.$/,
      ],
      [
        "redis",
        "db cancel-query 5",
        /db cancel-query is not available on Redis/,
      ],
      [
        "mongodb",
        "db terminate-session 5",
        /db terminate-session is not available on MongoDB/,
      ],
      ["redis", "db info wiredTiger", /"wiredTiger" is not a SECTION on Redis/],
      [
        "redis",
        "db sessions --database app",
        /on Redis --database is a database number \(0, 1, \.\.\.\), not "app"\.$/,
      ],
      [
        "mongodb",
        "db table-sizes",
        /on MongoDB db table-sizes needs --database NAME/,
      ],
    ];

    for (const [engine, command, pattern] of cases) {
      const h: DatabaseHarness = databaseHarness({ engine, env: WRITES_ON });
      const argv: Array<string> = command.split(" ");
      const request: ReturnType<typeof readRequest> = readRequest(h, argv, {
        origin:
          command.includes("cancel") || command.includes("terminate")
            ? "AiRemediation"
            : "AiInvestigation",
      });

      assert.match(refusalOf(h, request), pattern, `${engine}: ${command}`);
    }

    // What IS available passes: a Redis database number, MongoDB with --database.
    const redis: DatabaseHarness = databaseHarness({ engine: "redis" });
    preparedOf(
      redis.executor.prepare(readRequest(redis, "db sessions --database 3")),
    );
    const mongo: DatabaseHarness = databaseHarness({ engine: "mongodb" });
    preparedOf(
      mongo.executor.prepare(
        readRequest(mongo, "db table-sizes --database shop"),
      ),
    );
  });

  test("describeEngineArgumentProblem, directly", () => {
    const parse: (text: string) => ParsedDatabaseCommand = (
      text: string,
    ): ParsedDatabaseCommand => {
      const parsed: ReturnType<typeof parseDatabaseCommand> =
        parseDatabaseCommand(text.split(" "));
      assert.ok(parsed.ok);
      return parsed.command;
    };

    assert.strictEqual(
      describeEngineArgumentProblem(
        DatabaseEngine.Redis,
        parse("db sessions --database 15"),
      ),
      null,
    );
    assert.match(
      String(
        describeEngineArgumentProblem(
          DatabaseEngine.Redis,
          parse("db sessions --database 007"),
        ),
      ),
      /database number/,
    );
    assert.strictEqual(
      describeEngineArgumentProblem(
        DatabaseEngine.PostgreSQL,
        parse("db sessions --database app"),
      ),
      null,
    );
  });

  test("a prepared command has the display command and tier, and connects only when run", async () => {
    const h: DatabaseHarness = harnessWith(postgresAnswers(), {
      env: WRITES_ON,
    });
    const prepared: PrepareResult = h.executor.prepare(
      readRequest(h, "db sessions --limit=5 --state active"),
    );

    assert.strictEqual(prepared.refusal, null);
    assert.strictEqual(
      preparedOf(prepared).displayCommand,
      "db sessions --limit 5 --state active",
    );
    assert.strictEqual(preparedOf(prepared).tier, ResourceCommandTier.Read);
    assert.deepStrictEqual(h.drivers.connects, []);

    await preparedOf(prepared).run();
    assert.strictEqual(h.drivers.connects.length, 1);
  });
});

// ---- The connection ------------------------------------------------------------

describe("the connection: exactly the configured settings, one per command", () => {
  test("PostgreSQL: host, port, the $$-halved login, the maintenance database, no TLS, the agent's name", async () => {
    const h: DatabaseHarness = harnessWith(postgresAnswers(), {
      env: {
        DATABASE_USERNAME: "mon$$itor",
        DATABASE_PASSWORD: `${DATABASE_PASSWORD}$$`,
      },
    });

    await runRead(h, "db ping");

    assert.deepStrictEqual(h.drivers.connects, [
      {
        engine: "postgres",
        options: {
          host: "pg.internal",
          port: 5432,
          username: "mon$itor",
          password: `${DATABASE_PASSWORD}$`,
          database: "postgres",
          tls: { mode: DatabaseTlsMode.Off, ca: null },
          connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
          applicationName: DATABASE_AI_AGENT_APPLICATION_NAME,
        },
      },
    ]);
    assert.strictEqual(h.drivers.sql.state.closed, true);
    assert.strictEqual(h.drivers.sql.state.destroyed, false);
  });

  test("the database PostgreSQL connects to: ONEUPTIME_AI_DATABASE_NAME, or table-sizes' --database", async () => {
    const h: DatabaseHarness = harnessWith(postgresAnswers(), {
      env: { ONEUPTIME_AI_DATABASE_NAME: "app" },
    });

    await runRead(h, "db ping");
    await runRead(h, "db table-sizes --database shop");

    assert.deepStrictEqual(
      h.drivers.connects.map(
        (connect: { options: DatabaseConnectOptions }): string => {
          return connect.options.database;
        },
      ),
      ["app", "shop"],
    );
  });

  test("MongoDB authenticates against admin (or ONEUPTIME_AI_DATABASE_NAME); MySQL and Redis take no database", async () => {
    const mongo: DatabaseHarness = databaseHarness({ engine: "mongodb" });
    await runRead(mongo, "db ping");
    const named: DatabaseHarness = databaseHarness({
      engine: "mongodb",
      env: { ONEUPTIME_AI_DATABASE_NAME: "users" },
    });
    await runRead(named, "db ping");
    const redis: DatabaseHarness = databaseHarness({ engine: "redis" });
    redis.drivers.redis.responder = (): unknown => {
      return "PONG";
    };
    await runRead(redis, "db ping");

    assert.strictEqual(mongo.drivers.connects[0]!.engine, "mongo");
    assert.strictEqual(mongo.drivers.connects[0]!.options.database, "admin");
    assert.strictEqual(named.drivers.connects[0]!.options.database, "users");
    assert.strictEqual(redis.drivers.connects[0]!.engine, "redis");
    assert.strictEqual(redis.drivers.connects[0]!.options.database, "");
    assert.strictEqual(redis.drivers.connects[0]!.options.username, "");
    assert.strictEqual(
      redis.drivers.connects[0]!.options.password,
      DATABASE_PASSWORD,
    );
  });

  test("the agent's own login replaces the collector's", async () => {
    const h: DatabaseHarness = harnessWith(postgresAnswers(), {
      env: {
        ONEUPTIME_AI_DATABASE_USERNAME: "oneuptime_ai",
        ONEUPTIME_AI_DATABASE_PASSWORD: "ai-pass$$",
      },
    });

    await runRead(h, "db ping");

    assert.strictEqual(h.drivers.connects[0]!.options.username, "oneuptime_ai");
    assert.strictEqual(h.drivers.connects[0]!.options.password, "ai-pass$$");
  });

  test("only the executor's environment is read: nothing from process.env", async () => {
    const saved: Record<string, string | undefined> = {
      DATABASE_PASSWORD: process.env["DATABASE_PASSWORD"],
      DATABASE_ENDPOINT: process.env["DATABASE_ENDPOINT"],
    };
    process.env["DATABASE_PASSWORD"] = "process-env-password";
    process.env["DATABASE_ENDPOINT"] = "evil.example.com:1";

    try {
      const h: DatabaseHarness = harnessWith(postgresAnswers());
      await runRead(h, "db ping");

      assert.strictEqual(
        h.drivers.connects[0]!.options.password,
        DATABASE_PASSWORD,
      );
      assert.strictEqual(h.drivers.connects[0]!.options.host, "pg.internal");
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  test("TLS: verified with the CA bundle read at connect time; without verification the CA is not used", async () => {
    const caFile: string = path.join(tmpDir, "ca.pem");
    fs.writeFileSync(
      caFile,
      "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
    );

    const verified: DatabaseHarness = harnessWith(postgresAnswers(), {
      env: {
        DATABASE_TLS_INSECURE: "false",
        ONEUPTIME_AI_DATABASE_CA_FILE: caFile,
      },
    });
    await runRead(verified, "db ping");

    assert.deepStrictEqual(verified.drivers.connects[0]!.options.tls, {
      mode: DatabaseTlsMode.Verify,
      ca: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
    });

    const unverified: DatabaseHarness = harnessWith(postgresAnswers(), {
      env: {
        DATABASE_TLS_INSECURE: "false",
        DATABASE_TLS_INSECURE_SKIP_VERIFY: "true",
        ONEUPTIME_AI_DATABASE_CA_FILE: path.join(tmpDir, "missing.pem"),
      },
    });
    await runRead(unverified, "db ping");

    assert.deepStrictEqual(unverified.drivers.connects[0]!.options.tls, {
      mode: DatabaseTlsMode.NoVerify,
      ca: null,
    });
  });

  test("a CA bundle that is missing or not PEM stops the command before it connects", async () => {
    const notPem: string = path.join(tmpDir, "not-pem.txt");
    fs.writeFileSync(notPem, "hello");

    for (const [file, pattern] of [
      [path.join(tmpDir, "absent.pem"), /cannot be read \(ENOENT/],
      [notPem, /holds no PEM certificate/],
      [tmpDir, /is not a PEM file of at most 1048576 bytes/],
    ] as Array<[string, RegExp]>) {
      const h: DatabaseHarness = harnessWith(postgresAnswers(), {
        env: {
          DATABASE_TLS_INSECURE: "false",
          ONEUPTIME_AI_DATABASE_CA_FILE: file,
        },
      });
      const result: ExecResult = await runRead(h, "db ping");

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.exitCode, undefined);
      assert.strictEqual(result.output, "");
      assert.match(
        String(result.errorMessage),
        /^Refused by the Database AI agent: ONEUPTIME_AI_DATABASE_CA_FILE=/,
      );
      assert.match(String(result.errorMessage), pattern);
      assert.deepStrictEqual(h.drivers.connects, []);
    }
  });

  test("the connect timeout never exceeds the command's budget", async () => {
    const h: DatabaseHarness = harnessWith(postgresAnswers());

    await runRead(h, "db ping", { timeoutInMs: 2_500 });

    assert.strictEqual(h.drivers.connects[0]!.options.connectTimeoutMs, 2_500);
  });
});

// ---- How a command ends ------------------------------------------------------------

describe("how a command ends", () => {
  test("answered: exit code 0, the rendered sections, the connection closed politely", async () => {
    const h: DatabaseHarness = harnessWith(postgresAnswers());
    const result: ExecResult = await runRead(h, "db ping");

    assert.deepStrictEqual(result, {
      success: true,
      exitCode: 0,
      output:
        "[stdout]\nstatus:   ok (PostgreSQL answered SELECT 1)\nuser:     oneuptime_monitor\ndatabase: postgres",
    });
    assert.strictEqual(h.drivers.sql.state.closed, true);
  });

  test("the server's statement limit ends before the command's budget, locks wait at most 5 s", async () => {
    const h: DatabaseHarness = harnessWith(postgresAnswers());

    await runRead(h, "db ping", { timeoutInMs: 30_000 });
    await runRead(h, "db ping", { timeoutInMs: 1_200 });

    const timeouts: Array<Array<unknown>> = h.drivers.sql.queries
      .filter((query: { sql: string }): boolean => {
        return query.sql === POSTGRES_SQL["setLocalTimeouts"];
      })
      .map((query: { params: Array<unknown> }): Array<unknown> => {
        return query.params;
      });

    const first: number = Number(timeouts[0]![0]);
    assert.ok(first <= 29_000 && first >= 28_000, String(first));
    assert.strictEqual(timeouts[0]![1], String(MAX_LOCK_TIMEOUT_MS));
    // Never below one second, and never a lock wait longer than the statement.
    assert.deepStrictEqual(timeouts[1], ["1000", "1000"]);
  });

  test("an error answer from the server ran: exit code 1, the reason in words, the connection closed", async () => {
    const h: DatabaseHarness = harnessWith(
      postgresAnswers({
        [POSTGRES_SQL["ping"]!]: driverError(
          "permission denied for function pg_ls_dir",
          { code: "42501" },
        ),
      }),
    );
    const result: ExecResult = await runRead(h, "db ping");

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(
      result.errorMessage,
      'PostgreSQL answered "db ping" with an error: The login "oneuptime_monitor" lacks a privilege this needs (permission denied for function pg_ls_dir). Grant it pg_monitor for reads, and pg_signal_backend to cancel queries or end sessions.',
    );
    assert.strictEqual(result.output, `[stderr]\n${result.errorMessage}`);
    assert.strictEqual(h.drivers.sql.state.closed, true);
    // The read transaction is rolled back even so.
    assert.strictEqual(
      h.drivers.sql.statements().at(-1),
      POSTGRES_SQL["rollback"],
    );
  });

  test("a failed connect never ran: no exit code, no output, and what to change", async () => {
    const h: DatabaseHarness = harnessWith(postgresAnswers(), {
      env: WRITES_ON,
    });
    h.drivers.connectAnswer = (): Error => {
      return driverError("connect ECONNREFUSED 10.0.0.5:5432", {
        code: "ECONNREFUSED",
      });
    };
    const result: ExecResult = await runWrite(h, "db cancel-query 42");

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage:
        'Could not connect to the PostgreSQL server at pg.internal:5432, so "db cancel-query 42" did not run: nothing accepts connections at pg.internal:5432 (DATABASE_ENDPOINT). Check the address, that the server is up, and that it listens on an address the agent\'s container can reach.',
    });
    assert.deepStrictEqual(h.drivers.sql.queries, []);
  });

  test("a connect that never answers gives up at the connect timeout, and a late connection is dropped", async () => {
    let arrive: (() => void) | null = null;
    const h: DatabaseHarness = harnessWith(postgresAnswers(), {
      internals: { connectTimeoutMs: 40 },
    });
    h.drivers.connectAnswer = (): Promise<unknown> => {
      return new Promise<void>((resolve: () => void): void => {
        arrive = resolve;
      });
    };

    const result: ExecResult = await runRead(h, "db ping");

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(result.output, "");
    assert.strictEqual(
      result.errorMessage,
      'Could not connect to the PostgreSQL server at pg.internal:5432, so "db ping" did not run: no answer from pg.internal:5432 within 40 ms: the server is unreachable from the agent (a firewall, the network or the address in DATABASE_ENDPOINT) or overloaded.',
    );

    // The connection shows up after all: it is dropped, never used.
    (arrive as unknown as () => void)();
    await new Promise<void>((resolve: () => void): void => {
      setImmediate(resolve);
    });
    await new Promise<void>((resolve: () => void): void => {
      setImmediate(resolve);
    });
    assert.strictEqual(h.drivers.sql.state.destroyed, true);
    assert.deepStrictEqual(h.drivers.sql.queries, []);
  });

  test("a statement that outlives the budget is killed: the connection is dropped, the run reads as Killed", async () => {
    const h: DatabaseHarness = harnessWith(
      new FakeSqlConnection(
        (sql: string): Promise<Array<SqlRow>> | Array<SqlRow> => {
          return sql === POSTGRES_SQL["ping"] ? never<Array<SqlRow>>() : [];
        },
      ),
    );
    const result: ExecResult = await runRead(h, "db ping", { timeoutInMs: 60 });

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage:
        'Killed (timeout 60ms): db produced no output at all, so the PostgreSQL server did not finish "db ping" within its time budget: it may be overloaded, or the statement waited on a lock (the connection was dropped).',
    });
    assert.strictEqual(h.drivers.sql.state.destroyed, true);
    assert.strictEqual(h.drivers.sql.state.closed, false);
  });

  test("a write stopped before its change never ran; one the server refused ran (exit code 1)", async () => {
    const own: DatabaseHarness = harnessWith(
      postgresAnswers({ [POSTGRES_SQL["ownPid"]!]: [{ pid: 42 }] }),
      { env: WRITES_ON },
    );
    const refused: ExecResult = await runWrite(own, "db cancel-query 42");

    assert.deepStrictEqual(refused, {
      success: false,
      output: "",
      errorMessage:
        "Refused by the Database AI agent: pid 42 is the agent's own connection (session:42); it never signals itself.",
    });

    const denied: DatabaseHarness = harnessWith(
      postgresAnswers({
        [POSTGRES_SQL["ownPid"]!]: [{ pid: 7 }],
        [POSTGRES_SQL["sessionByPid"]!]: [
          { pid: 42, backend_type: "client backend", state: "active" },
        ],
        [POSTGRES_SQL["cancel"]!]: driverError(
          "must be a member of the role whose query is being canceled or member of pg_signal_backend",
          { code: "42501" },
        ),
      }),
      { env: WRITES_ON },
    );
    const result: ExecResult = await runWrite(denied, "db cancel-query 42");

    assert.strictEqual(result.exitCode, 1);
    assert.match(
      String(result.errorMessage),
      /^PostgreSQL answered "db cancel-query 42" with an error: The login "oneuptime_monitor" lacks a privilege this needs .* pg_signal_backend to cancel queries or end sessions\.$/,
    );
  });

  test("run() never throws: an unexpected failure is reported as having maybe reached the database", async () => {
    const sql: FakeSqlConnection = postgresAnswers();
    sql.close = (): Promise<void> => {
      throw new Error("close exploded");
    };
    const h: DatabaseHarness = harnessWith(sql);
    const result: ExecResult = await runRead(h, "db ping");

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(
      result.errorMessage,
      'The Database AI agent failed while running "db ping": close exploded',
    );
    assert.strictEqual(result.output, `[stderr]\n${result.errorMessage}`);
  });
});

// ---- Output ----------------------------------------------------------------------

describe("output: capped, redacted, never the password", () => {
  test("a huge answer is capped at the agent's output limit, with a marker", async () => {
    const rows: Array<SqlRow> = [];

    for (let index: number = 0; index < 3_000; index++) {
      rows.push({
        name: `setting_${index}`,
        setting: "v".repeat(200),
        unit: null,
        source: "default",
      });
    }

    const h: DatabaseHarness = harnessWith(
      postgresAnswers({ [POSTGRES_SQL["allSettings"]!]: rows }),
    );
    const result: ExecResult = await runRead(h, "db settings");

    assert.strictEqual(result.success, true);
    assert.ok(
      Buffer.byteLength(result.output, "utf8") <=
        MAX_RESOURCE_AGENT_OUTPUT_BYTES + 200,
      String(Buffer.byteLength(result.output, "utf8")),
    );
    assert.match(
      result.output,
      /\.\.\. \[output truncated: stdout cut at \d+ bytes\]$/,
    );
  });

  test("the password never appears: not from a driver's message, not from a query, not in the output", async () => {
    const h: DatabaseHarness = harnessWith(
      postgresAnswers({
        [POSTGRES_SQL["ping"]!]: driverError(
          `syntax error at or near "${DATABASE_PASSWORD}"`,
          { code: "42601" },
        ),
      }),
    );
    const failed: ExecResult = await runRead(h, "db ping");

    assert.match(
      String(failed.errorMessage),
      /syntax error at or near "\[redacted\]"/,
    );
    assertNoPassword(failed);

    const sessions: DatabaseHarness = harnessWith(
      postgresAnswers({
        [POSTGRES_SQL["sessions"]!]: [
          {
            pid: 9,
            user_name: "app",
            state: "active",
            query: `ALTER ROLE app PASSWORD '${DATABASE_PASSWORD}'`,
          },
          {
            pid: 10,
            user_name: "app",
            state: "active",
            query: `SELECT * FROM users WHERE email = '${DATABASE_PASSWORD}x' AND id = 7`,
          },
        ],
      }),
    );
    const result: ExecResult = await runRead(sessions, "db sessions");

    assertNoPassword(result);
    assert.match(result.output, /ALTER ROLE app PASSWORD '\?'/);
    assert.match(result.output, /WHERE email = '\?' AND id = \?/);
  });

  test("a NUL byte in a value never reaches the output", async () => {
    const h: DatabaseHarness = harnessWith(
      postgresAnswers({
        [POSTGRES_SQL["version"]!]: [
          { version: "PostgreSQL\u0000 16", server_version: "16" },
        ],
      }),
    );
    const result: ExecResult = await runRead(h, "db version");

    assert.ok(!result.output.includes("\u0000"));
    assert.match(result.output, /version:\s+PostgreSQL 16/);
  });
});

// ---- Posture -------------------------------------------------------------------

describe("the posture", () => {
  test("a reachable PostgreSQL: its version, the connection it uses, never the password", async () => {
    const h: DatabaseHarness = harnessWith(postgresAnswers());
    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.deepStrictEqual(probe, {
      toolVersion: "PostgreSQL 16.4",
      reachable: true,
      reachError: null,
      details: {
        databaseSystem: "postgresql",
        serverAddress: "db.example.com",
        serverPort: 5432,
        databaseEngine: "postgresql",
        connectionEndpoint: "pg.internal:5432",
        tls: "off",
        databaseUser: "oneuptime_monitor",
        credentialSource: "DATABASE_USERNAME/DATABASE_PASSWORD",
        agentLogin: false,
        serverVersion: "16.4",
        inRecovery: false,
      },
      protectedTargets: [],
    });
    assertNoPassword(probe);
    assert.deepStrictEqual(h.drivers.sql.statements(), [POSTGRES_SQL["probe"]]);
    assert.strictEqual(h.drivers.sql.state.closed, true);
    assert.strictEqual(h.drivers.connects[0]!.options.connectTimeoutMs, 6_000);
  });

  test("an engine the agent cannot diagnose is unreachable for that reason, and nothing connects", async () => {
    const h: DatabaseHarness = databaseHarness({
      env: { DATABASE_SYSTEM: "oracle.db", DATABASE_SERVER_PORT: "1521" },
    });
    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(
      String(probe.reachError),
      /^DATABASE_SYSTEM="oracle\.db": the Database AI agent does not support Oracle Database for AI diagnostics yet\./,
    );
    assert.deepStrictEqual(probe.details, {
      databaseSystem: "oracle.db",
      serverAddress: "db.example.com",
      serverPort: 1521,
    });
    assert.deepStrictEqual(h.drivers.connects, []);
  });

  test("a connect failure, a silent server and a server that never answers the probe", async () => {
    const refused: DatabaseHarness = harnessWith(postgresAnswers());
    refused.drivers.connectAnswer = (): Error => {
      return driverError(
        `password authentication failed for user "oneuptime_monitor"`,
        {
          code: "28P01",
        },
      );
    };
    const probe: ResourcePostureProbe = await refused.executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.strictEqual(
      probe.reachError,
      'Could not connect to the PostgreSQL server at pg.internal:5432: PostgreSQL refused the login "oneuptime_monitor" (password authentication failed for user "oneuptime_monitor"). Check DATABASE_USERNAME/DATABASE_PASSWORD, and that pg_hba.conf lets this user connect from the agent\'s address.',
    );
    assert.strictEqual(probe.details?.["databaseEngine"], "postgresql");

    const silent: DatabaseHarness = harnessWith(postgresAnswers(), {
      internals: { postureConnectTimeoutMs: 30 },
    });
    silent.drivers.connectAnswer = (): Promise<unknown> => {
      return never();
    };
    assert.match(
      String((await silent.executor.probePosture()).reachError),
      /^Could not connect to the PostgreSQL server at pg\.internal:5432: no answer from pg\.internal:5432 within 30 ms/,
    );

    const mute: DatabaseHarness = harnessWith(
      new FakeSqlConnection((): Promise<Array<SqlRow>> => {
        return never();
      }),
      { internals: { postureTimeoutMs: 40 } },
    );
    const muted: ResourcePostureProbe = await mute.executor.probePosture();
    assert.strictEqual(
      muted.reachError,
      "The PostgreSQL server at pg.internal:5432 accepted the connection but did not answer: no answer within 40 ms.",
    );
    assert.strictEqual(mute.drivers.sql.state.destroyed, true);
  });

  test("a settings problem, and a driver that throws outright, still answer (never throw)", async () => {
    const unset: DatabaseHarness = databaseHarness({
      env: { DATABASE_ENDPOINT: "" },
    });
    const probe: ResourcePostureProbe = await unset.executor.probePosture();
    assert.strictEqual(probe.reachable, false);
    assert.match(String(probe.reachError), /^DATABASE_ENDPOINT is not set\./);

    const drivers: FakeDrivers = new FakeDrivers();
    drivers.connectPostgres = (): never => {
      throw new Error(`synchronous boom ${DATABASE_PASSWORD}`);
    };
    const broken: DatabaseHarness = databaseHarness({ drivers });
    const thrown: ResourcePostureProbe = await broken.executor.probePosture();

    assert.strictEqual(thrown.reachable, false);
    assert.strictEqual(
      thrown.reachError,
      "Could not connect to the PostgreSQL server at pg.internal:5432: synchronous boom [redacted]",
    );
  });

  test("the probe's engine details: MySQL, Redis and MongoDB", async () => {
    const mysql: DatabaseHarness = databaseHarness({
      engine: "mariadb",
      drivers: new FakeDrivers(
        new FakeSqlConnection((): Array<SqlRow> => {
          return [
            {
              version: "11.4.2-MariaDB-ubu2404",
              version_comment: "mariadb.org binary distribution",
              read_only: 0,
            },
          ];
        }),
      ),
    });
    const mysqlProbe: ResourcePostureProbe =
      await mysql.executor.probePosture();
    assert.strictEqual(mysqlProbe.toolVersion, "MariaDB 11.4.2");
    assert.strictEqual(mysqlProbe.details?.["mariaDb"], true);

    const redis: DatabaseHarness = databaseHarness({ engine: "redis" });
    redis.drivers.redis.responder = (name: string): unknown => {
      return name === "PING"
        ? "PONG"
        : "# Server\r\nredis_version:7.2.4\r\nredis_mode:standalone\r\n";
    };
    assert.strictEqual(
      (await redis.executor.probePosture()).toolVersion,
      "Redis 7.2.4",
    );

    const mongo: DatabaseHarness = databaseHarness({ engine: "mongodb" });
    mongo.drivers.mongo.responder = (
      _database: string,
      command: Record<string, unknown>,
    ): Record<string, unknown> => {
      if ("buildInfo" in command) {
        return { version: "8.0.3", ok: 1 };
      }

      if ("hello" in command) {
        return { setName: "rs0", isWritablePrimary: true, ok: 1 };
      }

      return { ok: 1 };
    };
    const mongoProbe: ResourcePostureProbe =
      await mongo.executor.probePosture();
    assert.strictEqual(mongoProbe.toolVersion, "MongoDB 8.0.3");
    assert.strictEqual(mongoProbe.details?.["replicaSet"], "rs0");
  });
});

// ---- Error descriptions ----------------------------------------------------------

describe("describeConnectionError", () => {
  function settings(env: Record<string, string> = {}): DatabaseSettings {
    return resolveDatabaseSettings({
      DATABASE_SYSTEM: "mysql",
      DATABASE_ENDPOINT: "db.internal:3306",
      DATABASE_USERNAME: "u",
      DATABASE_PASSWORD: "p",
      ...env,
    }).settings as DatabaseSettings;
  }

  test("network failures name the address, and localhost is explained", () => {
    assert.match(
      describeConnectionError(
        driverError("connect ECONNREFUSED 127.0.0.1:3306", {
          code: "ECONNREFUSED",
        }),
        settings({ DATABASE_ENDPOINT: "localhost:3306" }),
        10_000,
      ),
      /^nothing accepts connections at localhost:3306 \(DATABASE_ENDPOINT\)\..* Inside the agent's container localhost is the container itself: use host\.docker\.internal:3306, or run the agent with network_mode: host like the collector\.$/,
    );
    assert.strictEqual(
      describeConnectionError(
        driverError("getaddrinfo ENOTFOUND db.internal", { code: "ENOTFOUND" }),
        settings(),
        10_000,
      ),
      'the host "db.internal" does not resolve from the agent\'s container. Check DATABASE_ENDPOINT.',
    );
    assert.match(
      describeConnectionError(
        driverError("connect EHOSTUNREACH", { code: "EHOSTUNREACH" }),
        settings(),
        10_000,
      ),
      /^there is no network route from the agent's container to db\.internal:3306\.$/,
    );
    assert.match(
      describeConnectionError(
        driverError("read ECONNRESET", { code: "ECONNRESET" }),
        settings(),
        10_000,
      ),
      /^the connection to db\.internal:3306 was closed \(read ECONNRESET\)\./,
    );
  });

  test("timeouts, with the TLS hint when the agent speaks TLS", () => {
    assert.strictEqual(
      describeConnectionError(
        driverError("connect ETIMEDOUT", { code: "ETIMEDOUT" }),
        settings(),
        10_000,
      ),
      "no answer from db.internal:3306 within 10000 ms: the server is unreachable from the agent (a firewall, the network or the address in DATABASE_ENDPOINT) or overloaded.",
    );
    assert.match(
      describeConnectionError(
        driverError("Connection terminated due to connection timeout"),
        settings({ DATABASE_TLS_INSECURE: "false" }),
        5_000,
      ),
      /within 5000 ms: .* The agent speaks TLS \(DATABASE_TLS_INSECURE=false\); a server that does not may never answer it — set DATABASE_TLS_INSECURE=true if it has no TLS\.$/,
    );
  });

  test("TLS: an untrusted certificate, a server without TLS, a server that requires it", () => {
    assert.match(
      describeConnectionError(
        driverError("self-signed certificate in certificate chain", {
          code: "SELF_SIGNED_CERT_IN_CHAIN",
        }),
        settings({ DATABASE_TLS_INSECURE: "false" }),
        10_000,
      ),
      /^the server's TLS certificate is not trusted \(self-signed certificate in certificate chain\)\. Set ONEUPTIME_AI_DATABASE_CA_FILE to the CA bundle that signed it, or DATABASE_TLS_INSECURE_SKIP_VERIFY=true/,
    );
    assert.match(
      describeConnectionError(
        driverError("Hostname/IP does not match certificate's altnames"),
        settings({ DATABASE_TLS_INSECURE: "false" }),
        10_000,
      ),
      /TLS certificate is not trusted/,
    );
    assert.strictEqual(
      describeConnectionError(
        driverError("The server does not support SSL connections"),
        settings({ DATABASE_TLS_INSECURE: "false" }),
        10_000,
      ),
      "the server does not speak TLS on this port (The server does not support SSL connections). Set DATABASE_TLS_INSECURE=true, or turn TLS on in the server.",
    );
    assert.match(
      describeConnectionError(
        driverError("write EPROTO", { code: "EPROTO" }),
        settings(),
        10_000,
      ),
      /the server may require TLS\. Set DATABASE_TLS_INSECURE=false\.$/,
    );
    assert.strictEqual(
      describeConnectionError(
        driverError(
          'no pg_hba.conf entry for host "10.0.0.9", user "u", database "postgres", no encryption',
          { code: "28000" },
        ),
        settings({
          DATABASE_SYSTEM: "postgresql",
          DATABASE_ENDPOINT: "db:5432",
        }),
        10_000,
      ),
      'the server only accepts this login over TLS (no pg_hba.conf entry for host "10.0.0.9", user "u", database "postgres", no encryption). Set DATABASE_TLS_INSECURE=false.',
    );
  });

  test("an error nobody recognises is passed on as it is", () => {
    assert.strictEqual(
      describeConnectionError(new Error("strange"), settings(), 10_000),
      "strange",
    );
    assert.strictEqual(
      describeConnectionError(new Error(""), settings(), 10_000),
      "the driver gave no reason",
    );
  });
});

// ---- The factory ---------------------------------------------------------------

describe("the factory", () => {
  test("a database agent gets a DatabaseExecutor, with no job directories to manage", async () => {
    const h: DatabaseHarness = databaseHarness();
    const executor: ReturnType<typeof createExecutor> = createExecutor({
      config: h.config,
      env: h.env,
      tmpDir,
      logger: recordingLogger(),
    });

    assert.ok(executor instanceof DatabaseExecutor);
    await executor.sweepOrphanedJobDirs();
    await executor.removeAllJobDirs();
    assert.deepStrictEqual(
      fs.readdirSync(tmpDir).filter((name: string): boolean => {
        return name.startsWith("oneuptime-resource-ai-agent");
      }),
      [],
    );
  });
});
