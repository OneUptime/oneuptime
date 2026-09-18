import { afterEach, describe, expect, test } from "@jest/globals";
import SqlQueryGuard from "../../../../Server/Utils/DataSource/SqlQueryGuard";
import BadDataException from "../../../../Types/Exception/BadDataException";

/*
 * Fixed macro window: 2026-01-05T07:08:09Z ... 2026-01-06T07:08:09Z.
 * 2026-01-01T00:00:00Z is epoch second 1767225600, so:
 *   start = 1767225600 + 4*86400 + 7*3600 + 8*60 + 9 = 1767596889 s
 *   end   = start + 86400                            = 1767683289 s
 * The single-digit month/day/hour/minute/second exercise UTC zero-padding.
 */
const MACRO_START: Date = new Date(Date.UTC(2026, 0, 5, 7, 8, 9));
const MACRO_END: Date = new Date(Date.UTC(2026, 0, 6, 7, 8, 9));
const MACRO_START_MS: string = "1767596889000";
const MACRO_END_MS: string = "1767683289000";
const MACRO_START_LITERAL: string = "'2026-01-05 07:08:09'";
const MACRO_END_LITERAL: string = "'2026-01-06 07:08:09'";

const expectAllowed: (sql: string) => void = (sql: string): void => {
  expect(() => {
    return SqlQueryGuard.assertReadOnlyQuery(sql);
  }).not.toThrow();
};

const expectRejected: (sql: string, messagePart: string) => void = (
  sql: string,
  messagePart: string,
): void => {
  let thrown: unknown = null;
  try {
    SqlQueryGuard.assertReadOnlyQuery(sql);
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(BadDataException);
  expect((thrown as BadDataException).message).toContain(messagePart);
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SqlQueryGuard.assertReadOnlyQuery — allowed queries", () => {
  const allowedQueries: Array<string> = [
    "SELECT * FROM users",
    "WITH cte AS (SELECT 1 AS n) SELECT * FROM cte",
    "SHOW TABLES",
    "EXPLAIN SELECT 1",
    "EXPLAIN ANALYZE SELECT count(*) FROM events",
    "DESCRIBE users",
    "DESC users",
    "SELECT 1;",
    "SELECT 1;   \n",
    "SELECT 1 -- a harmless trailing comment",
    "SELECT /* an inline block comment */ 1",
    "SELECT 'DROP TABLE x' AS s",
    "SELECT 'it''s quoted with a doubled quote' AS s",
    'SELECT "delete" FROM t',
    "SELECT `delete` FROM t",
    "SELECT [delete] FROM t",
    "SELECT $$DROP$$ AS x",
    "SELECT $tag$DROP$tag$ AS x",
    "SELECT * FROM system.query_log",
    "SELECT created, settings, offset FROM audit",
  ];

  test.each(allowedQueries)("allows: %s", (sql: string) => {
    expectAllowed(sql);
  });
});

describe("SqlQueryGuard.assertReadOnlyQuery — rejected statement heads", () => {
  const forbiddenHeadStatements: Array<string> = [
    "INSERT INTO t VALUES (1)",
    "UPDATE t SET a = 1",
    "DELETE FROM t",
    "MERGE INTO target USING src ON 1 = 1",
    "DROP TABLE t",
    "ALTER TABLE t ADD c INT",
    "CREATE TABLE t (a INT)",
    "TRUNCATE TABLE t",
    "GRANT SELECT ON t TO u",
    "REVOKE SELECT ON t FROM u",
    "EXEC my_proc",
    "EXECUTE my_proc",
    "CALL my_proc()",
    "DO 1",
    "COPY t TO STDOUT",
    "SET search_path TO evil",
    "LOCK TABLE t",
    "VACUUM",
    "BEGIN",
    "COMMIT",
    "DBCC CHECKDB",
    "BACKUP DATABASE d TO DISK = 'x'",
    "KILL 42",
    "USE master",
  ];

  test.each(forbiddenHeadStatements)("rejects head: %s", (sql: string) => {
    expectRejected(sql, "must start with");
  });
});

describe("SqlQueryGuard.assertReadOnlyQuery — embedded forbidden keywords", () => {
  const embeddedKeywords: Array<string> = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "MERGE",
    "DROP",
    "ALTER",
    "CREATE",
    "TRUNCATE",
    "GRANT",
    "REVOKE",
    "EXEC",
    "EXECUTE",
    "CALL",
    "DO",
    "COPY",
    "SET",
    "LOCK",
    "VACUUM",
    "BEGIN",
    "COMMIT",
    "WAITFOR",
    "DBCC",
    "BACKUP",
    "KILL",
    "USE",
  ];

  test.each(embeddedKeywords)(
    "rejects embedded keyword and names it: %s",
    (keyword: string) => {
      expectRejected(`SELECT 1 WHERE ${keyword} = 1`, keyword);
    },
  );

  test("rejects SELECT ... INTO a table", () => {
    expectRejected("SELECT * INTO backup_table FROM t", "INTO");
  });

  test("rejects SELECT ... INTO OUTFILE", () => {
    expectRejected("SELECT * FROM t INTO OUTFILE '/tmp/x'", "INTO");
  });

  test("rejects data-modifying CTE (WITH ... DELETE)", () => {
    expectRejected("WITH x AS (SELECT 1) DELETE FROM t", "DELETE");
  });

  test("rejects T-SQL whitespace batch without a semicolon", () => {
    expectRejected("SELECT 1 DROP TABLE x", "DROP");
  });

  test("rejects OPENROWSET", () => {
    expectRejected(
      "SELECT * FROM OPENROWSET('SQLNCLI', 'srv', 'SELECT 1')",
      "OPENROWSET",
    );
  });

  test("rejects OPENQUERY", () => {
    expectRejected("SELECT * FROM OPENQUERY(linked, 'SELECT 1')", "OPENQUERY");
  });

  test("rejects WAITFOR in an otherwise-valid SELECT", () => {
    expectRejected("SELECT 1 WAITFOR DELAY '00:00:05'", "WAITFOR");
  });

  test("rejects xp_ extended stored procedures", () => {
    expectRejected("SELECT xp_cmdshell('dir')", "system stored procedures");
  });

  test("rejects sp_ system stored procedures", () => {
    expectRejected(
      "SELECT sp_configure('show advanced options')",
      "system stored procedures",
    );
  });
});

describe("SqlQueryGuard.assertReadOnlyQuery — multi-statement and smuggling", () => {
  test("rejects classic multi-statement injection", () => {
    expectRejected("SELECT 1; DROP TABLE x", "single SQL statement");
  });

  test("rejects a semicolon hidden after a block comment", () => {
    expectRejected("SELECT 1 /* x */ ; DROP TABLE y", "single SQL statement");
  });

  test("does NOT treat # as a comment (T-SQL temp tables)", () => {
    /*
     * If # started a comment (MySQL semantics), the '; DROP TABLE x' would
     * be blanked away and the batch would pass while SQL Server executed
     * the DROP. The guard must still see the semicolon.
     */
    expectRejected("SELECT * FROM #tmp; DROP TABLE x", "single SQL statement");
  });

  test("rejects backslash-escaped single quote strings", () => {
    expectRejected(
      "SELECT 'a\\' ; DROP TABLE x --'",
      "Backslash-escaped quotes",
    );
  });

  test("rejects backslash-escaped double quote strings", () => {
    expectRejected('SELECT "a\\" ; DROP TABLE x --"', "Backslash-escaped");
  });

  test("rejects an empty query", () => {
    expectRejected("", "Query is required");
  });

  test("rejects a whitespace-only query", () => {
    expectRejected("   \n\t ", "Query is required");
  });

  test("nested block comment cannot fake an allowed head", () => {
    /*
     * Block comments nest (PostgreSQL / T-SQL semantics), so the first
     * close marker only drops the nesting depth to 1 and the SELECT that
     * follows it is still comment content; the first real word is DROP
     * and the head check rejects it.
     */
    expectRejected(
      "/* outer /* inner */ SELECT */ DROP TABLE x",
      "must start with",
    );
  });
});

describe("SqlQueryGuard.stripLiteralsAndComments", () => {
  const lengthPreservingInputs: Array<string> = [
    "SELECT 'it''s' FROM t",
    'SELECT "a""b" FROM t',
    "SELECT `de``lete` FROM t",
    "SELECT [a]]b] FROM t",
    "SELECT 'abc",
    "/*a/*b*/c*/SELECT 1",
    "SELECT 1 -- DROP\nOK",
    "SELECT $$DROP$$ AS x",
    "SELECT $tag$DROP$tag$ AS x",
    "SELECT a'x'b FROM t",
    "SELECT 1 /* DROP",
    "SELECT $$DROP",
  ];

  test.each(lengthPreservingInputs)(
    "blanking preserves input length: %s",
    (sql: string) => {
      const stripped: string = SqlQueryGuard.stripLiteralsAndComments(sql);
      expect(stripped.length).toBe(sql.length);
    },
  );

  test("blanks single-quoted string with '' escape without closing early", () => {
    const stripped: string = SqlQueryGuard.stripLiteralsAndComments(
      "SELECT 'it''s' FROM t",
    );
    expect(stripped).toBe(`SELECT ${" ".repeat(7)} FROM t`);
  });

  test('blanks double-quoted identifier with "" escape', () => {
    const stripped: string = SqlQueryGuard.stripLiteralsAndComments(
      'SELECT "a""b" FROM t',
    );
    expect(stripped).toBe(`SELECT ${" ".repeat(6)} FROM t`);
  });

  test("blanks backtick identifier with `` escape", () => {
    const stripped: string = SqlQueryGuard.stripLiteralsAndComments(
      "SELECT `de``lete` FROM t",
    );
    expect(stripped).toBe(`SELECT ${" ".repeat(10)} FROM t`);
  });

  test("blanks bracket identifier with ]] escape", () => {
    const stripped: string = SqlQueryGuard.stripLiteralsAndComments(
      "SELECT [a]]b] FROM t",
    );
    expect(stripped).toBe(`SELECT ${" ".repeat(6)} FROM t`);
  });

  test("unterminated string blanks to end of input", () => {
    const stripped: string =
      SqlQueryGuard.stripLiteralsAndComments("SELECT 'abc");
    expect(stripped).toBe(`SELECT ${" ".repeat(4)}`);
  });

  test("unterminated block comment blanks to end of input", () => {
    const stripped: string =
      SqlQueryGuard.stripLiteralsAndComments("SELECT 1 /* DROP");
    expect(stripped).toBe(`SELECT 1 ${" ".repeat(7)}`);
  });

  test("unterminated dollar quote blanks to end of input", () => {
    const stripped: string =
      SqlQueryGuard.stripLiteralsAndComments("SELECT $$DROP");
    expect(stripped).toBe(`SELECT ${" ".repeat(6)}`);
  });

  test("nested block comments are fully blanked", () => {
    const stripped: string = SqlQueryGuard.stripLiteralsAndComments(
      "/*a/*b*/c*/SELECT 1",
    );
    expect(stripped).toBe(`${" ".repeat(11)}SELECT 1`);
  });

  test("line comment blanks to newline and keeps the newline", () => {
    const stripped: string = SqlQueryGuard.stripLiteralsAndComments(
      "SELECT 1 -- DROP\nOK",
    );
    expect(stripped).toBe(`SELECT 1 ${" ".repeat(7)}\nOK`);
  });

  test("blanks $$ dollar-quoted string", () => {
    const stripped: string = SqlQueryGuard.stripLiteralsAndComments(
      "SELECT $$DROP$$ AS x",
    );
    expect(stripped).toBe(`SELECT ${" ".repeat(8)} AS x`);
  });

  test("blanks $tag$ dollar-quoted string", () => {
    const stripped: string = SqlQueryGuard.stripLiteralsAndComments(
      "SELECT $tag$DROP$tag$ AS x",
    );
    expect(stripped).toBe(`SELECT ${" ".repeat(14)} AS x`);
  });

  test("blanking preserves token boundaries around a literal", () => {
    /*
     * 'a' and 'b' must not merge into a single 'ab' token once the string
     * between them is blanked — spaces, not deletion.
     */
    const stripped: string = SqlQueryGuard.stripLiteralsAndComments(
      "SELECT a'x'b FROM t",
    );
    expect(stripped).toBe("SELECT a   b FROM t");
  });
});

describe("SqlQueryGuard.applyTimeMacros", () => {
  test("replaces $__startTime with a quoted zero-padded UTC literal", () => {
    const result: string = SqlQueryGuard.applyTimeMacros(
      "SELECT * FROM t WHERE ts >= $__startTime",
      MACRO_START,
      MACRO_END,
    );
    expect(result).toBe(`SELECT * FROM t WHERE ts >= ${MACRO_START_LITERAL}`);
  });

  test("replaces $__endTime with a quoted zero-padded UTC literal", () => {
    const result: string = SqlQueryGuard.applyTimeMacros(
      "SELECT * FROM t WHERE ts <= $__endTime",
      MACRO_START,
      MACRO_END,
    );
    expect(result).toBe(`SELECT * FROM t WHERE ts <= ${MACRO_END_LITERAL}`);
  });

  test("replaces Ms variants with raw epoch millisecond numbers", () => {
    const result: string = SqlQueryGuard.applyTimeMacros(
      "WHERE ms BETWEEN $__startTimeMs AND $__endTimeMs",
      MACRO_START,
      MACRO_END,
    );
    expect(result).toBe(
      `WHERE ms BETWEEN ${MACRO_START_MS} AND ${MACRO_END_MS}`,
    );
    expect(MACRO_START.getTime().toString()).toBe(MACRO_START_MS);
    expect(MACRO_END.getTime().toString()).toBe(MACRO_END_MS);
  });

  test("does not corrupt $__startTimeMs when both macros are present", () => {
    const result: string = SqlQueryGuard.applyTimeMacros(
      "SELECT $__startTimeMs AS a, $__startTime AS b",
      MACRO_START,
      MACRO_END,
    );
    expect(result).toBe(
      `SELECT ${MACRO_START_MS} AS a, ${MACRO_START_LITERAL} AS b`,
    );
  });

  test("replaces every occurrence of a macro", () => {
    const result: string = SqlQueryGuard.applyTimeMacros(
      "$__endTime/$__endTime",
      MACRO_START,
      MACRO_END,
    );
    expect(result).toBe(`${MACRO_END_LITERAL}/${MACRO_END_LITERAL}`);
    expect(result).not.toContain("$__");
  });

  test("replaces $__rangeSeconds with the whole-second window size", () => {
    const result: string = SqlQueryGuard.applyTimeMacros(
      "WHERE age < $__rangeSeconds",
      MACRO_START,
      MACRO_END,
    );
    expect(result).toBe("WHERE age < 86400");
  });

  test("floors fractional-second ranges", () => {
    const endDate: Date = new Date(MACRO_START.getTime() + 90500);
    const result: string = SqlQueryGuard.applyTimeMacros(
      "$__rangeSeconds",
      MACRO_START,
      endDate,
    );
    expect(result).toBe("90");
  });

  test("clamps a negative range to 0", () => {
    const result: string = SqlQueryGuard.applyTimeMacros(
      "$__rangeSeconds",
      MACRO_END,
      MACRO_START,
    );
    expect(result).toBe("0");
  });
});
