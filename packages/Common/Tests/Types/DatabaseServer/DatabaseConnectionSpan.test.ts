/*
 * Which database CLIENT spans are connection management rather than queries
 * (DatabaseConnectionSpan).
 */

import {
  DATABASE_CONNECTION_SPAN_NAMES,
  isDatabaseConnectionSpanName,
} from "../../../Types/DatabaseServer/DatabaseConnectionSpan";
import { describe, expect, test } from "@jest/globals";

describe("DATABASE_CONNECTION_SPAN_NAMES", () => {
  test("is not empty and holds no duplicates, case aside", () => {
    expect(DATABASE_CONNECTION_SPAN_NAMES.length).toBeGreaterThan(0);

    const lowered: Array<string> = DATABASE_CONNECTION_SPAN_NAMES.map(
      (name: string): string => {
        return name.toLowerCase();
      },
    );

    expect(new Set(lowered).size).toBe(lowered.length);
  });

  test("names carry no surrounding whitespace", () => {
    for (const name of DATABASE_CONNECTION_SPAN_NAMES) {
      expect(name).toBe(name.trim());
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test("covers the pooled node-postgres connects", () => {
    expect(DATABASE_CONNECTION_SPAN_NAMES).toEqual(
      expect.arrayContaining(["pg.connect", "pg-pool.connect"]),
    );
  });
});

describe("isDatabaseConnectionSpanName", () => {
  test("every listed name is a connection span", () => {
    for (const name of DATABASE_CONNECTION_SPAN_NAMES) {
      expect(isDatabaseConnectionSpanName(name)).toBe(true);
    }
  });

  test("matches regardless of case", () => {
    expect(isDatabaseConnectionSpanName("PG.CONNECT")).toBe(true);
    expect(isDatabaseConnectionSpanName("Connect")).toBe(true);
    expect(isDatabaseConnectionSpanName("pdo::__CONSTRUCT")).toBe(true);
    expect(isDatabaseConnectionSpanName("ORACLEDB.getconnection")).toBe(true);
  });

  test("ignores surrounding whitespace", () => {
    expect(isDatabaseConnectionSpanName("  redis-connect  ")).toBe(true);
    expect(isDatabaseConnectionSpanName("\tredis.dial\n")).toBe(true);
  });

  test("query spans are never connection spans", () => {
    for (const name of [
      "SELECT orders",
      "pg.query:SELECT orders",
      "get",
      "redis-GET",
      "find orders",
      "INSERT",
      "sql.conn.query",
    ]) {
      expect(isDatabaseConnectionSpanName(name)).toBe(false);
    }
  });

  test("matches whole names only, not prefixes or substrings", () => {
    expect(isDatabaseConnectionSpanName("connect orders")).toBe(false);
    expect(isDatabaseConnectionSpanName("pg.connected")).toBe(false);
    expect(isDatabaseConnectionSpanName("my-pg.connect")).toBe(false);
    expect(isDatabaseConnectionSpanName("pg . connect")).toBe(false);
  });

  test("a missing or empty name is never a connection span", () => {
    expect(isDatabaseConnectionSpanName(undefined)).toBe(false);
    expect(isDatabaseConnectionSpanName(null)).toBe(false);
    expect(isDatabaseConnectionSpanName("")).toBe(false);
    expect(isDatabaseConnectionSpanName("   ")).toBe(false);
  });

  test("a non-string value is never a connection span", () => {
    expect(isDatabaseConnectionSpanName(42 as unknown as string)).toBe(false);
    expect(
      isDatabaseConnectionSpanName({ name: "connect" } as unknown as string),
    ).toBe(false);
  });
});
