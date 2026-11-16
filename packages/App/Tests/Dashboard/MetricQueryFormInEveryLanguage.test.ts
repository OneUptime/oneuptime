// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
  readDashboardSameAsEnglish,
} from "Common/Tests/Helpers/DashboardLocales";
import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";

/*
 * THE METRIC QUERY FORM, WHOLE, IN EVERY LANGUAGE (#8310).
 *
 * #7931 worded the metric query card's own controls in all 17 languages:
 * its filter chips, Collapse and Expand, Display Settings, the chart type,
 * the thresholds. The rest of the form was English in most of them - about
 * thirty keys each in Italian, Portuguese, Dutch, Danish, Norwegian,
 * Swedish, Russian, Korean, Chinese and Hindi, seventeen in French:
 *
 *   - the metric picker and its aggregation (Metric name, Search and select
 *     a metric..., Aggregate by, Aggregation type), the per-second rate hint
 *     (This metric looks like a cumulative counter — convert to per-second
 *     rate?, Dismiss rate hint);
 *   - Filters & grouping, Filter by attributes, the Attribute Filter and its
 *     value box (Loading values...), Only chart this metric from these
 *     services., Only chart series whose attributes match these
 *     conditions.;
 *   - the series colour and group colour pickers (Series Color, Group
 *     colors, Auto — use the theme palette, Pick or type a value…, No
 *     pinned values yet., Remove {{value}}) and their colour names;
 *   - a formula's row (New formula, Remove formula, Tip: reference
 *     variables...).
 *
 * Every language words them all now. A colour a language names with the
 * English word (German Cyan, French Violet) is on its same-as-English list,
 * as the toolchain counts it.
 */

const PACKAGES: string = path.resolve(__dirname, "../../..");

// The word Norwegian no longer says for a metric (OneNamePerThing).
const NORWEGIAN_OTHER_WORD: RegExp = /metrikk/i;

// The metric query form: each file that draws its words.
export const METRIC_QUERY_FORM: ReadonlyArray<string> = [
  // The metric picker, its aggregation, filters, grouping and rate hint.
  "App/FeatureSet/Dashboard/src/Components/Metrics/MetricQuery.tsx",
  "App/FeatureSet/Dashboard/src/Components/Metrics/HintChip.tsx",
  // The query's card: its chips, Display Settings and thresholds.
  "App/FeatureSet/Dashboard/src/Components/Metrics/MetricQueryConfig.tsx",
  // The series' legend and unit.
  "App/FeatureSet/Dashboard/src/Components/Metrics/MetricAlias.tsx",
  // The series colour and the group colour pickers.
  "App/FeatureSet/Dashboard/src/Components/Metrics/SeriesColorSelector.tsx",
  "App/FeatureSet/Dashboard/src/Components/Metrics/SeriesGroupColorSelector.tsx",
  // A formula's row.
  "App/FeatureSet/Dashboard/src/Components/Metrics/MetricFormula.tsx",
  "App/FeatureSet/Dashboard/src/Components/Metrics/MetricFormulaConfig.tsx",
  // The attribute filter: its rows, its operators and the sentence a chip says.
  "Common/UI/Components/Filters/JSONFilter.tsx",
  "Common/UI/Components/Dictionary/Dictionary.tsx",
  "Common/UI/Components/Dictionary/DictionaryFilterOperator.ts",
  "Common/UI/Components/Dictionary/DictionaryFilterSentence.tsx",
];

function scan(file: string): Array<ExtractedString> {
  return scanSourceText(
    path.join("packages", file),
    fs.readFileSync(path.join(PACKAGES, file), "utf8"),
    { kind: "ui" },
  ).strings as Array<ExtractedString>;
}

// Every key the files draw, with the "one" form of a plural.
function keysOf(files: ReadonlyArray<string>): Array<string> {
  const keys: Set<string> = new Set<string>();

  for (const file of files) {
    for (const entry of scan(file)) {
      keys.add(entry.text);

      if (entry.pluralOne) {
        keys.add(`${entry.text}_one`);
      }
    }
  }

  return Array.from(keys).sort();
}

const FORM_KEYS: Array<string> = keysOf(METRIC_QUERY_FORM);

// The form's keys `language` leaves in English, as npm run i18n:check counts it.
function unworded(language: string): Array<string> {
  return FORM_KEYS.filter((key: string): boolean => {
    return !isWordedInDashboardLocale(key, language);
  });
}

/*
 * Runs `check` with `language`'s Dashboard words as they are, but `key` put
 * back to its English - the cached file the helpers read, restored after.
 */
function withKeyInEnglish<T>(language: string, key: string, check: () => T): T {
  const words: Record<string, string> = readDashboardLocale(language);
  const worded: string | undefined = words[key];

  words[key] = readDashboardLocale("en")[key] as string;

  try {
    return check();
  } finally {
    words[key] = worded as string;
  }
}

describe("the metric query form in every language", () => {
  test("the scan reads each part of the form's words", () => {
    for (const key of [
      "Metric name",
      "Search and select a metric...",
      "Aggregate by",
      "Aggregation type",
      "Filters & grouping",
      "Filter by attributes",
      "Attribute Filter",
      "Only chart this metric from these services.",
      "This metric looks like a cumulative counter — convert to per-second rate?",
      "Dismiss rate hint",
      "Series Color",
      "Group colors",
      "Auto — use the theme palette",
      "No pinned values yet.",
      "Pick or type a value…",
      "Remove {{value}}",
      "Cyan",
      "New formula",
      "Remove formula",
      "Display Settings",
    ]) {
      expect({ key, drawn: FORM_KEYS.includes(key) }).toEqual({
        key,
        drawn: true,
      });
    }

    expect(FORM_KEYS.length).toBeGreaterThan(100);
    expect(DASHBOARD_LANGUAGES.length).toBeGreaterThanOrEqual(17);
  });

  test("every key the form draws is a key of the English locale", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(
      FORM_KEYS.filter((key: string): boolean => {
        return english[key] === undefined;
      }),
    ).toEqual([]);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "every word the metric query form draws is worded in %s",
    (language: string) => {
      expect(unworded(language)).toEqual([]);
    },
  );

  test("a word put back to English is caught, in any language (control)", () => {
    for (const [language, key] of [
      ["it", "Filter by attributes"],
      ["nl", "Auto — use the theme palette"],
      ["ko", "Remove {{value}}"],
      ["de", "Only chart this metric from these services."],
      [
        "hi",
        'Tip: reference variables with or without a leading "$" (e.g. "a + b" or "$A + $B").',
      ],
    ] as Array<[string, string]>) {
      expect(
        withKeyInEnglish(language, key, () => {
          return unworded(language);
        }),
      ).toEqual([key]);
    }

    expect(unworded("it")).toEqual([]);
  });

  test("a colour named with the English word is on that language's list, never left English by chance", () => {
    for (const [language, colours] of [
      ["de", ["Cyan", "Indigo"]],
      ["fr", ["Cyan", "Fuchsia", "Indigo", "Violet"]],
      ["nl", ["Fuchsia", "Indigo", "Violet"]],
      ["da", ["Cyan", "Fuchsia", "Indigo", "Violet"]],
      ["no", ["Cyan", "Indigo"]],
      ["sv", ["Cyan", "Indigo"]],
    ] as Array<[string, Array<string>]>) {
      const kept: ReadonlyArray<string> = readDashboardSameAsEnglish(language);

      for (const colour of colours) {
        expect({ language, colour, kept: kept.includes(colour) }).toEqual({
          language,
          colour,
          kept: true,
        });
        expect(readDashboardLocale(language)[colour]).toBe(colour);
      }
    }
  });

  test("Norwegian says måling for a metric in the form, never metrikk", () => {
    const words: Record<string, string> = readDashboardLocale("no");

    for (const key of FORM_KEYS) {
      expect({
        key,
        said: NORWEGIAN_OTHER_WORD.test(words[key] || ""),
      }).toEqual({
        key,
        said: false,
      });
    }

    expect(words["Metric name"]).toContain("måling");
  });

  test("the Auto button reads in the sentence that names it", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);
      const auto: string = words["Auto"] || "Auto";
      const sentence: string =
        words[
          "Pick a color for this series, or leave on Auto to use the theme palette."
        ] || "";

      expect({ language, names: sentence.includes(auto) }).toEqual({
        language,
        names: true,
      });
    }
  });
});
