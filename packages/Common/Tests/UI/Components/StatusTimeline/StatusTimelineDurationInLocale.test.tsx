import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import OneUptimeDate, { ZERO_FRIENDLY_TIME_TEXT } from "../../../../Types/Date";
import {
  DurationTextPart,
  formatDurationText,
  getDateLocale,
  setDateDisplayLanguage,
} from "../../../../Types/DateLanguage";
import StatusTimelineLegend from "../../../../UI/Components/StatusTimeline/StatusTimelineLegend";
import {
  formatStatusTimelineCompactDuration,
  STATUS_TIMELINE_LEGEND_DURATION_UNITS,
  StatusTimelineSummary,
} from "../../../../UI/Components/StatusTimeline/StatusTimelineLayout";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";

/*
 * THE STATUS TIMELINE LEGEND'S DURATIONS, CUT BY THEIR UNITS (issue #7300).
 *
 * Every status and state timeline's legend says how long each status
 * lasted, kept to its two largest units: "Operational 99.96% · 29 days 23
 * hours". The duration was written whole in the reader's language and then
 * cut to its first four words, taking every unit to read "number word".
 * Japanese writes no space between a unit and the next number - "30 日23
 * 時間42 分40 秒" is the words "30", "日23", "時間42", "分40", "秒" - so the
 * legend drew "30 日23 時間42 分40", the seconds' number without its unit;
 * Chinese writes the whole duration as one word and was never cut at all.
 *
 * The duration is cut by its units now, before it is written: two units in
 * every language, each number with its unit, and English exactly as it
 * always read.
 */

const DAY: number = 24 * 60 * 60;
const HOUR: number = 60 * 60;
const MINUTE: number = 60;

// The issue's duration: 30 days 23 hours 42 minutes 40 seconds.
const LONG: number = 30 * DAY + 23 * HOUR + 42 * MINUTE + 40;

const LANGUAGES: Array<string> = ["ja", "zh-CN", "ko", "de", "fa", "ar", "en"];

// Every run of digits, Latin or Persian.
const NUMBERS: RegExp = /[0-9۰-۹]+/g;

// A text's last character is a digit: a number left without its unit.
const ENDS_IN_A_DIGIT: RegExp = /[0-9۰-۹]$/;

// What Intl writes for exactly these units in `language`, as a legend does.
const intlDuration: (
  parts: Array<DurationTextPart>,
  language: string,
) => string = (parts: Array<DurationTextPart>, language: string): string => {
  return (
    formatDurationText({
      parts: parts,
      locale: getDateLocale(language),
      unitDisplay: "short",
      listStyle: "narrow",
    }) || ""
  );
};

// The legend's duration with the page in `language`, as the Dashboard sets it.
const legendDurationIn: (seconds: number, language: string) => string = (
  seconds: number,
  language: string,
): string => {
  setDateDisplayLanguage(language);

  try {
    return formatStatusTimelineCompactDuration(seconds);
  } finally {
    setDateDisplayLanguage("en");
  }
};

/*
 * What the legend drew before: the whole duration, cut to its first four
 * words. Kept here only as the negative control.
 */
const cutByWords: (text: string) => string = (text: string): string => {
  return text.trim().split(" ").slice(0, 4).join(" ");
};

afterEach(() => {
  cleanup();
  setDateDisplayLanguage("en");
});

describe("formatStatusTimelineCompactDuration in English, exactly as it read", () => {
  test.each([
    [29 * DAY + 23 * HOUR + 52 * MINUTE + 12, "29 days 23 hours"],
    [HOUR + 2 * MINUTE + 3, "1 hour 2 mins"],
    [MINUTE + 47, "1 min 47 secs"],
    [15 * MINUTE + 32, "15 mins 32 secs"],
    [41 * MINUTE + 1, "41 mins 1 sec"],
    [38, "38 secs"],
    [1, "1 sec"],
    [HOUR, "1 hour"],
    [4 * HOUR + 30 * MINUTE, "4 hours 30 mins"],
    // The two largest units that are not zero, as the four words were.
    [2 * DAY + 30, "2 days 30 secs"],
    [LONG, "30 days 23 hours"],
  ])("%p seconds read %p", (seconds: number, text: string) => {
    expect(formatStatusTimelineCompactDuration(seconds)).toBe(text);
  });

  test("whole seconds: a fraction of one is dropped, as the legend floored it", () => {
    expect(formatStatusTimelineCompactDuration(107.9)).toBe("1 min 47 secs");
  });

  test.each([0, 0.4, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "%p reads zero seconds, never a blank",
    (seconds: number) => {
      expect(formatStatusTimelineCompactDuration(seconds)).toBe("0 secs");
    },
  );

  test("names two units at most", () => {
    expect(STATUS_TIMELINE_LEGEND_DURATION_UNITS).toBe(2);
  });
});

describe("30 days 23 hours 42 minutes 40 seconds in the reader's language", () => {
  test.each(LANGUAGES)(
    "%s: two units, each number with its unit",
    (language: string) => {
      const text: string = legendDurationIn(LONG, language);

      expect(text).toBe(
        language === "en"
          ? "30 days 23 hours"
          : intlDuration(
              [
                { count: 30, unit: "day" },
                { count: 23, unit: "hour" },
              ],
              language,
            ),
      );

      // Two numbers: the days' and the hours'. No minutes, no seconds.
      expect({ language, numbers: (text.match(NUMBERS) || []).length }).toEqual(
        { language, numbers: 2 },
      );

      // Never a number left without its unit at the end.
      expect({
        language,
        text,
        endsInADigit: ENDS_IN_A_DIGIT.test(text),
      }).toEqual({ language, text, endsInADigit: false });

      /*
       * Exactly the hours' unit as the language writes it ends the text
       * (English in the timelines' own words).
       */
      const hours: string = intlDuration(
        [{ count: 23, unit: "hour" }],
        language,
      );
      const hoursUnit: string =
        language === "en" ? "hours" : hours.replace(NUMBERS, "").trim();

      expect(text.endsWith(hoursUnit)).toBe(true);
    },
  );

  test("Japanese reads 30 日23 時間, the hours with their unit", () => {
    const japanese: string = legendDurationIn(LONG, "ja");

    expect(japanese).toBe("30 日23 時間");
    expect(japanese).not.toContain("分");
    expect(japanese).not.toContain("秒");
  });

  test("Chinese and Korean are cut to two units too: they were never cut", () => {
    expect(legendDurationIn(LONG, "zh-CN")).toBe("30天23小时");
    expect(legendDurationIn(LONG, "ko")).toBe("30일 23시간");
  });

  test("German keeps its list comma between the two units, and none after", () => {
    const german: string = legendDurationIn(LONG, "de");

    expect(german).toBe("30 Tg., 23 Std.");
    expect(german.endsWith(",")).toBe(false);
  });

  test("Persian writes Persian digits, and no Latin digit", () => {
    const persian: string = legendDurationIn(LONG, "fa");

    expect(persian).toBe("۳۰ روز ۲۳ ساعت");
    expect(persian).not.toMatch(/[0-9]/);
  });

  test("Arabic keeps Latin digits, its two units joined as Arabic joins them", () => {
    const arabic: string = legendDurationIn(LONG, "ar");

    expect(arabic.startsWith("30 ")).toBe(true);
    expect(arabic).toContain("23");
    expect(arabic).not.toContain("42");
    expect(arabic).not.toContain("40");
  });

  test("a short one reads whole in each language: 1 min 47 secs", () => {
    for (const language of LANGUAGES) {
      expect({
        language,
        text: legendDurationIn(MINUTE + 47, language),
      }).toEqual({
        language,
        text:
          language === "en"
            ? "1 min 47 secs"
            : intlDuration(
                [
                  { count: 1, unit: "minute" },
                  { count: 47, unit: "second" },
                ],
                language,
              ),
      });
    }
  });

  test("nothing reads zero seconds in the reader's language, not English's '0 secs'", () => {
    expect(legendDurationIn(0, "en")).toBe(ZERO_FRIENDLY_TIME_TEXT);

    for (const language of ["ja", "de", "fa", "zh-CN"]) {
      const text: string = legendDurationIn(0, language);

      expect({ language, text }).toEqual({
        language,
        text: intlDuration([{ count: 0, unit: "second" }], language),
      });
      expect(text).not.toBe(ZERO_FRIENDLY_TIME_TEXT);
    }
  });

  /*
   * The negative control: the four-word cut this replaced, run on the same
   * whole duration, still loses the seconds' unit in Japanese and leaves
   * Chinese whole.
   */
  test("the old cut by words fails the same Japanese and Chinese cases", () => {
    setDateDisplayLanguage("ja");
    const japanese: string = cutByWords(
      OneUptimeDate.secondsToFormattedFriendlyTimeString(LONG),
    );
    setDateDisplayLanguage("zh-CN");
    const chinese: string = cutByWords(
      OneUptimeDate.secondsToFormattedFriendlyTimeString(LONG),
    );
    setDateDisplayLanguage("en");

    expect(ENDS_IN_A_DIGIT.test(japanese)).toBe(true);
    expect(japanese).not.toBe(legendDurationIn(LONG, "ja"));
    expect((chinese.match(NUMBERS) || []).length).toBe(4);
    expect(chinese).not.toBe(legendDurationIn(LONG, "zh-CN"));
  });
});

describe("OneUptimeDate.secondsToFormattedFriendlyTimeString's options", () => {
  test("maxUnits keeps the largest units, and nothing else changes", () => {
    const full: string =
      OneUptimeDate.secondsToFormattedFriendlyTimeString(LONG);

    expect(full).toBe("30 days 23 hours 42 mins 40 secs");
    expect(
      OneUptimeDate.secondsToFormattedFriendlyTimeString(LONG, { maxUnits: 1 }),
    ).toBe("30 days");
    expect(
      OneUptimeDate.secondsToFormattedFriendlyTimeString(LONG, { maxUnits: 3 }),
    ).toBe("30 days 23 hours 42 mins");
    expect(
      OneUptimeDate.secondsToFormattedFriendlyTimeString(LONG, { maxUnits: 9 }),
    ).toBe(full);
  });

  test("a maxUnits under one is no limit at all", () => {
    const full: string =
      OneUptimeDate.secondsToFormattedFriendlyTimeString(LONG);

    expect(
      OneUptimeDate.secondsToFormattedFriendlyTimeString(LONG, { maxUnits: 0 }),
    ).toBe(full);
    expect(
      OneUptimeDate.secondsToFormattedFriendlyTimeString(LONG, {
        maxUnits: -2,
      }),
    ).toBe(full);
  });

  test("a duration of nothing is blank unless writesZero asks for zero seconds", () => {
    expect(OneUptimeDate.secondsToFormattedFriendlyTimeString(0)).toBe("");
    expect(
      OneUptimeDate.secondsToFormattedFriendlyTimeString(0, {
        writesZero: true,
      }),
    ).toBe("0 secs");
    // A duration that is not nothing is untouched by writesZero.
    expect(
      OneUptimeDate.secondsToFormattedFriendlyTimeString(38, {
        writesZero: true,
      }),
    ).toBe("38 secs");
  });
});

/*
 * The legend drawn on a Japanese page: each status's duration whole, in its
 * own isolate, two units each.
 */
describe("the legend, drawn in Japanese", () => {
  const summary: StatusTimelineSummary = {
    items: [
      {
        statusKey: "operational",
        name: "稼働中",
        color: "#10b981",
        durationMs: LONG * 1000,
        share: 0.9996,
        count: 1,
      },
      {
        statusKey: "offline",
        name: "オフライン",
        color: "#ef4444",
        durationMs: (15 * MINUTE + 32) * 1000,
        share: 0.0004,
        count: 5,
      },
    ],
    measuredMs: 31 * DAY * 1000,
    monitoringOffMs: (2 * HOUR + 5 * MINUTE + 9) * 1000,
    monitoringOffCount: 1,
  };

  const instances: Record<string, i18n> = {};

  beforeAll(async () => {
    for (const language of ["ja", "en"]) {
      const instance: i18n = createInstance();

      await instance.init({
        lng: language,
        fallbackLng: "en",
        resources: {
          [language]: { translation: readDashboardLocale(language) },
        },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });

      instances[language] = instance;
    }
  });

  const draw: (language: string) => void = (language: string): void => {
    setDateDisplayLanguage(language);
    render(
      <I18nextProvider i18n={instances[language]!}>
        <StatusTimelineLegend summary={summary} showShare={true} />
      </I18nextProvider>,
    );
  };

  // Each status's parts, set apart: its name, its share, its duration, its count.
  const partsOf: (item: HTMLElement) => Array<string> = (
    item: HTMLElement,
  ): Array<string> => {
    return Array.from(item.querySelectorAll("bdi")).map(
      (part: Element): string => {
        return withoutIsolateMarks(part.textContent || "");
      },
    );
  };

  test("each duration is two units, the last with its unit", () => {
    draw("ja");

    const items: Array<HTMLElement> = screen.getAllByTestId(
      "status-timeline-legend-item",
    );

    expect(partsOf(items[0]!)[2]).toBe("30 日23 時間");
    expect(partsOf(items[1]!)[2]).toBe(
      intlDuration(
        [
          { count: 15, unit: "minute" },
          { count: 32, unit: "second" },
        ],
        "ja",
      ),
    );

    // Time with monitoring off, cut the same way: hours and minutes.
    const off: string =
      screen.getByTestId("status-timeline-legend-monitoring-off").textContent ||
      "";

    expect(off).toContain(
      intlDuration(
        [
          { count: 2, unit: "hour" },
          { count: 5, unit: "minute" },
        ],
        "ja",
      ),
    );
    expect(off).not.toContain("秒");
  });

  test("in English, exactly as it read", () => {
    draw("en");

    const items: Array<HTMLElement> = screen.getAllByTestId(
      "status-timeline-legend-item",
    );

    expect(partsOf(items[0]!)[2]).toBe("30 days 23 hours");
    expect(partsOf(items[1]!)[2]).toBe("15 mins 32 secs");
    expect(
      screen.getByTestId("status-timeline-legend-monitoring-off"),
    ).toHaveTextContent("2 hours 5 mins");
  });
});
