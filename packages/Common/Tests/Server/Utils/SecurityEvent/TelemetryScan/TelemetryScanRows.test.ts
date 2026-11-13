import { describe, expect, test } from "@jest/globals";
import {
  readRowBoolean,
  readRowDate,
  readRowMap,
  readRowNumber,
  readRowNumberArray,
  readRowText,
  readRowTextArray,
} from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanRows";

/*
 * ClickHouse's JSON answers a 64-bit integer as a quoted string, a missing
 * value as null, a tuple as an array and a map as an object. The security
 * telemetry scans read every row through these, so a value they cannot
 * read must become the empty value of its type rather than throw.
 */

describe("readRowText", () => {
  test("reads text as it is", () => {
    expect(readRowText("GET /login")).toBe("GET /login");
    expect(readRowText("")).toBe("");
  });

  test("is empty for a missing value", () => {
    expect(readRowText(null)).toBe("");
    expect(readRowText(undefined)).toBe("");
  });

  test("writes other values out as text", () => {
    expect(readRowText(42)).toBe("42");
    expect(readRowText(false)).toBe("false");
  });
});

describe("readRowNumber", () => {
  test("reads a number as it is", () => {
    expect(readRowNumber(42)).toBe(42);
    expect(readRowNumber(-1.5)).toBe(-1.5);
  });

  test("reads a 64-bit integer ClickHouse sent quoted", () => {
    expect(readRowNumber("1234567890")).toBe(1234567890);
  });

  test("is 0 for what is not a number", () => {
    expect(readRowNumber("not a number")).toBe(0);
    expect(readRowNumber(undefined)).toBe(0);
    expect(readRowNumber({ count: 1 })).toBe(0);
  });

  test("is 0 for a number that is not finite", () => {
    expect(readRowNumber(Infinity)).toBe(0);
    expect(readRowNumber(NaN)).toBe(0);
    expect(readRowNumber("Infinity")).toBe(0);
  });

  test("is 0 for a missing value", () => {
    expect(readRowNumber(null)).toBe(0);
  });
});

describe("readRowBoolean", () => {
  test("is true for each way ClickHouse writes true", () => {
    expect(readRowBoolean(true)).toBe(true);
    expect(readRowBoolean(1)).toBe(true);
    expect(readRowBoolean("1")).toBe(true);
    expect(readRowBoolean("true")).toBe(true);
  });

  test("is false for anything else", () => {
    for (const value of [
      false,
      0,
      "0",
      "false",
      "TRUE",
      "yes",
      2,
      null,
      undefined,
    ]) {
      expect(readRowBoolean(value)).toBe(false);
    }
  });
});

describe("readRowDate", () => {
  test("reads a ClickHouse date-time as UTC", () => {
    expect(readRowDate("2026-10-01 10:15:30")?.toISOString()).toBe(
      "2026-10-01T10:15:30.000Z",
    );
  });

  test("reads an ISO-8601 time", () => {
    expect(readRowDate("2026-10-01T10:15:30.000Z")?.toISOString()).toBe(
      "2026-10-01T10:15:30.000Z",
    );
  });

  test("is none for a missing or unreadable time", () => {
    expect(readRowDate(null)).toBeNull();
    expect(readRowDate(undefined)).toBeNull();
    expect(readRowDate("")).toBeNull();
    expect(readRowDate("not a time")).toBeNull();
  });
});

describe("readRowTextArray", () => {
  test("reads each item as text", () => {
    expect(readRowTextArray(["10.0.0.1", 443, true])).toEqual([
      "10.0.0.1",
      "443",
      "true",
    ]);
  });

  test("drops empty and missing items", () => {
    expect(readRowTextArray(["a", "", null, "b"])).toEqual(["a", "b"]);
  });

  test("is empty for what is not an array", () => {
    expect(readRowTextArray("a,b")).toEqual([]);
    expect(readRowTextArray(null)).toEqual([]);
    expect(readRowTextArray(undefined)).toEqual([]);
    expect(readRowTextArray({ 0: "a" })).toEqual([]);
  });
});

describe("readRowNumberArray", () => {
  test("reads each item as a number, quoted or not", () => {
    expect(readRowNumberArray([1, "2", 3.5])).toEqual([1, 2, 3.5]);
  });

  test("keeps only positive numbers", () => {
    expect(readRowNumberArray([0, -1, 5, "x", null, "7"])).toEqual([5, 7]);
  });

  test("is empty for what is not an array", () => {
    expect(readRowNumberArray(5)).toEqual([]);
    expect(readRowNumberArray(null)).toEqual([]);
    expect(readRowNumberArray(undefined)).toEqual([]);
  });
});

describe("readRowMap", () => {
  test("reads a map's entries as text", () => {
    expect(
      readRowMap({ "http.method": "GET", "http.status_code": 200, ok: true }),
    ).toEqual({
      "http.method": "GET",
      "http.status_code": "200",
      ok: "true",
    });
  });

  test("drops missing entries", () => {
    expect(readRowMap({ a: "1", b: null })).toEqual({ a: "1" });
  });

  test("keeps empty text", () => {
    expect(readRowMap({ a: "" })).toEqual({ a: "" });
  });

  test("is empty for what is not a map", () => {
    expect(readRowMap(null)).toEqual({});
    expect(readRowMap(undefined)).toEqual({});
    expect(readRowMap("a=1")).toEqual({});
    expect(readRowMap([["a", "1"]])).toEqual({});
  });
});
