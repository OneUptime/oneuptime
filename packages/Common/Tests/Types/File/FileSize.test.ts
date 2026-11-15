import { formatCustomFieldFileSize } from "../../../Types/CustomField/CustomFieldFile";
import {
  getDateDisplayLanguage,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import { formatFileSize } from "../../../Types/File/FileSize";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A file's size as every list of files says it - the Custom Fields card,
 * the file picker a form lists files in, a form's review step and a
 * submission's answers: whole kilobytes under a megabyte, one decimal from
 * a megabyte on, bytes under a kilobyte. The picker used to say "47.1 KB"
 * where the card said "47 KB", and "0.1 KB" for a 100-byte file.
 */
describe("formatFileSize", () => {
  test("a file under a kilobyte is counted in bytes, never 0.1 KB", () => {
    expect(formatFileSize(0)).toBe("0\u00A0B");
    expect(formatFileSize(66)).toBe("66\u00A0B");
    expect(formatFileSize(100)).toBe("100\u00A0B");
    expect(formatFileSize(1023)).toBe("1023\u00A0B");
  });

  test("whole kilobytes under a megabyte, never a decimal", () => {
    expect(formatFileSize(1024)).toBe("1\u00A0KB");
    expect(formatFileSize(2048)).toBe("2\u00A0KB");
    expect(formatFileSize(48213)).toBe("47\u00A0KB");
    expect(formatFileSize(245760)).toBe("240\u00A0KB");
    // Just under a megabyte rounds to the kilobyte, not to "1 MB".
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1024\u00A0KB");
  });

  test("one decimal from a megabyte on, none when it is whole", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1\u00A0MB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5\u00A0MB");
    expect(formatFileSize(2516582)).toBe("2.4\u00A0MB");
    expect(formatFileSize(10 * 1024 * 1024)).toBe("10\u00A0MB");
  });

  test("a fraction of a byte is a whole byte down", () => {
    expect(formatFileSize(640.9)).toBe("640\u00A0B");
  });

  test("no size to say for what is not one", () => {
    expect(formatFileSize(-1)).toBe("");
    expect(formatFileSize(Number.NaN)).toBe("");
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe("");
  });

  test("a file custom field says its files' sizes the same way", () => {
    for (const bytes of [0, 66, 1024, 48213, 2516582, 10 * 1024 * 1024, -1]) {
      expect(formatCustomFieldFileSize(bytes)).toBe(formatFileSize(bytes));
    }
  });
});

/*
 * IN THE READER'S DIGITS (issue #7233).
 *
 * A Persian page wrote every count in Persian digits but a file's size in
 * Latin ones ("47 KB" beside "۲ فایل"), and German read "1.5 MB" where it
 * writes "1,5 MB". The number is now the reader's; the unit, the rounding
 * and English are as they were.
 */

// Any of the ten Latin digits.
const LATIN_DIGIT: RegExp = /[0-9]/;

// Any of the ten Persian (Extended Arabic-Indic) digits.
const PERSIAN_DIGIT: RegExp = /[\u06F0-\u06F9]/;

// The sizes the cases below write: bytes, kilobytes and megabytes, whole and not.
const SIZES: Array<number> = [
  0,
  100,
  1023,
  1024,
  48213,
  245760,
  1024 * 1024,
  1.5 * 1024 * 1024,
  2516582,
  10 * 1024 * 1024,
];

describe("formatFileSize in the reader's language", () => {
  const pageLanguage: string = getDateDisplayLanguage();

  afterEach(() => {
    setDateDisplayLanguage(pageLanguage);
  });

  test("English is written exactly as before, its unit after its number", () => {
    expect(
      SIZES.map((bytes: number): string => {
        return formatFileSize(bytes, { language: "en" });
      }),
    ).toEqual([
      "0\u00A0B",
      "100\u00A0B",
      "1023\u00A0B",
      "1\u00A0KB",
      "47\u00A0KB",
      "240\u00A0KB",
      "1\u00A0MB",
      "1.5\u00A0MB",
      "2.4\u00A0MB",
      "10\u00A0MB",
    ]);
  });

  test("Persian in Persian digits, with the same rounding and the same unit", () => {
    expect(
      SIZES.map((bytes: number): string => {
        return formatFileSize(bytes, { language: "fa" });
      }),
    ).toEqual([
      "۰\u00A0B",
      "۱۰۰\u00A0B",
      "۱٬۰۲۳\u00A0B",
      "۱\u00A0KB",
      "۴۷\u00A0KB",
      "۲۴۰\u00A0KB",
      "۱\u00A0MB",
      "۱٫۵\u00A0MB",
      "۲٫۴\u00A0MB",
      "۱۰\u00A0MB",
    ]);

    for (const bytes of SIZES) {
      const size: string = formatFileSize(bytes, { language: "fa" });

      expect(size).not.toMatch(LATIN_DIGIT);
      expect(size).toMatch(PERSIAN_DIGIT);
    }
  });

  test("German with its own decimal comma and grouping", () => {
    expect(formatFileSize(1.5 * 1024 * 1024, { language: "de" })).toBe(
      "1,5\u00A0MB",
    );
    expect(formatFileSize(2516582, { language: "de" })).toBe("2,4\u00A0MB");
    expect(formatFileSize(1023, { language: "de" })).toBe("1.023\u00A0B");
    expect(formatFileSize(48213, { language: "de" })).toBe("47\u00A0KB");
    expect(formatFileSize(10 * 1024 * 1024, { language: "de" })).toBe("10\u00A0MB");
  });

  test("Arabic keeps the Latin digits it writes by choice", () => {
    expect(formatFileSize(48213, { language: "ar" })).toBe("47\u00A0KB");
    expect(formatFileSize(1.5 * 1024 * 1024, { language: "ar" })).toBe(
      "1.5\u00A0MB",
    );

    for (const bytes of SIZES) {
      expect(formatFileSize(bytes, { language: "ar" })).not.toMatch(
        PERSIAN_DIGIT,
      );
    }
  });

  test("without a language, the page's: what every list of files on a Persian page says", () => {
    setDateDisplayLanguage("fa");

    expect(formatFileSize(48213)).toBe("۴۷\u00A0KB");
    expect(formatCustomFieldFileSize(48213)).toBe("۴۷\u00A0KB");

    setDateDisplayLanguage("en");

    expect(formatFileSize(48213)).toBe("47\u00A0KB");
  });

  test("still no size for what is not one, in any language", () => {
    for (const language of ["en", "fa", "de", "ar"]) {
      expect(formatFileSize(-1, { language })).toBe("");
      expect(formatFileSize(Number.NaN, { language })).toBe("");
    }
  });

  /*
   * Negative control: the size as it was written before - toFixed and a
   * template - is what the Persian check above refuses.
   */
  test("negative control: the old way of writing a size fails the Persian check", () => {
    const writtenTheOldWay: (bytes: number) => string = (
      bytes: number,
    ): string => {
      return `${Math.round(bytes / 1024)} KB`;
    };

    expect(writtenTheOldWay(48213)).toMatch(LATIN_DIGIT);
    expect(writtenTheOldWay(48213)).not.toBe(
      formatFileSize(48213, { language: "fa" }),
    );
  });
});
