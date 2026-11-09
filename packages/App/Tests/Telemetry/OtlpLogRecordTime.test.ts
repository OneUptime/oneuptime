import OtlpLogRecordTimeUtil, {
  MAX_OBSERVED_COLUMN_DIGITS,
  MAX_OBSERVED_COLUMN_FLOAT,
  MAX_STORABLE_LOG_UNIX_NANO,
  MAX_STORABLE_LOG_UNIX_NANO_DIGITS,
  OtlpLogRecordTime,
  OtlpLogTimeSource,
  OtlpTimeRead,
} from "../../FeatureSet/Telemetry/Utils/OtlpLogRecordTime";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * When an OTLP log record is stored (#6395): its own time; else, as
 * OpenTelemetry's logs data model says ("Use time_unix_nano if it is
 * present, otherwise use observed_time_unix_nano"), the time its SDK or
 * collector observed it; else the time it arrived. Each time is read the
 * way ingest always read timeUnixNano - an integer string exactly, a number
 * or other numeric text as its float - and what the Log table cannot hold
 * (past int64 nanoseconds, 2262-04-11) is no time, so it can no longer cost
 * a whole insert. The observedTimeUnixNano column keeps the observed time as
 * it was written, and 0 for what its UInt64 cannot hold.
 */

// 2026-11-09T10:00:00.123456789Z, as OTLP/protobuf sends a time.
const OWN_TIME: string = "1794218400123456789";
// 2026-11-09T10:00:00.124Z plus 1 ns: observed just after.
const OBSERVED_TIME: string = "1794218400124000001";
// The clock the arrival fallback reads here.
const NOW_MS: number = Date.UTC(2026, 10, 9, 10, 5, 0, 777);

function freezeClock(ms: number = NOW_MS): void {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(ms);
  });
}

function captureWarnings(): Array<string> {
  const warnings: Array<string> = [];
  jest.spyOn(logger, "warn").mockImplementation((message: unknown): void => {
    warnings.push(String(message));
  });
  return warnings;
}

// The time column's text, as ingest writes it from a read.
function timeColumn(read: OtlpLogRecordTime): string {
  return OneUptimeDate.toClickhouseDateTime64(read.timeDate, read.timeUnixNano);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which time a record is stored at", () => {
  test("its own time when it sends one, to the nanosecond; its observed time kept beside it", () => {
    const read: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
      timeUnixNano: OWN_TIME,
      observedTimeUnixNano: OBSERVED_TIME,
    });

    expect(read).toEqual({
      timeUnixNano: OWN_TIME,
      timeDate: new Date("2026-11-09T10:00:00.123Z"),
      source: OtlpLogTimeSource.Record,
      observedTimeUnixNano: OBSERVED_TIME,
    });
    expect(timeColumn(read)).toBe("2026-11-09 10:00:00.123456789");
  });

  test("no time of its own: its observed time, to the nanosecond, in both columns", () => {
    for (const noOwnTime of [undefined, null, "", 0, "0", "+000", -5, "-5"]) {
      const read: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
        timeUnixNano: noOwnTime,
        observedTimeUnixNano: OBSERVED_TIME,
      });

      expect({ noOwnTime, read }).toEqual({
        noOwnTime,
        read: {
          timeUnixNano: OBSERVED_TIME,
          timeDate: new Date("2026-11-09T10:00:00.124Z"),
          source: OtlpLogTimeSource.Observed,
          observedTimeUnixNano: OBSERVED_TIME,
        },
      });
      expect(timeColumn(read)).toBe("2026-11-09 10:00:00.124000001");
    }
  });

  test("neither: the time it arrived, one read of the clock, its millisecond as digits", () => {
    freezeClock();
    const warnings: Array<string> = captureWarnings();

    for (const record of [
      {},
      { timeUnixNano: "0", observedTimeUnixNano: "0" },
      { timeUnixNano: 0, observedTimeUnixNano: 0 },
      { timeUnixNano: null, observedTimeUnixNano: "" },
    ]) {
      const read: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read(record);

      expect(read.source).toBe(OtlpLogTimeSource.Arrival);
      expect(read.timeDate.getTime()).toBe(NOW_MS);
      expect(read.timeUnixNano).toBe(`${NOW_MS}000000`);
      expect(timeColumn(read)).toBe("2026-11-09 10:05:00.777000000");
    }

    // No time is no fault: nothing warned.
    expect(warnings).toEqual([]);
    expect(OneUptimeDate.getCurrentDate).toHaveBeenCalledTimes(4);
  });

  test("an own time that is a number, or text that is no integer, is the float it always was", () => {
    const asNumber: number = Number(OWN_TIME);
    const fromNumber: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
      timeUnixNano: asNumber,
    });

    expect(fromNumber.source).toBe(OtlpLogTimeSource.Record);
    expect(fromNumber.timeUnixNano).toBe(asNumber);
    expect(fromNumber.timeDate).toEqual(OneUptimeDate.fromUnixNano(asNumber));

    const fromExponent: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
      timeUnixNano: "1.5e18",
    });

    expect(fromExponent.timeUnixNano).toBe(1.5e18);
    expect(timeColumn(fromExponent)).toBe("2017-07-14 02:40:00.000000000");

    // An observed number is used the same way.
    const observedNumber: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
      observedTimeUnixNano: asNumber,
    });

    expect(observedNumber.source).toBe(OtlpLogTimeSource.Observed);
    expect(observedNumber.timeUnixNano).toBe(asNumber);
    expect(observedNumber.observedTimeUnixNano).toBe(asNumber);
  });

  test("a float with a fraction (only 1970's first days have one) is whole nanoseconds", () => {
    const read: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
      timeUnixNano: 1234.75,
    });

    expect(read.timeUnixNano).toBe(1234);
    // Before #6395: "1970-01-01 00:00:00.001234.75", which ClickHouse refuses.
    expect(timeColumn(read)).toBe("1970-01-01 00:00:00.000001234");
    expect(OtlpLogRecordTimeUtil.read({ timeUnixNano: 0.5 }).source).not.toBe(
      OtlpLogTimeSource.Record,
    );
  });
});

describe("a time far in the past or the future", () => {
  test("is kept as it came, own or observed, as an own time always was", () => {
    // 1970-01-01T00:00:00.000000001Z, 2001 and 2200.
    for (const [time, column] of [
      ["1", "1970-01-01 00:00:00.000000001"],
      ["1000000000000000000", "2001-09-09 01:46:40.000000000"],
      ["7258118400000000001", "2200-01-01 00:00:00.000000001"],
    ]) {
      const own: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
        timeUnixNano: time,
        observedTimeUnixNano: OBSERVED_TIME,
      });
      const observed: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
        observedTimeUnixNano: time,
      });

      expect([own.source, own.timeUnixNano, timeColumn(own)]).toEqual([
        OtlpLogTimeSource.Record,
        time,
        column,
      ]);
      expect([
        observed.source,
        observed.timeUnixNano,
        timeColumn(observed),
      ]).toEqual([OtlpLogTimeSource.Observed, time, column]);
    }
  });

  test("up to the last nanosecond the Log table holds: int64 nanoseconds, 2262-04-11", () => {
    const last: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
      timeUnixNano: MAX_STORABLE_LOG_UNIX_NANO_DIGITS,
    });

    expect(last.source).toBe(OtlpLogTimeSource.Record);
    expect(last.timeUnixNano).toBe("9223372036854775807");
    expect(timeColumn(last)).toBe("2262-04-11 23:47:16.854775807");

    const lastFloat: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
      timeUnixNano: MAX_STORABLE_LOG_UNIX_NANO,
    });

    expect(lastFloat.source).toBe(OtlpLogTimeSource.Record);
    expect(lastFloat.timeDate.toISOString()).toBe("2262-04-11T23:47:16.854Z");
  });

  test("one past it is no time: the record is stored at its observed time, warned", () => {
    const warnings: Array<string> = captureWarnings();

    for (const pastTheTable of [
      "9223372036854775808",
      "18446744073709551615",
      "9".repeat(21),
      // Too long to read exactly: the float, past the range.
      "1".repeat(25),
      9_223_372_036_854_775_808,
      "9.3e18",
      Number.POSITIVE_INFINITY,
    ]) {
      const read: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
        timeUnixNano: pastTheTable,
        observedTimeUnixNano: OBSERVED_TIME,
      });

      expect({ pastTheTable, source: read.source }).toEqual({
        pastTheTable,
        source: OtlpLogTimeSource.Observed,
      });
      expect(read.timeUnixNano).toBe(OBSERVED_TIME);
    }

    expect(warnings).toEqual([
      "Error processing timestamp 9223372036854775808: Timestamp out of storable range: 9223372036854775808, using observed time",
      "Error processing timestamp 18446744073709551615: Timestamp out of storable range: 18446744073709551615, using observed time",
      `Error processing timestamp ${"9".repeat(21)}: Timestamp out of storable range: ${"9".repeat(21)}, using observed time`,
      `Error processing timestamp ${"1".repeat(25)}: Timestamp out of storable range: ${"1".repeat(25)}, using observed time`,
      // 2^63 as a number, written as JavaScript writes it.
      "Error processing timestamp 9223372036854776000: Timestamp out of storable range: 9223372036854776000, using observed time",
      "Error processing timestamp 9.3e18: Timestamp out of storable range: 9.3e18, using observed time",
      "Error processing timestamp Infinity: Timestamp out of storable range: Infinity, using observed time",
    ]);
  });

  test("an observed time past it is no time either: the time it arrived, not warned", () => {
    freezeClock();
    const warnings: Array<string> = captureWarnings();

    const read: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
      observedTimeUnixNano: "9223372036854775808",
    });

    expect(read.source).toBe(OtlpLogTimeSource.Arrival);
    expect(read.timeUnixNano).toBe(`${NOW_MS}000000`);
    // Its column still keeps it: a UInt64 holds it.
    expect(read.observedTimeUnixNano).toBe("9223372036854775808");
    expect(warnings).toEqual([]);
  });

  test("the bounds are the largest values below 2^63 and 2^64, as doubles too", () => {
    expect(BigInt(MAX_STORABLE_LOG_UNIX_NANO_DIGITS)).toBe(
      BigInt(2) ** BigInt(63) - BigInt(1),
    );
    expect(BigInt(MAX_STORABLE_LOG_UNIX_NANO)).toBe(
      BigInt(2) ** BigInt(63) - BigInt(1024),
    );
    // The next double is 2^63 itself.
    expect(MAX_STORABLE_LOG_UNIX_NANO + 1024).toBe(2 ** 63);

    expect(BigInt(MAX_OBSERVED_COLUMN_DIGITS)).toBe(
      BigInt(2) ** BigInt(64) - BigInt(1),
    );
    expect(BigInt(MAX_OBSERVED_COLUMN_FLOAT)).toBe(
      BigInt(2) ** BigInt(64) - BigInt(2048),
    );
    expect(MAX_OBSERVED_COLUMN_FLOAT + 2048).toBe(2 ** 64);
  });
});

describe("an own time that is no time", () => {
  test("text that is no number: the warning it always had, now with the time used instead", () => {
    freezeClock();
    const warnings: Array<string> = captureWarnings();

    const withObserved: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
      timeUnixNano: "abc",
      observedTimeUnixNano: OBSERVED_TIME,
    });
    const withNothing: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
      timeUnixNano: "abc",
      observedTimeUnixNano: "abc",
    });

    expect(withObserved.source).toBe(OtlpLogTimeSource.Observed);
    expect(withNothing.source).toBe(OtlpLogTimeSource.Arrival);
    expect(withNothing.observedTimeUnixNano).toBe(0);
    expect(warnings).toEqual([
      "Error processing timestamp abc: Invalid timestamp string: abc, using observed time",
      // The text before #6395, word for word.
      "Error processing timestamp abc: Invalid timestamp string: abc, using current time",
    ]);
  });

  test("a value of another type: warned, never thrown, never written", () => {
    freezeClock();
    const warnings: Array<string> = captureWarnings();

    for (const value of [{ low: 1, high: 2 }, true, ["1"]]) {
      expect(
        OtlpLogRecordTimeUtil.read({
          timeUnixNano: value,
          observedTimeUnixNano: OBSERVED_TIME,
        }).source,
      ).toBe(OtlpLogTimeSource.Observed);
    }

    expect(warnings).toEqual([
      "Error processing timestamp [object Object]: Invalid timestamp of type object, using observed time",
      "Error processing timestamp true: Invalid timestamp of type boolean, using observed time",
      "Error processing timestamp 1: Invalid timestamp of type object, using observed time",
    ]);
  });
});

describe("one time read", () => {
  test("nothing, a zero and anything below a nanosecond are OTLP's unknown time", () => {
    for (const value of [
      undefined,
      null,
      "",
      0,
      "0",
      "+0",
      "000",
      -1,
      "-1",
      "-1794218400123456789",
      0.25,
      Number.NaN,
      false,
    ]) {
      const read: OtlpTimeRead = OtlpLogRecordTimeUtil.readTime(value);
      expect({ value, read }).toEqual({ value, read: { kind: "none" } });
    }
  });

  test("a '+' and leading zeros read as the digits they lead", () => {
    expect(OtlpLogRecordTimeUtil.readTime(`+000${OWN_TIME}`)).toEqual({
      kind: "time",
      unixNano: OWN_TIME,
      date: new Date("2026-11-09T10:00:00.123Z"),
    });
  });
});

describe("the observedTimeUnixNano column", () => {
  test("keeps the observed time as it came: digits exactly, a number as its float", () => {
    expect(OtlpLogRecordTimeUtil.toObservedColumn(OBSERVED_TIME)).toBe(
      OBSERVED_TIME,
    );
    expect(OtlpLogRecordTimeUtil.toObservedColumn(`+00${OBSERVED_TIME}`)).toBe(
      OBSERVED_TIME,
    );
    expect(OtlpLogRecordTimeUtil.toObservedColumn(1.5e18)).toBe(1.5e18);
    expect(OtlpLogRecordTimeUtil.toObservedColumn("1.5e18")).toBe(1.5e18);
    expect(OtlpLogRecordTimeUtil.toObservedColumn("0")).toBe("0");
    expect(
      OtlpLogRecordTimeUtil.toObservedColumn(MAX_OBSERVED_COLUMN_DIGITS),
    ).toBe("18446744073709551615");
    expect(
      OtlpLogRecordTimeUtil.toObservedColumn(MAX_OBSERVED_COLUMN_FLOAT),
    ).toBe(MAX_OBSERVED_COLUMN_FLOAT);
  });

  test("cuts a fraction to whole nanoseconds, as the column was always written", () => {
    expect(OtlpLogRecordTimeUtil.toObservedColumn(1500.75)).toBe(1500);
    expect(OtlpLogRecordTimeUtil.toObservedColumn("1500.75")).toBe(1500);
    expect(OtlpLogRecordTimeUtil.toObservedColumn(0.5)).toBe(0);

    // And the record is stored at the same whole nanosecond.
    const read: OtlpLogRecordTime = OtlpLogRecordTimeUtil.read({
      observedTimeUnixNano: "1500.75",
    });
    expect([read.source, read.timeUnixNano, read.observedTimeUnixNano]).toEqual(
      [OtlpLogTimeSource.Observed, 1500, 1500],
    );
    expect(timeColumn(read)).toBe("1970-01-01 00:00:00.000001500");
  });

  test("0 for none, and for what its UInt64 refused or wrapped", () => {
    for (const value of [
      undefined,
      null,
      "",
      0,
      // ClickHouse refused these, and the whole insert with them.
      -5,
      "-5",
      "abc",
      1e21,
      "1".repeat(22),
      Number.POSITIVE_INFINITY,
      "Infinity",
      { low: 1, high: 2 },
      true,
      // ...and wrapped these into a wrong time.
      "18446744073709551616",
      "9".repeat(21),
      2 ** 64,
    ]) {
      expect({
        value,
        column: OtlpLogRecordTimeUtil.toObservedColumn(value),
      }).toEqual({ value, column: 0 });
    }
  });

  test("is the same whichever time the record is stored at", () => {
    freezeClock();
    const warnings: Array<string> = captureWarnings();

    for (const timeUnixNano of [OWN_TIME, undefined, "abc"]) {
      expect(
        OtlpLogRecordTimeUtil.read({
          timeUnixNano,
          observedTimeUnixNano: `+0${OBSERVED_TIME}`,
        }).observedTimeUnixNano,
      ).toBe(OBSERVED_TIME);
    }

    expect(warnings).toHaveLength(1);
  });
});
