import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ValueFormatter from "../../../../Utils/ValueFormatter";
import {
  getUnitNameInLanguage,
  RATE_PERIOD_NAMES,
  UNIT_NAMES,
  UNIT_RATE_TEMPLATE,
} from "../../../../UI/Components/Charts/Utils/UnitNames";
import {
  createTranslator,
  Translator,
} from "../../../../UI/Utils/TranslateTemplate";
import { DASHBOARD_LANGUAGES } from "../../../Helpers/TranslatedLanguages";

/*
 * A metric chart's unit badge, a metric's row and its details said the unit
 * by ValueFormatter.getReadableUnit's English name ("Milliseconds", "Bytes
 * per Second") in every language, and the chart's legend toolbar (filter
 * and sort the series, the series list, the threshold lines, the
 * investigate menus) was English in fifteen. The names are keys now, worded
 * in every Dashboard language, and a rate is one sentence of the two in the
 * reader's order ("Bytes pro Sekunde", "초당 바이트").
 */

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard",
);

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];

// The legend toolbar's and the series list's words (Components/Metrics/MetricCharts).
const TOOLBAR_WORDS: ReadonlyArray<string> = [
  "{{count}} series",
  "Showing top {{shown}} of {{total}} series",
  "Filter series by name",
  "Filter {{count}} series",
  "Sort series by",
  "Sort: {{label}}",
  "Number of series to show",
  "How many series to fetch and plot",
  "Top {{count}}",
  "All series",
  "All series hidden",
  "Show all series",
  "Show {{count}} hidden",
  "{{visible}} of {{total}} series shown",
  "{{count}} hidden",
  "No series match “{{search}}”",
  "{{name}} — click to show",
  "{{name}} — click to hide",
  "Peak",
  "Latest",
  "ranked by peak value",
  "ranked by average value",
  "ranked by latest value",
  "Warning: {{value}}",
  "Critical: {{value}}",
  "Investigate {{name}}",
  "Investigate this series — logs, traces, and more",
  "Values at {{time}}",
  "+{{count}} more series",
];

// A metric's row on a Metrics tab (Components/Metrics/MetricRow): its hover link.
const ROW_WORDS: ReadonlyArray<string> = ["Explore"];

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const ENGLISH: Record<string, unknown> = readJson(
  path.join(DASHBOARD, "src/Locales/en.json"),
) as Record<string, unknown>;
const SAME_EVERYWHERE: Set<string> = new Set<string>(
  readJson(path.join(DASHBOARD, "i18n/SameAsEnglish.json")) as Array<string>,
);

function locale(language: string): Record<string, unknown> {
  return readJson(
    path.join(DASHBOARD, `src/Locales/${language}.json`),
  ) as Record<string, unknown>;
}

function keptAsWritten(language: string): Set<string> {
  return new Set<string>(
    (
      readJson(path.join(DASHBOARD, `i18n/Progress/${language}.json`)) as {
        sameAsEnglish?: Array<string>;
      }
    ).sameAsEnglish || [],
  );
}

function translatorFor(language: string): Translator {
  const words: Record<string, unknown> = locale(language);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = words[text];

    return typeof value === "string" ? value : undefined;
  }, language);
}

describe("the unit names", () => {
  test("are every name ValueFormatter gives a unit, and nothing else", () => {
    expect([...UNIT_NAMES].sort()).toEqual(
      ValueFormatter.getReadableUnitNames().sort(),
    );
  });

  test("and the periods of a rate are keys of the English locale", () => {
    for (const key of [
      ...UNIT_NAMES,
      ...RATE_PERIOD_NAMES,
      UNIT_RATE_TEMPLATE,
    ]) {
      expect({ key, english: ENGLISH[key] }).toEqual({ key, english: key });
    }
  });

  test.each(LANGUAGES)(
    "%s words every unit, period, the rate and the toolbar, or keeps a word as written on purpose",
    (language: string) => {
      const words: Record<string, unknown> = locale(language);
      const kept: Set<string> = keptAsWritten(language);
      const english: Array<string> = [
        ...UNIT_NAMES,
        ...RATE_PERIOD_NAMES,
        UNIT_RATE_TEMPLATE,
        ...TOOLBAR_WORDS,
        ...ROW_WORDS,
      ].filter((key: string): boolean => {
        return (
          words[key] === ENGLISH[key] &&
          !SAME_EVERYWHERE.has(key) &&
          !kept.has(key)
        );
      });

      expect({ language, english }).toEqual({ language, english: [] });
    },
  );

  test.each(LANGUAGES)(
    "%s words the rate apart from the English, or its own units could not fill it",
    (language: string) => {
      expect(locale(language)[UNIT_RATE_TEMPLATE]).not.toBe(UNIT_RATE_TEMPLATE);
    },
  );
});

describe("getUnitNameInLanguage", () => {
  test("English reads exactly as ValueFormatter writes it", () => {
    const english: Translator = translatorFor("en");

    for (const unit of ["By", "ms", "By/s", "%", "1", "{packets}", "s"]) {
      expect({ unit, name: getUnitNameInLanguage(unit, english) }).toEqual({
        unit,
        name: ValueFormatter.getReadableUnit(unit),
      });
    }
  });

  test.each([
    ["de", "ms", "Millisekunden"],
    ["de", "By/s", "Bytes pro Sekunde"],
    ["fr", "By/s", "Octets par seconde"],
    ["es", "%", "Porcentaje"],
    ["ja", "By/s", "バイト/秒"],
    ["ko", "By/s", "초당 바이트"],
    ["zh-CN", "ms", "毫秒"],
    ["ru", "By/s", "Байты/секунда"],
    ["fa", "By/s", "بایت بر ثانیه"],
    ["it", "By/s", "Byte/secondo"],
    // Danish shortens "per" to "pr.", whose full stop ends no sentence.
    ["da", "By/s", "Byte pr. sekund"],
  ])("%s writes %s as %s", (language: string, unit: string, name: string) => {
    expect(getUnitNameInLanguage(unit, translatorFor(language))).toBe(name);
  });

  test("a fraction metric reads Percent in the language", () => {
    expect(
      getUnitNameInLanguage("1", translatorFor("de"), {
        metricName: "system.cpu.utilization",
      }),
    ).toBe("Prozent");
  });

  test("a dimensionless count has no name, and a unit's own annotation reads as written, or in the words the locale has for it", () => {
    const german: Translator = translatorFor("de");

    expect(getUnitNameInLanguage("1", german)).toBe("");
    expect(getUnitNameInLanguage("", german)).toBe("");
    // A word no locale has (Data Observability made "Reconciliations" one).
    expect(locale("de")["Sprockets"]).toBeUndefined();
    expect(getUnitNameInLanguage("{sprockets}", german)).toBe("Sprockets");
    // "Tasks" is a word the Dashboard says in German.
    expect(getUnitNameInLanguage("{tasks}", german)).toBe(
      String(locale("de")["Tasks"]),
    );
  });

  test("a language that has not worded the rate says the English one whole", () => {
    const bare: Translator = createTranslator((text: string) => {
      return text === "Bytes" ? "Octets" : undefined;
    }, "fr");

    expect(getUnitNameInLanguage("By/s", bare)).toBe("Bytes per Second");
  });
});
