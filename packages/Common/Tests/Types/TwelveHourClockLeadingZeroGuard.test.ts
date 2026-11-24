// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import {
  findTwoDigitHoursOnAnyClock,
  readScannedSources,
  ScannedSource,
  TWO_DIGIT_HOUR,
} from "../Helpers/IntlHourScan";

/*
 * A TWO-DIGIT HOUR IS ASKED OF INTL ONLY ON A 24-HOUR CLOCK.
 *
 * A 12-hour time has no leading zero in any language: "5:14 AM", "오전
 * 5:14", "上午5:14", "5:14 am", "5:14 ص". Intl writes the zero wherever it
 * is asked for hour "2-digit", whatever the clock, so every localized date
 * on a 12-hour clock read "오전 05:14" (issue #7279), and the mobile app
 * "Nov 5, 05:14 AM" (#7650). An Intl options object that asks for a
 * two-digit hour pins a 24-hour clock in the same object (hour12: false, or
 * hourCycle "h23" or "h24"); a time asks getHourOption with the reader's
 * clock (Common/Types/DateLanguage) - a calendar's grid and a chart's axis
 * too, which followed their language's own clock until #7651. The mobile
 * app asks its own getHourOption (MobileApp/src/utils/date).
 *
 * Its twin, TwentyFourHourClockLeadingZeroGuard, keeps the zero of a
 * 24-hour time. Both read the front ends listed in Helpers/IntlHourScan.
 */

// A test, a test's setup or a dependency: not what the product writes.
const NOT_PRODUCT_CODE: RegExp =
  /\.(test|spec)\.tsx?$|\/__tests__\/|\/node_modules\//;

describe("a two-digit hour is asked for only on a 24-hour clock", () => {
  test("no product code asks Intl for a two-digit hour on a 12-hour clock", () => {
    const found: Array<string> = [];
    let twoDigitHours: number = 0;

    for (const source of readScannedSources()) {
      twoDigitHours += Array.from(source.text.matchAll(TWO_DIGIT_HOUR)).length;
      found.push(...findTwoDigitHoursOnAnyClock(source.file, source.text));
    }

    /*
     * The sweep reads the product's files: the 24-hour patterns (Date's
     * "HH:mm", a cron's next run, the zone probes) ask for two digits.
     */
    expect(twoDigitHours).toBeGreaterThanOrEqual(3);
    expect(found).toEqual([]);
  });

  test("the sweep reads every front end, the mobile app too, and no tests", () => {
    const files: Array<string> = readScannedSources().map(
      (source: ScannedSource): string => {
        return source.file;
      },
    );

    expect(files).toEqual(
      expect.arrayContaining([
        "packages/Common/Types/DateLanguage.ts",
        "packages/Common/UI/Components/Feed/FeedTime.ts",
        "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftTime.ts",
        // Which asked for two digits on every clock (#7650).
        "packages/MobileApp/src/utils/date.ts",
        "packages/MobileApp/src/components/MonitorSummaryView.tsx",
      ]),
    );
    expect(
      files.filter((file: string): boolean => {
        return NOT_PRODUCT_CODE.test(file);
      }),
    ).toEqual([]);
  });

  test.each<[string, number]>([
    // The issue's form: two digits on whatever clock the reader keeps.
    ["{ hour: '2-digit', minute: '2-digit', hour12: use12HourFormat }", 1],
    ['{ hour: "2-digit", minute: "2-digit", hour12: true }', 1],
    // The language's own clock: "오전 05:14" in Korean.
    [
      'date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })',
      1,
    ],
    ['new Intl.DateTimeFormat(locale, {\n  hour: "2-digit",\n})', 1],
    ['{ hour: "2-digit", hourCycle: "h12" }', 1],
    ['options.hour = "2-digit";', 1],
    // The mobile app's form before #7650: the phone's own clock.
    [
      'date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })',
      1,
    ],
    // A pinned 24-hour clock keeps its zero: "05:14".
    ['{ hour: "2-digit", minute: "2-digit", hour12: false }', 0],
    ['{ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }', 0],
    ["{ hourCycle: 'h24', hour: '2-digit' }", 0],
    ['{ timeZone, hour12: false, nested: { a: 1 }, hour: "2-digit" }', 0],
    // A numeric hour, or one asked of the helpers.
    ['{ hour: "numeric", minute: "2-digit", hour12: true }', 0],
    ["{ hour: getHourOption(use12HourFormat), minute: '2-digit' }", 0],
    ["{ hour: getHourOption(twelveHour), minute: '2-digit' }", 0],
    ["options.hour = getHourOption(shape.use12HourFormat);", 0],
    // Two-digit minutes and seconds are not hours.
    ['{ minute: "2-digit", second: "2-digit" }', 0],
  ])("finds %p %p time(s)", (source: string, count: number) => {
    expect(findTwoDigitHoursOnAnyClock("Example.ts", source)).toHaveLength(
      count,
    );
  });

  test("each object is judged by its own clock, not a neighbour's", () => {
    expect(
      findTwoDigitHoursOnAnyClock(
        "Example.ts",
        [
          'const a = { hour: "2-digit", hour12: false };',
          'const b = { hour: "2-digit", minute: "2-digit" };',
        ].join("\n"),
      ),
    ).toEqual(['Example.ts:2 { hour: "2-digit", minute: "2-digit" }']);
  });
});
