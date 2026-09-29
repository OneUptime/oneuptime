import "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import {
  DatabaseHarness,
  databaseHarness,
  runRead,
  runWrite,
  stdoutOf,
} from "./Helpers/DatabaseHarness";
import {
  FakeDrivers,
  FakeSqlConnection,
  driverError,
} from "./Helpers/FakeDatabase";
import { SqlRow } from "../Executors/Database/DatabaseDrivers";
import {
  POSTGRES_SQL,
  buildTopStatementsSql,
  describePostgresError,
  quotePostgresIdentifier,
} from "../Executors/Database/PostgresDiagnostics";
import { DATABASE_AI_AGENT_APPLICATION_NAME } from "../Executors/Database/DiagnosticTypes";
import { ExecResult } from "../Executors/ResourceExecutor";

/*
 * The db catalog on PostgreSQL: for every operation, exactly which
 * statements are sent, with which bind parameters, inside which read-only
 * wrapper, and what the answer prints as; for the two writes, every check
 * before the signal (the agent's own backend, a pid that is not there,
 * another connection of the agent, a background process, nothing to
 * cancel), the signal itself and the look afterwards.
 */

type Answers = Record<string, Array<SqlRow> | Error>;

function sqlOf(key: string): string {
  const sql: string | undefined = POSTGRES_SQL[key];
  assert.ok(sql, `no statement ${key}`);
  return sql;
}

// A server that answers each statement (by its POSTGRES_SQL key) from the table.
function server(answers: Answers = {}): FakeSqlConnection {
  const bySql: Map<string, Array<SqlRow> | Error> = new Map<
    string,
    Array<SqlRow> | Error
  >();

  for (const [key, value] of Object.entries(answers)) {
    bySql.set(POSTGRES_SQL[key] || key, value);
  }

  return new FakeSqlConnection((sql: string): Array<SqlRow> | Error => {
    return bySql.get(sql) || [];
  });
}

function harness(
  answers: Answers = {},
  env: Record<string, string> = {},
): DatabaseHarness {
  return databaseHarness({
    engine: "postgresql",
    env,
    drivers: new FakeDrivers(server(answers)),
  });
}

const WRITES_ON: Record<string, string> = { ONEUPTIME_AI_ALLOW_WRITES: "true" };

// The statements a read sends between the read-only wrapper.
function readBody(
  h: DatabaseHarness,
): Array<{ sql: string; params: Array<unknown> }> {
  const queries: Array<{ sql: string; params: Array<unknown> }> =
    h.drivers.sql.queries;

  assert.strictEqual(queries[0]!.sql, sqlOf("beginReadOnly"));
  assert.strictEqual(queries[1]!.sql, sqlOf("setLocalTimeouts"));
  assert.strictEqual(queries.at(-1)!.sql, sqlOf("rollback"));

  return queries.slice(2, -1);
}

function session(overrides: SqlRow = {}): SqlRow {
  return {
    pid: 4242,
    user_name: "app",
    database_name: "shop",
    application_name: "checkout",
    client_addr: "10.0.0.8",
    backend_type: "client backend",
    state: "active",
    wait_event_type: "Lock",
    wait_event: "transactionid",
    xact_seconds: 95,
    query_seconds: 90,
    query: "UPDATE orders SET status = 'paid' WHERE id = 991",
    ...overrides,
  };
}

describe("reads run read-only, with time limits, and are rolled back", () => {
  test("BEGIN READ ONLY, SET LOCAL statement_timeout and lock_timeout (as bind parameters), then ROLLBACK", async () => {
    const h: DatabaseHarness = harness({
      ping: [{ ok: 1, user_name: "m", database_name: "postgres" }],
    });

    await runRead(h, "db ping");

    assert.deepStrictEqual(h.drivers.sql.statements(), [
      "BEGIN READ ONLY",
      "SELECT set_config('statement_timeout', $1, true) AS statement_timeout, set_config('lock_timeout', $2, true) AS lock_timeout",
      sqlOf("ping"),
      "ROLLBACK",
    ]);
    const timeouts: Array<unknown> = h.drivers.sql.queries[1]!.params;
    assert.match(String(timeouts[0]), /^\d+$/);
    assert.strictEqual(timeouts[1], "5000");
  });

  test("the transaction is rolled back when a statement fails, and a failing ROLLBACK changes nothing", async () => {
    const h: DatabaseHarness = harness({
      version: driverError("column does not exist", { code: "42703" }),
      rollback: new Error("connection gone"),
    });
    const result: ExecResult = await runRead(h, "db version");

    assert.strictEqual(result.exitCode, 1);
    assert.match(
      String(result.errorMessage),
      /This PostgreSQL version lacks something the diagnostic reads \(column does not exist\)/,
    );
    assert.strictEqual(h.drivers.sql.statements().at(-1), "ROLLBACK");
  });
});

describe("each read", () => {
  test("ping and version", async () => {
    const h: DatabaseHarness = harness({
      ping: [
        { ok: 1, user_name: "oneuptime_monitor", database_name: "postgres" },
      ],
      version: [
        {
          version: "PostgreSQL 16.4 on x86_64",
          server_version: "16.4",
          server_version_num: "160004",
          started_at: new Date("2026-09-01T00:00:00.000Z"),
          uptime: "28 days 10:00:00",
          in_recovery: false,
        },
      ],
    });

    assert.strictEqual(
      stdoutOf(await runRead(h, "db ping")),
      "status:   ok (PostgreSQL answered SELECT 1)\nuser:     oneuptime_monitor\ndatabase: postgres",
    );
    assert.strictEqual(
      stdoutOf(await runRead(h, "db version")),
      [
        "server_version:     16.4",
        "server_version_num: 160004",
        "version:            PostgreSQL 16.4 on x86_64",
        "started_at:         2026-09-01T00:00:00.000Z",
        "uptime:             28 days 10:00:00",
        "in_recovery:        false",
      ].join("\n"),
    );
  });

  test("sessions: filters as bind parameters, limit + 1 asked, query text normalized and last", async () => {
    const h: DatabaseHarness = harness({
      sessions: [
        session(),
        session({
          pid: 77,
          state: "idle in transaction",
          wait_event_type: "Client",
          wait_event: "ClientRead",
          query:
            "SELECT balance FROM accounts WHERE owner = 'jane@example.com'",
        }),
      ],
    });
    const result: ExecResult = await runRead(
      h,
      "db sessions --state idle-in-transaction --user app --database shop --limit 5",
    );

    assert.deepStrictEqual(readBody(h), [
      {
        sql: sqlOf("sessions"),
        params: [
          ["idle in transaction", "idle in transaction (aborted)"],
          "app",
          "shop",
          6,
        ],
      },
    ]);
    assert.strictEqual(
      stdoutOf(result),
      [
        "PID    USER   DATABASE   APPLICATION   CLIENT     BACKEND          STATE                 WAIT                 XACT_S   QUERY_S   QUERY",
        "4242   app    shop       checkout      10.0.0.8   client backend   active                Lock:transactionid   95       90        UPDATE orders SET status = '?' WHERE id = ?",
        "77     app    shop       checkout      10.0.0.8   client backend   idle in transaction   Client:ClientRead    95       90        SELECT balance FROM accounts WHERE owner = '?'",
      ].join("\n"),
    );
    assert.ok(!result.output.includes("jane@example.com"));
  });

  test("sessions: no filters are nulls; the agent's own backend and server processes are left out by the statement", async () => {
    const h: DatabaseHarness = harness();
    const result: ExecResult = await runRead(h, "db sessions");

    assert.deepStrictEqual(readBody(h)[0]!.params, [null, null, null, 51]);
    assert.match(sqlOf("sessions"), /WHERE pid <> pg_backend_pid\(\)/);
    assert.match(
      sqlOf("sessions"),
      /backend_type NOT IN \('archiver', 'autovacuum launcher', 'background writer', 'checkpointer', 'io worker', 'logical replication launcher', 'startup', 'walreceiver', 'walsummarizer', 'walwriter'\)/,
    );
    assert.strictEqual(
      stdoutOf(result),
      "No sessions match (the agent's own session is not listed).",
    );
  });

  test("sessions: more rows than --limit, and queries this login may not see, are both said", async () => {
    const h: DatabaseHarness = harness({
      sessions: [
        session({ pid: 1, query: "<insufficient privilege>" }),
        session({ pid: 2 }),
        session({ pid: 3 }),
      ],
    });
    const out: string = stdoutOf(await runRead(h, "db sessions --limit 2"));

    assert.match(
      out,
      /\n\nShowing the first 2 rows; there are more\. Raise --limit \(at most 200\) or narrow with --state, --user or --database\.\n\nSome sessions show <insufficient privilege>: this login cannot see other roles' queries\. Grant it pg_monitor \(or pg_read_all_stats\) to see them\.$/,
    );
    assert.doesNotMatch(out, /^3 /m);
  });

  test("long-queries: --min-seconds (default 5) and the limit as parameters", async () => {
    const h: DatabaseHarness = harness({ longQueries: [session()] });
    const out: string = stdoutOf(await runRead(h, "db long-queries"));

    assert.deepStrictEqual(readBody(h)[0]!.params, [5, 51]);
    assert.match(
      out,
      /^PID {4}USER {3}DATABASE {3}APPLICATION {3}CLIENT {5}STATE {4}WAIT/,
    );
    assert.ok(!out.includes("BACKEND"));

    const h2: DatabaseHarness = harness();
    const empty: string = stdoutOf(
      await runRead(h2, "db long-queries --min-seconds 120 --limit 3"),
    );
    assert.deepStrictEqual(readBody(h2)[0]!.params, [120, 4]);
    assert.strictEqual(
      empty,
      "No statement has been running for 120 seconds or more.",
    );
  });

  test("blocking: one record per blocked session, both statements normalized", async () => {
    const h: DatabaseHarness = harness({
      blocking: [
        {
          blocked_pid: 11,
          blocked_user: "app",
          database_name: "shop",
          blocked_seconds: 40,
          waiting_on: "Lock:tuple",
          blocking_pid: 12,
          blocking_user: "batch",
          blocking_state: "idle in transaction",
          blocking_xact_seconds: 600,
          blocked_query: "UPDATE t SET a = 1 WHERE id = 5",
          blocking_query: "DELETE FROM t WHERE note = 'secret'",
        },
      ],
    });
    const out: string = stdoutOf(await runRead(h, "db blocking --limit 10"));

    assert.deepStrictEqual(readBody(h)[0]!.params, [11]);
    assert.strictEqual(
      out,
      [
        "Blocked sessions and the sessions blocking them:",
        "[1]",
        "  blocked_pid:           11",
        "  blocked_user:          app",
        "  database:              shop",
        "  blocked_seconds:       40",
        "  waiting_on:            Lock:tuple",
        "  blocking_pid:          12",
        "  blocking_user:         batch",
        "  blocking_state:        idle in transaction",
        "  blocking_xact_seconds: 600",
        "  blocked_query:         UPDATE t SET a = ? WHERE id = ?",
        "  blocking_query:        DELETE FROM t WHERE note = '?'",
      ].join("\n"),
    );
  });

  test("locks: waiting first, the agent's own left out", async () => {
    const h: DatabaseHarness = harness({
      locks: [
        {
          pid: 12,
          user_name: "batch",
          database_name: "shop",
          locktype: "relation",
          relation: "public.orders",
          mode: "AccessExclusiveLock",
          granted: false,
          xact_seconds: 3,
          state: "active",
          query: "ALTER TABLE orders ADD COLUMN x int DEFAULT 0",
        },
      ],
    });
    const out: string = stdoutOf(await runRead(h, "db locks"));

    assert.deepStrictEqual(readBody(h)[0]!.params, [51]);
    assert.match(sqlOf("locks"), /l\.pid IS DISTINCT FROM pg_backend_pid\(\)/);
    assert.match(
      out,
      /^12 {4}batch {3}shop {7}relation {3}public\.orders {3}AccessExclusiveLock {3}false {5}3 {8}active {3}ALTER TABLE orders ADD COLUMN x int DEFAULT \?$/m,
    );
  });

  test("replication on a primary: its replicas and slots, with lag and retained WAL", async () => {
    const h: DatabaseHarness = harness({
      inRecovery: [{ in_recovery: false }],
      primaryReplicas: [
        {
          pid: 90,
          application_name: "replica-1",
          client_addr: "10.0.0.9",
          state: "streaming",
          sync_state: "async",
          sent_lsn: "0/3000148",
          replay_lsn: "0/3000060",
          replay_lag_bytes: "232",
          write_lag: "00:00:00.001",
          flush_lag: null,
          replay_lag: null,
        },
      ],
      primarySlots: [
        {
          slot_name: "replica_1",
          slot_type: "physical",
          database: null,
          active: true,
          active_pid: 90,
          restart_lsn: "0/3000000",
          retained_wal_bytes: "1048576",
        },
      ],
    });
    const out: string = stdoutOf(await runRead(h, "db replication"));

    assert.deepStrictEqual(
      readBody(h).map((query: { sql: string }): string => {
        return query.sql;
      }),
      [sqlOf("inRecovery"), sqlOf("primaryReplicas"), sqlOf("primarySlots")],
    );
    assert.match(out, /^role: primary \(not in recovery\)$/m);
    assert.match(out, /^90 {4}replica-1 {5}10\.0\.0\.9 {3}streaming {3}async/m);
    assert.match(
      out,
      /^replica_1 {3}physical {3}- {10}true {5}90 {11}0\/3000000 {5}1\.0 MiB$/m,
    );
  });

  test("replication on a standby: replay position and delay, the WAL receiver, its slots", async () => {
    const h: DatabaseHarness = harness({
      inRecovery: [{ in_recovery: true }],
      standbyStatus: [
        {
          receive_lsn: "0/5000000",
          replay_lsn: "0/4FFFF00",
          last_replayed_at: new Date("2026-09-29T10:00:00.000Z"),
          replay_delay_seconds: "12",
          replay_paused: false,
        },
      ],
    });
    const out: string = stdoutOf(await runRead(h, "db replication"));

    assert.deepStrictEqual(
      readBody(h).map((query: { sql: string }): string => {
        return query.sql;
      }),
      [
        sqlOf("inRecovery"),
        sqlOf("standbyStatus"),
        sqlOf("standbyReceiver"),
        sqlOf("standbySlots"),
      ],
    );
    assert.match(out, /^role:\s+standby \(in recovery\)$/m);
    assert.match(out, /^replay_delay_seconds:\s+12$/m);
    assert.match(out, /No WAL receiver is running/);
    assert.ok(!sqlOf("standbySlots").includes("pg_current_wal_lsn"));
  });

  test("connections: the totals against max_connections, then who holds them", async () => {
    const h: DatabaseHarness = harness({
      connectionSummary: [
        {
          client_connections: "80",
          active: "10",
          idle_in_transaction: "3",
          max_connections: 100,
          superuser_reserved_connections: 3,
        },
      ],
      connectionGroups: [
        {
          state: "idle",
          user_name: "app",
          database_name: "shop",
          connections: "60",
        },
      ],
    });
    const out: string = stdoutOf(await runRead(h, "db connections"));

    assert.deepStrictEqual(readBody(h)[1]!.params, [201]);
    assert.match(out, /^used_percent:\s+80%$/m);
    assert.match(out, /^idle {4}app {4}shop {7}60$/m);
  });

  test("database-sizes: largest first, and a database this login may not measure", async () => {
    const h: DatabaseHarness = harness({
      databaseSizes: [
        {
          database_name: "shop",
          size_bytes: "5368709120",
          allows_connections: true,
        },
        { database_name: "secret", size_bytes: null, allows_connections: true },
      ],
    });
    const out: string = stdoutOf(await runRead(h, "db database-sizes"));

    assert.strictEqual(
      out,
      [
        "DATABASE   SIZE          SIZE_BYTES   ALLOWS_CONNECTIONS",
        "shop       5.0 GiB       5368709120   true",
        "secret     (no access)   -            true",
      ].join("\n"),
    );
  });

  test("table-sizes: measured in the database it connected to", async () => {
    const h: DatabaseHarness = harness({
      currentDatabase: [{ database_name: "shop" }],
      tableSizes: [
        {
          schema_name: "public",
          table_name: "orders",
          kind: "r",
          total_bytes: "2147483648",
          table_bytes: "1610612736",
          index_bytes: "536870912",
          estimated_rows: "12000000",
        },
      ],
    });
    const out: string = stdoutOf(
      await runRead(h, "db table-sizes --database shop --limit 1"),
    );

    assert.deepStrictEqual(readBody(h)[1]!.params, [2]);
    assert.strictEqual(h.drivers.connects[0]!.options.database, "shop");
    assert.strictEqual(
      out,
      [
        "Largest tables in database shop:",
        "SCHEMA   TABLE    KIND   TOTAL     DATA      INDEXES     ESTIMATED_ROWS",
        "public   orders   r      2.0 GiB   1.5 GiB   512.0 MiB   12000000",
      ].join("\n"),
    );
  });

  test("top-statements: from pg_stat_statements' own schema, with the column names of the server's version", async () => {
    const h: DatabaseHarness = harness({
      currentDatabase: [{ database_name: "shop" }],
      statementsExtension: [{ schema_name: "ext" }],
      serverVersionNum: [{ server_version_num: 120010 }],
      [buildTopStatementsSql({ schema: "ext", serverVersionNum: 120010 })]: [
        {
          query_id: "-42",
          user_name: "app",
          database_name: "shop",
          calls: "1000",
          total_ms: "5000.0",
          mean_ms: "5.00",
          rows: "1000",
          shared_blks_hit: "900",
          shared_blks_read: "100",
          query: "SELECT * FROM orders WHERE id = $1 AND note = 'x'",
        },
      ],
    });
    const out: string = stdoutOf(await runRead(h, "db top-statements"));

    assert.deepStrictEqual(readBody(h).at(-1)!.params, [21]);
    assert.match(
      buildTopStatementsSql({ schema: "ext", serverVersionNum: 120010 }),
      /round\(s\.total_time::numeric, 1\)[\s\S]*FROM "ext"\.pg_stat_statements AS s[\s\S]*ORDER BY s\.total_time DESC/,
    );
    assert.match(
      buildTopStatementsSql({ schema: "public", serverVersionNum: 160000 }),
      /s\.total_exec_time[\s\S]*s\.mean_exec_time/,
    );
    assert.match(out, /SELECT \* FROM orders WHERE id = \$1 AND note = '\?'$/m);
  });

  test("top-statements: the extension missing is said (the command still answered); not loaded is a failure", async () => {
    const missing: DatabaseHarness = harness({
      currentDatabase: [{ database_name: "shop" }],
    });
    const result: ExecResult = await runRead(missing, "db top-statements");

    assert.strictEqual(result.exitCode, 0);
    assert.match(
      stdoutOf(result),
      /^pg_stat_statements is not installed in database shop, so there are no statement statistics to read\. To collect them, add pg_stat_statements to shared_preload_libraries \(a restart\), then run CREATE EXTENSION pg_stat_statements; in shop\.$/,
    );

    const notLoaded: DatabaseHarness = harness({
      currentDatabase: [{ database_name: "shop" }],
      statementsExtension: [{ schema_name: "public" }],
      serverVersionNum: [{ server_version_num: 160000 }],
      [buildTopStatementsSql({ schema: "public", serverVersionNum: 160000 })]:
        driverError(
          'pg_stat_statements must be loaded via "shared_preload_libraries"',
          { code: "55000" },
        ),
    });
    const failed: ExecResult = await runRead(notLoaded, "db top-statements");

    assert.strictEqual(failed.exitCode, 1);
    assert.match(
      String(failed.errorMessage),
      /^pg_stat_statements is installed in database shop but not loaded: add it to shared_preload_libraries and restart PostgreSQL/,
    );
  });

  test("settings: one by name (case-insensitive, as a parameter), a connection string masked, an unknown name failed", async () => {
    const h: DatabaseHarness = harness({
      settingByName: [
        {
          name: "primary_conninfo",
          setting: "host=primary user=rep password=hunter2",
          unit: null,
          source: "configuration file",
          boot_val: "",
          reset_val: "host=primary user=rep password=hunter2",
          pending_restart: false,
          context: "sighup",
          short_desc: "Sets the connection string",
        },
      ],
    });
    const result: ExecResult = await runRead(h, "db settings primary_conninfo");

    assert.deepStrictEqual(readBody(h)[0], {
      sql: sqlOf("settingByName"),
      params: ["primary_conninfo"],
    });
    assert.ok(!result.output.includes("hunter2"));
    assert.match(
      stdoutOf(result),
      /^setting:\s+\[redacted: a connection string\]$/m,
    );

    const unknown: ExecResult = await runRead(harness(), "db settings no_such");
    assert.strictEqual(unknown.exitCode, 1);
    assert.strictEqual(
      unknown.errorMessage,
      'PostgreSQL has no setting named "no_such" (SHOW ALL lists them; db settings with no name prints every one).',
    );
  });

  test("settings: every one, but never a credential setting", async () => {
    const h: DatabaseHarness = harness({
      allSettings: [
        {
          name: "max_connections",
          setting: "100",
          unit: null,
          source: "default",
        },
        {
          name: "ssl_passphrase_command",
          setting: "cat /secret",
          unit: null,
          source: "default",
        },
        { name: "work_mem", setting: "4096", unit: "kB", source: "user" },
      ],
    });
    const out: string = stdoutOf(await runRead(h, "db settings"));

    assert.strictEqual(
      out,
      [
        "NAME              UNIT   SOURCE    SETTING",
        "max_connections   -      default   100",
        "work_mem          kB     user      4096",
        "",
        "1 credential setting(s) are not shown.",
      ].join("\n"),
    );
  });
});

describe("the writes", () => {
  function writeServer(answers: Answers = {}): DatabaseHarness {
    return harness(
      {
        ownPid: [{ pid: 7 }],
        sessionByPid: [session()],
        cancel: [{ signalled: true }],
        terminate: [{ signalled: true }],
        ...answers,
      },
      WRITES_ON,
    );
  }

  test("cancel-query: session limits, its own pid, the target, the signal (pid as a parameter), a second look", async () => {
    let lookups: number = 0;
    const sql: FakeSqlConnection = new FakeSqlConnection(
      (text: string): Array<SqlRow> => {
        if (text === sqlOf("ownPid")) {
          return [{ pid: 7 }];
        }

        if (text === sqlOf("sessionByPid")) {
          lookups++;
          return lookups === 1 ? [session()] : [session({ state: "idle" })];
        }

        if (text === sqlOf("cancel")) {
          return [{ signalled: true }];
        }

        return [];
      },
    );
    const h: DatabaseHarness = databaseHarness({
      env: WRITES_ON,
      drivers: new FakeDrivers(sql),
    });
    const result: ExecResult = await runWrite(h, "db cancel-query 4242");

    assert.deepStrictEqual(
      sql.queries.map((query: { sql: string; params: Array<unknown> }) => {
        return [query.sql, query.params.length ? query.params : undefined];
      }),
      [
        [sqlOf("setSessionTimeouts"), sql.queries[0]!.params],
        [sqlOf("ownPid"), undefined],
        [sqlOf("sessionByPid"), [4242]],
        [sqlOf("cancel"), [4242]],
        [sqlOf("sessionByPid"), [4242]],
      ],
    );
    assert.ok(!sql.statements().includes("BEGIN READ ONLY"));
    assert.deepStrictEqual(h.sleeps, [250]);
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(
      stdoutOf(result),
      [
        "Cancelled the running statement of session 4242 (pg_cancel_backend). The session stays connected.",
        "",
        "The session, before:",
        "pid:           4242",
        "user:          app",
        "database:      shop",
        "application:   checkout",
        "client:        10.0.0.8",
        "state:         active",
        "query_seconds: 90",
        "query:         UPDATE orders SET status = '?' WHERE id = ?",
        "",
        "Session 4242 is now idle.",
      ].join("\n"),
    );
  });

  test("terminate-session: pg_terminate_backend, then the session is gone", async () => {
    let lookups: number = 0;
    const h: DatabaseHarness = databaseHarness({
      env: WRITES_ON,
      drivers: new FakeDrivers(
        new FakeSqlConnection((text: string): Array<SqlRow> => {
          if (text === sqlOf("ownPid")) {
            return [{ pid: 7 }];
          }

          if (text === sqlOf("sessionByPid")) {
            lookups++;
            return lookups === 1
              ? [session({ state: "idle in transaction" })]
              : [];
          }

          return text === sqlOf("terminate") ? [{ signalled: true }] : [];
        }),
      ),
    });
    const result: ExecResult = await runWrite(h, "db terminate-session 4242");

    assert.ok(h.drivers.sql.statements().includes(sqlOf("terminate")));
    assert.match(
      stdoutOf(result),
      /^Terminated session 4242 \(pg_terminate_backend\): its open transaction is rolled back and its client must reconnect\.[\s\S]*\n\nSession 4242 is gone\.$/,
    );
  });

  test("never its own backend, and never a pid that is not there: no signal is sent", async () => {
    const own: DatabaseHarness = writeServer({ ownPid: [{ pid: 4242 }] });
    const refused: ExecResult = await runWrite(
      own,
      "db terminate-session 4242",
    );

    assert.deepStrictEqual(refused, {
      success: false,
      output: "",
      errorMessage:
        "Refused by the Database AI agent: pid 4242 is the agent's own connection (session:4242); it never signals itself.",
    });

    const gone: DatabaseHarness = writeServer({ sessionByPid: [] });
    const missing: ExecResult = await runWrite(gone, "db cancel-query 4242");

    assert.strictEqual(missing.exitCode, undefined);
    assert.strictEqual(
      missing.errorMessage,
      "PostgreSQL has no session with pid 4242 (it may have ended already). Run db sessions to see the current ones; nothing was changed.",
    );

    for (const h of [own, gone]) {
      assert.ok(!h.drivers.sql.statements().includes(sqlOf("cancel")));
      assert.ok(!h.drivers.sql.statements().includes(sqlOf("terminate")));
    }
  });

  test("never another connection of the agent, a background process, or (for terminate) autovacuum", async () => {
    const agent: ExecResult = await runWrite(
      writeServer({
        sessionByPid: [
          session({ application_name: DATABASE_AI_AGENT_APPLICATION_NAME }),
        ],
      }),
      "db terminate-session 4242",
    );
    assert.match(
      String(agent.errorMessage),
      /^Refused by the Database AI agent: pid 4242 is another connection of the Database AI agent \(oneuptime-database-ai-agent\)/,
    );

    const walsender: ExecResult = await runWrite(
      writeServer({ sessionByPid: [session({ backend_type: "walsender" })] }),
      "db terminate-session 4242",
    );
    assert.strictEqual(
      walsender.errorMessage,
      "Refused by the Database AI agent: pid 4242 is a PostgreSQL walsender process, not a client session; db terminate-session only disconnects client sessions.",
    );

    const autovacuum: DatabaseHarness = writeServer({
      sessionByPid: [session({ backend_type: "autovacuum worker" })],
    });
    assert.strictEqual(
      (await runWrite(autovacuum, "db cancel-query 4242")).exitCode,
      0,
    );
    assert.match(
      String(
        (await runWrite(autovacuum, "db terminate-session 4242")).errorMessage,
      ),
      /is a PostgreSQL autovacuum worker process, not a client session/,
    );
  });

  test("cancel-query with nothing running changes nothing, and points an idle transaction at terminate", async () => {
    const idle: ExecResult = await runWrite(
      writeServer({
        sessionByPid: [session({ state: "idle in transaction" })],
      }),
      "db cancel-query 4242",
    );

    assert.strictEqual(idle.exitCode, undefined);
    assert.strictEqual(
      idle.errorMessage,
      "Session 4242 is idle in transaction: there is no running statement to cancel, so nothing was changed. An idle transaction ends only with its session: db terminate-session 4242.",
    );
  });

  test("a signal PostgreSQL did not deliver is a failure with the session shown", async () => {
    const result: ExecResult = await runWrite(
      writeServer({ cancel: [{ signalled: false }] }),
      "db cancel-query 4242",
    );

    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(
      result.errorMessage,
      "PostgreSQL did not signal pid 4242: the session ended before the signal arrived, or this login may not signal it.",
    );
    assert.match(
      result.output,
      /^\[stdout\]\nThe session, before:\npid:\s+4242/,
    );
  });

  test("a pid beyond PostgreSQL's range is refused before anything is sent", async () => {
    const h: DatabaseHarness = writeServer();
    const result: ExecResult = await runWrite(h, "db cancel-query 99999999999");

    assert.strictEqual(
      result.errorMessage,
      'Refused by the Database AI agent: "99999999999" is not a PostgreSQL backend pid.',
    );
    assert.deepStrictEqual(h.drivers.sql.queries, []);
  });
});

describe("helpers", () => {
  test("quotePostgresIdentifier doubles quotes", () => {
    assert.strictEqual(quotePostgresIdentifier('we"ird'), '"we""ird"');
  });

  test("describePostgresError reads the SQLSTATE", () => {
    const data: {
      username: string;
      credentialSource: string;
      database: string;
    } = {
      username: "m",
      credentialSource: "DATABASE_USERNAME/DATABASE_PASSWORD",
      database: "postgres",
    };
    const cases: Array<[string, RegExp]> = [
      ["28P01", /^PostgreSQL refused the login "m"/],
      ["28000", /pg_hba\.conf lets this user connect/],
      [
        "3D000",
        /^PostgreSQL has no database "postgres" .* Set ONEUPTIME_AI_DATABASE_NAME/,
      ],
      ["42501", /Grant it pg_monitor for reads, and pg_signal_backend/],
      [
        "57014",
        /^PostgreSQL cancelled the statement: it ran longer than the command's time budget/,
      ],
      ["55P03", /waited too long for a lock/],
      ["53300", /max_connections is reached/],
      ["57P03", /starting up, shutting down or in recovery/],
      ["42883", /supports PostgreSQL 11 and later/],
    ];

    for (const [code, pattern] of cases) {
      assert.match(
        String(describePostgresError(driverError("x", { code }), data)),
        pattern,
        code,
      );
    }

    assert.strictEqual(
      describePostgresError(driverError("x", { code: "XX000" }), data),
      null,
    );
  });
});
