import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { ObjectType } from "../../../Types/JSON";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import DashboardMode from "../../../Types/Dashboard/DashboardMode";
import DashboardViewConfig, {
  AutoRefreshInterval,
  getAutoRefreshIntervalLabel,
} from "../../../Types/Dashboard/DashboardViewConfig";
import { formatAutoRefreshInterval } from "../../../Types/Dashboard/DashboardAutoRefresh";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";
import { formatDurationCompactInLanguage } from "../../../Utils/Slo/SloDuration";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import AutoRefreshControl from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl";
import DashboardToolbar from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar";
import {
  AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID,
  DEFAULT_AUTO_REFRESH_PICKER_TEST_ID,
  getAutoRefreshChoiceLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardDefaultsCopy";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * AN AUTO-REFRESH INTERVAL IN THE READER'S LANGUAGE (issue #7303).
 *
 * Every resource Overview with live data (Hosts, Kubernetes clusters,
 * container hosts, VMware, Proxmox and the rest) has an auto-refresh picker
 * in its hero: "Every 30s", "Every 1m", "Off". Its sentence was translated,
 * but the interval was a fixed English short form, so a Persian host page
 * read "هر 30s" beside Persian digits everywhere else on it, and German
 * "Alle 30s". A dashboard's own auto-refresh menu, its countdown and the
 * editing row's Default auto-refresh named their intervals the same way.
 *
 * The interval is written as a short duration in its sentence's language
 * now: "Alle 30 Sek.", "هر ۳۰ ثانیه". English reads exactly as it did.
 */

const LATIN_DIGIT: RegExp = /[0-9]/;

const PERSIAN_DIGIT: RegExp = /[۰-۹]/;

// The resource pages' picker offers these, in this order.
const RESOURCE_INTERVALS: Array<AutoRefreshInterval> = [
  AutoRefreshInterval.THIRTY_SECONDS,
  AutoRefreshInterval.ONE_MINUTE,
  AutoRefreshInterval.FIVE_MINUTES,
  AutoRefreshInterval.FIFTEEN_MINUTES,
];

const EVERY_INTERVAL: Array<AutoRefreshInterval> = [
  AutoRefreshInterval.FIVE_SECONDS,
  AutoRefreshInterval.TEN_SECONDS,
  ...RESOURCE_INTERVALS,
];

const SECONDS: Record<string, number> = {
  [AutoRefreshInterval.FIVE_SECONDS]: 5,
  [AutoRefreshInterval.TEN_SECONDS]: 10,
  [AutoRefreshInterval.THIRTY_SECONDS]: 30,
  [AutoRefreshInterval.ONE_MINUTE]: 60,
  [AutoRefreshInterval.FIVE_MINUTES]: 300,
  [AutoRefreshInterval.FIFTEEN_MINUTES]: 900,
};

const instances: Record<string, i18n> = {};

// A Persian page whose locale has not worded "Every {{interval}}" yet.
const PERSIAN_WITHOUT_EVERY: string = "fa-without-every";

beforeAll(async () => {
  for (const language of ["en", "de", "fa", "ar", "ja"]) {
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

  const persian: Record<string, string> = { ...readDashboardLocale("fa") };
  delete persian["Every {{interval}}"];

  const unworded: i18n = createInstance();

  await unworded.init({
    lng: "fa",
    fallbackLng: "en",
    resources: { fa: { translation: persian } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  instances[PERSIAN_WITHOUT_EVERY] = unworded;
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage("en");
});

// A sentence of `language`'s locale with its interval filled in.
const sentence: (data: {
  language: string;
  template: string;
  interval: string;
}) => string = (data: {
  language: string;
  template: string;
  interval: string;
}): string => {
  const words: string = readDashboardLocale(data.language)[data.template]!;

  return words.split("{{interval}}").join(data.interval);
};

describe("formatAutoRefreshInterval", () => {
  test("English is the short form the pickers always drew, word for word", () => {
    for (const interval of EVERY_INTERVAL) {
      expect(formatAutoRefreshInterval(interval, "en")).toBe(
        getAutoRefreshIntervalLabel(interval),
      );
    }

    expect(
      EVERY_INTERVAL.map((interval: AutoRefreshInterval): string | null => {
        return formatAutoRefreshInterval(interval, "en");
      }),
    ).toEqual(["5s", "10s", "30s", "1m", "5m", "15m"]);
  });

  test("Off is no duration", () => {
    expect(formatAutoRefreshInterval(AutoRefreshInterval.OFF, "en")).toBeNull();
    expect(formatAutoRefreshInterval(AutoRefreshInterval.OFF, "fa")).toBeNull();
  });

  test.each(["de", "fa", "ar", "ja", "zh-CN", "fr"])(
    "%s: each interval as the language's short duration",
    (language: string) => {
      for (const interval of EVERY_INTERVAL) {
        expect({
          interval,
          text: formatAutoRefreshInterval(interval, language),
        }).toEqual({
          interval,
          text: formatDurationCompactInLanguage(SECONDS[interval]!, language),
        });
      }
    },
  );

  test("German and Persian name the unit, Persian in Persian digits", () => {
    expect(
      formatAutoRefreshInterval(AutoRefreshInterval.THIRTY_SECONDS, "de"),
    ).toBe("30 Sek.");
    expect(
      formatAutoRefreshInterval(AutoRefreshInterval.THIRTY_SECONDS, "fa"),
    ).toBe("۳۰ ثانیه");
    expect(
      formatAutoRefreshInterval(AutoRefreshInterval.ONE_MINUTE, "fa"),
    ).toBe("۱ دقیقه");

    for (const interval of EVERY_INTERVAL) {
      const persian: string = formatAutoRefreshInterval(interval, "fa") || "";

      expect({ interval, latin: LATIN_DIGIT.test(persian) }).toEqual({
        interval,
        latin: false,
      });
      expect(persian).toMatch(PERSIAN_DIGIT);
    }
  });

  test("without a language, the page's", () => {
    setDateDisplayLanguage("fa");
    expect(formatAutoRefreshInterval(AutoRefreshInterval.THIRTY_SECONDS)).toBe(
      "۳۰ ثانیه",
    );
    setDateDisplayLanguage("en");
    expect(formatAutoRefreshInterval(AutoRefreshInterval.THIRTY_SECONDS)).toBe(
      "30s",
    );
  });
});

/*
 * The resource pages' picker: a select whose options are Off and "Every
 * {{interval}}".
 */
const drawControl: (language: string) => Array<string> = (
  language: string,
): Array<string> => {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <AutoRefreshControl
        autoRefreshInterval={AutoRefreshInterval.THIRTY_SECONDS}
        onAutoRefreshIntervalChange={(): void => {}}
        onManualRefresh={(): void => {}}
        isRefreshing={false}
        lastRefreshedAt={null}
      />
    </I18nextProvider>,
  );

  return Array.from(
    (screen.getByRole("combobox") as HTMLSelectElement).options,
  ).map((option: HTMLOptionElement): string => {
    return withoutIsolateMarks(option.textContent || "");
  });
};

describe("the resource pages' auto-refresh picker", () => {
  test("in English, exactly as it read", () => {
    expect(drawControl("en")).toEqual([
      "Off",
      "Every 30s",
      "Every 1m",
      "Every 5m",
      "Every 15m",
    ]);
  });

  test.each(["de", "fa", "ar", "ja"])(
    "in %s, each interval in the sentence's language",
    (language: string) => {
      const options: Array<string> = drawControl(language);

      expect(options[0]).toBe(readDashboardLocale(language)["Off"]);
      expect(options.slice(1)).toEqual(
        RESOURCE_INTERVALS.map((interval: AutoRefreshInterval): string => {
          return sentence({
            language,
            template: "Every {{interval}}",
            interval: formatDurationCompactInLanguage(
              SECONDS[interval]!,
              language,
            ),
          });
        }),
      );

      // Never English's short form inside the sentence.
      for (const option of options.slice(1)) {
        expect(option).not.toMatch(/\d+[sm]$/);
      }
    },
  );

  test("German reads Alle 30 Sek., never Alle 30s", () => {
    const options: Array<string> = drawControl("de");

    expect(options[1]).toBe("Alle 30 Sek.");
    expect(options).not.toContain("Alle 30s");
  });

  test("Persian reads هر ۳۰ ثانیه: no Latin digit anywhere", () => {
    const options: Array<string> = drawControl("fa");

    expect(options[1]).toBe("هر ۳۰ ثانیه");

    for (const option of options) {
      expect({ option, latin: LATIN_DIGIT.test(option) }).toEqual({
        option,
        latin: false,
      });
    }

    for (const option of options.slice(1)) {
      expect(option).toMatch(PERSIAN_DIGIT);
    }
  });

  test("Arabic keeps Latin digits, with Arabic's own units", () => {
    const options: Array<string> = drawControl("ar");

    expect(options[1]).toBe(
      sentence({
        language: "ar",
        template: "Every {{interval}}",
        interval: "30 ث",
      }),
    );
    expect(options[1]).not.toContain("30s");
  });

  test("a sentence the language has not worded yet keeps English's interval too", () => {
    const options: Array<string> = drawControl(PERSIAN_WITHOUT_EVERY);

    // The sentence falls back to English, and the interval with it.
    expect(options[1]).toBe("Every 30s");
    expect(options[1]).not.toContain("ثانیه");
  });

  test("the negative control: the English short form in a Persian sentence holds Latin digits", () => {
    const handedBack: string = sentence({
      language: "fa",
      template: "Every {{interval}}",
      interval: getAutoRefreshIntervalLabel(AutoRefreshInterval.THIRTY_SECONDS),
    });

    expect(handedBack).toBe("هر 30s");
    expect(LATIN_DIGIT.test(handedBack)).toBe(true);
    expect(drawControl("fa")).not.toContain(handedBack);
  });
});

/*
 * A dashboard's own toolbar: the auto-refresh button's countdown label,
 * its menu ("Default (1m)", "Refresh every 30s") and the editing row's
 * Default auto-refresh.
 */
const RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_DAY,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-10-19T10:00:00.000Z"),
    new Date("2026-10-20T10:00:00.000Z"),
  ),
};

const WALL_SCREEN: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [DashboardTextComponentUtil.getDefaultComponent()],
  heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
  timeRange: TimeRange.PAST_ONE_DAY,
  refreshInterval: AutoRefreshInterval.ONE_MINUTE,
};

const noop: () => void = (): void => {};

const drawToolbar: (language: string, mode: DashboardMode) => void = (
  language: string,
  mode: DashboardMode,
): void => {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <DashboardToolbar
        dashboardMode={mode}
        dashboardName="Production wall screen"
        dashboardViewConfig={WALL_SCREEN}
        isSaving={false}
        canEditDashboard={true}
        startAndEndDate={RANGE}
        onStartAndEndDateChange={noop}
        autoRefreshInterval={AutoRefreshInterval.ONE_MINUTE}
        onAutoRefreshIntervalChange={noop}
        defaultTimeRange={TimeRange.PAST_ONE_DAY}
        isOnDefaultTimeRange={true}
        onDefaultTimeRangeSelect={noop}
        defaultAutoRefreshInterval={AutoRefreshInterval.ONE_MINUTE}
        isOnDefaultAutoRefresh={true}
        onDefaultAutoRefreshSelect={noop}
        onDashboardDefaultsChange={noop}
        onEditClick={noop}
        onSaveClick={noop}
        onCancelEditClick={noop}
        onFullScreenClick={noop}
        onAddComponentClick={noop}
      />
    </I18nextProvider>,
  );
};

const openAutoRefreshMenu: (language: string) => Promise<HTMLElement> = async (
  language: string,
): Promise<HTMLElement> => {
  const settings: string =
    readDashboardLocale(language)["Auto-refresh settings"]!;

  await act(async () => {
    fireEvent.click(screen.getByTitle(settings));
  });

  return screen.getByRole("menu", { name: settings });
};

// A choice's words, without the tick the one in use draws before them.
const wordsOf: (choice: HTMLElement) => string = (
  choice: HTMLElement,
): string => {
  return withoutIsolateMarks(choice.textContent || "")
    .split("\u2713")
    .join("")
    .trim();
};

const choicesOf: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu).getAllByRole("menuitemradio").map(wordsOf);
};

describe("a dashboard's auto-refresh menu", () => {
  test("in English, exactly as it read", async () => {
    drawToolbar("en", DashboardMode.View);

    const menu: HTMLElement = await openAutoRefreshMenu("en");

    expect(choicesOf(menu)).toEqual([
      "Default (1m)",
      "Auto-refresh Off",
      "Refresh every 5s",
      "Refresh every 10s",
      "Refresh every 30s",
      "Refresh every 1m",
      "Refresh every 5m",
      "Refresh every 15m",
    ]);
  });

  test.each(["de", "fa", "ar"])(
    "in %s, the default, every interval and the countdown in the reader's language",
    async (language: string) => {
      drawToolbar(language, DashboardMode.View);

      const minute: string = formatDurationCompactInLanguage(60, language);

      // The countdown beside the button names the interval in use.
      expect(screen.getByText(minute)).toBeInTheDocument();

      const menu: HTMLElement = await openAutoRefreshMenu(language);
      const choices: Array<string> = choicesOf(menu);

      expect(
        wordsOf(within(menu).getByTestId(AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID)),
      ).toBe(
        readDashboardLocale(language)
          ["Default ({{value}})"]!.split("{{value}}")
          .join(minute),
      );
      expect(choices.slice(2)).toEqual(
        EVERY_INTERVAL.map((interval: AutoRefreshInterval): string => {
          return sentence({
            language,
            template: "Refresh every {{interval}}",
            interval: formatDurationCompactInLanguage(
              SECONDS[interval]!,
              language,
            ),
          });
        }),
      );
    },
  );

  test("in Persian, no choice holds a Latin digit", async () => {
    drawToolbar("fa", DashboardMode.View);

    for (const choice of choicesOf(await openAutoRefreshMenu("fa"))) {
      expect({ choice, latin: LATIN_DIGIT.test(choice) }).toEqual({
        choice,
        latin: false,
      });
    }
  });

  /*
   * The ring's seconds left, beside the interval: a Persian page read "60"
   * inside the ring beside "۱ دقیقه".
   */
  test.each([
    ["en", "60"],
    ["de", "60"],
    ["ar", "60"],
    ["fa", "۶۰"],
  ])(
    "in %s, the ring counts its seconds in the reader's digits: %s",
    (language: string, seconds: string) => {
      drawToolbar(language, DashboardMode.View);

      const countdown: HTMLElement = screen.getByTestId(
        "dashboard-auto-refresh-countdown",
      );

      expect(countdown).toHaveTextContent(seconds);

      if (language === "fa") {
        expect(countdown.textContent || "").not.toMatch(LATIN_DIGIT);
        expect(countdown.textContent || "").toMatch(PERSIAN_DIGIT);
      }
    },
  );
});

describe("the editing row's Default auto-refresh", () => {
  test("names the dashboard's interval in the reader's language on its button and in its menu", async () => {
    drawToolbar("fa", DashboardMode.Edit);

    const button: HTMLElement = screen.getByTestId(
      DEFAULT_AUTO_REFRESH_PICKER_TEST_ID,
    );

    expect(withoutIsolateMarks(button.textContent || "")).toContain("۱ دقیقه");
    expect(withoutIsolateMarks(button.textContent || "")).not.toMatch(
      LATIN_DIGIT,
    );

    await act(async () => {
      fireEvent.click(button);
    });

    const menu: HTMLElement = screen.getByRole("menu", {
      name: readDashboardLocale("fa")["Default auto-refresh"]!,
    });

    for (const choice of choicesOf(menu)) {
      expect({ choice, latin: LATIN_DIGIT.test(choice) }).toEqual({
        choice,
        latin: false,
      });
    }

    expect(choicesOf(menu)).toContain(
      sentence({
        language: "fa",
        template: "Refresh every {{interval}}",
        interval: "۳۰ ثانیه",
      }),
    );
  });

  test("in English, its button names the interval as it always did", () => {
    drawToolbar("en", DashboardMode.Edit);

    expect(
      screen.getByTestId(DEFAULT_AUTO_REFRESH_PICKER_TEST_ID),
    ).toHaveTextContent("1m");
  });

  test("getAutoRefreshChoiceLabel: English without a language, the language's own with one", () => {
    expect(getAutoRefreshChoiceLabel(AutoRefreshInterval.ONE_MINUTE)).toBe(
      "1m",
    );
    expect(
      getAutoRefreshChoiceLabel(AutoRefreshInterval.ONE_MINUTE, "fa"),
    ).toBe("۱ دقیقه");
    expect(getAutoRefreshChoiceLabel(AutoRefreshInterval.OFF, "fa")).toBe(
      "Off",
    );
  });
});
