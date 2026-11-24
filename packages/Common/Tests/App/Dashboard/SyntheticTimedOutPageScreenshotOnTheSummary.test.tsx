import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import SummaryScreenshotGroup from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ScreenshotGroup";
import Screenshots from "../../../Types/Monitor/SyntheticMonitors/Screenshot";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * THE PROBE'S SCREENSHOT OF A TIMED-OUT PAGE, CAPTIONED IN THE READER'S
 * WORDS.
 *
 * When a synthetic script runs out of time, the probe photographs each
 * page it left open and stores the screenshot as "timed-out-page" (then
 * "timed-out-page-2" and so on), a name an incident's description can use.
 * Drawn through the real summary, the caption under the screenshot - and
 * its alt text - reads as words in the reader's language, the page's
 * number in the reader's digits. The names a script gave its own
 * screenshots read as written, in every language.
 */

type Language = "en" | "de" | "fa" | "ar";

const LANGUAGES: Array<Language> = ["en", "de", "fa", "ar"];

const instances: Partial<Record<Language, i18n>> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
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

afterEach(() => {
  cleanup();
});

const renderIn: (
  language: Language,
  screenshots: Screenshots,
) => RenderResult = (
  language: Language,
  screenshots: Screenshots,
): RenderResult => {
  const instance: i18n | undefined = instances[language];
  if (!instance) {
    throw new Error(`No i18next instance for ${language}.`);
  }

  return render(
    <I18nextProvider i18n={instance}>
      <SummaryScreenshotGroup screenshots={screenshots} />
    </I18nextProvider>,
  );
};

// A screenshot's base64, as the probe reports it: what it holds is not drawn here.
const IMAGE: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const RUN: Screenshots = {
  "login-page": IMAGE,
  "timed-out-page": IMAGE,
  "timed-out-page-2": IMAGE,
};

function altTexts(result: RenderResult): Array<string> {
  return Array.from(result.container.querySelectorAll("img")).map(
    (image: HTMLImageElement): string => {
      return image.getAttribute("alt") || "";
    },
  );
}

describe("a timed-out run's screenshots on a synthetic monitor's summary", () => {
  test("read as words in English, the script's own names as written", () => {
    const result: RenderResult = renderIn("en", RUN);

    expect(altTexts(result)).toEqual([
      "login-page",
      "Page when the script timed out",
      "Page 2 when the script timed out",
    ]);
    expect(result.getByText("login-page")).toBeInTheDocument();
    expect(
      result.getByText("Page when the script timed out"),
    ).toBeInTheDocument();
    expect(
      result.getByText("Page 2 when the script timed out"),
    ).toBeInTheDocument();
    expect(result.queryByText("timed-out-page")).not.toBeInTheDocument();
  });

  test("read in German", () => {
    const result: RenderResult = renderIn("de", RUN);

    expect(altTexts(result)).toEqual([
      "login-page",
      "Seite, als das Skript das Zeitlimit überschritt",
      "Seite 2, als das Skript das Zeitlimit überschritt",
    ]);
  });

  test("read in Persian, the page's number in Persian digits", () => {
    const result: RenderResult = renderIn("fa", RUN);

    expect(altTexts(result)).toEqual([
      "login-page",
      "صفحه هنگام تمام شدن مهلت اسکریپت",
      "صفحه ۲ هنگام تمام شدن مهلت اسکریپت",
    ]);
  });

  test("read in Arabic, which writes Latin digits", () => {
    const result: RenderResult = renderIn("ar", RUN);

    expect(altTexts(result)).toEqual([
      "login-page",
      "الصفحة عند انتهاء مهلة البرنامج النصي",
      "الصفحة 2 عند انتهاء مهلة البرنامج النصي",
    ]);
  });

  test("a script's screenshot whose name only looks like the probe's reads as written", () => {
    for (const language of LANGUAGES) {
      const result: RenderResult = renderIn(language, {
        "timed-out-page (2)": IMAGE,
        "timed-out-page-1": IMAGE,
        "Page when the script timed out": IMAGE,
      });

      expect({ language, alt: altTexts(result) }).toEqual({
        language,
        alt: [
          "timed-out-page (2)",
          "timed-out-page-1",
          "Page when the script timed out",
        ],
      });
      cleanup();
    }
  });

  test("still shows the screenshot itself, as the probe stored it", () => {
    const result: RenderResult = renderIn("de", { "timed-out-page": IMAGE });
    const image: HTMLImageElement | null =
      result.container.querySelector("img");

    expect(image?.getAttribute("src")).toBe(`data:image/png;base64,${IMAGE}`);
  });
});
