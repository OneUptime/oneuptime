/** @timezone UTC */
import { describe, expect, jest, test } from "@jest/globals";
import {
  ShiftLength,
  formatShiftDateTime,
  formatShiftEnd,
  formatShiftFullDateTime,
  formatShiftLength,
  formatShiftTime,
  getShiftDateTile,
  getShiftDayLabel,
  getShiftLength,
  isSameShiftDay,
  roundShiftLength,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftTime";
import { FeedClock } from "../../../UI/Components/Feed/FeedTime";

/*
 * HOW THE UPCOMING SHIFTS CARD WRITES TIMES.
 *
 * The card used to write a row's start with moment in the BROWSER's zone
 * and its end in the profile's, in English, with the year and the zone on
 * every row ("17:20 – Oct 15 2026, 17:20 BST"). These pin the new rules: one
 * clock - the reader's zone, language and hour cycle - for every part of a
 * row; the end's day only when it is not the start's; lengths counted the
 * way a person counts them across a change of the clocks; and every word in
 * the reader's language, plurals included.
 */

// Intl writes a no-break space (or a narrow one) in some languages.
const NO_BREAK_SPACES: RegExp = /[\u202f\u00a0]/g;

function plain(text: string): string {
  return text.replace(NO_BREAK_SPACES, " ");
}

function clock(
  timezone: string,
  now: string,
  language: string = "en",
  use12HourClock: boolean = false,
): FeedClock {
  return {
    timezone: timezone,
    language: language,
    use12HourClock: use12HourClock,
    now: new Date(now),
  };
}

const LONDON: FeedClock = clock("Europe/London", "2026-10-14T15:00:00.000Z");

describe("the date tile", () => {
  test("the month and the day the span starts on, in the reader's zone", () => {
    // 23:30 UTC on the 14th is already the 15th in Tokyo.
    const instant: Date = new Date("2026-10-14T23:30:00.000Z");

    expect(getShiftDateTile(instant, LONDON)).toEqual({
      month: "Oct",
      day: "15",
    });
    expect(
      getShiftDateTile(instant, clock("UTC", "2026-10-14T12:00:00.000Z")),
    ).toEqual({ month: "Oct", day: "14" });
    expect(
      getShiftDateTile(instant, clock("Asia/Tokyo", "2026-10-14T12:00:00Z")),
    ).toEqual({ month: "Oct", day: "15" });
  });

  test("the month in the reader's language, the day as a bare number in every one", () => {
    const instant: Date = new Date("2026-11-03T09:00:00.000Z");

    const tiles: Record<string, { month: string; day: string }> = {};

    for (const language of ["de", "fr", "ja", "ru", "fa", "hi", "zh-CN"]) {
      tiles[language] = getShiftDateTile(
        instant,
        clock("Europe/London", "2026-10-14T15:00:00Z", language),
      );
    }

    expect(tiles["de"]!.month).toBe("Nov");
    expect(tiles["ja"]!.month).toBe("11月");
    expect(tiles["ru"]!.month).toBe("нояб.");
    /*
     * The Gregorian calendar in every one, in each language's digits:
     * Persian's ۳, Latin elsewhere.
     */
    for (const [language, tile] of Object.entries(tiles)) {
      expect({ language, day: tile.day }).toEqual({
        language,
        day: language === "fa" ? "۳" : "3",
      });
    }
  });
});

describe("the day in words", () => {
  test("Today and Tomorrow, then the weekday", () => {
    expect(getShiftDayLabel(new Date("2026-10-14T19:00:00Z"), LONDON)).toBe(
      "Today",
    );
    expect(getShiftDayLabel(new Date("2026-10-15T09:00:00Z"), LONDON)).toBe(
      "Tomorrow",
    );
    expect(getShiftDayLabel(new Date("2026-10-17T09:00:00Z"), LONDON)).toBe(
      "Saturday",
    );
  });

  test("counted in calendar days of the reader's zone", () => {
    // 23:30 UTC on the 14th: tomorrow in Tokyo (already the 15th), today in UTC.
    const lateEvening: Date = new Date("2026-10-14T23:30:00.000Z");

    expect(
      getShiftDayLabel(
        lateEvening,
        clock("Asia/Tokyo", "2026-10-14T12:00:00.000Z"),
      ),
    ).toBe("Tomorrow");
    expect(
      getShiftDayLabel(lateEvening, clock("UTC", "2026-10-14T12:00:00.000Z")),
    ).toBe("Today");
    // After midnight in Tokyo, the same instant is today there.
    expect(
      getShiftDayLabel(
        lateEvening,
        clock("Asia/Tokyo", "2026-10-14T16:00:00.000Z"),
      ),
    ).toBe("Today");
  });

  test("in the reader's language, capitalised where the language has capitals", () => {
    const tomorrow: Date = new Date("2026-10-15T09:00:00Z");
    const saturday: Date = new Date("2026-10-17T09:00:00Z");

    const label: (language: string, date: Date) => string = (
      language: string,
      date: Date,
    ): string => {
      return getShiftDayLabel(
        date,
        clock("Europe/London", "2026-10-14T15:00:00Z", language),
      );
    };

    expect(label("de", tomorrow)).toBe("Morgen");
    expect(label("fr", tomorrow)).toBe("Demain");
    expect(label("ja", tomorrow)).toBe("明日");
    expect(label("ru", tomorrow)).toBe("Завтра");
    expect(label("de", saturday)).toBe("Samstag");
    expect(label("ru", saturday)).toBe("Суббота");
  });

  test("a language Intl does not know reads in English, never half in two languages", () => {
    expect(
      getShiftDayLabel(
        new Date("2026-10-15T09:00:00Z"),
        clock("Europe/London", "2026-10-14T15:00:00Z", "xx-not-a-language"),
      ),
    ).toBe("Tomorrow");
  });
});

describe("times", () => {
  test("the hour cycle the reader uses", () => {
    const instant: Date = new Date("2026-10-15T16:20:00.000Z");

    expect(formatShiftTime(instant, LONDON)).toBe("17:20");
    expect(
      plain(
        formatShiftTime(
          instant,
          clock("Europe/London", "2026-10-14T15:00:00Z", "en", true),
        ),
      ),
    ).toBe("5:20 PM");
  });

  test("the end is a time on the start's day, and a day and a time on any later one", () => {
    const start: Date = new Date("2026-10-17T22:00:00.000Z");

    // 23:00 to 07:00 in London: the end is on Sunday.
    expect(
      formatShiftEnd({
        start: start,
        end: new Date("2026-10-18T06:00:00.000Z"),
        clock: LONDON,
      }),
    ).toBe("Sun, Oct 18, 07:00");

    // The same night in UTC+14 is one calendar day: 12:00 to 20:00.
    expect(
      formatShiftEnd({
        start: start,
        end: new Date("2026-10-18T06:00:00.000Z"),
        clock: clock("Pacific/Kiritimati", "2026-10-14T15:00:00Z"),
      }),
    ).toBe("20:00");

    expect(
      formatShiftEnd({
        start: new Date("2026-10-15T09:00:00.000Z"),
        end: new Date("2026-10-15T17:00:00.000Z"),
        clock: LONDON,
      }),
    ).toBe("18:00");
  });

  test("a day and a time in other languages", () => {
    const instant: Date = new Date("2026-11-13T16:20:00.000Z");

    expect(
      plain(
        formatShiftDateTime(
          instant,
          clock("Europe/Berlin", "2026-10-14T15:00:00Z", "de"),
        ),
      ),
    ).toBe("Fr., 13. Nov., 17:20");
    expect(
      plain(
        formatShiftDateTime(
          instant,
          clock("Asia/Tokyo", "2026-10-14T15:00:00Z", "ja"),
        ),
      ),
    ).toBe("11月14日(土) 1:20");
  });

  test("two instants are one day by the reader's calendar, not UTC's", () => {
    const evening: Date = new Date("2026-10-14T22:30:00.000Z");
    const night: Date = new Date("2026-10-15T00:30:00.000Z");

    expect(isSameShiftDay(evening, night, LONDON)).toBe(false);
    expect(
      isSameShiftDay(
        evening,
        night,
        clock("America/New_York", "2026-10-14T15:00:00Z"),
      ),
    ).toBe(true);
  });

  test("the tooltip names the zone in force at each end: summer time, then winter", () => {
    expect(
      plain(formatShiftFullDateTime(new Date("2026-10-24T16:20:00Z"), LONDON)),
    ).toBe("Saturday, October 24, 2026 at 17:20 BST");
    expect(
      plain(formatShiftFullDateTime(new Date("2026-10-26T17:20:00Z"), LONDON)),
    ).toBe("Monday, October 26, 2026 at 17:20 GMT");
  });
});

describe("how long a span lasts", () => {
  const length: (
    start: string,
    end: string,
    timezone?: string,
  ) => ShiftLength = (
    start: string,
    end: string,
    timezone?: string,
  ): ShiftLength => {
    return getShiftLength({
      start: new Date(start),
      end: new Date(end),
      timezone: timezone || "Europe/London",
    });
  };

  test("hours and minutes within a day", () => {
    expect(length("2026-10-15T09:00:00Z", "2026-10-15T17:00:00Z")).toEqual({
      days: 0,
      hours: 8,
      minutes: 0,
    });
    expect(length("2026-10-15T09:00:00Z", "2026-10-15T16:30:00Z")).toEqual({
      days: 0,
      hours: 7,
      minutes: 30,
    });
  });

  test("17:20 to 17:20 across the end of summer time is one day, though the clock gave it 25 hours", () => {
    // 25 October 2026: London goes back from BST to GMT at 01:00 UTC.
    expect(length("2026-10-24T16:20:00Z", "2026-10-25T17:20:00Z")).toEqual({
      days: 1,
      hours: 0,
      minutes: 0,
    });
  });

  test("and across the start of summer time, though the clock took an hour", () => {
    // 29 March 2026: London goes forward from GMT to BST at 01:00 UTC.
    expect(length("2026-03-28T17:20:00Z", "2026-03-29T16:20:00Z")).toEqual({
      days: 1,
      hours: 0,
      minutes: 0,
    });
  });

  test("a night inside the change counts its real hours: 00:00 to 08:00 is nine", () => {
    expect(length("2026-10-24T23:00:00Z", "2026-10-25T08:00:00Z")).toEqual({
      days: 0,
      hours: 9,
      minutes: 0,
    });
  });

  test("a month across the change is thirty days", () => {
    expect(length("2026-10-14T16:20:00Z", "2026-11-13T17:20:00Z")).toEqual({
      days: 30,
      hours: 0,
      minutes: 0,
    });
  });

  test("the same span in a zone without the change is thirty days and an hour", () => {
    expect(
      length("2026-10-14T16:20:00Z", "2026-11-13T17:20:00Z", "UTC"),
    ).toEqual({ days: 30, hours: 1, minutes: 0 });
  });

  test("nothing for a span that is not one", () => {
    expect(length("2026-10-15T09:00:00Z", "2026-10-15T09:00:00Z")).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
    });
    expect(length("2026-10-15T09:00:00Z", "2026-10-15T08:00:00Z")).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
    });
    expect(length("not a date", "2026-10-15T08:00:00Z")).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
    });
  });

  test("seconds round to the nearest minute", () => {
    expect(length("2026-10-15T09:00:00Z", "2026-10-15T09:44:31Z")).toEqual({
      days: 0,
      hours: 0,
      minutes: 45,
    });
    expect(length("2026-10-15T09:00:00Z", "2026-10-15T09:59:45Z")).toEqual({
      days: 0,
      hours: 1,
      minutes: 0,
    });
  });
});

describe("a length as it is said", () => {
  test("from a week up, whole days", () => {
    expect(roundShiftLength({ days: 29, hours: 23, minutes: 50 })).toEqual({
      days: 30,
      hours: 0,
      minutes: 0,
    });
    expect(roundShiftLength({ days: 7, hours: 11, minutes: 59 })).toEqual({
      days: 7,
      hours: 0,
      minutes: 0,
    });
  });

  test("under a week, days and whole hours", () => {
    expect(roundShiftLength({ days: 1, hours: 6, minutes: 10 })).toEqual({
      days: 1,
      hours: 6,
      minutes: 0,
    });
    expect(roundShiftLength({ days: 1, hours: 6, minutes: 30 })).toEqual({
      days: 1,
      hours: 7,
      minutes: 0,
    });
    expect(roundShiftLength({ days: 2, hours: 23, minutes: 45 })).toEqual({
      days: 3,
      hours: 0,
      minutes: 0,
    });
  });

  test("under a day, hours and minutes; under an hour, at least a minute", () => {
    expect(roundShiftLength({ days: 0, hours: 7, minutes: 30 })).toEqual({
      days: 0,
      hours: 7,
      minutes: 30,
    });
    expect(roundShiftLength({ days: 0, hours: 0, minutes: 0 })).toEqual({
      days: 0,
      hours: 0,
      minutes: 1,
    });
  });

  test("the time left of a shift under way is said in whole hours from two hours up", () => {
    const left: (hours: number, minutes: number) => ShiftLength = (
      hours: number,
      minutes: number,
    ): ShiftLength => {
      return roundShiftLength(
        { days: 0, hours: hours, minutes: minutes },
        { isTimeLeft: true },
      );
    };

    expect(left(5, 4)).toEqual({ days: 0, hours: 5, minutes: 0 });
    expect(left(5, 30)).toEqual({ days: 0, hours: 6, minutes: 0 });
    expect(left(2, 0)).toEqual({ days: 0, hours: 2, minutes: 0 });
    // Under two hours the minutes still matter.
    expect(left(1, 30)).toEqual({ days: 0, hours: 1, minutes: 30 });
    expect(left(0, 20)).toEqual({ days: 0, hours: 0, minutes: 20 });
    expect(left(23, 45)).toEqual({ days: 1, hours: 0, minutes: 0 });

    // A shift's own length keeps its minutes.
    expect(roundShiftLength({ days: 0, hours: 5, minutes: 4 })).toEqual({
      days: 0,
      hours: 5,
      minutes: 4,
    });
    expect(
      plain(
        formatShiftLength({ days: 0, hours: 5, minutes: 4 }, "de", {
          isTimeLeft: true,
        }),
      ),
    ).toBe("5 Stunden");
  });

  test("in English", () => {
    expect(formatShiftLength({ days: 30, hours: 0, minutes: 0 }, "en")).toBe(
      "30 days",
    );
    expect(formatShiftLength({ days: 0, hours: 8, minutes: 0 }, "en")).toBe(
      "8 hours",
    );
    expect(formatShiftLength({ days: 1, hours: 6, minutes: 0 }, "en")).toBe(
      "1 day, 6 hours",
    );
    expect(formatShiftLength({ days: 0, hours: 7, minutes: 30 }, "en")).toBe(
      "7 hours, 30 minutes",
    );
    expect(formatShiftLength({ days: 0, hours: 0, minutes: 45 }, "en")).toBe(
      "45 minutes",
    );
    expect(formatShiftLength({ days: 0, hours: 1, minutes: 0 }, "en")).toBe(
      "1 hour",
    );
    expect(formatShiftLength({ days: 0, hours: 0, minutes: 0 }, "en")).toBe(
      "1 minute",
    );
  });

  test("in the reader's language, with the language's own plurals", () => {
    expect(
      plain(formatShiftLength({ days: 30, hours: 0, minutes: 0 }, "de")),
    ).toBe("30 Tage");
    expect(
      plain(formatShiftLength({ days: 1, hours: 6, minutes: 0 }, "de")),
    ).toBe("1 Tag, 6 Stunden");
    // Russian has three forms: 21 день, 2 дня, 5 дней.
    expect(
      plain(formatShiftLength({ days: 21, hours: 0, minutes: 0 }, "ru")),
    ).toBe("21 день");
    expect(
      plain(formatShiftLength({ days: 2, hours: 0, minutes: 0 }, "ru")),
    ).toBe("2 дня");
    expect(
      plain(formatShiftLength({ days: 5, hours: 0, minutes: 0 }, "ru")),
    ).toBe("5 дней");
    expect(
      plain(formatShiftLength({ days: 0, hours: 8, minutes: 0 }, "ja")),
    ).toBe("8 時間");
    // Persian in its own digits, as every date and count on the page is.
    expect(
      plain(formatShiftLength({ days: 30, hours: 0, minutes: 0 }, "fa")),
    ).toBe("۳۰ روز");
  });

  test("a language Intl does not know reads in English", () => {
    expect(
      formatShiftLength({ days: 2, hours: 0, minutes: 0 }, "xx-not-a-language"),
    ).toBe("2 days");
  });
});

// What the test below reads from a fresh copy of the module.
interface ShiftTimeModule {
  formatShiftLength: (length: ShiftLength, language: string) => string;
}

describe("an engine without the unit and list formats", () => {
  test("writes lengths in English words rather than bare numbers", () => {
    jest.isolateModules(() => {
      const realNumberFormat: typeof Intl.NumberFormat = Intl.NumberFormat;
      const realListFormat: unknown = (
        Intl as unknown as { ListFormat: unknown }
      ).ListFormat;

      /*
       * An older engine ignores style: "unit" and writes the bare number;
       * one without Intl.ListFormat has nothing to join the parts with.
       */
      const bareNumberFormat: (
        locale?: string | Array<string>,
        options?: Intl.NumberFormatOptions,
      ) => Intl.NumberFormat = (
        locale?: string | Array<string>,
      ): Intl.NumberFormat => {
        return new realNumberFormat(locale);
      };

      Object.defineProperty(Intl, "NumberFormat", {
        value: bareNumberFormat,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(Intl, "ListFormat", {
        value: undefined,
        configurable: true,
        writable: true,
      });

      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const isolated: ShiftTimeModule = require("../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftTime");

        expect(
          isolated.formatShiftLength({ days: 1, hours: 6, minutes: 0 }, "de"),
        ).toBe("1 day, 6 hours");
        expect(
          isolated.formatShiftLength({ days: 0, hours: 1, minutes: 0 }, "en"),
        ).toBe("1 hour");
      } finally {
        Object.defineProperty(Intl, "NumberFormat", {
          value: realNumberFormat,
          configurable: true,
          writable: true,
        });
        Object.defineProperty(Intl, "ListFormat", {
          value: realListFormat,
          configurable: true,
          writable: true,
        });
      }
    });
  });
});
