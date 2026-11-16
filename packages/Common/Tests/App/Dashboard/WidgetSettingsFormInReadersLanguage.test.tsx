import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import ArgumentsForm from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm";
import DashboardClockComponentUtil from "../../../Utils/Dashboard/Components/DashboardClockComponent";
import {
  readDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A WIDGET'S SETTINGS FORM, AS A READER SEES IT (#8479).
 *
 * Every word of a dashboard widget's settings is looked up as the form draws
 * it, and was English in every language: no source root of the extraction
 * read Common/Utils/Dashboard. The Clock widget's settings - its sections,
 * each setting's name, what it does and its placeholder - drawn by the real
 * settings form in English, German, Arabic and Persian.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const code of LANGUAGES) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: code,
      fallbackLng: "en",
      resources: {
        [code]: { translation: readDashboardLocaleAsDrawn(code) },
        en: { translation: readDashboardLocale("en") },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[code] = instance;
  }
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

function renderClockSettings(code: string): string {
  if (code === "ar" || code === "fa") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  render(
    <I18nextProvider i18n={instances[code] as i18n}>
      <ArgumentsForm
        component={DashboardClockComponentUtil.getDefaultComponent()}
        metrics={{ metricTypes: [], telemetryAttributes: [] }}
        onFormChange={() => {}}
      />
    </I18nextProvider>,
  );

  return withoutIsolateMarks(document.body.textContent || "").replace(
    /\s+/g,
    " ",
  );
}

function words(code: string, english: string): string {
  return code === "en"
    ? english
    : (readDashboardLocaleAsDrawn(code)[english] as string);
}

// What the Clock's open section and the folded one's header say.
const DRAWN: ReadonlyArray<string> = [
  "Clock",
  "Which timezone this clock shows",
  "Timezone",
  "The timezone this clock reads in. Leave empty to use the timezone of whoever is viewing the dashboard.",
  "Display Options",
  // The timezone picker's placeholder, which the dropdown draws as text.
  "Viewer's timezone",
];

describe.each(LANGUAGES)(
  "the Clock widget's settings in %s",
  (code: string) => {
    test("its sections, settings and what each does read in the reader's words", () => {
      const text: string = renderClockSettings(code);

      for (const english of DRAWN) {
        const expected: string = words(code, english).replace(/\s+/g, " ");

        expect({ english, drawn: text.includes(expected) }).toEqual({
          english,
          drawn: true,
        });
      }
    });
  },
);

describe("German, word for word", () => {
  test("the Clock's settings", () => {
    const text: string = renderClockSettings("de");

    for (const german of [
      "Zeitzone",
      "Welche Zeitzone diese Uhr zeigt",
      "Anzeigeoptionen",
    ]) {
      expect({ german, drawn: text.includes(german) }).toEqual({
        german,
        drawn: true,
      });
    }

    // Nothing of the English is left where the German says it.
    expect(text).not.toContain("Which timezone this clock shows");
    expect(text).not.toContain("Display Options");
  });
});
