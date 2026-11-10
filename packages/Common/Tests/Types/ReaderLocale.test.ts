import { afterEach, describe, expect, test } from "@jest/globals";
import {
  ENGLISH_DATE_LANGUAGE,
  formatReaderNumber,
  getReaderDateLocale,
  getReaderNumberLocale,
  setDateDisplayLanguage,
} from "../../Types/DateLanguage";

/*
 * A NUMBER OR A DATE IS WRITTEN IN THE PAGE'S LANGUAGE, NOT THE BROWSER'S.
 *
 * toLocaleString() with no locale followed the browser: Safari or Chrome
 * on an Arabic system wrote "١٬٢٣٤" on an Arabic page, where every other
 * figure the page shows is in Latin digits, and a German page read in an
 * English browser wrote "1,234" beside the translator's "1.234". The
 * reader's locale follows the language the page is in (the date display
 * language every frontend sets from its i18n): Latin digits in Arabic,
 * Persian's own digits in Persian, German's grouping in German. An
 * English page keeps the runtime's own English (en-US here, en-GB in a
 * British browser), as it always has.
 */

const ARABIC_INDIC_DIGIT: RegExp = /[٠-٩]/;
const PERSIAN_DIGIT: RegExp = /[۰-۹]/;

afterEach(() => {
  setDateDisplayLanguage(ENGLISH_DATE_LANGUAGE);
});

describe("the reader's number locale", () => {
  test.each<[string, string]>([
    ["ar", "ar-u-nu-latn"],
    ["ar-EG", "ar-EG-u-nu-latn"],
    ["fa", "fa"],
    ["de", "de"],
    ["zh-CN", "zh-CN"],
  ])("a %s page writes numbers in %s", (language: string, locale: string) => {
    setDateDisplayLanguage(language);

    expect(getReaderNumberLocale()).toBe(locale);
  });

  test("an English page writes in the runtime's own English", () => {
    setDateDisplayLanguage("en");

    const runtime: string = new Intl.NumberFormat("en-US").resolvedOptions()
      .locale;

    // This suite runs in an English runtime (en-US).
    expect(getReaderNumberLocale()).toBe(runtime);
    expect((1234.5).toLocaleString(getReaderNumberLocale())).toBe("1,234.5");
  });

  test.each<[string, number, string]>([
    ["ar", 1234567, "1,234,567"],
    ["ar", 0.5, "0.5"],
    ["de", 1234567, "1.234.567"],
    ["fr", 1234567, "1 234 567"],
    ["en", 1234567, "1,234,567"],
  ])(
    "a %s page writes %p as %p",
    (language: string, value: number, written: string) => {
      setDateDisplayLanguage(language);

      expect(formatReaderNumber(value)).toBe(written);
      expect(value.toLocaleString(getReaderNumberLocale())).toBe(written);
    },
  );

  test("an Arabic page never writes Arabic-Indic digits", () => {
    setDateDisplayLanguage("ar");

    for (const value of [0, 7, 42, 1234, 98765.25, 1000000]) {
      const written: string = formatReaderNumber(value);

      expect(written).not.toMatch(ARABIC_INDIC_DIGIT);
      expect(written).toMatch(/[0-9]/);
    }

    expect(formatReaderNumber(0.42, { style: "percent" })).not.toMatch(
      ARABIC_INDIC_DIGIT,
    );
  });

  test("a Persian page writes Persian's own digits, as its counts are", () => {
    setDateDisplayLanguage("fa");

    expect(formatReaderNumber(1234)).toMatch(PERSIAN_DIGIT);
  });

  test("options are kept", () => {
    setDateDisplayLanguage("de");

    expect(formatReaderNumber(0.25, { style: "percent" })).toBe("25 %");
    expect(formatReaderNumber(3.14159, { maximumFractionDigits: 2 })).toBe(
      "3,14",
    );
  });
});

describe("the reader's date locale", () => {
  const SEPTEMBER_14: Date = new Date(Date.UTC(2026, 8, 14, 17, 1, 0));

  test("an Arabic page writes dates in Latin digits on the Gregorian calendar", () => {
    setDateDisplayLanguage("ar");

    const locale: string = getReaderDateLocale();
    const written: string = SEPTEMBER_14.toLocaleDateString(locale, {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    expect(locale).toContain("nu-latn");
    expect(written).toBe("14 سبتمبر 2026");
    expect(written).not.toMatch(ARABIC_INDIC_DIGIT);
  });

  test("a German page writes German dates", () => {
    setDateDisplayLanguage("de");

    expect(
      SEPTEMBER_14.toLocaleDateString(getReaderDateLocale(), {
        timeZone: "UTC",
      }),
    ).toBe("14.9.2026");
  });

  test("an English page writes as the runtime's English does", () => {
    setDateDisplayLanguage("en");

    expect(
      SEPTEMBER_14.toLocaleDateString(getReaderDateLocale(), {
        timeZone: "UTC",
      }),
    ).toBe("9/14/2026");
  });
});
