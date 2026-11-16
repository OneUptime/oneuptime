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
 *
 * English is held too (#8302): "Every 5 min" broke as "Every 5" over
 * "min". And a unit a language writes in two words holds together after
 * its figure (#8304): Arabic's "411 ملي ث" could end a line with "ملي".
 * A lone quantity's key - "{{value}} ms", "{{count}} s" - is drawn with no
 * space a line breaks at anywhere in it, which finds such a unit in any
 * language; the units of two words its sentences write are listed here
 * too (UNITS_OF_TWO_WORDS).
 *
 * A duration's word is a unit too (#8770): "Alle 5 Minuten" broke as "Alle
 * 5" over "Minuten", "Every 5 minutes" as "Every 5" over "minutes". Every
 * sentence whose English writes a number and a space before one
 * (DURATION_WORDS) holds the figure to the word after it, in every language.
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
  "ns",
  "µs",
  "μs",
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

/*
 * The words English names a duration's unit with after a number and a
 * space, listed here apart from the code too: "Every {{count}} minutes",
 * "between 15 minutes and 14 days" (#8770). Each language's wording holds
 * the figure to whatever word it names the unit with.
 */
const DURATION_WORDS: ReadonlyArray<string> = [
  "second",
  "seconds",
  "minute",
  "minutes",
  "hour",
  "hours",
  "day",
  "days",
  "week",
  "weeks",
  "month",
  "months",
  "year",
  "years",
];

const DURATION_WORD: string = [...DURATION_WORDS]
  .sort((a: string, b: string): number => {
    return b.length - a.length;
  })
  .join("|");

// A unit's symbol, joined or after a space, or a duration's word after one.
const UNIT_AFTER_A_NUMBER: string = `(?: ?(?:${UNIT})| (?:${DURATION_WORD}))`;

// A placeholder English writes beside a unit: its name.
const PLACEHOLDER_WITH_A_UNIT: RegExp = new RegExp(
  `\\{\\{(\\w+)\\}\\}${UNIT_AFTER_A_NUMBER}(?![A-Za-z0-9_])`,
  "g",
);

// Written digits English writes beside a unit.
const DIGITS_WITH_A_UNIT: RegExp = new RegExp(
  `(?<![A-Za-z0-9_.,])(\\d+)${UNIT_AFTER_A_NUMBER}(?![A-Za-z0-9_])`,
  "g",
);

/*
 * The same, a unit's symbol only: what the server's English holds, whose
 * sentences OneUptime also writes into records it reads back by their
 * English (#8770).
 */
const PLACEHOLDER_WITH_A_SYMBOL: RegExp = new RegExp(
  `\\{\\{(\\w+)\\}\\} ?(?:${UNIT})(?![A-Za-z0-9_])`,
  "g",
);

const DIGITS_WITH_A_SYMBOL: RegExp = new RegExp(
  `(?<![A-Za-z0-9_.,])(\\d+) ?(?:${UNIT})(?![A-Za-z0-9_])`,
  "g",
);

const ONE_SUFFIX: string = "_one";

// A lone quantity's English: a placeholder and a unit, nothing else.
const LONE_QUANTITY: RegExp = new RegExp(`^\\{\\{\\w+\\}\\} ?(?:${UNIT})$`);

const PLACEHOLDER: RegExp = /\{\{\s*\w+\s*\}\}/g;

const BREAKING_SPACES: RegExp = /[ \u2000-\u2006\u2008-\u200A\u205F]/;

/*
 * The units a language's sentences write in two words after a number,
 * listed here apart from the code: Arabic's milliseconds, long, in each
 * spelling its sentences use, and its nanoseconds. A lone quantity's key
 * adds the ones each language writes there ("ملي ث").
 */
const UNITS_OF_TWO_WORDS: ReadonlyArray<string> = [
  "ملي ثانية",
  "مللي ثانية",
  "ميلي ثانية",
  "نانو ثانية",
];

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

/*
 * A unit of two words as it follows a held figure, its words apart by a
 * space a line breaks at: "\u00A0ملي ث".
 */
function unitBrokenInside(unit: string): RegExp {
  return new RegExp(
    `^\\u00A0${unit
      .split(" ")
      .map((word: string): string => {
        return escapeRegExp(word);
      })
      .join("[ \\u2000-\\u2006\\u2008-\\u200A\\u205F]+")}(?![\\p{L}\\p{M}])`,
    "u",
  );
}

/*
 * Each place in `drawn` where `figure` is followed by a space a line breaks
 * at, or by a unit of two words a line could break inside.
 */
function breaksAfter(
  drawn: string,
  figure: string,
  unitsOfTwoWords: ReadonlyArray<string> = UNITS_OF_TWO_WORDS,
): Array<string> {
  const text: string = inLatinDigits(drawn);
  const found: Array<string> = [];
  const brokenUnits: Array<RegExp> = unitsOfTwoWords.map(unitBrokenInside);
  let at: number = text.indexOf(figure);

  while (at >= 0) {
    const before: string = text.charAt(at - 1);
    const after: string = text.slice(at + figure.length);

    // Not the end of a longer number, nor of a name such as "p95".
    if (
      !PART_OF_A_NUMBER_OR_NAME.test(before) &&
      !STARTS_WITH_A_DIGIT.test(after) &&
      (BREAKING_SPACE.test(after) ||
        brokenUnits.some((broken: RegExp): boolean => {
          return broken.test(after);
        }))
    ) {
      found.push(text.slice(Math.max(0, at - 12), at + figure.length + 12));
    }

    at = text.indexOf(figure, at + 1);
  }

  return found;
}

/*
 * The units each language writes in two words after a number: the ones
 * listed here, and every one a lone quantity's key writes ("{{value}} ms":
 * "{{value}} ملي ث").
 */
function unitsOfTwoWordsIn(locale: Record<string, string>): Array<string> {
  const units: Set<string> = new Set<string>(UNITS_OF_TWO_WORDS);

  for (const key of Object.keys(locale)) {
    const wording: string | undefined = locale[key];

    if (typeof wording !== "string" || !LONE_QUANTITY.test(key)) {
      continue;
    }

    const unit: string = wording.replace(PLACEHOLDER, "").trim();

    if (BREAKING_SPACES.test(unit)) {
      units.add(unit.split(/\s+/).join(" "));
    }
  }

  return Array.from(units);
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
  // English itself: every key is its own wording, and is checked.
  isEnglish?: boolean;
  // Only a unit's symbol: English that is no page's (the server's).
  symbolsOnly?: boolean;
}): Checked {
  const checked: Checked = { sentences: 0, breaks: [] };
  const unitsOfTwoWords: Array<string> = unitsOfTwoWordsIn(data.locale);

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
    if (!data.isEnglish && (wording === key || wording === englishText)) {
      continue;
    }

    // A "_one" form is drawn only for the counts the language calls one.
    if (isOneForm && getPluralCategory(data.language, 1) !== "one") {
      continue;
    }

    const placeholders: Array<string> = Array.from(
      englishText.matchAll(
        data.symbolsOnly ? PLACEHOLDER_WITH_A_SYMBOL : PLACEHOLDER_WITH_A_UNIT,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
    const digits: Array<string> = Array.from(
      englishText.matchAll(
        data.symbolsOnly ? DIGITS_WITH_A_SYMBOL : DIGITS_WITH_A_UNIT,
      ),
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
      for (const spot of breaksAfter(drawn, figure, unitsOfTwoWords)) {
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

  test("the Dashboard in English, through the Translator (#8302)", () => {
    const english: Record<string, string> = readDashboardLocale("en");
    const checked: Checked = checkLanguage({
      language: "en",
      english,
      locale: english,
      draw: drawThrough(dashboardTranslator("en")),
      isEnglish: true,
    });

    // About 160 English sentences write a number, a space and a unit.
    expect(checked.sentences).toBeGreaterThan(150);
    expect(checked.breaks).toEqual([]);
  });

  test("the server in English, through its translator (#8302)", () => {
    const english: Record<string, string> = SERVER_LOCALES["en"] as Record<
      string,
      string
    >;
    const checked: Checked = checkLanguage({
      language: "en",
      english,
      locale: english,
      draw: drawThrough(getServerTranslator("en")),
      isEnglish: true,
      symbolsOnly: true,
    });

    expect(checked.breaks).toEqual([]);
  });

  /*
   * The server's English holds a unit's symbol and not a duration's word:
   * what it writes may become a record's text the Dashboard reads back by
   * its English (#8770). A page's English holds both.
   */
  test("the server's English leaves a duration's word to the page (control)", () => {
    expect(
      getServerTranslator("en").translateTemplate("Every {{count}} minutes", {
        count: "5",
      }),
    ).toBe("Every 5 minutes");
    expect(
      dashboardTranslator("en").translateTemplate("Every {{count}} minutes", {
        count: "5",
      }),
    ).toBe("Every 5\u00A0minutes");
  });

  test.each(["en", ...DASHBOARD_LANGUAGES])(
    "a lone quantity in the Dashboard in %s is drawn with no space a line breaks at in it (#8304)",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const drawn: Array<string> = [];

      for (const key of Object.keys(readDashboardLocale("en"))) {
        if (!LONE_QUANTITY.test(key)) {
          continue;
        }

        const text: string = translator.translateTemplate(key, figuresFor(key));

        if (BREAKING_SPACES.test(text)) {
          drawn.push(`${language} ${JSON.stringify(key)}: "${text}"`);
        }
      }

      expect(drawn).toEqual([]);
    },
  );

  test("the lone quantities checked are the Dashboard's durations, among others", () => {
    const lone: Array<string> = Object.keys(readDashboardLocale("en")).filter(
      (key: string): boolean => {
        return LONE_QUANTITY.test(key);
      },
    );

    expect(lone).toEqual(
      expect.arrayContaining([
        "{{value}} ms",
        "{{value}} s",
        "{{count}} ms",
        "{{count}} s",
        "{{minutes}} min",
      ]),
    );
  });

  test("Arabic's milliseconds hold together in every sentence that writes them (#8304)", () => {
    const arabic: Translator = dashboardTranslator("ar");

    expect(arabic.translateTemplate("{{value}} ms", { value: "411" })).toBe(
      "411\u00A0ملي\u00A0ث",
    );
    expect(unitsOfTwoWordsIn(readDashboardLocale("ar")).sort()).toEqual(
      [...UNITS_OF_TWO_WORDS, "ملي ث"].sort(),
    );
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

  test("a unit of two words that a line could break inside (#8304)", () => {
    expect(breaksAfter("زمن 9001\u00A0ملي ث", "9001")).toEqual([]);
    expect(breaksAfter("زمن 9001\u00A0ملي ث", "9001", ["ملي ث"])).toEqual([
      "زمن 9001\u00A0ملي ث",
    ]);
    expect(breaksAfter("زمن 9001\u00A0ملي\u00A0ث", "9001", ["ملي ث"])).toEqual(
      [],
    );
    expect(breaksAfter("9001\u00A0مللي ثانية أو", "9001")).toEqual([
      "9001\u00A0مللي ثانية ",
    ]);
    // A longer word that starts like the unit is none.
    expect(breaksAfter("9001\u00A0ملي ثقيل", "9001", ["ملي ث"])).toEqual([]);
  });

  test("a lone quantity's unit of two words is found in a locale", () => {
    expect(
      unitsOfTwoWordsIn({
        "{{value}} ms": "{{value}} ملي ث",
        "{{value}} s": "{{value}} ث",
        "Every {{minutes}} min": "كل {{minutes}} د",
      }),
    ).toContain("ملي ث");
    expect(unitsOfTwoWordsIn({ "{{value}} s": "{{value}} ث" })).not.toContain(
      "ث",
    );
  });

  test("English drawn with the plain space it is written with fails", () => {
    const checked: Checked = checkLanguage({
      language: "en",
      english: {},
      locale: { "Every {{minutes}} min": "Every {{minutes}} min" },
      draw: (
        _key: string,
        _english: string,
        figures: Record<string, string>,
      ): string => {
        return `Every ${figures["minutes"]} min`;
      },
      isEnglish: true,
    });

    expect(checked.sentences).toBe(1);
    expect(checked.breaks).toHaveLength(1);
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
