/** @timezone UTC */

/*
 * A workflow's Schedule trigger in the reader's language: the common
 * schedules it offers, the schedule in words and its next runs. The runs
 * are dated in the language of the list's own heading ("Next runs"): a
 * language that has not worded the heading reads English dates under the
 * English heading, never German dates under English words.
 */

import CronScheduleField, {
  formatNextRun,
} from "../../../../UI/Components/Workflow/CronScheduleField";
import CronTab, { CronPreset } from "../../../../Utils/CronTab";
import { withPicker } from "./ValuePicker/ValuePickerTestUtils";
import englishLocale from "../../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import fs from "fs";
import path from "path";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const NOW: Date = new Date("2026-10-25T12:00:00.000Z");
const MONDAY_NINE: Date = new Date("2026-10-26T09:00:00.000Z");

const LOCALES_DIRECTORY: string = path.join(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
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

const readLocale: (language: string) => Record<string, unknown> = (
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
};

// A space, a no-break space or a narrow one: the same to a reader.
const spaced: (text: string) => string = (text: string): string => {
  return text.replace(/\s/g, " ");
};

const instances: Record<string, i18n> = {};

const instanceFor: (
  language: string,
  locale: Record<string, unknown>,
) => Promise<i18n> = async (
  language: string,
  locale: Record<string, unknown>,
): Promise<i18n> => {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      [language]: { translation: locale },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
};

beforeAll(async () => {
  instances["en"] = await instanceFor("en", englishLocale);
  instances["de"] = await instanceFor("de", germanLocale);

  // German that has not worded the list's heading yet.
  const withoutHeading: Record<string, unknown> = {
    ...(germanLocale as Record<string, unknown>),
  };
  delete withoutHeading["Next runs"];
  instances["de-without-heading"] = await instanceFor("de", withoutHeading);
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

const drawField: (instance: string, schedule: string) => void = (
  instance: string,
  schedule: string,
): void => {
  render(
    <I18nextProvider i18n={instances[instance]!}>
      {withPicker(
        <CronScheduleField initialValue={schedule} onChange={() => {}} />,
      )}
    </I18nextProvider>,
  );
};

const runsListed: () => Array<string> = (): Array<string> => {
  return screen.getAllByRole("listitem").map((item: HTMLElement): string => {
    return spaced(item.textContent || "");
  });
};

describe("a next run", () => {
  test("in English, as it always read", () => {
    expect(formatNextRun(MONDAY_NINE, "en")).toBe(
      "Mon, Oct 26, 2026, 09:00 UTC",
    );
  });

  test("in German, with German weekday and month", () => {
    expect(spaced(formatNextRun(MONDAY_NINE, "de"))).toBe(
      "Mo., 26. Okt. 2026, 09:00 UTC",
    );
  });

  test("in Persian and Japanese, on the Gregorian calendar in each one's digits", () => {
    const japanese: string = formatNextRun(MONDAY_NINE, "ja");

    expect(japanese).toContain("2026");
    expect(japanese).toContain("09:00 UTC");
    expect(japanese).not.toContain("Oct");

    const persian: string = formatNextRun(MONDAY_NINE, "fa");

    expect(persian).toContain("۲۰۲۶");
    expect(persian).toContain("۰۹:۰۰ UTC");
    expect(persian).not.toContain("Oct");
    expect(persian).not.toMatch(/[0-9]/);
  });

  test("a language Intl does not know reads English", () => {
    expect(formatNextRun(MONDAY_NINE, "xx")).toBe(
      "Mon, Oct 26, 2026, 09:00 UTC",
    );
  });
});

describe("the Schedule trigger in German", () => {
  test("the schedule in words and its next runs in German", () => {
    drawField("de", "0 9 * * 1");

    expect(
      screen.getByText("Jede Woche am Montag um 09:00 (UTC)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Nächste Ausführungen")).toBeInTheDocument();
    expect(runsListed()).toEqual([
      "Mo., 26. Okt. 2026, 09:00 UTC",
      "Mo., 2. Nov. 2026, 09:00 UTC",
      "Mo., 9. Nov. 2026, 09:00 UTC",
    ]);
  });

  test("a common schedule is named in German, and so is its yearly date", () => {
    drawField("de", "0 0 1 1 *");

    expect(
      screen.getByText("Jedes Jahr (1. Januar um Mitternacht)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Jedes Jahr am 1. Januar um 00:00 (UTC)"),
    ).toBeInTheDocument();
  });

  test("under a heading German has not worded, the runs are dated in English", () => {
    drawField("de-without-heading", "0 9 * * 1");

    expect(screen.getByText("Next runs")).toBeInTheDocument();
    expect(runsListed()[0]).toBe("Mon, Oct 26, 2026, 09:00 UTC");
  });

  test("in English, as it always read", () => {
    drawField("en", "0 9 * * 1");

    expect(
      screen.getByText("Every week on Monday at 09:00 (UTC)"),
    ).toBeInTheDocument();
    expect(runsListed()[0]).toBe("Mon, Oct 26, 2026, 09:00 UTC");
  });
});

describe("the common schedules the trigger offers", () => {
  const presets: Array<CronPreset> = CronTab.PRESETS;
  const english: Record<string, unknown> = englishLocale as Record<
    string,
    unknown
  >;

  test("each is a key of the Dashboard's locales", () => {
    for (const preset of presets) {
      expect(english[preset.label]).toBe(preset.label);
    }
  });

  test.each(LANGUAGES)("%s words every one of them", (language: string) => {
    const locale: Record<string, unknown> = readLocale(language);

    for (const preset of presets) {
      const value: unknown = locale[preset.label];

      expect(typeof value).toBe("string");
      expect(value).not.toBe(preset.label);
    }
  });
});
