/** @timezone UTC */

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../Types/Date";
import {
  getDateLocale,
  getDecimalSeparator,
  getTimeSeparator,
  setDateDisplayLanguage,
  writeClockInLocale,
} from "../../Types/DateLanguage";
import Timezone from "../../Types/Timezone";
import { DASHBOARD_LANGUAGES } from "../Helpers/TranslatedLanguages";

/*
 * ONE PAGE, ONE MARK BETWEEN A TIME'S HOURS AND MINUTES (#7914).
 *
 * Intl writes a time with the mark its language puts there, as CLDR
 * records it: a point in Danish ("10.05", CLDR's "HH.mm", the way Danish
 * orthography and a Danish reader's own phone and computer write a time)
 * and a colon in every other language the Dashboard speaks. Moment, and
 * the times OneUptime writes by hand, always wrote a colon, so a Danish
 * page read "10.05" from Intl beside "10:05" from moment. Every writer of
 * a time of day now takes the language's mark.
 */

// 10:05:07.120 UTC.
const MOMENT: Date = new Date("2026-10-06T10:05:07.120Z");

const DIGIT: RegExp = /\p{Nd}/gu;

// The marks between a time's figures: ":" or "." (and ":" or "," before a fraction).
const marksOf: (text: string) => string = (text: string): string => {
  return Array.from(text.matchAll(/\p{Nd}([:.,٫])(?=\p{Nd})/gu))
    .map((match: RegExpMatchArray): string => {
      return match[1] || "";
    })
    .join("");
};

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.UTC);
});

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage("en");
});

// Every writer of a time of day on a 24-hour clock.
const WRITERS: ReadonlyArray<[string, () => string]> = [
  [
    "Intl's HH:mm",
    (): string => {
      return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
        date: MOMENT,
        format: "HH:mm",
      });
    },
  ],
  [
    "getLocalTimeString",
    (): string => {
      return OneUptimeDate.getLocalTimeString(MOMENT);
    },
  ],
  [
    "getHourAndMinuteInTimezoneString",
    (): string => {
      return OneUptimeDate.getHourAndMinuteInTimezoneString(
        MOMENT,
        Timezone.UTC,
      );
    },
  ],
  [
    "getTimeStringInTimezone",
    (): string => {
      return OneUptimeDate.getTimeStringInTimezone(MOMENT, {
        timezone: Timezone.UTC,
        use12HourFormat: false,
      });
    },
  ],
  [
    "getClockTimeString",
    (): string => {
      return OneUptimeDate.getClockTimeString(10, 5, {
        use12HourFormat: false,
      });
    },
  ],
  [
    "a whole date's time",
    (): string => {
      return OneUptimeDate.getDateAsLocalFormattedString(MOMENT, false, false);
    },
  ],
];

describe("the mark a language writes between a time's parts", () => {
  test("is CLDR's: a point in Danish, a colon in every other language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect({
        language,
        mark: getTimeSeparator(getDateLocale(language)),
      }).toEqual({ language, mark: language === "da" ? "." : ":" });
    }
  });

  test("an unknown language reads English's colon", () => {
    expect(getTimeSeparator(getDateLocale("xx-not-a-language-tag-"))).toBe(":");
  });

  test.each(
    DASHBOARD_LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: every writer of a time uses the same mark for the same time",
    (language: string) => {
      setDateDisplayLanguage(language);

      const expected: string = language === "da" ? "." : ":";

      for (const [name, write] of WRITERS) {
        const text: string = write();

        expect({ name, text, mark: marksOf(text).charAt(0) }).toEqual({
          name,
          text,
          mark: expected,
        });
      }

      // And the time to the second, which moment writes.
      expect(
        marksOf(
          OneUptimeDate.getLocalTimeString(MOMENT, { includeSeconds: true }),
        ),
      ).toBe(`${expected}${expected}`);
    },
  );
});

describe("a clock OneUptime writes itself", () => {
  test.each<[string, string, string]>([
    ["da", "09:30", "09.30"],
    ["da", "14:30:12", "14.30.12"],
    ["da", "11:55:59.120", "11.55.59,120"],
    ["de", "11:55:59.120", "11:55:59.120"],
    ["fa", "09:30", "۰۹:۳۰"],
    ["fa", "11:55:59.120", "۱۱:۵۵:۵۹.۱۲۰"],
    ["ar", "09:30", "09:30"],
    ["en", "9:30", "9:30"],
  ])("%s: %s reads %s", (language: string, clock: string, written: string) => {
    expect(writeClockInLocale(clock, getDateLocale(language))).toBe(written);
  });

  test("text that is no clock only takes the digits", () => {
    expect(writeClockInLocale("05", getDateLocale("fa"))).toBe("۰۵");
    expect(writeClockInLocale("10:05 PM", getDateLocale("da"))).toBe(
      "10:05 PM",
    );
    expect(writeClockInLocale("5:1", getDateLocale("da"))).toBe("5:1");
  });

  test("Danish's milliseconds take its decimal comma, a point would read as one more part", () => {
    expect(getDecimalSeparator(getDateLocale("da"))).toBe(",");
    expect(getDecimalSeparator(getDateLocale("en"))).toBe(".");
  });

  test("Danish is remembered with its English, for a sentence still in English", () => {
    setDateDisplayLanguage("da");

    const time: string = OneUptimeDate.getLocalTimeString(MOMENT);

    expect(time).toBe("10.05");
    expect(time.replace(DIGIT, "0")).toBe("00.00");
  });
});
