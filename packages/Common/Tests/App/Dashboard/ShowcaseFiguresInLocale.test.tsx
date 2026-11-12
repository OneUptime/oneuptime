import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { createTranslator, Translator } from "../../../Types/Translator";
import { getNumberLocale } from "../../../Types/DateLanguage";
import { formatSloBurnRate } from "../../../Utils/Slo/SloWidgetFormat";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import ResourceShowcaseCard, {
  RESOURCE_SHOWCASE_ROW_STATE_TEST_ID,
  RESOURCE_SHOWCASE_STAT_VALUE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcaseCard";
import {
  ResourceShowcase,
  ShowcaseFigure,
  ShowcaseRow,
  ShowcaseStat,
  ShowcaseValue,
  formatShowcaseFigure,
  isShowcaseFigure,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcase";
import {
  ProductKey,
  ProductOnboarding,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductOnboarding";
import { PRODUCT_ONBOARDINGS } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/ProductOnboardings";
import {
  INCIDENTS_SHOWCASE,
  SLOS_SHOWCASE,
  STATUS_PAGES_SHOWCASE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/Showcases/EssentialsShowcases";
import { TRACES_SHOWCASE } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductOnboarding/Showcases/ObservabilityShowcases";
import MESSAGE_QUEUE_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueShowcase";

/*
 * AN EXAMPLE'S NUMBERS IN THE READER'S LANGUAGE (#6535).
 *
 * Every product explains itself with a drawn example (ResourceShowcaseCard):
 * "Subscribers 1,284", "Availability 99.95%". Its numbers were English text,
 * drawn as written in every language, and a German, Spanish or French
 * reader - whose decimal sign is the comma - read "1,284" as one point two
 * eight four. They are figures now (ShowcaseFigure), written when drawn as
 * the rest of the Dashboard writes numbers (the translator's formatNumber):
 * "1.284" in German, "۱٬۲۸۴" in Persian, "1,284" in Arabic, whose numbers
 * the product writes in Latin digits. English reads as it always has.
 *
 * Read from the Dashboard's shipped locale files, as a reader gets them.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

// Every language the Dashboard ships, English too.
const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");
const FA: Record<string, string> = readLocale("fa");
const AR: Record<string, string> = readLocale("ar");

function translatorFor(language: string): Translator {
  const locale: Record<string, string> = readLocale(language);

  return createTranslator((key: string): string | undefined => {
    return locale[key];
  }, language);
}

const ENGLISH: Translator = translatorFor("en");
const GERMAN: Translator = translatorFor("de");
const PERSIAN: Translator = translatorFor("fa");
const ARABIC: Translator = translatorFor("ar");
const JAPANESE: Translator = translatorFor("ja");

// The space German and French put before a percent sign: a no-break space.
const NO_BREAK_SPACE: string = "\u00A0";

// Digits other than Latin ones: Arabic-Indic and Persian.
const NON_LATIN_DIGIT_PATTERN: RegExp = /[\u0660-\u0669\u06F0-\u06F9]/;
const LATIN_DIGIT_PATTERN: RegExp = /[0-9]/;

// An English decimal point or thousands comma between digits: "2.14", "1,284".
const ENGLISH_SEPARATOR_PATTERN: RegExp = /\d[.,]\d/;

// What a figure written wrong would show.
const BROKEN_FIGURE_PATTERN: RegExp = /NaN|Infinity|undefined|null|object/;

const SHOWCASES: Array<[ProductKey, ResourceShowcase]> = (
  Object.entries(PRODUCT_ONBOARDINGS) as Array<[ProductKey, ProductOnboarding]>
).map(
  ([product, onboarding]: [ProductKey, ProductOnboarding]): [
    ProductKey,
    ResourceShowcase,
  ] => {
    return [product, onboarding.showcase];
  },
);

// A showcase's stat values and row states, in the order it draws them.
function getStatValues(showcase: ResourceShowcase): Array<ShowcaseValue> {
  return showcase.preview.stats.map((stat: ShowcaseStat): ShowcaseValue => {
    return stat.value;
  });
}

function getFigures(showcase: ResourceShowcase): Array<ShowcaseFigure> {
  const figures: Array<ShowcaseFigure> = [];

  for (const value of [
    ...getStatValues(showcase),
    ...showcase.preview.rows.map((row: ShowcaseRow): ShowcaseValue => {
      return row.statusText;
    }),
  ]) {
    if (isShowcaseFigure(value)) {
      figures.push(value);
    }
  }

  return figures;
}

const ALL_FIGURES: Array<ShowcaseFigure> = SHOWCASES.flatMap(
  ([, showcase]: [ProductKey, ResourceShowcase]): Array<ShowcaseFigure> => {
    return getFigures(showcase);
  },
);

// True when `language` writes its decimal sign as a comma: "2,14".
function writesDecimalComma(language: string): boolean {
  const decimal: Intl.NumberFormatPart | undefined = new Intl.NumberFormat(
    getNumberLocale(language),
  )
    .formatToParts(1.5)
    .find((part: Intl.NumberFormatPart): boolean => {
      return part.type === "decimal";
    });

  return decimal?.value === ",";
}

function shown(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "");
}

function drawnStatValues(): Array<string> {
  return screen.getAllByTestId(RESOURCE_SHOWCASE_STAT_VALUE_TEST_ID).map(shown);
}

function drawnRowStates(): Array<string> {
  return screen.getAllByTestId(RESOURCE_SHOWCASE_ROW_STATE_TEST_ID).map(shown);
}

// The figure as `translator` writes it, a code as written.
function expectedValue(value: ShowcaseValue, translator: Translator): string {
  return withoutIsolateMarks(
    isShowcaseFigure(value) ? formatShowcaseFigure(value, translator) : value,
  );
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: EN },
      de: { translation: DE },
      fa: { translation: FA },
      ar: { translation: AR },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("a showcase figure, written the reader's way", () => {
  test("English reads as the product's English always has", () => {
    const cases: Array<[ShowcaseFigure, string]> = [
      [1284, "1,284"],
      [48_210, "48,210"],
      [6, "6"],
      [2.14, "2.14"],
      [{ percent: 99.98 }, "99.98%"],
      [{ percent: 63 }, "63%"],
      [{ milliseconds: 184 }, "184 ms"],
      [{ seconds: 1.24 }, "1.24 s"],
      [{ megabytes: 412 }, "412 MB"],
      [{ gigabytes: 6.4 }, "6.4 GB"],
      [{ gigabitsPerSecond: 1.2 }, "1.2 Gbps"],
      [{ dBm: -67 }, "-67 dBm"],
      [{ abbreviated: 1_820_000 }, "1.82M"],
      [{ abbreviated: 482_000 }, "482K"],
      [{ abbreviated: 42_200 }, "42.2K"],
      [{ usDollars: 4120 }, "$4,120"],
      [{ usDollars: 42.18 }, "$42.18"],
      [{ burnRate: 0.4 }, "0.4\u00D7"],
      [{ toOne: 4.3 }, "4.3:1"],
      [{ count: 11, outOf: 12 }, "11/12"],
      [{ percentUsed: 71 }, "71% used"],
    ];

    for (const [figure, english] of cases) {
      expect({ figure, text: formatShowcaseFigure(figure, ENGLISH) }).toEqual({
        figure,
        text: english,
      });
    }
  });

  test("German writes the comma as its decimal sign and the point between thousands", () => {
    expect(formatShowcaseFigure(1284, GERMAN)).toBe("1.284");
    expect(formatShowcaseFigure(48_210, GERMAN)).toBe("48.210");
    expect(formatShowcaseFigure(2.14, GERMAN)).toBe("2,14");
    expect(formatShowcaseFigure({ percent: 99.98 }, GERMAN)).toBe(
      `99,98${NO_BREAK_SPACE}%`,
    );
    expect(formatShowcaseFigure({ gigabytes: 6.4 }, GERMAN)).toBe(
      `6,4${NO_BREAK_SPACE}GB`,
    );
    expect(formatShowcaseFigure({ usDollars: 4120 }, GERMAN)).toBe(
      `4.120${NO_BREAK_SPACE}$`,
    );
    expect(formatShowcaseFigure({ toOne: 4.3 }, GERMAN)).toBe("4,3:1");
    expect(formatShowcaseFigure({ count: 41, outOf: 42 }, GERMAN)).toBe(
      "41/42",
    );
    // A unit in German's own word for it, not the English symbol.
    expect(formatShowcaseFigure({ seconds: 1.24 }, GERMAN)).toBe(
      new Intl.NumberFormat("de", {
        style: "unit",
        unit: "second",
        unitDisplay: "short",
      }).format(1.24),
    );
    expect(formatShowcaseFigure({ seconds: 1.24 }, GERMAN)).not.toBe("1.24 s");
    // A million in German's own abbreviation.
    expect(formatShowcaseFigure({ abbreviated: 1_820_000 }, GERMAN)).toBe(
      new Intl.NumberFormat("de", {
        notation: "compact",
        maximumSignificantDigits: 3,
      }).format(1_820_000),
    );
    expect(formatShowcaseFigure({ abbreviated: 1_820_000 }, GERMAN)).toMatch(
      /^1,82\s/,
    );
  });

  test("a count is what the product's own formatter writes for each language", () => {
    for (const translator of [ENGLISH, GERMAN, PERSIAN, ARABIC, JAPANESE]) {
      expect(formatShowcaseFigure(1284, translator)).toBe(
        translator.formatNumber(1284),
      );
    }
    // Persian in its own digits, Arabic in Latin ones (Locales/ARABIC.md).
    expect(formatShowcaseFigure(1284, PERSIAN)).toBe("۱٬۲۸۴");
    expect(formatShowcaseFigure(1284, ARABIC)).toBe("1,284");
  });

  test("Persian writes every kind of figure in its own digits", () => {
    expect(formatShowcaseFigure({ percent: 99.98 }, PERSIAN)).toBe("۹۹٫۹۸٪");
    expect(formatShowcaseFigure({ count: 11, outOf: 12 }, PERSIAN)).toBe(
      "۱۱/۱۲",
    );
    expect(formatShowcaseFigure({ toOne: 4.3 }, PERSIAN)).toBe("۴٫۳:۱");

    for (const figure of ALL_FIGURES) {
      const text: string = formatShowcaseFigure(figure, PERSIAN);

      expect({ figure, latinDigits: LATIN_DIGIT_PATTERN.test(text) }).toEqual({
        figure,
        latinDigits: false,
      });
    }
  });

  test("Arabic writes Latin digits, with its own words for a unit", () => {
    expect(formatShowcaseFigure({ count: 11, outOf: 12 }, ARABIC)).toBe(
      "11/12",
    );
    expect(formatShowcaseFigure({ abbreviated: 1_820_000 }, ARABIC)).toBe(
      new Intl.NumberFormat("ar-u-nu-latn", {
        notation: "compact",
        maximumSignificantDigits: 3,
      }).format(1_820_000),
    );
    expect(formatShowcaseFigure({ milliseconds: 184 }, ARABIC)).not.toContain(
      "ms",
    );
  });

  test("a share in use is said in the Dashboard's own words for it, its percent the reader's way", () => {
    expect(
      withoutIsolateMarks(formatShowcaseFigure({ percentUsed: 71 }, GERMAN)),
    ).toBe(
      DE["{{percent}} used"]!.replace("{{percent}}", `71${NO_BREAK_SPACE}%`),
    );
    expect(
      withoutIsolateMarks(formatShowcaseFigure({ percentUsed: 92 }, PERSIAN)),
    ).toBe(FA["{{percent}} used"]!.replace("{{percent}}", "۹۲٪"));
    expect(
      withoutIsolateMarks(
        formatShowcaseFigure({ percentUsed: 92 }, translatorFor("ru")),
      ),
    ).toMatch(/^Занято 92\s%$/);
  });

  test("Japanese counts a large number in its own units", () => {
    expect(formatShowcaseFigure({ abbreviated: 1_820_000 }, JAPANESE)).toBe(
      "182万",
    );
  });

  test("a burn rate is written as the SLO pages write it", () => {
    for (const translator of [ENGLISH, GERMAN, PERSIAN, ARABIC]) {
      expect(formatShowcaseFigure({ burnRate: 0.4 }, translator)).toBe(
        formatSloBurnRate(0.4, translator),
      );
    }
    expect(formatShowcaseFigure({ burnRate: 0.4 }, GERMAN)).toBe("0,4\u00D7");
  });
});

describe("every showcase's figures, in every language the Dashboard ships", () => {
  test("the showcases hold figures: the guard below is not vacuous", () => {
    // About 180 numbers across the products' examples.
    expect(ALL_FIGURES.length).toBeGreaterThan(150);
    expect(LANGUAGES).toEqual(
      expect.arrayContaining(["en", "de", "fa", "ar", "ja", "zh-CN"]),
    );
  });

  test.each(LANGUAGES)(
    "%s: every figure is written, in the digits the language writes",
    (language: string) => {
      const translator: Translator = translatorFor(language);
      const broken: Array<string> = [];

      for (const figure of ALL_FIGURES) {
        const text: string = formatShowcaseFigure(figure, translator);

        if (text.trim() === "" || BROKEN_FIGURE_PATTERN.test(text)) {
          broken.push(`${JSON.stringify(figure)} -> ${text}`);
        }

        // Persian writes its own digits; every other language Latin ones.
        const wrongDigits: RegExp =
          language === "fa" ? LATIN_DIGIT_PATTERN : NON_LATIN_DIGIT_PATTERN;

        if (wrongDigits.test(text)) {
          broken.push(`${JSON.stringify(figure)} -> ${text}`);
        }

        // A plain count is the product's own formatter's, exactly.
        if (typeof figure === "number" && Number.isInteger(figure)) {
          if (text !== translator.formatNumber(figure)) {
            broken.push(`${JSON.stringify(figure)} -> ${text}`);
          }
        }
      }

      expect(broken).toEqual([]);
    },
  );

  test.each(
    LANGUAGES.filter((language: string): boolean => {
      return writesDecimalComma(language);
    }),
  )(
    "%s: a decimal comma language never reads an English decimal point or thousands comma",
    (language: string) => {
      const translator: Translator = translatorFor(language);
      const readAsEnglish: Array<string> = [];

      for (const figure of ALL_FIGURES) {
        const english: string = formatShowcaseFigure(figure, ENGLISH);

        if (
          ENGLISH_SEPARATOR_PATTERN.test(english) &&
          formatShowcaseFigure(figure, translator) === english
        ) {
          readAsEnglish.push(english);
        }
      }

      expect(readAsEnglish).toEqual([]);
    },
  );

  test("German, French, Spanish and Russian are among the languages writing a decimal comma", () => {
    for (const language of ["de", "fr", "es", "ru"]) {
      expect({ language, comma: writesDecimalComma(language) }).toEqual({
        language,
        comma: true,
      });
    }
    expect(writesDecimalComma("en")).toBe(false);
  });
});

describe("the showcase draws its figures in the reader's language", () => {
  test("Status Pages' subscribers: 1,284 in English, 1.284 in German", async () => {
    render(<ResourceShowcaseCard showcase={STATUS_PAGES_SHOWCASE} />);

    expect(drawnStatValues()).toEqual(["99.95%", "6", "1,284", "1"]);

    cleanup();
    await i18next.changeLanguage("de");
    render(<ResourceShowcaseCard showcase={STATUS_PAGES_SHOWCASE} />);

    expect(drawnStatValues()).toEqual([
      `99,95${NO_BREAK_SPACE}%`,
      "6",
      "1.284",
      "1",
    ]);
  });

  test("Persian draws its own digits; Arabic the Latin ones the product writes", async () => {
    await i18next.changeLanguage("fa");
    render(<ResourceShowcaseCard showcase={STATUS_PAGES_SHOWCASE} />);

    expect(drawnStatValues()).toEqual(["۹۹٫۹۵٪", "۶", "۱٬۲۸۴", "۱"]);

    cleanup();
    await i18next.changeLanguage("ar");
    render(<ResourceShowcaseCard showcase={STATUS_PAGES_SHOWCASE} />);

    const arabic: Array<string> = drawnStatValues();

    expect(arabic[2]).toBe("1,284");
    expect(arabic[2]).toBe(ARABIC.formatNumber(1284));
    for (const value of arabic) {
      expect(value).not.toMatch(NON_LATIN_DIGIT_PATTERN);
    }
  });

  test("a row's figure is written the reader's way, and its word translated", async () => {
    render(<ResourceShowcaseCard showcase={TRACES_SHOWCASE} />);

    expect(drawnRowStates().slice(0, 3)).toEqual(["120 ms", "840 ms", "Error"]);

    cleanup();
    await i18next.changeLanguage("fa");
    render(<ResourceShowcaseCard showcase={TRACES_SHOWCASE} />);

    const persian: Array<string> = drawnRowStates();

    expect(persian[0]).toBe(
      withoutIsolateMarks(formatShowcaseFigure({ milliseconds: 120 }, PERSIAN)),
    );
    expect(persian[0]).toContain("۱۲۰");
    expect(persian[2]).toBe(FA["Error"]);
    expect(persian[2]).not.toBe("Error");
  });

  test("a code and a clock are drawn as written, in every language", async () => {
    await i18next.changeLanguage("fa");
    render(<ResourceShowcaseCard showcase={INCIDENTS_SHOWCASE} />);

    const values: Array<string> = drawnStatValues();

    expect(values).toContain("SEV 1");
    expect(values).toContain("00:21:07");
  });

  test("an SLO's burn rate is drawn as its SLO page draws it", async () => {
    await i18next.changeLanguage("de");
    render(<ResourceShowcaseCard showcase={SLOS_SHOWCASE} />);

    expect(drawnStatValues()[3]).toBe(formatSloBurnRate(0.4, GERMAN));
    expect(drawnStatValues()[3]).toBe("0,4\u00D7");
  });

  test("a queue's million in German's own abbreviation", async () => {
    await i18next.changeLanguage("de");
    render(<ResourceShowcaseCard showcase={MESSAGE_QUEUE_SHOWCASE} />);

    const published: string = drawnStatValues()[0] as string;

    expect(published).toBe(
      formatShowcaseFigure({ abbreviated: 1_820_000 }, GERMAN),
    );
    expect(published).not.toBe("1.82M");
  });

  test.each(["en", "de", "fa", "ar"])(
    "%s: every product's example draws each stat and row state as its translator writes it",
    async (language: string) => {
      await i18next.changeLanguage(language);
      const translator: Translator = translatorFor(language);
      const mismatches: Array<string> = [];

      for (const [product, showcase] of SHOWCASES) {
        render(<ResourceShowcaseCard showcase={showcase} />);

        const expectedStats: Array<string> = getStatValues(showcase).map(
          (value: ShowcaseValue): string => {
            return expectedValue(value, translator);
          },
        );
        const expectedFigureStates: Array<string | null> =
          showcase.preview.rows.map((row: ShowcaseRow): string | null => {
            return isShowcaseFigure(row.statusText)
              ? expectedValue(row.statusText, translator)
              : null;
          });
        const stats: Array<string> = drawnStatValues();
        const states: Array<string> = drawnRowStates();

        if (JSON.stringify(stats) !== JSON.stringify(expectedStats)) {
          mismatches.push(
            `${product}: ${JSON.stringify(stats)} != ${JSON.stringify(
              expectedStats,
            )}`,
          );
        }
        expectedFigureStates.forEach(
          (expected: string | null, index: number) => {
            if (expected !== null && states[index] !== expected) {
              mismatches.push(
                `${product} row ${index}: ${states[index]} != ${expected}`,
              );
            }
          },
        );

        cleanup();
      }

      expect(mismatches).toEqual([]);
    },
  );
});
