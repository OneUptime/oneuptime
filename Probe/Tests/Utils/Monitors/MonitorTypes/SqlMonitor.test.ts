// Set required env vars before importing SqlMonitor (which imports Config.ts).
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import SqlMonitor, {
  buildSqlServerIntegratedConnectionString,
  SQL_SERVER_ODBC_DRIVER,
  SqlQueryValidator,
} from "../../../../Utils/Monitors/MonitorTypes/SqlMonitor";
import SqlMonitorResponse from "Common/Types/Monitor/SqlMonitor/SqlMonitorResponse";
import { describe, expect, it } from "@jest/globals";

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
});
