/** @timezone America/New_York */

import OneUptimeDate from "../../Types/Date";
import moment from "moment-timezone";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";
import {
  ComparedRuns,
  FastestRun,
  fastestRunsCompared,
} from "../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * OneUptimeDate.fromString reads a ClickHouse DateTime or DateTime64 -
 * "2026-11-17 10:04:00", "2026-11-17 10:04:00.123456789", always UTC -
 * straight from its digits instead of through moment (issue #10108). Every
 * row an aggregate read returns has its bucket read so: a grouped metric
 * monitor's four reads over 16,000 series are 160,000 of them an
 * evaluation, and moment's parse took 1.1 of its seconds.
 *
 * It must give exactly what it gave before, for every input. The reference
 * below is master's branch of fromString for these strings, verbatim, and
 * every test compares against it: valid times, every boundary of a month and
 * a leap year, every length of fraction, and what moment reads in its own
 * way (hour 24, a leap second, a day past the month's end, a year before
 * 1000), which still goes to moment.
 *
 * Run in a non-UTC zone with daylight saving: the strings are UTC, and a
 * slip to local time would show here.
 */

// Master's normalizeUtcDateTimeString, verbatim.
function referenceNormalize(value: string): string {
  const trimmedValue: string = value.trim();
  const [datePart, timePart] = trimmedValue.split(" ");

  if (!datePart || !timePart) {
    return trimmedValue;
  }

  const [baseTime, fractionalPart] = timePart.split(".");

  if (!fractionalPart) {
    return `${datePart}T${baseTime}Z`;
  }

  const milliseconds: string = fractionalPart.slice(0, 3).padEnd(3, "0");
  return `${datePart}T${baseTime}.${milliseconds}Z`;
}

// Master's fromString of a ClickHouse time, verbatim.
function referenceFromString(value: string): Date {
  return moment.utc(referenceNormalize(value.trim())).toDate();
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function clickhouseTime(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  fraction?: string | undefined;
}): string {
  const base: string = `${pad(input.year, 4)}-${pad(input.month, 2)}-${pad(input.day, 2)} ${pad(input.hour, 2)}:${pad(input.minute, 2)}:${pad(input.second, 2)}`;
  return input.fraction ? `${base}.${input.fraction}` : base;
}

function expectSameAsMaster(value: string): void {
  const read: Date = OneUptimeDate.fromString(value);
  const master: Date = referenceFromString(value);

  expect({ value: value, time: read.getTime() }).toEqual({
    value: value,
    time: master.getTime(),
  });
}

describe("the zone this suite runs in", () => {
  test("is America/New_York", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "America/New_York",
    );
  });
});

describe("OneUptimeDate.fromString reads a ClickHouse time as master did", () => {
  test("a bucket time a grouped read returns", () => {
    expect(
      OneUptimeDate.fromString("2026-11-17 10:04:00.000000000").toISOString(),
    ).toBe("2026-11-17T10:04:00.000Z");
    expect(OneUptimeDate.fromString("2026-11-17 10:04:00").toISOString()).toBe(
      "2026-11-17T10:04:00.000Z",
    );
    expectSameAsMaster("2026-11-17 10:04:00.000000000");
  });

  test("every length of fraction, cut to milliseconds", () => {
    for (let digits: number = 1; digits <= 9; digits++) {
      const fraction: string = "987654321".slice(0, digits);
      const value: string = `2026-04-01 14:45:31.${fraction}`;

      expectSameAsMaster(value);
      expectSameAsMaster(`  ${value}  `);
    }

    expect(
      OneUptimeDate.fromString("2026-04-01 14:45:31.4").toISOString(),
    ).toBe("2026-04-01T14:45:31.400Z");
    expect(
      OneUptimeDate.fromString("2026-04-01 14:45:31.414999999").toISOString(),
    ).toBe("2026-04-01T14:45:31.414Z");
  });

  test("every boundary of a month and of a leap year", () => {
    const cases: Array<string> = [
      "2024-02-29 23:59:59",
      "2023-02-28 23:59:59",
      "2000-02-29 00:00:00",
      "2026-01-31 12:00:00",
      "2026-04-30 12:00:00",
      "2026-12-31 23:59:59.999",
      "2027-01-01 00:00:00",
      "1970-01-01 00:00:00",
      "1000-01-01 00:00:00",
      "9999-12-31 23:59:59.999999999",
      // DST changes in the suite's zone: nothing of local time may leak in.
      "2026-03-08 07:00:00",
      "2026-11-01 06:00:00",
    ];

    for (const value of cases) {
      expectSameAsMaster(value);
    }
  });

  test("what moment reads its own way is still read by moment", () => {
    const cases: Array<string> = [
      // Days past the month's end, a February 29 of a common year.
      "2023-02-29 00:00:00",
      "1900-02-29 00:00:00",
      "2026-04-31 10:00:00",
      "2026-02-30 10:00:00",
      // Months and days out of range.
      "2026-00-10 10:00:00",
      "2026-13-10 10:00:00",
      "2026-01-00 10:00:00",
      "2026-01-32 10:00:00",
      // Hour 24, minute 60, a leap second.
      "2026-01-01 24:00:00",
      "2026-01-01 24:00:00.000",
      "2026-01-01 23:60:00",
      "2026-12-31 23:59:60",
      // Years before 1000.
      "0999-12-31 23:59:59",
      "0050-06-15 12:00:00",
      "0000-01-01 00:00:00",
    ];

    for (const value of cases) {
      expectSameAsMaster(value);
    }
  });

  test("50,000 random times, valid or not, are read as master read them", () => {
    const random: SeededRandom = seededRandom(10108);

    for (let index: number = 0; index < 50_000; index++) {
      const fractionDigits: number = random(10);
      let fraction: string = "";

      for (let digit: number = 0; digit < fractionDigits; digit++) {
        fraction += String(random(10));
      }

      expectSameAsMaster(
        clickhouseTime({
          year: random(3) === 0 ? random(10_000) : 1900 + random(400),
          month: random(14),
          day: random(33),
          hour: random(26),
          minute: random(62),
          second: random(62),
          fraction: fraction || undefined,
        }),
      );
    }
  });

  test("other strings are read as before", () => {
    const cases: Array<string> = [
      "2026-11-17T10:04:00.000Z",
      "2026-11-17T10:04:00Z",
      "2026-11-17",
      "2026-11-17 10:04",
    ];

    for (const value of cases) {
      expect(OneUptimeDate.fromString(value).getTime()).toBe(
        moment(value.trim()).toDate().getTime(),
      );
    }
  });

  test("is several times faster than moment on a read's rows", () => {
    const random: SeededRandom = seededRandom(31);
    const values: Array<string> = [];

    for (let index: number = 0; index < 40_000; index++) {
      values.push(
        clickhouseTime({
          year: 2026,
          month: 1 + random(12),
          day: 1 + random(28),
          hour: random(24),
          minute: random(60),
          second: 0,
          fraction: "000000000",
        }),
      );
    }

    const runs: ComparedRuns<number, number> = fastestRunsCompared({
      first: (): number => {
        let sum: number = 0;
        for (const value of values) {
          sum += OneUptimeDate.fromString(value).getTime();
        }
        return sum;
      },
      second: (): number => {
        let sum: number = 0;
        for (const value of values) {
          sum += referenceFromString(value).getTime();
        }
        return sum;
      },
    });
    const branch: FastestRun<number> = runs.first;
    const master: FastestRun<number> = runs.second;

    expect(branch.result).toBe(master.result);
    // Measured about 15 times faster; three leaves room for a noisy runner.
    expect(branch.inMs * 3).toBeLessThan(master.inMs);
  });
});
