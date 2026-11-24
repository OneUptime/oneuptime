/** @timezone UTC */

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import {
  forgetRememberedDateTexts,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import { formatTimeLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Export/PdfChart";
import { formatConnectionLocalDate } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnosticsUtil";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * A PDF CHART'S AXIS AND A CONNECTION'S LOCAL TIME ARE ON THE READER'S
 * CLOCK (#7651), WITH NO 12-HOUR ZERO (#7279).
 *
 * A chart's axis in an AI chat's PDF and a security connection's "Local
 * time" title followed their language's own clock, not the reader's 12- or
 * 24-hour one (OneUptimeDate.getUserPrefers12HourFormat): a German reader
 * on a 12-hour clock read "17:14" there beside every table's "5:14 PM".
 * They follow the reader's clock now, as every other time on the page, and
 * the connection's time is written by OneUptimeDate, which names its zone
 * from moment's data (#10038): "MST" in Vancouver, where Intl said "PDT".
 */

const MORNING: Date = new Date("2025-11-05T05:14:00.000Z");

const ONE_HOUR: number = 60 * 60 * 1000;
const ONE_DAY: number = 24 * ONE_HOUR;

const ANY_SPACE: RegExp = /\s/g;
// "5:14", "05.14", "۰۵:۱۴".
const TIME_OF_DAY: RegExp = /(\p{Nd}{1,2})[:.]\p{Nd}{2}/gu;

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

// The reader's clock: a 12-hour one, or a 24-hour one.
const onClock: (twelveHour: boolean) => void = (twelveHour: boolean): void => {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(twelveHour);
};

afterEach(() => {
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
});

describe("a chart's time on an AI chat's PDF", () => {
  // The issue's readers: German and Japanese on a 12-hour clock.
  test.each<[string, string, string]>([
    ["de", "5:14 AM", "5. Nov., 5:14 AM"],
    ["ja", "午前5:14", "11月5日 午前5:14"],
    ["en", "5:14 AM", "Nov 5, 5:14 AM"],
  ])(
    "%s on a 12-hour clock: %s within two hours, %s within two days",
    (language: string, time: string, dayAndTime: string) => {
      onClock(true);
      setDateDisplayLanguage(language);

      expect(spaced(formatTimeLabel(MORNING, ONE_HOUR))).toBe(time);
      expect(spaced(formatTimeLabel(MORNING, ONE_DAY))).toBe(dayAndTime);
    },
  );

  // And English and Korean on a 24-hour one.
  test.each<[string, string, string]>([
    ["en", "05:14", "Nov 5, 05:14"],
    ["ko", "05:14", "11월 5일 05:14"],
    ["de", "05:14", "5. Nov., 05:14"],
    ["da", "05.14", "5. nov., 05.14"],
  ])(
    "%s on a 24-hour clock: %s within two hours, %s within two days",
    (language: string, time: string, dayAndTime: string) => {
      onClock(false);
      setDateDisplayLanguage(language);

      expect(spaced(formatTimeLabel(MORNING, ONE_HOUR))).toBe(time);
      expect(spaced(formatTimeLabel(MORNING, ONE_DAY))).toBe(dayAndTime);
    },
  );

  test("Persian keeps its zero on a 24-hour clock, in its own digits", () => {
    onClock(false);
    setDateDisplayLanguage("fa");

    const time: string = formatTimeLabel(MORNING, ONE_HOUR);

    expect(time).toContain("۰۵:۱۴");
    expect(hourDigits(time)).toEqual([2]);
  });

  test.each(
    DASHBOARD_LANGUAGES.map((code: string): [string] => {
      return [code];
    }),
  )(
    "%s: no zero on a 12-hour clock, the zero on a 24-hour one",
    (language: string) => {
      setDateDisplayLanguage(language);

      for (const twelveHour of [true, false]) {
        onClock(twelveHour);

        const digits: number = twelveHour ? 1 : 2;
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
      }
    },
  );

  test("the axis reads the time a table on the same page reads", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      setDateDisplayLanguage(language);

      for (const twelveHour of [true, false]) {
        onClock(twelveHour);

        expect(spaced(formatTimeLabel(MORNING, ONE_HOUR))).toBe(
          spaced(
            OneUptimeDate.getLocalTimeString(MORNING, {
              use12HourFormat: twelveHour,
            }),
          ),
        );
      }
    }
  });

  test("a span of weeks names only the day, with no time at all", () => {
    setDateDisplayLanguage("ko");

    expect(hourDigits(formatTimeLabel(MORNING, 30 * ONE_DAY))).toEqual([]);
  });
});

describe("a security connection's local time", () => {
  /*
   * In the reader's zone (issue #8231): here they picked none, and the
   * browser is on UTC, which reads as UTC (issue #8475), not as moment's
   * Africa/Abidjan ("GMT").
   */
  test("is in the zone the reader picked, and names it, wherever the browser is", () => {
    onClock(true);
    setDateDisplayLanguage("en");
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    expect(spaced(formatConnectionLocalDate(MORNING))).toBe(
      "Nov 5, 2025, 12:14:00 AM EST",
    );

    onClock(false);
    OneUptimeDate.setUserTimezone(Timezone.AsiaKathmandu);
    setDateDisplayLanguage("de");

    expect(spaced(formatConnectionLocalDate(MORNING))).toBe(
      "5. Nov. 2025, 10:59:00 GMT+0545",
    );
  });

  test("names British Columbia's winter time as every other date does: MST, not CLDR's PDT", () => {
    onClock(true);
    OneUptimeDate.setUserTimezone(Timezone.AmericaVancouver);

    for (const language of ["en", "de", "fr"]) {
      setDateDisplayLanguage(language);

      const local: string = formatConnectionLocalDate(
        new Date("2026-11-20T12:00:00Z"),
      );

      expect(local).toContain("MST");
      expect(local).not.toContain("PDT");
      expect(local).not.toContain("GMT-7");
    }
  });

  test.each<[string, string]>([
    ["de", "5. Nov. 2025, 5:14:00 AM UTC"],
    ["ja", "2025年11月5日 午前5:14:00 UTC"],
    ["ko", "2025년 11월 5일 오전 5:14:00 UTC"],
    ["ar", "5 نوفمبر 2025، 5:14:00 ص UTC"],
    ["en", "Nov 5, 2025, 5:14:00 AM UTC"],
  ])("%s on a 12-hour clock: %s", (language: string, local: string) => {
    onClock(true);
    setDateDisplayLanguage(language);

    expect(spaced(formatConnectionLocalDate(MORNING))).toBe(local);
  });

  test.each<[string, string]>([
    ["en", "Nov 5, 2025, 05:14:00 UTC"],
    ["ko", "2025년 11월 5일 05:14:00 UTC"],
    ["de", "5. Nov. 2025, 05:14:00 UTC"],
  ])("%s on a 24-hour clock: %s", (language: string, local: string) => {
    onClock(false);
    setDateDisplayLanguage(language);

    expect(spaced(formatConnectionLocalDate(MORNING))).toBe(local);
  });

  test.each(
    DASHBOARD_LANGUAGES.map((code: string): [string] => {
      return [code];
    }),
  )(
    "%s: no zero on a 12-hour clock, the zero on a 24-hour one",
    (language: string) => {
      setDateDisplayLanguage(language);

      for (const twelveHour of [true, false]) {
        onClock(twelveHour);

        const local: string = formatConnectionLocalDate(MORNING);

        expect({ local, hours: hourDigits(local) }).toEqual({
          local,
          hours: [twelveHour ? 1 : 2],
        });
      }
    },
  );
});
