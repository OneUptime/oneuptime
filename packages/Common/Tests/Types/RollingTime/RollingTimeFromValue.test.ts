import InBetween from "../../../Types/BaseDatabase/InBetween";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * A ROLLING TIME WRITTEN ANOTHER WAY IS READ AS THE ONE IT MEANS.
 *
 * A Metrics monitor created through the MCP server stored its rolling time
 * as "15 minutes". Nothing read that: convertToStartAndEndDate matched it
 * against each rolling time in turn, matched none, and returned a window
 * from now to now. Every check of the monitor read no data, its no-data
 * rule opened an alert on every run, and its charts showed nothing on one
 * page and data on another (the form charted a window of at least a
 * minute, the overview the window of no length).
 *
 * RollingTimeUtil.fromValue reads the ways a person, an API client or an
 * AI writes a length - and nothing else - and every window a rolling time
 * gives is now at least the default's.
 */

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
const WEEK: number = 7 * DAY;

const END: Date = new Date("2026-11-10T16:19:23.977Z");

// How long each rolling time's window is, written out once more here.
const LENGTH_OF: Record<RollingTime, number> = {
  [RollingTime.Past1Minute]: MINUTE,
  [RollingTime.Past5Minutes]: 5 * MINUTE,
  [RollingTime.Past10Minutes]: 10 * MINUTE,
  [RollingTime.Past15Minutes]: 15 * MINUTE,
  [RollingTime.Past30Minutes]: 30 * MINUTE,
  [RollingTime.Past1Hour]: HOUR,
  [RollingTime.Past2Hours]: 2 * HOUR,
  [RollingTime.Past3Hours]: 3 * HOUR,
  [RollingTime.Past6Hours]: 6 * HOUR,
  [RollingTime.Past12Hours]: 12 * HOUR,
  [RollingTime.Past1Hours]: DAY,
  [RollingTime.Past2Days]: 2 * DAY,
  [RollingTime.Past3Days]: 3 * DAY,
  [RollingTime.Past7Days]: WEEK,
  [RollingTime.Past14Days]: 2 * WEEK,
  [RollingTime.Past30Days]: 30 * DAY,
  [RollingTime.Past60Days]: 60 * DAY,
  [RollingTime.Past90Days]: 90 * DAY,
  [RollingTime.Past180Days]: 180 * DAY,
  [RollingTime.Past365Days]: 365 * DAY,
};

const ROLLING_TIMES: Array<RollingTime> = Object.values(RollingTime);

const windowLengthOf: (rollingTime: unknown) => number = (
  rollingTime: unknown,
): number => {
  const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
    rollingTime as RollingTime,
    END,
  );

  return window.endValue.getTime() - window.startValue.getTime();
};

/*
 * Every way this writes a length exactly as long as `lengthInMs`: in each
 * unit it divides into whole, short and long, with and without "past" or
 * "last", and as an ISO 8601 duration.
 */
const writtenLengths: (lengthInMs: number) => Array<string> = (
  lengthInMs: number,
): Array<string> => {
  const units: Array<{
    inMs: number;
    names: Array<string>;
    iso: (count: number) => string;
  }> = [
    {
      inMs: SECOND,
      names: ["s", "sec", "secs", "second", "seconds"],
      iso: (count: number): string => {
        return `PT${count}S`;
      },
    },
    {
      inMs: MINUTE,
      names: ["m", "min", "mins", "minute", "minutes"],
      iso: (count: number): string => {
        return `PT${count}M`;
      },
    },
    {
      inMs: HOUR,
      names: ["h", "hr", "hrs", "hour", "hours"],
      iso: (count: number): string => {
        return `PT${count}H`;
      },
    },
    {
      inMs: DAY,
      names: ["d", "day", "days"],
      iso: (count: number): string => {
        return `P${count}D`;
      },
    },
    {
      inMs: WEEK,
      names: ["w", "wk", "wks", "week", "weeks"],
      iso: (count: number): string => {
        return `P${count}W`;
      },
    },
  ];

  const written: Array<string> = [];

  for (const unit of units) {
    if (lengthInMs % unit.inMs !== 0) {
      continue;
    }

    const count: number = lengthInMs / unit.inMs;

    written.push(unit.iso(count), unit.iso(count).toLowerCase());

    for (const name of unit.names) {
      for (const lookBack of ["", "past ", "last ", "Previous ", "LAST "]) {
        written.push(`${lookBack}${count} ${name}`);
        written.push(`${lookBack}${count}${name}`);
      }
    }
  }

  return written;
};

describe("RollingTimeUtil.fromValue", () => {
  test.each(ROLLING_TIMES)(
    "reads %s as itself, however it is cased and spaced",
    (rollingTime: RollingTime) => {
      const spellings: Array<string> = [
        rollingTime,
        rollingTime.toLowerCase(),
        rollingTime.toUpperCase(),
        `  ${rollingTime}  `,
        rollingTime.replace(/ /g, "  "),
        rollingTime.replace(/ /g, "_"),
        rollingTime.replace(/ /g, "-"),
        rollingTime.replace(/ /g, "_").toUpperCase(),
        rollingTime.replace(/ /g, ""),
        rollingTime.replace(/^Past/, "Last"),
        rollingTime.replace(/^Past/, "previous"),
        rollingTime.replace(/^Past /, ""),
        rollingTime.replace(/^Past\t/, "Past\t"),
      ];

      for (const spelling of spellings) {
        expect({
          spelling: spelling,
          reads: RollingTimeUtil.fromValue(spelling),
        }).toEqual({ spelling: spelling, reads: rollingTime });
      }
    },
  );

  test("reads the rolling time the customer's monitor stored", () => {
    expect(RollingTimeUtil.fromValue("15 minutes")).toBe(
      RollingTime.Past15Minutes,
    );
  });

  test.each(ROLLING_TIMES)(
    "reads every way of writing %s's length as it",
    (rollingTime: RollingTime) => {
      const written: Array<string> = writtenLengths(LENGTH_OF[rollingTime]);

      // Every rolling time can be written at least in seconds and minutes.
      expect(written.length).toBeGreaterThanOrEqual(2 * 2 * 5 * 5);

      for (const length of written) {
        expect({
          length: length,
          reads: RollingTimeUtil.fromValue(length),
        }).toEqual({ length: length, reads: rollingTime });
      }
    },
  );

  test.each([
    ["15m", RollingTime.Past15Minutes],
    ["15 mins", RollingTime.Past15Minutes],
    ["Last 15 Minutes", RollingTime.Past15Minutes],
    ["past_15_minutes", RollingTime.Past15Minutes],
    ["PAST_15_MINUTES", RollingTime.Past15Minutes],
    ["Past15Minutes", RollingTime.Past15Minutes],
    ["15-minute", RollingTime.Past15Minutes],
    ["PT15M", RollingTime.Past15Minutes],
    ["pt900s", RollingTime.Past15Minutes],
    ["0.25 hours", RollingTime.Past15Minutes],
    ["60 minutes", RollingTime.Past1Hour],
    ["1h", RollingTime.Past1Hour],
    ["past hour", RollingTime.Past1Hour],
    ["Last Hour", RollingTime.Past1Hour],
    ["24 hours", RollingTime.Past1Hours],
    ["1 day", RollingTime.Past1Hours],
    ["last day", RollingTime.Past1Hours],
    ["P1D", RollingTime.Past1Hours],
    ["PT24H", RollingTime.Past1Hours],
    ["P1DT0H0M0S", RollingTime.Past1Hours],
    ["48h", RollingTime.Past2Days],
    ["1 week", RollingTime.Past7Days],
    ["past week", RollingTime.Past7Days],
    ["P1W", RollingTime.Past7Days],
    ["2 weeks", RollingTime.Past14Days],
    ["P1W7D", RollingTime.Past14Days],
    ["past minute", RollingTime.Past1Minute],
    ["60s", RollingTime.Past1Minute],
    ["31536000 seconds", RollingTime.Past365Days],
  ])("reads %j as %s", (written: string, rollingTime: RollingTime) => {
    expect(RollingTimeUtil.fromValue(written)).toBe(rollingTime);
  });

  test.each([
    // A length no rolling time is as long as.
    "20 minutes",
    "45m",
    "4 hours",
    "PT90M",
    "1.5 days",
    "0 minutes",
    "PT0S",
    // A month or a year has no fixed length.
    "1 month",
    "1 year",
    "P1M",
    "P1Y",
    // A number with no unit, and a unit with no number.
    "15",
    "900",
    "minutes",
    "hour",
    "past",
    "last",
    "past h",
    "past minutes",
    "P",
    "PT",
    // Not a length at all.
    "",
    "   ",
    "fifteen minutes",
    "15 minutes ago",
    "15 minutess",
    "15 fortnights",
    "Past 15 Minutes!",
    "15 minutes; DROP TABLE",
    "1h30m",
    "P1DT",
    "1..5 hours",
    "Past 15 Minutes of fame",
    /*
     * The enum's key name for Past 1 Day, whose words say an hour: which
     * of the two the writer meant is not for OneUptime to guess.
     */
    "Past1Hours",
    "past1hours",
  ])("reads %j as no rolling time", (written: string) => {
    expect(RollingTimeUtil.fromValue(written)).toBeNull();
  });

  test.each([
    15,
    900,
    0,
    Number.NaN,
    null,
    undefined,
    true,
    {},
    { rollingTime: RollingTime.Past15Minutes },
    [RollingTime.Past15Minutes],
  ])("reads %p, which is not text, as no rolling time", (value: unknown) => {
    expect(RollingTimeUtil.fromValue(value)).toBeNull();
  });

  test("reads a text longer than any length as none, without matching it", () => {
    expect(RollingTimeUtil.fromValue(`${"0".repeat(64)}15 minutes`)).toBeNull();
    expect(RollingTimeUtil.fromValue(`Past ${"1".repeat(70)} Minutes`)).toBe(
      null,
    );
  });

  /*
   * A rolling time is written by whoever writes a monitor's steps, so it
   * is read in time in line with its length: a long one is never handed to
   * a pattern at all, and the patterns are bounded and anchored.
   */
  test("reads 400,000 characters of the patterns' worst cases in time", () => {
    const worstCases: Array<string> = [
      `past ${"1".repeat(400_000)}`,
      `${" ".repeat(200_000)}15 minutes${" ".repeat(200_000)}`,
      `${"-_ ".repeat(133_333)}m`,
      `p${"1w".repeat(200_000)}`,
      `pt${"1".repeat(399_998)}`,
    ];

    for (const worstCase of worstCases) {
      const read: FastestRun<RollingTime | null> = fastestRun({
        run: (): RollingTime | null => {
          return RollingTimeUtil.fromValue(worstCase);
        },
        limitInMs: 2000,
      });

      expect(read.inMs).toBeLessThan(2000);
    }

    // A text of spaces around a length is the length.
    expect(
      RollingTimeUtil.fromValue(
        `${" ".repeat(200_000)}15 minutes${" ".repeat(200_000)}`,
      ),
    ).toBe(RollingTime.Past15Minutes);
  });

  /*
   * Texts of the pieces a length is written with: whatever they read as,
   * they read the same in any case and with any separator, a rolling time
   * reads as itself again, and a window is never of no length.
   */
  test("reads generated texts of a length's pieces consistently", () => {
    const pieces: Array<string> = [
      "past",
      "last",
      " ",
      "_",
      "-",
      "1",
      "5",
      "15",
      "24",
      ".",
      "minutes",
      "minute",
      "m",
      "h",
      "hours",
      "day",
      "d",
      "w",
      "s",
      "P",
      "T",
      "D",
      "M",
      "x",
    ];
    const texts: Array<string> = generatedTexts(20000, 2826, pieces, 8);
    let readAsRollingTime: number = 0;

    for (const text of texts) {
      const read: RollingTime | null = RollingTimeUtil.fromValue(text);

      if (read !== null) {
        readAsRollingTime++;
        expect(ROLLING_TIMES).toContain(read);
        expect(RollingTimeUtil.fromValue(read)).toBe(read);
      }

      expect({
        text,
        read: RollingTimeUtil.fromValue(text.toUpperCase()),
      }).toEqual({ text, read });
      expect({
        text,
        read: RollingTimeUtil.fromValue(text.replace(/[ -]/g, "_")),
      }).toEqual({ text, read });

      expect(windowLengthOf(text)).toBe(
        LENGTH_OF[read || RollingTime.Past1Minute],
      );
    }

    // The pieces make lengths too, not only texts that are none.
    expect(readAsRollingTime).toBeGreaterThan(100);
  });
});

describe("RollingTimeUtil.isRollingTime", () => {
  test("is true only of a rolling time as OneUptime writes it", () => {
    for (const rollingTime of ROLLING_TIMES) {
      expect(RollingTimeUtil.isRollingTime(rollingTime)).toBe(true);
      expect(RollingTimeUtil.isRollingTime(rollingTime.toLowerCase())).toBe(
        false,
      );
    }

    expect(RollingTimeUtil.isRollingTime("15 minutes")).toBe(false);
    expect(RollingTimeUtil.isRollingTime(undefined)).toBe(false);
  });
});

describe("RollingTimeUtil.fromWindowInMs", () => {
  test.each(ROLLING_TIMES)(
    "reads %s's window as it",
    (rollingTime: RollingTime) => {
      expect(RollingTimeUtil.fromWindowInMs(LENGTH_OF[rollingTime])).toBe(
        rollingTime,
      );
    },
  );

  test.each([0, -MINUTE, 20 * MINUTE, MINUTE + 1, Number.NaN, Infinity])(
    "reads %p as no rolling time",
    (windowInMs: number) => {
      expect(RollingTimeUtil.fromWindowInMs(windowInMs)).toBeNull();
    },
  );
});

describe("RollingTimeUtil.fromValueOrDefault", () => {
  test("reads a rolling time written any way as it, and anything else as the default", () => {
    expect(RollingTimeUtil.fromValueOrDefault("15 minutes")).toBe(
      RollingTime.Past15Minutes,
    );
    expect(RollingTimeUtil.fromValueOrDefault(RollingTime.Past7Days)).toBe(
      RollingTime.Past7Days,
    );

    for (const value of [undefined, null, "", "fortnight", "20 minutes", 15]) {
      expect(RollingTimeUtil.fromValueOrDefault(value)).toBe(
        RollingTimeUtil.getDefault(),
      );
    }
  });
});

describe("RollingTimeUtil.getValuesText", () => {
  test("lists every rolling time, quoted, in order", () => {
    const text: string = RollingTimeUtil.getValuesText();

    expect(text.startsWith('"Past 1 Minute", "Past 5 Minutes", ')).toBe(true);
    expect(text.endsWith(', "Past 180 Days" or "Past 365 Days"')).toBe(true);

    let from: number = 0;

    for (const rollingTime of ROLLING_TIMES) {
      const at: number = text.indexOf(`"${rollingTime}"`, from);

      expect({ rollingTime, listed: at >= 0 }).toEqual({
        rollingTime,
        listed: true,
      });
      from = at;
    }
  });
});

describe("a window is never of no length", () => {
  test.each(ROLLING_TIMES)(
    "%s covers its length, ending where asked",
    (rollingTime: RollingTime) => {
      const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
        rollingTime,
        END,
      );

      expect(window.endValue).toBe(END);
      expect(window.endValue.getTime() - window.startValue.getTime()).toBe(
        LENGTH_OF[rollingTime],
      );
      expect(RollingTimeUtil.getWindowInMs(rollingTime)).toBe(
        LENGTH_OF[rollingTime],
      );
    },
  );

  test("a rolling time written another way covers the window it means", () => {
    expect(windowLengthOf("15 minutes")).toBe(15 * MINUTE);
    expect(windowLengthOf("PT1H")).toBe(HOUR);
    expect(windowLengthOf("last 7 days")).toBe(WEEK);
    expect(RollingTimeUtil.getWindowInMs("15 minutes" as RollingTime)).toBe(
      15 * MINUTE,
    );
  });

  test.each(["fortnight", "20 minutes", "", undefined, null, 15, "Past1Hours"])(
    "%p, which means no rolling time, covers the default's window",
    (value: unknown) => {
      expect(windowLengthOf(value)).toBe(MINUTE);
      expect(RollingTimeUtil.getWindowInMs(value as RollingTime)).toBe(MINUTE);
    },
  );

  test("a window ending now ends now", () => {
    const before: number = Date.now();
    const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
      "15 minutes" as RollingTime,
    );
    const after: number = Date.now();

    expect(window.endValue.getTime()).toBeGreaterThanOrEqual(before);
    expect(window.endValue.getTime()).toBeLessThanOrEqual(after);
    expect(window.endValue.getTime() - window.startValue.getTime()).toBe(
      15 * MINUTE,
    );
  });
});
