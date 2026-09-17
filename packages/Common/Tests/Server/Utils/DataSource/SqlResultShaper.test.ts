import { afterEach, describe, expect, test } from "@jest/globals";
import SqlResultShaper from "../../../../Server/Utils/DataSource/SqlResultShaper";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import DataSourceTableResult, {
  DataSourceTableColumnType,
} from "../../../../Types/DataSource/DataSourceTableResult";
import BadDataException from "../../../../Types/Exception/BadDataException";

/* 2026-01-01T00:00:00Z — epoch second 1767225600. */
const T0_EPOCH_MS: number = 1767225600000;
const T0_ISO: string = "2026-01-01T00:00:00.000Z";
const T0_SQL: string = "2026-01-01 00:00:00";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SqlResultShaper.rowsToTimeSeries", () => {
  const timeColumnNames: Array<string> = [
    "time",
    "TIME",
    "Timestamp",
    "date",
    "TS",
  ];

  test.each(timeColumnNames)(
    "detects the time column case-insensitively: %s",
    (columnName: string) => {
      const rows: Array<Record<string, unknown>> = [
        { [columnName]: T0_SQL, value: 1 },
      ];
      const result: AggregatedResult = SqlResultShaper.rowsToTimeSeries(rows, {
        maxRows: 10,
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.timestamp.getTime()).toBe(T0_EPOCH_MS);
      expect(result.data[0]!.value).toBe(1);
    },
  );

  test("uses the first matching time column in column order", () => {
    /*
     * Both 'timestamp' and 'ts' are recognized time names; 'timestamp'
     * comes first in key order so 'ts' is left over and, being numeric,
     * becomes the value column.
     */
    const rows: Array<Record<string, unknown>> = [
      { label: "a", timestamp: T0_SQL, ts: 5 },
    ];
    const result: AggregatedResult = SqlResultShaper.rowsToTimeSeries(rows, {
      maxRows: 10,
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.timestamp.getTime()).toBe(T0_EPOCH_MS);
    expect(result.data[0]!.value).toBe(5);
    expect(result.data[0]!["attributes"]).toEqual({ label: "a" });
  });

  test("prefers an explicit value column over an earlier numeric one", () => {
    const rows: Array<Record<string, unknown>> = [
      { time: T0_ISO, cpu: 99, value: 7 },
    ];
    const result: AggregatedResult = SqlResultShaper.rowsToTimeSeries(rows, {
      maxRows: 10,
    });
    expect(result.data[0]!.value).toBe(7);
    expect(result.data[0]!["attributes"]).toEqual({ cpu: "99" });
  });

  test("falls back to the first numeric column, counting numeric strings", () => {
    const rows: Array<Record<string, unknown>> = [
      { time: T0_ISO, host: "web-1", usage: "42.5" },
    ];
    const result: AggregatedResult = SqlResultShaper.rowsToTimeSeries(rows, {
      maxRows: 10,
    });
    expect(result.data[0]!.value).toBe(42.5);
    expect(result.data[0]!["attributes"]).toEqual({ host: "web-1" });
  });

  test("stringifies label columns and maps null labels to (unset)", () => {
    const rows: Array<Record<string, unknown>> = [
      { time: T0_ISO, value: 1, host: null, region: "us", shard: 3 },
    ];
    const result: AggregatedResult = SqlResultShaper.rowsToTimeSeries(rows, {
      maxRows: 10,
    });
    expect(result.data[0]!["attributes"]).toEqual({
      host: "(unset)",
      region: "us",
      shard: "3",
    });
  });

  test("omits the attributes key entirely when there are no label columns", () => {
    const rows: Array<Record<string, unknown>> = [{ time: T0_ISO, value: 1 }];
    const result: AggregatedResult = SqlResultShaper.rowsToTimeSeries(rows, {
      maxRows: 10,
    });
    expect(result.data[0]!["attributes"]).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(result.data[0]!, "attributes"),
    ).toBe(false);
  });

  test("skips unplottable rows instead of failing the chart", () => {
    const rows: Array<Record<string, unknown>> = [
      { time: T0_ISO, value: 10 },
      { time: "not a date", value: 2 },
      { time: T0_ISO, value: NaN },
      { time: T0_ISO, value: null },
      { time: T0_SQL, value: 20 },
    ];
    const result: AggregatedResult = SqlResultShaper.rowsToTimeSeries(rows, {
      maxRows: 10,
    });
    expect(result.data).toHaveLength(2);
    expect(result.data[0]!.value).toBe(10);
    expect(result.data[1]!.value).toBe(20);
    expect(result.truncated).toBe(false);
  });

  test("coerces bigint values to numbers", () => {
    const rows: Array<Record<string, unknown>> = [
      { time: T0_ISO, value: BigInt(12) },
    ];
    const result: AggregatedResult = SqlResultShaper.rowsToTimeSeries(rows, {
      maxRows: 10,
    });
    expect(result.data[0]!.value).toBe(12);
  });

  test("throws BadDataException listing columns when no time column exists", () => {
    const rows: Array<Record<string, unknown>> = [{ foo: 1, bar: 2 }];
    let thrown: unknown = null;
    try {
      SqlResultShaper.rowsToTimeSeries(rows, { maxRows: 10 });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as BadDataException).message).toContain("foo, bar");
    expect((thrown as BadDataException).message).toContain("time");
  });

  test("throws BadDataException when no numeric value column exists", () => {
    const rows: Array<Record<string, unknown>> = [
      { time: T0_ISO, name: "only-text" },
    ];
    let thrown: unknown = null;
    try {
      SqlResultShaper.rowsToTimeSeries(rows, { maxRows: 10 });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as BadDataException).message).toContain("numeric");
  });

  test("clamps at maxRows and reports truncated on cap+1 input", () => {
    const rows: Array<Record<string, unknown>> = [0, 1, 2, 3].map(
      (offset: number) => {
        return {
          time: new Date(T0_EPOCH_MS + offset * 60000),
          value: offset,
        };
      },
    );
    const result: AggregatedResult = SqlResultShaper.rowsToTimeSeries(rows, {
      maxRows: 3,
    });
    expect(result.data).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(result.data[2]!.value).toBe(2);
  });

  test("exactly maxRows rows is not truncated", () => {
    const rows: Array<Record<string, unknown>> = [0, 1, 2].map(
      (offset: number) => {
        return { time: T0_ISO, value: offset };
      },
    );
    const result: AggregatedResult = SqlResultShaper.rowsToTimeSeries(rows, {
      maxRows: 3,
    });
    expect(result.data).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  test("empty rows produce an empty, untruncated result", () => {
    const result: AggregatedResult = SqlResultShaper.rowsToTimeSeries([], {
      maxRows: 10,
    });
    expect(result).toEqual({ data: [], truncated: false });
  });

  test("plots ClickHouse JSON rows where time and value are both strings", () => {
    /*
     * ClickHouse's JSON format serializes 64-bit integers as strings, so
     * both cells arrive quoted — the row must still become a point
     * instead of being silently dropped.
     */
    const rows: Array<Record<string, unknown>> = [
      { time: "1700000000000", value: "5" },
    ];
    const result: AggregatedResult = SqlResultShaper.rowsToTimeSeries(rows, {
      maxRows: 10,
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.timestamp.getTime()).toBe(1700000000000);
    expect(result.data[0]!.value).toBe(5);
  });
});

describe("SqlResultShaper.coerceTimestamp", () => {
  test("passes a valid Date through as the same instance", () => {
    const date: Date = new Date(T0_EPOCH_MS);
    expect(SqlResultShaper.coerceTimestamp(date)).toBe(date);
  });

  test("returns null for an invalid Date", () => {
    expect(SqlResultShaper.coerceTimestamp(new Date("garbage"))).toBeNull();
  });

  test("parses ISO strings", () => {
    const parsed: Date | null = SqlResultShaper.coerceTimestamp(T0_ISO);
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBe(T0_EPOCH_MS);
  });

  test("treats 'YYYY-MM-DD HH:MM:SS' as UTC, not server-local time", () => {
    const parsed: Date | null = SqlResultShaper.coerceTimestamp(T0_SQL);
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBe(1767225600000);
  });

  test("keeps fractional seconds in the space-separated form", () => {
    const parsed: Date | null = SqlResultShaper.coerceTimestamp(
      "2026-01-01 00:00:00.500",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBe(1767225600500);
  });

  test("interprets numbers >= 1e9 and < 1e12 as epoch seconds", () => {
    const parsed: Date | null = SqlResultShaper.coerceTimestamp(1700000000);
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBe(1700000000000);
  });

  test("interprets numbers >= 1e12 as epoch milliseconds", () => {
    const parsed: Date | null = SqlResultShaper.coerceTimestamp(1700000000000);
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBe(1700000000000);
  });

  test("routes a 13-digit numeric string through the epoch-ms heuristic", () => {
    const parsed: Date | null =
      SqlResultShaper.coerceTimestamp("1700000000000");
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBe(1700000000000);
  });

  test("routes a 10-digit numeric string through the epoch-seconds heuristic", () => {
    const parsed: Date | null = SqlResultShaper.coerceTimestamp("1700000000");
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBe(1700000000 * 1000);
  });

  test("still Date-parses a short numeric string such as a bare year", () => {
    const parsed: Date | null = SqlResultShaper.coerceTimestamp("2023");
    expect(parsed).not.toBeNull();
    expect(parsed!.getUTCFullYear()).toBe(2023);
  });

  test("returns null for a numeric-looking string with trailing garbage", () => {
    expect(SqlResultShaper.coerceTimestamp("1700000000000x")).toBeNull();
  });

  test("returns null for zero, negative, and too-small numbers", () => {
    expect(SqlResultShaper.coerceTimestamp(0)).toBeNull();
    expect(SqlResultShaper.coerceTimestamp(-1700000000)).toBeNull();
    expect(SqlResultShaper.coerceTimestamp(12345)).toBeNull();
  });

  test("returns null for non-finite numbers", () => {
    expect(SqlResultShaper.coerceTimestamp(NaN)).toBeNull();
    expect(SqlResultShaper.coerceTimestamp(Infinity)).toBeNull();
  });

  test("returns null for garbage and blank strings", () => {
    expect(SqlResultShaper.coerceTimestamp("not a date")).toBeNull();
    expect(SqlResultShaper.coerceTimestamp("")).toBeNull();
    expect(SqlResultShaper.coerceTimestamp("   ")).toBeNull();
  });

  test("returns null for null, undefined, and objects", () => {
    expect(SqlResultShaper.coerceTimestamp(null)).toBeNull();
    expect(SqlResultShaper.coerceTimestamp(undefined)).toBeNull();
    expect(SqlResultShaper.coerceTimestamp({})).toBeNull();
  });

  test("accepts bigint epoch seconds and milliseconds", () => {
    const seconds: Date | null = SqlResultShaper.coerceTimestamp(
      BigInt(1700000000),
    );
    expect(seconds).not.toBeNull();
    expect(seconds!.getTime()).toBe(1700000000000);

    const milliseconds: Date | null = SqlResultShaper.coerceTimestamp(
      BigInt(1700000000000),
    );
    expect(milliseconds).not.toBeNull();
    expect(milliseconds!.getTime()).toBe(1700000000000);
  });
});

describe("SqlResultShaper.coerceCell", () => {
  test("passes JSON-safe primitives through", () => {
    expect(SqlResultShaper.coerceCell(3.14)).toBe(3.14);
    expect(SqlResultShaper.coerceCell(true)).toBe(true);
    expect(SqlResultShaper.coerceCell("text")).toBe("text");
    expect(SqlResultShaper.coerceCell(0)).toBe(0);
    expect(SqlResultShaper.coerceCell(false)).toBe(false);
    expect(SqlResultShaper.coerceCell("")).toBe("");
  });

  test("maps null and undefined to null", () => {
    expect(SqlResultShaper.coerceCell(null)).toBeNull();
    expect(SqlResultShaper.coerceCell(undefined)).toBeNull();
  });

  test("ISO-ifies Date values", () => {
    expect(SqlResultShaper.coerceCell(new Date(T0_EPOCH_MS))).toBe(T0_ISO);
  });

  test("never ships raw binary", () => {
    expect(SqlResultShaper.coerceCell(Buffer.from("secret-bytes"))).toBe(
      "[binary]",
    );
  });

  test("stringifies bigint", () => {
    expect(SqlResultShaper.coerceCell(BigInt(123))).toBe("123");
  });

  test("JSON-stringifies objects and arrays", () => {
    expect(SqlResultShaper.coerceCell({ a: 1 })).toBe('{"a":1}');
    expect(SqlResultShaper.coerceCell([1, 2])).toBe("[1,2]");
  });

  test("falls back to String() when JSON.stringify throws", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(SqlResultShaper.coerceCell(circular)).toBe("[object Object]");
  });
});

describe("SqlResultShaper.rowsToTable", () => {
  test("takes the column set as the union across all rows", () => {
    const rows: Array<Record<string, unknown>> = [
      { a: 1, b: "x" },
      { b: "y", c: true },
    ];
    const result: DataSourceTableResult = SqlResultShaper.rowsToTable(rows, {
      maxRows: 10,
    });
    expect(
      result.columns.map((column: { key: string }) => {
        return column.key;
      }),
    ).toEqual(["a", "b", "c"]);
    expect(result.rows[0]!).toEqual({ a: 1, b: "x", c: null });
    expect(result.rows[1]!).toEqual({ a: null, b: "y", c: true });
    expect(result.truncated).toBe(false);
  });

  test("titles default to the column key", () => {
    const result: DataSourceTableResult = SqlResultShaper.rowsToTable(
      [{ my_column: 1 }],
      { maxRows: 10 },
    );
    expect(result.columns[0]!.title).toBe("my_column");
    expect(result.columns[0]!.key).toBe("my_column");
  });

  test("sniffs column types from the first NON-NULL cell", () => {
    const rows: Array<Record<string, unknown>> = [
      { n: null, b: null, d: null, j: null, t: null, empty: null },
      {
        n: 5,
        b: false,
        d: new Date(T0_EPOCH_MS),
        j: { k: 1 },
        t: "words",
        empty: null,
      },
    ];
    const result: DataSourceTableResult = SqlResultShaper.rowsToTable(rows, {
      maxRows: 10,
    });
    const typesByKey: Record<string, DataSourceTableColumnType> = {};
    for (const column of result.columns) {
      typesByKey[column.key] = column.type;
    }
    expect(typesByKey["n"]).toBe(DataSourceTableColumnType.Number);
    expect(typesByKey["b"]).toBe(DataSourceTableColumnType.Boolean);
    expect(typesByKey["d"]).toBe(DataSourceTableColumnType.Date);
    expect(typesByKey["j"]).toBe(DataSourceTableColumnType.Json);
    expect(typesByKey["t"]).toBe(DataSourceTableColumnType.Text);
    /* An all-null column falls back to Text. */
    expect(typesByKey["empty"]).toBe(DataSourceTableColumnType.Text);
  });

  test("types bigint columns as Number", () => {
    const result: DataSourceTableResult = SqlResultShaper.rowsToTable(
      [{ big: BigInt(9) }],
      { maxRows: 10 },
    );
    expect(result.columns[0]!.type).toBe(DataSourceTableColumnType.Number);
    expect(result.rows[0]!["big"]).toBe("9");
  });

  test("coerces cells: dates to ISO, buffers to [binary], objects to JSON", () => {
    const rows: Array<Record<string, unknown>> = [
      { d: new Date(T0_EPOCH_MS), raw: Buffer.from("x"), j: { k: 1 } },
    ];
    const result: DataSourceTableResult = SqlResultShaper.rowsToTable(rows, {
      maxRows: 10,
    });
    expect(result.rows[0]!["d"]).toBe(T0_ISO);
    expect(result.rows[0]!["raw"]).toBe("[binary]");
    expect(result.rows[0]!["j"]).toBe('{"k":1}');
  });

  test("clamps at maxRows and reports truncated on cap+1 input", () => {
    const rows: Array<Record<string, unknown>> = [0, 1, 2].map(
      (offset: number) => {
        return { n: offset };
      },
    );
    const result: DataSourceTableResult = SqlResultShaper.rowsToTable(rows, {
      maxRows: 2,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.rows[1]!["n"]).toBe(1);
  });

  test("exactly maxRows rows is not truncated", () => {
    const rows: Array<Record<string, unknown>> = [{ n: 0 }, { n: 1 }];
    const result: DataSourceTableResult = SqlResultShaper.rowsToTable(rows, {
      maxRows: 2,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  test("empty input produces empty columns and rows, untruncated", () => {
    const result: DataSourceTableResult = SqlResultShaper.rowsToTable([], {
      maxRows: 10,
    });
    expect(result).toEqual({ columns: [], rows: [], truncated: false });
  });
});

describe("SqlResultShaper.sanitizeError", () => {
  test("redacts every occurrence of secrets that are 4+ characters", () => {
    const message: string = SqlResultShaper.sanitizeError(
      new Error("auth failed for hunter2 (retried with hunter2)"),
      ["hunter2"],
    );
    expect(message).not.toContain("hunter2");
    expect(message).toContain("***");
  });

  test("redacts multiple secrets, such as host and user", () => {
    const message: string = SqlResultShaper.sanitizeError(
      new Error("admin1 could not reach db.internal.example"),
      ["db.internal.example", "admin1"],
    );
    expect(message).not.toContain("db.internal.example");
    expect(message).not.toContain("admin1");
  });

  test("does NOT redact secrets shorter than 4 characters", () => {
    const message: string = SqlResultShaper.sanitizeError(
      new Error("abc failed"),
      ["abc"],
    );
    expect(message).toBe("abc failed");
  });

  test("tolerates undefined entries in the secret list", () => {
    const message: string = SqlResultShaper.sanitizeError(
      new Error("bad password hunter2"),
      [undefined, "hunter2", undefined],
    );
    expect(message).not.toContain("hunter2");
  });

  test("redacts DSNs with embedded credentials", () => {
    const message: string = SqlResultShaper.sanitizeError(
      new Error(
        "could not connect to postgres://user:pw@db.example.com:5432/prod now",
      ),
      [],
    );
    expect(message).toBe("could not connect to [redacted-dsn] now");
    expect(message).not.toContain("user:pw");
    expect(message).not.toContain("db.example.com");
  });

  test("redacts password=... connection-string pairs", () => {
    const message: string = SqlResultShaper.sanitizeError(
      new Error("Login failed; password=hunter2; host=db"),
      [],
    );
    expect(message).toBe("Login failed; password=***; host=db");
  });

  test("redacts pwd: '...' pairs regardless of separator and quoting", () => {
    const message: string = SqlResultShaper.sanitizeError(
      new Error("pwd: 'secr3t!' rejected"),
      [],
    );
    expect(message).toContain("pwd=***");
    expect(message).not.toContain("secr3t");
  });

  test("redacts brace-quoted Password={...} pairs", () => {
    const message: string = SqlResultShaper.sanitizeError(
      new Error("Password={ab;cd};Server=x refused"),
      [],
    );
    expect(message).toContain("Password=***");
    expect(message).not.toContain("ab;cd");
  });

  test("stringifies non-Error inputs", () => {
    expect(SqlResultShaper.sanitizeError("plain failure", [])).toBe(
      "plain failure",
    );
    expect(SqlResultShaper.sanitizeError(42, [])).toBe("42");
  });

  test("redacts secrets in non-Error inputs too", () => {
    const message: string = SqlResultShaper.sanitizeError(
      "string failure with hunter2 inside",
      ["hunter2"],
    );
    expect(message).not.toContain("hunter2");
  });
});
