import {
  MAX_PROFILE_FUTURE_SKEW_NANO,
  MIN_PROFILE_UNIX_NANO,
  ProfileWindow,
  isPlausibleProfileUnixNano,
  parsePyroscopeTimeParam,
  resolveProfileWindow,
  toNonNegativeUnixNano,
} from "../../FeatureSet/Telemetry/Utils/PyroscopeTime";
import { describe, expect, test } from "@jest/globals";

/*
 * Pyroscope clients disagree on the unit of /ingest's from/until params
 * (seconds, milliseconds, nanoseconds). OneUptime read every value as
 * seconds, so pyroscope-dotnet's 13-digit millisecond `from` became a
 * year-58000 capture time written as "1.7e+21" - a value ClickHouse
 * rejects at async-insert flush, silently, after the SDK has been told 200.
 * That is GH#4037: .NET profiles never appeared and nothing said why.
 *
 * These pin the unit rules to the reference server's attime.Parse and the
 * window rules the converter depends on.
 */

// 2026-09-26T00:00:00Z, a 15s-aligned window start like the .NET SDK sends.
const WINDOW_START_SECONDS: bigint = BigInt(1_790_380_800);
const NANOS_PER_SECOND: bigint = BigInt(1_000_000_000);
const WINDOW_START_NANO: bigint = WINDOW_START_SECONDS * NANOS_PER_SECOND;

// "Now" for these tests: one minute after the window.
const NOW_NANO: bigint = WINDOW_START_NANO + BigInt(60) * NANOS_PER_SECOND;

/*
 * Assert on strings, not BigInts: jest workers cannot serialize a BigInt,
 * so a failing BigInt assertion would surface only as "Do not know how to
 * serialize a BigInt", with no test name, expected or received value.
 */
function nano(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

function windowOf(window: ProfileWindow): { start: string; end: string } {
  return {
    start: window.startUnixNano.toString(),
    end: window.endUnixNano.toString(),
  };
}

describe("parsePyroscopeTimeParam reads the unit off the digit count", () => {
  test.each([
    ["seconds (Java, Node)", "1790380800", WINDOW_START_NANO],
    ["milliseconds (.NET <= 0.13)", "1790380800000", WINDOW_START_NANO],
    ["microseconds", "1790380800000000", WINDOW_START_NANO],
    ["nanoseconds (Go >= 1.1)", "1790380800000000000", WINDOW_START_NANO],
  ])("%s", (_label: string, raw: string, expected: bigint) => {
    expect(nano(parsePyroscopeTimeParam(raw, NOW_NANO))).toBe(nano(expected));
  });

  test("keeps sub-second precision exactly for millisecond values", () => {
    expect(nano(parsePyroscopeTimeParam("1790380815123", NOW_NANO))).toBe(
      "1790380815123000000",
    );
  });

  test("keeps nanosecond values exact, beyond Number precision", () => {
    // 2^53 is ~9e15, so a Number could not represent this digit for digit.
    const raw: string = "1790380800123456789";

    expect(nano(parsePyroscopeTimeParam(raw, NOW_NANO))).toBe(raw);
  });

  test("strips the separators attime.Parse strips", () => {
    for (const raw of ["1_790_380_800", "1,790,380,800", " 1790380800000 "]) {
      expect(nano(parsePyroscopeTimeParam(raw, NOW_NANO))).toBe(
        nano(WINDOW_START_NANO),
      );
    }
  });

  test("accepts a number as well as a string", () => {
    expect(nano(parsePyroscopeTimeParam(1790380800, NOW_NANO))).toBe(
      nano(WINDOW_START_NANO),
    );
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["empty", ""],
    ["whitespace", "   "],
    ["zero", "0"],
    ["relative form", "now-10s"],
    ["negative", "-1790380800"],
    ["decimal", "1790380800.5"],
    ["exponent", "1.7903808e+21"],
    ["array (repeated query param)", ["1790380800", "1790380815"]],
    ["object", { from: "1790380800" }],
  ])("treats %s as not provided", (_label: string, raw: unknown) => {
    expect(nano(parsePyroscopeTimeParam(raw, NOW_NANO))).toBeNull();
  });

  test("treats a value before 2000 as not provided", () => {
    // 8-digit seconds: 1973. A unit mix-up, not a real capture time.
    expect(nano(parsePyroscopeTimeParam("99999999", NOW_NANO))).toBeNull();
  });

  test("treats a value more than a day in the future as not provided", () => {
    const twoDaysAheadSeconds: bigint =
      (NOW_NANO + BigInt(2 * 24 * 60 * 60) * NANOS_PER_SECOND) /
      NANOS_PER_SECOND;

    expect(
      nano(parsePyroscopeTimeParam(twoDaysAheadSeconds.toString(), NOW_NANO)),
    ).toBeNull();
  });

  test("tolerates clock skew of under a day", () => {
    const anHourAheadSeconds: bigint =
      (NOW_NANO + BigInt(60 * 60) * NANOS_PER_SECOND) / NANOS_PER_SECOND;

    expect(
      nano(parsePyroscopeTimeParam(anHourAheadSeconds.toString(), NOW_NANO)),
    ).toBe(nano(anHourAheadSeconds * NANOS_PER_SECOND));
  });

  test("never produces a value outside the plausible window, however many digits", () => {
    for (let digits: number = 1; digits <= 40; digits++) {
      const parsed: bigint | null = parsePyroscopeTimeParam(
        "1".padEnd(digits, "7"),
        NOW_NANO,
      );

      if (parsed !== null) {
        expect(isPlausibleProfileUnixNano(parsed, NOW_NANO)).toBe(true);
      }
    }
  });
});

describe("isPlausibleProfileUnixNano", () => {
  test("bounds are 2000-01-01 and one day past now, inclusive", () => {
    expect(isPlausibleProfileUnixNano(MIN_PROFILE_UNIX_NANO, NOW_NANO)).toBe(
      true,
    );
    expect(
      isPlausibleProfileUnixNano(MIN_PROFILE_UNIX_NANO - BigInt(1), NOW_NANO),
    ).toBe(false);
    expect(
      isPlausibleProfileUnixNano(
        NOW_NANO + MAX_PROFILE_FUTURE_SKEW_NANO,
        NOW_NANO,
      ),
    ).toBe(true);
    expect(
      isPlausibleProfileUnixNano(
        NOW_NANO + MAX_PROFILE_FUTURE_SKEW_NANO + BigInt(1),
        NOW_NANO,
      ),
    ).toBe(false);
  });

  test("the lower bound really is 2000-01-01T00:00:00Z", () => {
    expect(
      new Date(Number(MIN_PROFILE_UNIX_NANO / BigInt(1_000_000))).toISOString(),
    ).toBe("2000-01-01T00:00:00.000Z");
  });
});

describe("toNonNegativeUnixNano reads decoded pprof int64 fields", () => {
  test.each([
    ["positive number", 15_000_000_000, BigInt(15_000_000_000)],
    ["fractional number", 1.9, BigInt(1)],
    ["integer string", "1790380800123456789", BigInt("1790380800123456789")],
    ["bigint", BigInt(42), BigInt(42)],
    ["exponent string", "1.5e10", BigInt(15_000_000_000)],
  ])("%s", (_label: string, raw: unknown, expected: bigint) => {
    expect(nano(toNonNegativeUnixNano(raw))).toBe(nano(expected));
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["zero", 0],
    ["zero string", "0"],
    ["negative", -5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["garbage string", "soon"],
  ])("%s is absent", (_label: string, raw: unknown) => {
    expect(nano(toNonNegativeUnixNano(raw))).toBeNull();
  });
});

describe("resolveProfileWindow", () => {
  const FIFTEEN_SECONDS: bigint = BigInt(15) * NANOS_PER_SECOND;

  test(".NET <= 0.13: no pprof time, window from from/until", () => {
    const window: ProfileWindow = resolveProfileWindow({
      pprofTimeNanos: 0,
      pprofDurationNanos: 0,
      fromUnixNano: WINDOW_START_NANO,
      untilUnixNano: WINDOW_START_NANO + FIFTEEN_SECONDS,
      nowUnixNano: NOW_NANO,
    });

    expect(windowOf(window)).toEqual({
      start: nano(WINDOW_START_NANO),
      end: nano(WINDOW_START_NANO + FIFTEEN_SECONDS),
    });
  });

  test("a pprof with time and duration wins over the query params", () => {
    const pprofStart: bigint = WINDOW_START_NANO + BigInt(5) * NANOS_PER_SECOND;

    const window: ProfileWindow = resolveProfileWindow({
      pprofTimeNanos: Number(pprofStart),
      pprofDurationNanos: 10_000_000_000,
      fromUnixNano: WINDOW_START_NANO,
      untilUnixNano: WINDOW_START_NANO + FIFTEEN_SECONDS,
      nowUnixNano: NOW_NANO,
    });

    expect(nano(window.startUnixNano)).toBe(nano(pprofStart));
    expect(nano(window.endUnixNano)).toBe(
      nano(pprofStart + BigInt(10_000_000_000)),
    );
  });

  test("Go non-CPU profiles: pprof time but no duration end at `until`", () => {
    const window: ProfileWindow = resolveProfileWindow({
      pprofTimeNanos: Number(WINDOW_START_NANO),
      pprofDurationNanos: 0,
      fromUnixNano: WINDOW_START_NANO,
      untilUnixNano: WINDOW_START_NANO + FIFTEEN_SECONDS,
      nowUnixNano: NOW_NANO,
    });

    expect(nano(window.endUnixNano)).toBe(
      nano(WINDOW_START_NANO + FIFTEEN_SECONDS),
    );
  });

  test("a 1970 pprof time (microseconds in time_nanos) falls back to `from`", () => {
    const window: ProfileWindow = resolveProfileWindow({
      // 1790380800 s written as microseconds: 1970-01-21 when read as ns.
      pprofTimeNanos: 1_790_380_800_000_000,
      pprofDurationNanos: 0,
      fromUnixNano: WINDOW_START_NANO,
      untilUnixNano: WINDOW_START_NANO + FIFTEEN_SECONDS,
      nowUnixNano: NOW_NANO,
    });

    expect(nano(window.startUnixNano)).toBe(nano(WINDOW_START_NANO));
    expect(nano(window.endUnixNano)).toBe(
      nano(WINDOW_START_NANO + FIFTEEN_SECONDS),
    );
  });

  test("with no usable time anywhere, the profile is stamped with ingestion time", () => {
    const window: ProfileWindow = resolveProfileWindow({
      pprofTimeNanos: undefined,
      pprofDurationNanos: undefined,
      fromUnixNano: null,
      untilUnixNano: null,
      nowUnixNano: NOW_NANO,
    });

    expect(windowOf(window)).toEqual({
      start: nano(NOW_NANO),
      end: nano(NOW_NANO),
    });
  });

  test("an `until` before the start is ignored rather than producing a negative window", () => {
    const window: ProfileWindow = resolveProfileWindow({
      pprofTimeNanos: 0,
      pprofDurationNanos: 0,
      fromUnixNano: WINDOW_START_NANO,
      untilUnixNano: WINDOW_START_NANO - FIFTEEN_SECONDS,
      nowUnixNano: NOW_NANO,
    });

    expect(nano(window.endUnixNano)).toBe(nano(WINDOW_START_NANO));
  });

  test("renders as plain integer strings, never exponent notation", () => {
    const window: ProfileWindow = resolveProfileWindow({
      pprofTimeNanos: 0,
      pprofDurationNanos: 0,
      fromUnixNano: parsePyroscopeTimeParam("1790380800000", NOW_NANO),
      untilUnixNano: parsePyroscopeTimeParam("1790380815000", NOW_NANO),
      nowUnixNano: NOW_NANO,
    });

    expect(window.startUnixNano.toString()).toBe("1790380800000000000");
    expect(window.endUnixNano.toString()).toBe("1790380815000000000");
  });
});
