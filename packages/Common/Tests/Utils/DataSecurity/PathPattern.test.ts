import { describe, expect, test } from "@jest/globals";
import {
  getObjectExtension,
  isGzipName,
  toPathPattern,
} from "../../../Utils/DataSecurity/PathPattern";

/*
 * THE SHAPE OF AN OBJECT'S NAME.
 *
 * Dates, UUIDs, long hex runs, numbers and partition values become "*", so
 * every day's export of the same kind is one pattern, and the rest of the
 * name - the words that say what it is - stays.
 */

describe("toPathPattern", () => {
  test.each([
    ["exports/2026-10-27/users-0001.csv", "exports/*/users-*.csv"],
    ["exports/2026-10-28/users-0002.csv", "exports/*/users-*.csv"],
    ["logs/20261027T101502Z.json.gz", "logs/*.json.gz"],
    ["logs/2026-10-27_10-15-02/app.log", "logs/*/app.log"],
    ["backup-2026-10-27T10:15:02.123Z.sql", "backup-*.sql"],
    [
      "uploads/123e4567-e89b-12d3-a456-426614174000/avatar.png",
      "uploads/*/avatar.png",
    ],
    ["blobs/3f9a07c1e5b28d64aa/data.bin", "blobs/*/data.bin"],
    ["dt=2026-10-27/hour=10/part-00000.parquet", "dt=*/hour=*/part-*.parquet"],
    ["year=2026/month=10/file.csv", "year=*/month=*/file.csv"],
    ["invoices/42/INV-1001-2002.pdf", "invoices/*/INV-*-*.pdf"],
  ])("reads %j as %j", (name: string, pattern: string) => {
    expect(toPathPattern(name)).toBe(pattern);
  });

  test("leaves the words of a name, and single digits, as they are", () => {
    expect(toPathPattern("report.pdf")).toBe("report.pdf");
    expect(toPathPattern("v2/api/items")).toBe("v2/api/items");
    expect(toPathPattern("a/b/c")).toBe("a/b/c");
  });

  test("gives every name of one kind the same pattern", () => {
    const patterns: Set<string> = new Set();

    for (let day: number = 1; day <= 28; day++) {
      const date: string = `2026-02-${String(day).padStart(2, "0")}`;

      patterns.add(toPathPattern(`exports/${date}/orders-${day * 37}.csv`));
    }

    expect([...patterns]).toEqual(["exports/*/orders-*.csv"]);
  });

  test("reads a sequence number after a date as a number, not as the date's time", () => {
    expect(toPathPattern("exports/2026-10-27-00042/part.csv")).toBe(
      "exports/*-*/part.csv",
    );
    expect(toPathPattern("exports/2026-10-27-00043/part.csv")).toBe(
      "exports/*-*/part.csv",
    );
    expect(toPathPattern("x/12026-10-27/y")).toBe("x/*-*-*/y");
  });

  test("folds the stars of neighbouring parts into one", () => {
    expect(
      toPathPattern("uploads/123e4567-e89b-12d3-a456-426614174000deadbeef/x"),
    ).toBe("uploads/*/x");
  });

  test("reads at most 1,024 characters of a name", () => {
    expect(toPathPattern("a".repeat(5_000))).toHaveLength(1_024);
  });
});

describe("getObjectExtension", () => {
  test("is the lower-cased extension without a compression suffix", () => {
    expect(getObjectExtension("a/b/report.CSV")).toBe("csv");
    expect(getObjectExtension("a/b/report.csv.gz")).toBe("csv");
    expect(getObjectExtension("file.JSON.GZ")).toBe("json");
    expect(getObjectExtension("x.tar.gz")).toBe("tar");
  });

  test("is empty for a name with none, a dotfile and a dot in a folder's name", () => {
    expect(getObjectExtension("a/b/noext")).toBe("");
    expect(getObjectExtension("a/b/report.gz")).toBe("");
    expect(getObjectExtension("a/b/.env")).toBe("");
    expect(getObjectExtension("a.b/c")).toBe("");
    expect(getObjectExtension("dir.d/")).toBe("");
  });
});

describe("isGzipName", () => {
  test("is true for a .gz name in any case", () => {
    expect(isGzipName("a/b/report.csv.gz")).toBe(true);
    expect(isGzipName("FILE.GZ")).toBe(true);
    expect(isGzipName("a/b/report.csv")).toBe(false);
    expect(isGzipName("a/b/gz")).toBe(false);
  });
});
