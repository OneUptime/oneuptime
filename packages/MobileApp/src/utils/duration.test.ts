import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  formatDuration,
  formatElapsed,
  formatShiftTime,
  formatShiftWindow,
  formatTimeUntil,
  millisecondsUntil,
  toTimestamp,
} from "./duration";
import { formatDateTime, uses12HourClock } from "./date";

/*
 * These formatters are what an on-call countdown is made of, so the cases
 * below are the ones where a wrong answer changes a decision: the boundary
 * where a shift is ending, a handoff the server has not recomputed yet, and a
 * roster field that is simply absent.
 *
 * Every date is built from LOCAL components (new Date(y, m, d, h, min)) so the
 * expectations hold in any timezone the suite happens to run in - the app
 * renders wall-clock times, and a test that only passes in UTC is a test that
 * fails for half the contributors.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

/*
 * How long a status has lasted. The status in effect counts up on screen
 * every second, so - unlike a countdown - it has to show seconds, or it reads
 * as frozen for a minute at a time.
 */
describe("formatElapsed", () => {
  const SECOND: number = 1000;

  test("shows seconds alone under a minute", () => {
    expect(formatElapsed(SECOND)).toBe("1s");
    expect(formatElapsed(54 * SECOND)).toBe("54s");
    expect(formatElapsed(59 * SECOND)).toBe("59s");
  });

  test("shows minutes and seconds under an hour", () => {
    expect(formatElapsed(MINUTE)).toBe("1m 0s");
    expect(formatElapsed(2 * MINUTE + 54 * SECOND)).toBe("2m 54s");
    expect(formatElapsed(59 * MINUTE + 59 * SECOND)).toBe("59m 59s");
  });

  test("shows hours, minutes and seconds under a day", () => {
    expect(formatElapsed(HOUR)).toBe("1h 0m 0s");
    expect(formatElapsed(2 * HOUR + 14 * MINUTE + 5 * SECOND)).toBe(
      "2h 14m 5s",
    );
    expect(formatElapsed(DAY - SECOND)).toBe("23h 59m 59s");
  });

  test("drops the seconds from a day on, where they stop meaning anything", () => {
    expect(formatElapsed(DAY)).toBe("1d 0h 0m");
    expect(formatElapsed(2 * DAY + 4 * HOUR + 12 * MINUTE + 33 * SECOND)).toBe(
      "2d 4h 12m",
    );
  });

  test("moves on by exactly one second, second by second", () => {
    const start: number = 2 * MINUTE + 58 * SECOND;

    expect(
      [0, 1, 2, 3].map((tick: number): string => {
        return formatElapsed(start + tick * SECOND);
      }),
    ).toEqual(["2m 58s", "2m 59s", "3m 0s", "3m 1s"]);
  });

  test("never rounds a part second up", () => {
    expect(formatElapsed(54 * SECOND + 999)).toBe("54s");
  });

  test("anything under a second, and a span that has not begun, is 0s", () => {
    // A start a few seconds ahead of the handset's clock is skew, not a future.
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(999)).toBe("0s");
    expect(formatElapsed(-5 * SECOND)).toBe("0s");
  });

  test("a non-finite span does not leak NaN into the UI", () => {
    expect(formatElapsed(Number.NaN)).toBe("0s");
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe("0s");
  });
});

describe("formatDuration", () => {
  test("never shows more than two units", () => {
    expect(formatDuration(2 * DAY + 4 * HOUR + 33 * MINUTE)).toBe("2d 4h");
    expect(formatDuration(3 * HOUR + 12 * MINUTE + 45 * 1000)).toBe("3h 12m");
  });

  test("drops the smaller unit when it is zero", () => {
    expect(formatDuration(3 * HOUR)).toBe("3h");
    expect(formatDuration(2 * DAY)).toBe("2d");
  });

  test("renders minutes below an hour", () => {
    expect(formatDuration(45 * MINUTE)).toBe("45m");
    expect(formatDuration(MINUTE)).toBe("1m");
  });

  test("sub-minute spans are '<1m', not '0m'", () => {
    /*
     * At a handoff boundary these two say opposite things: "<1m" means you are
     * still holding the phone, "0m" reads as already off.
     */
    expect(formatDuration(59 * 1000)).toBe("<1m");
    expect(formatDuration(1)).toBe("<1m");
  });

  test("zero and negative spans collapse to 0m rather than counting backwards", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5 * HOUR)).toBe("0m");
  });

  test("a non-finite span does not leak NaN into the UI", () => {
    expect(formatDuration(Number.NaN)).toBe("0m");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0m");
  });
});

describe("toTimestamp", () => {
  test("returns null for the nulls the roster fields actually carry", () => {
    expect(toTimestamp(null)).toBeNull();
    expect(toTimestamp(undefined)).toBeNull();
    expect(toTimestamp("")).toBeNull();
  });

  test("returns null for an unparseable string instead of NaN", () => {
    expect(toTimestamp("not a date")).toBeNull();
  });

  test("parses an ISO timestamp", () => {
    const date: Date = new Date(2026, 2, 3, 9, 0, 0, 0);
    expect(toTimestamp(date.toISOString())).toBe(date.getTime());
  });
});

describe("formatTimeUntil", () => {
  const now: number = new Date(2026, 2, 3, 12, 0, 0, 0).getTime();

  test("phrases the future with 'in'", () => {
    expect(formatTimeUntil(new Date(now + 3 * HOUR).toISOString(), now)).toBe(
      "in 3h",
    );
  });

  test("phrases the past with 'ago'", () => {
    expect(
      formatTimeUntil(new Date(now - 90 * MINUTE).toISOString(), now),
    ).toBe("1h 30m ago");
  });

  test("collapses the current minute to 'now' on both sides", () => {
    expect(formatTimeUntil(new Date(now + 20 * 1000).toISOString(), now)).toBe(
      "now",
    );
    expect(formatTimeUntil(new Date(now - 20 * 1000).toISOString(), now)).toBe(
      "now",
    );
  });

  test("returns null - not a placeholder - for a missing timestamp", () => {
    /*
     * The caller decides what an absent handoff should say. A formatter that
     * invented "unknown" here would put that string in three different screens
     * that each wanted to say something else.
     */
    expect(formatTimeUntil(null, now)).toBeNull();
  });
});

describe("millisecondsUntil", () => {
  const now: number = new Date(2026, 2, 3, 12, 0, 0, 0).getTime();

  test("measures forward to a future boundary", () => {
    expect(millisecondsUntil(new Date(now + 2 * HOUR).toISOString(), now)).toBe(
      2 * HOUR,
    );
  });

  test("clamps a passed handoff at zero rather than running negative", () => {
    /*
     * The roster is recomputed by a worker, so a handoff can be minutes in the
     * past while the schedule row still says the responder is on. A negative
     * countdown would render as a duration growing the wrong way.
     */
    expect(millisecondsUntil(new Date(now - HOUR).toISOString(), now)).toBe(0);
  });

  test("returns null for a schedule with no computed roster", () => {
    expect(millisecondsUntil(null, now)).toBeNull();
  });
});

/*
 * A SHIFT'S TIME, ON THE PHONE'S OWN CLOCK AND IN ITS LANGUAGE (#8232).
 *
 * The shift cards wrote a 12-hour English clock by hand whatever the phone
 * read, so a 24-hour phone showed "09:00" on an incident's Created row and
 * "Today 9:00 AM" on the shift card beside it. They write through
 * utils/date now, as the detail screens do: the hour as the phone's clock
 * writes it, the weekday and the date in its language, and the app's own
 * words ("Today", "Tomorrow", "Yesterday", "From", "Until") in English, as
 * every other word of the app is.
 *
 * Each language is named (options.locale) and read on its own clock; the
 * phone's own clock is stood in for below. Dates are built from local
 * components, so the expectations hold in any zone. A space, a no-break
 * space or a narrow one read the same, and Intl writes each of them on
 * one engine or another, so the text is compared with its spaces made
 * plain.
 */

// A space, a no-break space or a narrow one: the same to a reader.
function spaced(text: string | null): string | null {
  return text === null ? null : text.replace(/\s/g, " ");
}

// Each time of day a text holds, as written: its hour and its minutes.
const TIME_OF_DAY: RegExp = /(\d{1,2})[:.](\d{2})/g;

function hoursOf(text: string | null): Array<string> {
  return Array.from((text || "").matchAll(TIME_OF_DAY)).map(
    (match: RegExpMatchArray): string => {
      return match[1] || "";
    },
  );
}

// Tuesday 3 March 2026, noon, on the phone's own wall clock.
const NOON_TUESDAY: number = new Date(2026, 2, 3, 12, 0, 0, 0).getTime();

const EVENING_TODAY: string = new Date(2026, 2, 3, 18, 0).toISOString();
const MORNING_TOMORROW: string = new Date(2026, 2, 4, 9, 0).toISOString();
const MORNING_YESTERDAY: string = new Date(2026, 2, 2, 9, 0).toISOString();
// 2026-03-06 is a Friday.
const FRIDAY_MORNING: string = new Date(2026, 2, 6, 9, 30).toISOString();
const A_FORTNIGHT_OUT: string = new Date(2026, 2, 20, 9, 0).toISOString();
const JUST_AFTER_MIDNIGHT: string = new Date(2026, 2, 3, 0, 5).toISOString();
const NOON_TODAY: string = new Date(2026, 2, 3, 12, 0).toISOString();
const MORNING_TODAY: string = new Date(2026, 2, 3, 9, 0).toISOString();

function shiftTime(
  value: string | null | undefined,
  locale: string,
): string | null {
  return spaced(formatShiftTime(value, NOON_TUESDAY, { locale }));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("formatShiftTime on a 12-hour clock (US English)", () => {
  test("anchors today, tomorrow and yesterday by name", () => {
    expect(shiftTime(EVENING_TODAY, "en-US")).toBe("Today 6:00 PM");
    expect(shiftTime(MORNING_TOMORROW, "en-US")).toBe("Tomorrow 9:00 AM");
    expect(shiftTime(MORNING_YESTERDAY, "en-US")).toBe("Yesterday 9:00 AM");
  });

  test("uses the weekday inside the coming week", () => {
    expect(shiftTime(FRIDAY_MORNING, "en-US")).toBe("Fri 9:30 AM");
  });

  test("falls back to a date beyond a week out, as the detail screens write one", () => {
    /*
     * "Tue" a fortnight away is a trap - the reader assumes the nearer Tuesday.
     */
    expect(shiftTime(A_FORTNIGHT_OUT, "en-US")).toBe("Mar 20, 9:00 AM");
  });

  test("renders midnight and noon as 12, not 0, with no leading zero", () => {
    expect(shiftTime(JUST_AFTER_MIDNIGHT, "en-US")).toBe("Today 12:05 AM");
    expect(shiftTime(NOON_TODAY, "en-US")).toBe("Today 12:00 PM");
  });

  test("returns null for a missing timestamp", () => {
    expect(formatShiftTime(undefined, NOON_TUESDAY)).toBeNull();
    expect(formatShiftTime(null, NOON_TUESDAY, { locale: "en-US" })).toBeNull();
    expect(formatShiftTime("not a date", NOON_TUESDAY)).toBeNull();
  });
});

describe("formatShiftTime on a 24-hour clock (British English)", () => {
  test("keeps the zero, and writes the afternoon past 12", () => {
    expect(shiftTime(EVENING_TODAY, "en-GB")).toBe("Today 18:00");
    expect(shiftTime(MORNING_TOMORROW, "en-GB")).toBe("Tomorrow 09:00");
    expect(shiftTime(MORNING_YESTERDAY, "en-GB")).toBe("Yesterday 09:00");
  });

  test("the weekday and the date in British order", () => {
    expect(shiftTime(FRIDAY_MORNING, "en-GB")).toBe("Fri 09:30");
    expect(shiftTime(A_FORTNIGHT_OUT, "en-GB")).toBe("20 Mar, 09:00");
  });

  test("midnight is 00, noon is 12", () => {
    expect(shiftTime(JUST_AFTER_MIDNIGHT, "en-GB")).toBe("Today 00:05");
    expect(shiftTime(NOON_TODAY, "en-GB")).toBe("Today 12:00");
  });
});

describe("formatShiftTime in the phone's language, on its clock", () => {
  test.each<[string, Record<string, string>]>([
    [
      "de",
      {
        evening: "Today 18:00",
        friday: "Fr., 09:30",
        fortnight: "20. März, 09:00",
      },
    ],
    [
      "fr",
      {
        evening: "Today 18:00",
        friday: "ven. 09:30",
        fortnight: "20 mars, 09:00",
      },
    ],
    [
      "ja",
      {
        evening: "Today 18:00",
        friday: "09:30 (金)",
        fortnight: "3月20日 09:00",
      },
    ],
    [
      "ko",
      {
        evening: "Today 오후 6:00",
        friday: "(금) 오전 9:30",
        fortnight: "3월 20일 오전 9:00",
      },
    ],
    [
      "zh-TW",
      {
        evening: "Today 下午6:00",
        friday: "週五上午9:30",
        fortnight: "3月20日 上午9:00",
      },
    ],
    [
      "ar",
      {
        evening: "Today 6:00 م",
        friday: "الجمعة 9:30 ص",
        fortnight: "20 مارس، 9:00 ص",
      },
    ],
  ])("in %s", (locale: string, written: Record<string, string>) => {
    expect({
      evening: shiftTime(EVENING_TODAY, locale),
      friday: shiftTime(FRIDAY_MORNING, locale),
      fortnight: shiftTime(A_FORTNIGHT_OUT, locale),
    }).toEqual(written);
  });

  test.each(["en-US", "ko", "zh-TW", "hi", "ar"])(
    "%s, a 12-hour clock: no zero before the hour, morning or evening",
    (locale: string) => {
      for (const value of [MORNING_TODAY, EVENING_TODAY, FRIDAY_MORNING]) {
        const written: string | null = shiftTime(value, locale);

        expect({ written, hours: hoursOf(written) }).toEqual({
          written,
          hours: [
            value === FRIDAY_MORNING || value === MORNING_TODAY ? "9" : "6",
          ],
        });
      }
    },
  );

  test.each(["en-GB", "de", "fr", "ja", "ru"])(
    "%s, a 24-hour clock: the zero kept in the morning, 18 in the evening",
    (locale: string) => {
      expect(hoursOf(shiftTime(MORNING_TODAY, locale))).toEqual(["09"]);
      expect(hoursOf(shiftTime(FRIDAY_MORNING, locale))).toEqual(["09"]);
      expect(hoursOf(shiftTime(EVENING_TODAY, locale))).toEqual(["18"]);
    },
  );

  test("the app's own words stay English in every language", () => {
    for (const locale of ["de", "ja", "ko", "ar", "ru"]) {
      expect(shiftTime(EVENING_TODAY, locale)).toMatch(/^Today /);
      expect(shiftTime(MORNING_TOMORROW, locale)).toMatch(/^Tomorrow /);
      expect(shiftTime(MORNING_YESTERDAY, locale)).toMatch(/^Yesterday /);
    }
  });
});

/*
 * What the cards call - no locale named - writes on the phone's own clock:
 * Intl's report of the clock is stood in for, the phone's language left as
 * it is, so these hold whatever language the suite runs in.
 */
describe("on the phone's own clock", () => {
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

  test("a 12-hour phone reads the issue's 9:00, never 09:00", () => {
    onAPhoneThatReads(true);

    const morning: string | null = formatShiftTime(MORNING_TODAY, NOON_TUESDAY);
    const evening: string | null = formatShiftTime(EVENING_TODAY, NOON_TUESDAY);

    expect(morning).toMatch(/^Today /);
    expect(hoursOf(morning)).toEqual(["9"]);
    expect(hoursOf(evening)).toEqual(["6"]);
    expect(morning).not.toBe(
      formatShiftTime(new Date(2026, 2, 3, 21, 0).toISOString(), NOON_TUESDAY),
    );
  });

  test("a 24-hour phone reads 09:00 and 18:00: what the issue saw as 9:00 AM", () => {
    onAPhoneThatReads(false);

    const morning: string | null = formatShiftTime(MORNING_TODAY, NOON_TUESDAY);
    const evening: string | null = formatShiftTime(EVENING_TODAY, NOON_TUESDAY);

    expect(morning).toMatch(/^Today /);
    expect(hoursOf(morning)).toEqual(["09"]);
    expect(hoursOf(evening)).toEqual(["18"]);
    expect(morning).not.toMatch(/AM|PM/);
  });

  test.each([true, false])(
    "the shift card and the detail screen write one time of day alike (12-hour: %p)",
    (twelveHour: boolean) => {
      onAPhoneThatReads(twelveHour);

      for (const value of [
        MORNING_TODAY,
        EVENING_TODAY,
        FRIDAY_MORNING,
        A_FORTNIGHT_OUT,
      ]) {
        const onTheCard: string | null = formatShiftTime(value, NOON_TUESDAY);
        const onTheDetailScreen: string = formatDateTime(value);

        expect(
          Array.from((onTheCard || "").matchAll(TIME_OF_DAY))[0]?.[0],
        ).toBe(Array.from(onTheDetailScreen.matchAll(TIME_OF_DAY))[0]?.[0]);
      }
    },
  );

  test("unmocked, the phone's own clock decides", () => {
    expect(hoursOf(formatShiftTime(MORNING_TODAY, NOON_TUESDAY))).toEqual([
      uses12HourClock() ? "9" : "09",
    ]);
  });
});

describe("formatShiftWindow", () => {
  test("renders both ends when both are known, on either clock", () => {
    expect(
      spaced(
        formatShiftWindow(MORNING_TODAY, MORNING_TOMORROW, NOON_TUESDAY, {
          locale: "en-US",
        }),
      ),
    ).toBe("Today 9:00 AM → Tomorrow 9:00 AM");
    expect(
      spaced(
        formatShiftWindow(MORNING_TODAY, MORNING_TOMORROW, NOON_TUESDAY, {
          locale: "en-GB",
        }),
      ),
    ).toBe("Today 09:00 → Tomorrow 09:00");
  });

  test("renders the half it has when a rotation has no computed handoff", () => {
    expect(
      spaced(
        formatShiftWindow(MORNING_TODAY, null, NOON_TUESDAY, {
          locale: "en-US",
        }),
      ),
    ).toBe("From Today 9:00 AM");

    expect(
      spaced(
        formatShiftWindow(null, MORNING_TOMORROW, NOON_TUESDAY, {
          locale: "en-GB",
        }),
      ),
    ).toBe("Until Tomorrow 09:00");
  });

  test("both ends in the phone's language", () => {
    expect(
      spaced(
        formatShiftWindow(MORNING_TOMORROW, FRIDAY_MORNING, NOON_TUESDAY, {
          locale: "de",
        }),
      ),
    ).toBe("Tomorrow 09:00 → Fr., 09:30");
  });

  test("returns null when neither end is known", () => {
    expect(formatShiftWindow(null, null, NOON_TUESDAY)).toBeNull();
  });
});
