import {
  formatDateTime,
  formatShortDateTime,
  getHourOption,
  uses12HourClock,
  writeDateTime,
} from "./date";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ONE WAY TO WRITE A TIME, ON A 12-HOUR PHONE AND ON A 24-HOUR ONE (#7650).
 *
 * The app asked Intl for a two-digit hour on every clock, and Intl writes
 * the zero wherever it is asked for one: a 12-hour phone read "Nov 5, 05:14
 * AM" in English, "11월 5일 오전 05:14" in Korean and "5 نوفمبر، 05:14 ص"
 * in Arabic, on every detail screen's Created row and a monitor's last
 * check. No language writes a 12-hour time so ("5:14 AM", "오전 5:14",
 * "5:14 ص"); the zero belongs to a 24-hour time ("05:14"). The hour follows
 * the phone's clock now: "numeric" on a 12-hour one, "2-digit" on a 24-hour
 * one, as the web Dashboard writes it (Common/Types/DateLanguage).
 *
 * Each language is read on its own clock - US English, Korean, Traditional
 * Chinese, Hindi and Arabic read a 12-hour one, German, Japanese, French and
 * Russian a 24-hour one - in UTC, before noon and after it.
 */

// The issue's time: 5:14 in the morning, and the same in the afternoon.
const MORNING: Date = new Date("2026-11-05T05:14:00.000Z");
const AFTERNOON: Date = new Date("2026-11-05T17:14:00.000Z");

// Each time of day a text holds: its hour and its minutes, as written.
const TIME_OF_DAY: RegExp = /(\d{1,2})[:.](\d{2})/g;

// A space, a no-break space or a narrow one: the same to a reader.
const ANY_SPACE: RegExp = /\s/g;

function spaced(text: string): string {
  return text.replace(ANY_SPACE, " ");
}

// The hours of a text's times of day, as written: ["5"] or ["05"].
function hoursOf(text: string): Array<string> {
  return Array.from(text.matchAll(TIME_OF_DAY)).map(
    (match: RegExpMatchArray): string => {
      return match[1] || "";
    },
  );
}

function inUtc(date: Date, locale: string, showYear: boolean): string {
  return spaced(writeDateTime(date, { locale, timeZone: "UTC", showYear }));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the hour Intl is asked for", () => {
  test("numeric on a 12-hour clock, two digits on a 24-hour one", () => {
    expect(getHourOption(true)).toBe("numeric");
    expect(getHourOption(false)).toBe("2-digit");
  });

  test.each<[string, boolean]>([
    ["en-US", true],
    ["ko", true],
    ["zh-TW", true],
    ["hi", true],
    ["ar", true],
    ["de", false],
    ["ja", false],
    ["fr", false],
    ["ru", false],
    ["en-GB", false],
  ])("%s reads a 12-hour clock: %p", (locale: string, twelveHour: boolean) => {
    expect(uses12HourClock(locale)).toBe(twelveHour);
  });

  test("a locale Intl refuses reads a 24-hour clock rather than throwing", () => {
    expect(uses12HourClock("not a locale!")).toBe(false);
  });

  test("an engine that reports the cycle but not the boolean is read by its cycle", () => {
    const resolvedOptions: () => Intl.ResolvedDateTimeFormatOptions =
      Intl.DateTimeFormat.prototype.resolvedOptions;

    for (const [hourCycle, twelveHour] of [
      ["h12", true],
      ["h11", true],
      ["h23", false],
      ["h24", false],
    ] as Array<[string, boolean]>) {
      jest
        .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
        .mockImplementation(function (
          this: Intl.DateTimeFormat,
        ): Intl.ResolvedDateTimeFormatOptions {
          const real: Intl.ResolvedDateTimeFormatOptions =
            resolvedOptions.call(this);

          return {
            ...real,
            hour12: undefined,
            hourCycle: hourCycle,
          } as unknown as Intl.ResolvedDateTimeFormatOptions;
        });

      expect(uses12HourClock("en-US")).toBe(twelveHour);

      jest.restoreAllMocks();
    }
  });
});

describe("a date and time, on each language's own clock", () => {
  test.each<[string, [string, string], [string, string]]>([
    // The issue's three, as it says they should read.
    [
      "en-US",
      ["Nov 5, 2026, 5:14 AM", "Nov 5, 2026, 5:14 PM"],
      ["Nov 5, 5:14 AM", "Nov 5, 5:14 PM"],
    ],
    [
      "ko",
      ["2026년 11월 5일 오전 5:14", "2026년 11월 5일 오후 5:14"],
      ["11월 5일 오전 5:14", "11월 5일 오후 5:14"],
    ],
    [
      "ar",
      ["5 نوفمبر 2026، 5:14 ص", "5 نوفمبر 2026، 5:14 م"],
      ["5 نوفمبر، 5:14 ص", "5 نوفمبر، 5:14 م"],
    ],
    [
      "zh-TW",
      ["2026年11月5日 上午5:14", "2026年11月5日 下午5:14"],
      ["11月5日 上午5:14", "11月5日 下午5:14"],
    ],
    [
      "hi",
      ["5 नव॰ 2026, 5:14 am", "5 नव॰ 2026, 5:14 pm"],
      ["5 नव॰, 5:14 am", "5 नव॰, 5:14 pm"],
    ],
    // A 24-hour clock keeps its zero.
    [
      "de",
      ["5. Nov. 2026, 05:14", "5. Nov. 2026, 17:14"],
      ["5. Nov., 05:14", "5. Nov., 17:14"],
    ],
    [
      "fr",
      ["5 nov. 2026, 05:14", "5 nov. 2026, 17:14"],
      ["5 nov., 05:14", "5 nov., 17:14"],
    ],
    [
      "ru",
      ["5 нояб. 2026 г., 05:14", "5 нояб. 2026 г., 17:14"],
      ["5 нояб., 05:14", "5 нояб., 17:14"],
    ],
    [
      "ja",
      ["2026年11月5日 05:14", "2026年11月5日 17:14"],
      ["11月5日 05:14", "11月5日 17:14"],
    ],
  ])(
    "in %s",
    (
      locale: string,
      withYear: [string, string],
      withoutYear: [string, string],
    ) => {
      expect([
        inUtc(MORNING, locale, true),
        inUtc(AFTERNOON, locale, true),
      ]).toEqual(withYear);
      expect([
        inUtc(MORNING, locale, false),
        inUtc(AFTERNOON, locale, false),
      ]).toEqual(withoutYear);
    },
  );

  test.each(["en-US", "ko", "zh-TW", "hi", "ar"])(
    "%s, on a 12-hour clock, writes no zero before noon or after it",
    (locale: string) => {
      for (const date of [MORNING, AFTERNOON]) {
        for (const showYear of [true, false]) {
          const written: string = inUtc(date, locale, showYear);

          expect({ written, hours: hoursOf(written) }).toEqual({
            written,
            hours: ["5"],
          });
        }
      }

      // Its day period tells the morning from the afternoon.
      expect(inUtc(MORNING, locale, false)).not.toBe(
        inUtc(AFTERNOON, locale, false),
      );
    },
  );

  test.each(["de", "ja", "fr", "ru", "en-GB"])(
    "%s, on a 24-hour clock, keeps the zero",
    (locale: string) => {
      for (const showYear of [true, false]) {
        const morning: string = inUtc(MORNING, locale, showYear);
        const afternoon: string = inUtc(AFTERNOON, locale, showYear);

        expect({ morning, hours: hoursOf(morning) }).toEqual({
          morning,
          hours: ["05"],
        });
        expect({ afternoon, hours: hoursOf(afternoon) }).toEqual({
          afternoon,
          hours: ["17"],
        });
      }
    },
  );

  test("a time of day is read in the zone asked for", () => {
    expect(
      spaced(
        writeDateTime(MORNING, {
          locale: "de",
          timeZone: "Asia/Tokyo",
          showYear: true,
        }),
      ),
    ).toBe("5. Nov. 2026, 14:14");
  });
});

/*
 * What the detail screens and a monitor's summary call write on the phone's
 * own clock, which these pin with the phone's locale left as it is: Intl's
 * report of the clock is replaced, and the zone is the phone's, so the
 * instant is 05:14 on its own wall clock.
 */
describe("on the phone's own clock", () => {
  const LOCAL_MORNING: Date = new Date(2026, 10, 5, 5, 14);
  const LOCAL_AFTERNOON: Date = new Date(2026, 10, 5, 17, 14);

  const onAPhoneThatReads: (twelveHour: boolean) => void = (
    twelveHour: boolean,
  ): void => {
    const resolvedOptions: () => Intl.ResolvedDateTimeFormatOptions =
      Intl.DateTimeFormat.prototype.resolvedOptions;

    jest
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockImplementation(function (
        this: Intl.DateTimeFormat,
      ): Intl.ResolvedDateTimeFormatOptions {
        return { ...resolvedOptions.call(this), hour12: twelveHour };
      });
  };

  test("a 12-hour phone reads 5:14 on a detail screen, never 05:14", () => {
    onAPhoneThatReads(true);

    const morning: string = formatDateTime(LOCAL_MORNING.toISOString());
    const afternoon: string = formatDateTime(LOCAL_AFTERNOON.toISOString());

    expect({ morning, hours: hoursOf(morning) }).toEqual({
      morning,
      hours: ["5"],
    });
    expect({ afternoon, hours: hoursOf(afternoon) }).toEqual({
      afternoon,
      hours: ["5"],
    });
    expect(morning).toContain("2026");
    expect(morning).not.toBe(afternoon);
  });

  test("a 24-hour phone reads 05:14 and 17:14 on a detail screen", () => {
    onAPhoneThatReads(false);

    const morning: string = formatDateTime(LOCAL_MORNING.toISOString());
    const afternoon: string = formatDateTime(LOCAL_AFTERNOON.toISOString());

    expect({ morning, hours: hoursOf(morning) }).toEqual({
      morning,
      hours: ["05"],
    });
    expect({ afternoon, hours: hoursOf(afternoon) }).toEqual({
      afternoon,
      hours: ["17"],
    });
  });

  test.each([true, false])(
    "the short form, without its year, on a 12-hour phone (%p) too",
    (twelveHour: boolean) => {
      onAPhoneThatReads(twelveHour);

      const short: string | null = formatShortDateTime(
        LOCAL_MORNING.toISOString(),
      );

      expect(short).not.toBeNull();
      expect(short).not.toContain("2026");
      expect(hoursOf(short || "")).toEqual([twelveHour ? "5" : "05"]);
      // The same time of day the detail screens write.
      expect(Array.from((short || "").matchAll(TIME_OF_DAY))[0]?.[0]).toBe(
        Array.from(
          formatDateTime(LOCAL_MORNING.toISOString()).matchAll(TIME_OF_DAY),
        )[0]?.[0],
      );
    },
  );

  test("unmocked, the phone's own clock decides", () => {
    expect(hoursOf(formatDateTime(LOCAL_MORNING.toISOString()))).toEqual([
      uses12HourClock() ? "5" : "05",
    ]);
  });

  test("what names no instant is not a time", () => {
    expect(formatShortDateTime("not a date")).toBeNull();
    expect(formatShortDateTime("")).toBeNull();
    expect(formatShortDateTime(null as unknown as string)).toBeNull();
    expect(formatDateTime("not a date")).toBe("—");
  });
});
