import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import {
  FEED_RELATIVE_HINT_WINDOW_IN_MINUTES,
  FeedClock,
  formatFeedDay,
  formatFeedFullTime,
  formatFeedTime,
  formatFeedTimeAgo,
  getFeedClock,
  getFeedDayKey,
  getFeedLocale,
  getFeedRelativeDay,
  getFeedRelativeHint,
  getFeedTimeAgoDistance,
  getFeedZoneName,
} from "../../../UI/Components/Feed/FeedTime";

/*
 * When a feed entry happened, as a timeline says it: the real time of day in
 * the reader's zone and language, one heading per day, and "12 min ago" only
 * within the last hour. These pin every rule with a fixed clock, so nothing
 * here depends on when or where the suite runs.
 */

// Intl writes a narrow no-break space before AM/PM in newer ICU versions.
const NARROW_SPACES: RegExp = /[\u202f\u00a0]/g;

const plain: (text: string | undefined) => string = (
  text: string | undefined,
): string => {
  return (text || "").replace(NARROW_SPACES, " ");
};

const clock: (overrides?: Partial<FeedClock>) => FeedClock = (
  overrides?: Partial<FeedClock>,
): FeedClock => {
  return {
    timezone: "Asia/Singapore",
    language: "en",
    use12HourClock: true,
    now: new Date("2026-10-13T07:40:00.000Z"),
    ...overrides,
  };
};

afterEach(() => {
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("the reader's locale", () => {
  test.each<[string, string]>([
    ["en", "en-u-ca-gregory"],
    ["de", "de-u-ca-gregory"],
    ["zh-CN", "zh-CN-u-ca-gregory"],
    ["zh-TW", "zh-TW-u-ca-gregory"],
    ["fa", "fa-u-ca-gregory"],
    ["ja", "ja-u-ca-gregory"],
  ])(
    "%s reads with its own words and digits, on the Gregorian calendar",
    (language: string, locale: string) => {
      expect(getFeedLocale(language)).toBe(locale);
    },
  );

  test.each<[string | undefined]>([[undefined], [""], ["not a language!"]])(
    "%p falls back to English rather than to the browser's own default",
    (language: string | undefined) => {
      expect(getFeedLocale(language)).toBe("en-u-ca-gregory");
    },
  );

  test("a Persian reader's dates use the Gregorian calendar and Persian digits, like the counts around them", () => {
    const day: string = formatFeedDay(
      new Date("2026-10-13T07:25:00.000Z"),
      clock({ language: "fa", timezone: "Asia/Tehran" }),
    );

    expect(day).toContain("۲۰۲۶");
    expect(day).toContain("۱۳");
    expect(day).toContain("اکتبر");
    // No Latin digits.
    expect(day).not.toMatch(/[0-9]/);
  });
});

describe("the day an entry falls on", () => {
  test("is counted in the reader's zone, not UTC", () => {
    // 23:30 UTC on Oct 12 is already Oct 13 in Singapore (UTC+8).
    const date: Date = new Date("2026-10-12T23:30:00.000Z");

    expect(getFeedDayKey(date, "Asia/Singapore")).toBe("2026-10-13");
    expect(getFeedDayKey(date, "UTC")).toBe("2026-10-12");
    expect(getFeedDayKey(date, "America/New_York")).toBe("2026-10-12");
  });

  test("two entries a minute apart around midnight land on two days", () => {
    const beforeMidnight: Date = new Date("2026-10-13T15:59:00.000Z");
    const afterMidnight: Date = new Date("2026-10-13T16:00:00.000Z");

    // 23:59 and 00:00 in Singapore.
    expect(getFeedDayKey(beforeMidnight, "Asia/Singapore")).toBe("2026-10-13");
    expect(getFeedDayKey(afterMidnight, "Asia/Singapore")).toBe("2026-10-14");
  });

  test("the heading writes the full date with the weekday", () => {
    expect(formatFeedDay(new Date("2026-10-13T07:25:00.000Z"), clock())).toBe(
      "Tuesday, October 13, 2026",
    );
  });

  test.each<[string, string]>([
    ["de", "Dienstag, 13. Oktober 2026"],
    ["fr", "mardi 13 octobre 2026"],
    ["ja", "2026年10月13日火曜日"],
  ])(
    "the heading is in the reader's language: %s",
    (language: string, expected: string) => {
      expect(
        formatFeedDay(
          new Date("2026-10-13T07:25:00.000Z"),
          clock({ language }),
        ),
      ).toBe(expected);
    },
  );
});

describe("the time of day", () => {
  test("is the wall clock in the reader's zone", () => {
    const date: Date = new Date("2026-10-13T07:25:00.000Z");

    expect(plain(formatFeedTime(date, clock()))).toBe("3:25 PM");
    expect(
      plain(formatFeedTime(date, clock({ timezone: "America/New_York" }))),
    ).toBe("3:25 AM");
    expect(plain(formatFeedTime(date, clock({ timezone: "UTC" })))).toBe(
      "7:25 AM",
    );
  });

  test("follows the reader's clock: 12-hour or 24-hour", () => {
    const date: Date = new Date("2026-10-13T07:25:00.000Z");

    expect(plain(formatFeedTime(date, clock({ use12HourClock: true })))).toBe(
      "3:25 PM",
    );
    expect(plain(formatFeedTime(date, clock({ use12HourClock: false })))).toBe(
      "15:25",
    );
  });

  test("a 24-hour clock writes midnight as 00:xx", () => {
    expect(
      plain(
        formatFeedTime(
          new Date("2026-10-13T16:05:00.000Z"),
          clock({ use12HourClock: false }),
        ),
      ),
    ).toBe("00:05");
  });

  test("a 12-hour clock writes midnight and noon as 12", () => {
    expect(
      plain(formatFeedTime(new Date("2026-10-13T16:05:00.000Z"), clock())),
    ).toBe("12:05 AM");
    expect(
      plain(formatFeedTime(new Date("2026-10-13T04:05:00.000Z"), clock())),
    ).toBe("12:05 PM");
  });

  test("is in the reader's language, the day period included", () => {
    const date: Date = new Date("2026-10-13T07:25:00.000Z");

    expect(plain(formatFeedTime(date, clock({ language: "ja" })))).toBe(
      "午後3:25",
    );
    expect(
      plain(
        formatFeedTime(date, clock({ language: "de", use12HourClock: false })),
      ),
    ).toBe("15:25");
  });

  test("the full time for the tooltip has the date, seconds and zone", () => {
    expect(
      plain(formatFeedFullTime(new Date("2026-10-13T07:25:42.000Z"), clock())),
    ).toBe("Tuesday, October 13, 2026 at 3:25:42 PM GMT+08");
  });
});

describe("the zone's name", () => {
  test("is the one in force at that instant, across a DST change", () => {
    // New York leaves daylight saving at 2 AM on Nov 1, 2026.
    expect(
      getFeedZoneName(new Date("2026-11-01T05:30:00.000Z"), "America/New_York"),
    ).toBe("EDT");
    expect(
      getFeedZoneName(new Date("2026-11-01T06:30:00.000Z"), "America/New_York"),
    ).toBe("EST");
  });

  test("a zone without an abbreviation reads as an offset from GMT", () => {
    expect(
      getFeedZoneName(new Date("2026-10-13T07:25:00.000Z"), "Asia/Singapore"),
    ).toBe("GMT+08");
  });

  test("the two 1:30 AMs of the night the clocks go back are told apart by their zones", () => {
    const firstOneThirty: Date = new Date("2026-11-01T05:30:00.000Z");
    const secondOneThirty: Date = new Date("2026-11-01T06:30:00.000Z");
    const newYork: FeedClock = clock({ timezone: "America/New_York" });

    expect(plain(formatFeedTime(firstOneThirty, newYork))).toBe("1:30 AM");
    expect(plain(formatFeedTime(secondOneThirty, newYork))).toBe("1:30 AM");
    expect(getFeedZoneName(firstOneThirty, "America/New_York")).not.toBe(
      getFeedZoneName(secondOneThirty, "America/New_York"),
    );
  });

  test("a zone moment does not know reads as nothing rather than throwing", () => {
    expect(
      getFeedZoneName(new Date("2026-10-13T07:25:00.000Z"), "Not/AZone"),
    ).toBe("");
  });
});

describe("Today and Yesterday", () => {
  const now: Date = new Date("2026-10-13T07:40:00.000Z"); // 3:40 PM in Singapore

  test("an entry from today is Today, in the reader's zone", () => {
    expect(
      getFeedRelativeDay(new Date("2026-10-13T01:00:00.000Z"), clock({ now })),
    ).toBe("Today");
  });

  test("an entry from the day before is Yesterday", () => {
    expect(
      getFeedRelativeDay(new Date("2026-10-12T05:00:00.000Z"), clock({ now })),
    ).toBe("Yesterday");
  });

  test("an older entry is named by its date alone", () => {
    expect(
      getFeedRelativeDay(new Date("2026-10-10T05:00:00.000Z"), clock({ now })),
    ).toBeUndefined();
  });

  test("an entry from 11:58 PM read at 12:03 AM is Yesterday", () => {
    // 23:58 on Oct 13 and 00:03 on Oct 14, Singapore time.
    expect(
      getFeedRelativeDay(
        new Date("2026-10-13T15:58:00.000Z"),
        clock({ now: new Date("2026-10-13T16:03:00.000Z") }),
      ),
    ).toBe("Yesterday");
  });

  test("the same instant is Today in one zone and Yesterday in another", () => {
    const entry: Date = new Date("2026-10-12T20:00:00.000Z");
    const readAt: Date = new Date("2026-10-13T01:00:00.000Z");

    // Oct 13 04:00 in Singapore, read at 09:00 the same day.
    expect(getFeedRelativeDay(entry, clock({ now: readAt }))).toBe("Today");
    // Oct 12 16:00 in New York, read at Oct 12 21:00: also today.
    expect(
      getFeedRelativeDay(
        entry,
        clock({ now: readAt, timezone: "America/New_York" }),
      ),
    ).toBe("Today");
    // Oct 12 20:00 in UTC, read at Oct 13 01:00 UTC: yesterday.
    expect(
      getFeedRelativeDay(entry, clock({ now: readAt, timezone: "UTC" })),
    ).toBe("Yesterday");
  });

  test.each<[string, string, string]>([
    ["de", "Heute", "Gestern"],
    ["es", "Hoy", "Ayer"],
    ["ja", "今日", "昨日"],
  ])(
    "they are in the reader's language and start with a capital: %s",
    (language: string, today: string, yesterday: string) => {
      expect(
        getFeedRelativeDay(
          new Date("2026-10-13T01:00:00.000Z"),
          clock({ now, language }),
        ),
      ).toBe(today);
      expect(
        getFeedRelativeDay(
          new Date("2026-10-12T01:00:00.000Z"),
          clock({ now, language }),
        ),
      ).toBe(yesterday);
    },
  );
});

describe("the hint under the time", () => {
  const now: Date = new Date("2026-10-13T07:40:00.000Z");
  const ago: (seconds: number) => Date = (seconds: number): Date => {
    return new Date(now.getTime() - seconds * 1000);
  };

  test("is 'now' for the last 45 seconds", () => {
    expect(getFeedRelativeHint(ago(0), clock({ now }))).toBe("now");
    expect(getFeedRelativeHint(ago(44), clock({ now }))).toBe("now");
  });

  test("counts minutes within the hour, rounded as a person would", () => {
    expect(plain(getFeedRelativeHint(ago(45), clock({ now })))).toBe(
      "1 min. ago",
    );
    expect(plain(getFeedRelativeHint(ago(89), clock({ now })))).toBe(
      "1 min. ago",
    );
    expect(plain(getFeedRelativeHint(ago(12 * 60), clock({ now })))).toBe(
      "12 min. ago",
    );
    expect(plain(getFeedRelativeHint(ago(59 * 60), clock({ now })))).toBe(
      "59 min. ago",
    );
  });

  test("stops after the hour: past that, the time says it", () => {
    expect(
      getFeedRelativeHint(
        ago(FEED_RELATIVE_HINT_WINDOW_IN_MINUTES * 60),
        clock({ now }),
      ),
    ).toBeUndefined();
    expect(getFeedRelativeHint(ago(59 * 60 + 40), clock({ now }))).toBe(
      undefined,
    );
    expect(getFeedRelativeHint(ago(3 * 3600), clock({ now }))).toBeUndefined();
  });

  test("an entry a little ahead of the reader's clock is 'now'; one far ahead gets no hint", () => {
    expect(getFeedRelativeHint(ago(-30), clock({ now }))).toBe("now");
    expect(getFeedRelativeHint(ago(-110), clock({ now }))).toBe("now");
    expect(getFeedRelativeHint(ago(-600), clock({ now }))).toBeUndefined();
  });

  test("an invalid date gets no hint", () => {
    expect(
      getFeedRelativeHint(new Date("not a date"), clock({ now })),
    ).toBeUndefined();
  });

  test.each<[string, string, string]>([
    ["de", "jetzt", "vor 12 Min."],
    ["ja", "今", "12 分前"],
    ["fr", "maintenant", "il y a 12 min"],
  ])(
    "is in the reader's language - not moment's English (%s)",
    (language: string, nowText: string, minutesText: string) => {
      expect(plain(getFeedRelativeHint(ago(5), clock({ now, language })))).toBe(
        nowText,
      );
      expect(
        plain(getFeedRelativeHint(ago(12 * 60), clock({ now, language }))),
      ).toBe(minutesText);
    },
  );
});

describe("the clock a feed is read with", () => {
  test("uses the User Settings zone over the browser's", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

    expect(getFeedClock({ language: "en" }).timezone).toBe("Asia/Kolkata");
  });

  test("falls back to the browser's zone without one", () => {
    OneUptimeDate.setUserTimezone(null);

    expect(getFeedClock({ language: "en" }).timezone).toBe(
      OneUptimeDate.getCurrentTimezone().toString(),
    );
  });

  test("follows the machine's 12- or 24-hour clock, as every other time in the product", () => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);

    expect(getFeedClock({ language: "en" }).use12HourClock).toBe(false);
  });

  test("reads now when not given one", () => {
    const before: number = Date.now();
    const read: FeedClock = getFeedClock({ language: "de" });

    expect(read.language).toBe("de");
    expect(read.now.getTime()).toBeGreaterThanOrEqual(before);
  });
});

/*
 * How long ago, at any distance - for a status with no clock time beside it,
 * such as when a calendar app last read a feed ("Last fetched {{when}}").
 * It replaced moment's fromNow there, which said "a day ago" in English on
 * every page whatever the reader's language.
 */
describe("how long ago, at any distance", () => {
  const now: Date = new Date("2026-10-13T07:40:00.000Z");
  const ago: (seconds: number) => Date = (seconds: number): Date => {
    return new Date(now.getTime() - seconds * 1000);
  };

  const MINUTE: number = 60;
  const HOUR: number = 60 * MINUTE;
  const DAY: number = 24 * HOUR;

  test.each<[number, number, string]>([
    [0, 1, "minute"],
    [89, 1, "minute"],
    [90, 2, "minute"],
    [44 * MINUTE, 44, "minute"],
    [45 * MINUTE, 1, "hour"],
    [21 * HOUR, 21, "hour"],
    [22 * HOUR, 1, "day"],
    [25 * DAY, 25, "day"],
    [26 * DAY, 1, "month"],
    [10 * 30 * DAY, 10, "month"],
    [11 * 30 * DAY, 1, "year"],
    [800 * DAY, 2, "year"],
  ])(
    "%s seconds ago reads as %s %s, rounded as a person would",
    (seconds: number, count: number, unit: string) => {
      expect(getFeedTimeAgoDistance(seconds)).toEqual({
        count: count,
        unit: unit,
      });
    },
  );

  test("a moment ahead of this clock is still a minute ago, never 'in 2 minutes'", () => {
    expect(getFeedTimeAgoDistance(-90)).toEqual({ count: 1, unit: "minute" });
    expect(formatFeedTimeAgo(ago(-90), clock({ now }))).toBe("1 minute ago");
  });

  test.each<[number, string]>([
    [20, "1 minute ago"],
    [7 * MINUTE, "7 minutes ago"],
    [2 * HOUR, "2 hours ago"],
    [23 * HOUR, "1 day ago"],
    [3 * DAY, "3 days ago"],
    [40 * DAY, "1 month ago"],
    [400 * DAY, "1 year ago"],
  ])(
    "%s seconds ago is %s - always a number, never 'now', 'yesterday' or 'last month'",
    (seconds: number, words: string) => {
      expect(formatFeedTimeAgo(ago(seconds), clock({ now }))).toBe(words);
    },
  );

  test.each<[string, string, string]>([
    ["de", "vor 7 Minuten", "vor 1 Tag"],
    ["fr", "il y a 7 minutes", "il y a 1 jour"],
    ["ja", "7 分前", "1 日前"],
  ])(
    "is in the reader's language, not moment's English (%s)",
    (language: string, minutes: string, day: string) => {
      expect(
        plain(formatFeedTimeAgo(ago(7 * MINUTE), clock({ now, language }))),
      ).toBe(minutes);
      expect(
        plain(formatFeedTimeAgo(ago(23 * HOUR), clock({ now, language }))),
      ).toBe(day);
    },
  );

  test("a Persian reader's distance is written in Persian digits, like the counts around it", () => {
    const words: string = formatFeedTimeAgo(
      ago(7 * MINUTE),
      clock({ now, language: "fa" }),
    ) as string;

    expect(words).toContain("۷");
    expect(words).not.toContain("7");
  });

  test("an invalid date says nothing rather than 'NaN minutes ago'", () => {
    expect(
      formatFeedTimeAgo(new Date("not a date"), clock({ now })),
    ).toBeUndefined();
  });

  test("a browser without Intl.RelativeTimeFormat still gets a sentence, in English", () => {
    const intl: { RelativeTimeFormat?: unknown } = Intl as unknown as {
      RelativeTimeFormat?: unknown;
    };
    const original: unknown = intl.RelativeTimeFormat;

    Object.defineProperty(Intl, "RelativeTimeFormat", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      // A language no other test here formats with, so no formatter is cached.
      expect(
        formatFeedTimeAgo(ago(3 * HOUR), clock({ now, language: "is" })),
      ).toBe("3 hours ago");
      expect(formatFeedTimeAgo(ago(30), clock({ now, language: "is" }))).toBe(
        "1 minute ago",
      );
    } finally {
      Object.defineProperty(Intl, "RelativeTimeFormat", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });

  test("the timeline's own hint is unchanged: short, and 'now' under 45 seconds", () => {
    expect(getFeedRelativeHint(ago(5), clock({ now }))).toBe("now");
    expect(plain(getFeedRelativeHint(ago(12 * 60), clock({ now })))).toBe(
      "12 min. ago",
    );
  });
});
