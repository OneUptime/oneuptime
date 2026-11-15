import { describe, expect, test } from "@jest/globals";
import {
  formatDurationInUnit,
  formatMillisecondsInEnglish,
} from "../../Utils/Milliseconds";
import { createTranslator, Translator } from "../../Types/Translator";

/*
 * A span in microseconds, seconds, minutes, hours or days, in the reader's
 * language (#8349): the figure in their digits and decimal sign with the
 * decimals toFixed wrote, the unit the language's own short one. English
 * reads exactly as the caller wrote it.
 */
const translatorIn: (language: string) => Translator = (
  language: string,
): Translator => {
  return createTranslator(undefined, language);
};

const EN: Translator = translatorIn("en");
const DE: Translator = translatorIn("de");
const FA: Translator = translatorIn("fa");
const AR: Translator = translatorIn("ar");

describe("formatDurationInUnit", () => {
  test("English reads as toFixed and the symbol wrote it", () => {
    expect(formatDurationInUnit(EN, 1.5, "second", { decimals: 2 })).toBe(
      "1.50\u00A0s",
    );
    expect(formatDurationInUnit(EN, 500, "microsecond", { decimals: 0 })).toBe(
      "500\u00A0µs",
    );
    expect(formatDurationInUnit(EN, 1.5, "minute", { decimals: 1 })).toBe(
      "1.5\u00A0min",
    );
    expect(formatDurationInUnit(EN, 2, "hour", { decimals: 1 })).toBe(
      "2.0\u00A0h",
    );
    expect(
      formatDurationInUnit(EN, 2, "hour", {
        decimals: 1,
        dropTrailingZeros: true,
      }),
    ).toBe("2\u00A0h");
    expect(formatDurationInUnit(EN, 3, "day", { decimals: 0 })).toBe(
      "3\u00A0d",
    );
  });

  test("English reads exactly as the caller wrote it when it says so", () => {
    expect(
      formatDurationInUnit(EN, 1.5, "second", {
        decimals: 2,
        english: "1.50s",
      }),
    ).toBe("1.50s");
    // The English is only English's: German writes its own.
    expect(
      formatDurationInUnit(DE, 1.5, "second", {
        decimals: 2,
        english: "1.50s",
      }),
    ).toBe("1,50\u00A0Sek.");
  });

  test("German, Persian and Arabic write the language's short unit", () => {
    expect(formatDurationInUnit(DE, 1.5, "second", { decimals: 2 })).toBe(
      "1,50\u00A0Sek.",
    );
    expect(formatDurationInUnit(DE, 2.5, "minute", { decimals: 1 })).toBe(
      "2,5\u00A0Min.",
    );
    expect(formatDurationInUnit(FA, 1.5, "second", { decimals: 2 })).toBe(
      "۱٫۵۰\u00A0ثانیه",
    );
    expect(formatDurationInUnit(FA, 2, "minute", { decimals: 0 })).toBe(
      "۲\u00A0دقیقه",
    );
    expect(formatDurationInUnit(AR, 1.5, "second", { decimals: 2 })).toBe(
      "1.50\u00A0ث",
    );
    // No Latin digit on a Persian page, whatever the unit.
    for (const unit of [
      "microsecond",
      "second",
      "minute",
      "hour",
      "day",
    ] as const) {
      expect(formatDurationInUnit(FA, 12.5, unit, { decimals: 1 })).not.toMatch(
        /[0-9]/,
      );
    }
  });

  test("the figure is rounded once, as toFixed rounds it, in every language", () => {
    expect(formatDurationInUnit(EN, 1.005, "second", { decimals: 2 })).toBe(
      `${(1.005).toFixed(2)}\u00A0s`,
    );
    expect(formatDurationInUnit(DE, 1.005, "second", { decimals: 2 })).toBe(
      `${(1.005).toFixed(2).replace(".", ",")}\u00A0Sek.`,
    );
  });

  test("decimals are held to what Intl takes", () => {
    expect(formatDurationInUnit(EN, 1.23456, "second", { decimals: 9 })).toBe(
      "1.235\u00A0s",
    );
    expect(formatDurationInUnit(EN, 1.5, "second", { decimals: -2 })).toBe(
      "2\u00A0s",
    );
  });

  test("a value that is not a number reads as a missing fact", () => {
    expect(
      formatDurationInUnit(FA, Number.NaN, "second", { decimals: 2 }),
    ).toBe("-");
    expect(
      formatDurationInUnit(EN, Number.POSITIVE_INFINITY, "second", {
        decimals: 2,
      }),
    ).toBe("-");
  });

  test("formatMillisecondsInEnglish is English whatever the language: the PDF export's", () => {
    expect(formatMillisecondsInEnglish(42)).toBe("42\u00A0ms");
  });
});
