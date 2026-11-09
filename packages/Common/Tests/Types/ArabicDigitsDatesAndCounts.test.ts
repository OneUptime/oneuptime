import { describe, expect, test } from "@jest/globals";
import {
  LATIN_DIGIT_LANGUAGES,
  formatDecimal,
  formatDurationText,
  formatRelativeDate,
  getDateLocale,
  getDigitsOf,
  getNumberLocale,
  writeDigitsInLocale,
  writesLatinDigits,
} from "../../Types/DateLanguage";
import {
  createTranslator,
  formatInline,
  formatList,
  getInlineSeparator,
  getListSeparator,
  getPluralCategory,
  PluralTemplate,
  Translator,
  writesZeroAsADot,
} from "../../Types/Translator";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";

/*
 * HOW ARABIC WRITES ITS NUMBERS, DATES AND COUNTS IN ONEUPTIME.
 *
 * - Latin digits (0-9), as the rest of what an Arabic reader of OneUptime
 *   reads is written (response times, status codes, addresses, ids), and in
 *   every engine alike: Chrome and Firefox write "ar" in Latin digits,
 *   Safari - and "ar-SA" anywhere - in Arabic-Indic ones (٠-٩).
 * - The Gregorian calendar every timestamp is stored in, never the Hijri one.
 * - Arabic's own words for months, units and relative times, its list comma
 *   "،", and the middle dot between facts (its zero is "0", not a dot).
 * - Six plural forms (zero, one, two, few, many, other). A locale file holds
 *   two: the "_one" form, read for exactly one, and the general form, read
 *   for every other count, so it is worded to read right for any of them.
 */

const NOW: Date = new Date(Date.UTC(2026, 9, 26, 15, 7, 0));

// Arabic-Indic (٠-٩) and Extended Arabic-Indic (Persian, ۰-۹) digits.
const NON_LATIN_DIGITS: RegExp = /[٠-٩۰-۹]/;

describe("the Intl locale Arabic writes numbers in", () => {
  test("Arabic is the one language that asks for Latin digits", () => {
    expect([...LATIN_DIGIT_LANGUAGES]).toEqual(["ar"]);
  });

  test.each<[string | null | undefined, string | undefined]>([
    ["ar", "ar-u-nu-latn"],
    ["ar-EG", "ar-EG-u-nu-latn"],
    ["ar-SA", "ar-SA-u-nu-latn"],
    ["ar_AE", "ar-AE-u-nu-latn"],
    [" ar ", "ar-u-nu-latn"],
    // A tag that names its own extensions is kept as it is.
    ["ar-u-nu-arab", "ar-u-nu-arab"],
    ["ar-u-ca-gregory-nu-latn", "ar-u-ca-gregory-nu-latn"],
    // Every other language is handed on as it came.
    ["fa", "fa"],
    ["de", "de"],
    ["zh-CN", "zh-CN"],
    ["en", "en"],
    // No language: the runtime's own default, as before.
    ["", undefined],
    ["   ", undefined],
    [null, undefined],
    [undefined, undefined],
  ])("%p -> %p", (language: string | null | undefined, locale?: string) => {
    expect(getNumberLocale(language)).toBe(locale);
  });

  test.each<[string, boolean]>([
    ["ar", true],
    ["AR", true],
    ["ar-EG", true],
    ["ar_SA", true],
    ["fa", false],
    ["arc", false],
    ["en", false],
    ["", false],
  ])("%p writes Latin digits: %p", (language: string, latin: boolean) => {
    expect(writesLatinDigits(language)).toBe(latin);
  });

  test("every number Arabic writes is in Latin digits, grouped and pointed as Arabic does", () => {
    const random: SeededRandom = seededRandom(6408);

    for (let index: number = 0; index < 300; index++) {
      const value: number =
        Math.round(random() * 10 ** (1 + (index % 9)) * 100) / 100;
      const text: string = new Intl.NumberFormat(getNumberLocale("ar")).format(
        value,
      );

      expect([value, NON_LATIN_DIGITS.test(text)]).toEqual([value, false]);
      expect([value, /[0-9]/.test(text)]).toEqual([value, true]);
    }

    expect(new Intl.NumberFormat(getNumberLocale("ar")).format(1234567.5)).toBe(
      "1,234,567.5",
    );
    expect(new Intl.NumberFormat(getNumberLocale("ar-SA")).format(26)).toBe(
      "26",
    );
  });

  test("a percentage and a unit are Latin digits with Arabic words", () => {
    const percent: string = new Intl.NumberFormat(getNumberLocale("ar"), {
      style: "percent",
    }).format(0.256);
    const minutes: string = new Intl.NumberFormat(getNumberLocale("ar"), {
      style: "unit",
      unit: "minute",
      unitDisplay: "long",
    }).format(3);

    expect(percent).toContain("26");
    expect(percent).toContain("%");
    expect(percent).not.toMatch(NON_LATIN_DIGITS);
    expect(minutes).toBe("3 دقائق");
  });

  test("Persian keeps its own digits", () => {
    expect(getNumberLocale("fa")).toBe("fa");
    expect(new Intl.NumberFormat(getNumberLocale("fa")).format(26)).toBe("۲۶");
  });
});

describe("the dates Arabic writes", () => {
  test.each<[string, string]>([
    ["ar", "ar-u-ca-gregory-nu-latn"],
    ["ar-EG", "ar-EG-u-ca-gregory-nu-latn"],
    ["fa", "fa-u-ca-gregory"],
  ])("%s -> %s", (language: string, locale: string) => {
    expect(getDateLocale(language)).toBe(locale);
  });

  test("a date is Gregorian, its month in Arabic, its digits Latin", () => {
    for (const language of ["ar", "ar-SA", "ar-EG", "ar-MA"]) {
      const text: string = new Intl.DateTimeFormat(getDateLocale(language), {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }).format(NOW);

      expect([language, text]).toEqual([
        language,
        expect.stringContaining("26"),
      ]);
      expect([language, text.includes("2026")]).toEqual([language, true]);
      // The Hijri year of this date is 1448.
      expect([language, text.includes("1448")]).toEqual([language, false]);
      expect([language, NON_LATIN_DIGITS.test(text)]).toEqual([
        language,
        false,
      ]);
    }

    expect(
      new Intl.DateTimeFormat(getDateLocale("ar"), {
        month: "long",
        timeZone: "UTC",
      }).format(NOW),
    ).toBe("أكتوبر");
  });

  test("a time is in Latin digits", () => {
    const text: string = new Intl.DateTimeFormat(getDateLocale("ar"), {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "UTC",
    }).format(NOW);

    expect(text).toContain("15:07");
  });

  test.each<[number, string]>([
    [-5 * 3600000, "قبل 5 ساعات"],
    [-3 * 60000, "قبل 3 دقائق"],
    [3 * 86400000 + 1000, "خلال 3 أيام"],
  ])("%i ms from now reads %s", (offset: number, text: string) => {
    expect(
      formatRelativeDate({
        date: new Date(NOW.getTime() + offset),
        now: NOW,
        locale: getDateLocale("ar"),
      }),
    ).toBe(text);
  });

  test("a relative date asked for with a bare language still writes Latin digits", () => {
    const text: string | null = formatRelativeDate({
      date: new Date(NOW.getTime() - 5 * 3600000),
      now: NOW,
      locale: "ar",
    });

    expect(text).not.toBeNull();
    expect(text).not.toMatch(NON_LATIN_DIGITS);
    expect(text).toContain("5");
  });

  test("a duration's figure and unit", () => {
    expect(
      formatDecimal({
        value: 1.72,
        locale: getDateLocale("ar"),
        maximumFractionDigits: 2,
      }),
    ).toBe("1.72");
    expect(
      formatDurationText({
        parts: [{ count: 3, unit: "minute" }],
        locale: getDateLocale("ar"),
        unitDisplay: "long",
        listStyle: "long",
      }),
    ).toBe("3 دقائق");
  });

  test("Arabic's digits are 0 to 9, so no text is rewritten into others", () => {
    expect(getDigitsOf(getDateLocale("ar"))).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ]);
    expect(writeDigitsInLocale("5 min, 2026", getDateLocale("ar"))).toBe(
      "5 min, 2026",
    );
  });
});

describe("the counts Arabic writes", () => {
  test.each<[number, string]>([
    [0, "zero"],
    [1, "one"],
    [2, "two"],
    [3, "few"],
    [10, "few"],
    [11, "many"],
    [99, "many"],
    [100, "other"],
    [102, "other"],
    [103, "few"],
    [1.5, "other"],
  ])("%p is in the %s form", (count: number, category: string) => {
    expect(getPluralCategory("ar", count)).toBe(category);
  });

  /*
   * The two forms a locale file holds, as the Arabic files word them: the
   * general form names the count after the thing, so it reads right for 0,
   * 2, 3-10, 11-99 and 100 alike.
   */
  const TEMPLATE: PluralTemplate = {
    one: "{{count}} monitor",
    other: "{{count}} monitors",
  };
  const ARABIC: Record<string, string> = {
    "{{count}} monitors": "المراقبات: {{count}}",
    "{{count}} monitors_one": "مراقبة واحدة ({{count}})",
  };
  const translator: Translator = createTranslator(
    (text: string): string | undefined => {
      return ARABIC[text];
    },
    "ar",
  );

  test.each<[number, string]>([
    [0, "المراقبات: 0"],
    [1, "مراقبة واحدة (1)"],
    [2, "المراقبات: 2"],
    [3, "المراقبات: 3"],
    [11, "المراقبات: 11"],
    [100, "المراقبات: 100"],
    [1234, "المراقبات: 1,234"],
  ])("%p reads %p", (count: number, text: string) => {
    expect(translator.translatePlural(TEMPLATE, count)).toBe(text);
  });

  test("a count is written in Latin digits, grouped as Arabic groups them", () => {
    expect(translator.formatNumber(1234567)).toBe("1,234,567");
    expect(translator.formatNumber(0)).toBe("0");
  });

  test("a list is joined with the Arabic comma, and facts with the middle dot", () => {
    expect(getListSeparator("ar")).toBe("، ");
    expect(formatList(["API", "Web", "DB"], translator)).toBe("API، Web، DB");
    expect(writesZeroAsADot("ar")).toBe(false);
    expect(getInlineSeparator("ar")).toBe(" · ");
    expect(formatInline(["الحوادث: 12", "التنبيهات: 3"], translator)).toBe(
      "الحوادث: 12 · التنبيهات: 3",
    );
  });

  test("Persian, whose zero is a dot, keeps the bullet between facts", () => {
    expect(writesZeroAsADot("fa")).toBe(true);
    expect(getInlineSeparator("fa")).toBe(" • ");
  });
});
