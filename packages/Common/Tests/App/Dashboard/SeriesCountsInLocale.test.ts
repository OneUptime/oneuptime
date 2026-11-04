import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { PluralTemplate } from "../../../Types/Translator";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  FILTER_SERIES_TEMPLATE,
  MORE_SERIES_TEMPLATE,
  SERIES_COUNT_TEMPLATE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/SeriesCounts";

/*
 * A METRIC CHART COUNTS ITS SERIES IN THE READER'S PLURAL.
 *
 * Beside a chart's unit badge, the count of its lines was looked up as one
 * sentence, "{{count}} series", and English writes that for one line and
 * for many. Translated (#5694), German read "1 Reihen" under every chart
 * of one line, French "1 séries", Dutch "1 reeksen", Danish, Norwegian and
 * Swedish "1 serier". The count, the legend's search box ("Filter
 * {{count}} series") and a moment's leftover count ("+{{count}} more
 * series") are plurals now, and every language with a "one" form words
 * it. German's series captions say Reihe too, the word its charts use.
 */

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard",
);

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

// A plural's one form is stored under its key plus this.
const ONE_FORM_SUFFIX: RegExp = /_one$/;
const SERIE: RegExp = /Serie/;
const REIHE: RegExp = /Reihe/;
const WHITESPACE: RegExp = /\s+/g;

const TEMPLATES: ReadonlyArray<PluralTemplate> = [
  SERIES_COUNT_TEMPLATE,
  FILTER_SERIES_TEMPLATE,
  MORE_SERIES_TEMPLATE,
];

function locale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD, `src/Locales/${language}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

/*
 * What a language writes as English does, on purpose (its i18n Progress
 * file's sameAsEnglish): Spanish "{{count}} series" is Spanish too.
 */
function keptAsWritten(language: string): Set<string> {
  return new Set<string>(
    (
      JSON.parse(
        fs.readFileSync(
          path.join(DASHBOARD, `i18n/Progress/${language}.json`),
          "utf8",
        ),
      ) as { sameAsEnglish?: Array<string> }
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

describe("a metric chart's counts of series", () => {
  test("are plurals whose English reads 'series' for one and many alike", () => {
    const english: Translator = translatorFor("en");

    expect(english.translatePlural(SERIES_COUNT_TEMPLATE, 1)).toBe("1 series");
    expect(english.translatePlural(SERIES_COUNT_TEMPLATE, 12)).toBe(
      "12 series",
    );
    expect(english.translatePlural(FILTER_SERIES_TEMPLATE, 1)).toBe(
      "Filter 1 series",
    );
    expect(english.translatePlural(MORE_SERIES_TEMPLATE, 3)).toBe(
      "+3 more series",
    );
  });

  test("are keys of the English locale, each with its one form", () => {
    const english: Record<string, unknown> = locale("en");

    for (const template of TEMPLATES) {
      expect({
        key: template.other,
        other: english[template.other],
        one: english[`${template.other}_one`],
      }).toEqual({
        key: template.other,
        other: template.other,
        one: template.one,
      });
    }
  });

  test.each(LANGUAGES)(
    "%s words both forms of every count",
    (language: string) => {
      const words: Record<string, unknown> = locale(language);
      const englishWords: Record<string, unknown> = locale("en");
      // The Progress lists hold English values, not keys.
      const kept: Set<string> = keptAsWritten(language);
      const english: Array<string> = TEMPLATES.flatMap(
        (template: PluralTemplate): Array<string> => {
          return [template.other, `${template.other}_one`];
        },
      ).filter((key: string): boolean => {
        const englishValue: string = String(englishWords[key]);

        return (
          typeof words[key] !== "string" ||
          (words[key] === englishValue &&
            words[key] === key.replace(ONE_FORM_SUFFIX, "") &&
            !kept.has(englishValue))
        );
      });

      expect({ language, english }).toEqual({ language, english: [] });
    },
  );

  // Languages whose one series is not their several series.
  test.each([
    ["de", "1 Reihe", "2 Reihen", "1 Reihe filtern", "+1 weitere Reihe"],
    ["fr", "1 série", "2 séries", "Filtrer 1 série", "+1 autre série"],
    ["es", "1 serie", "2 series", "Filtrar 1 serie", "+1 serie más"],
    ["pt", "1 série", "2 séries", "Filtrar 1 série", "+1 outra série"],
    ["nl", "1 reeks", "2 reeksen", "1 reeks filteren", "+1 andere reeks"],
    ["da", "1 serie", "2 serier", "Filtrer 1 serie", "+1 serie mere"],
    ["no", "1 serie", "2 serier", "Filtrer 1 serie", "+1 serie til"],
    ["sv", "1 serie", "2 serier", "Filtrera 1 serie", "+1 serie till"],
    ["ru", "1 ряд", "Рядов: 2", "Фильтр по рядам (1)", "Ещё 1 ряд"],
  ])(
    "%s says one series apart from two",
    (
      language: string,
      one: string,
      two: string,
      filterOne: string,
      moreOne: string,
    ) => {
      const translator: Translator = translatorFor(language);

      expect(translator.translatePlural(SERIES_COUNT_TEMPLATE, 1)).toBe(one);
      expect(translator.translatePlural(SERIES_COUNT_TEMPLATE, 2)).toBe(two);
      expect(translator.translatePlural(FILTER_SERIES_TEMPLATE, 1)).toBe(
        filterOne,
      );
      expect(translator.translatePlural(MORE_SERIES_TEMPLATE, 1)).toBe(moreOne);
    },
  );

  test("writes the count the reader's way", () => {
    expect(
      translatorFor("de").translatePlural(SERIES_COUNT_TEMPLATE, 1284),
    ).toBe("1.284 Reihen");
    expect(translatorFor("fa").translatePlural(SERIES_COUNT_TEMPLATE, 3)).toBe(
      "۳ سری",
    );
  });

  test("MetricCharts draws each count through translatePlural, never as one sentence", () => {
    const charts: string = fs.readFileSync(
      path.join(DASHBOARD, "src/Components/Metrics/MetricCharts.tsx"),
      "utf8",
    );

    const code: string = charts.replace(WHITESPACE, "");

    for (const name of [
      "SERIES_COUNT_TEMPLATE",
      "FILTER_SERIES_TEMPLATE",
      "MORE_SERIES_TEMPLATE",
    ]) {
      expect({
        name,
        plural: code.includes(`translator.translatePlural(${name},`),
      }).toEqual({ name, plural: true });
    }

    for (const template of TEMPLATES) {
      expect(charts).not.toContain(`"${template.other}"`);
    }
  });
});

describe("German's words for a chart's series", () => {
  // The series captions of the Metrics lists, and the legend's words.
  const SERIES_WORDS: ReadonlyArray<string> = [
    "average of series",
    "highest series",
    "lowest series",
    "total of series",
    "per second, all series",
    "{{count}} series",
    "{{count}} series_one",
    "Filter {{count}} series",
    "+{{count}} more series",
    "Showing top {{shown}} of {{total}} series",
    "{{visible}} of {{total}} series shown",
    "No series match “{{search}}”",
  ];

  test("say Reihe, as its charts do, never Serie", () => {
    const german: Record<string, unknown> = locale("de");
    const serie: Array<string> = SERIES_WORDS.filter((key: string): boolean => {
      return SERIE.test(String(german[key]));
    });
    const reihe: Array<string> = SERIES_WORDS.filter((key: string): boolean => {
      return REIHE.test(String(german[key]));
    });

    expect(serie).toEqual([]);
    expect(reihe).toEqual(SERIES_WORDS);
  });

  test("and the databases docs quote the captions as the Dashboard draws them", () => {
    const docs: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Docs/Content/de/telemetry/databases.md",
      ),
      "utf8",
    );
    const german: Record<string, unknown> = locale("de");

    for (const caption of ["total of series", "per second, all series"]) {
      expect(docs).toContain(`_${String(german[caption])}_`);
    }
    expect(docs).not.toContain("_Summe der Serien_");
  });
});
