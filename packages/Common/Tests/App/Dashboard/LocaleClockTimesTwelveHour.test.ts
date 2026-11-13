/** @timezone UTC */

import { afterEach, describe, expect, test } from "@jest/globals";
import {
  forgetRememberedDateTexts,
  getDateLocale,
  getLocaleClockHourOption,
  getNumberLocale,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import { formatTimeLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Export/PdfChart";
import { formatConnectionLocalDate } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnosticsUtil";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * A TIME ON ITS LANGUAGE'S OWN CLOCK HAS NO 12-HOUR ZERO (issue #7279).
 *
 * Some times follow the language's clock rather than the reader's 12- or
 * 24-hour setting: a chart's axis in an AI chat's PDF, a security
 * connection's "Local time" title, a calendar's grid. They asked Intl for a
 * two-digit hour, which a 24-hour language wants ("05:14") but which wrote
 * "오전 05:14", "上午05:14", "05:14 am", "05:14 ص" and "05:14 AM" on a
 * 12-hour one. getLocaleClockHourOption asks for the hour each clock writes.
 */

const MORNING: Date = new Date("2025-11-05T05:14:00.000Z");

const ONE_HOUR: number = 60 * 60 * 1000;
const ONE_DAY: number = 24 * ONE_HOUR;

const TWELVE_HOUR_LANGUAGES: ReadonlyArray<string> = [
  "ar",
  "hi",
  "ko",
  "zh-TW",
];

const ANY_SPACE: RegExp = /\s/g;
// "5:14", "05.14", "۰۵:۱۴", or Korean's "5시 14분".
const TIME_OF_DAY: RegExp = /(\p{Nd}{1,2})(?:[:.]\p{Nd}{2}|시 )/gu;

const spaced: (text: string) => string = (text: string): string => {
  return text.replace(ANY_SPACE, " ");
};

// How many digits each written hour has: [1] for "5:14", [2] for "05:14".
const hourDigits: (text: string) => Array<number> = (
  text: string,
): Array<number> => {
  return Array.from(text.matchAll(TIME_OF_DAY)).map(
    (match: RegExpMatchArray): number => {
      return Array.from(match[1] || "").length;
    },
  );
};

afterEach(() => {
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
});

describe("the hour asked of a language's own clock", () => {
  test.each<[string, "numeric" | "2-digit"]>([
    ["en-US", "numeric"],
    ["ko", "numeric"],
    ["zh-TW", "numeric"],
    ["hi", "numeric"],
    ["en-GB", "2-digit"],
    ["de", "2-digit"],
    ["ja", "2-digit"],
    ["zh-CN", "2-digit"],
  ])("%s: %s", (locale: string, hour: "numeric" | "2-digit") => {
    expect(getLocaleClockHourOption(locale)).toBe(hour);
    // Asked again, the same answer (it is remembered).
    expect(getLocaleClockHourOption(locale)).toBe(hour);
  });

  test("a locale Intl refuses keeps the two-digit hour it had", () => {
    expect(getLocaleClockHourOption("xx-not-a-language-tag-")).toBe("2-digit");
  });

  test.each(
    DASHBOARD_LANGUAGES.map((code: string): [string] => {
      return [code];
    }),
  )(
    "%s: numeric on its 12-hour clock, two digits on its 24-hour one",
    (language: string) => {
      const expected: "numeric" | "2-digit" = TWELVE_HOUR_LANGUAGES.includes(
        language,
      )
        ? "numeric"
        : "2-digit";

      expect(
        getLocaleClockHourOption(getNumberLocale(language) || language),
      ).toBe(expected);
      expect(getLocaleClockHourOption(getDateLocale(language))).toBe(expected);
    },
  );
});

describe("a chart's time on an AI chat's PDF", () => {
  test.each<[string, string, string]>([
    ["ko", "오전 5:14", "11월 5일 오전 5:14"],
    ["zh-TW", "上午5:14", "11月5日 上午5:14"],
    ["hi", "5:14 am", "5 नव॰, 5:14 am"],
    ["ar", "5:14 ص", "5 نوفمبر، 5:14 ص"],
    ["de", "05:14", "5. Nov., 05:14"],
    ["ja", "05:14", "11月5日 05:14"],
  ])(
    "%s: %s within two hours, %s within two days",
    (language: string, time: string, dayAndTime: string) => {
      setDateDisplayLanguage(language);

      expect(spaced(formatTimeLabel(MORNING, ONE_HOUR))).toBe(time);
      expect(spaced(formatTimeLabel(MORNING, ONE_DAY))).toBe(dayAndTime);
    },
  );

  test("Persian keeps its zero, in its own digits", () => {
    setDateDisplayLanguage("fa");

    const time: string = formatTimeLabel(MORNING, ONE_HOUR);

    expect(time).toContain("۰۵:۱۴");
    expect(hourDigits(time)).toEqual([2]);
  });

  test("English on a 12-hour clock: 5:14 AM, as every other English time", () => {
    setDateDisplayLanguage("en");

    // The runtime's English is en-US here, a 12-hour clock.
    expect(spaced(formatTimeLabel(MORNING, ONE_HOUR))).toBe("5:14 AM");
    expect(spaced(formatTimeLabel(MORNING, ONE_DAY))).toBe("Nov 5, 5:14 AM");
  });

  test.each(
    DASHBOARD_LANGUAGES.map((code: string): [string] => {
      return [code];
    }),
  )(
    "%s: no zero on its 12-hour clock, the zero on its 24-hour one",
    (language: string) => {
      setDateDisplayLanguage(language);

      const digits: number = TWELVE_HOUR_LANGUAGES.includes(language) ? 1 : 2;
      const time: string = formatTimeLabel(MORNING, ONE_HOUR);
      const dayAndTime: string = formatTimeLabel(MORNING, ONE_DAY);

      expect({ time, hours: hourDigits(time) }).toEqual({
        time,
        hours: [digits],
      });
      expect({ dayAndTime, hours: hourDigits(dayAndTime) }).toEqual({
        dayAndTime,
        hours: [digits],
      });
    },
  );

  test("a span of weeks names only the day, with no time at all", () => {
    setDateDisplayLanguage("ko");

    expect(hourDigits(formatTimeLabel(MORNING, 30 * ONE_DAY))).toEqual([]);
  });
});

describe("a security connection's local time", () => {
  test.each<[string, string]>([
    ["ko", "2025년 11월 05일 오전 5시 14분 0초 UTC"],
    ["zh-TW", "2025年11月05日 上午5:14:00 [UTC]"],
    ["hi", "05 नव॰ 2025, 5:14:00 am UTC"],
    ["ar", "05 نوفمبر 2025، 5:14:00 ص UTC"],
    ["de", "05. Nov. 2025, 05:14:00 UTC"],
    ["ja", "2025年11月05日 05:14:00 UTC"],
    ["en", "Nov 05, 2025, 5:14:00 AM UTC"],
  ])("%s: %s", (language: string, local: string) => {
    setDateDisplayLanguage(language);

    expect(spaced(formatConnectionLocalDate(MORNING))).toBe(local);
  });

  test.each(
    DASHBOARD_LANGUAGES.map((code: string): [string] => {
      return [code];
    }),
  )(
    "%s: no zero on its 12-hour clock, the zero on its 24-hour one",
    (language: string) => {
      setDateDisplayLanguage(language);

      const local: string = formatConnectionLocalDate(MORNING);
      const digits: number = TWELVE_HOUR_LANGUAGES.includes(language) ? 1 : 2;

      expect({ local, hours: hourDigits(local) }).toEqual({
        local,
        hours: [digits],
      });
    },
  );
});
