// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getServerTranslator,
  SERVER_LOCALES,
} from "../../Server/Utils/ServerTranslation";
import {
  NoBreakLocaleTree,
  withNoBreakSpacesInLocale,
} from "../../Types/NoBreakSpaces";
import { getPluralCategory, Translator } from "../../Types/Translator";
import { escapeRegExp } from "../../Utils/RegExpEscape";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../Helpers/DashboardLocales";

/*
 * A NUMBER KEEPS ITS UNIT ON ITS LINE, IN EVERY LANGUAGE (#8043).
 *
 * English writes "Uptime ({{hours}}h)", "Every {{minutes}} min", "Last
 * 24h". Most translations write a space between the number and the unit -
 * "Verfügbarkeit ({{hours}} Std.)" - and a line may break at a plain
 * space: on a phone the network site hero's tile read "Verfügbarkeit (24"
 * over "Std.)". The Translator, and every frontend's i18next, sets that
 * space as a no-break one (Common/Types/NoBreakSpaces).
 *
 * This holds every sentence whose English writes a number beside a unit,
 * in every language that words it, to keep them together: the Dashboard's
 * through the Translator its components use, the Admin Dashboard's as its
 * i18next is handed them, and the server's through its translator. Each
 * number is filled with a figure of its own, and nothing a line breaks at
 * may follow that figure. The unit symbols English writes are listed here,
 * apart from the code, so a unit the code forgets fails here.
 */

const PACKAGES: string = path.resolve(__dirname, "../../..");

// A space a line may break at: the space and the fixed-width ones.
const BREAKING_SPACE: RegExp = /^[ \u2000-\u2006\u2008-\u200A\u205F]/;

// What a longer number, or a name such as "p95", runs into a figure with.
const PART_OF_A_NUMBER_OR_NAME: RegExp = /[0-9.,A-Za-z]/;

const STARTS_WITH_A_DIGIT: RegExp = /^[0-9]/;

// The unit symbols English writes beside a number.
const UNITS: ReadonlyArray<string> = [
  "%",
  "ms",
  "s",
  "min",
  "m",
  "h",
  "hr",
  "hrs",
  "d",
  "mo",
  "y",
  "B",
  "KB",
  "MB",
  "GB",
  "TB",
  "KiB",
  "MiB",
  "GiB",
  "dB",
  "dBm",
];

const UNIT: string = [...UNITS]
  .sort((a: string, b: string): number => {
    return b.length - a.length;
  })
  .map((unit: string): string => {
    return escapeRegExp(unit);
  })
  .join("|");

// A placeholder English writes beside a unit: its name.
const PLACEHOLDER_WITH_A_UNIT: RegExp = new RegExp(
  `\\{\\{(\\w+)\\}\\} ?(?:${UNIT})(?![A-Za-z0-9_])`,
  "g",
);

// Written digits English writes beside a unit.
const DIGITS_WITH_A_UNIT: RegExp = new RegExp(
  `(?<![A-Za-z0-9_.,])(\\d+) ?(?:${UNIT})(?![A-Za-z0-9_])`,
  "g",
);

const ONE_SUFFIX: string = "_one";

interface Checked {
  sentences: number;
  breaks: Array<string>;
}

// The figures each placeholder is filled with: one of its own each.
function figuresFor(english: string): Record<string, string> {
  const figures: Record<string, string> = {};
  let next: number = 9001;

  for (const match of english.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    const name: string = match[1] as string;

    if (!(name in figures)) {
      figures[name] = String(next++);
    }
  }

  return figures;
}

// Persian, Arabic-Indic and Devanagari digits as Latin ones.
function inLatinDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹०-९]/g, (digit: string): string => {
    const code: number = digit.charCodeAt(0);
    const zero: number = code >= 0x966 ? 0x966 : code >= 0x6f0 ? 0x6f0 : 0x660;

    return String(code - zero);
  });
}

// Each place in `drawn` where `figure` is followed by a space a line breaks at.
function breaksAfter(drawn: string, figure: string): Array<string> {
  const text: string = inLatinDigits(drawn);
  const found: Array<string> = [];
  let at: number = text.indexOf(figure);

  while (at >= 0) {
    const before: string = text.charAt(at - 1);
    const after: string = text.slice(at + figure.length);

    // Not the end of a longer number, nor of a name such as "p95".
    if (
      !PART_OF_A_NUMBER_OR_NAME.test(before) &&
      !STARTS_WITH_A_DIGIT.test(after) &&
      BREAKING_SPACE.test(after)
    ) {
      found.push(text.slice(Math.max(0, at - 12), at + figure.length + 6));
    }

    at = text.indexOf(figure, at + 1);
  }

  return found;
}

/*
 * Every sentence `english` keys whose English writes a number beside a
 * unit and that `language` words itself, drawn by `draw`, checked.
 */
function checkLanguage(data: {
  language: string;
  english: Record<string, string>;
  locale: Record<string, string>;
  draw: (
    key: string,
    english: string,
    figures: Record<string, string>,
  ) => string;
}): Checked {
  const checked: Checked = { sentences: 0, breaks: [] };

  for (const key of Object.keys(data.locale)) {
    const wording: string | undefined = data.locale[key];

    if (typeof wording !== "string") {
      continue;
    }

    const isOneForm: boolean = key.endsWith(ONE_SUFFIX);
    const englishText: string = isOneForm
      ? data.english[key] || key.slice(0, -ONE_SUFFIX.length)
      : key;

    // English left in the locale is no wording of the language's own.
    if (wording === key || wording === englishText) {
      continue;
    }

    // A "_one" form is drawn only for the counts the language calls one.
    if (isOneForm && getPluralCategory(data.language, 1) !== "one") {
      continue;
    }

    const placeholders: Array<string> = Array.from(
      englishText.matchAll(PLACEHOLDER_WITH_A_UNIT),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
    const digits: Array<string> = Array.from(
      englishText.matchAll(DIGITS_WITH_A_UNIT),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    if (placeholders.length === 0 && digits.length === 0) {
      continue;
    }

    checked.sentences++;

    const figures: Record<string, string> = figuresFor(englishText);
    const drawn: string = data.draw(key, englishText, figures);

    for (const figure of [
      ...placeholders.map((name: string): string => {
        return figures[name] as string;
      }),
      ...digits,
    ]) {
      for (const spot of breaksAfter(drawn, figure)) {
        checked.breaks.push(
          `${data.language} ${JSON.stringify(key)}: "${spot}"`,
        );
      }
    }
  }

  return checked;
}

// A sentence as a Translator fills it: a "_one" form as its plural.
function drawThrough(
  translator: Translator,
): (key: string, english: string, figures: Record<string, string>) => string {
  return (
    key: string,
    english: string,
    figures: Record<string, string>,
  ): string => {
    if (key.endsWith(ONE_SUFFIX)) {
      return translator.translatePlural(
        { one: english, other: key.slice(0, -ONE_SUFFIX.length) },
        1,
        figures,
      );
    }

    return translator.translateTemplate(key, figures);
  };
}

function readJson(file: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
}

describe("a number keeps its unit on its line", () => {
  test.each(DASHBOARD_LANGUAGES)(
    "the Dashboard in %s, through the Translator",
    (language: string) => {
      const checked: Checked = checkLanguage({
        language,
        english: readDashboardLocale("en"),
        locale: readDashboardLocale(language),
        draw: drawThrough(dashboardTranslator(language)),
      });

      expect(checked.sentences).toBeGreaterThan(20);
      expect(checked.breaks).toEqual([]);
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "the Admin Dashboard in %s, as its i18next is handed it",
    (language: string) => {
      const directory: string = path.join(
        PACKAGES,
        "App",
        "FeatureSet",
        "AdminDashboard",
        "src",
        "Locales",
      );
      const english: Record<string, string> = readJson(
        path.join(directory, "en.json"),
      );
      const shipped: NoBreakLocaleTree = withNoBreakSpacesInLocale({
        locale: readJson(path.join(directory, `${language}.json`)),
        language,
        english,
      });
      const checked: Checked = checkLanguage({
        language,
        english,
        locale: readJson(path.join(directory, `${language}.json`)),
        draw: (
          key: string,
          _english: string,
          figures: Record<string, string>,
        ): string => {
          let text: string = String(shipped[key]);

          for (const [name, figure] of Object.entries(figures)) {
            text = text.split(`{{${name}}}`).join(figure);
          }

          return text;
        },
      });

      expect(checked.breaks).toEqual([]);
    },
  );

  test.each(
    Object.keys(SERVER_LOCALES).filter((language: string): boolean => {
      return language !== "en";
    }),
  )("the server in %s, through its translator", (language: string) => {
    const checked: Checked = checkLanguage({
      language,
      english: SERVER_LOCALES["en"] as Record<string, string>,
      locale: SERVER_LOCALES[language] as Record<string, string>,
      draw: drawThrough(getServerTranslator(language)),
    });

    expect(checked.breaks).toEqual([]);
  });

  test("the sentences checked are the ones the issue found, among many", () => {
    const german: Checked = checkLanguage({
      language: "de",
      english: readDashboardLocale("en"),
      locale: {
        "Uptime ({{hours}}h)": "Verfügbarkeit ({{hours}} Std.)",
        "Uptime ({{days}}d)": "Verfügbarkeit ({{days}} T.)",
      },
      draw: drawThrough(dashboardTranslator("de")),
    });

    expect(german).toEqual({ sentences: 2, breaks: [] });
  });
});

describe("the check finds a number a line could part from its unit (control)", () => {
  test("a plain space after the figure, and not a no-break one", () => {
    expect(breaksAfter("Verfügbarkeit (9001 Std.)", "9001")).toEqual([
      "fügbarkeit (9001 Std.)",
    ]);
    expect(breaksAfter("Verfügbarkeit (9001\u00A0Std.)", "9001")).toEqual([]);
    expect(breaksAfter("Letzte 24 Std.", "24")).toEqual(["Letzte 24 Std."]);
    expect(breaksAfter("آخرین ۲۴ ساعت", "24")).toEqual(["آخرین 24 ساعت"]);
    // A word of Arabic runs into its number: "and 10".
    expect(breaksAfter("من 5\u00A0ms (و10 ms", "10")).toEqual([
      "من 5\u00A0ms (و10 ms",
    ]);
  });

  test("another number, or a name that ends in the figure, is none of its business", () => {
    expect(breaksAfter("240 Std. und 124 Std.", "24")).toEqual([]);
    expect(breaksAfter("p95 bedeutet", "95")).toEqual([]);
    expect(breaksAfter("9001\u00A0Std. 90011 x", "9001")).toEqual([]);
  });

  test("a sentence drawn with the plain space it is written with fails", () => {
    const checked: Checked = checkLanguage({
      language: "de",
      english: {},
      locale: { "Uptime ({{hours}}h)": "Verfügbarkeit ({{hours}} Std.)" },
      draw: (
        _key: string,
        _english: string,
        figures: Record<string, string>,
      ): string => {
        return `Verfügbarkeit (${figures["hours"]} Std.)`;
      },
    });

    expect(checked.sentences).toBe(1);
    expect(checked.breaks).toHaveLength(1);
  });
});
