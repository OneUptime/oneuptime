import {
  AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID,
  DASHBOARD_DEFAULTS_BAR_TEST_ID,
  DEFAULT_AUTO_REFRESH_PICKER_TEST_ID,
  DEFAULT_TIME_RANGE_PICKER_TEST_ID,
  DashboardDefaultsCopy,
  getAutoRefreshChoiceLabel,
  getDefaultsPickerChoiceTestId,
  getDefaultsPickerMenuTestId,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardDefaultsCopy";
import { PUBLIC_AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID } from "../../FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardToolbarCopy";
import { DEFAULT_CHOICE_TEMPLATE } from "Common/UI/Utils/DefaultChoiceLabel";
import { AutoRefreshInterval } from "Common/Types/Dashboard/DashboardViewConfig";
import { DASHBOARD_TIME_RANGES } from "Common/Types/Dashboard/DashboardTimeRange";
import TimeRange from "Common/Types/Time/TimeRange";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The words of a dashboard's defaults (issue #5080), here where the locale
 * files are: the editing row's Default time range and Default auto-refresh
 * with its one line on what they do, each picker's first choice "Default
 * (...)", and the time range picker's line for it. Each is a key of
 * en.json and is translated in the sixteen other Dashboard languages,
 * keeping the value it names.
 *
 * The toolbar and the picker are rendered in Common/Tests (the dashboard
 * through DashboardDefaultTimeRange.test.tsx, the picker through
 * RangeStartAndEndDateDefaultChoice.test.tsx).
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// The picker's own line for the default, drawn while it is the choice in use.
const DEFAULT_RANGE_LINE: string =
  "The time range this dashboard opens on, relative to now.";

const SENTENCES: Array<string> = [
  DashboardDefaultsCopy.timeRangeLabel,
  DashboardDefaultsCopy.autoRefreshLabel,
  DashboardDefaultsCopy.hint,
  DEFAULT_CHOICE_TEMPLATE,
  DEFAULT_RANGE_LINE,
];

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

describe("the words", () => {
  test("say what they set, and that each viewer can still pick their own", () => {
    expect(DashboardDefaultsCopy).toEqual({
      timeRangeLabel: "Default time range",
      autoRefreshLabel: "Default auto-refresh",
      hint: "Everyone opens the dashboard on these. Each viewer can still pick their own.",
    });
    expect(DEFAULT_CHOICE_TEMPLATE).toBe("Default ({{value}})");
  });

  test("an interval is named as the auto-refresh button names it: Off, or its short form", () => {
    expect(getAutoRefreshChoiceLabel(AutoRefreshInterval.OFF)).toBe("Off");
    expect(getAutoRefreshChoiceLabel(AutoRefreshInterval.FIVE_SECONDS)).toBe(
      "5s",
    );
    expect(getAutoRefreshChoiceLabel(AutoRefreshInterval.ONE_MINUTE)).toBe(
      "1m",
    );
    expect(getAutoRefreshChoiceLabel(AutoRefreshInterval.FIFTEEN_MINUTES)).toBe(
      "15m",
    );
  });

  test("are short enough for a toolbar row", () => {
    expect(DashboardDefaultsCopy.timeRangeLabel.length).toBeLessThanOrEqual(24);
    expect(DashboardDefaultsCopy.autoRefreshLabel.length).toBeLessThanOrEqual(
      24,
    );
    expect(DashboardDefaultsCopy.hint.length).toBeLessThanOrEqual(80);
  });
});

describe("the test ids the browser suites read", () => {
  test("are each one of a kind", () => {
    const ids: Array<string> = [
      DASHBOARD_DEFAULTS_BAR_TEST_ID,
      DEFAULT_TIME_RANGE_PICKER_TEST_ID,
      DEFAULT_AUTO_REFRESH_PICKER_TEST_ID,
      AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID,
      PUBLIC_AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID,
      getDefaultsPickerMenuTestId(DEFAULT_TIME_RANGE_PICKER_TEST_ID),
      getDefaultsPickerMenuTestId(DEFAULT_AUTO_REFRESH_PICKER_TEST_ID),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("a choice's id has no spaces, and tells every range apart", () => {
    const choiceIds: Array<string> = DASHBOARD_TIME_RANGES.map(
      (range: TimeRange): string => {
        return getDefaultsPickerChoiceTestId(
          DEFAULT_TIME_RANGE_PICKER_TEST_ID,
          range,
        );
      },
    );

    expect(
      getDefaultsPickerChoiceTestId(
        DEFAULT_TIME_RANGE_PICKER_TEST_ID,
        TimeRange.PAST_ONE_DAY,
      ),
    ).toBe("dashboard-default-time-range-past-1-day");

    for (const id of choiceIds) {
      expect(id.includes(" ")).toBe(false);
    }

    expect(new Set(choiceIds).size).toBe(choiceIds.length);
  });
});

describe("in every Dashboard language", () => {
  const english: Record<string, unknown> = readLocale("en");

  test.each(SENTENCES)(
    "%s is a key of en.json, as itself",
    (sentence: string) => {
      expect(english[sentence]).toBe(sentence);
    },
  );

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    test.each(SENTENCES)("translates %s", (sentence: string) => {
      const translated: unknown = translations[sentence];

      expect(typeof translated).toBe("string");
      expect(translated).not.toBe(sentence);
      expect((translated as string).trim()).toBe(translated);
    });

    test("keeps the value Default (...) names, once", () => {
      const translated: string = translations[
        DEFAULT_CHOICE_TEMPLATE
      ] as string;

      expect(translated.split("{{value}}").length - 1).toBe(1);
      expect(translated.includes("{{value}}")).toBe(true);
    });
  });

  /*
   * The auto-refresh menu's own words, which the editing row's Default
   * auto-refresh lists too: before the UI review most languages still had
   * them in English, so a German editor's menu read "Automatische
   * Aktualisierung aus", then "Refresh every 5s".
   */
  describe.each(OTHER_LOCALES)("%s's auto-refresh menu", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    test.each(["Auto-refresh Off", "Auto-refresh: Off"])(
      "translates %s",
      (sentence: string) => {
        expect(english[sentence]).toBe(sentence);
        expect(typeof translations[sentence]).toBe("string");
        expect(translations[sentence]).not.toBe(sentence);
      },
    );

    test("translates Refresh every {{interval}}, keeping the interval once", () => {
      const template: string = "Refresh every {{interval}}";
      const translated: string = translations[template] as string;

      expect(english[template]).toBe(template);
      expect(translated).not.toBe(template);
      expect(translated.split("{{interval}}").length - 1).toBe(1);
      expect(translated.trim()).toBe(translated);
    });
  });

  test("Japanese and Chinese wrap the value in full-width brackets, as their other labels do", () => {
    for (const locale of ["ja", "zh-CN", "zh-TW"]) {
      const translated: string = readLocale(locale)[
        DEFAULT_CHOICE_TEMPLATE
      ] as string;

      expect([locale, translated.includes("（{{value}}）")]).toEqual([
        locale,
        true,
      ]);
    }
  });
});
