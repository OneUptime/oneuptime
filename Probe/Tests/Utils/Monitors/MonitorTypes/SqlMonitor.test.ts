// Set required env vars before importing SqlMonitor (which imports Config.ts).
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import SqlMonitor, {
  buildMicrosoftSqlServerPoolConfig,
  buildSqlServerIntegratedConnectionString,
  loadMicrosoftSqlServerDriver,
  MicrosoftSqlServerPoolConfig,
  parseUnixOdbcInstDrivers,
  parseWindowsRegistryOdbcDrivers,
  pickBestSqlServerOdbcDriver,
  resetSqlServerOdbcDriverCache,
  resolveSqlServerOdbcDriver,
  SQL_SERVER_ODBC_DRIVER,
  SqlQueryValidator,
} from "../../../../Utils/Monitors/MonitorTypes/SqlMonitor";
import SqlMonitorResponse from "Common/Types/Monitor/SqlMonitor/SqlMonitorResponse";
import MonitorStepSqlMonitor from "Common/Types/Monitor/MonitorStepSqlMonitor";
import SqlDatabaseType from "Common/Types/Monitor/SqlDatabaseType";
import * as mssql from "mssql";
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { resolve } from "path";

const getMicrosoftSqlServerConfig: (
  overrides?: Partial<MonitorStepSqlMonitor>,
) => MonitorStepSqlMonitor = (
  overrides: Partial<MonitorStepSqlMonitor> = {},
): MonitorStepSqlMonitor => {
  return {
    databaseType: SqlDatabaseType.MicrosoftSqlServer,
    host: "sql.internal",
    port: 1433,
    databaseName: "orders",
    username: "readonly",
    password: "sql-password",
    useWindowsIntegratedAuthentication: false,
    useSsl: true,
    rejectUnauthorizedSsl: true,
    query: "SELECT 1",
    connectionTimeoutInMs: 10000,
    statementTimeoutInMs: 15000,
    maxRows: 100,
    ...overrides,
  };
};

describe("SqlQueryValidator.getRejectionReason", () => {
  it("allows a plain SELECT", () => {
    expect(
      SqlQueryValidator.getRejectionReason(
        "SELECT COUNT(*) FROM orders WHERE status = 'CANCELLED'",
      ),
    ).toBeNull();
  });

  it("allows lower-case and leading whitespace", () => {
    expect(SqlQueryValidator.getRejectionReason("   select 1 ")).toBeNull();
  });

  it("allows the cursorable read statements WITH (CTE), VALUES, TABLE", () => {
    expect(
      SqlQueryValidator.getRejectionReason(
        "WITH t AS (SELECT 1) SELECT * FROM t",
      ),
    ).toBeNull();
    expect(SqlQueryValidator.getRejectionReason("VALUES (1),(2)")).toBeNull();
    expect(SqlQueryValidator.getRejectionReason("TABLE orders")).toBeNull();
  });

  it("rejects non-cursorable read statements (SHOW, EXPLAIN)", () => {
    expect(
      SqlQueryValidator.getRejectionReason("SHOW server_version"),
    ).toBeTruthy();
    expect(
      SqlQueryValidator.getRejectionReason("EXPLAIN SELECT 1"),
    ).toBeTruthy();
  });

  it("allows a single trailing semicolon", () => {
    expect(SqlQueryValidator.getRejectionReason("SELECT 1;")).toBeNull();
    expect(SqlQueryValidator.getRejectionReason("SELECT 1;   ")).toBeNull();
  });

  it("rejects empty / whitespace-only queries", () => {
    expect(SqlQueryValidator.getRejectionReason("")).toBeTruthy();
    expect(SqlQueryValidator.getRejectionReason("   ")).toBeTruthy();
    expect(SqlQueryValidator.getRejectionReason(";")).toBeTruthy();
  });

  it("rejects writes and DDL", () => {
    for (const q of [
      "UPDATE orders SET x = 1",
      "DELETE FROM orders",
      "INSERT INTO orders VALUES (1)",
      "DROP TABLE orders",
      "ALTER TABLE orders ADD COLUMN x int",
      "TRUNCATE orders",
      "GRANT ALL ON orders TO bob",
      "CREATE TABLE t (id int)",
      "MERGE INTO t USING s ON t.id = s.id",
      "CALL do_something()",
    ]) {
      expect(SqlQueryValidator.getRejectionReason(q)).toBeTruthy();
    }
  });

  it("rejects multiple statements (stacked query injection)", () => {
    expect(
      SqlQueryValidator.getRejectionReason("SELECT 1; DROP TABLE orders"),
    ).toBeTruthy();
    expect(
      SqlQueryValidator.getRejectionReason("SELECT 1; SELECT 2"),
    ).toBeTruthy();
  });

  it("does not trip on a semicolon inside a string literal", () => {
    expect(
      SqlQueryValidator.getRejectionReason("SELECT ';' AS delimiter"),
    ).toBeNull();
  });

  it("ignores keywords hidden in comments", () => {
    expect(
      SqlQueryValidator.getRejectionReason("-- DROP TABLE x\nSELECT 1"),
    ).toBeNull();
    expect(
      SqlQueryValidator.getRejectionReason("/* UPDATE */ SELECT 1"),
    ).toBeNull();
  });

  it("rejects a write disguised by a leading comment", () => {
    expect(
      SqlQueryValidator.getRejectionReason("/* readonly */ DELETE FROM orders"),
    ).toBeTruthy();
  });

  it("rejects a T-SQL second statement separated by whitespace only (no semicolon)", () => {
    for (const q of [
      "SELECT 1 EXEC xp_cmdshell 'dir'",
      "SELECT 1 exec sp_who",
      "SELECT 1 EXECUTE sp_configure",
      "SELECT id FROM t DROP TABLE t",
    ]) {
      expect(SqlQueryValidator.getRejectionReason(q)).toBeTruthy();
    }
  });

  it("rejects read-time file writes and remote data-source access", () => {
    for (const q of [
      "SELECT secret FROM users INTO OUTFILE '/var/lib/mysql-files/x.txt'",
      "SELECT secret FROM users INTO DUMPFILE '/tmp/x'",
      "SELECT * FROM OPENROWSET('SQLNCLI', 'server', 'SELECT 1')",
      "SELECT * FROM OPENQUERY(linked, 'SELECT 1')",
    ]) {
      expect(SqlQueryValidator.getRejectionReason(q)).toBeTruthy();
    }
  });

  it("does not flag read-only functions or identifiers that merely contain a keyword", () => {
    // REPLACE() is a read-only string function, not a write.
    expect(
      SqlQueryValidator.getRejectionReason(
        "SELECT REPLACE(name, 'a', 'b') FROM orders",
      ),
    ).toBeNull();
    // Column names that embed a keyword must not trip the whole-word denylist.
    expect(
      SqlQueryValidator.getRejectionReason(
        "SELECT created_at, updated_at, delete_flag FROM orders",
      ),
    ).toBeNull();
    // A keyword inside a string literal is stripped before the denylist scan.
    expect(
      SqlQueryValidator.getRejectionReason(
        "SELECT id FROM orders WHERE note = 'please delete this soon'",
      ),
    ).toBeNull();
  });
});

describe("SqlMonitor.sanitizeError", () => {
  it("redacts the password substring", () => {
    const msg: string = SqlMonitor.sanitizeError(
      new Error("auth failed for password s3cr3tP@ss"),
      "s3cr3tP@ss",
    );
    expect(msg).not.toContain("s3cr3tP@ss");
    expect(msg).toContain("***");
  });

  it("redacts a connection URI", () => {
    const msg: string = SqlMonitor.sanitizeError(
      new Error(
        "could not connect to postgres://user:pw@db.internal:5432/orders",
      ),
      "pw",
    );
    expect(msg).not.toContain("db.internal");
    expect(msg).toContain("[redacted-dsn]");
  });

  it("handles a non-Error value and empty password", () => {
    expect(typeof SqlMonitor.sanitizeError("boom", undefined)).toBe("string");
    expect(SqlMonitor.sanitizeError("boom", "")).toContain("boom");
  });

  it("redacts other secret-backed fields (host / username / databaseName)", () => {
    const msg: string = SqlMonitor.sanitizeError(
      new Error(
        "Access denied for user 'svc_secret'@'secret-host.internal' to database 'privatedb'",
      ),
      "",
      ["secret-host.internal", "svc_secret", "privatedb"],
    );
    expect(msg).not.toContain("secret-host.internal");
    expect(msg).not.toContain("svc_secret");
    expect(msg).not.toContain("privatedb");
    expect(msg).toContain("***");
  });

  it("does not mangle short, common field values (length < 4 are left alone)", () => {
    const msg: string = SqlMonitor.sanitizeError(
      new Error("could not connect to host db"),
      "",
      ["db"],
    );
    // "db" is too short to redact safely, so the message is untouched.
    expect(msg).toContain("db");
  });

  it("redacts a password value that contains spaces (connection-string form)", () => {
    const msg: string = SqlMonitor.sanitizeError(
      new Error("login failed: Server=db;Password=my secret pass;Uid=sa"),
      undefined,
    );
    expect(msg).not.toContain("my secret pass");
  });
});

describe("SqlMonitor.coerceCell", () => {
  it("passes primitives through and coerces complex types", () => {
    expect(SqlMonitor.coerceCell(null)).toBeNull();
    expect(SqlMonitor.coerceCell(undefined)).toBeNull();
    expect(SqlMonitor.coerceCell(5)).toBe(5);
    expect(SqlMonitor.coerceCell("x")).toBe("x");
    expect(SqlMonitor.coerceCell(true)).toBe(true);
    expect(SqlMonitor.coerceCell(BigInt(42))).toBe("42");
    const date: Date = new Date("2026-01-01T00:00:00.000Z");
    expect(SqlMonitor.coerceCell(date)).toBe("2026-01-01T00:00:00.000Z");
    expect(SqlMonitor.coerceCell(Buffer.from("abc"))).toBe("[binary]");
    expect(SqlMonitor.coerceCell({ a: 1 })).toBe('{"a":1}');
  });
});

describe("SqlMonitor.shapeRows", () => {
  it("projects rowCount, scalar (first column), and firstRow", () => {
    const shaped: {
      rowCount: number;
      scalarValue: string | number | boolean | null;
      firstRow: Record<string, unknown> | null;
      isRowsCapped: boolean;
    } = SqlMonitor.shapeRows({
      rows: [{ cancelled: 7, other: "x" }],
      maxRows: 100,
    });

    expect(shaped.rowCount).toBe(1);
    expect(shaped.scalarValue).toBe(7);
    expect(shaped.firstRow).toEqual({ cancelled: 7, other: "x" });
    expect(shaped.isRowsCapped).toBe(false);
  });

  it("caps rows at maxRows and flags truncation", () => {
    const rows: Array<Record<string, unknown>> = [];
    for (let i: number = 0; i < 6; i++) {
      rows.push({ n: i });
    }

    const shaped: {
      rowCount: number;
      isRowsCapped: boolean;
    } = SqlMonitor.shapeRows({
      rows,
      maxRows: 5,
    });

    expect(shaped.rowCount).toBe(5);
    expect(shaped.isRowsCapped).toBe(true);
  });

  it("handles an empty result set", () => {
    const shaped: {
      rowCount: number;
      scalarValue: string | number | boolean | null;
      firstRow: Record<string, unknown> | null;
    } = SqlMonitor.shapeRows({ rows: [], maxRows: 100 });

    expect(shaped.rowCount).toBe(0);
    expect(shaped.scalarValue).toBeNull();
    expect(shaped.firstRow).toBeNull();
  });
});

describe("SqlMonitor.execute (guard rejections, no DB needed)", () => {
  it("returns a failure for a write query without connecting", async () => {
    const response: SqlMonitorResponse | null = await SqlMonitor.execute(
      {
        databaseType: "PostgreSQL" as any,
        host: "db.internal",
        port: 5432,
        databaseName: "orders",
        username: "readonly",
        password: "",
        useWindowsIntegratedAuthentication: false,
        useSsl: false,
        rejectUnauthorizedSsl: true,
        query: "DELETE FROM orders",
        connectionTimeoutInMs: 10000,
        statementTimeoutInMs: 15000,
        maxRows: 100,
      },
      { isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.queryError).toBeTruthy();
    expect(response!.rowCount).toBeNull();
  });

  it("returns a failure for an unsupported database type without connecting", async () => {
    const response: SqlMonitorResponse | null = await SqlMonitor.execute(
      {
        databaseType: "OracleDatabase" as any,
        host: "db.internal",
        port: 1521,
        databaseName: "orders",
        username: "readonly",
        password: "",
        useWindowsIntegratedAuthentication: false,
        useSsl: false,
        rejectUnauthorizedSsl: true,
        query: "SELECT 1",
        connectionTimeoutInMs: 10000,
        statementTimeoutInMs: 15000,
        maxRows: 100,
      },
      { isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.failureCause).toContain("not supported");
  });

  it("rejects a write query before connecting, for every supported engine", async () => {
    for (const databaseType of [
      "PostgreSQL",
      "MySQL",
      "Microsoft SQL Server",
    ]) {
      const response: SqlMonitorResponse | null = await SqlMonitor.execute(
        {
          databaseType: databaseType as any,
          host: "db.internal",
          port: 5432,
          databaseName: "orders",
          username: "readonly",
          password: "",
          useWindowsIntegratedAuthentication: false,
          useSsl: false,
          rejectUnauthorizedSsl: true,
          query: "DELETE FROM orders",
          connectionTimeoutInMs: 10000,
          statementTimeoutInMs: 15000,
          maxRows: 100,
        },
        { isOnlineCheckRequest: true },
      );

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(false);
      expect(response!.queryError).toBeTruthy();
    }
  });

  it("rejects integrated authentication for non-SQL Server engines", async () => {
    const response: SqlMonitorResponse | null = await SqlMonitor.execute(
      {
        databaseType: "PostgreSQL" as any,
        host: "db.internal",
        port: 5432,
        databaseName: "orders",
        username: "",
        password: "",
        useWindowsIntegratedAuthentication: true,
        useSsl: false,
        rejectUnauthorizedSsl: true,
        query: "SELECT 1",
        connectionTimeoutInMs: 10000,
        statementTimeoutInMs: 15000,
        maxRows: 100,
      },
      { isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.failureCause).toContain("only supported");
  });
});

describe("buildSqlServerIntegratedConnectionString", () => {
  it("uses a trusted connection without SQL login credentials", () => {
    const connectionString: string = buildSqlServerIntegratedConnectionString({
      host: "sql.internal",
      port: 1433,
      databaseName: "orders",
      useSsl: true,
      rejectUnauthorizedSsl: true,
    });

    expect(connectionString).toContain(`Driver={${SQL_SERVER_ODBC_DRIVER}}`);
    expect(connectionString).toContain("Server={sql.internal,1433}");
    expect(connectionString).toContain("Database={orders}");
    expect(connectionString).toContain("Trusted_Connection=yes");
    expect(connectionString).toContain("Encrypt=yes");
    expect(connectionString).toContain("TrustServerCertificate=no");
    expect(connectionString).not.toMatch(/(?:Uid|Pwd|Password)=/i);
  });

  it("escapes ODBC values and supports trusted self-signed certificates", () => {
    const connectionString: string = buildSqlServerIntegratedConnectionString({
      host: "sql;primary}",
      port: 1433,
      databaseName: "orders;archive}",
      useSsl: true,
      rejectUnauthorizedSsl: false,
    });

    expect(connectionString).toContain("Server={sql;primary}},1433}");
    expect(connectionString).toContain("Database={orders;archive}}}");
    expect(connectionString).toContain("TrustServerCertificate=yes");
  });

  it("turns encryption and certificate trust off together when TLS is disabled", () => {
    const connectionString: string = buildSqlServerIntegratedConnectionString({
      host: "sql.internal",
      port: 1433,
      databaseName: "orders",
      useSsl: false,
      rejectUnauthorizedSsl: false,
    });

    expect(connectionString).toContain("Encrypt=no");
    expect(connectionString).toContain("TrustServerCertificate=no");
  });

  it("defaults to the bundled driver but honors an explicit driver name", () => {
    const baseConfig: {
      host: string;
      port: number;
      databaseName: string;
      useSsl: boolean;
      rejectUnauthorizedSsl: boolean;
    } = {
      host: "sql.internal",
      port: 1433,
      databaseName: "orders",
      useSsl: true,
      rejectUnauthorizedSsl: true,
    };

    expect(buildSqlServerIntegratedConnectionString(baseConfig)).toContain(
      `Driver={${SQL_SERVER_ODBC_DRIVER}}`,
    );

    // A host that only has Driver 17 installed (the customer's environment).
    expect(
      buildSqlServerIntegratedConnectionString(
        baseConfig,
        "ODBC Driver 17 for SQL Server",
      ),
    ).toContain("Driver={ODBC Driver 17 for SQL Server}");
  });
});

describe("parseUnixOdbcInstDrivers", () => {
  it("extracts the bracketed driver section names from odbcinst output", () => {
    const output: string = [
      "[ODBC Driver 18 for SQL Server]",
      "[ODBC Driver 17 for SQL Server]",
      "[PostgreSQL Unicode]",
      "",
    ].join("\n");

    expect(parseUnixOdbcInstDrivers(output)).toEqual([
      "ODBC Driver 18 for SQL Server",
      "ODBC Driver 17 for SQL Server",
      "PostgreSQL Unicode",
    ]);
  });

  it("tolerates leading/trailing whitespace and CRLF line endings", () => {
    expect(
      parseUnixOdbcInstDrivers(
        "  [ODBC Driver 17 for SQL Server]  \r\n[MySQL]\r\n",
      ),
    ).toEqual(["ODBC Driver 17 for SQL Server", "MySQL"]);
  });

  it("returns an empty list for empty or non-matching output", () => {
    expect(parseUnixOdbcInstDrivers("")).toEqual([]);
    expect(parseUnixOdbcInstDrivers("no drivers here")).toEqual([]);
  });
});

describe("parseWindowsRegistryOdbcDrivers", () => {
  it("extracts value names from `reg query` output for the ODBC Drivers key", () => {
    const output: string = [
      "",
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\ODBC\\ODBCINST.INI\\ODBC Drivers",
      "    ODBC Driver 17 for SQL Server    REG_SZ    Installed",
      "    ODBC Driver 18 for SQL Server    REG_SZ    Installed",
      "    PostgreSQL Unicode(x64)    REG_SZ    Installed",
      "",
    ].join("\r\n");

    expect(parseWindowsRegistryOdbcDrivers(output)).toEqual([
      "ODBC Driver 17 for SQL Server",
      "ODBC Driver 18 for SQL Server",
      "PostgreSQL Unicode(x64)",
    ]);
  });

  it("does not treat the key path header line as a driver", () => {
    const output: string =
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\ODBC\\ODBCINST.INI\\ODBC Drivers\r\n";
    expect(parseWindowsRegistryOdbcDrivers(output)).toEqual([]);
  });
});

describe("pickBestSqlServerOdbcDriver", () => {
  it("selects the highest SQL Server driver version and ignores other drivers", () => {
    expect(
      pickBestSqlServerOdbcDriver([
        "PostgreSQL Unicode",
        "ODBC Driver 17 for SQL Server",
        "ODBC Driver 18 for SQL Server",
        "MySQL ODBC 8.0 Driver",
      ]),
    ).toBe("ODBC Driver 18 for SQL Server");
  });

  it("selects the only installed SQL Server driver when it is older than the default", () => {
    expect(
      pickBestSqlServerOdbcDriver([
        "ODBC Driver 13 for SQL Server",
        "ODBC Driver 17 for SQL Server",
      ]),
    ).toBe("ODBC Driver 17 for SQL Server");
  });

  it("is case-insensitive on the driver name", () => {
    expect(pickBestSqlServerOdbcDriver(["odbc driver 18 for sql server"])).toBe(
      "odbc driver 18 for sql server",
    );
  });

  it("returns null when no SQL Server driver is registered", () => {
    expect(pickBestSqlServerOdbcDriver([])).toBeNull();
    expect(
      pickBestSqlServerOdbcDriver(["PostgreSQL Unicode", "SQLite3"]),
    ).toBeNull();
  });
});

describe("resolveSqlServerOdbcDriver", () => {
  it("prefers an explicit environment override over detection", async () => {
    resetSqlServerOdbcDriverCache();
    const driver: string = await resolveSqlServerOdbcDriver({
      envValue: "ODBC Driver 99 for SQL Server",
      lister: () => {
        return ["ODBC Driver 17 for SQL Server"];
      },
      useCache: false,
    });
    expect(driver).toBe("ODBC Driver 99 for SQL Server");
  });

  it("reads the override from process.env when no options are passed", async () => {
    resetSqlServerOdbcDriverCache();
    const previous: string | undefined = process.env["SQL_SERVER_ODBC_DRIVER"];
    process.env["SQL_SERVER_ODBC_DRIVER"] = "ODBC Driver 42 for SQL Server";
    try {
      /*
       * No envValue key and no lister: exercises the real process.env branch
       * and the "envValue" in options seam — the production code path.
       */
      const driver: string = await resolveSqlServerOdbcDriver({
        useCache: false,
      });
      expect(driver).toBe("ODBC Driver 42 for SQL Server");
    } finally {
      if (previous === undefined) {
        delete process.env["SQL_SERVER_ODBC_DRIVER"];
      } else {
        process.env["SQL_SERVER_ODBC_DRIVER"] = previous;
      }
    }
  });

  it("falls through to detection when the process.env override is absent", async () => {
    resetSqlServerOdbcDriverCache();
    const previous: string | undefined = process.env["SQL_SERVER_ODBC_DRIVER"];
    delete process.env["SQL_SERVER_ODBC_DRIVER"];
    try {
      const driver: string = await resolveSqlServerOdbcDriver({
        lister: () => {
          return ["ODBC Driver 17 for SQL Server"];
        },
        useCache: false,
      });
      expect(driver).toBe("ODBC Driver 17 for SQL Server");
    } finally {
      if (previous !== undefined) {
        process.env["SQL_SERVER_ODBC_DRIVER"] = previous;
      }
    }
  });

  it("auto-detects the newest installed driver when no override is set", async () => {
    resetSqlServerOdbcDriverCache();
    const driver: string = await resolveSqlServerOdbcDriver({
      envValue: undefined,
      lister: () => {
        return [
          "ODBC Driver 17 for SQL Server",
          "ODBC Driver 18 for SQL Server",
        ];
      },
      useCache: false,
    });
    expect(driver).toBe("ODBC Driver 18 for SQL Server");
  });

  it("awaits an async lister (real detection is asynchronous)", async () => {
    resetSqlServerOdbcDriverCache();
    const driver: string = await resolveSqlServerOdbcDriver({
      envValue: undefined,
      lister: async () => {
        return Promise.resolve(["ODBC Driver 17 for SQL Server"]);
      },
      useCache: false,
    });
    expect(driver).toBe("ODBC Driver 17 for SQL Server");
  });

  it("detects an older-than-default driver on a host that only has it (the reported bug)", async () => {
    resetSqlServerOdbcDriverCache();
    const driver: string = await resolveSqlServerOdbcDriver({
      envValue: undefined,
      lister: () => {
        return ["ODBC Driver 17 for SQL Server"];
      },
      useCache: false,
    });
    expect(driver).toBe("ODBC Driver 17 for SQL Server");
  });

  it("falls back to the bundled default when nothing is detected", async () => {
    resetSqlServerOdbcDriverCache();
    const driver: string = await resolveSqlServerOdbcDriver({
      envValue: undefined,
      lister: () => {
        return [];
      },
      useCache: false,
    });
    expect(driver).toBe(SQL_SERVER_ODBC_DRIVER);
  });

  it("ignores a blank/whitespace override and falls through to detection", async () => {
    resetSqlServerOdbcDriverCache();
    const driver: string = await resolveSqlServerOdbcDriver({
      envValue: "   ",
      lister: () => {
        return ["ODBC Driver 17 for SQL Server"];
      },
      useCache: false,
    });
    expect(driver).toBe("ODBC Driver 17 for SQL Server");
  });

  it("memoizes a positive detection and can be reset", async () => {
    resetSqlServerOdbcDriverCache();
    let listerCalls: number = 0;

    const first: string = await resolveSqlServerOdbcDriver({
      envValue: undefined,
      lister: () => {
        listerCalls++;
        return ["ODBC Driver 18 for SQL Server"];
      },
    });

    // Second call hits the cache; the (different) lister is never consulted.
    const second: string = await resolveSqlServerOdbcDriver({
      envValue: undefined,
      lister: () => {
        listerCalls++;
        return ["ODBC Driver 17 for SQL Server"];
      },
    });

    expect(first).toBe("ODBC Driver 18 for SQL Server");
    expect(second).toBe("ODBC Driver 18 for SQL Server");
    expect(listerCalls).toBe(1);

    resetSqlServerOdbcDriverCache();
  });

  it("does NOT cache the fallback, so a transient detection failure is retried", async () => {
    resetSqlServerOdbcDriverCache();
    let listerCalls: number = 0;

    /*
     * First call: detection transiently fails (empty) -> falls back to default.
     * Second call: detection recovers and reports the host's real driver.
     */
    const lister: () => Array<string> = () => {
      listerCalls++;
      return listerCalls === 1 ? [] : ["ODBC Driver 17 for SQL Server"];
    };

    const first: string = await resolveSqlServerOdbcDriver({
      envValue: undefined,
      lister,
    });
    const second: string = await resolveSqlServerOdbcDriver({
      envValue: undefined,
      lister,
    });

    // The fallback was not cached, so detection ran again and won.
    expect(first).toBe(SQL_SERVER_ODBC_DRIVER);
    expect(second).toBe("ODBC Driver 17 for SQL Server");
    expect(listerCalls).toBe(2);

    resetSqlServerOdbcDriverCache();
  });
});

describe("buildMicrosoftSqlServerPoolConfig", () => {
  it("preserves SQL login credentials for the default Tedious driver", () => {
    const poolConfig: MicrosoftSqlServerPoolConfig =
      buildMicrosoftSqlServerPoolConfig({
        config: getMicrosoftSqlServerConfig(),
        connectionTimeoutInMs: 7000,
        statementTimeoutInMs: 9000,
      });

    expect(poolConfig.server).toBe("sql.internal");
    expect(poolConfig.port).toBe(1433);
    expect(poolConfig.database).toBe("orders");
    expect(poolConfig.user).toBe("readonly");
    expect(poolConfig.password).toBe("sql-password");
    expect(poolConfig.connectionString).toBeUndefined();
    expect(poolConfig.connectionTimeout).toBe(7000);
    expect(poolConfig.requestTimeout).toBe(9000);
    expect(poolConfig.options?.encrypt).toBe(true);
    expect(poolConfig.options?.trustServerCertificate).toBe(false);
  });

  it("omits every SQL credential property for integrated authentication", () => {
    const poolConfig: MicrosoftSqlServerPoolConfig =
      buildMicrosoftSqlServerPoolConfig({
        config: getMicrosoftSqlServerConfig({
          username: "must-not-leak-user",
          password: "must-not-leak-password",
          useWindowsIntegratedAuthentication: true,
        }),
        connectionTimeoutInMs: 7000,
        statementTimeoutInMs: 9000,
      });

    expect(Object.prototype.hasOwnProperty.call(poolConfig, "user")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(poolConfig, "password")).toBe(
      false,
    );
    expect(poolConfig.connectionString).toContain("Trusted_Connection=yes");
    expect(poolConfig.connectionString).not.toContain("must-not-leak-user");
    expect(poolConfig.connectionString).not.toContain("must-not-leak-password");
  });

  it("keeps pool sizing, timeout, and application metadata identical for both authentication modes", () => {
    for (const useWindowsIntegratedAuthentication of [false, true]) {
      const poolConfig: MicrosoftSqlServerPoolConfig =
        buildMicrosoftSqlServerPoolConfig({
          config: getMicrosoftSqlServerConfig({
            useWindowsIntegratedAuthentication,
          }),
          connectionTimeoutInMs: 1234,
          statementTimeoutInMs: 5678,
        });

      expect(poolConfig.connectionTimeout).toBe(1234);
      expect(poolConfig.requestTimeout).toBe(5678);
      expect(poolConfig.pool).toEqual({
        max: 1,
        min: 0,
        idleTimeoutMillis: 30000,
      });
      expect(poolConfig.options?.appName).toBe("OneUptimeProbe-SQLMonitor");
    }
  });

  it("threads a resolved ODBC driver into the integrated connection string", () => {
    const poolConfig: MicrosoftSqlServerPoolConfig =
      buildMicrosoftSqlServerPoolConfig({
        config: getMicrosoftSqlServerConfig({
          useWindowsIntegratedAuthentication: true,
        }),
        connectionTimeoutInMs: 7000,
        statementTimeoutInMs: 9000,
        odbcDriver: "ODBC Driver 17 for SQL Server",
      });

    expect(poolConfig.connectionString).toContain(
      "Driver={ODBC Driver 17 for SQL Server}",
    );
  });

  it("uses the bundled default driver when none is provided", () => {
    const poolConfig: MicrosoftSqlServerPoolConfig =
      buildMicrosoftSqlServerPoolConfig({
        config: getMicrosoftSqlServerConfig({
          useWindowsIntegratedAuthentication: true,
        }),
        connectionTimeoutInMs: 7000,
        statementTimeoutInMs: 9000,
      });

    expect(poolConfig.connectionString).toContain(
      `Driver={${SQL_SERVER_ODBC_DRIVER}}`,
    );
  });
});

describe("loadMicrosoftSqlServerDriver", () => {
  it("does not load the native module for SQL login authentication", () => {
    let loaderWasCalled: boolean = false;

    const driver: typeof mssql = loadMicrosoftSqlServerDriver(false, () => {
      loaderWasCalled = true;
      throw new Error("The native driver must remain lazy");
    });

    expect(loaderWasCalled).toBe(false);
    expect(driver.ConnectionPool).toBe(mssql.ConnectionPool);
  });

  it("loads the msnodesqlv8 mssql adapter for integrated authentication", () => {
    const fakeDriver: typeof mssql = {
      marker: "native-driver",
    } as unknown as typeof mssql;
    let requestedModule: string | undefined;

    const driver: typeof mssql = loadMicrosoftSqlServerDriver(
      true,
      (moduleId: string): unknown => {
        requestedModule = moduleId;
        return fakeDriver;
      },
    );

    expect(requestedModule).toBe("mssql/msnodesqlv8");
    expect(driver).toBe(fakeDriver);
  });

  it("returns an actionable error when the native driver cannot load", () => {
    expect(() => {
      loadMicrosoftSqlServerDriver(true, () => {
        throw new Error("missing native binding");
      });
    }).toThrow("Windows Integrated Authentication requires");

    expect(() => {
      loadMicrosoftSqlServerDriver(true, () => {
        throw new Error("missing native binding");
      });
    }).toThrow(SQL_SERVER_ODBC_DRIVER);

    /*
     * The message must not overstate the requirement: after auto-detection, a
     * different installed version (e.g. Driver 17) also works, so the error
     * explicitly says other versions are detected automatically. Pin that so a
     * revert to a version-specific message is caught.
     */
    expect(() => {
      loadMicrosoftSqlServerDriver(true, () => {
        throw new Error("missing native binding");
      });
    }).toThrow(/detected automatically/);
  });
});

describe("ODBC driver detection stays off the synchronous path", () => {
  /*
   * The probe multiplexes many monitors on a single event loop, so host ODBC
   * driver detection must use asynchronous child_process execution. Guard the
   * source against a regression back to a blocking synchronous spawn — the
   * behavioral tests inject a lister and cannot catch that. (Same source-text
   * assertion idiom as Tests/Build/ProbeDockerfile.test.ts.)
   */
  const source: string = readFileSync(
    resolve(__dirname, "../../../../Utils/Monitors/MonitorTypes/SqlMonitor.ts"),
    "utf8",
  );

  it("uses promisified async execFile for driver detection", () => {
    expect(source).toContain("promisify(execFile)");
  });

  it("does not use synchronous, event-loop-blocking child_process APIs", () => {
    expect(source).not.toContain("execFileSync");
    expect(source).not.toContain("execSync");
    expect(source).not.toContain("spawnSync");
  });
});
