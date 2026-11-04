import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A QUEUE'S BROKER HEALTH SECTION SAYS ALL ITS WORDS IN THE READER'S
 * LANGUAGE.
 *
 * #5694 worded the section's metric names, its chart titles and the
 * sentences that link to the docs, while the section's own labels - "No
 * broker metrics in this range", "Set up broker metrics for this queue →",
 * "Open the Metrics explorer →", the line under a chart no monitor could
 * watch, "All metrics →" - and the chart dialog's notes stayed English in
 * fifteen languages: a German queue page drew "No series of this metric in
 * the selected range carries this queue's attributes ..." under its German
 * charts. Every string the section and its dialog draw is worded in every
 * language now, or kept as written on purpose (the language's
 * sameAsEnglish list: Danish and Norwegian "Sum").
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

const FILES: ReadonlyArray<string> = [
  "src/Components/MessageQueue/MessageQueueBrokerHealthSection.tsx",
  "src/Components/MessageQueue/MessageQueueMetricChartModal.tsx",
  "src/Components/MessageQueue/MessageQueueOverviewPresentation.ts",
];

const LANGUAGES: ReadonlyArray<string> = [
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

type Locale = Record<string, unknown>;

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const ENGLISH: Locale = readJson(
  path.join(DASHBOARD, "src/Locales/en.json"),
) as Locale;

// Every string the section and its dialog draw, as the extractor reads them.
const SECTION_STRINGS: Array<string> = Array.from(
  new Set<string>(
    FILES.flatMap((file: string): Array<string> => {
      const full: string = path.join(DASHBOARD, file);

      return (
        scanSourceText(
          path.relative(REPOSITORY_ROOT, full),
          fs.readFileSync(full, "utf8"),
          { kind: "ui" },
        ).strings as Array<ExtractedString>
      ).map((entry: ExtractedString): string => {
        return entry.text;
      });
    }),
  ),
);

describe("a queue's Broker health section", () => {
  test("draws its labels as keys of the English locale", () => {
    for (const text of [
      "Broker health",
      "No broker metrics in this range",
      "Set up broker metrics for this queue →",
      "Open the Metrics explorer →",
      "No series of this metric in the selected range carries this queue's attributes, so a monitor would watch nothing. Widen the range and try again.",
      "Charted for this queue only: the datapoints tagged with its key.",
    ]) {
      expect({ text, drawn: SECTION_STRINGS.includes(text) }).toEqual({
        text,
        drawn: true,
      });
      expect({ text, key: ENGLISH[text] }).toEqual({ text, key: text });
    }
  });

  test.each(LANGUAGES)(
    "%s words every one of them, or keeps one as written on purpose",
    (language: string) => {
      const words: Locale = readJson(
        path.join(DASHBOARD, `src/Locales/${language}.json`),
      ) as Locale;
      const kept: Set<string> = new Set<string>(
        (
          readJson(path.join(DASHBOARD, `i18n/Progress/${language}.json`)) as {
            sameAsEnglish?: Array<string>;
          }
        ).sameAsEnglish || [],
      );
      // "Sum" is Danish and Norwegian too.
      const sameWord: Set<string> = new Set<string>(
        ["da", "no"].includes(language) ? ["Sum"] : [],
      );

      const english: Array<string> = SECTION_STRINGS.filter(
        (text: string): boolean => {
          return (
            typeof ENGLISH[text] === "string" &&
            words[text] === ENGLISH[text] &&
            !kept.has(String(ENGLISH[text])) &&
            !sameWord.has(text)
          );
        },
      );

      expect({ language, english }).toEqual({ language, english: [] });
    },
  );

  test.each(LANGUAGES)(
    "%s keeps the chart dialog's description first in its note",
    (language: string) => {
      const words: Locale = readJson(
        path.join(DASHBOARD, `src/Locales/${language}.json`),
      ) as Locale;
      const note: string = String(
        words["{{metricDescription}} Charted for this queue only."],
      );

      expect(note.startsWith("{{metricDescription}} ")).toBe(true);
    },
  );
});
