import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import SeriesPoints from "../../../../UI/Components/Charts/Types/SeriesPoints";
import { withTranslatedSeriesNames } from "../../../../UI/Components/Charts/Utils/SeriesNames";
import {
  Translator,
  createTranslator,
} from "../../../../UI/Utils/TranslateTemplate";

/*
 * The charts draw a series' name as they are handed it. A page whose series
 * are the product's own words - a network chart's In and Out, a disk's Read
 * and Write, "CPU %" - hands them over through withTranslatedSeriesNames,
 * so the legend, the hover line and the tooltip read in the reader's
 * language, while a series named by data (a service, a container, eth0)
 * reads as written.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function translatorFor(code: string): Translator {
  const locale: Record<string, unknown> = readLocale(code);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" ? value : undefined;
  }, code);
}

function series(...names: Array<string>): Array<SeriesPoints> {
  return names.map((name: string, index: number): SeriesPoints => {
    return {
      seriesName: name,
      data: [{ x: new Date(Date.UTC(2026, 9, 26, 12, index)), y: index }],
    };
  });
}

function namesOf(points: Array<SeriesPoints>): Array<string> {
  return points.map((point: SeriesPoints): string => {
    return point.seriesName;
  });
}

const PRODUCT_SERIES: ReadonlyArray<string> = [
  "In",
  "Out",
  "Read",
  "Write",
  "Received",
  "Transmitted",
  "Disk %",
  "Avg CPU %",
  "Peak Memory %",
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

describe("withTranslatedSeriesNames", () => {
  test("names the product's own series in the reader's language", () => {
    const german: Translator = translatorFor("de");
    const locale: Record<string, unknown> = readLocale("de");
    const drawn: Array<SeriesPoints> = withTranslatedSeriesNames(
      series("In", "Out"),
      german,
    );

    expect(namesOf(drawn)).toEqual([locale["In"], locale["Out"]]);
    expect(namesOf(drawn)).not.toEqual(["In", "Out"]);
  });

  test("keeps a series named by data as written", () => {
    const drawn: Array<SeriesPoints> = withTranslatedSeriesNames(
      series("eth0", "checkout-service", "In"),
      translatorFor("fr"),
    );

    expect(namesOf(drawn).slice(0, 2)).toEqual(["eth0", "checkout-service"]);
    expect(namesOf(drawn)[2]).toBe(readLocale("fr")["In"]);
  });

  test("leaves every point where it was", () => {
    const original: Array<SeriesPoints> = series("Read", "Write");
    const drawn: Array<SeriesPoints> = withTranslatedSeriesNames(
      original,
      translatorFor("ja"),
    );

    expect(
      drawn.map((point: SeriesPoints) => {
        return point.data;
      }),
    ).toEqual(
      original.map((point: SeriesPoints) => {
        return point.data;
      }),
    );
    // The series handed in is not changed.
    expect(namesOf(original)).toEqual(["Read", "Write"]);
  });

  test("gives back the same array for the same series, so the charts do not recompute", () => {
    const original: Array<SeriesPoints> = series("In", "Out");
    const german: Translator = translatorFor("de");

    expect(withTranslatedSeriesNames(original, german)).toBe(
      withTranslatedSeriesNames(original, german),
    );
  });

  test("reads the names again when the language changes", () => {
    const original: Array<SeriesPoints> = series("In", "Out");
    const german: Array<SeriesPoints> = withTranslatedSeriesNames(
      original,
      translatorFor("de"),
    );
    const russian: Array<SeriesPoints> = withTranslatedSeriesNames(
      original,
      translatorFor("ru"),
    );

    expect(namesOf(russian)).toEqual([
      readLocale("ru")["In"],
      readLocale("ru")["Out"],
    ]);
    expect(namesOf(russian)).not.toEqual(namesOf(german));
  });

  test("keeps each series object as it is in English", () => {
    const original: Array<SeriesPoints> = series("In", "Out");
    const english: Array<SeriesPoints> = withTranslatedSeriesNames(
      original,
      translatorFor("en"),
    );

    expect(english[0]).toBe(original[0]);
    expect(english[1]).toBe(original[1]);
  });

  test.each(LANGUAGES)(
    "every series name the pages write is a word of %s",
    (code: string) => {
      const drawn: Array<string> = namesOf(
        withTranslatedSeriesNames(
          series(...PRODUCT_SERIES),
          translatorFor(code),
        ),
      );
      const untranslated: Array<string> = PRODUCT_SERIES.filter(
        (name: string, index: number): boolean => {
          return drawn[index] === name;
        },
      );

      // The words a language writes as the English does, as its Dashboard lists them.
      const sameAsEnglish: Array<string> =
        (
          JSON.parse(
            fs.readFileSync(
              path.join(
                LOCALES,
                "..",
                "..",
                "i18n",
                "Progress",
                `${code}.json`,
              ),
              "utf8",
            ),
          ) as { sameAsEnglish?: Array<string> }
        ).sameAsEnglish || [];

      expect(
        untranslated.filter((name: string): boolean => {
          return !sameAsEnglish.includes(name);
        }),
      ).toEqual([]);
    },
  );
});
