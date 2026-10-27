// Set required env vars before importing SqlMonitor (which imports Config.ts).
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import SqlMonitor, {
  SqlQueryValidator,
} from "../../../../Utils/Monitors/MonitorTypes/SqlMonitor";
import SqlMonitorResponse from "Common/Types/Monitor/SqlMonitor/SqlMonitorResponse";
import MonitorStepSqlMonitor from "Common/Types/Monitor/MonitorStepSqlMonitor";
import SqlDatabaseType from "Common/Types/Monitor/SqlDatabaseType";
import { generatedTexts } from "Common/Tests/Helpers/GeneratedTexts";
import { fastestRun } from "Common/Tests/Helpers/FastestRun";
import { describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A SQL MONITOR'S QUERY, AND THE ERROR ITS DATABASE SENDS BACK, ARE READ IN
 * TIME IN LINE WITH THEIR LENGTH.
 *
 * Every probe - a shared one too - checks a project's query before it runs
 * it, and redacts the database's error before it is stored. The query is
 * the project's own text and the error is whatever the database sent back,
 * so both can be of any length and any shape; each pattern that reads them
 * now reads them once, and still finds exactly what it found.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

type TimedFunction = () => unknown;

/*
 * How long the work takes: the fastest of up to three attempts, counted as
 * it would have run on a usual runner when every attempt overran on a slow
 * one (Tests/Helpers/FastestRun).
 */
const timeOf: (run: TimedFunction) => number = (run: TimedFunction): number => {
  return fastestRun({ run: run, limitInMs: 2000 }).inMs;
};

const QUERY_WORST_CASES: Array<[string, string]> = [
  ["comments that never close", "SELECT 1 " + repeat("/* ", LENGTH)],
  ["openings run together", "SELECT 1 " + repeat("\u0000/*", LENGTH)],
  ["quotes that never close", "SELECT " + repeat("'\\", LENGTH) + "\n''"],
  [
    "double quotes that never close",
    "SELECT " + repeat('"\\', LENGTH) + '\n""',
  ],
  [
    "semicolons that are not at the end",
    "SELECT 1" + repeat(";", LENGTH) + "x;",
  ],
  ["semicolons inside a literal", "SELECT '" + repeat(";", LENGTH) + "x'"],
];

describe("a query is checked in time in line with its length", () => {
  it.each(QUERY_WORST_CASES)("%s", (_label: string, query: string) => {
    expect(
      timeOf(() => {
        return SqlQueryValidator.getRejectionReason(query);
      }),
    ).toBeLessThan(2000);
  });

  /*
   * Through the monitor's own check: each worst case followed by a second
   * statement, which the check must read all of the query to find - and
   * which it refuses before any connection is made.
   */
  it.each(QUERY_WORST_CASES)(
    "%s, then a second statement, through the monitor's check",
    async (_label: string, query: string) => {
      const config: MonitorStepSqlMonitor = {
        databaseType: SqlDatabaseType.PostgreSQL,
        host: "db.example.com",
        port: 5432,
        databaseName: "app",
        username: "reader",
        password: "pw-not-real",
        query: query + " ; DROP TABLE accounts",
      } as MonitorStepSqlMonitor;

      const startedAt: number = Date.now();
      const response: SqlMonitorResponse | null = await SqlMonitor.execute(
        config,
        {},
      );

      expect(Date.now() - startedAt).toBeLessThan(2000);
      expect(response?.queryError).toBe(
        "Multiple SQL statements are not allowed. Provide a single read-only query.",
      );
    },
  );
});

const ERROR_WORST_CASES: Array<[string, string]> = [
  ["schemes run together", repeat("A://", LENGTH) + "\tA://@"],
  ["one long run of letters", "x " + repeat("a", LENGTH)],
  ["a brace with no closing one, line after line", repeat("pwd={\n", LENGTH)],
  ["white space after a separator", "pwd=" + repeat(" \t", LENGTH) + ";"],
];

describe("a database's error is redacted in time in line with its length", () => {
  it.each(ERROR_WORST_CASES)("%s", (_label: string, message: string) => {
    expect(
      timeOf(() => {
        return SqlMonitor.sanitizeError(new Error(message), "hunter2", [
          "db.example.com",
          "reader",
        ]);
      }),
    ).toBeLessThan(2000);
  });

  it("still redacts the address, the setting and the secrets", () => {
    expect(
      SqlMonitor.sanitizeError(
        new Error(
          "connect postgres://reader:hunter2@db.example.com/app failed; Password=hunter2;Server=db.example.com",
        ),
        "hunter2",
        ["db.example.com"],
      ),
    ).toBe("connect [redacted-dsn] failed; Password=***;Server=***");
  });
});

/*
 * The patterns the checks used, as they were: the reference the new ones
 * must agree with, on texts drawn from the pieces they react to.
 */
const COMMENTS_BEFORE: (query: string) => string = (query: string): string => {
  return query.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
};

const LITERALS_BEFORE: (query: string) => string = (query: string): string => {
  return query
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""');
};

const COMMENT_ALPHABET: ReadonlyArray<string> = [
  "/*",
  "/*",
  "*/",
  "*",
  "/",
  "-",
  "--",
  "\n",
  "\r",
  " ",
  "a",
  "'",
  ";",
];

const LITERAL_ALPHABET: ReadonlyArray<string> = [
  "'",
  "'",
  "''",
  '"',
  '""',
  "\\",
  "\\'",
  "\n",
  "\r",
  "\u2028",
  " ",
  "a",
  ";",
];

describe("the checks strip exactly what they stripped before", () => {
  it("comments, on forty thousand drawn queries", () => {
    const mismatches: Array<{ query: string; now: string; before: string }> =
      [];
    let stripped: number = 0;

    for (const query of generatedTexts(40000, 8080, COMMENT_ALPHABET, 16)) {
      const before: string = COMMENTS_BEFORE(query);
      const now: string = SqlQueryValidator.stripComments(query);

      if (before !== query) {
        stripped++;
      }

      if (now !== before) {
        mismatches.push({ query, now, before });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(stripped).toBeGreaterThan(5000);
  });

  it("string literals, on forty thousand drawn queries", () => {
    const mismatches: Array<{ query: string; now: string; before: string }> =
      [];
    let stripped: number = 0;

    for (const query of generatedTexts(40000, 9090, LITERAL_ALPHABET, 16)) {
      const before: string = LITERALS_BEFORE(query);
      const now: string = SqlQueryValidator.stripStringLiterals(query);

      if (before !== query) {
        stripped++;
      }

      if (now !== before) {
        mismatches.push({ query, now, before });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(stripped).toBeGreaterThan(5000);
  });

  it("an unclosed comment or literal is left as it was written", () => {
    expect(SqlQueryValidator.stripComments("SELECT 1 /* open")).toBe(
      "SELECT 1 /* open",
    );
    expect(SqlQueryValidator.stripStringLiterals("SELECT 'open")).toBe(
      "SELECT 'open",
    );
    // An escaped quote at a line break does not close it either.
    expect(SqlQueryValidator.stripStringLiterals("SELECT 'a\\\n'b'")).toBe(
      "SELECT 'a\\\n''",
    );
  });

  it("still refuses a second statement hidden after a long run, and accepts one read-only query", () => {
    expect(
      SqlQueryValidator.getRejectionReason(
        "SELECT 1" + repeat(";", 1000) + " DROP TABLE x;",
      ),
    ).toBe(
      "Multiple SQL statements are not allowed. Provide a single read-only query.",
    );
    expect(SqlQueryValidator.getRejectionReason("SELECT 1;;;  ")).toBeNull();
    expect(
      SqlQueryValidator.getRejectionReason("SELECT ';;;' /* c */ ;"),
    ).toBeNull();
  });
});
