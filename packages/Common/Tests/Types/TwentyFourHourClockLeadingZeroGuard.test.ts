// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import {
  findNumericHoursOffATwelveHourClock,
  NUMERIC_HOUR,
  readScannedSources,
} from "../Helpers/IntlHourScan";

/*
 * A NUMERIC HOUR IS ASKED OF INTL ONLY ON A 12-HOUR CLOCK.
 *
 * A 24-hour time keeps its leading zero: "05:14", as a table's dates, their
 * tooltips, the time range button and an on-call shift write it. Asked for
 * hour "numeric" on a 24-hour clock, Intl drops the zero in German, French,
 * Spanish, Japanese, Chinese, Russian, Swedish and British English ("5:14"),
 * Persian ("۵:۱۴") and Danish ("5.14"), and keeps it in US English, Korean,
 * Arabic and Hindi. So a German reader read "5:14" in an incident's feed and
 * its status timeline, an upcoming shift and a backup's times, beside a
 * table's "05:14" (issue #7649).
 *
 * An Intl options object that asks for a numeric hour pins a 12-hour clock
 * in the same object (hour12: true, or hourCycle "h11" or "h12"). A time on
 * the reader's clock asks getHourOption for its hour - which gives
 * "numeric" on a 12-hour clock and "2-digit" on a 24-hour one - and every
 * time is on the reader's clock since #7651 (Common/Types/DateLanguage);
 * the mobile app asks its own getHourOption (MobileApp/src/utils/date). The rule written out by hand (twelveHour ?
 * "numeric" : "2-digit") is asked of getHourOption too, so it is kept in
 * one place. An object read only for the clock it resolves
 * (`{ hour: "numeric" }).resolvedOptions()`) writes no time.
 *
 * Its twin, TwelveHourClockLeadingZeroGuard, keeps the zero off a 12-hour
 * time. Both read the front ends listed in Helpers/IntlHourScan.
 */

describe("a numeric hour is asked for only on a 12-hour clock", () => {
  test("no product code asks Intl for a numeric hour on a 24-hour clock", () => {
    const found: Array<string> = [];
    let numericHours: number = 0;

    for (const source of readScannedSources()) {
      numericHours += Array.from(source.text.matchAll(NUMERIC_HOUR)).length;
      found.push(
        ...findNumericHoursOffATwelveHourClock(source.file, source.text),
      );
    }

    /*
     * The sweep reads the product's files: the 12-hour patterns (Date's
     * "h:mm A", a clock widget's day period, working hours on a 12-hour
     * clock) and the clock probes ask for a numeric hour.
     */
    expect(numericHours).toBeGreaterThanOrEqual(5);
    expect(found).toEqual([]);
  });

  test.each<[string, number]>([
    // The issue's form: a numeric hour on whatever clock the reader keeps.
    ['{ hour: "numeric", minute: "2-digit", hour12: clock.use12HourClock }', 1],
    ["{ hour: 'numeric', minute: '2-digit', hour12: use12HourFormat }", 1],
    // A pinned 24-hour clock: "5:14" in German.
    ['{ hour: "numeric", minute: "2-digit", hour12: false }', 1],
    ['{ hour: "numeric", minute: "2-digit", hourCycle: "h23" }', 1],
    ["{ hourCycle: 'h24', hour: 'numeric' }", 1],
    // No clock at all: the language's own, "5:14" in German.
    [
      'new Date(time).toLocaleString(locale, {\n  year: "numeric",\n  hour: "numeric",\n  minute: "2-digit",\n})',
      1,
    ],
    ['options.hour = "numeric";', 1],
    // The rule written out by hand, rather than asked of getHourOption.
    [
      '{ hour: use12HourClock ? "numeric" : "2-digit", hour12: use12HourClock }',
      1,
    ],
    ["{ hour: twelve ? '2-digit' : 'numeric' }", 1],
    // A pinned 12-hour clock drops the zero: "5:14 AM", "오전 5:14".
    ['{ hour: "numeric", minute: "2-digit", hour12: true }', 0],
    ['{ hour: "numeric", hourCycle: "h12" }', 0],
    ["{ hourCycle: 'h11', hour: 'numeric' }", 0],
    ['{ timeZone, hour12: true, nested: { a: 1 }, hour: "numeric" }', 0],
    // A probe of a clock, which writes no time.
    [
      'new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hour12',
      0,
    ],
    [
      'new Intl.DateTimeFormat(undefined, {\n  hour: "numeric",\n}).resolvedOptions()',
      0,
    ],
    // The helpers, and a type that names the hour among others.
    ["{ hour: getHourOption(clock.use12HourClock), hour12: x }", 0],
    ["{ hour: getHourOption(twelveHour), minute: '2-digit' }", 0],
    ['let hour: "numeric" | "2-digit" = "2-digit";', 0],
    ['const hour: "numeric" | "2-digit" = getHourOption(twelveHour);', 0],
    // A year, a day or a minute is not an hour.
    ['{ year: "numeric", day: "numeric", minute: "2-digit" }', 0],
    ['{ day: twoDigit ? "2-digit" : "numeric" }', 0],
  ])("finds %p %p time(s)", (source: string, count: number) => {
    expect(
      findNumericHoursOffATwelveHourClock("Example.ts", source),
    ).toHaveLength(count);
  });

  test("each object is judged by its own clock, not a neighbour's", () => {
    expect(
      findNumericHoursOffATwelveHourClock(
        "Example.ts",
        [
          'const a = { hour: "numeric", hour12: true };',
          'const b = { hour: "numeric", minute: "2-digit", hour12: twelve };',
        ].join("\n"),
      ),
    ).toEqual([
      'Example.ts:2 { hour: "numeric", minute: "2-digit", hour12: twelve }',
    ]);
  });

  test("a probe is a probe only when the object is read for its clock", () => {
    expect(
      findNumericHoursOffATwelveHourClock(
        "Example.ts",
        [
          'new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions();',
          'new Intl.DateTimeFormat(locale, { hour: "numeric" }).format(date);',
        ].join("\n"),
      ),
    ).toEqual(['Example.ts:2 { hour: "numeric" }']);
  });

  test("the writers #7649 named, as they were, are refused", () => {
    // FeedTime's formatFeedTime and UpcomingShiftTime's, before the fix.
    const before: string = [
      "const format = getDateTimeFormat({",
      "  locale: getFeedLocale(clock.language),",
      '  shape: clock.use12HourClock ? "time-12" : "time-24",',
      "  options: {",
      '    hour: "numeric",',
      '    minute: "2-digit",',
      "    hour12: clock.use12HourClock,",
      "  },",
      "});",
    ].join("\n");

    expect(findNumericHoursOffATwelveHourClock("FeedTime.ts", before)).toEqual([
      'FeedTime.ts:5 { hour: "numeric", minute: "2-digit", hour12: clock.use12HourClock, }',
    ]);
    expect(
      findNumericHoursOffATwelveHourClock(
        "FeedTime.ts",
        before.replace(
          'hour: "numeric"',
          "hour: getHourOption(clock.use12HourClock)",
        ),
      ),
    ).toEqual([]);
  });
});
