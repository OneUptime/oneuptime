/** @timezone UTC */

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../Types/Date";
import {
  forgetRememberedDateTexts,
  getEnglishOf,
  setDateDisplayLanguage,
} from "../../Types/DateLanguage";
import Timezone from "../../Types/Timezone";

/*
 * A CHART'S AXIS NAMES ITS DAYS AND HOURS AS THE READER'S LANGUAGE DOES.
 *
 * A time chart whose window spans days names its ticks with the day and
 * the time (OneUptimeDate's getDateAsLocalDayMonthHourString and
 * getDateAsLocalDayMonthTimeString, XAxis.ts), and a longer one with the
 * day alone (getDateAsLocalDayMonthString). The two halves were joined by
 * hand with English's Latin comma, after a day with English's leading
 * zero: a Persian axis read "۰۱ نوامبر, ۰۰:۴۵" - a Latin comma where Persian
 * writes its own, and a leading zero Persian draws as a dot - and a
 * Japanese one "11月01日, 00:45". In every language but English the day
 * and the time are now written, and joined, as the language writes a date
 * with its time (Intl). English reads exactly as it did.
 *
 * The instant is 00:45:07 UTC on November 1, 2026; the reader's zone is
 * UTC, so its hour starts at 00:00.
 */

const INSTANT: Date = new Date("2026-11-01T00:45:07Z");

// A space, a no-break space or a narrow one: the same to a reader.
const ANY_SPACE: RegExp = /\s/g;

const spaced: (text: string) => string = (text: string): string => {
  return text.replace(ANY_SPACE, " ");
};

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.UTC);
});

afterEach(() => {
  setDateDisplayLanguage(null);
  OneUptimeDate.setUserTimezone(null);
  forgetRememberedDateTexts();
});

interface AxisLabels {
  day: string;
  hour: string;
  time: string;
  timeWithSeconds: string;
}

const axisLabels: () => AxisLabels = (): AxisLabels => {
  return {
    day: spaced(OneUptimeDate.getDateAsLocalDayMonthString(INSTANT)),
    hour: spaced(OneUptimeDate.getDateAsLocalDayMonthHourString(INSTANT)),
    time: spaced(OneUptimeDate.getDateAsLocalDayMonthTimeString(INSTANT)),
    timeWithSeconds: spaced(
      OneUptimeDate.getDateAsLocalDayMonthTimeString(INSTANT, {
        includeSeconds: true,
      }),
    ),
  };
};

describe("English, as it always read", () => {
  test("the day with its leading zero, joined to the time with a comma", () => {
    expect(axisLabels()).toEqual({
      day: "01 Nov",
      hour: "01 Nov, 00:00",
      time: "01 Nov, 00:45",
      timeWithSeconds: "01 Nov, 00:45:07",
    });
  });

  test("nothing set reads English too", () => {
    setDateDisplayLanguage("en");

    expect(axisLabels().hour).toBe("01 Nov, 00:00");
  });
});

describe("Persian", () => {
  test("the Persian comma, Persian digits, and no leading zero", () => {
    setDateDisplayLanguage("fa");

    expect(axisLabels()).toEqual({
      day: "۱ نوامبر",
      hour: "۱ نوامبر، ۰۰:۰۰",
      time: "۱ نوامبر، ۰۰:۴۵",
      timeWithSeconds: "۱ نوامبر، ۰۰:۴۵:۰۷",
    });
  });

  test("no Latin comma and no Latin digit is left on the axis", () => {
    setDateDisplayLanguage("fa");

    for (const label of Object.values(axisLabels())) {
      expect(label).not.toContain(",");
      expect(label).not.toMatch(/[0-9]/);
      // Never the day's leading zero, which Persian draws as a dot.
      expect(label.startsWith("۰")).toBe(false);
    }
  });

  test("each label is remembered with its English, for a sentence still in English", () => {
    setDateDisplayLanguage("fa");

    const labels: AxisLabels = axisLabels();

    expect(
      getEnglishOf(OneUptimeDate.getDateAsLocalDayMonthString(INSTANT)),
    ).toBe("01 Nov");
    expect(
      getEnglishOf(OneUptimeDate.getDateAsLocalDayMonthHourString(INSTANT)),
    ).toBe("01 Nov, 00:00");
    expect(
      getEnglishOf(OneUptimeDate.getDateAsLocalDayMonthTimeString(INSTANT)),
    ).toBe("01 Nov, 00:45");
    expect(labels.time).toBe("۱ نوامبر، ۰۰:۴۵");
  });
});

describe("every other language, as it writes a date with its time", () => {
  test.each([
    ["de", "1. Nov.", "1. Nov., 00:00", "1. Nov., 00:45"],
    ["fr", "1 nov.", "1 nov., 00:00", "1 nov., 00:45"],
    ["ru", "1 нояб.", "1 нояб., 00:00", "1 нояб., 00:45"],
    ["hi", "1 नव॰", "1 नव॰, 00:00", "1 नव॰, 00:45"],
    ["ja", "11月1日", "11月1日 00:00", "11月1日 00:45"],
    ["zh-CN", "11月1日", "11月1日 00:00", "11月1日 00:45"],
    ["ko", "11월 1일", "11월 1일 00:00", "11월 1일 00:45"],
  ])(
    "%s: %s / %s / %s",
    (language: string, day: string, hour: string, time: string) => {
      setDateDisplayLanguage(language);

      const labels: AxisLabels = axisLabels();

      expect(labels.day).toBe(day);
      expect(labels.hour).toBe(hour);
      expect(labels.time).toBe(time);
    },
  );

  test("Japanese and Chinese join the day and the time with no comma", () => {
    for (const language of ["ja", "zh-CN", "zh-TW"]) {
      setDateDisplayLanguage(language);

      for (const label of Object.values(axisLabels())) {
        expect(label).not.toContain(",");
      }
    }
  });
});

describe("a day and a time shown to a person, in their 12-hour clock", () => {
  test("English writes the 12-hour time after the day, as before", () => {
    expect(
      spaced(
        OneUptimeDate.getDateAsLocalDayMonthTimeString(INSTANT, {
          use12HourFormat: true,
        }),
      ),
    ).toBe("01 Nov, 12:45 AM");
  });

  test("Persian writes its own 12-hour time, joined with its own comma", () => {
    setDateDisplayLanguage("fa");

    const label: string = spaced(
      OneUptimeDate.getDateAsLocalDayMonthTimeString(INSTANT, {
        use12HourFormat: true,
      }),
    );

    expect(label.startsWith("۱ نوامبر، ")).toBe(true);
    expect(label).toContain("۱۲:۴۵");
    expect(label).not.toMatch(/[0-9]/);
  });

  test("an axis keeps its 24-hour clock unless asked", () => {
    setDateDisplayLanguage("de");

    expect(
      spaced(OneUptimeDate.getDateAsLocalDayMonthTimeString(INSTANT)),
    ).toBe("1. Nov., 00:45");
  });
});

describe("the hour a bucket starts at", () => {
  test("is the start of the hour in the reader's zone, minutes and all", () => {
    // Kolkata is 5:30 ahead of UTC: 00:45 UTC is 06:15 there, in the 06:00 hour.
    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

    expect(
      spaced(OneUptimeDate.getDateAsLocalDayMonthHourString(INSTANT)),
    ).toBe("01 Nov, 06:00");

    setDateDisplayLanguage("de");

    expect(
      spaced(OneUptimeDate.getDateAsLocalDayMonthHourString(INSTANT)),
    ).toBe("1. Nov., 06:00");

    setDateDisplayLanguage("fa");

    expect(
      spaced(OneUptimeDate.getDateAsLocalDayMonthHourString(INSTANT)),
    ).toBe("۱ نوامبر، ۰۶:۰۰");
  });

  test("a day turns in the reader's zone, not in UTC", () => {
    // 00:45 UTC on November 1 is 20:45 on October 31 in New York.
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);
    setDateDisplayLanguage("fa");

    expect(
      spaced(OneUptimeDate.getDateAsLocalDayMonthTimeString(INSTANT)),
    ).toBe("۳۱ اکتبر، ۲۰:۴۵");
  });
});
