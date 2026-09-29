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
  MYSQL_SQL,
  MySqlServer,
  describeMySqlError,
  describeMySqlServer,
  normalizeInnodbStatusStatements,
  parseMySqlServer,
} from "../Executors/Database/MySqlDiagnostics";
import { ExecResult } from "../Executors/ResourceExecutor";

/*
 * The db catalog on MySQL, MariaDB and Percona Server: the session limits
 * each flavour takes, the statements each operation sends (the flavour and
 * version decide between performance_schema and information_schema, and
 * between SHOW REPLICA STATUS and SHOW SLAVE STATUS), the ? parameters,
 * what prints, and the two KILLs with every check before them.
 */

type Answers = Record<string, Array<SqlRow> | Error>;

const MYSQL_84: SqlRow = {
  version: "8.4.2",
  version_comment: "MySQL Community Server - GPL",
};
const MYSQL_57: SqlRow = {
  version: "5.7.44-log",
  version_comment: "MySQL Community Server (GPL)",
};
const MARIADB: SqlRow = {
  version: "11.4.2-MariaDB-ubu2404",
  version_comment: "mariadb.org binary distribution",
};

function sqlOf(key: string): string {
  const sql: string | undefined = MYSQL_SQL[key];
  assert.ok(sql, `no statement ${key}`);
  return sql;
}

function harness(
  answers: Answers = {},
  data: {
    flavour?: SqlRow;
    engine?: string;
    env?: Record<string, string>;
  } = {},
): DatabaseHarness {
  const bySql: Map<string, Array<SqlRow> | Error> = new Map<
    string,
    Array<SqlRow> | Error
  >();
  bySql.set(sqlOf("version"), [data.flavour || MYSQL_84]);

  for (const [key, value] of Object.entries(answers)) {
    bySql.set(MYSQL_SQL[key] || key, value);
  }

  return databaseHarness({
    engine: data.engine || "mysql",
    env: data.env || {},
    drivers: new FakeDrivers(
      new FakeSqlConnection((sql: string): Array<SqlRow> | Error => {
        return bySql.get(sql) || [];
      }),
    ),
  });
}

// The statements after the flavour lookup and the four session settings.
function body(
  h: DatabaseHarness,
): Array<{ sql: string; params: Array<unknown> }> {
  return h.drivers.sql.queries.slice(5);
}

function processRow(overrides: SqlRow = {}): SqlRow {
  return {
    id: "31",
    user_name: "app",
    host: "10.0.0.8:51234",
    database_name: "shop",
    seconds: "95",
    command: "Query",
    state: "Sending data",
    query: "SELECT * FROM orders WHERE email = 'jane@example.com'",
    ...overrides,
  };
}

const WRITES_ON: Record<string, string> = { ONEUPTIME_AI_ALLOW_WRITES: "true" };

describe("session limits", () => {
  test("MySQL: read-only, max_execution_time in milliseconds, short lock waits", async () => {
    const h: DatabaseHarness = harness({ ping: [{ ok: 1, user_name: "m@%" }] });

    await runRead(h, "db ping", { timeoutInMs: 20_000 });

    const queries: Array<{ sql: string; params: Array<unknown> }> =
      h.drivers.sql.queries;
    assert.deepStrictEqual(
      queries.map((query: { sql: string }): string => {
        return query.sql;
      }),
      [
        "SELECT VERSION() AS version, @@version_comment AS version_comment",
        "SET SESSION TRANSACTION READ ONLY",
        "SET SESSION max_execution_time = ?",
        "SET SESSION lock_wait_timeout = ?",
        "SET SESSION innodb_lock_wait_timeout = ?",
        sqlOf("ping"),
      ],
    );
    const limit: number = Number(queries[2]!.params[0]);
    assert.ok(limit > 18_000 && limit <= 19_000, String(limit));
    assert.deepStrictEqual(queries[3]!.params, [5]);
    assert.deepStrictEqual(queries[4]!.params, [5]);
  });

  test("MariaDB: max_statement_time in seconds", async () => {
    const h: DatabaseHarness = harness(
      { ping: [{ ok: 1, user_name: "m@%" }] },
      { flavour: MARIADB, engine: "mariadb" },
    );

    await runRead(h, "db ping", { timeoutInMs: 3_000 });

    assert.strictEqual(
      h.drivers.sql.queries[2]!.sql,
      "SET SESSION max_statement_time = ?",
    );
    const seconds: number = Number(h.drivers.sql.queries[2]!.params[0]);
    assert.ok(seconds > 1 && seconds <= 2, String(seconds));
    assert.deepStrictEqual(h.drivers.sql.queries[3]!.params, [2]);
  });

  test("a write is not read-only, but keeps the statement limit", async () => {
    const h: DatabaseHarness = harness(
      { ownConnectionId: [{ id: "5" }], sessionById: [processRow()] },
      { env: WRITES_ON },
    );

    await runWrite(h, "db cancel-query 31");

    assert.ok(
      !h.drivers.sql.statements().includes("SET SESSION TRANSACTION READ ONLY"),
    );
    assert.strictEqual(
      h.drivers.sql.queries[1]!.sql,
      "SET SESSION max_execution_time = ?",
    );
  });
});

describe("each read", () => {
  test("ping and version", async () => {
    const h: DatabaseHarness = harness({
      ping: [{ ok: 1, user_name: "oneuptime_monitor@%" }],
      versionDetails: [{ os: "Linux", machine: "x86_64", read_only: "0" }],
      uptime: [{ Variable_name: "Uptime", Value: "3600" }],
    });

    assert.strictEqual(
      stdoutOf(await runRead(h, "db ping")),
      "status: ok (MySQL 8.4.2 answered SELECT 1)\nuser:   oneuptime_monitor@%",
    );
    assert.strictEqual(
      stdoutOf(await runRead(h, "db version")),
      [
        "server:          MySQL 8.4.2",
        "version:         8.4.2",
        "version_comment: MySQL Community Server - GPL",
        "os:              Linux",
        "machine:         x86_64",
        "read_only:       0",
        "uptime_seconds:  3600",
      ].join("\n"),
    );
  });

  test("sessions: one statement per state, the filters as ? parameters, the query normalized", async () => {
    for (const [flag, key] of [
      ["", "sessionsAll"],
      [" --state active", "sessionsActive"],
      [" --state idle", "sessionsIdle"],
      [" --state idle-in-transaction", "sessionsIdleInTransaction"],
    ] as Array<[string, string]>) {
      const h: DatabaseHarness = harness({ [key]: [processRow()] });
      const result: ExecResult = await runRead(
        h,
        `db sessions${flag} --user app --database shop --limit 10`,
      );

      assert.deepStrictEqual(body(h), [
        { sql: sqlOf(key), params: ["app", "app", "shop", "shop", 11] },
      ]);
      assert.strictEqual(
        stdoutOf(result),
        [
          "ID   USER   HOST             DB     TIME_S   COMMAND   STATE          QUERY",
          "31   app    10.0.0.8:51234   shop   95       Query     Sending data   SELECT * FROM orders WHERE email = '?'",
        ].join("\n"),
      );
    }

    assert.match(sqlOf("sessionsAll"), /WHERE ID <> CONNECTION_ID\(\)/);
    assert.match(
      sqlOf("sessionsIdleInTransaction"),
      /COMMAND = 'Sleep'\s+AND ID IN \(SELECT trx_mysql_thread_id FROM information_schema\.INNODB_TRX\)/,
    );
  });

  test("long-queries: server threads left out, --min-seconds and the limit as parameters", async () => {
    const h: DatabaseHarness = harness({ longQueries: [processRow()] });
    await runRead(h, "db long-queries --min-seconds 30");

    assert.deepStrictEqual(body(h)[0]!.params, [30, 51]);
    assert.match(
      sqlOf("longQueries"),
      /COMMAND NOT IN \('Sleep', 'Daemon', 'Binlog Dump', 'Binlog Dump GTID'\)/,
    );
  });

  test("blocking and locks: performance_schema on MySQL 8, information_schema on 5.7 and MariaDB", async () => {
    const cases: Array<[SqlRow, string, string, string]> = [
      [
        MYSQL_84,
        "mysql",
        "blockingPerformanceSchema",
        "locksPerformanceSchema",
      ],
      [
        MYSQL_57,
        "mysql",
        "blockingInformationSchema",
        "locksInformationSchema",
      ],
      [
        MARIADB,
        "mariadb",
        "blockingInformationSchema",
        "locksInformationSchema",
      ],
    ];

    for (const [flavour, engine, blocking, locks] of cases) {
      const h: DatabaseHarness = harness(
        {
          [blocking]: [
            {
              waiting_id: "40",
              wait_seconds: "12",
              locked_schema: "shop",
              locked_table: "`shop`.`orders`",
              locked_index: "PRIMARY",
              waiting_lock_mode: "X",
              blocking_id: "41",
              blocking_lock_mode: "X",
              blocking_trx_seconds: "300",
              waiting_query: "UPDATE orders SET total = 10 WHERE id = 5",
              blocking_query: null,
            },
          ],
        },
        { flavour, engine },
      );
      const out: string = stdoutOf(await runRead(h, "db blocking"));

      assert.deepStrictEqual(body(h), [{ sql: sqlOf(blocking), params: [51] }]);
      assert.match(
        out,
        /^ {2}waiting_query:\s+UPDATE orders SET total = \? WHERE id = \?$/m,
      );
      assert.match(out, /^ {2}blocking_query:\s+-$/m);

      const l: DatabaseHarness = harness({}, { flavour, engine });
      const empty: string = stdoutOf(await runRead(l, "db locks --limit 5"));
      assert.deepStrictEqual(body(l), [{ sql: sqlOf(locks), params: [6] }]);
      assert.match(empty, /^No InnoDB lock/);
    }

    // Lock data (the locked rows' key values) is never read.
    assert.ok(!sqlOf("locksPerformanceSchema").includes("LOCK_DATA"));
    assert.ok(!sqlOf("locksInformationSchema").includes("lock_data"));
  });

  test("replication: the statements each version has, the replica status as a record, the binary log", async () => {
    const cases: Array<[SqlRow, string, string, string, string]> = [
      [
        MYSQL_84,
        "mysql",
        "mysqlReplicationIdentity",
        "replicaStatus",
        "binaryLogStatus",
      ],
      [
        { version: "8.0.21", version_comment: "MySQL" },
        "mysql",
        "mysqlReplicationIdentity",
        "slaveStatus",
        "masterStatus",
      ],
      [
        { version: "8.0.36", version_comment: "MySQL" },
        "mysql",
        "mysqlReplicationIdentity",
        "replicaStatus",
        "masterStatus",
      ],
      [
        MARIADB,
        "mariadb",
        "mariaDbReplicationIdentity",
        "slaveStatus",
        "masterStatus",
      ],
    ];

    for (const [flavour, engine, identity, replica, binlog] of cases) {
      const h: DatabaseHarness = harness(
        {
          [identity]: [{ server_id: "2", read_only: "1" }],
          [replica]: [
            {
              Source_Host: "primary.internal",
              Replica_IO_Running: "Yes",
              Replica_SQL_Running: "No",
              Last_SQL_Error:
                "Error 'Duplicate entry '7' for key 'PRIMARY'' on query",
              Seconds_Behind_Source: null,
              Relay_Log_File: "",
            },
          ],
          [binlog]: [{ File: "binlog.000009", Position: "157" }],
        },
        { flavour, engine },
      );
      const out: string = stdoutOf(await runRead(h, "db replication"));

      assert.deepStrictEqual(
        body(h).map((query: { sql: string }): string => {
          return query.sql;
        }),
        [
          sqlOf(identity),
          sqlOf(replica),
          sqlOf(binlog),
          sqlOf("connectedReplicas"),
        ],
        String(flavour["version"]),
      );
      assert.match(out, /^server_id: 2$/m);
      assert.match(
        out,
        /^This server as a replica:\n\[1\]\n {2}Source_Host:\s+primary\.internal$/m,
      );
      assert.ok(
        !out.includes("Seconds_Behind_Source"),
        "empty fields are left out",
      );
      assert.ok(!out.includes("Relay_Log_File"));
      assert.match(out, /^File:\s+binlog\.000009$/m);
      // The duplicated key's value is row data: masked.
      assert.ok(!out.includes("'7'"), out);
    }
  });

  test("replication on a server that is no replica and writes no binary log", async () => {
    const out: string = stdoutOf(await runRead(harness(), "db replication"));

    assert.match(
      out,
      /This server is not a replica \(replica status is empty\)\./,
    );
    assert.match(out, /^binary_log: off \(no binary log is written\)$/m);
    assert.match(out, /No replica is connected\./);
  });

  test("connections: status counters, limits and use, then who holds them", async () => {
    const h: DatabaseHarness = harness({
      connectionStatus: [
        { Variable_name: "Threads_connected", Value: "140" },
        { Variable_name: "Max_used_connections", Value: "151" },
      ],
      connectionLimits: [{ max_connections: "151", max_user_connections: "0" }],
      connectionGroups: [
        {
          user_name: "app",
          database_name: "shop",
          command: "Sleep",
          connections: "120",
        },
      ],
    });
    const out: string = stdoutOf(await runRead(h, "db connections"));

    assert.deepStrictEqual(body(h)[2]!.params, [201]);
    assert.match(out, /^Threads_connected:\s+140$/m);
    assert.match(out, /^used_percent:\s+93%$/m);
    assert.match(out, /^app {4}shop {3}Sleep {5}120$/m);
  });

  test("database-sizes and table-sizes: sizes readable, the cache said, the schema as a parameter", async () => {
    const h: DatabaseHarness = harness({
      databaseSizes: [
        {
          database_name: "shop",
          size_bytes: "1073741824",
          data_bytes: "805306368",
          index_bytes: "268435456",
          tables: "12",
        },
      ],
      tableSizes: [
        {
          schema_name: "shop",
          table_name: "orders",
          engine: "InnoDB",
          estimated_rows: "100000",
          data_bytes: "805306368",
          index_bytes: "268435456",
          total_bytes: "1073741824",
          free_bytes: "4194304",
        },
      ],
    });
    const sizes: string = stdoutOf(await runRead(h, "db database-sizes"));

    assert.match(
      sizes,
      /^shop {7}1\.0 GiB {3}768\.0 MiB {3}256\.0 MiB {3}12 {7}1073741824$/m,
    );
    assert.match(
      sizes,
      /MySQL 8 caches these sizes for information_schema_stats_expiry seconds/,
    );

    const tables: string = stdoutOf(
      await runRead(h, "db table-sizes --database shop --limit 3"),
    );
    assert.deepStrictEqual(h.drivers.sql.queries.at(-1)!.params, [
      "shop",
      "shop",
      "shop",
      4,
    ]);
    assert.match(tables, /^Largest tables in shop:$/m);
    assert.match(
      tables,
      /^shop {5}orders {3}InnoDB {3}1\.0 GiB {3}768\.0 MiB {3}256\.0 MiB {3}4\.0 MiB {3}100000$/m,
    );

    const all: DatabaseHarness = harness(
      {},
      { flavour: MARIADB, engine: "mariadb" },
    );
    const none: string = stdoutOf(await runRead(all, "db table-sizes"));
    assert.deepStrictEqual(body(all)[0]!.params, [null, null, null, 51]);
    assert.strictEqual(
      none,
      "Largest tables:\nNo table is visible to this login.",
    );
  });

  test("top-statements: performance_schema off is said; on, the digests print", async () => {
    const off: DatabaseHarness = harness({
      performanceSchemaEnabled: [{ enabled: "0" }],
    });
    assert.match(
      stdoutOf(await runRead(off, "db top-statements")),
      /^performance_schema is off on this server/,
    );
    assert.strictEqual(body(off).length, 1);

    const on: DatabaseHarness = harness({
      performanceSchemaEnabled: [{ enabled: 1 }],
      topStatements: [
        {
          schema_name: "shop",
          calls: "10",
          total_ms: "12.5",
          mean_ms: "1.25",
          rows_examined: "100",
          rows_sent: "10",
          no_index_used: "0",
          query: "SELECT * FROM `orders` WHERE `id` = ?",
        },
      ],
    });
    const out: string = stdoutOf(
      await runRead(on, "db top-statements --limit 1"),
    );
    assert.deepStrictEqual(body(on)[1]!.params, [2]);
    assert.match(out, /SELECT \* FROM `orders` WHERE `id` = \?$/m);
  });

  test("settings: one by name as a parameter, every one without credentials, an unknown name failed", async () => {
    const one: DatabaseHarness = harness({
      settingByName: [{ Variable_name: "max_connections", Value: "151" }],
    });
    assert.strictEqual(
      stdoutOf(await runRead(one, "db settings max_connections")),
      "name:  max_connections\nvalue: 151",
    );
    assert.deepStrictEqual(body(one)[0], {
      sql: sqlOf("settingByName"),
      params: ["max_connections"],
    });

    const all: DatabaseHarness = harness({
      allSettings: [
        { Variable_name: "default_password_lifetime", Value: "0" },
        { Variable_name: "max_connections", Value: "151" },
      ],
    });
    assert.strictEqual(
      stdoutOf(await runRead(all, "db settings")),
      "NAME              VALUE\nmax_connections   151\n\n1 credential variable(s) are not shown.",
    );

    const unknown: ExecResult = await runRead(harness(), "db settings nope");
    assert.strictEqual(unknown.exitCode, 1);
    assert.strictEqual(
      unknown.errorMessage,
      'This server has no global variable named "nope" (db settings with no name prints every one).',
    );
  });

  test("slowlog: a log written to a file is said; a table log is read, its statements normalized", async () => {
    const file: DatabaseHarness = harness({
      slowLogSettings: [
        {
          slow_query_log: "1",
          log_output: "FILE",
          long_query_time: "10.000000",
        },
      ],
    });
    const fileOut: string = stdoutOf(await runRead(file, "db slowlog"));
    assert.match(
      fileOut,
      /The slow query log is written to FILE, not to a table, so db slowlog cannot read it\. It reads mysql\.slow_log when the server's log_output setting includes TABLE\.$/,
    );
    assert.strictEqual(body(file).length, 1);

    const table: DatabaseHarness = harness({
      slowLogSettings: [
        { slow_query_log: "1", log_output: "FILE,TABLE", long_query_time: "1" },
      ],
      slowLog: [
        {
          start_time: "2026-09-29 10:00:00.000000",
          user_host: "app[app] @ [10.0.0.8]",
          query_time: "00:00:12.000000",
          lock_time: "00:00:00.000100",
          rows_sent: "1",
          rows_examined: "1000000",
          database_name: "shop",
          query: "SELECT * FROM orders WHERE note LIKE '%refund%'",
        },
      ],
    });
    const out: string = stdoutOf(await runRead(table, "db slowlog --limit 5"));
    assert.deepStrictEqual(body(table)[1]!.params, [6]);
    assert.match(out, /SELECT \* FROM orders WHERE note LIKE '\?'$/m);
  });

  test("innodb-status: the report as text, row bytes masked by the redactor", async () => {
    const h: DatabaseHarness = harness({
      innodbStatus: [
        {
          Type: "InnoDB",
          Name: "",
          Status:
            "------------------------\nLATEST DETECTED DEADLOCK\n------------------------\n 0: len 4; hex 80000007; asc     ;;\n 1: len 16; hex 6a616e65406578616d706c652e636f6d; asc jane@example.com;;\n",
        },
      ],
    });
    const out: string = stdoutOf(await runRead(h, "db innodb-status"));

    assert.match(out, /LATEST DETECTED DEADLOCK/);
    assert.ok(!out.includes("jane@example.com"), out);
    assert.ok(!out.includes("6a616e65"), out);
  });

  test("innodb-status: a multi-line statement is normalized whole — its continuation lines keep no literal", async () => {
    const status: string = [
      "=====================================",
      "2026-09-29 10:00:00 0x7f00 INNODB MONITOR OUTPUT",
      "=====================================",
      "------------------------",
      "LATEST DETECTED DEADLOCK",
      "------------------------",
      "2026-09-29 09:59:58 0x7f01",
      "*** (1) TRANSACTION:",
      "TRANSACTION 1235, ACTIVE 1 sec starting index read",
      "mysql tables in use 1, locked 1",
      "LOCK WAIT 3 lock struct(s), heap size 1128, 2 row lock(s)",
      "MySQL thread id 10, OS thread handle 142, query id 70 localhost app updating",
      "INSERT INTO payments (card, amount, name)",
      "VALUES",
      '  (5500005555555559, 98765, "John Smith"),',
      "  (4012888888881881, 43210, 'Jane Doe')",
      "*** (1) HOLDS THE LOCK(S):",
      "RECORD LOCKS space id 2 page no 4 n bits 72 index PRIMARY of table `shop`.`payments` trx id 1235 lock_mode X locks rec but not gap",
      "*** WE ROLL BACK TRANSACTION (1)",
      "------------",
      "TRANSACTIONS",
      "------------",
      "Trx id counter 1240",
      "LIST OF TRANSACTIONS FOR EACH SESSION:",
      "---TRANSACTION 1233, ACTIVE 3 sec starting index read",
      "mysql tables in use 1, locked 1",
      "LOCK WAIT 2 lock struct(s), heap size 1128, 1 row lock(s)",
      "MariaDB thread id 8, OS thread handle 140, query id 60 localhost app updating",
      "UPDATE users SET",
      "  card = 4111111111111111,",
      '  email = "john@example.com",',
      "  note = 'vip'",
      "WHERE id = 7",
      "------- TRX HAS BEEN WAITING 3 SEC FOR THIS LOCK TO BE GRANTED:",
      "---TRANSACTION 1232, ACTIVE 10 sec",
      "MySQL thread id 9, OS thread handle 141, query id 58 localhost app",
      "Trx read view will not see trx with id >= 1232, sees < 1232",
      "--------",
      "FILE I/O",
      "--------",
      "I/O thread 0 state: waiting for completed aio requests (insert buffer thread)",
      "----------------------------",
      "END OF INNODB MONITOR OUTPUT",
      "============================",
      "",
    ].join("\n");
    const h: DatabaseHarness = harness({
      innodbStatus: [{ Type: "InnoDB", Name: "", Status: status }],
    });
    const out: string = stdoutOf(await runRead(h, "db innodb-status"));

    for (const secret of [
      "4111111111111111",
      "5500005555555559",
      "4012888888881881",
      "John Smith",
      "Jane Doe",
      "john@example.com",
      "vip",
      "98765",
      "43210",
    ]) {
      assert.ok(!out.includes(secret), `${secret} leaked:\n${out}`);
    }

    // The statements stay readable, and the monitor's own lines are untouched.
    assert.match(out, /^ {2}card = \?,$/m);
    assert.match(out, /^ {2}email = "\?",$/m);
    assert.match(out, /^WHERE id = \?$/m);
    assert.match(out, /^ {2}\(\?, \?, "\?"\),$/m);
    assert.match(
      out,
      /^---TRANSACTION 1233, ACTIVE 3 sec starting index read$/m,
    );
    assert.match(
      out,
      /^MySQL thread id 10, OS thread handle 142, query id 70 localhost app updating$/m,
    );
    assert.match(
      out,
      /^Trx read view will not see trx with id >= 1232, sees < 1232$/m,
    );
    assert.match(out, /^I\/O thread 0 state: waiting/m);
  });

  test("normalizeInnodbStatusStatements: only what follows a thread line, up to the monitor's next line", () => {
    assert.strictEqual(
      normalizeInnodbStatusStatements(
        [
          "---TRANSACTION 7, ACTIVE 2 sec",
          "MySQL thread id 3, OS thread handle 9, query id 4 localhost app",
          "SELECT *",
          "  FROM t",
          '  WHERE a IN (1, 2) AND b = "x"',
          "Trx read view will not see trx with id >= 7, sees < 7",
          "---TRANSACTION 8, not started",
          "MySQL thread id 5, OS thread handle 10, query id 6 localhost app",
          "---TRANSACTION 9, not started",
        ].join("\n"),
      ),
      [
        "---TRANSACTION 7, ACTIVE 2 sec",
        "MySQL thread id 3, OS thread handle 9, query id 4 localhost app",
        "SELECT *",
        "  FROM t",
        '  WHERE a IN (?, ?) AND b = "?"',
        "Trx read view will not see trx with id >= 7, sees < 7",
        "---TRANSACTION 8, not started",
        "MySQL thread id 5, OS thread handle 10, query id 6 localhost app",
        "---TRANSACTION 9, not started",
      ].join("\n"),
    );
    assert.strictEqual(normalizeInnodbStatusStatements(""), "");
  });
});

describe("the writes", () => {
  function writeHarness(
    answers: Answers = {},
    flavour?: SqlRow,
  ): DatabaseHarness {
    return harness(
      {
        ownConnectionId: [{ id: "5" }],
        sessionById: [processRow()],
        ...answers,
      },
      { env: WRITES_ON, ...(flavour ? { flavour } : {}) },
    );
  }

  test("cancel-query: its own id, the target, KILL QUERY with the id as a parameter, a second look", async () => {
    let lookups: number = 0;
    const h: DatabaseHarness = databaseHarness({
      engine: "mysql",
      env: WRITES_ON,
      drivers: new FakeDrivers(
        new FakeSqlConnection((sql: string): Array<SqlRow> => {
          if (sql === sqlOf("version")) {
            return [MYSQL_84];
          }

          if (sql === sqlOf("ownConnectionId")) {
            return [{ id: 5 }];
          }

          if (sql === sqlOf("sessionById")) {
            lookups++;
            return lookups === 1
              ? [processRow()]
              : [processRow({ command: "Sleep", state: "" })];
          }

          return [];
        }),
      ),
    });
    const result: ExecResult = await runWrite(h, "db cancel-query 31");

    assert.deepStrictEqual(
      h.drivers.sql.queries
        .slice(4)
        .map((query: { sql: string; params: Array<unknown> }) => {
          return [query.sql, query.params];
        }),
      [
        [sqlOf("ownConnectionId"), []],
        [sqlOf("sessionById"), [31]],
        ["KILL QUERY ?", [31]],
        [sqlOf("sessionById"), [31]],
      ],
    );
    assert.deepStrictEqual(h.sleeps, [250]);
    assert.strictEqual(
      stdoutOf(result),
      [
        "Cancelled the running statement of connection 31 (KILL QUERY). The connection stays open.",
        "",
        "The connection, before:",
        "id:      31",
        "user:    app",
        "host:    10.0.0.8:51234",
        "db:      shop",
        "command: Query",
        "time_s:  95",
        "state:   Sending data",
        "query:   SELECT * FROM orders WHERE email = '?'",
        "",
        "Connection 31 is now Sleep.",
      ].join("\n"),
    );
  });

  test("terminate-session: KILL CONNECTION, then the connection is Killed or gone", async () => {
    let lookups: number = 0;
    const h: DatabaseHarness = databaseHarness({
      engine: "mysql",
      env: WRITES_ON,
      drivers: new FakeDrivers(
        new FakeSqlConnection((sql: string): Array<SqlRow> => {
          if (sql === sqlOf("version")) {
            return [MYSQL_84];
          }

          if (sql === sqlOf("ownConnectionId")) {
            return [{ id: "5" }];
          }

          if (sql === sqlOf("sessionById")) {
            lookups++;
            return lookups === 1
              ? [processRow({ command: "Sleep" })]
              : [processRow({ command: "Killed" })];
          }

          return [];
        }),
      ),
    });
    const result: ExecResult = await runWrite(h, "db terminate-session 31");

    assert.ok(h.drivers.sql.statements().includes("KILL CONNECTION ?"));
    assert.match(
      stdoutOf(result),
      /^Terminated connection 31 \(KILL CONNECTION\)[\s\S]*Connection 31 is marked Killed; the server ends it at its next check\.$/,
    );
  });

  test("never its own connection, one that is not there, a server thread, or an idle cancel: no KILL is sent", async () => {
    const cases: Array<[Answers, string, string]> = [
      [
        { ownConnectionId: [{ id: "31" }] },
        "db terminate-session 31",
        "Refused by the Database AI agent: connection 31 is the agent's own (session:31); it never kills itself.",
      ],
      [
        { sessionById: [] },
        "db cancel-query 31",
        "There is no connection 31 in the processlist (it may have ended already, or this login lacks the PROCESS privilege to see it). Run db sessions to see the current ones; nothing was changed.",
      ],
      [
        {
          sessionById: [
            processRow({ user_name: "system user", command: "Connect" }),
          ],
        },
        "db terminate-session 31",
        "Refused by the Database AI agent: connection 31 is a server thread (system user, Connect), not a client session: db terminate-session never kills replication, event-scheduler or other server threads.",
      ],
      [
        {
          sessionById: [
            processRow({ user_name: "repl", command: "Binlog Dump GTID" }),
          ],
        },
        "db terminate-session 31",
        "Refused by the Database AI agent: connection 31 is a server thread (repl, Binlog Dump GTID), not a client session: db terminate-session never kills replication, event-scheduler or other server threads.",
      ],
      [
        {
          sessionById: [
            processRow({ user_name: "event_scheduler", command: "Daemon" }),
          ],
        },
        "db cancel-query 31",
        "Refused by the Database AI agent: connection 31 is a server thread (event_scheduler, Daemon), not a client session: db cancel-query never kills replication, event-scheduler or other server threads.",
      ],
      [
        { sessionById: [processRow({ command: "Sleep" })] },
        "db cancel-query 31",
        "Connection 31 is idle (Sleep): there is no running statement to cancel, so nothing was changed. An idle transaction ends only with its connection: db terminate-session 31.",
      ],
    ];

    for (const [answers, command, message] of cases) {
      const h: DatabaseHarness = writeHarness(answers);
      const result: ExecResult = await runWrite(h, command);

      assert.deepStrictEqual(result, {
        success: false,
        output: "",
        errorMessage: message,
      });
      assert.ok(
        !h.drivers.sql.statements().some((sql: string): boolean => {
          return sql.startsWith("KILL");
        }),
        command,
      );
    }
  });

  test("a connection that ended between the lookup and the KILL is a failure that changed nothing", async () => {
    const result: ExecResult = await runWrite(
      writeHarness({
        killQuery: driverError("Unknown thread id: 31", {
          errno: 1094,
          code: "ER_NO_SUCH_THREAD",
        }),
      }),
      "db cancel-query 31",
    );

    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(
      result.errorMessage,
      "Connection 31 ended before the KILL reached it; nothing else was changed.",
    );
  });

  test("a KILL the login may not run is reported with the grant it needs", async () => {
    const result: ExecResult = await runWrite(
      writeHarness({
        killConnection: driverError("You are not owner of thread 31", {
          errno: 1095,
          code: "ER_KILL_DENIED_ERROR",
        }),
      }),
      "db terminate-session 31",
    );

    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(
      result.errorMessage,
      'MySQL answered "db terminate-session 31" with an error: The login "oneuptime_monitor" may not kill other users\' connections (You are not owner of thread 31). Grant it CONNECTION_ADMIN (MySQL 8), CONNECTION ADMIN (MariaDB 10.5+) or SUPER.',
    );
  });
});

describe("helpers", () => {
  test("parseMySqlServer and describeMySqlServer read every flavour", () => {
    const cases: Array<[string, string, string, Partial<MySqlServer>]> = [
      [
        "8.4.2",
        "MySQL Community Server - GPL",
        "MySQL 8.4.2",
        { major: 8, minor: 4, patch: 2, isMariaDb: false },
      ],
      [
        "5.5.5-10.6.18-MariaDB-log",
        "MariaDB Server",
        "MariaDB 10.6.18",
        { major: 10, isMariaDb: true },
      ],
      ["11.4.2-MariaDB", "", "MariaDB 11.4.2", { major: 11, isMariaDb: true }],
      [
        "8.0.36-28",
        "Percona Server (GPL), Release 28, Revision 47601f19",
        "Percona Server 8.0.36-28",
        { major: 8, isPercona: true },
      ],
      ["", "", "MySQL ", { major: 0 }],
    ];

    for (const [version, comment, described, fields] of cases) {
      const server: MySqlServer = parseMySqlServer(version, comment);

      for (const [key, value] of Object.entries(fields)) {
        assert.strictEqual(
          (server as unknown as Record<string, unknown>)[key],
          value,
          `${version}: ${key}`,
        );
      }

      assert.strictEqual(describeMySqlServer(server), described, version);
    }

    assert.strictEqual(parseMySqlServer(null, undefined).version, "");
  });

  test("describeMySqlError reads the error number and mysql2's codes", () => {
    const data: { username: string; credentialSource: string } = {
      username: "m",
      credentialSource: "DATABASE_USERNAME/DATABASE_PASSWORD",
    };
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ errno: 1045 }, /^The server refused the login "m"/],
      [
        { errno: 1227 },
        /Grant PROCESS and REPLICATION CLIENT for reads \(SLAVE MONITOR on MariaDB 10\.5\.9\+\), and CONNECTION_ADMIN/,
      ],
      [{ errno: 1142 }, /Grant SELECT on performance_schema\.\*/],
      [{ errno: 3024 }, /ran longer than the command's time budget/],
      [{ errno: 1969 }, /ran longer than the command's time budget/],
      [{ errno: 1205 }, /waited too long for a lock/],
      [{ errno: 1040 }, /max_connections is reached/],
      [{ errno: 1129 }, /FLUSH HOSTS/],
      [{ errno: 3159 }, /requires TLS .* Set DATABASE_TLS_INSECURE=false/],
      [
        { errno: 1146 },
        /supports MySQL 5\.7\+, MariaDB 10\.3\+ and Percona Server/,
      ],
      [
        { code: "HANDSHAKE_NO_SSL_SUPPORT" },
        /does not support TLS .* Set DATABASE_TLS_INSECURE=true/,
      ],
    ];

    for (const [fields, pattern] of cases) {
      assert.match(
        String(describeMySqlError(driverError("msg", fields), data)),
        pattern,
        JSON.stringify(fields),
      );
    }

    assert.strictEqual(
      describeMySqlError(driverError("x", { errno: 9999 }), data),
      null,
    );
  });
});
