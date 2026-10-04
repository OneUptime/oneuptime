import { getMeasurementMomentsText } from "../../../Utils/Measurement/MeasurementMoments";
import { getMeasurementSetupText } from "../../../../App/FeatureSet/Dashboard/src/Utils/Measurement/MeasurementSetup";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The words of the three Measurements pages - the moments, the ready-made
 * measurements, the forms' and lists' copy - in every dashboard language.
 *
 * The dashboard looks every string up in its locale files by its English
 * text, and a string with no entry silently stays English. This holds every
 * one of them to all seventeen files, and the pages to drawing no copy of
 * their own that skips the copy modules the strings are collected from.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

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

type ReadLocaleFunction = (locale: string) => Record<string, string>;

const readLocale: ReadLocaleFunction = (
  locale: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  );
};

const STRINGS: Array<string> = Array.from(
  new Set<string>([
    ...getMeasurementMomentsText(),
    ...getMeasurementSetupText(),
  ]),
);

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

const PAGES: Array<string> = [
  "Pages/Incidents/Settings/IncidentMeasurements.tsx",
  "Pages/Alerts/Settings/AlertMeasurements.tsx",
  "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceMeasurements.tsx",
  "Components/Measurement/MeasurementPresetPicker.tsx",
  "Components/Measurement/MeasurementSummaryElement.tsx",
  // The Measurements card on an incident's, alert's or maintenance event's page.
  "Components/Measurement/EventMeasurementsCard.tsx",
];

describe("the measurement pages' words", () => {
  const english: Record<string, string> = readLocale("en");

  test("are many - the scan is not reading an empty list", () => {
    expect(STRINGS.length).toBeGreaterThan(100);
  });

  test("each has an English entry that is itself", () => {
    for (const text of STRINGS) {
      expect({ text, value: english[text] }).toEqual({ text, value: text });
    }
  });

  test.each(OTHER_LOCALES)(
    "each is in %s, keeping its placeholders",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);

      for (const text of STRINGS) {
        const value: string | undefined = translations[text];

        expect({
          text,
          has: typeof value === "string" && value.length > 0,
        }).toEqual({
          text,
          has: true,
        });

        expect((value!.match(PLACEHOLDER) || []).sort()).toEqual(
          (text.match(PLACEHOLDER) || []).sort(),
        );
      }
    },
  );

  test("the metric names in them stay as they are, in every language", () => {
    for (const locale of OTHER_LOCALES) {
      const translations: Record<string, string> = readLocale(locale);

      for (const text of STRINGS) {
        const metricName: RegExpMatchArray | null = text.match(
          /oneuptime\.[a-z-]+\.measurement\.<key>/,
        );

        if (metricName) {
          expect(translations[text]).toContain(metricName[0]);
        }
      }
    }
  });

  test("the retired Start Anchor step title is gone from every language", () => {
    for (const locale of ["en", ...OTHER_LOCALES]) {
      expect(readLocale(locale)["Start Anchor"]).toBeUndefined();
    }
  });

  test.each(PAGES)(
    "%s writes no copy of its own: its words come from the copy modules",
    (file: string) => {
      const source: string = fs
        .readFileSync(path.join(DASHBOARD_SRC, file), "utf8")
        // Comments say what they like.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");

      expect(source).not.toMatch(/\b(title|description|placeholder|text):\s*"/);
      expect(source).not.toMatch(/\b(title|description|placeholder|text)="/);
    },
  );
});
