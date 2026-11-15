import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";
import { JSONObject } from "Common/Types/JSON";
import FluentRecordTimeUtil, {
  EARLIEST_RECORD_TIME_MS,
  FLUENTD_EVENT_TIME_FIELD,
  FLUENT_RECORD_TIME_FIELDS,
  FluentRecordTime,
  MAX_RECORD_TIME_AHEAD_MS,
  MAX_TIME_TEXT_LENGTH,
  RecordTimeRead,
} from "../../FeatureSet/Telemetry/Utils/FluentRecordTime";

/*
 * When a Fluentd record happened (issue #8010). Fluentd's HTTP output
 * sends only the record, and before this every Fluentd log was stored at
 * the time it was processed: a line written at 08:00 and read after a
 * restart at 10:00 showed 10:00. A record now says when it happened in
 * its own fields - "time", "timestamp", "@timestamp", "ts", then the
 * guide's fluentd_time - in the forms loggers and Fluentd write.
 */

// When the record arrived, in these tests.
const ARRIVED_AT: Date = new Date("2026-11-15T10:17:18.703Z");

// 2026-11-14T08:00:00Z, in whole seconds since the epoch.
const NOV_14_0800: number = Date.UTC(2026, 10, 14, 8, 0, 0) / 1000;

// The nanoseconds of a whole second and nine places of fraction, as digits.
const nanos: (seconds: number, fraction?: string) => string = (
  seconds: number,
  fraction: string = "",
): string => {
  return `${seconds}${fraction.padEnd(9, "0")}`;
};

const read: (value: unknown, arrivedAt?: Date) => RecordTimeRead | null = (
  value: unknown,
  arrivedAt: Date = ARRIVED_AT,
): RecordTimeRead | null => {
  return FluentRecordTimeUtil.readTime(value, arrivedAt);
};

const readNanos: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  return read(value)?.unixNano ?? null;
};

describe("the fields a record's time is read from", () => {
  test("the names loggers write a line's time under, then the time Fluentd gave the event", () => {
    expect(FLUENT_RECORD_TIME_FIELDS).toEqual([
      "time",
      "timestamp",
      "@timestamp",
      "ts",
      "fluentd_time",
    ]);
    expect(FLUENTD_EVENT_TIME_FIELD).toBe("fluentd_time");
  });

  test("the window a time must fall in: from 2000, to a day past its arrival", () => {
    expect(new Date(EARLIEST_RECORD_TIME_MS).toISOString()).toBe(
      "2000-01-01T00:00:00.000Z",
    );
    expect(MAX_RECORD_TIME_AHEAD_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("an ISO 8601 time", () => {
  test.each<[string, string, string]>([
    ["UTC, to the millisecond", "2026-11-14T08:00:00.123Z", "123"],
    ["no fraction", "2026-11-14T08:00:00Z", ""],
    [
      "nine places, kept to the nanosecond",
      "2026-11-14T08:00:00.123456789Z",
      "123456789",
    ],
    ["six places", "2026-11-14T08:00:00.123456Z", "123456"],
    ["one place", "2026-11-14T08:00:00.5Z", "5"],
    [
      "more than nine places: the first nine, not rounded",
      "2026-11-14T08:00:00.1234567899Z",
      "123456789",
    ],
    ["a comma before the fraction", "2026-11-14T08:00:00,25Z", "25"],
    ["lower-case t and z", "2026-11-14t08:00:00.5z", "5"],
    ["a space between date and time", "2026-11-14 08:00:00.5Z", "5"],
    ["no seconds", "2026-11-14T08:00Z", ""],
    ["no zone: UTC", "2026-11-14T08:00:00.123", "123"],
    ["no zone, space-separated: UTC", "2026-11-14 08:00:00", ""],
    [
      "UTC written out, as Ruby's Time#to_s in UTC",
      "2026-11-14 08:00:00 UTC",
      "",
    ],
    ["a zero offset, as Ruby's Time#to_s", "2026-11-14 08:00:00 +0000", ""],
    ["padded with spaces", "  2026-11-14T08:00:00Z  ", ""],
  ])("%s: %s", (_label: string, text: string, fraction: string) => {
    expect(readNanos(text)).toBe(nanos(NOV_14_0800, fraction));
  });

  test.each<[string, string, number]>([
    ["+01:00", "2026-11-14T09:00:00+01:00", 0],
    ["+0100", "2026-11-14T09:00:00+0100", 0],
    ["+01", "2026-11-14T09:00:00+01", 0],
    ["-05:30", "2026-11-14T02:30:00-05:30", 0],
    ["+05:45, a quarter-hour zone", "2026-11-14T13:45:00+05:45", 0],
    ["-00:00", "2026-11-14T08:00:00-00:00", 0],
    ["+14:00, past midnight into the next day", "2026-11-14T22:00:00+14:00", 0],
    ["-11:00, a day back", "2026-11-13T21:00:00-11:00", 0],
    ["an offset after a space", "2026-11-14 09:00:00 +01:00", 0],
  ])("an offset, %s, is taken off", (_label: string, text: string) => {
    expect(readNanos(text)).toBe(nanos(NOV_14_0800));
  });

  test("the times loggers and Fluentd write", () => {
    const examples: Array<[string, string, string]> = [
      // Docker's json-file and Go's RFC3339Nano.
      ["docker", "2026-11-14T08:00:00.123456789Z", "123456789"],
      // Go's slog, with the host's zone.
      ["slog", "2026-11-14T09:00:00.123456789+01:00", "123456789"],
      // logrus.
      ["logrus", "2026-11-14T09:00:00+01:00", ""],
      // bunyan, winston and JavaScript's toISOString.
      ["bunyan", "2026-11-14T08:00:00.123Z", "123"],
      // Python's isoformat with a zone.
      ["python", "2026-11-14T08:00:00.123456+00:00", "123456"],
      // The guide's fluentd_time (strftime %Y-%m-%dT%H:%M:%S.%NZ, in UTC).
      ["fluentd_time", "2026-11-14T08:00:00.834701377Z", "834701377"],
      // record_transformer's ${time} without Ruby (Time#to_s).
      ["record_transformer", "2026-11-14 08:00:00 +0000", ""],
    ];

    for (const [writer, text, fraction] of examples) {
      expect({ writer, read: readNanos(text) }).toEqual({
        writer,
        read: nanos(NOV_14_0800, fraction),
      });
    }
  });

  test("its Date is the millisecond its nanoseconds fall in", () => {
    expect(read("2026-11-14T08:00:00.123999999Z")?.date).toEqual(
      new Date("2026-11-14T08:00:00.123Z"),
    );
    expect(read("2026-11-14T09:00:00.5+01:00")?.date).toEqual(
      new Date("2026-11-14T08:00:00.500Z"),
    );
  });

  test("a leap day is a day; the 29th of February in another year is not", () => {
    expect(read("2024-02-29T08:00:00Z")?.date).toEqual(
      new Date("2024-02-29T08:00:00Z"),
    );
    expect(read("2025-02-29T08:00:00Z")).toBeNull();
  });

  test.each<[string, string]>([
    ["a day the month does not have", "2026-11-31T08:00:00Z"],
    ["the 30th of February", "2026-02-30T08:00:00Z"],
    ["day 0", "2026-11-00T08:00:00Z"],
    ["month 13", "2026-13-14T08:00:00Z"],
    ["month 0", "2026-00-14T08:00:00Z"],
    ["hour 24", "2026-11-14T24:00:00Z"],
    ["minute 60", "2026-11-14T08:60:00Z"],
    ["second 60", "2026-11-14T08:00:60Z"],
    ["an offset of 24 hours", "2026-11-14T08:00:00+24:00"],
    ["an offset of 60 minutes", "2026-11-14T08:00:00+01:60"],
    ["a date alone", "2026-11-14"],
    ["a time alone", "08:00:00"],
    ["a two-digit year", "26-11-14T08:00:00Z"],
    ["a one-digit month", "2026-1-14T08:00:00Z"],
    ["a fraction with no digits", "2026-11-14T08:00:00.Z"],
    ["more after the zone", "2026-11-14T08:00:00Zjunk"],
    ["a zone name", "2026-11-14T08:00:00 CET"],
    ["two spaces before the zone", "2026-11-14T08:00:00  Z"],
    ["an Apache time", "14/Nov/2026:08:00:00 +0000"],
    ["a syslog time", "Nov 14 08:00:00"],
    ["RFC 2822", "Sat, 14 Nov 2026 08:00:00 +0000"],
    ["a word", "yesterday"],
    ["a duration", "125ms"],
  ])("no time: %s (%s)", (_label: string, text: string) => {
    expect(read(text)).toBeNull();
  });
});

describe("a number since the epoch", () => {
  const SECONDS: number = 1763107202; // 2025-11-14T08:00:02Z

  test.each<[string, unknown, string]>([
    ["whole seconds", SECONDS, nanos(SECONDS)],
    ["whole seconds, as text", String(SECONDS), nanos(SECONDS)],
    [
      "seconds with a fraction (zap's ts)",
      1763107205.5,
      nanos(1763107205, "5"),
    ],
    [
      "seconds with a fraction, as text, to the nanosecond",
      "1763107203.123456789",
      nanos(1763107203, "123456789"),
    ],
    [
      "seconds with more than nine places, as text: the first nine",
      "1763107203.1234567891",
      nanos(1763107203, "123456789"),
    ],
    ["milliseconds (pino's time)", 1763107204123, nanos(1763107204, "123")],
    ["milliseconds, as text", "1763107204123", nanos(1763107204, "123")],
    [
      "milliseconds with a fraction, as text",
      "1763107204123.456",
      nanos(1763107204, "123456"),
    ],
    ["microseconds", 1763107204123456, nanos(1763107204, "123456")],
    ["microseconds, as text", "1763107204123456", nanos(1763107204, "123456")],
    [
      "nanoseconds, as text: exactly",
      "1763107204123456789",
      "1763107204123456789",
    ],
    ["padded with spaces", ` ${SECONDS} `, nanos(SECONDS)],
  ])("%s", (_label: string, value: unknown, expected: string) => {
    expect(readNanos(value)).toBe(expected);
  });

  test("nanoseconds as a number keep the millisecond a double can hold", () => {
    // 1763107204123456789 is not a double: JSON.parse rounds it.
    const parsed: number = JSON.parse("1763107204123456789") as number;
    const time: RecordTimeRead | null = read(parsed);

    expect(time?.date).toEqual(new Date(1763107204123));
    expect(
      Math.abs(Number(BigInt(time!.unixNano) - BigInt("1763107204123456789"))),
    ).toBeLessThan(1000);
  });

  test("each unit's first value past the one before it", () => {
    // Past 1e11 seconds (the year 5138), the number is milliseconds: 1973, before 2000.
    expect(read(1e11 + 1)).toBeNull();
    // 1e14 + 1 milliseconds is 5138 again; as microseconds, 1973.
    expect(read(1e14 + 1)).toBeNull();
    // The year 2000 in each unit.
    expect(read(946684800)?.date).toEqual(new Date(EARLIEST_RECORD_TIME_MS));
    expect(read(946684800000)?.date).toEqual(new Date(EARLIEST_RECORD_TIME_MS));
    expect(read(946684800000000)?.date).toEqual(
      new Date(EARLIEST_RECORD_TIME_MS),
    );
    expect(read("946684800000000000")?.date).toEqual(
      new Date(EARLIEST_RECORD_TIME_MS),
    );
  });

  test.each<[string, unknown]>([
    ["a negative number", -1763107202],
    ["negative text", "-1763107202"],
    ["a plus sign", "+1763107202"],
    ["an exponent", "1.763107202e9"],
    ["an exponent as a number past 1e21", 1.763107202e21],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["a point with no fraction", "1763107202."],
    ["a fraction with no whole", ".5"],
    ["digits and a word", "1763107202 seconds"],
    ["zero", 0],
  ])("no time: %s", (_label: string, value: unknown) => {
    expect(read(value)).toBeNull();
  });
});

describe("only a time a log has", () => {
  test("not before 2000: a duration, a count or a clock never set", () => {
    // "time": 125, a request's duration in milliseconds.
    expect(read(125)).toBeNull();
    // 1999-12-31T23:59:59Z, and the first second of 2000.
    expect(read(946684799)).toBeNull();
    expect(read(946684800)).not.toBeNull();
    expect(read("1999-12-31T23:59:59.999999999Z")).toBeNull();
    expect(read("2000-01-01T00:00:00Z")).not.toBeNull();
    // A device whose clock was never set.
    expect(read("1970-01-01T00:00:05Z")).toBeNull();
    // What Fluentd's json parser makes of an ISO time as a number (2026 seconds).
    expect(read("1970-01-01T00:33:46Z")).toBeNull();
  });

  test("not more than a day ahead of its arrival", () => {
    const dayAhead: Date = new Date(
      ARRIVED_AT.getTime() + MAX_RECORD_TIME_AHEAD_MS,
    );

    expect(read(dayAhead.toISOString())?.date).toEqual(dayAhead);
    expect(read(new Date(dayAhead.getTime() + 1).toISOString())).toBeNull();
    // An hour ahead, a host clock running fast: read.
    expect(read("2026-11-15T11:17:18Z")).not.toBeNull();
    // Seconds in the year 5138 (just under 1e11), the wrong unit.
    expect(read(99999999999)).toBeNull();
    // A time the Log table cannot hold (past int64 nanoseconds, 2262).
    expect(read("2263-01-01T00:00:00Z")).toBeNull();
  });

  test("an old log, read from a backlog weeks later, keeps its time", () => {
    expect(read("2026-10-01T08:00:00Z")?.date).toEqual(
      new Date("2026-10-01T08:00:00Z"),
    );
  });

  test.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    ["true", true],
    ["an object", { seconds: 1763107202 }],
    ["a list", [1763107202]],
    ["empty text", ""],
    ["spaces", "   "],
  ])("no time: %s", (_label: string, value: unknown) => {
    expect(read(value)).toBeNull();
  });

  test("text longer than any time is not read", () => {
    const padded: string = `2026-11-14T08:00:00.${"1".repeat(MAX_TIME_TEXT_LENGTH)}Z`;

    expect(padded.length).toBeGreaterThan(MAX_TIME_TEXT_LENGTH);
    expect(read(padded)).toBeNull();
    expect(read("1".repeat(MAX_TIME_TEXT_LENGTH + 1))).toBeNull();
    // A long run of digits takes no time to turn down.
    const turnedDown: FastestRun<Array<RecordTimeRead | null>> = fastestRun({
      run: (): Array<RecordTimeRead | null> => {
        return [
          read(`${"9".repeat(100000)}`),
          read(`2026-11-14T08:00:00${" ".repeat(100000)}x`),
        ];
      },
      limitInMs: 1000,
    });

    expect(turnedDown.result).toEqual([null, null]);
    expect(turnedDown.inMs).toBeLessThan(1000);
  });
});

describe("a record's time", () => {
  const readRecord: (record: JSONObject) => FluentRecordTime = (
    record: JSONObject,
  ): FluentRecordTime => {
    return FluentRecordTimeUtil.read(record, ARRIVED_AT);
  };

  const OWN: string = "2026-11-14T08:00:00.123Z";
  const FLUENTD: string = "2026-11-15T10:17:12.834701377Z";

  test("its own time, from the field it is in", () => {
    expect(readRecord({ message: "x", time: OWN })).toEqual({
      timeUnixNano: nanos(NOV_14_0800, "123"),
      timeDate: new Date(OWN),
      field: "time",
    });
  });

  test("its own time wins over the time Fluentd gave the event", () => {
    expect(readRecord({ time: OWN, fluentd_time: FLUENTD }).field).toBe("time");
  });

  test("no time of its own: the time Fluentd gave the event, to the nanosecond", () => {
    expect(readRecord({ message: "plain", fluentd_time: FLUENTD })).toEqual({
      timeUnixNano: "1794737832834701377",
      timeDate: new Date("2026-11-15T10:17:12.834Z"),
      field: "fluentd_time",
    });
  });

  test("the first of the fields that holds a time, in the order they are read", () => {
    const all: JSONObject = {
      fluentd_time: "2026-11-15T10:00:00Z",
      ts: "2026-11-14T04:00:00Z",
      "@timestamp": "2026-11-14T03:00:00Z",
      timestamp: "2026-11-14T02:00:00Z",
      time: "2026-11-14T01:00:00Z",
    };
    const seen: Array<string | null> = [];

    for (const field of FLUENT_RECORD_TIME_FIELDS) {
      seen.push(readRecord(all).field);
      delete all[field];
    }

    seen.push(readRecord(all).field);

    expect(seen).toEqual([
      "time",
      "timestamp",
      "@timestamp",
      "ts",
      "fluentd_time",
      null,
    ]);
  });

  test("a field that holds no time is passed over for the next", () => {
    expect(
      readRecord({ time: 125, timestamp: "soon", ts: 1763107205.5 }),
    ).toEqual({
      timeUnixNano: nanos(1763107205, "5"),
      timeDate: new Date(1763107205500),
      field: "ts",
    });
    expect(readRecord({ time: null, fluentd_time: FLUENTD }).field).toBe(
      "fluentd_time",
    );
  });

  /*
   * The values Fluentd's json parser dropped a line for when it read the
   * line's time itself (issue #8241). The guide's file no longer has it
   * read one, so such a line arrives, and its time is read here.
   */
  const NOT_TEXT_OR_NUMBER: Array<[string, unknown]> = [
    ["null", null],
    ["true", true],
    ["false", false],
    ["a list", [1763107202]],
    ["an empty list", []],
    ["an object", { s: 1 }],
    ["an empty object", {}],
  ];

  test.each(NOT_TEXT_OR_NUMBER)(
    "a time field that holds %s: the time Fluentd read the line, whichever field it is in",
    (_label: string, value: unknown) => {
      for (const field of FLUENT_RECORD_TIME_FIELDS.filter(
        (name: string): boolean => {
          return name !== FLUENTD_EVENT_TIME_FIELD;
        },
      )) {
        expect({
          field,
          read: readRecord({
            [field]: value as JSONObject,
            message: "x",
            fluentd_time: FLUENTD,
          }),
        }).toEqual({
          field,
          read: {
            timeUnixNano: "1794737832834701377",
            timeDate: new Date("2026-11-15T10:17:12.834Z"),
            field: FLUENTD_EVENT_TIME_FIELD,
          },
        });
      }
    },
  );

  test.each(NOT_TEXT_OR_NUMBER)(
    "every time field holds %s: the time it arrived",
    (_label: string, value: unknown) => {
      const record: JSONObject = { message: "x" };

      for (const field of FLUENT_RECORD_TIME_FIELDS) {
        record[field] = value as JSONObject;
      }

      expect(readRecord(record)).toEqual({
        timeUnixNano: `${ARRIVED_AT.getTime()}000000`,
        timeDate: ARRIVED_AT,
        field: null,
      });
    },
  );

  test("no time at all: the time it arrived, in milliseconds' nanoseconds", () => {
    for (const record of [
      {},
      { message: "plain" },
      { time: 125 },
      { time: "yesterday", fluentd_time: "never" },
      // Other names and other cases are not read.
      { Time: OWN, TIME: OWN, date: OWN, datetime: OWN, "@t": OWN, t: OWN },
    ] as Array<JSONObject>) {
      expect({ record, time: readRecord(record) }).toEqual({
        record,
        time: {
          timeUnixNano: `${ARRIVED_AT.getTime()}000000`,
          timeDate: ARRIVED_AT,
          field: null,
        },
      });
    }
  });

  test("only the record's own fields, not ones it inherits", () => {
    const record: JSONObject = Object.create({ time: OWN }) as JSONObject;

    record["message"] = "x";

    expect(readRecord(record).field).toBeNull();
  });

  test("what the guide's Fluentd sent, in a real run, each at its own time", () => {
    // The body the stub of /fluentd/logs got from fluent/fluentd 1.20.1 running the guide's files.
    const sent: Array<JSONObject> = [
      {
        time: "2026-11-14T08:00:00.123Z",
        level: "error",
        message: "iso time line",
        fluentd_time: "2026-11-15T10:17:12.834701377Z",
      },
      {
        time: "2026-11-14T08:00:01+01:00",
        message: "iso offset line",
        fluentd_time: "2026-11-15T10:17:12.834712844Z",
      },
      {
        time: 1763107202,
        message: "epoch seconds line",
        fluentd_time: "2026-11-15T10:17:12.834714917Z",
      },
      {
        time: 1763107203.25,
        message: "epoch float line",
        fluentd_time: "2026-11-15T10:17:12.834716369Z",
      },
      {
        level: 30,
        time: 1763107204123,
        pid: 7,
        msg: "pino epoch ms line",
        fluentd_time: "2026-11-15T10:17:12.834723410Z",
      },
      {
        ts: 1763107205.5,
        msg: "zap ts line",
        fluentd_time: "2026-11-15T10:17:12.834724612Z",
      },
      {
        timestamp: "2026-11-14T08:00:06.000Z",
        message: "winston timestamp line",
        fluentd_time: "2026-11-15T10:17:12.834725794Z",
      },
      {
        message: "no time line",
        fluentd_time: "2026-11-15T10:17:12.834730932Z",
      },
      {
        message: "plain line: GET /health 200 3ms",
        fluentd_time: "2026-11-15T10:17:12.834740045Z",
      },
      {
        message: "root-only file line",
        fluentd_time: "2026-11-15T10:17:13.180997799Z",
      },
      {
        log: "forwarded event",
        container_name: "web",
        fluentd_time: "2025-11-14T08:00:07.000000000Z",
      },
    ];

    expect(
      sent.map((record: JSONObject): [string | null, string] => {
        const time: FluentRecordTime = readRecord(record);

        return [time.field, time.timeUnixNano];
      }),
    ).toEqual([
      ["time", nanos(NOV_14_0800, "123")],
      ["time", nanos(NOV_14_0800 - 3600 + 1)],
      ["time", nanos(1763107202)],
      ["time", nanos(1763107203, "25")],
      ["time", nanos(1763107204, "123")],
      ["ts", nanos(1763107205, "5")],
      ["timestamp", nanos(NOV_14_0800 + 6)],
      ["fluentd_time", "1794737832834730932"],
      ["fluentd_time", "1794737832834740045"],
      ["fluentd_time", "1794737833180997799"],
      ["fluentd_time", nanos(1763107207)],
    ]);
  });
});
