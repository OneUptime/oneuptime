import { describe, expect, test } from "@jest/globals";
import {
  COMPACT_DURATION_AGO_TEMPLATES,
  COMPACT_DURATION_TEMPLATES,
  formatCompactDuration,
  formatCompactDurationAgo,
} from "../../Utils/Milliseconds";
import { getEnglishOf } from "../../Types/DateLanguage";
import { createTranslator, Translator } from "../../Types/Translator";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../Helpers/IsolateMarks";

/*
 * A COMPACT DURATION, IN THE READER'S LANGUAGE (#8455).
 *
 * The Dashboard wrote its short durations by hand - "12s", "4m 05s", "2d
 * 5h" - English letters and Latin digits in every language. They are
 * formatCompactDuration now: the Dashboard's compact keys, each worded by
 * every language, with each figure as the reader's language writes it.
 * English reads exactly as the hand-written text did.
 */

const NB: string = "\u00A0";

const EN: Translator = createTranslator(undefined, "en");

const translators: Record<string, Translator> = {
  en: dashboardTranslator("en"),
  de: dashboardTranslator("de"),
  fr: dashboardTranslator("fr"),
  ar: dashboardTranslator("ar"),
  fa: dashboardTranslator("fa"),
};

// What a language writes, its isolating marks left out.
const say: (
  language: string,
  write: (translator: Translator) => string,
) => string = (
  language: string,
  write: (translator: Translator) => string,
): string => {
  return withoutIsolateMarks(write(translators[language]!));
};

const LATIN_DIGIT: RegExp = /[0-9]/;
const LATIN_LETTER: RegExp = /[A-Za-z]/;

describe("formatCompactDuration in English", () => {
  test("reads exactly as the hand-written text did", () => {
    expect(formatCompactDuration(EN, { seconds: 12 })).toBe("12s");
    expect(formatCompactDuration(EN, { minutes: 5 })).toBe("5m");
    expect(formatCompactDuration(EN, { hours: 3 })).toBe("3h");
    expect(formatCompactDuration(EN, { days: 2 })).toBe("2d");
    expect(formatCompactDuration(EN, { months: 4 })).toBe("4mo");
    expect(formatCompactDuration(EN, { years: 2 })).toBe("2y");
    expect(formatCompactDuration(EN, { years: 1, months: 3 })).toBe("1y 3mo");
    expect(formatCompactDuration(EN, { minutes: 4, seconds: 5 })).toBe("4m 5s");
    expect(formatCompactDuration(EN, { hours: 1, minutes: 2 })).toBe("1h 2m");
    expect(formatCompactDuration(EN, { days: 2, hours: 5 })).toBe("2d 5h");
    expect(
      formatCompactDuration(EN, { hours: 1, minutes: 2, seconds: 3 }),
    ).toBe("1h 2m 3s");
    expect(
      formatCompactDuration(EN, {
        days: 1,
        hours: 2,
        minutes: 3,
        seconds: 4,
      }),
    ).toBe("1d 2h 3m 4s");
  });

  test("the Dashboard's own English translator writes the same", () => {
    for (const duration of [
      { seconds: 12 },
      { minutes: 4, seconds: 5 },
      { hours: 1, minutes: 2 },
      { days: 2, hours: 5 },
      { months: 4 },
    ]) {
      expect(
        say("en", (t: Translator) => {
          return formatCompactDuration(t, duration);
        }),
      ).toBe(formatCompactDuration(EN, duration));
    }
  });

  test("a field a clock writes in two digits: 4m 05s, 1h 02m", () => {
    expect(
      formatCompactDuration(
        EN,
        { minutes: 4, seconds: 5 },
        { padsAfterTheFirst: true },
      ),
    ).toBe("4m 05s");
    expect(
      formatCompactDuration(
        EN,
        { hours: 1, minutes: 2 },
        { padsAfterTheFirst: true },
      ),
    ).toBe("1h 02m");
    // Ten and up, and the first unit, are never padded.
    expect(
      formatCompactDuration(
        EN,
        { minutes: 4, seconds: 12 },
        { padsAfterTheFirst: true },
      ),
    ).toBe("4m 12s");
    expect(
      formatCompactDuration(EN, { seconds: 5 }, { padsAfterTheFirst: true }),
    ).toBe("5s");
  });

  test("the smallest unit takes its decimals, as toFixed wrote them", () => {
    expect(formatCompactDuration(EN, { seconds: 1.5 }, { decimals: 1 })).toBe(
      "1.5s",
    );
    expect(formatCompactDuration(EN, { seconds: 2 }, { decimals: 1 })).toBe(
      "2.0s",
    );
    expect(
      formatCompactDuration(
        EN,
        { seconds: 2.5 },
        { decimals: 3, dropTrailingZeros: true },
      ),
    ).toBe("2.5s");
    expect(
      formatCompactDuration(
        EN,
        { seconds: 30 },
        { decimals: 3, dropTrailingZeros: true },
      ),
    ).toBe("30s");
    // The larger units stay whole.
    expect(
      formatCompactDuration(EN, { minutes: 1, seconds: 2.25 }, { decimals: 1 }),
    ).toBe("1m 2.3s");
  });

  test("a big count keeps the figure the hand-written text had, no separator", () => {
    expect(formatCompactDuration(EN, { days: 1234, hours: 5 })).toBe(
      "1234d 5h",
    );
    expect(formatCompactDuration(EN, { minutes: 1500 })).toBe("1500m");
  });

  test("a count that is not a number is a dash; nothing named is 0s", () => {
    expect(formatCompactDuration(EN, { seconds: NaN })).toBe("-");
    expect(formatCompactDuration(EN, { minutes: 3, seconds: Infinity })).toBe(
      "-",
    );
    expect(formatCompactDuration(EN, {})).toBe("0s");
    expect(formatCompactDuration(EN, { seconds: 0 })).toBe("0s");
  });

  test("the units are named largest first, whatever order they are handed in", () => {
    expect(formatCompactDuration(EN, { seconds: 5, minutes: 4 })).toBe("4m 5s");
  });
});

describe("formatCompactDuration in German, French, Arabic and Persian", () => {
  test("one unit: the language's short unit, its figure its own way", () => {
    expect(
      say("de", (t: Translator) => {
        return formatCompactDuration(t, { seconds: 12 });
      }),
    ).toBe(`12${NB}Sek.`);
    expect(
      say("de", (t: Translator) => {
        return formatCompactDuration(t, { minutes: 5 });
      }),
    ).toBe(`5${NB}Min.`);
    expect(
      say("de", (t: Translator) => {
        return formatCompactDuration(t, { months: 4 });
      }),
    ).toBe(`4${NB}Mon.`);
    expect(
      say("fr", (t: Translator) => {
        return formatCompactDuration(t, { days: 2 });
      }),
    ).toBe(`2${NB}j`);
    expect(
      say("ar", (t: Translator) => {
        return formatCompactDuration(t, { seconds: 12 });
      }),
    ).toBe(`12${NB}ث`);
    expect(
      say("fa", (t: Translator) => {
        return formatCompactDuration(t, { seconds: 12 });
      }),
    ).toBe(`۱۲${NB}ثانیه`);
    expect(
      say("fa", (t: Translator) => {
        return formatCompactDuration(t, { months: 4 });
      }),
    ).toBe(`۴${NB}ماه`);
  });

  test("a pair of units: the language's pair", () => {
    expect(
      say("de", (t: Translator) => {
        return formatCompactDuration(t, { minutes: 4, seconds: 5 });
      }),
    ).toBe(`4${NB}Min. 5${NB}s`);
    expect(
      say("fr", (t: Translator) => {
        return formatCompactDuration(t, { hours: 1, minutes: 2 });
      }),
    ).toBe(`1${NB}h 2${NB}min`);
    expect(
      say("ar", (t: Translator) => {
        return formatCompactDuration(t, { days: 2, hours: 5 });
      }),
    ).toBe(`2${NB}ي 5${NB}س`);
    expect(
      say("fa", (t: Translator) => {
        return formatCompactDuration(
          t,
          { minutes: 4, seconds: 5 },
          { padsAfterTheFirst: true },
        );
      }),
    ).toBe(`۴${NB}دقیقه ۰۵${NB}ثانیه`);
  });

  test("three units and more: each unit's own words, in order", () => {
    expect(
      say("de", (t: Translator) => {
        return formatCompactDuration(t, { hours: 1, minutes: 2, seconds: 3 });
      }),
    ).toBe(`1${NB}Std. 2${NB}Min. 3${NB}Sek.`);
    expect(
      say("fa", (t: Translator) => {
        return formatCompactDuration(t, { hours: 1, minutes: 2, seconds: 3 });
      }),
    ).toBe(`۱${NB}ساعت ۲${NB}دقیقه ۳${NB}ثانیه`);
  });

  test("decimals: the language's decimal sign and digits", () => {
    expect(
      say("de", (t: Translator) => {
        return formatCompactDuration(t, { seconds: 1.5 }, { decimals: 1 });
      }),
    ).toBe(`1,5${NB}Sek.`);
    expect(
      say("ar", (t: Translator) => {
        return formatCompactDuration(t, { seconds: 1.5 }, { decimals: 1 });
      }),
    ).toBe(`1.5${NB}ث`);
    expect(
      say("fa", (t: Translator) => {
        return formatCompactDuration(t, { seconds: 1.5 }, { decimals: 1 });
      }),
    ).toBe(`۱٫۵${NB}ثانیه`);
  });

  test("a Persian duration holds no Latin digit and no Latin unit letter", () => {
    for (const duration of [
      { seconds: 59 },
      { minutes: 4, seconds: 5 },
      { hours: 23, minutes: 59 },
      { days: 400, hours: 23 },
      { months: 11 },
      { days: 1, hours: 2, minutes: 3, seconds: 4 },
    ]) {
      const text: string = say("fa", (t: Translator) => {
        return formatCompactDuration(t, duration, { padsAfterTheFirst: true });
      });

      expect({ duration, latinDigit: LATIN_DIGIT.test(text) }).toEqual({
        duration,
        latinDigit: false,
      });
      expect({ duration, latinLetter: LATIN_LETTER.test(text) }).toEqual({
        duration,
        latinLetter: false,
      });
    }
  });

  test("an Arabic duration keeps Latin digits, with Arabic units", () => {
    const text: string = say("ar", (t: Translator) => {
      return formatCompactDuration(t, { minutes: 4, seconds: 5 });
    });

    expect(text).toBe(`4${NB}د 5${NB}ث`);
    expect(LATIN_LETTER.test(text)).toBe(false);
  });

  test("the text is remembered with its English, for an English sentence", () => {
    const persian: string = formatCompactDuration(translators["fa"]!, {
      minutes: 4,
      seconds: 5,
    });

    expect(getEnglishOf(persian)).toBe("4m 5s");

    const german: string = formatCompactDuration(
      translators["de"]!,
      { minutes: 4, seconds: 5 },
      { padsAfterTheFirst: true },
    );

    expect(getEnglishOf(german)).toBe("4m 05s");

    // English is never remembered: it is its own English.
    expect(getEnglishOf(formatCompactDuration(EN, { seconds: 12 }))).toBe(
      undefined,
    );
  });

  test("an English sentence that holds a Persian duration puts its English back", () => {
    const persian: Translator = createTranslator((): string | undefined => {
      // A language that has not worded the sentence: no wording at all.
      return undefined;
    }, "fa");
    const duration: string = formatCompactDuration(translators["fa"]!, {
      minutes: 4,
      seconds: 5,
    });

    expect(
      withoutIsolateMarks(
        persian.translateTemplate("Finished in {{duration}}", { duration }),
      ),
    ).toBe("Finished in 4m 5s");
  });
});

describe("formatCompactDurationAgo", () => {
  test("English reads as the hand-written text did", () => {
    expect(formatCompactDurationAgo(EN, { seconds: 12 })).toBe("12s ago");
    expect(formatCompactDurationAgo(EN, { minutes: 5 })).toBe("5m ago");
    expect(formatCompactDurationAgo(EN, { hours: 3 })).toBe("3h ago");
    expect(formatCompactDurationAgo(EN, { days: 2 })).toBe("2d ago");
    expect(formatCompactDurationAgo(EN, { months: 4 })).toBe("4mo ago");
    expect(formatCompactDurationAgo(EN, { years: 2 })).toBe("2y ago");
    expect(formatCompactDurationAgo(EN, { seconds: NaN })).toBe("-");
    // Of several units, the largest is said; of none, seconds.
    expect(formatCompactDurationAgo(EN, { hours: 3, minutes: 20 })).toBe(
      "3h ago",
    );
    expect(formatCompactDurationAgo(EN, {})).toBe("0s ago");
  });

  test("a year, and the English it is remembered with", () => {
    const persian: string = formatCompactDurationAgo(translators["fa"]!, {
      years: 2,
    });

    expect(withoutIsolateMarks(persian)).toBe(`۲${NB}سال پیش`);
    expect(getEnglishOf(persian)).toBe("2y ago");
    expect(
      say("de", (t: Translator) => {
        return formatCompactDuration(t, { years: 2 });
      }),
    ).toBe(`2${NB}J.`);
    expect(
      say("ar", (t: Translator) => {
        return formatCompactDuration(t, { years: 2 });
      }),
    ).toBe(`2${NB}سنة`);
  });

  test("German, French, Arabic and Persian say it their way", () => {
    expect(
      say("de", (t: Translator) => {
        return formatCompactDurationAgo(t, { minutes: 5 });
      }),
    ).toBe(`vor 5${NB}Min.`);
    expect(
      say("fr", (t: Translator) => {
        return formatCompactDurationAgo(t, { hours: 3 });
      }),
    ).toBe(`il y a 3${NB}h`);
    expect(
      say("ar", (t: Translator) => {
        return formatCompactDurationAgo(t, { days: 2 });
      }),
    ).toBe(`قبل 2${NB}ي`);
    expect(
      say("fa", (t: Translator) => {
        return formatCompactDurationAgo(t, { minutes: 5 });
      }),
    ).toBe(`۵${NB}دقیقه پیش`);
  });
});

describe("the compact keys", () => {
  test("every language the Dashboard speaks has every key", () => {
    const keys: Array<string> = [
      ...Object.values(COMPACT_DURATION_TEMPLATES),
      ...Object.values(COMPACT_DURATION_AGO_TEMPLATES),
      "{{minutes}}m {{seconds}}s",
      "{{hours}}h {{minutes}}m",
      "{{days}}d {{hours}}h",
    ];

    for (const language of [
      "en",
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
      "ar",
    ]) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of keys) {
        expect({ language, key, has: typeof words[key] === "string" }).toEqual({
          language,
          key,
          has: true,
        });
        // Each keeps its placeholders.
        for (const placeholder of key.match(/\{\{\w+\}\}/g) || []) {
          expect({
            language,
            key,
            keeps: words[key]!.includes(placeholder),
          }).toEqual({ language, key, keeps: true });
        }
      }
    }
  });
});
