import OneUptimeDate from "../../Types/Date";
import moment from "moment-timezone";
import { afterAll, describe, expect, test } from "@jest/globals";

/*
 * Run the whole suite in a non-UTC, DST-observing zone. Under TZ=UTC the
 * local and UTC Date getters agree, so a getUTC* -> get* regression in the
 * hand-rolled formatter would be invisible to every parity assertion below.
 * America/New_York makes any local-getter mutation diverge from the
 * moment-UTC oracle deterministically (including across DST transitions in
 * the fuzz sweep). Node re-reads process.env.TZ on Date operations; the
 * original value is restored afterAll so co-resident suites in the same
 * worker keep the process default.
 */
const ORIGINAL_TZ: string | undefined = process.env["TZ"];
process.env["TZ"] = "America/New_York";

afterAll(() => {
  if (ORIGINAL_TZ === undefined) {
    delete process.env["TZ"];
  } else {
    process.env["TZ"] = ORIGINAL_TZ;
  }
});

/*
 * Contract under test — the ClickHouse DateTime formatters that stamp every
 * ingested telemetry row (createdAt, time, retentionDate, startTime/endTime).
 *
 * These used to be moment(...).utc().format("YYYY-MM-DD HH:mm:ss"), which
 * allocates a moment wrapper and parses a format-token string PER CALL — and
 * they are called several times per log record / span / metric datapoint.
 * They are now a hand-rolled UTC formatter. The replacement must be
 * byte-identical to what moment produced, because these strings are written
 * straight into ClickHouse DateTime columns and compared/parsed downstream.
 *
 * The parity tests below therefore compare the new implementation against a
 * live moment call, not against hardcoded strings, across edge cases and a
 * deterministic fuzz sweep.
 */

function momentReference(date: Date): string {
  return moment(date).utc().format("YYYY-MM-DD HH:mm:ss");
}

describe("OneUptimeDate.toClickhouseDateTime", () => {
  const edgeCases: Array<{ name: string; date: Date }> = [
    { name: "unix epoch", date: new Date(0) },
    { name: "one ms before epoch", date: new Date(-1) },
    { name: "one second before epoch", date: new Date(-1000) },
    {
      name: "pre-1970 date",
      date: new Date(Date.UTC(1955, 10, 5, 6, 15, 30, 123)),
    },
    {
      name: "leap day",
      date: new Date(Date.UTC(2024, 1, 29, 23, 59, 59, 999)),
    },
    {
      name: "year rollover instant",
      date: new Date(Date.UTC(2025, 11, 31, 23, 59, 59, 999)),
    },
    {
      name: "first instant of a year",
      date: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0)),
    },
    {
      name: "single-digit month/day/hour/minute/second",
      date: new Date(Date.UTC(2026, 2, 4, 5, 6, 7, 8)),
    },
    {
      name: "three-digit year pads to 4 digits",
      date: new Date(Date.UTC(999, 0, 2, 3, 4, 5)),
    },
    {
      name: "far future",
      date: new Date(Date.UTC(2999, 11, 31, 12, 0, 0)),
    },
  ];

  for (const { name, date } of edgeCases) {
    test(`matches the moment implementation it replaced: ${name}`, () => {
      expect(OneUptimeDate.toClickhouseDateTime(date)).toBe(
        momentReference(date),
      );
    });
  }

  test("fuzz sweep: parity with moment across ±100 years", () => {
    /*
     * Deterministic LCG so a failure is reproducible. 2000 samples spread
     * across ~200 years of epoch millis, including sub-second components.
     */
    let seed: number = 42;
    const nextRandom: () => number = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    const hundredYearsMs: number = 100 * 365.25 * 24 * 3600 * 1000;

    for (let i: number = 0; i < 2000; i++) {
      const ms: number = Math.floor((nextRandom() * 2 - 1) * hundredYearsMs);
      const date: Date = new Date(ms);
      expect(OneUptimeDate.toClickhouseDateTime(date)).toBe(
        momentReference(date),
      );
    }
  });

  test("accepts ISO string input like the moment version did", () => {
    const iso: string = "2026-08-10T13:45:59.500Z";
    expect(OneUptimeDate.toClickhouseDateTime(iso)).toBe(
      momentReference(new Date(iso)),
    );
  });

  test("keeps moment's 'Invalid date' sentinel for NaN dates", () => {
    const invalid: Date = new Date(NaN);
    expect(OneUptimeDate.toClickhouseDateTime(invalid)).toBe(
      momentReference(invalid),
    );
    expect(OneUptimeDate.toClickhouseDateTime(invalid)).toBe("Invalid date");
  });

  test("output is always UTC regardless of process timezone", () => {
    // 2026-06-15T00:30:00Z is a different calendar day in UTC-negative zones.
    const date: Date = new Date(Date.UTC(2026, 5, 15, 0, 30, 0));
    expect(OneUptimeDate.toClickhouseDateTime(date)).toBe(
      "2026-06-15 00:30:00",
    );
  });
});

describe("OneUptimeDate.toClickhouseDateTime64", () => {
  /*
   * Nano timestamps arrive as JS numbers, so a modern epoch date times 1e6
   * exceeds Number.MAX_SAFE_INTEGER and the sub-second digits are already
   * imprecise before this function sees them (pre-existing caller
   * behavior). Exercise the extraction arithmetic with early-epoch dates
   * whose nano values are exactly representable.
   */
  test("extracts sub-second nanos from the unix-nano timestamp", () => {
    const date: Date = new Date(Date.UTC(1970, 0, 20, 12, 0, 5, 0));
    // 123456789 sub-second nanoseconds — exactly representable here.
    const nano: number = date.getTime() * 1_000_000 + 123_456_789;
    expect(OneUptimeDate.toClickhouseDateTime64(date, nano)).toBe(
      "1970-01-20 12:00:05.123456789",
    );
  });

  test("pads short sub-second nano fractions to 9 digits", () => {
    const date: Date = new Date(Date.UTC(1970, 0, 20, 12, 0, 5, 0));
    const nano: number = date.getTime() * 1_000_000 + 7;
    expect(OneUptimeDate.toClickhouseDateTime64(date, nano)).toBe(
      "1970-01-20 12:00:05.000000007",
    );
  });

  test("falls back to Date milliseconds when nano timestamp is absent", () => {
    const date: Date = new Date(Date.UTC(2026, 7, 10, 12, 0, 5, 123));
    expect(OneUptimeDate.toClickhouseDateTime64(date)).toBe(
      "2026-08-10 12:00:05.123000000",
    );
  });

  test("falls back to Date milliseconds when nano timestamp is zero", () => {
    // The implementation treats only nanoTimestamp > 0 as authoritative.
    const date: Date = new Date(Date.UTC(2026, 7, 10, 12, 0, 5, 42));
    expect(OneUptimeDate.toClickhouseDateTime64(date, 0)).toBe(
      "2026-08-10 12:00:05.042000000",
    );
  });

  test("base portion matches the moment implementation it replaced", () => {
    const date: Date = new Date(Date.UTC(1999, 11, 31, 23, 59, 59, 999));
    const formatted: string = OneUptimeDate.toClickhouseDateTime64(date);
    expect(formatted.slice(0, 19)).toBe(momentReference(date));
  });
});

describe("OneUptimeDate.getCurrentDate", () => {
  test("returns the current wall-clock time as a plain Date", () => {
    const before: number = Date.now();
    const current: Date = OneUptimeDate.getCurrentDate();
    const after: number = Date.now();

    expect(current).toBeInstanceOf(Date);
    expect(current.getTime()).toBeGreaterThanOrEqual(before);
    expect(current.getTime()).toBeLessThanOrEqual(after);
  });
});
