/** @timezone America/New_York */

import OneUptimeDate from "../../Types/Date";
import moment from "moment-timezone";
import fs from "fs";
import path from "path";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";
import {
  ComparedRuns,
  FastestRun,
  fastestRunsCompared,
} from "../Helpers/FastestRun";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Two OneUptimeDate helpers run several times for every ingested log, span
 * and metric data point, and were made cheaper:
 *
 *   - fromUnixNano builds its Date directly instead of through
 *     moment(millis).toDate();
 *   - toClickhouseDateTime / toClickhouseDateTime64 keep the text of recent
 *     seconds, so a run of rows from the same seconds is formatted once.
 *
 * Both must give exactly what they gave before, for every input. The
 * references below are master's implementations, verbatim, and every test
 * compares against them on the same inputs.
 *
 * Run in a non-UTC zone with daylight saving, as DateClickhouseFormat.test.ts
 * does: under TZ=UTC a slip from the UTC getters to the local ones would be
 * invisible. The docblock above sets the zone before this file loads
 * (Tests/Utils/TimezoneEnvironment.js); assigning process.env.TZ here would
 * not, since Jest's process.env is a copy. The first test checks it took.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the zone this suite runs in", () => {
  test("is America/New_York, five hours behind UTC in winter and four in summer", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "America/New_York",
    );
    expect(new Date("2026-01-15T12:00:00.000Z").getTimezoneOffset()).toBe(300);
    expect(new Date("2026-07-15T12:00:00.000Z").getTimezoneOffset()).toBe(240);
  });
});

// Master's OneUptimeDate.fromUnixNano, verbatim.
function referenceFromUnixNano(timestamp: string | number): Date {
  if (typeof timestamp === "string") {
    const trimmed: string = timestamp.trim();
    const integerPattern: RegExp = /^[+-]?\d+$/;
    if (integerPattern.test(trimmed)) {
      const nanosPerMilli: bigint = BigInt(1000000);
      const millis: number = Number(BigInt(trimmed) / nanosPerMilli);
      return moment(millis).toDate();
    }
    return moment(Number(trimmed) / 1000000).toDate();
  }
  return moment(timestamp / 1000000).toDate();
}

// Master's formatUtcClickhouseDateTime, verbatim (it kept nothing).
function referenceClickhouseDateTime(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  const year: string = String(date.getUTCFullYear()).padStart(4, "0");
  const month: string = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day: string = String(date.getUTCDate()).padStart(2, "0");
  const hours: string = String(date.getUTCHours()).padStart(2, "0");
  const minutes: string = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds: string = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Master's toClickhouseDateTime64 on a Date, verbatim.
function referenceClickhouseDateTime64(
  date: Date,
  nanoTimestamp?: number,
): string {
  const base: string = referenceClickhouseDateTime(date);

  let nanoFraction: string;

  if (nanoTimestamp !== undefined && nanoTimestamp > 0) {
    const subSecondNanos: number = nanoTimestamp % 1_000_000_000;
    nanoFraction = subSecondNanos.toString().padStart(9, "0");
  } else {
    const ms: number = date.getMilliseconds();
    nanoFraction = (ms * 1_000_000).toString().padStart(9, "0");
  }

  return `${base}.${nanoFraction}`;
}

// The same instant, NaN included: what a caller can tell two Dates apart by.
function expectSameInstant(actual: Date, expected: Date, input: unknown): void {
  if (
    !(actual instanceof Date) ||
    !Object.is(actual.getTime(), expected.getTime())
  ) {
    throw new Error(
      `fromUnixNano(${JSON.stringify(String(input))}) gave ${actual.getTime()}, master gave ${expected.getTime()}`,
    );
  }
}

// The same text, checked without an expect call per row (they add up).
function expectSameText(
  actual: string,
  expected: string,
  input: unknown,
): void {
  if (actual !== expected) {
    throw new Error(
      `${JSON.stringify(String(input))} was written ${JSON.stringify(actual)}, master wrote ${JSON.stringify(expected)}`,
    );
  }
}

const NOW_IN_NANOS: number = Date.UTC(2026, 9, 17, 10, 11, 12, 345) * 1e6;

// The largest instant a Date holds, in nanoseconds.
const DATE_RANGE_IN_NANOS: number = 8.64e15 * 1e6;

describe("OneUptimeDate.fromUnixNano gives master's Date for every input", () => {
  test("numbers at the edges: zero, signs, fractions, NaN, infinities, the Date range", () => {
    const inputs: Array<number> = [
      0,
      -0,
      1,
      -1,
      0.5,
      -0.5,
      999999,
      1000000,
      1000001,
      1999999.999,
      -1000001,
      NOW_IN_NANOS,
      NOW_IN_NANOS + 0.5,
      NOW_IN_NANOS - 1,
      Number.MAX_SAFE_INTEGER,
      -Number.MAX_SAFE_INTEGER,
      DATE_RANGE_IN_NANOS,
      -DATE_RANGE_IN_NANOS,
      DATE_RANGE_IN_NANOS + 1e6,
      -DATE_RANGE_IN_NANOS - 1e6,
      DATE_RANGE_IN_NANOS * 2,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MIN_VALUE,
      -Number.MIN_VALUE,
      Number.EPSILON,
      NaN,
      Infinity,
      -Infinity,
    ];

    for (const input of inputs) {
      expectSameInstant(
        OneUptimeDate.fromUnixNano(input),
        referenceFromUnixNano(input),
        input,
      );
    }
  });

  test("50,000 seeded numbers across the whole Date range and around now", () => {
    const random: SeededRandom = seededRandom(1700);

    for (let i: number = 0; i < 50000; i++) {
      const kind: number = random(4);
      let input: number;

      if (kind === 0) {
        input = (random() * 2 - 1) * DATE_RANGE_IN_NANOS * 1.01;
      } else if (kind === 1) {
        input = NOW_IN_NANOS + (random() * 2 - 1) * 1e15;
      } else if (kind === 2) {
        // Whole nanoseconds, as OTLP sends them.
        input = Math.trunc(NOW_IN_NANOS + random(1e9) * 1e3);
      } else {
        input = (random() * 2 - 1) * 10 ** random(25);
      }

      expectSameInstant(
        OneUptimeDate.fromUnixNano(input),
        referenceFromUnixNano(input),
        input,
      );
    }
  });

  test("strings: integers read exactly, with signs, zeros and spaces; anything else read as a number", () => {
    const inputs: Array<string> = [
      "0",
      "-0",
      "+0",
      "1",
      "-1",
      "999999",
      "1000000",
      "-1000000",
      "-000001",
      "-0000001",
      "+000001",
      "0001760000000123456789",
      "1760000000123456789",
      "1760000000999999999",
      "-1760000000123456789",
      "  1760000000123456789  ",
      "\t1760000000123456789\n",
      "17600000001234567891234",
      "9".repeat(40),
      "-" + "9".repeat(40),
      "8640000000000000000000",
      "8640000000000000999999",
      "8640000000000001000000",
      "1.76e18",
      "1760000000123456789.5",
      "-1.5",
      "0x1F",
      "1_000",
      "1e400",
      "Infinity",
      "-Infinity",
      "NaN",
      "abc",
      "",
      " ",
      "+",
      "-",
      "1 2",
      "\u{0661}\u{0662}\u{0663}",
    ];

    for (const input of inputs) {
      expectSameInstant(
        OneUptimeDate.fromUnixNano(input),
        referenceFromUnixNano(input),
        input,
      );
    }
  });

  test("20,000 seeded integer strings of every length, sign and padding", () => {
    const random: SeededRandom = seededRandom(1950);

    for (let i: number = 0; i < 20000; i++) {
      const digits: number = 1 + random(26);
      let text: string = String(1 + random(9));

      for (let d: number = 1; d < digits; d++) {
        text += String(random(10));
      }

      const sign: number = random(3);
      const padded: string =
        (sign === 0 ? "" : sign === 1 ? "-" : "+") +
        "0".repeat(random(3)) +
        text;
      const input: string = random(4) === 0 ? ` ${padded} ` : padded;

      expectSameInstant(
        OneUptimeDate.fromUnixNano(input),
        referenceFromUnixNano(input),
        input,
      );
    }
  });

  test("each call hands back a Date of its own", () => {
    const first: Date = OneUptimeDate.fromUnixNano(NOW_IN_NANOS);
    first.setUTCFullYear(1999);

    expect(OneUptimeDate.fromUnixNano(NOW_IN_NANOS).getTime()).toBe(
      NOW_IN_NANOS / 1e6,
    );
    expect(OneUptimeDate.fromUnixNano(String(NOW_IN_NANOS))).not.toBe(
      OneUptimeDate.fromUnixNano(String(NOW_IN_NANOS)),
    );
  });
});

describe("OneUptimeDate.toClickhouseDateTime keeps recent seconds and still writes master's text", () => {
  test("a telemetry batch's pattern: time and start time 60 s apart, many rows a second", () => {
    const start: number = Date.UTC(2026, 9, 17, 10, 0, 0, 0);

    for (let row: number = 0; row < 20000; row++) {
      const time: Date = new Date(start + Math.floor(row / 500) * 1000 + row);
      const startTime: Date = new Date(time.getTime() - 60000);

      for (const date of [time, startTime]) {
        expectSameText(
          OneUptimeDate.toClickhouseDateTime(date),
          referenceClickhouseDateTime(date),
          date.getTime(),
        );
      }
    }
  });

  test("seconds that share a slot (256 apart) never read each other's text", () => {
    const random: SeededRandom = seededRandom(256);

    for (let i: number = 0; i < 2000; i++) {
      const second: number =
        Math.floor(Date.UTC(2026, 0, 1) / 1000) + random(10000000);
      const millisecond: number = random(1000);

      // Alternate between seconds k * 256 apart, in a shuffled order.
      for (let round: number = 0; round < 3; round++) {
        for (const k of [0, 1, 0, 2, 0, 1, 3]) {
          const date: Date = new Date(
            (second + k * 256 * (round + 1)) * 1000 + millisecond,
          );
          expectSameText(
            OneUptimeDate.toClickhouseDateTime(date),
            referenceClickhouseDateTime(date),
            date.getTime(),
          );
        }
      }
    }
  });

  test("the last millisecond of a second and the first of the next are told apart", () => {
    const second: number = Date.UTC(2026, 11, 31, 23, 59, 59, 0);

    const dates: Array<Date> = [
      new Date(second),
      new Date(second + 999),
      new Date(second + 1000),
      new Date(second + 999),
      new Date(second - 1),
      new Date(second),
    ];

    for (const date of dates) {
      expect(OneUptimeDate.toClickhouseDateTime(date)).toBe(
        referenceClickhouseDateTime(date),
      );
    }

    expect(OneUptimeDate.toClickhouseDateTime(new Date(second + 1000))).toBe(
      "2027-01-01 00:00:00",
    );
  });

  test("before 1970 a millisecond keeps the second it falls in", () => {
    for (const ms of [-1, -999, -1000, -1001, -1500, -86400000, -86400001]) {
      const date: Date = new Date(ms);
      expect(OneUptimeDate.toClickhouseDateTime(date)).toBe(
        referenceClickhouseDateTime(date),
      );
      // Read twice: the kept text is the right one too.
      expect(OneUptimeDate.toClickhouseDateTime(date)).toBe(
        referenceClickhouseDateTime(date),
      );
    }

    expect(OneUptimeDate.toClickhouseDateTime(new Date(-1))).toBe(
      "1969-12-31 23:59:59",
    );
  });

  test("50,000 seeded instants across the whole Date range, each read twice, in random order", () => {
    const random: SeededRandom = seededRandom(8640);
    const dates: Array<Date> = [];

    for (let i: number = 0; i < 25000; i++) {
      dates.push(new Date(Math.floor((random() * 2 - 1) * 8.64e15)));
    }

    for (let i: number = 0; i < 50000; i++) {
      const date: Date = dates[random(dates.length)] as Date;
      expectSameText(
        OneUptimeDate.toClickhouseDateTime(date),
        referenceClickhouseDateTime(date),
        date.getTime(),
      );
    }
  });

  test("Invalid Date is still master's sentinel, and leaves no text behind", () => {
    const valid: Date = new Date(Date.UTC(2026, 9, 17, 1, 2, 3));

    expect(OneUptimeDate.toClickhouseDateTime(valid)).toBe(
      "2026-10-17 01:02:03",
    );
    expect(OneUptimeDate.toClickhouseDateTime(new Date(NaN))).toBe(
      "Invalid date",
    );
    expect(OneUptimeDate.toClickhouseDateTime(valid)).toBe(
      "2026-10-17 01:02:03",
    );
  });

  test("strings are read as before and kept by the second they name", () => {
    for (const text of [
      "2026-08-10T13:45:59.500Z",
      "2026-08-10T13:45:59.999Z",
      "2026-08-10T13:46:00.000Z",
      "2026-08-10 13:45:59",
    ]) {
      expect(OneUptimeDate.toClickhouseDateTime(text)).toBe(
        referenceClickhouseDateTime(OneUptimeDate.fromString(text)),
      );
    }
  });

  test("toClickhouseDateTime64 is master's for every nanosecond case", () => {
    const random: SeededRandom = seededRandom(64);

    for (let i: number = 0; i < 20000; i++) {
      const date: Date = new Date(
        Date.UTC(2026, 0, 1) + random(400 * 86400) * 1000 + random(1000),
      );
      const nanoCase: number = random(4);
      const nanoTimestamp: number | undefined =
        nanoCase === 0
          ? undefined
          : nanoCase === 1
            ? 0
            : nanoCase === 2
              ? -5
              : date.getTime() * 1e6 + random(1e6);

      expectSameText(
        OneUptimeDate.toClickhouseDateTime64(date, nanoTimestamp),
        referenceClickhouseDateTime64(date, nanoTimestamp),
        `${date.getTime()} / ${String(nanoTimestamp)}`,
      );
    }
  });
});

describe("Date.ts makes no BigInt as it loads", () => {
  /*
   * Every frontend bundle (Dashboard, Status Page, Accounts, Admin, public
   * dashboards) loads Date.ts, and only fromUnixNano reading an integer
   * string needs BigInt, so Date.ts makes its BigInt on first use.
   *
   * zod 4's core makes its int64 ranges with BigInt as it loads, and
   * Date.ts built its API schema with zod until the schemas moved to the
   * server (Utils/Schema/TypeSchemas). It loads no zod now, so this loads
   * the real module, with nothing stubbed.
   */
  test("a fresh copy of the module loads, formats and reads numbers without BigInt", () => {
    const globals: { BigInt?: unknown } = globalThis as unknown as {
      BigInt?: unknown;
    };
    const descriptor: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(globalThis, "BigInt");

    expect(descriptor).toBeDefined();

    delete globals.BigInt;

    try {
      expect(globals.BigInt).toBeUndefined();

      jest.isolateModules(() => {
        const fresh: typeof OneUptimeDate = (
          jest.requireActual("../../Types/Date") as {
            default: typeof OneUptimeDate;
          }
        ).default;

        expect(
          fresh.toClickhouseDateTime(new Date(Date.UTC(2026, 9, 17, 1, 2, 3))),
        ).toBe("2026-10-17 01:02:03");
        expect(fresh.fromUnixNano(NOW_IN_NANOS).getTime()).toBe(
          NOW_IN_NANOS / 1e6,
        );
        expect(fresh.fromUnixNano("1.5e18").getTime()).toBe(1.5e12);
      });
    } finally {
      Object.defineProperty(
        globalThis,
        "BigInt",
        descriptor as PropertyDescriptor,
      );
    }

    // With BigInt back, an integer string is read to the millisecond again.
    expect(OneUptimeDate.fromUnixNano("1760000000123999999").getTime()).toBe(
      1760000000123,
    );
  });
});

describe("the per-row date helpers stay moment-free", () => {
  /*
   * A moment object per call was what made these the most expensive lines of
   * a telemetry row. Hold the two bodies to plain Date work.
   */
  const source: string = fs.readFileSync(
    path.resolve(__dirname, "../../Types/Date.ts"),
    "utf8",
  );

  function bodyOf(signature: string): string {
    const start: number = source.indexOf(signature);
    expect(start).toBeGreaterThan(-1);

    const open: number = source.indexOf("{", start + signature.length);
    let depth: number = 0;

    for (let i: number = open; i < source.length; i++) {
      if (source[i] === "{") {
        depth++;
      } else if (source[i] === "}") {
        depth--;
        if (depth === 0) {
          return source.slice(open, i + 1);
        }
      }
    }

    throw new Error(`No body found for ${signature}`);
  }

  // The code of a body without its comments, which may name moment freely.
  function withoutComments(code: string): string {
    let kept: string = "";
    let i: number = 0;

    while (i < code.length) {
      if (code.startsWith("/*", i)) {
        const end: number = code.indexOf("*/", i + 2);
        i = end === -1 ? code.length : end + 2;
      } else if (code.startsWith("//", i)) {
        const end: number = code.indexOf("\n", i);
        i = end === -1 ? code.length : end;
      } else {
        kept += code[i];
        i++;
      }
    }

    return kept;
  }

  for (const signature of [
    "public static fromUnixNano(",
    "private static formatUtcClickhouseDateTime(",
  ]) {
    test(`${signature} builds no moment`, () => {
      const code: string = withoutComments(bodyOf(signature));

      expect(code.length).toBeGreaterThan(100);
      expect(code.includes("moment")).toBe(false);
      expect(code.includes("Moment")).toBe(false);
    });
  }
});

describe("speed", () => {
  test("fromUnixNano: 100,000 numbers well within a second, at least three times master's speed", () => {
    const count: number = 100000;

    // Timed in turns (fastestRunsCompared), as the batch below is by hand.
    const runs: ComparedRuns<number, number> = fastestRunsCompared({
      first: (): number => {
        let sum: number = 0;
        for (let i: number = 0; i < count; i++) {
          sum += OneUptimeDate.fromUnixNano(NOW_IN_NANOS + i * 1000).getTime();
        }
        return sum;
      },
      second: (): number => {
        let sum: number = 0;
        for (let i: number = 0; i < count; i++) {
          sum += referenceFromUnixNano(NOW_IN_NANOS + i * 1000).getTime();
        }
        return sum;
      },
    });
    const branch: FastestRun<number> = runs.first;
    const master: FastestRun<number> = runs.second;

    expect(branch.result).toBe(master.result);
    expect(branch.inMs).toBeLessThan(1000);
    // Measured 6-15 times faster; three leaves room for a noisy runner.
    expect(branch.inMs * 3).toBeLessThan(master.inMs);
  });

  test("toClickhouseDateTime: a batch's 200,000 stamps format each second once, well within a second, faster than master", () => {
    const start: number = Date.UTC(2026, 9, 17, 10, 0, 0, 0);
    const dates: Array<Date> = [];

    for (let row: number = 0; row < 100000; row++) {
      const time: number = start + Math.floor(row / 1000) * 1000 + (row % 997);
      dates.push(new Date(time), new Date(time - 60000));
    }

    const runBranch: () => number = (): number => {
      let length: number = 0;
      for (const date of dates) {
        length += OneUptimeDate.toClickhouseDateTime(date).length;
      }
      return length;
    };

    const runMaster: () => number = (): number => {
      let length: number = 0;
      for (const date of dates) {
        length += referenceClickhouseDateTime(date).length;
      }
      return length;
    };

    /*
     * Master read the six UTC fields of every stamp: 200,000 reads a run.
     * The branch's are counted in one pass of their own, before any run is
     * timed, so the count is one pass's and no timed run carries a spy.
     */
    const yearReads: { mock: { calls: Array<unknown> } } = jest.spyOn(
      Date.prototype,
      "getUTCFullYear",
    ) as unknown as { mock: { calls: Array<unknown> } };

    const counted: number = runBranch();

    /*
     * The stamps fall in 160 seconds (10:00:00-10:01:39 and the minute
     * before), each formatted once.
     */
    expect(yearReads.mock.calls.length).toBeGreaterThan(0);
    expect(yearReads.mock.calls.length).toBeLessThanOrEqual(160);

    jest.restoreAllMocks();

    /*
     * Then the two in turn, five rounds, each keeping its fastest. The batch
     * of 200,000 Dates is built just before: a collection it leaves behind,
     * or a busy moment on the runner, now falls on both alike rather than on
     * whichever was measured first (the branch's three runs, then master's).
     */
    let branchMs: number = Number.POSITIVE_INFINITY;
    let masterMs: number = Number.POSITIVE_INFINITY;
    let branchLength: number = 0;
    let masterLength: number = 0;

    for (let round: number = 0; round < 5; round++) {
      let startedAt: number = performance.now();
      branchLength = runBranch();
      branchMs = Math.min(branchMs, performance.now() - startedAt);

      startedAt = performance.now();
      masterLength = runMaster();
      masterMs = Math.min(masterMs, performance.now() - startedAt);
    }

    expect(branchLength).toBe(counted);
    expect(branchLength).toBe(masterLength);
    expect(branchMs).toBeLessThan(1000);
    /*
     * Measured 3-25 times faster (about 3.5 under jest, where master's
     * formatter is quick too); the field reads counted above are what pins
     * the memo, and one and a half leaves room for a noisy runner.
     */
    expect(branchMs * 1.5).toBeLessThan(masterMs);
  });
});
